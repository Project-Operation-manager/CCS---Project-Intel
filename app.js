import { initGantt } from "./modules/gantt.module.js";
import { initMetrics } from "./modules/metrics.module.js";

window.addEventListener("DOMContentLoaded", () => startApp());

function startApp(){
  const TEAM_TYPES_FIXED = ["Architecture","Interior","Landscape"];
  const TEAM_UNSPEC = "(Unspecified)";
  const TEAM_BLANK_SENTINEL = "__BLANK__";

  // Auto-load this CSV from the repo (relative to app.js)
  const DEFAULT_CSV_URL = new URL("./sheetjs.csv", import.meta.url);

  const STAGES = [
    "CD1","CD2","CD3","CD4","CD5",
    "SD1","SD2","SD3","SD4",
    "MC","AD",
    "DD1","DD2","DD3","DD4",
    "TD1","TD2","TD3","TD4","TD5",
    "WD20","WD40","WD60","WD80","WD100",
    "DC","CO"
  ];

  // Discipline mapping for stage colors
  const DISCIPLINE = {
    Architecture: new Set(["CD1","CD2","CD5","SD1","SD2","AD","DD1","DD2","TD1","TD2","TD3","WD20","WD40","WD60"]),
    Interior:     new Set(["CD3","SD3","DD3","TD4","WD100"]),
    Landscape:    new Set(["CD4","SD4","DD4","TD5","WD80"])
  };

  // Project-level fields
  const FIELDS = {
    projectCode:   ["PC","Project Code","ProjectCode","Code"],
    projectName:   ["Project Name","Project","Name","ProjectName"],
    projectStatus: ["PS","Project Status","Status"],
    bua:           ["BUA","Built up area","Built Up Area","Built-up area","Builtup Area"],

    allottedHours: ["AH","Allotted hours","Allotted Hours","Allotted","Allocated hours","Allocated Hours"],
    consumedHours: ["TCH","Total consumed hours","Total Consumed Hours","Consumed hours","Consumed Hours","Consumed"],
    balanceHours:  ["BH","Balanced hours","Balance hours","Balance Hours","Balance"],

    deployment:    ["DYT","Deployment","Deployement","Deployement "],
    progress:      ["PP","Project progress","Project progess","Progress"],
  };

  // ---------- DOM (some pages won't have all of these) ----------
  const $ = (id)=> document.getElementById(id);

  const elFile = $("file");
  const elStatus = $("status");
  const elProjectSelect = $("projectSelect");
  const elSearch = $("search");
  const elTeamTypeRadios = $("teamTypeRadios");
  const elTeamRadios = $("teamRadios");
  const elTable = $("table");
  const elRowCount = $("rowCount");

  const elGanttMount = $("ganttMount");
  const elMetricsMount = $("metricsMount");

  const HAS_DASHBOARD = !!(elGanttMount && elMetricsMount);

  // ---------- helpers ----------
  function setStatus(msg, kind){
    if(!elStatus){
      // Avoid crashing on pages without status pill.
      if(kind === "warn") console.warn(msg);
      else console.log(msg);
      return;
    }
    elStatus.textContent = msg;
    elStatus.style.color = "";
    if(kind === "ok") elStatus.style.color = "var(--ok)";
    if(kind === "warn") elStatus.style.color = "var(--warn)";
  }

  function normalizeKey(k){
    return String(k||"").replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[\s_-]+/g,"");
  }

  function buildHeaderIndex(headers){
    const idx={};
    for(const h of headers) idx[normalizeKey(h)] = h;
    return idx;
  }

  function pick(row, candidates){
    const map=row.__keyMap||{};
    for(const c of candidates){
      const nk=normalizeKey(c);
      if(map[nk] !== undefined) return row[map[nk]];
    }
    return "";
  }

  function getAllValues(row, candidates){
    const map=row.__keyMap||{};
    const out=[];
    for(const c of candidates){
      const nk=normalizeKey(c);
      if(map[nk] !== undefined) out.push(row[map[nk]]);
    }
    return out;
  }

  function uniq(arr){ return Array.from(new Set(arr)); }

  function escapeHtml(s){
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/\"/g,"&quot;").replace(/'/g,"&#039;");
  }

  function isNoData(v){
    const s = String(v ?? "").trim().toLowerCase();
    if(!s) return true;
    return (
      s === "no data" || s === "no-data" || s === "nodata" ||
      s === "no data." || s === "no data " ||
      s === "na" || s === "n/a" || s === "-" || s === "null"
    );
  }

  function isNotInScope(v){
    const s = String(v ?? "").trim().toLowerCase();
    return s === "not in scope" || s === "out of scope";
  }

  function toNumberOrNull(v){
    if(v == null) return null;
    const s = String(v).trim();
    if(!s) return null;
    if(isNoData(s)) return null;

    // preserve numeric 0
    if(typeof v === "number" && Number.isFinite(v)) return v;

    const cleaned = s.replace(/,/g,"").replace(/[^0-9.\-]/g,"");
    if(!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  function toPercentOrNull(v){
    if(v == null) return null;
    if(typeof v === "number" && Number.isFinite(v)){
      if(v > 0 && v <= 1) return v * 100;
      return v;
    }
    const s = String(v).trim();
    if(!s) return null;
    if(isNoData(s)) return null;

    const hasPct = s.includes("%");
    const n = toNumberOrNull(s);
    if(n == null) return null;

    if(hasPct) return n;
    if(n > 0 && n <= 1) return n * 100;
    return n;
  }

  function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }

  function parseDate(v){
    if(v==null) return null;
    if(v instanceof Date && !isNaN(v)) return v;

    if(typeof v === "number" && Number.isFinite(v)){
      const epoch = new Date(Date.UTC(1899, 11, 30));
      const d = new Date(epoch.getTime() + v * 86400000);
      return isNaN(d)?null:d;
    }

    const s=String(v).trim();
    if(!s || isNoData(s)) return null;

    // dd-mm-yy / dd/mm/yy / dd.mm.yy
    const m2=s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if(m2){
      let dd=+m2[1], mm=+m2[2]-1, yy=+m2[3];
      if(yy<100) yy+=2000;
      const d=new Date(yy,mm,dd);
      return isNaN(d)?null:d;
    }

    const d=new Date(s);
    return isNaN(d)?null:d;
  }

  function daysBetween(a,b){ return Math.round((b-a)/86400000); }

  function disciplineForStage(stage){
    if(DISCIPLINE.Interior.has(stage)) return "Interior";
    if(DISCIPLINE.Landscape.has(stage)) return "Landscape";
    return "Architecture";
  }

  // --------- new per-stage schema (your new CSV structure) ----------
  function stageSchema(stageCode){
    return {
      start: [
        `${stageCode} Start date`,
        `${stageCode} Start Date`,
        `${stageCode} Start`
      ],
      end: [
        `${stageCode} Planned End date`,
        `${stageCode} Planned End Date`,
        `${stageCode} Planned End`,
        `${stageCode} End date`,
        `${stageCode} End Date`,
        `${stageCode} End`
      ],
      extEnd: [
        `${stageCode} Ext end date`,
        `${stageCode} Ext End date`,
        `${stageCode} Ext End Date`
      ],
      deliverables: [
        `${stageCode} Deliverables`,
        `${stageCode} Deliverable`
      ],
      allocated: [
        `${stageCode} Allocated`,
        `${stageCode} Allotted`,
        `${stageCode} Allotted Hours`
      ],
      consumed: [
        `${stageCode} Consumed`,
        `${stageCode} Total Consumed`,
        `${stageCode} TCH`
      ],
      statusProgress: [
        `${stageCode} Status Progress`,
        `${stageCode} Stage Status Progress`,
        `${stageCode} Progress`
      ]
    };
  }

  function parseDeploymentInfo(v){
    // Accept both "Name (10%)" and plain "Name" (no %)
    const s = String(v ?? "").trim();
    if(!s || isNoData(s)) return { people: [], names: [] };

    const parts = s.split(",").map(p=>p.trim()).filter(Boolean);
    const people = [];
    const names = [];

    for(const part of parts){
      const m = part.match(/^(.*?)\s*\(\s*([0-9]+(?:\.[0-9]+)?)\s*%?\s*\)\s*$/);
      if(m){
        const name = (m[1].trim() || "(Blank)");
        const pct = Number(m[2]);
        if(Number.isFinite(pct) && pct > 0) people.push({ name, pct });
        else names.push(name);
      } else {
        names.push(part);
      }
    }

    // Sort by pct desc
    people.sort((a,b)=>b.pct-a.pct);
    return { people, names: uniq(names) };
  }

  function computeRunwayFromPeopleAndBH(people, BH){
    const bh = (BH == null) ? null : Number(BH);
    const factorDecimal = (people || []).reduce((s,p)=>s + (Number(p.pct||0)/100), 0);
    const monthlyBurn = factorDecimal * 174.25;

    if(bh == null) return { runwayMonths: null, runwayDate: null, factorDecimal, monthlyBurn };
    if(!Number.isFinite(monthlyBurn) || monthlyBurn <= 0) return { runwayMonths: null, runwayDate: null, factorDecimal, monthlyBurn };
    if(!Number.isFinite(bh) || bh <= 0) return { runwayMonths: 0, runwayDate: null, factorDecimal, monthlyBurn };

    const runwayMonths = bh / monthlyBurn;
    if(!Number.isFinite(runwayMonths) || runwayMonths <= 0) return { runwayMonths: 0, runwayDate: null, factorDecimal, monthlyBurn };

    const today = new Date();
    const days = runwayMonths * 30.4375;
    const runwayDate = new Date(today.getTime() + days * 86400000);

    return { runwayMonths, runwayDate, factorDecimal, monthlyBurn };
  }

  function buildStagesFromProjectRow(row, today){
    if(!row) return [];

    return STAGES.map(st=>{
      const sch = stageSchema(st);

      const start = parseDate(pick(row, sch.start));
      const end = parseDate(pick(row, sch.end));
      const extEnd = parseDate(pick(row, sch.extEnd));

      const del = toNumberOrNull(pick(row, sch.deliverables));
      const alloc = toNumberOrNull(pick(row, sch.allocated));
      const cons = toNumberOrNull(pick(row, sch.consumed));

      const ppRaw = pick(row, sch.statusProgress);
      const pp = toPercentOrNull(ppRaw);
      const stagePP = (pp == null) ? null : clamp(pp, 0, 100);

      // Alert logic (based on dates and completion)
      const alert = { kind:"", text:"" };
      const done = (stagePP != null && stagePP >= 100);

      if(done){
        alert.kind = "ok";
        alert.text = "Complete";
      } else if(start && end){
        if(today > end){
          alert.kind = "bad";
          alert.text = `Overdue +${Math.max(1, daysBetween(end, today))}d`;
        } else if(today >= start && today <= end){
          const spent = Math.max(0, daysBetween(start, today));
          const left = Math.max(0, daysBetween(today, end));
          alert.kind = "warn";
          alert.text = `Spent ${spent}d • Left ${left}d`;
        } else {
          const dToStart = daysBetween(today, start);
          if(dToStart > 0 && dToStart <= 15){
            alert.kind = "warn";
            alert.text = `In ${dToStart}d`;
          }
        }
      }

      return {
        label: st,
        discipline: disciplineForStage(st),

        start,
        end,
        extEnd,

        // New fields
        deliverables: del,
        allocated: alloc,
        consumed: cons,

        // Use Status Progress as stage %; keep raw text for display if needed
        statusText: (ppRaw == null || String(ppRaw).trim() === "" || isNoData(ppRaw)) ? "" : String(ppRaw).trim(),
        stagePP,

        done,
        alert
      };
    });
  }

  // ---------- CSV parsing ----------
  function detectDelimiter(text){
    const sample = (text || "").replace(/^\uFEFF/, "");
    const line = sample.split(/\r?\n/).find(l => l.trim() !== "") || "";
    const stripped = line.replace(/"([^"]|"")*"/g, "");
    const delims = [",",";","\t","|"];
    let best = ",", bestCount = -1;
    for(const d of delims){
      const c = (stripped.split(d).length - 1);
      if(c > bestCount){ bestCount = c; best = d; }
    }
    return best;
  }

  function parseDelimited(text, delimiter){
    const t = String(text || "").replace(/^\uFEFF/, "");
    const rows=[]; let row=[], cur="", inQuotes=false;
    for(let i=0;i<t.length;i++){
      const ch=t[i];
      if(inQuotes){
        if(ch === '"'){
          if(t[i+1] === '"'){ cur+='"'; i++; } else inQuotes=false;
        } else cur+=ch;
      } else {
        if(ch === '"') inQuotes=true;
        else if(ch === delimiter){ row.push(cur); cur=""; }
        else if(ch === "\n"){ row.push(cur); rows.push(row); row=[]; cur=""; }
        else if(ch === "\r"){ /* ignore */ }
        else cur+=ch;
      }
    }
    row.push(cur); rows.push(row);
    while(rows.length && rows[rows.length-1].every(c=>String(c).trim()==="")) rows.pop();
    return rows;
  }

  function matrixToObjects(matrix){
    const headers=(matrix[0]||[]).map((h,i)=>{
      const s = String(h??"").replace(/^\uFEFF/, "").trim();
      return s || `Column ${i+1}`;
    });
    const objects=[];
    for(let r=1;r<matrix.length;r++){
      const line=matrix[r]||[];
      if(!line.length) continue;
      if(line.every(c=>String(c??"").trim()==="")) continue;
      const obj={};
      for(let c=0;c<headers.length;c++) obj[headers[c]] = (line[c] ?? "");
      objects.push(obj);
    }
    return { headers, objects };
  }

  function getProjectFromUrl(){
    try{
      const u = new URL(location.href);
      return u.searchParams.get("project") || u.searchParams.get("pc") || u.searchParams.get("code") || "";
    } catch { return ""; }
  }

  // ---------- UI helpers (guarded) ----------
  function renderTable(rows){
    if(!elTable) return;
    if (!rows.length){
      elTable.innerHTML = `<tr><td class="note">No rows to display.</td></tr>`;
      return;
    }
    const cols = Object.keys(rows[0]).filter(k => k !== "__keyMap");
    const thead = `<thead><tr>${cols.map(c => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>`;
    const tbody = `<tbody>${rows.slice(0, 400).map(r =>
      `<tr>${cols.map(c => `<td>${escapeHtml(String(r[c] ?? ""))}</td>`).join("")}</tr>`
    ).join("")}</tbody>`;
    elTable.innerHTML = thead + tbody;
  }

  function renderRadioRow(el, values, activeValue, onPick){
    if(!el) return;
    el.innerHTML = "";
    const list = ["", ...(values||[])];
    for(const v of list){
      const b = document.createElement("button");
      b.type="button";
      b.className = "radioBtn" + ((v===activeValue) ? " active" : "");
      b.textContent = v ? v : "All";
      b.dataset.value = v;
      b.onclick = ()=> onPick(v);
      el.appendChild(b);
    }
  }

  function setActiveRadio(el, activeValue){
    if(!el) return;
    for(const b of el.querySelectorAll(".radioBtn")){
      b.classList.toggle("active", b.dataset.value === activeValue);
    }
  }

  // ---------- state ----------
  let projectRowsRaw = [];           // original CSV rows
  let projectRowByCode = new Map();  // pc -> original row
  let viewRows = [];                // expanded rows for filtering (team+discipline)
  let filteredRows = [];            // filtered view rows (for table + project list)

  let activeTeamType = "";
  let activeTeam = "";
  let activeProject = "";

  // ---------- building filter view rows ----------
  function parseTeamNames(cell){
    const s = String(cell ?? "").trim();
    if(!s || isNoData(s) || isNotInScope(s)) return [];
    return s.split(",").map(x=>x.trim()).filter(Boolean);
  }

  function buildViewRows(headers, objects){
    const keyMap = buildHeaderIndex(headers);

    projectRowsRaw = objects.map(o => ({ ...o, __keyMap: keyMap }));
    projectRowByCode = new Map();
    viewRows = [];

    for(const row of projectRowsRaw){
      const pc = String(pick(row, FIELDS.projectCode) || "").trim();
      if(pc && !projectRowByCode.has(pc)) projectRowByCode.set(pc, row);

      // Expand by discipline + each name in that discipline cell
      for(const type of TEAM_TYPES_FIXED){
        const names = parseTeamNames(row[type]); // columns are literally Architecture/Interior/Landscape
        if(names.length){
          for(const n of names){
            viewRows.push({ ...row, __teamType:type, __team:n, __pc:pc });
          }
        } else {
          // keep an "unspecified" row for discipline (helps filtering to Unspecified)
          viewRows.push({ ...row, __teamType:type, __team:"", __pc:pc });
        }
      }
    }
  }

  function displayTeam(t){ return t ? t : TEAM_UNSPEC; }
  function normalizeTeamSelectionValue(v){ return (v === TEAM_UNSPEC) ? TEAM_BLANK_SENTINEL : v; }
  function matchTeam(rowTeam, active){
    const rt = String(rowTeam || "").trim().toLowerCase();
    if(active === TEAM_BLANK_SENTINEL) return rt === "";
    return rt === String(active||"").trim().toLowerCase();
  }

  function rowMatchesTeamType(r){
    if(!activeTeamType) return true;
    return String(r.__teamType || "").toLowerCase() === String(activeTeamType).toLowerCase();
  }
  function rowMatchesTeam(r){
    if(!activeTeam) return true;
    return matchTeam(r.__team || "", activeTeam);
  }

  function getTeamsForSelectedType(){
    const teams = viewRows
      .filter(r => rowMatchesTeamType(r))
      .map(r => displayTeam(String(r.__team || "").trim()))
      .filter(Boolean);
    return uniq(teams).sort((a,b)=>a.localeCompare(b));
  }

  function initProjectDropdownFromFiltered(){
    const codes = uniq(filteredRows
      .map(r=>String(r.__pc || "").trim())
      .filter(Boolean))
      .sort((a,b)=>a.localeCompare(b));

    const wanted = activeProject || getProjectFromUrl() || "";
    const picked = (wanted && codes.includes(wanted)) ? wanted : (codes[0] || "");

    activeProject = picked;

    if(elProjectSelect){
      elProjectSelect.innerHTML =
        `<option value="">Select a project…</option>` +
        codes.map(pc=>{
          const base = projectRowByCode.get(pc);
          const pn = base ? String(pick(base, FIELDS.projectName) || "").trim() : "";
          const label = pn ? `${pc} — ${pn}` : pc;
          return `<option value="${escapeHtml(pc)}">${escapeHtml(label)}</option>`;
        }).join("");

      elProjectSelect.value = activeProject || "";
      elProjectSelect.disabled = codes.length === 0;
    }

    if(elSearch) elSearch.disabled = codes.length === 0;
  }

  function applyFilters(){
    filteredRows = viewRows.filter(r => rowMatchesTeamType(r) && rowMatchesTeam(r));

    initProjectDropdownFromFiltered();
    renderAll();
  }

  function setTeamType(v){
    activeTeamType = v || "";
    setActiveRadio(elTeamTypeRadios, activeTeamType);

    activeTeam = "";
    setActiveRadio(elTeamRadios, "");

    renderRadioRow(elTeamRadios, getTeamsForSelectedType(), "", (vv)=> setTeam(vv));
    applyFilters();
  }

  function setTeam(v){
    activeTeam = normalizeTeamSelectionValue(v || "");
    setActiveRadio(elTeamRadios, v || "");
    applyFilters();
  }

  // ---------- modules ----------
  function fmtMonthYear(d){
    const mm = String(d.getMonth()+1).padStart(2,"0");
    const yy = d.getFullYear();
    return `${mm}/${yy}`;
  }

  const gantt = HAS_DASHBOARD ? initGantt(elGanttMount, {
    fmtWindow: (a,b)=> `${fmtMonthYear(a)} → ${fmtMonthYear(b)}`
  }) : null;

  const metrics = HAS_DASHBOARD ? initMetrics(elMetricsMount, {
    onRunwaySimulated: (sim)=> gantt?.setRunway(sim?.runwayDate || null)
  }) : null;

  // ---------- render ----------
  function renderAll(){
    if(elProjectSelect) activeProject = elProjectSelect.value || activeProject || "";
    const query = elSearch ? elSearch.value.trim().toLowerCase() : "";

    // filter rows for raw table (uses view rows)
    let tableRows = filteredRows;
    if(activeProject){
      tableRows = tableRows.filter(r => String(r.__pc||"").trim() === String(activeProject).trim());
    }
    if(query){
      tableRows = tableRows.filter(r => JSON.stringify(r).toLowerCase().includes(query));
    }

    if(elRowCount) elRowCount.textContent = `${tableRows.length} rows`;
    renderTable(tableRows);

    if(!HAS_DASHBOARD) return;

    const baseRow = projectRowByCode.get(activeProject) || (tableRows[0] || null);
    const projectName = baseRow ? String(pick(baseRow, FIELDS.projectName) || "").trim() : "";
    const title = activeProject ? (projectName ? `${activeProject} — ${projectName}` : activeProject) : "Select a project";

    const projectPPraw = baseRow ? pick(baseRow, FIELDS.progress) : null;
    const projectPP = (() => {
      const pp = toPercentOrNull(projectPPraw);
      return (pp == null) ? null : clamp(pp, 0, 100);
    })();

    const AH = baseRow ? toNumberOrNull(pick(baseRow, FIELDS.allottedHours)) : null;
    const TCH = baseRow ? toNumberOrNull(pick(baseRow, FIELDS.consumedHours)) : null;
    const BH = baseRow ? toNumberOrNull(pick(baseRow, FIELDS.balanceHours)) : null;

    const hours = { AH, TCH, BH };

    const depRaw = baseRow ? pick(baseRow, FIELDS.deployment) : null;
    const dep = parseDeploymentInfo(depRaw);

    const runway = computeRunwayFromPeopleAndBH(dep.people, BH);
    const runwayDate = runway?.runwayDate || null;

    const today = new Date();
    const stages = baseRow ? buildStagesFromProjectRow(baseRow, today) : [];

    gantt?.setData({ title, projectPP, stages, runwayDate });
    metrics?.setData({ title, hours, people: dep.people, deploymentNames: dep.names, runway });
    gantt?.setRunway(runwayDate);
  }

  // ---------- import ----------
  async function importFile(file){
    const name=(file?.name||"").toLowerCase();
    setStatus("Loading…");

    // reset UI safely
    if(elProjectSelect){
      elProjectSelect.innerHTML = `<option value="">Select a project…</option>`;
      elProjectSelect.disabled = true;
    }
    if(elSearch){
      elSearch.value = "";
      elSearch.disabled = true;
    }
    if(elTeamTypeRadios) elTeamTypeRadios.innerHTML = "";
    if(elTeamRadios) elTeamRadios.innerHTML = "";
    if(elTable) elTable.innerHTML = "";
    if(elRowCount) elRowCount.textContent = "0 rows";

    projectRowsRaw = [];
    projectRowByCode = new Map();
    viewRows = [];
    filteredRows = [];

    activeTeamType = "";
    activeTeam = "";
    activeProject = "";

    try{
      if(name.endsWith(".csv") || name.endsWith(".tsv") || name.endsWith(".txt")){
        const text = await file.text();
        const delim = detectDelimiter(text);
        const matrix = parseDelimited(text, delim);
        const { headers, objects } = matrixToObjects(matrix);

        buildViewRows(headers, objects);

        // Render filters
        renderRadioRow(elTeamTypeRadios, TEAM_TYPES_FIXED, "", setTeamType);
        renderRadioRow(elTeamRadios, uniq(viewRows.map(r=>displayTeam(r.__team))).sort((a,b)=>a.localeCompare(b)), "", (v)=> setTeam(v));

        // Start with URL project (if any) and apply filters
        activeProject = getProjectFromUrl() || "";
        applyFilters();

        setStatus(`Loaded (${delim === "\t" ? "TAB" : delim} • ${projectRowsRaw.length} projects)`, "ok");
        return;
      }

      if(name.endsWith(".xlsx") || name.endsWith(".xls")){
        if(typeof XLSX === "undefined") throw new Error("XLSX library not loaded (check network).");

        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data,{ type:"array", cellDates:true });
        if(!workbook.SheetNames?.length) throw new Error("No sheets found.");
        const firstSheet = workbook.SheetNames[0];
        const ws = workbook.Sheets[firstSheet];
        const matrix = XLSX.utils.sheet_to_json(ws,{ header:1, defval:"", raw:false });
        const { headers, objects } = matrixToObjects(matrix);

        buildViewRows(headers, objects);

        renderRadioRow(elTeamTypeRadios, TEAM_TYPES_FIXED, "", setTeamType);
        renderRadioRow(elTeamRadios, uniq(viewRows.map(r=>displayTeam(r.__team))).sort((a,b)=>a.localeCompare(b)), "", (v)=> setTeam(v));

        activeProject = getProjectFromUrl() || "";
        applyFilters();

        setStatus(`Imported "${file.name}" (sheet: ${firstSheet})`, "ok");
        return;
      }

      setStatus("Unsupported file type.", "warn");
    } catch(err){
      console.error(err);
      setStatus(`Failed to load: ${err?.message || err}`, "warn");
    }
  }

  // ---------- auto-load sheetjs.csv ----------
  async function autoLoadDefaultCsv(){
    // If you're opening index.html directly (file://), fetch won't work reliably.
    if(location.protocol === "file:"){
      setStatus(`Tip: open via a web server or GitHub Pages to auto-load sheetjs.csv`, "warn");
      return;
    }

    try{
      setStatus("Loading sheetjs.csv…");

      const res = await fetch(DEFAULT_CSV_URL.toString(), { cache:"no-store" });
      if(!res.ok) throw new Error(`HTTP ${res.status} (${res.statusText})`);

      const blob = await res.blob();
      const f = new File([blob], "sheetjs.csv", { type: blob.type || "text/csv" });

      await importFile(f);
      setStatus("Auto-loaded sheetjs.csv", "ok");
    } catch(err){
      console.warn("Auto-load failed:", err);
      setStatus(`Auto-load failed: ${err?.message || err}`, "warn");
    }
  }

  // ---------- events ----------
  if(elFile){
    elFile.addEventListener("change", async ()=>{
      const f = elFile.files?.[0];
      if(f) await importFile(f);
    });
  }
  if(elProjectSelect) elProjectSelect.addEventListener("change", renderAll);
  if(elSearch) elSearch.addEventListener("input", renderAll);

  // Initial empty state
  if(HAS_DASHBOARD){
    gantt?.setData({ title:"Select a project", projectPP:null, stages:[], runwayDate:null });
    metrics?.setData({ title:"", hours:{AH:null,TCH:null,BH:null}, people:[], deploymentNames:[], runway:null });
  }

  // Kick off auto-load
  autoLoadDefaultCsv();
}

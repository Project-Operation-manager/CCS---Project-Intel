import { initGantt } from "./modules/gantt.module.js";
import { initMetrics } from "./modules/metrics.module.js";

window.addEventListener("DOMContentLoaded", () => startApp());

function startApp(){
  // ---- constants
  const TEAM_TYPES_FIXED = ["Architecture","Interior","Landscape"];
  const TEAM_UNSPEC = "(Unspecified)";
  const TEAM_BLANK_SENTINEL = "__BLANK__";

  const STAGES = [
    "CD1","CD2","CD3","CD4","CD5",
    "SD1","SD2","SD3","SD4",
    "MC","AD",
    "DD1","DD2","DD3","DD4",
    "TD1","TD2","TD3","TD4","TD5",
    "WD20","WD40","WD60","WD80","WD100",
    "DC","CO"
  ];

  // Discipline mapping (drives bar color)
  const DISCIPLINE = {
    Architecture: new Set(["CD1","CD2","CD5","SD1","SD2","AD","DD1","DD2","TD1","TD2","TD3","WD20","WD40","WD60"]),
    Interior:     new Set(["CD3","SD3","DD3","TD4","WD100"]),
    Landscape:    new Set(["CD4","SD4","DD4","TD5","WD80"])
  };

  // Project-level fields
  const FIELDS = {
    projectCode:   ["PC","Project Code","ProjectCode","Code"],
    projectName:   ["Project Name","Project","Name","ProjectName"],

    allottedHours: ["AH","Allotted hours","Allotted Hours","Allotted","Allocated hours","Allocated Hours"],
    consumedHours: ["TCH","Total consumed hours","Total Consumed Hours","Consumed hours","Consumed Hours","Consumed"],
    balanceHours:  ["BH","Balanced hours","Balance hours","Balance Hours","Balance"],

    deployment:    ["DYT","Deployment","Deployement"],
    progress:      ["PP","Project progress","Project progess","Progress"],
  };

  // ---- helpers
  function normalizeKey(k){
    return String(k||"")
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g,"");
  }

  function buildHeaderIndex(headers){
    const idx={};
    for(const h of headers){
      idx[normalizeKey(h)] = h;
    }
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

  function isNoData(v){
    if(v == null) return true;
    const s = String(v).trim();
    if(!s) return true;
    const low = s.toLowerCase();
    return ["no data","nodata","n/a","na","-","—","/"].includes(low);
  }

  function isOutOfScope(v){
    if(v == null) return true;
    const s = String(v).trim().toLowerCase();
    if(!s) return true;
    if(s.includes("not in scope") || s.includes("notinscope")) return true;
    return false;
  }

  function toMaybeNumber(v){
    if(isNoData(v)) return null;
    if(typeof v === "number" && Number.isFinite(v)) return v;
    const s = String(v).trim();
    if(!s) return null;

    // If it contains letters, treat as non-numeric (prevents date-like strings)
    if(/[a-zA-Z]/.test(s)) return null;

    const cleaned = s.replace(/,/g, "").replace(/[^0-9.\-]/g, "");
    if(!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  function toMaybePercent(v){
    if(isNoData(v)) return null;
    if(typeof v === "number" && Number.isFinite(v)){
      if(v > 0 && v <= 1) return v * 100;
      return v;
    }
    const s = String(v).trim();
    if(!s) return null;
    const hasPct = s.includes("%");
    const n = toMaybeNumber(s.replace(/%/g, ""));
    if(n == null) return null;
    if(hasPct) return n;
    if(n > 0 && n <= 1) return n * 100;
    return n;
  }

  function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }

  function parseDate(v){
    if(isNoData(v)) return null;
    if(v instanceof Date && !isNaN(v)) return v;

    // Excel serial
    if(typeof v === "number" && Number.isFinite(v)){
      const epoch = new Date(Date.UTC(1899, 11, 30));
      const d = new Date(epoch.getTime() + v * 86400000);
      return isNaN(d) ? null : d;
    }

    const s = String(v).trim();
    if(!s) return null;

    // dd-MMM-yy or dd-MMM-yyyy (e.g., 01-Mar-21)
    const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
    if(m){
      const dd = Number(m[1]);
      const mon = m[2].toLowerCase();
      let yy = Number(m[3]);
      if(yy < 100) yy += 2000;
      const monthMap = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
      if(monthMap[mon] == null) return null;
      const d = new Date(yy, monthMap[mon], dd);
      return isNaN(d) ? null : d;
    }

    // dd/mm/yyyy or dd-mm-yyyy
    const m2=s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if(m2){
      let dd=+m2[1], mm=+m2[2]-1, yy=+m2[3]; if(yy<100) yy+=2000;
      const d=new Date(yy,mm,dd);
      return isNaN(d)?null:d;
    }

    // ISO-ish / fallback
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }

  function daysBetween(a,b){ return Math.round((b-a)/86400000); }

  function escapeHtml(s){
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/\"/g,"&quot;").replace(/'/g,"&#039;");
  }

  function displayTeam(t){ return t ? t : TEAM_UNSPEC; }
  function normalizeTeamSelectionValue(v){ return (v === TEAM_UNSPEC) ? TEAM_BLANK_SENTINEL : v; }
  function matchTeam(rowTeam, activeTeam){
    const rt = String(rowTeam || "").trim().toLowerCase();
    if(activeTeam === TEAM_BLANK_SENTINEL) return rt === "";
    return rt === String(activeTeam||"").trim().toLowerCase();
  }

  function disciplineForStage(stage){
    if(DISCIPLINE.Architecture.has(stage)) return "Architecture";
    if(DISCIPLINE.Interior.has(stage)) return "Interior";
    if(DISCIPLINE.Landscape.has(stage)) return "Landscape";
    return "Architecture";
  }

  // Deployment parsing: keep ABSOLUTE percentages exactly as written
  function parseDeploymentCell(v){
    if(isNoData(v)) return [];
    const s=String(v||"").trim();
    if(!s) return [];

    return s.split(",")
      .map(p=>p.trim())
      .filter(Boolean)
      .map(part=>{
        const m=part.match(/^(.*?)\s*\(\s*([0-9]+(?:\.[0-9]+)?)\s*%?\s*\)\s*$/);
        if(m) return { name:(m[1].trim()||"(Blank)"), pct:Number(m[2]) };
        return { name:part, pct:0 };
      });
  }

  // ---- stage schema (new structure)
  function stageSchema(stageCode){
    return {
      start: [
        `${stageCode} Start date`, `${stageCode} Start Date`,
        `${stageCode} Start`, `${stageCode} Begin`, `${stageCode} StartDate`
      ],
      plannedEnd: [
        `${stageCode} Planned End date`, `${stageCode} Planned End Date`,
        `${stageCode} End date`, `${stageCode} End Date`,
        `${stageCode} End`, `${stageCode} Finish`, `${stageCode} EndDate`
      ],
      extEnd: [
        `${stageCode} Ext end date`, `${stageCode} Ext End date`, `${stageCode} Ext End Date`,
        `${stageCode} Extension end date`, `${stageCode} Extended End date`, `${stageCode} Extended End Date`
      ],
      deliverables: [
        `${stageCode} Deliverables`, `${stageCode} Deliverable`
      ],
      allocated: [
        `${stageCode} Allocated`, `${stageCode} Allocated hours`, `${stageCode} Allocated Hours`
      ],
      consumed: [
        `${stageCode} Consumed`, `${stageCode} Consumed hours`, `${stageCode} Consumed Hours`
      ],
      status: [
        `${stageCode} Status Progress`, `${stageCode} Status`, `${stageCode} Stage Status`
      ]
    };
  }

  function isStageComplete(statusText, stagePP){
    const s = String(statusText || "").trim().toLowerCase();
    if(s.includes("complete") || s === "done" || s === "completed") return true;
    if(Number.isFinite(stagePP) && stagePP >= 100) return true;
    if(s.includes("100%")) return true;
    return false;
  }

  function buildStagesFromBaseRow(row, today){
    return STAGES.map(st=>{
      const sch = stageSchema(st);

      const startDates = getAllValues(row, sch.start).map(parseDate).filter(Boolean);
      const endDates = getAllValues(row, sch.plannedEnd).map(parseDate).filter(Boolean);
      const extDates = getAllValues(row, sch.extEnd).map(parseDate).filter(Boolean);

      const start = startDates.length ? new Date(Math.min(...startDates.map(d=>d.getTime()))) : null;
      const end = endDates.length ? new Date(Math.max(...endDates.map(d=>d.getTime()))) : null;
      const extEnd = extDates.length ? new Date(Math.max(...extDates.map(d=>d.getTime()))) : null;

      const delRaw = pick(row, sch.deliverables);
      const deliverables = toMaybeNumber(delRaw);

      const allocated = toMaybeNumber(pick(row, sch.allocated));
      const consumed = toMaybeNumber(pick(row, sch.consumed));

      const statusRaw = pick(row, sch.status);
      const statusText = isNoData(statusRaw) ? null : String(statusRaw).trim();

      const stagePP = (()=>{
        const p = toMaybePercent(statusRaw);
        return (p == null) ? null : clamp(p, 0, 100);
      })();

      const done = isStageComplete(statusText, stagePP);

      const alert = { kind:"", text:"" };
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
        deliverables,
        allocated,
        consumed,
        statusText,
        done,
        stagePP,
        alert
      };
    });
  }

  // ---- project metrics
  function computeProjectHoursFromRow(row){
    const AH = toMaybeNumber(pick(row, FIELDS.allottedHours));
    const TCH = toMaybeNumber(pick(row, FIELDS.consumedHours));
    let BH = toMaybeNumber(pick(row, FIELDS.balanceHours));
    if(BH == null && AH != null && TCH != null) BH = AH - TCH;
    return { AH, TCH, BH };
  }

  function computeProjectPPFromRow(row){
    const p = toMaybePercent(pick(row, FIELDS.progress));
    return (p == null) ? null : clamp(p, 0, 100);
  }

  function computeDeploymentPeopleFromRow(row){
    const m = new Map();
    const cell = pick(row, FIELDS.deployment);
    for(const item of parseDeploymentCell(cell)){
      const name = String(item.name||"").trim() || "(Blank)";
      const pct = Number.isFinite(item.pct) ? item.pct : 0;
      if(pct <= 0) continue;
      m.set(name, (m.get(name)||0) + pct);
    }

    return Array.from(m.entries())
      .map(([name,pct])=>({name,pct}))
      .sort((a,b)=>b.pct-a.pct);
  }

  function computeRunwayFromPeopleAndBH(people, BH){
    const factorDecimal = (people || []).reduce((s,p)=>s + (Number(p.pct||0)/100), 0);
    const monthlyBurn = factorDecimal * 174.25;

    if(!Number.isFinite(monthlyBurn) || monthlyBurn <= 0) return { runwayMonths: null, runwayDate: null, factorDecimal, monthlyBurn };
    if(!Number.isFinite(BH) || BH == null || BH <= 0) return { runwayMonths: 0, runwayDate: null, factorDecimal, monthlyBurn };

    const runwayMonths = BH / monthlyBurn;
    if(!Number.isFinite(runwayMonths) || runwayMonths <= 0) return { runwayMonths: 0, runwayDate: null, factorDecimal, monthlyBurn };

    const now = new Date();
    const days = runwayMonths * 30.4375;
    const runwayDate = new Date(now.getTime() + days * 86400000);

    return { runwayMonths, runwayDate, factorDecimal, monthlyBurn };
  }

  // ---- DOM (guarded for multi-page setups)
  const elFile = document.getElementById("file");
  const elStatus = document.getElementById("status");
  const elProjectSelect = document.getElementById("projectSelect");
  const elSearch = document.getElementById("search");
  const elTeamTypeRadios = document.getElementById("teamTypeRadios");
  const elTeamRadios = document.getElementById("teamRadios");
  const elTable = document.getElementById("table");
  const elRowCount = document.getElementById("rowCount");

  const ganttMount = document.getElementById("ganttMount");
  const metricsMount = document.getElementById("metricsMount");

  // If this page doesn't have the dashboard elements, exit gracefully.
  if(!ganttMount || !metricsMount || !elProjectSelect || !elTeamTypeRadios || !elTeamRadios){
    return;
  }

  function setStatus(msg, kind){
    if(!elStatus) return;
    elStatus.textContent = msg;
    elStatus.style.color = "";
    if(kind === "ok") elStatus.style.color = "var(--ok)";
    if(kind === "warn") elStatus.style.color = "var(--warn)";
  }

  function renderRadioRow(el, values, activeValue, onPick){
    if(!el) return;
    el.innerHTML = "";
    const list = ["", ...(values||[])];
    for(const v of list){
      const b = document.createElement("button");
      b.type = "button";
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

  function renderTable(rows){
    if(!elTable) return;
    if(!rows.length){
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

  // ---- discover discipline columns
  function discoverTeamTypeColumns(headers){
    const normHeaders = headers.map(h => ({ raw:h, n:normalizeKey(h) }));
    function firstMatch(predicate){
      const hit = normHeaders.find(predicate);
      return hit ? hit.raw : null;
    }
    const arch = firstMatch(h => h.n === "architecture" || h.n.includes("architecture") || h.n === "arch");
    const interior = firstMatch(h => h.n === "interior" || h.n.includes("interior") || h.n.includes("interiors"));
    const landscape = firstMatch(h => h.n === "landscape" || h.n.includes("landscape") || h.n.includes("landacpe") || h.n === "landacpe");
    return { Architecture: arch, Interior: interior, Landscape: landscape };
  }

  // ---- app state
  let baseRows = [];            // as parsed (1 per project in your new structure)
  let derivedRowsAll = [];      // cloned per-discipline rows for filtering
  let derivedFiltered = [];

  let baseRowByPC = new Map();
  let projectNameMap = new Map();
  let typeCols = { Architecture:null, Interior:null, Landscape:null };

  let activeTeamType = "";
  let activeTeam = "";
  let activeProject = "";
  let runwayDate = null;

  // ---- modules
  const gantt = initGantt(ganttMount, {
    fmtWindow: (a,b)=> `${fmtMonthYear(a)} → ${fmtMonthYear(b)}`
  });

  const metrics = initMetrics(metricsMount, {
    onRunwaySimulated: (sim)=>{
      runwayDate = sim?.runwayDate || null;
      gantt.setRunway(runwayDate);
    }
  });

  // ---- project name map
  function buildProjectNameMapFromBaseRows(rows){
    projectNameMap = new Map();
    for(const r of rows){
      const pc = String(pick(r, FIELDS.projectCode) || "").trim();
      const pn = String(pick(r, FIELDS.projectName) || "").trim();
      if(pc && pn && !projectNameMap.has(pc)) projectNameMap.set(pc, pn);
    }
  }

  function initProjectDropdownFromDerivedRows(rows){
    if(!elProjectSelect) return;

    const codes = uniq((rows||[])
      .map(r=>String(pick(r,FIELDS.projectCode)||"").trim())
      .filter(Boolean))
      .sort((a,b)=>a.localeCompare(b));

    const prev = activeProject || "";
    elProjectSelect.innerHTML = `<option value="">Select a project…</option>` +
      codes.map(pc=>{
        const pn = projectNameMap.get(pc) || "";
        const label = pn ? `${pc} — ${pn}` : pc;
        return `<option value="${escapeHtml(pc)}">${escapeHtml(label)}</option>`;
      }).join("");

    if(prev && codes.includes(prev)) activeProject = prev;
    else activeProject = codes[0] || "";

    elProjectSelect.value = activeProject || "";
    elProjectSelect.disabled = codes.length === 0;
    if(elSearch) elSearch.disabled = codes.length === 0;
  }

  function getTeamsForSelectedType(){
    const teams = derivedRowsAll
      .filter(r => !activeTeamType || String(r.__teamType||"") === activeTeamType)
      .map(r => displayTeam(String(r.__team || "").trim()))
      .filter(Boolean);

    return uniq(teams).sort((a,b)=>a.localeCompare(b));
  }

  function rowMatchesTeamType(r){
    if(!activeTeamType) return true;
    return String(r.__teamType || "") === activeTeamType;
  }

  function rowMatchesTeam(r){
    if(!activeTeam) return true;
    return matchTeam(r.__team || "", activeTeam);
  }

  function applyFilters(){
    derivedFiltered = derivedRowsAll.filter(r => rowMatchesTeamType(r) && rowMatchesTeam(r));

    buildProjectNameMapFromBaseRows(baseRows);
    initProjectDropdownFromDerivedRows(derivedFiltered);

    renderAll();
  }

  function setTeamType(v){
    activeTeamType = v || "";
    setActiveRadio(elTeamTypeRadios, activeTeamType);

    activeTeam = "";
    setActiveRadio(elTeamRadios, "");

    const teams = getTeamsForSelectedType();
    renderRadioRow(elTeamRadios, teams, "", (vv)=> setTeam(vv));

    applyFilters();
  }

  function setTeam(v){
    activeTeam = normalizeTeamSelectionValue(v || "");
    setActiveRadio(elTeamRadios, v || "");
    applyFilters();
  }

  function fmtMonthYear(d){
    const mm = String(d.getMonth()+1).padStart(2,"0");
    const yy = d.getFullYear();
    return `${mm}/${yy}`;
  }

  function renderAll(){
    const query = (elSearch?.value || "").trim().toLowerCase();
    activeProject = elProjectSelect.value || "";

    const rowsForTable = derivedFiltered.filter(row=>{
      if(activeProject){
        const code=String(pick(row,FIELDS.projectCode)||"").trim();
        if(code !== activeProject) return false;
      }
      if(!query) return true;
      return JSON.stringify(row).toLowerCase().includes(query);
    });

    if(elRowCount) elRowCount.textContent = `${rowsForTable.length} rows`;
    renderTable(rowsForTable);

    const today = new Date();
    const baseRow = activeProject ? (baseRowByPC.get(activeProject) || null) : null;

    const projectName = baseRow ? (String(pick(baseRow, FIELDS.projectName)||"").trim()) : "";
    const title = activeProject ? (projectName ? `${activeProject} — ${projectName}` : activeProject) : "Select a project";

    const stages = baseRow ? buildStagesFromBaseRow(baseRow, today) : [];
    const projectPP = baseRow ? computeProjectPPFromRow(baseRow) : null;
    const hours = baseRow ? computeProjectHoursFromRow(baseRow) : { AH:null, TCH:null, BH:null };
    const people = baseRow ? computeDeploymentPeopleFromRow(baseRow) : [];

    const runway = computeRunwayFromPeopleAndBH(people, hours?.BH);
    runwayDate = runway.runwayDate || null;

    gantt.setData({ title, projectPP, stages, runwayDate });
    metrics.setData({ title, hours, people, runway });

    gantt.setRunway(runwayDate);
  }

  // ---- parsing
  function detectDelimiter(text){
    const sample = (text || "").replace(/^\uFEFF/, "");
    const line = sample.split(/\r?\n/).find(l => l.trim() !== "") || "";
    const stripped = line.replace(/\"([^\"]|\"\")*\"/g, "");
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
        else if(ch === "\r"){ }
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

  function rowCompletenessScore(row){
    let n = 0;
    for(const k of Object.keys(row)){
      if(k === "__keyMap") continue;
      if(!isNoData(row[k])) n++;
    }
    return n;
  }

  function buildBaseRowMaps(rows){
    baseRowByPC = new Map();
    for(const r of rows){
      const pc = String(pick(r, FIELDS.projectCode) || "").trim();
      if(!pc) continue;
      if(!baseRowByPC.has(pc)){
        baseRowByPC.set(pc, r);
      } else {
        const cur = baseRowByPC.get(pc);
        if(rowCompletenessScore(r) > rowCompletenessScore(cur)) baseRowByPC.set(pc, r);
      }
    }
  }

  function buildDerivedRowsForFilters(rows){
    const out=[];
    for(const r of rows){
      const pc = String(pick(r, FIELDS.projectCode) || "").trim();

      let pushed = 0;
      for(const type of TEAM_TYPES_FIXED){
        const col = typeCols?.[type] || type;
        if(!col) continue;
        const raw = r[col];
        if(isOutOfScope(raw) || isNoData(raw)) continue;
        const team = String(raw).trim();
        if(!team) continue;
        out.push({ ...r, __teamType:type, __team:team, __pc:pc });
        pushed++;
      }

      // If nothing is in-scope, keep a single fallback row so the project still appears under "All".
      if(pushed === 0){
        out.push({ ...r, __teamType:"", __team:"", __pc:pc });
      }
    }
    return out;
  }

  async function importFile(file){
    const name=(file?.name||"").toLowerCase();
    setStatus("Loading…");

    baseRows=[]; derivedRowsAll=[]; derivedFiltered=[];
    baseRowByPC = new Map();
    projectNameMap = new Map();

    activeTeamType=""; activeTeam=""; activeProject="";
    runwayDate = null;

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

    try{
      if(name.endsWith(".csv") || name.endsWith(".tsv") || name.endsWith(".txt")){
        const text = await file.text();
        const delim = detectDelimiter(text);
        const matrix = parseDelimited(text, delim);
        const { headers, objects } = matrixToObjects(matrix);
        const keyMap = buildHeaderIndex(headers);

        typeCols = discoverTeamTypeColumns(headers);

        baseRows = objects.map(o=>({ ...o, __keyMap:keyMap }));
        buildBaseRowMaps(baseRows);

        derivedRowsAll = buildDerivedRowsForFilters(baseRows);

        renderRadioRow(elTeamTypeRadios, TEAM_TYPES_FIXED, "", setTeamType);
        const teamsAll = uniq(derivedRowsAll.map(r=>displayTeam(String(r.__team||"").trim()))).sort((a,b)=>a.localeCompare(b));
        renderRadioRow(elTeamRadios, teamsAll, "", (v)=> setTeam(v));

        applyFilters();

        setStatus(`Loaded (${delim === "\t" ? "TAB" : delim} • ${baseRows.length} projects)`, "ok");
        return;
      }

      if(name.endsWith(".xlsx") || name.endsWith(".xls")){
        if(typeof XLSX === "undefined") throw new Error("XLSX library not loaded (check network). ");

        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data,{ type:"array", cellDates:true });
        if(!workbook.SheetNames?.length) throw new Error("No sheets found.");
        const firstSheet = workbook.SheetNames[0];
        const ws = workbook.Sheets[firstSheet];
        const matrix = XLSX.utils.sheet_to_json(ws,{ header:1, defval:"", raw:false });
        const { headers, objects } = matrixToObjects(matrix);
        const keyMap = buildHeaderIndex(headers);

        typeCols = discoverTeamTypeColumns(headers);

        baseRows = objects.map(o=>({ ...o, __keyMap:keyMap }));
        buildBaseRowMaps(baseRows);
        derivedRowsAll = buildDerivedRowsForFilters(baseRows);

        renderRadioRow(elTeamTypeRadios, TEAM_TYPES_FIXED, "", setTeamType);
        const teamsAll = uniq(derivedRowsAll.map(r=>displayTeam(String(r.__team||"").trim()))).sort((a,b)=>a.localeCompare(b));
        renderRadioRow(elTeamRadios, teamsAll, "", (v)=> setTeam(v));

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

  // ---- events
  if(elFile){
    elFile.addEventListener("change", async ()=>{
      const f = elFile.files?.[0];
      if(f) await importFile(f);
    });
  }
  elProjectSelect.addEventListener("change", renderAll);
  if(elSearch) elSearch.addEventListener("input", renderAll);

  // ---- auto-load sheetjs.csv (GitHub Pages)
  async function autoLoadDefaultCsv(){
    try{
      const url = new URL("./sheetjs.csv", import.meta.url);
      setStatus("Auto-loading sheetjs.csv…");

      const res = await fetch(url.toString(), { cache:"no-store" });
      if(!res.ok) throw new Error(`HTTP ${res.status}`);

      const blob = await res.blob();
      const file = new File([blob], "sheetjs.csv", { type: blob.type || "text/csv" });
      await importFile(file);
    } catch(err){
      console.warn("Auto-load failed:", err);
      // Don't overwrite status if user already loaded a file
      if(elStatus && /No file loaded/i.test(elStatus.textContent || "")){
        setStatus("Auto-load failed (upload a file)", "warn");
      }
    }
  }

  // Initial
  gantt.setData({ title:"Select a project", projectPP:null, stages:[], runwayDate:null });
  metrics.setData({ title:"", hours:{AH:null,TCH:null,BH:null}, people:[], runway:null });
  setStatus("No file loaded");

  autoLoadDefaultCsv();
}

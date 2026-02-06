import { initGantt } from "./modules/gantt.module.js";
import { initMetrics } from "./modules/metrics.module.js";

window.addEventListener("DOMContentLoaded", () => startApp());

function startApp(){
  // ---------- constants ----------
  const TEAM_TYPES_FIXED = ["Architecture","Interior","Landscape"];
  const TEAM_UNSPEC = "(Unspecified)";
  const TEAM_BLANK_SENTINEL = "__BLANK__";

  // Auto-load CSV that lives next to app.js (GitHub Pages-friendly)
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

  // Discipline mapping
  const DISCIPLINE = {
    Architecture: new Set(["CD1","CD2","CD5","SD1","SD2","AD","DD1","DD2","TD1","TD2","TD3","WD20","WD40","WD60"]),
    Interior:     new Set(["CD3","SD3","DD3","TD4","WD100"]),
    Landscape:    new Set(["CD4","SD4","DD4","TD5","WD80"])
  };

  // Project-level fields (per project)
  const PROJECT_FIELDS = {
    projectCode:   ["PC","Project Code","ProjectCode","Code"],
    projectName:   ["Project Name","Project","Name","ProjectName"],
    bua:           ["BUA","Built up area","Built-up area","Built Up Area","BUA (sqft)","BUA (sqm)"],
    ps:            ["PS","Project Status","Status"],

    // totals
    allottedHours: ["AH","Allotted hours","Allotted Hours","Allotted","Allocated hours","Allocated Hours"],
    consumedHours: ["TCH","Total consumed hours","Total Consumed Hours","Consumed hours","Consumed Hours","Consumed"],
    balanceHours:  ["BH","Balanced hours","Balance hours","Balance Hours","Balance"],

    deployment:    ["DYT","Deployment","Deployement","Deployement "],
    progress:      ["PP","Project progress","Project progess","Progress"],
  };

  // ---------- helpers ----------
  function $(id){ return document.getElementById(id); }

  function normalizeKey(k){
    return String(k||"")
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g,"");
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

  function isNoData(v){
    if(v == null) return true;
    const s = String(v).trim();
    if(!s) return true;
    const low = s.toLowerCase();
    return (
      low === "no data" ||
      low === "nodata" ||
      low === "na" ||
      low === "n/a" ||
      low === "-" ||
      low === "nan" ||
      low === "null" ||
      low === "undefined"
    );
  }

  function isFalsyFlag(raw){
    const low = String(raw||"").trim().toLowerCase();
    if(!low) return true;
    if(["n","no","false","f","0","na","n/a","-","no data","nodata","nan","not in scope","notinscope"].includes(low)) return true;
    return false;
  }

  function isTruthyFlag(raw){
    const low = String(raw||"").trim().toLowerCase();
    if(!low) return false;
    if(["y","yes","true","t","1"].includes(low)) return true;
    return false;
  }

  function looksLikeName(raw){
    return /[a-zA-Z]/.test(String(raw||""));
  }

  function toNumberOrNull(v){
    if(isNoData(v)) return null;
    if(typeof v === "number" && Number.isFinite(v)) return v;
    const s = String(v).trim();
    const cleaned = s.replace(/,/g,"").replace(/[^0-9.\-]/g,"");
    if(!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  function toPercentOrNull(v){
    if(isNoData(v)) return null;
    if(typeof v === "number" && Number.isFinite(v)){
      if(v > 0 && v <= 1) return v*100;
      return v;
    }
    const s = String(v).trim();
    const hasPct = s.includes("%");
    const n = toNumberOrNull(s);
    if(n == null) return null;
    if(hasPct) return n;
    if(n > 0 && n <= 1) return n*100;
    return n;
  }

  function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }

  function parseDate(v){
    if(isNoData(v)) return null;
    if(v instanceof Date && !isNaN(v)) return v;

    // Excel serial number support
    if(typeof v === "number" && Number.isFinite(v)){
      const epoch = new Date(Date.UTC(1899, 11, 30));
      const d = new Date(epoch.getTime() + v * 86400000);
      return isNaN(d)?null:d;
    }

    const s = String(v).trim();
    if(!s) return null;

    // dd-MMM-yy or dd-MMM-yyyy (e.g. 01-Mar-21)
    const mMon = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
    if(mMon){
      let dd = Number(mMon[1]);
      let mon = mMon[2].toLowerCase();
      let yy = Number(mMon[3]);
      if(yy < 100) yy += 2000;
      const monthMap = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
      const mm = monthMap[mon];
      if(mm != null){
        const d = new Date(yy, mm, dd);
        return isNaN(d) ? null : d;
      }
    }

    // dd/mm/yyyy
    const m2=s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if(m2){
      let dd=+m2[1], mm=+m2[2]-1, yy=+m2[3]; if(yy<100) yy+=2000;
      const d=new Date(yy,mm,dd);
      return isNaN(d)?null:d;
    }

    const d=new Date(s);
    return isNaN(d)?null:d;
  }

  function daysBetween(a,b){ return Math.round((b-a)/86400000); }

  function escapeHtml(s){
    return String(s)
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/\"/g,"&quot;")
      .replace(/'/g,"&#039;");
  }

  // Deployment parsing: keeps absolute percentages if present: "Name(25%)"
  function parseDeploymentCell(v){
    if(isNoData(v)) return [];
    const s=String(v||"").trim(); if(!s) return [];
    return s.split(",")
      .map(p=>p.trim())
      .filter(Boolean)
      .map(part=>{
        const m=part.match(/^(.*?)\s*\(\s*([0-9]+(?:\.[0-9]+)?)\s*%?\s*\)\s*$/);
        if(m) return { name:(m[1].trim()||"(Blank)"), pct:Number(m[2]) };
        return { name:part, pct:0 };
      });
  }

  function discoverTeamTypeColumns(headers){
    // your file uses exact headers: Architecture, Interior, Landscape
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

  function deriveTeamInfo(row, typeCols){
    // New structure: the discipline columns store a team lead / names, or "Not in scope"
    for(const type of TEAM_TYPES_FIXED){
      const col = typeCols?.[type];
      if(!col) continue;

      const raw = String(row[col] ?? "").trim();
      if(isFalsyFlag(raw)) continue;

      // If it's a boolean-like truthy, treat as "team unspecified"
      if(isTruthyFlag(raw) || !looksLikeName(raw)){
        return { teamType:type, team:"" };
      }

      return { teamType:type, team: raw };
    }
    return { teamType:"", team:"" };
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

  // Stage schema for NEW structure
  function stageSchema(stageCode){
    return {
      start: [
        `${stageCode} Start date`, `${stageCode} Start Date`,
        `${stageCode} Start`, `${stageCode} Begin`, `${stageCode} StartDate`
      ],
      plannedEnd: [
        `${stageCode} Planned End date`, `${stageCode} Planned End Date`, `${stageCode} Planned End`,
        `${stageCode} End date`, `${stageCode} End Date`, `${stageCode} End`, `${stageCode} Finish`, `${stageCode} EndDate`
      ],
      extEnd: [
        `${stageCode} Ext end date`, `${stageCode} Ext End Date`, `${stageCode} Ext End date`
      ],
      deliverables: [
        `${stageCode} Deliverables`, `${stageCode} Deliverable`
      ],
      allocated: [
        `${stageCode} Allocated`, `${stageCode} Allotted`, `${stageCode} Allotted hours`, `${stageCode} Allotted Hours`,
        `${stageCode} Allocated hours`, `${stageCode} Allocated Hours`
      ],
      consumed: [
        `${stageCode} Consumed`, `${stageCode} Consumed hours`, `${stageCode} Consumed Hours`,
        `${stageCode} Total consumed hours`, `${stageCode} Total Consumed Hours`
      ],
      statusProgress: [
        `${stageCode} Status Progress`, `${stageCode} Stage Status Progress`, `${stageCode} Stage Progress`,
        `${stageCode} Progress`, `${stageCode} PP`
      ]
    };
  }

  function buildStagesFromProjectRowsWide(rowsForProject, today){
    const stageMap = new Map(STAGES.map(s => [s, {
      start:null, end:null, extEnd:null,
      deliverables:null, allocated:null, consumed:null,
      stagePP:null
    }]));

    const maxOrKeep = (cur, val)=>{
      if(val == null) return cur;
      if(cur == null) return val;
      return Math.max(cur, val);
    };

    for(const row of rowsForProject){
      for(const st of STAGES){
        const sch = stageSchema(st);
        const cur = stageMap.get(st);

        const startDates = getAllValues(row, sch.start).map(parseDate).filter(Boolean);
        const plannedEnds = getAllValues(row, sch.plannedEnd).map(parseDate).filter(Boolean);
        const extEnds = getAllValues(row, sch.extEnd).map(parseDate).filter(Boolean);

        let s = startDates.length ? new Date(Math.min(...startDates.map(d=>d.getTime()))) : null;
        let e = plannedEnds.length ? new Date(Math.max(...plannedEnds.map(d=>d.getTime()))) : null;
        let x = extEnds.length ? new Date(Math.max(...extEnds.map(d=>d.getTime()))) : null;

        const delVals = getAllValues(row, sch.deliverables).map(toNumberOrNull).filter(v=>v!=null);
        const aVals = getAllValues(row, sch.allocated).map(toNumberOrNull).filter(v=>v!=null);
        const cVals = getAllValues(row, sch.consumed).map(toNumberOrNull).filter(v=>v!=null);
        const ppVals = getAllValues(row, sch.statusProgress).map(toPercentOrNull).filter(v=>v!=null);

        if(delVals.length) cur.deliverables = maxOrKeep(cur.deliverables, Math.max(...delVals));
        if(aVals.length) cur.allocated = maxOrKeep(cur.allocated, Math.max(...aVals));
        if(cVals.length) cur.consumed = maxOrKeep(cur.consumed, Math.max(...cVals));
        if(ppVals.length) cur.stagePP = maxOrKeep(cur.stagePP, Math.max(...ppVals));

        if(!(s||e||x)) continue;
        if(!e && x) e = x;
        if(!s && e) s = e;
        if(!x && e) x = e;

        if(s && (!cur.start || s < cur.start)) cur.start = s;
        if(e && (!cur.end || e > cur.end)) cur.end = e;
        if(x && (!cur.extEnd || x > cur.extEnd)) cur.extEnd = x;
      }
    }

    return STAGES.map(st=>{
      const v = stageMap.get(st);

      const pp = v.stagePP == null ? null : clamp(v.stagePP, 0, 100);

      // Derived status (since file only has "Status Progress")
      let status = null;
      if(pp == null) status = null;
      else if(pp >= 100) status = "Complete";
      else if(pp > 0) status = "In progress";
      else status = "Not started";

      // Alert badge (timeline based)
      const alert = { kind:"", text:"" };
      if(pp != null && pp >= 100){
        alert.kind = "ok";
        alert.text = "Complete";
      } else if(v.start && v.end){
        if(today > v.end){
          alert.kind = "bad";
          alert.text = `Overdue +${Math.max(1, daysBetween(v.end, today))}d`;
        } else if(today >= v.start && today <= v.end){
          const spent = Math.max(0, daysBetween(v.start, today));
          const left = Math.max(0, daysBetween(today, v.end));
          alert.kind = "warn";
          alert.text = `Spent ${spent}d • Left ${left}d`;
        } else {
          const dToStart = daysBetween(today, v.start);
          if(dToStart > 0 && dToStart <= 15){
            alert.kind = "warn";
            alert.text = `In ${dToStart}d`;
          }
        }
      }

      return {
        label: st,
        discipline: disciplineForStage(st),
        start: v.start,
        end: v.end,
        extEnd: v.extEnd,
        deliverables: v.deliverables,
        allocated: v.allocated,
        consumed: v.consumed,
        stagePP: pp,
        status,
        alert
      };
    });
  }

  // Project totals: use MAX to avoid double-counting repeated totals across rows
  function firstNonNull(vals){
    for(const v of vals){
      if(v != null) return v;
    }
    return null;
  }
  function maxNonNull(vals){
    const filtered = vals.filter(v=>v!=null);
    if(!filtered.length) return null;
    return Math.max(...filtered);
  }

  function computeProjectHours(rows){
    const AH = maxNonNull(rows.map(r=>toNumberOrNull(pick(r, PROJECT_FIELDS.allottedHours))));
    const TCH = maxNonNull(rows.map(r=>toNumberOrNull(pick(r, PROJECT_FIELDS.consumedHours))));
    const BHraw = maxNonNull(rows.map(r=>toNumberOrNull(pick(r, PROJECT_FIELDS.balanceHours))));

    // If BH missing, compute if possible
    let BH = BHraw;
    if(BH == null && AH != null && TCH != null) BH = AH - TCH;

    return { AH, TCH, BH };
  }

  function computeDeploymentPeople(rows){
    // If the same DYT repeats, just take first non-empty string to avoid duplicates
    const dyt = firstNonNull(rows.map(r=>{
      const v = pick(r, PROJECT_FIELDS.deployment);
      return isNoData(v) ? null : String(v).trim();
    }));

    if(!dyt) return [];
    const m = new Map();
    for(const item of parseDeploymentCell(dyt)){
      const name = String(item.name||"").trim() || "(Blank)";
      const pct = Number.isFinite(item.pct) ? item.pct : 0;
      // keep only percent entries (chart expects %)
      if(pct <= 0) continue;
      m.set(name, (m.get(name)||0) + pct);
    }
    return Array.from(m.entries())
      .map(([name,pct])=>({name,pct}))
      .sort((a,b)=>b.pct-a.pct);
  }

  function computeProjectPP(rows){
    const pps = rows.map(r=>toPercentOrNull(pick(r, PROJECT_FIELDS.progress))).filter(v=>v!=null);
    if(!pps.length) return null;
    return clamp(Math.max(...pps), 0, 100);
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

  // ---------- DOM ----------
  const elFile = $("file");
  const elStatus = $("status");
  const elProjectSelect = $("projectSelect");
  const elSearch = $("search");
  const elTeamTypeRadios = $("teamTypeRadios");
  const elTeamRadios = $("teamRadios");
  const elTable = $("table");
  const elRowCount = $("rowCount");

  const ganttMount = $("ganttMount");
  const metricsMount = $("metricsMount");

  // ---------- state ----------
  let csvRowsAll = [];
  let allRows = [];
  let filteredRows = [];
  let projectNameMap = new Map();
  let typeCols = { Architecture:null, Interior:null, Landscape:null };

  let activeTeamType = "";
  let activeTeam = "";
  let activeProject = "";
  let runwayDate = null;

  function setStatus(msg, kind){
    if(!elStatus) return;
    elStatus.textContent = msg;
    elStatus.style.color = "";
    if(kind === "ok") elStatus.style.color = "var(--ok)";
    if(kind === "warn") elStatus.style.color = "var(--warn)";
  }

  // ---------- UI ----------
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

  function buildProjectNameMap(rows){
    projectNameMap = new Map();
    for(const r of rows){
      const pc = String(pick(r, PROJECT_FIELDS.projectCode) || "").trim();
      const pn = String(pick(r, PROJECT_FIELDS.projectName) || "").trim();
      if(pc && pn && !projectNameMap.has(pc)) projectNameMap.set(pc, pn);
    }
  }

  function initProjectDropdown(rows){
    if(!elProjectSelect) return;

    const codes = uniq((rows||[])
      .map(r=>String(pick(r, PROJECT_FIELDS.projectCode)||"").trim())
      .filter(Boolean))
      .sort((a,b)=>a.localeCompare(b, undefined, { numeric:true, sensitivity:"base" }));

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

  function rowMatchesTeamType(r){
    if(!activeTeamType) return true;
    return String(r.__teamType || "").toLowerCase() === activeTeamType.toLowerCase();
  }
  function rowMatchesTeam(r){
    if(!activeTeam) return true;
    return matchTeam(r.__team || "", activeTeam);
  }

  function getTeamsForSelectedType(){
    const teams = csvRowsAll
      .filter(r => rowMatchesTeamType(r))
      .map(r => displayTeam(String(r.__team || "").trim()))
      .filter(Boolean);
    return uniq(teams).sort((a,b)=>a.localeCompare(b));
  }

  function applyCsvFilters(){
    allRows = csvRowsAll.filter(r => rowMatchesTeamType(r) && rowMatchesTeam(r));
    buildProjectNameMap(allRows);
    initProjectDropdown(allRows);
    renderAll();
  }

  function setTeamType(v){
    activeTeamType = v || "";
    setActiveRadio(elTeamTypeRadios, activeTeamType);

    activeTeam = "";
    setActiveRadio(elTeamRadios, "");

    const teams = getTeamsForSelectedType();
    renderRadioRow(elTeamRadios, teams, "", (vv)=> setTeam(vv));

    applyCsvFilters();
  }

  function setTeam(v){
    activeTeam = normalizeTeamSelectionValue(v || "");
    setActiveRadio(elTeamRadios, v || "");
    applyCsvFilters();
  }

  function fmtMonthYear(d){
    const mm = String(d.getMonth()+1).padStart(2,"0");
    const yy = d.getFullYear();
    return `${mm}/${yy}`;
  }

  // ---------- modules ----------
  const gantt = ganttMount ? initGantt(ganttMount, {
    fmtWindow: (a,b)=> `${fmtMonthYear(a)} → ${fmtMonthYear(b)}`
  }) : null;

  const metrics = metricsMount ? initMetrics(metricsMount, {
    onRunwaySimulated: (sim)=>{
      runwayDate = sim?.runwayDate || null;
      gantt?.setRunway(runwayDate);
    }
  }) : null;

  function renderAll(){
    const query = elSearch ? elSearch.value.trim().toLowerCase() : "";
    activeProject = elProjectSelect ? (elProjectSelect.value || "") : (activeProject || "");

    filteredRows = allRows.filter(row=>{
      if(activeProject){
        const code=String(pick(row, PROJECT_FIELDS.projectCode)||"").trim();
        if(code !== activeProject) return false;
      }
      if(!query) return true;
      return JSON.stringify(row).toLowerCase().includes(query);
    });

    if(elRowCount) elRowCount.textContent = `${filteredRows.length} rows`;
    renderTable(filteredRows);

    const rowsForProject = activeProject ? filteredRows : [];
    const today = new Date();

    const projectName = activeProject ? (projectNameMap.get(activeProject) || "") : "";
    const title = activeProject ? (projectName ? `${activeProject} — ${projectName}` : activeProject) : "Select a project";

    const stages = activeProject ? buildStagesFromProjectRowsWide(rowsForProject, today) : [];
    const projectPP = activeProject ? computeProjectPP(rowsForProject) : null;
    const hours = activeProject ? computeProjectHours(rowsForProject) : {AH:null,TCH:null,BH:null};
    const people = activeProject ? computeDeploymentPeople(rowsForProject) : [];

    const runway = computeRunwayFromPeopleAndBH(people, hours.BH);
    runwayDate = runway.runwayDate || null;

    gantt?.setData({ title, projectPP, stages, runwayDate });
    metrics?.setData({ title, hours, people, runway });

    gantt?.setRunway(runwayDate);
  }

  // ---------- parsing ----------
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

  async function importCsvText(text, nameForStatus="sheetjs.csv"){
    const delim = detectDelimiter(text);
    const matrix = parseDelimited(text, delim);
    const { headers, objects } = matrixToObjects(matrix);
    const keyMap = buildHeaderIndex(headers);

    typeCols = discoverTeamTypeColumns(headers);

    csvRowsAll = objects.map(o=>{
      const row = { ...o, __keyMap:keyMap };
      const info = deriveTeamInfo(row, typeCols);
      row.__teamType = info.teamType || "";
      row.__team = info.team || "";
      return row;
    });

    // radios
    renderRadioRow(elTeamTypeRadios, TEAM_TYPES_FIXED, "", setTeamType);
    const teamsAll = uniq(csvRowsAll.map(r=>displayTeam(String(r.__team||"").trim()))).sort((a,b)=>a.localeCompare(b));
    renderRadioRow(elTeamRadios, teamsAll, "", (v)=> setTeam(v));

    applyCsvFilters();
    if(nameForStatus) setStatus(`Loaded ${nameForStatus} (${csvRowsAll.length} rows)`, "ok");
  }

  async function importFile(file){
    const name=(file?.name||"").toLowerCase();
    setStatus("Loading…");

    csvRowsAll=[]; allRows=[]; filteredRows=[];
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
        await importCsvText(text, file.name);
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
        const keyMap = buildHeaderIndex(headers);

        typeCols = discoverTeamTypeColumns(headers);

        csvRowsAll = objects.map(o=>{
          const row = { ...o, __keyMap:keyMap };
          const info = deriveTeamInfo(row, typeCols);
          row.__teamType = info.teamType || "";
          row.__team = info.team || "";
          return row;
        });

        renderRadioRow(elTeamTypeRadios, TEAM_TYPES_FIXED, "", setTeamType);
        const teamsAll = uniq(csvRowsAll.map(r=>displayTeam(String(r.__team||"").trim()))).sort((a,b)=>a.localeCompare(b));
        renderRadioRow(elTeamRadios, teamsAll, "", (v)=> setTeam(v));

        applyCsvFilters();
        setStatus(`Imported "${file.name}" (sheet: ${firstSheet})`, "ok");
        return;
      }

      setStatus("Unsupported file type.", "warn");
    } catch(err){
      console.error(err);
      setStatus(`Failed to load: ${err?.message || err}`, "warn");
    }
  }

  async function autoLoadDefaultCsv(){
    // If opened via file://, fetch typically fails
    if(location.protocol === "file:"){
      setStatus(`Open via GitHub Pages / web server to auto-load sheetjs.csv`, "warn");
      return;
    }
    try{
      setStatus("Loading sheetjs.csv…");
      const res = await fetch(DEFAULT_CSV_URL.toString(), { cache:"no-store" });
      if(!res.ok) throw new Error(`HTTP ${res.status} (${res.statusText})`);
      const text = await res.text();
      await importCsvText(text, "sheetjs.csv");
    } catch(err){
      console.warn("Auto-load failed:", err);
      setStatus(`Auto-load failed: ${err?.message || err}`, "warn");
      // User can still upload manually
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

  // Initial empty render
  gantt?.setData({ title:"Select a project", projectPP:null, stages:[], runwayDate:null });
  metrics?.setData({ title:"", hours:{AH:null,TCH:null,BH:null}, people:[], runway:null });

  // kick off CSV auto-load
  autoLoadDefaultCsv();
}

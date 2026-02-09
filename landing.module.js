import { initLanding } from "./landing.module.js";
import { initGantt } from "./gantt.module.js";
import { initMetrics } from "./metrics.module.js";

window.addEventListener("DOMContentLoaded", () => startApp());

function startApp(){
  // ------------------------------
  // Page detection
  // ------------------------------
  const landingMount = document.getElementById("landingMount");
  const ganttMount = document.getElementById("ganttMount");
  const metricsMount = document.getElementById("metricsMount");
  const mode = (ganttMount && metricsMount) ? "dashboard" : "landing";

  // Landing controls (only exist on index.html)
  const elSearch = document.getElementById("search");
  const elProjectSelect = document.getElementById("projectSelect");
  const elTeamRadios = document.getElementById("teamRadios");
  const elProjectStatusRadios = document.getElementById("projectStatusRadios");
  const elUploadBtn = document.getElementById("uploadBtn");
  const elFile = document.getElementById("file");

  // Logo(s)
  initLogo();

  const DEFAULT_CSV_URL = new URL("./sheetjs.csv", import.meta.url);
  const STORAGE_KEY = "project_intel_data_v2"; // sessionStorage

  // Stages in order
  const STAGES = [
    "CD1","CD2","CD3","CD4","CD5",
    "SD1","SD2","SD3","SD4",
    "MC","AD",
    "DD1","DD2","DD3","DD4",
    "TD1","TD2","TD3","TD4","TD5",
    "WD20","WD40","WD60","WD80","WD100",
    "DC","CO"
  ];

  const TEAM_TYPES = ["Architecture","Interior","Landscape"]; // fixed order

  // Project-level fields (wide files may repeat these; we take first non-empty)
  const PROJECT_FIELDS = {
    projectCode:   ["PC","Project Code","ProjectCode","Code"],
    projectName:   ["Project Name","Project","Name","ProjectName"],
    ps:            ["PS","Project Status","Status"],
    allottedHours: ["AH","Allotted hours","Allotted Hours","Allotted","Allocated hours","Allocated Hours"],
    consumedHours: ["TCH","Total consumed hours","Total Consumed Hours","Consumed hours","Consumed Hours","Consumed"],
    balanceHours:  ["BH","Balanced hours","Balance hours","Balance Hours","Balance"],
    deployment:    ["DYT","Deployment","Deployement","Deployement "],
    progress:      ["PP","Project progress","Project progess","Progress"],
  };

  // ------------------------------
  // Helpers
  // ------------------------------
  function normalizeKey(k){
    return String(k || "")
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "");
  }

  function buildHeaderIndex(headers){
    const idx = {};
    for(const h of headers) idx[normalizeKey(h)] = h;
    return idx;
  }

  function isNoData(v){
    if(v == null) return true;
    const s = String(v).trim();
    if(!s) return true;
    const low = s.toLowerCase();
    return (
      low === "no data" || low === "nodata" ||
      low === "na" || low === "n/a" ||
      low === "-" || low === "nan" ||
      low === "null" || low === "undefined"
    );
  }

  function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

  function toNumberOrNull(v){
    if(isNoData(v)) return null;
    const s = String(v).trim().replace(/,/g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function toPercentOrNull(v){
    if(isNoData(v)) return null;
    const s = String(v).trim().replace(/%/g, "").replace(/,/g, "");
    const n = Number(s);
    if(!Number.isFinite(n)) return null;
    return clamp(n, 0, 100);
  }

  function parseDate(v){
    if(isNoData(v)) return null;
    if(v instanceof Date && !isNaN(v)) return v;
    const s = String(v).trim();
    if(!s) return null;

    // dd-MMM-yy / dd-MMM-yyyy
    const m1 = s.match(/^(\d{1,2})[-\/\s]([A-Za-z]{3,})[-\/\s](\d{2,4})$/);
    if(m1){
      const dd = Number(m1[1]);
      const monStr = m1[2].slice(0,3).toLowerCase();
      const yyRaw = Number(m1[3]);
      const mmMap = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
      const mm = mmMap[monStr];
      if(mm != null){
        const yyyy = (yyRaw < 100) ? (yyRaw >= 70 ? 1900 + yyRaw : 2000 + yyRaw) : yyRaw;
        const d = new Date(yyyy, mm, dd);
        return isNaN(d) ? null : d;
      }
    }

    // dd/mm/yyyy or dd-mm-yyyy
    const m2 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if(m2){
      const dd = Number(m2[1]);
      const mm = Number(m2[2]) - 1;
      const yyRaw = Number(m2[3]);
      const yyyy = (yyRaw < 100) ? (yyRaw >= 70 ? 1900 + yyRaw : 2000 + yyRaw) : yyRaw;
      const d = new Date(yyyy, mm, dd);
      return isNaN(d) ? null : d;
    }

    const d = new Date(s);
    return isNaN(d) ? null : d;
  }

  function uniq(arr){ return Array.from(new Set(arr)); }

  function firstNonNull(vals){
    for(const v of vals){
      if(v != null) return v;
    }
    return null;
  }

  function maxNonNull(vals){
    const v = vals.filter(x => x != null);
    return v.length ? Math.max(...v) : null;
  }

  // ------------------------------
  // CSV/XLSX parsing
  // ------------------------------
  function detectDelimiter(text){
    const sample = (text || "").replace(/^\uFEFF/, "");
    const line = sample.split(/\r?\n/).find(l => l.trim() !== "") || "";
    const stripped = line.replace(/"([^"]|\"\")*"/g, "");
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
    while(rows.length && rows[rows.length-1].every(c => String(c).trim()==="")) rows.pop();
    return rows;
  }

  function matrixToObjects(matrix){
    const headers=(matrix[0]||[]).map((h,i)=>{
      const s = String(h ?? "").replace(/^\uFEFF/, "").trim();
      return s || `Column ${i+1}`;
    });
    const objects=[];
    for(let r=1;r<matrix.length;r++){
      const line=matrix[r]||[];
      if(!line.length) continue;
      if(line.every(c => String(c ?? "").trim()==="")) continue;
      const obj={};
      for(let c=0;c<headers.length;c++) obj[headers[c]] = (line[c] ?? "");
      objects.push(obj);
    }
    return { headers, objects };
  }

  async function importCsvText(text){
    const delim = detectDelimiter(text);
    const matrix = parseDelimited(text, delim);
    return matrixToObjects(matrix);
  }

  async function importXlsxFile(file){
    if(typeof XLSX === "undefined") throw new Error("XLSX library not loaded");
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type:"array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet, { header:1, raw:true, defval:"" });
    return matrixToObjects(json);
  }

  // ------------------------------
  // Column discovery
  // ------------------------------
  function discoverTeamTypeColumns(headers){
    const normHeaders = headers.map(h => ({ raw:h, n:normalizeKey(h) }));
    const firstMatch = (pred)=> (normHeaders.find(pred)?.raw || null);
    return {
      Architecture: firstMatch(h => h.n === "architecture" || h.n.includes("architecture") || h.n === "arch"),
      Interior:     firstMatch(h => h.n === "interior" || h.n.includes("interior")),
      Landscape:    firstMatch(h => h.n === "landscape" || h.n.includes("landscape") || h.n.includes("landacpe") || h.n === "landacpe"),
    };
  }

  function looksLikeName(s){
    const t = String(s || "").trim();
    if(!t) return false;
    // exclude obvious booleans
    const low = t.toLowerCase();
    if(["yes","no","true","false","y","n","1","0"].includes(low)) return false;
    return true;
  }

  function teamSummaryFromRow(row, typeCols){
    const out=[];
    for(const type of TEAM_TYPES){
      const col = typeCols?.[type];
      if(!col) continue;
      const raw = String(row[col] ?? "").trim();
      if(isNoData(raw) || !looksLikeName(raw)) continue;
      out.push({ type, name: raw });
    }
    return out;
  }

  function resolveStageColumns(headers){
    const norm = headers.map(h => ({ raw:h, n:normalizeKey(h) }));
    const out = {};

    const startsWithStage = (hn, st) => hn.startsWith(st) || hn.includes(st);

    for(const stRaw of STAGES){
      const st = stRaw.toLowerCase();
      const match = (pred)=> norm.filter(h => startsWithStage(h.n, st) && pred(h.n)).map(h=>h.raw);
      const start = match(n => n.includes("start") || n.includes("begin"));
      const extEnd = match(n => n.includes("ext") && (n.includes("end") || n.includes("finish")));
      const plannedEnd = match(n => n.includes("planned") && (n.includes("end") || n.includes("finish")));
      const end = match(n => !n.includes("ext") && (n.includes("end") || n.includes("finish")));
      const deliverables = match(n => n.includes("deliverable"));
      const allocated = match(n => n.includes("allocated") || n.includes("allotted"));
      const consumed = match(n => n.includes("consumed"));
      const statusProgress = match(n => n.includes("statusprogress") || (n.includes("progress") && !n.includes("projectprogress")) || n.endsWith("pp"));
      const status = match(n => n.includes("status") && !n.includes("statusprogress"));

      out[stRaw] = { start, end, plannedEnd, extEnd, deliverables, allocated, consumed, statusProgress, status };
    }
    return out;
  }

  // ------------------------------
  // Project computations
  // ------------------------------
  function pick(row, candidates){
    const map = row.__keyMap || {};
    for(const c of candidates){
      const nk = normalizeKey(c);
      if(map[nk] !== undefined) return row[map[nk]];
    }
    return "";
  }

  function valuesByHeaders(row, headers){
    const out=[];
    for(const h of (headers || [])){
      if(h in row) out.push(row[h]);
    }
    return out;
  }

  function stageStatusComplete(raw){
    const s = String(raw || "").trim().toLowerCase();
    if(!s) return false;
    return s.includes("complete") || s === "done" || s.includes("closed") || s === "finish" || s.includes("approved");
  }

  function stageStatusText(raw, pp){
    const s = String(raw || "").trim();
    if(s && !isNoData(s)) return s;
    if(pp == null) return "/";
    if(pp >= 100) return "Complete";
    if(pp > 0) return "In progress";
    return "Not started";
  }

  function buildStagesFromProjectRowsWide(rowsForProject, today, stageCols){
    const stageMap = new Map(STAGES.map(s => [s, {
      start:null, end:null, extEnd:null,
      deliverables:null, allocated:null, consumed:null,
      stagePP:null,
      stageStatusRaw:""
    }]));

    const maxOrKeep = (cur, val)=>{
      if(val == null) return cur;
      if(cur == null) return val;
      return Math.max(cur, val);
    };

    for(const row of rowsForProject){
      for(const st of STAGES){
        const cols = stageCols?.[st];
        if(!cols) continue;
        const cur = stageMap.get(st);

        const startDates = valuesByHeaders(row, cols.start).map(parseDate).filter(Boolean);
        const plannedEnds = valuesByHeaders(row, cols.plannedEnd).map(parseDate).filter(Boolean);
        const ends = valuesByHeaders(row, cols.end).map(parseDate).filter(Boolean);
        const extEnds = valuesByHeaders(row, cols.extEnd).map(parseDate).filter(Boolean);

        const s = startDates.length ? new Date(Math.min(...startDates.map(d=>d.getTime()))) : null;
        const eCand = plannedEnds.length ? plannedEnds : ends;
        const e = eCand.length ? new Date(Math.max(...eCand.map(d=>d.getTime()))) : null;
        const x = extEnds.length ? new Date(Math.max(...extEnds.map(d=>d.getTime()))) : null;

        const delVals = valuesByHeaders(row, cols.deliverables).map(toNumberOrNull).filter(v=>v!=null);
        const aVals = valuesByHeaders(row, cols.allocated).map(toNumberOrNull).filter(v=>v!=null);
        const cVals = valuesByHeaders(row, cols.consumed).map(toNumberOrNull).filter(v=>v!=null);
        const ppVals = valuesByHeaders(row, cols.statusProgress).map(toPercentOrNull).filter(v=>v!=null);
        const stVals = valuesByHeaders(row, cols.status).map(v => isNoData(v) ? "" : String(v).trim()).filter(Boolean);

        cur.start = (s && (!cur.start || s < cur.start)) ? s : cur.start;
        cur.end = (e && (!cur.end || e > cur.end)) ? e : cur.end;
        cur.extEnd = (x && (!cur.extEnd || x > cur.extEnd)) ? x : cur.extEnd;
        cur.deliverables = delVals.length ? maxOrKeep(cur.deliverables, Math.max(...delVals)) : cur.deliverables;
        cur.allocated = aVals.length ? maxOrKeep(cur.allocated, Math.max(...aVals)) : cur.allocated;
        cur.consumed = cVals.length ? maxOrKeep(cur.consumed, Math.max(...cVals)) : cur.consumed;
        cur.stagePP = ppVals.length ? maxOrKeep(cur.stagePP, Math.max(...ppVals)) : cur.stagePP;
        if(stVals.length && !cur.stageStatusRaw) cur.stageStatusRaw = stVals[0];
      }
    }

    // Build view models (with alerts)
    const view = STAGES.map(label => {
      const v = stageMap.get(label);
      const rawStatus = v.stageStatusRaw;
      const pp = (v.stagePP == null) ? null : clamp(Number(v.stagePP), 0, 100);
      const isComplete = (pp != null && pp >= 100) || stageStatusComplete(rawStatus);
      const effectiveEnd = (v.extEnd && v.end && v.extEnd > v.end) ? v.extEnd : (v.extEnd || v.end);

      let alert = { kind:"", text:"/" };
      if(isComplete) alert = { kind:"ok", text:"Complete" };
      else if(effectiveEnd && today > effectiveEnd) alert = { kind:"bad", text:"Missed" };
      else if(effectiveEnd && daysBetween(today, effectiveEnd) <= 14) alert = { kind:"warn", text:"Due" };
      else alert = { kind:"", text:"On track" };

      return {
        label,
        discipline: guessDiscipline(label),
        start: v.start,
        end: v.end,
        extEnd: v.extEnd,
        deliverables: v.deliverables,
        allocated: v.allocated,
        consumed: v.consumed,
        stagePP: (isComplete && pp == null) ? 100 : pp,
        status: stageStatusText(rawStatus, pp),
        alert,
        _complete: isComplete
      };
    });

    return view;
  }

  function guessDiscipline(stage){
    const s = String(stage || "").toUpperCase();
    // keep same mapping style as before; safe fallback to Architecture
    const interior = new Set(["CD3","SD3","DD3","TD4","WD100"]);
    const landscape = new Set(["CD4","SD4","DD4","TD5","WD80"]);
    if(interior.has(s)) return "Interior";
    if(landscape.has(s)) return "Landscape";
    return "Architecture";
  }

  function daysBetween(a,b){ return Math.round((b-a)/86400000); }

  function computeProjectPP(rows){
    const pps = rows.map(r => toPercentOrNull(pick(r, PROJECT_FIELDS.progress))).filter(v => v != null);
    if(!pps.length) return null;
    return clamp(Math.max(...pps), 0, 100);
  }

  function computeProjectHours(rows){
    const AH = maxNonNull(rows.map(r => toNumberOrNull(pick(r, PROJECT_FIELDS.allottedHours))));
    const TCH = maxNonNull(rows.map(r => toNumberOrNull(pick(r, PROJECT_FIELDS.consumedHours))));
    const BHraw = maxNonNull(rows.map(r => toNumberOrNull(pick(r, PROJECT_FIELDS.balanceHours))));
    let BH = BHraw;
    if(BH == null && AH != null && TCH != null) BH = AH - TCH;
    return { AH, TCH, BH };
  }

  // Parse deployment values of form "Name(10%), Other(5%)"
  function parseDeploymentCell(v){
    if(isNoData(v)) return [];
    const s = String(v || "").trim();
    if(!s) return [];
    return s.split(",")
      .map(p => p.trim())
      .filter(Boolean)
      .map(part => {
        const m = part.match(/^(.*?)\s*\(\s*([0-9]+(?:\.[0-9]+)?)\s*%?\s*\)\s*$/);
        if(m) return { name: (m[1].trim() || "(Blank)"), pct: Number(m[2]) };
        return { name: part, pct: 0 };
      });
  }

  function computeDeploymentPeople(rows){
    const dyt = firstNonNull(rows.map(r => {
      const v = pick(r, PROJECT_FIELDS.deployment);
      return isNoData(v) ? null : String(v).trim();
    }));
    if(!dyt) return [];
    const m = new Map();
    for(const item of parseDeploymentCell(dyt)){
      const name = String(item.name || "").trim() || "(Blank)";
      const pct = Number.isFinite(item.pct) ? item.pct : 0;
      if(pct <= 0) continue;
      m.set(name, (m.get(name) || 0) + pct);
    }
    return Array.from(m.entries())
      .map(([name,pct]) => ({ name, pct }))
      .sort((a,b) => b.pct - a.pct);
  }

  function computeRunwayFromPeopleAndBH(people, BH){
    const factorDecimal = (people || []).reduce((s,p) => s + (Number(p.pct || 0) / 100), 0);
    const monthlyBurn = factorDecimal * 174.25;
    if(!Number.isFinite(monthlyBurn) || monthlyBurn <= 0) return { runwayMonths: null, runwayDate: null, factorDecimal, monthlyBurn };
    if(BH == null || !Number.isFinite(Number(BH)) || Number(BH) <= 0) return { runwayMonths: 0, runwayDate: null, factorDecimal, monthlyBurn };
    const runwayMonths = Number(BH) / monthlyBurn;
    if(!Number.isFinite(runwayMonths) || runwayMonths <= 0) return { runwayMonths: 0, runwayDate: null, factorDecimal, monthlyBurn };
    const now = new Date();
    const days = runwayMonths * 30.4375;
    const runwayDate = new Date(now.getTime() + days * 86400000);
    return { runwayMonths, runwayDate, factorDecimal, monthlyBurn };
  }

  function classifyProjectStatus(ps){
    const s = String(ps || "").trim().toLowerCase();
    if(!s) return "unknown";
    if(s.includes("hold")) return "onhold";
    if(s.includes("active") || s.includes("inprogress") || s.includes("ongoing")) return "active";
    return "other";
  }

  // ------------------------------
  // Grouping + card computation
  // ------------------------------
  function projectGroup(rows){
    const map = new Map();
    for(const r of rows){
      const pc = String(pick(r, PROJECT_FIELDS.projectCode) || "").trim();
      if(!pc) continue;
      if(!map.has(pc)) map.set(pc, []);
      map.get(pc).push(r);
    }
    return map;
  }

  function computeProjectCard(pc, rowsForProject, typeCols, stageCols){
    const name = firstNonNull(rowsForProject.map(r=>{
      const v = pick(r, PROJECT_FIELDS.projectName);
      return isNoData(v) ? null : String(v).trim();
    })) || "";

    const ps = firstNonNull(rowsForProject.map(r=>{
      const v = pick(r, PROJECT_FIELDS.ps);
      return isNoData(v) ? null : String(v).trim();
    })) || "";

    // Teams (merge unique values)
    const teamEntries = [];
    for(const r of rowsForProject){
      for(const entry of teamSummaryFromRow(r, typeCols)){
        const key = entry.type + "|" + entry.name;
        if(!teamEntries.some(x => x.key === key)) teamEntries.push({ ...entry, key });
      }
    }
    const teams = TEAM_TYPES.map(type=>{
      const hit = teamEntries.find(e => e.type === type);
      return { type, name: hit ? hit.name : "" };
    });

    const today = new Date();
    const stages = buildStagesFromProjectRowsWide(rowsForProject, today, stageCols);

    const hasStageData = (s)=> !!(s.start || s.end || s.extEnd || s.deliverables != null || s.allocated != null || s.consumed != null || s.stagePP != null || (s.status && s.status !== "/"));
    const effectiveEnd = (s)=>{
      if(s.extEnd instanceof Date && s.end instanceof Date && !isNaN(s.extEnd) && !isNaN(s.end) && s.extEnd > s.end) return s.extEnd;
      return s.extEnd || s.end || null;
    };

    const missed = stages.filter(s=>{
      if(!hasStageData(s)) return false;
      if(s._complete) return false;
      const e = effectiveEnd(s);
      if(!e) return false;
      return today > e;
    });

    const current = stages.find(s=>{
      if(!hasStageData(s)) return false;
      return !s._complete;
    }) || stages.slice().reverse().find(hasStageData) || null;

    const projectPP = computeProjectPP(rowsForProject);

    return {
      pc,
      name,
      ps,
      statusClass: classifyProjectStatus(ps),
      teams,
      projectPP,
      currentStage: current ? current.label : "",
      missedStages: missed.map(s => s.label),
      missedCount: missed.length
    };
  }

  // ------------------------------
  // UI: Landing + Dashboard modules
  // ------------------------------
  const landing = landingMount ? initLanding(landingMount, {
    onSelectProject: (pc)=>{
      const base = new URL("./dashboard.html", location.href);
      base.searchParams.set("project", pc);
      location.href = base.toString();
    }
  }) : null;

  const gantt = (ganttMount && metricsMount) ? initGantt(ganttMount, {
    fmtWindow: (a,b)=>{
      const mm = (d)=> String(d.getMonth()+1).padStart(2,"0") + "/" + d.getFullYear();
      return `${mm(a)} → ${mm(b)}`;
    }
  }) : null;

  const metrics = (ganttMount && metricsMount) ? initMetrics(metricsMount, {
    onRunwaySimulated: (sim)=> gantt?.setRunway(sim?.runwayDate || null)
  }) : null;

  // ------------------------------
  // State
  // ------------------------------
  let allRows = [];
  let typeCols = null;
  let stageCols = null;
  let allCards = [];

  let activeTeamType = "";          // "" | Architecture | Interior | Landscape
  let activeProjectFilter = "all";  // all | active | onhold

  // ------------------------------
  // Render helpers
  // ------------------------------
  function buildCards(){
    const groups = projectGroup(allRows);
    const cards = [];
    for(const [pc, rowsForProject] of groups.entries()){
      cards.push(computeProjectCard(pc, rowsForProject, typeCols, stageCols));
    }
    // missed first, then on-track; within group sort by pc
    cards.sort((a,b)=>{
      const am = a.missedCount ? 0 : 1;
      const bm = b.missedCount ? 0 : 1;
      if(am !== bm) return am - bm;
      return a.pc.localeCompare(b.pc, undefined, { numeric:true, sensitivity:"base" });
    });
    allCards = cards;
  }

  function filteredCards(){
    const q = String(elSearch?.value || "").trim().toLowerCase();
    return allCards.filter(c => {
      if(activeTeamType){
        const t = c.teams.find(x => x.type === activeTeamType);
        if(!t || !String(t.name || "").trim()) return false;
      }
      if(activeProjectFilter === "active" && c.statusClass !== "active") return false;
      if(activeProjectFilter === "onhold" && c.statusClass !== "onhold") return false;

      if(q){
        const hay = `${c.pc} ${c.name} ${c.ps} ${c.currentStage} ${c.missedStages.join(" ")}`.toLowerCase();
        if(!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function renderTeamRadios(){
    if(!elTeamRadios) return;
    const items = [
      { value:"", label:"All" },
      { value:"Architecture", label:"Architecture" },
      { value:"Interior", label:"Interior" },
      { value:"Landscape", label:"Landscape" },
    ];
    elTeamRadios.innerHTML = "";
    for(const it of items){
      const b = document.createElement("button");
      b.type = "button";
      b.className = "radioBtn" + ((it.value === activeTeamType) ? " active" : "");
      b.textContent = it.label;
      b.dataset.value = it.value;
      b.onclick = ()=>{
        activeTeamType = it.value;
        for(const btn of elTeamRadios.querySelectorAll(".radioBtn")){
          btn.classList.toggle("active", btn.dataset.value === activeTeamType);
        }
        renderLanding();
      };
      elTeamRadios.appendChild(b);
    }
  }

  function renderProjectStatusRadios(){
    if(!elProjectStatusRadios) return;
    const items = [
      { value:"all", label:"All" },
      { value:"active", label:"Active" },
      { value:"onhold", label:"On hold" },
    ];
    elProjectStatusRadios.innerHTML = "";
    for(const it of items){
      const b = document.createElement("button");
      b.type = "button";
      b.className = "radioBtn" + ((it.value === activeProjectFilter) ? " active" : "");
      b.textContent = it.label;
      b.dataset.value = it.value;
      b.onclick = ()=>{
        activeProjectFilter = it.value;
        for(const btn of elProjectStatusRadios.querySelectorAll(".radioBtn")){
          btn.classList.toggle("active", btn.dataset.value === activeProjectFilter);
        }
        renderLanding();
      };
      elProjectStatusRadios.appendChild(b);
    }
  }

  function renderProjectDropdown(){
    if(!elProjectSelect) return;
    const selected = elProjectSelect.value;
    elProjectSelect.innerHTML = `<option value="">Select project…</option>`;
    for(const c of allCards){
      const opt = document.createElement("option");
      opt.value = c.pc;
      opt.textContent = c.name ? `${c.pc} — ${c.name}` : c.pc;
      elProjectSelect.appendChild(opt);
    }
    if(selected) elProjectSelect.value = selected;
  }

  function renderLanding(){
    if(!landing) return;
    const cards = filteredCards();
    landing.setData({
      title: "Projects",
      subtitle: `${cards.length} projects`,
      projects: cards
    });
  }

  function getProjectFromUrl(){
    const u = new URL(location.href);
    const v = String(u.searchParams.get("project") || "").trim();
    return v;
  }

  function renderDashboard(){
    if(!gantt || !metrics) return;
    const pcFromUrl = getProjectFromUrl();
    const groups = projectGroup(allRows);
    const projectCode = (pcFromUrl && groups.has(pcFromUrl)) ? pcFromUrl : (groups.keys().next().value || "");
    const rowsForProject = projectCode ? groups.get(projectCode) : [];

    const name = projectCode ? (firstNonNull(rowsForProject.map(r=>{
      const v = pick(r, PROJECT_FIELDS.projectName);
      return isNoData(v) ? null : String(v).trim();
    })) || "") : "";

    const title = projectCode ? (name ? `${projectCode} — ${name}` : projectCode) : "No project found";

    const today = new Date();
    const stages = projectCode ? buildStagesFromProjectRowsWide(rowsForProject, today, stageCols) : [];
    const projectPP = projectCode ? computeProjectPP(rowsForProject) : null;

    const hours = projectCode ? computeProjectHours(rowsForProject) : { AH:null, TCH:null, BH:null };
    const people = projectCode ? computeDeploymentPeople(rowsForProject) : [];
    const runway = computeRunwayFromPeopleAndBH(people, hours.BH);

    gantt.setData({ title, projectPP, stages, runwayDate: runway.runwayDate || null });
    metrics.setData({ title, hours, people, runway });
  }

  // ------------------------------
  // Data loading
  // ------------------------------
  async function normalizeData(parsed){
    const headers = parsed.headers || [];
    const objects = parsed.objects || [];
    const headerIndex = buildHeaderIndex(headers);

    const rows = objects.map(o => ({ ...o, __keyMap: headerIndex }));
    const tCols = discoverTeamTypeColumns(headers);
    const sCols = resolveStageColumns(headers);

    return { headers, rows, typeCols: tCols, stageCols: sCols };
  }

  async function loadData(){
    // 1) sessionStorage
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if(saved){
      try{
        const parsed = JSON.parse(saved);
        if(parsed && parsed.headers && parsed.objects){
          return await normalizeData(parsed);
        }
      } catch { /* ignore */ }
    }

    // 2) fetch sheetjs.csv
    try{
      const res = await fetch(DEFAULT_CSV_URL.toString(), { cache:"no-store" });
      if(!res.ok) throw new Error(`Failed to fetch sheetjs.csv (${res.status})`);
      const text = await res.text();
      const parsed = await importCsvText(text);
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      return await normalizeData(parsed);
    } catch (e){
      console.warn("No default data loaded:", e);
      return null;
    }
  }

  async function loadFromFile(file){
    let parsed;
    const name = String(file?.name || "").toLowerCase();
    if(name.endsWith(".xlsx") || name.endsWith(".xls")) parsed = await importXlsxFile(file);
    else parsed = await importCsvText(await file.text());
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    return await normalizeData(parsed);
  }

  // ------------------------------
  // Events
  // ------------------------------
  if(elUploadBtn && elFile){
    elUploadBtn.addEventListener("click", ()=> elFile.click());
  }
  if(elFile){
    elFile.addEventListener("change", async ()=>{
      const f = elFile.files?.[0];
      if(!f) return;
      try{
        const norm = await loadFromFile(f);
        allRows = norm.rows;
        typeCols = norm.typeCols;
        stageCols = norm.stageCols;
        buildCards();
        if(mode === "landing"){
          renderProjectDropdown();
          renderLanding();
        } else {
          renderDashboard();
        }
      } catch (err){
        console.error(err);
        alert(`Upload failed: ${err?.message || err}`);
      }
    });
  }

  if(elSearch){
    elSearch.addEventListener("input", ()=> renderLanding());
  }

  if(elProjectSelect){
    elProjectSelect.addEventListener("change", ()=>{
      const pc = String(elProjectSelect.value || "").trim();
      if(!pc) return;
      const base = new URL("./dashboard.html", location.href);
      base.searchParams.set("project", pc);
      location.href = base.toString();
    });
  }

  // ------------------------------
  // Boot
  // ------------------------------
  (async ()=>{
    const norm = await loadData();
    if(!norm){
      if(landing){
        renderTeamRadios();
        renderProjectStatusRadios();
        landing.setData({ title:"Projects", subtitle:"0 projects", projects:[] });
      }
      if(gantt) gantt.setData({ title:"No data", projectPP:null, stages:[], runwayDate:null });
      if(metrics) metrics.setData({ title:"", hours:{AH:null,TCH:null,BH:null}, people:[], runway:null });
      return;
    }

    allRows = norm.rows;
    typeCols = norm.typeCols;
    stageCols = norm.stageCols;

    buildCards();

    if(mode === "landing"){
      renderTeamRadios();
      renderProjectStatusRadios();
      renderProjectDropdown();
      renderLanding();
    } else {
      renderDashboard();
    }
  })();

  // ------------------------------
  // Logo resolver
  // ------------------------------
  function initLogo(){
    const logos = Array.from(document.querySelectorAll("img[data-logo]"));
    if(!logos.length) return;

    const candidates = [
      "./LOGO.png",
      "./LOGO.PNG",
      "./LOGO.jpg",
      "./LOGO.jpeg",
      "./LOGO",
      "./CONFLUENCE NEW LOGO 3.png",
    ];

    const tryLoad = (src)=> new Promise((resolve)=>{
      const img = new Image();
      img.onload = ()=> resolve(src);
      img.onerror = ()=> resolve(null);
      img.src = src;
    });

    (async ()=>{
      let ok = null;
      for(const c of candidates){
        // eslint-disable-next-line no-await-in-loop
        const found = await tryLoad(c);
        if(found){ ok = found; break; }
      }
      if(!ok){
        logos.forEach(el => { el.style.display = "none"; });
        return;
      }
      logos.forEach(el => { el.src = ok; el.style.display = "block"; });
    })();
  }
}

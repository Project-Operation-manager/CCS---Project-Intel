import { initLanding } from "./modules/landing.module.js";
import { initGantt } from "./modules/gantt.module.js";
import { initMetrics } from "./modules/metrics.module.js";

window.addEventListener("DOMContentLoaded", () => startApp());

function startApp(){
  const landingMount = document.getElementById("landingMount");
  const ganttMount = document.getElementById("ganttMount");
  const metricsMount = document.getElementById("metricsMount");

  const mode =
    (ganttMount && metricsMount) ? "dashboard" :
    (landingMount ? "landing" : "dashboard");

  const elFile = document.getElementById("file");
  const elUploadBtn = document.getElementById("uploadBtn");
  const elSearch = document.getElementById("search");
  const elTeamRadios = document.getElementById("teamRadios");
  const elProjectSelect = document.getElementById("projectSelect");
  const elProjectStatusRadios = document.getElementById("projectStatusRadios");

  const DEFAULT_CSV_URL = new URL("./sheetjs.csv", import.meta.url);
  const STORAGE_KEY = "project_intel_data_v1";

  // ✅ robust logo loader (fixes 404 by trying variants)
  function initLogo(){
    const imgs = Array.from(document.querySelectorAll("img[data-logo]"));
    if(!imgs.length) return;

    // Try common places + common casing + common extensions
    // (keep this list; it will "just work" even if you rename again)
    const candidates = [
      "./LOGO.png",
      "./LOGO.PNG",
      "./logo.png",
      "./logo.PNG",
      "./LOGO",
      "./logo",
      "./assets/LOGO.png",
      "./assets/LOGO.PNG",
      "./assets/logo.png",
      "./assets/logo.png",
      "./images/LOGO.png",
      "./images/LOGO.PNG",
      "./images/logo.png",
      "./img/LOGO.png",
      "./img/logo.png"
    ];

    for(const img of imgs){
      let idx = 0;

      const onError = () => {
        idx += 1;
        if(idx >= candidates.length){
          img.style.display = "none"; // hide if nothing exists
          img.removeEventListener("error", onError);
          return;
        }
        img.src = candidates[idx];
      };

      img.addEventListener("error", onError);

      // start with first candidate
      img.src = candidates[0];
    }
  }

  initLogo();

  // ✅ status UI disabled completely
  function setStatus(){}

  const STAGES = [
    "CD1","CD2","CD3","CD4","CD5",
    "SD1","SD2","SD3","SD4",
    "MC","AD",
    "DD1","DD2","DD3","DD4",
    "TD1","TD2","TD3","TD4","TD5",
    "WD20","WD40","WD60","WD80","WD100",
    "DC","CO"
  ];

  const DISCIPLINE = {
    Architecture: new Set(["CD1","CD2","CD5","SD1","SD2","AD","DD1","DD2","TD1","TD2","TD3","WD20","WD40","WD60"]),
    Interior:     new Set(["CD3","SD3","DD3","TD4","WD100"]),
    Landscape:    new Set(["CD4","SD4","DD4","TD5","WD80"])
  };

  const TEAM_TYPES_FIXED = ["Architecture","Interior","Landscape"];

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

  function pick(row, candidates){
    const map = row.__keyMap || {};
    for(const c of candidates){
      const nk = normalizeKey(c);
      if(map[nk] !== undefined) return row[map[nk]];
    }
    return "";
  }

  function uniq(arr){ return Array.from(new Set(arr)); }

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

  function isFalsyFlag(raw){
    const low = String(raw || "").trim().toLowerCase();
    if(!low) return true;
    return ["n","no","false","f","0","na","n/a","-","no data","nodata","nan","not in scope","notinscope"].includes(low);
  }

  function looksLikeName(raw){
    return /[a-zA-Z]/.test(String(raw || ""));
  }

  function toNumberOrNull(v){
    if(isNoData(v)) return null;
    if(typeof v === "number" && Number.isFinite(v)) return v;
    const s = String(v).trim();
    const cleaned = s.replace(/,/g, "").replace(/[^0-9.\-]/g, "");
    if(!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  function toPercentOrNull(v){
    if(isNoData(v)) return null;
    if(typeof v === "number" && Number.isFinite(v)){
      if(v > 0 && v <= 1) return v * 100;
      return v;
    }
    const s = String(v).trim();
    const hasPct = s.includes("%");
    const n = toNumberOrNull(s);
    if(n == null) return null;
    if(hasPct) return n;
    if(n > 0 && n <= 1) return n * 100;
    return n;
  }

  function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }

  function getProjectFromUrl(){
    try{
      const u = new URL(location.href);
      return u.searchParams.get("project") || u.searchParams.get("pc") || u.searchParams.get("code") || "";
    } catch {
      return "";
    }
  }

  // ✅ Project Status classification (Active / On hold)
  function classifyProjectStatus(psRaw){
    const s = String(psRaw || "").trim().toLowerCase();
    if(!s) return "active";
    if(s.includes("hold") || s.includes("onhold") || s.includes("on hold") || s.includes("paused")) return "onhold";
    return "active";
  }

  // -------------------- DATA LOADING --------------------
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
        else if(ch === "\r"){ }
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

  function serializeForStorage(headers, objects){
    return JSON.stringify({ headers, objects });
  }

  function deserializeFromStorage(s){
    const parsed = JSON.parse(s);
    if(!parsed || !Array.isArray(parsed.headers) || !Array.isArray(parsed.objects)) return null;
    return parsed;
  }

  function discoverTeamTypeColumns(headers){
    const normHeaders = headers.map(h => ({ raw:h, n:normalizeKey(h) }));
    function firstMatch(predicate){
      const hit = normHeaders.find(predicate);
      return hit ? hit.raw : null;
    }
    return {
      Architecture: firstMatch(h => h.n === "architecture" || h.n.includes("architecture") || h.n === "arch"),
      Interior: firstMatch(h => h.n === "interior" || h.n.includes("interior")),
      Landscape: firstMatch(h => h.n === "landscape" || h.n.includes("landscape") || h.n.includes("landacpe") || h.n === "landacpe")
    };
  }

  function deriveTeamInfo(row, typeCols){
    for(const type of TEAM_TYPES_FIXED){
      const col = typeCols?.[type];
      if(!col) continue;
      const raw = String(row[col] ?? "").trim();
      if(isFalsyFlag(raw)) continue;
      if(!raw) continue;
      if(!looksLikeName(raw)) return { teamType:type, team:"" };
      return { teamType:type, team: raw };
    }
    return { teamType:"", team:"" };
  }

  function normalizeRows(headers, objects){
    const keyMap = buildHeaderIndex(headers);
    const typeCols = discoverTeamTypeColumns(headers);

    const rows = objects.map(o=>{
      const row = { ...o, __keyMap: keyMap };
      const info = deriveTeamInfo(row, typeCols);
      row.__teamType = info.teamType || "";
      row.__team = info.team || "";
      return row;
    });

    return { rows, typeCols };
  }

  async function importCsvText(text){
    const delim = detectDelimiter(text);
    const matrix = parseDelimited(text, delim);
    const { headers, objects } = matrixToObjects(matrix);
    sessionStorage.setItem(STORAGE_KEY, serializeForStorage(headers, objects));
    return normalizeRows(headers, objects);
  }

  async function importXlsxFile(file){
    if(typeof XLSX === "undefined") throw new Error("XLSX library not loaded (check network).");
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type:"array", cellDates:true });
    if(!workbook.SheetNames?.length) throw new Error("No sheets found.");
    const ws = workbook.Sheets[workbook.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json(ws, { header:1, defval:"", raw:false });
    const { headers, objects } = matrixToObjects(matrix);
    sessionStorage.setItem(STORAGE_KEY, serializeForStorage(headers, objects));
    return normalizeRows(headers, objects);
  }

  async function loadDefaultFromRepo(){
    if(location.protocol === "file:") return null;
    const res = await fetch(DEFAULT_CSV_URL.toString(), { cache:"no-store" });
    if(!res.ok) throw new Error(`sheetjs.csv fetch failed: HTTP ${res.status}`);
    const text = await res.text();
    return importCsvText(text);
  }

  async function loadData(){
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if(stored){
      try{
        const parsed = deserializeFromStorage(stored);
        if(parsed) return normalizeRows(parsed.headers, parsed.objects);
      } catch {}
    }
    try{
      return await loadDefaultFromRepo();
    } catch {
      return null;
    }
  }

  // -------------------- UI INIT --------------------
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

  let allRows = [];
  let typeCols = null;

  let activeTeam = "";               // "" = All teams
  let searchQuery = "";
  let projectStatusFilter = "all";   // all | active | onhold

  function getTeamsAll(){
    const teams = allRows.map(r => String(r.__team || "").trim()).filter(Boolean);
    return uniq(teams).sort((a,b)=>a.localeCompare(b));
  }

  function renderTeamRadios(){
    if(!elTeamRadios) return;
    const teams = getTeamsAll();
    const list = ["", ...teams];

    elTeamRadios.innerHTML = "";
    for(const v of list){
      const b = document.createElement("button");
      b.type = "button";
      b.className = "radioBtn" + ((v === activeTeam) ? " active" : "");
      b.textContent = v ? v : "All";
      b.dataset.value = v;
      b.onclick = ()=>{
        activeTeam = v;
        for(const btn of elTeamRadios.querySelectorAll(".radioBtn")){
          btn.classList.toggle("active", btn.dataset.value === activeTeam);
        }
        renderLanding();
      };
      elTeamRadios.appendChild(b);
    }
  }

  function renderProjectStatusRadios(){
    if(!elProjectStatusRadios) return;

    const options = [
      { value: "all", label: "All" },
      { value: "active", label: "Active" },
      { value: "onhold", label: "On hold" },
    ];

    elProjectStatusRadios.innerHTML = "";
    for(const opt of options){
      const b = document.createElement("button");
      b.type = "button";
      b.className = "radioBtn" + ((opt.value === projectStatusFilter) ? " active" : "");
      b.textContent = opt.label;
      b.dataset.value = opt.value;
      b.onclick = ()=>{
        projectStatusFilter = opt.value;
        for(const btn of elProjectStatusRadios.querySelectorAll(".radioBtn")){
          btn.classList.toggle("active", btn.dataset.value === projectStatusFilter);
        }
        renderLanding();
      };
      elProjectStatusRadios.appendChild(b);
    }
  }

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

  function firstNonNull(vals){
    for(const v of vals) if(v != null) return v;
    return null;
  }

  function computeProjectPP(rows){
    const pps = rows.map(r => toPercentOrNull(pick(r, PROJECT_FIELDS.progress))).filter(v => v != null);
    if(!pps.length) return null;
    return clamp(Math.max(...pps), 0, 100);
  }

  function computeProjectCard(pc, rowsForProject){
    const name = firstNonNull(rowsForProject.map(r=>{
      const v = pick(r, PROJECT_FIELDS.projectName);
      return isNoData(v) ? null : String(v).trim();
    })) || "";

    const ps = firstNonNull(rowsForProject.map(r=>{
      const v = pick(r, PROJECT_FIELDS.ps);
      return isNoData(v) ? null : String(v).trim();
    })) || "";

    // keep teams summary minimal here; landing.module handles display
    const teams = TEAM_TYPES_FIXED.map(type => ({ type, name: "" }));

    // missed/current handled inside landing.module in your project tiles logic
    const projectPP = computeProjectPP(rowsForProject);

    return {
      pc,
      name,
      ps,
      psClass: classifyProjectStatus(ps),
      teams,
      projectPP,
      currentStage: "",
      missedStages: [],
      missedCount: 0
    };
  }

  function renderProjectDropdown(cards){
    if(!elProjectSelect) return;
    const current = elProjectSelect.value || "";
    elProjectSelect.innerHTML = `<option value="">Select project…</option>`;
    for(const c of cards){
      const opt = document.createElement("option");
      opt.value = c.pc;
      opt.textContent = c.name ? `${c.pc} — ${c.name}` : c.pc;
      elProjectSelect.appendChild(opt);
    }
    if(current && cards.some(c => c.pc === current)) elProjectSelect.value = current;
  }

  function renderLanding(){
    if(!landing) return;

    const q = (elSearch ? elSearch.value : searchQuery || "").trim().toLowerCase();
    searchQuery = q;

    const groups = projectGroup(allRows);
    let cards = [];
    for(const [pc, rowsForProject] of groups.entries()){
      const card = computeProjectCard(pc, rowsForProject);

      if(projectStatusFilter !== "all" && card.psClass !== projectStatusFilter) continue;

      if(activeTeam){
        // fallback simple filter: check any row team matches
        const anyTeamMatch = rowsForProject.some(r => String(r.__team || "").trim().toLowerCase() === activeTeam.trim().toLowerCase());
        if(!anyTeamMatch) continue;
      }

      const hay = `${card.pc} ${card.name} ${card.ps}`.toLowerCase();
      if(q && !hay.includes(q)) continue;

      cards.push(card);
    }

    renderProjectDropdown(cards);
    landing.setData({ title:"Projects", subtitle:"", projects: cards });
  }

  function renderDashboard(){
    if(!gantt || !metrics) return;

    const pc = getProjectFromUrl();
    const groups = projectGroup(allRows);
    const projectCode = pc && groups.has(pc) ? pc : (groups.keys().next().value || "");
    const rowsForProject = projectCode ? groups.get(projectCode) : [];

    const name = projectCode ? (firstNonNull(rowsForProject.map(r=>{
      const v = pick(r, PROJECT_FIELDS.projectName);
      return isNoData(v) ? null : String(v).trim();
    })) || "") : "";

    const title = projectCode ? (name ? `${projectCode} — ${name}` : projectCode) : "No project found";

    gantt.setData({ title, projectPP: null, stages: [], runwayDate: null });
    metrics.setData({ title, hours:{AH:null,TCH:null,BH:null}, people:[], runway:null });
  }

  // Upload triggers local file picker
  if(elUploadBtn && elFile){
    elUploadBtn.addEventListener("click", ()=> elFile.click());
  }

  if(elSearch){
    elSearch.addEventListener("input", ()=>{
      if(mode === "landing") renderLanding();
    });
  }

  if(elProjectSelect){
    elProjectSelect.addEventListener("change", ()=>{
      const pc = String(elProjectSelect.value || "").trim();
      if(pc){
        const base = new URL("./dashboard.html", location.href);
        base.searchParams.set("project", pc);
        location.href = base.toString();
      }
    });
  }

  if(elFile){
    elFile.addEventListener("change", async ()=>{
      const f = elFile.files?.[0];
      if(!f) return;

      try{
        let norm = null;
        const name = String(f.name || "").toLowerCase();
        if(name.endsWith(".xlsx") || name.endsWith(".xls")){
          norm = await importXlsxFile(f);
        } else {
          const text = await f.text();
          norm = await importCsvText(text);
        }

        allRows = norm.rows;
        typeCols = norm.typeCols;

        if(mode === "landing"){
          renderProjectStatusRadios();
          renderTeamRadios();
          renderLanding();
        } else {
          renderDashboard();
        }
      } catch (err){
        console.error(err);
        setStatus("Upload failed");
      } finally {
        elFile.value = "";
      }
    });
  }

  (async ()=>{
    const norm = await loadData();
    if(!norm){
      if(landing) landing.setData({ title:"Projects", subtitle:"", projects:[] });
      if(gantt) gantt.setData({ title:"No data", projectPP:null, stages:[], runwayDate:null });
      if(metrics) metrics.setData({ title:"", hours:{AH:null,TCH:null,BH:null}, people:[], runway:null });
      return;
    }

    allRows = norm.rows;
    typeCols = norm.typeCols;

    if(mode === "landing"){
      renderProjectStatusRadios();
      renderTeamRadios();
      renderLanding();
    } else {
      renderDashboard();
    }
  })();
}

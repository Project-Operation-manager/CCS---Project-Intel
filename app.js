import { initGantt } from "./modules/gantt.module.js";
import { initMetrics } from "./modules/metrics.module.js";
import { initLanding } from "./modules/landing.module.js";

window.addEventListener("DOMContentLoaded", () => startApp());

function startApp(){
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

  // Discipline mapping
  const DISCIPLINE = {
    Architecture: new Set(["CD1","CD2","CD5","SD1","SD2","AD","DD1","DD2","TD1","TD2","TD3","WD20","WD40","WD60"]),
    Interior:     new Set(["CD3","SD3","DD3","TD4","WD100"]),
    Landscape:    new Set(["CD4","SD4","DD4","TD5","WD80"])
  };

  const FIELDS = {
    projectCode:   ["PC","Project Code","ProjectCode","Code"],
    projectName:   ["Project Name","Project","Name","ProjectName"],
    teamName:      ["Team","Team Name","TeamName","TEAM","Team/Name","Team_Name","Team - Name"],

    allottedHours: ["AH","Allotted hours","Allotted Hours","Allotted","Allocated hours","Allocated Hours"],
    consumedHours: ["TCH","Total consumed hours","Total Consumed Hours","Consumed hours","Consumed Hours","Consumed"],
    balanceHours:  ["BH","Balanced hours","Balance hours","Balance Hours","Balance"],

    deployment:    ["DYT","Deployment","Deployement","Deployement "],
    progress:      ["PP","Project progress","Project progess","Progress"],
  };

  // ---- helpers
  function normalizeKey(k){
    return String(k||"").replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[\s_-]+/g,"");
  }
  function buildHeaderIndex(headers){
    const idx={}; for(const h of headers) idx[normalizeKey(h)] = h; return idx;
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

  function toNumber(v){
    if(v==null) return 0;
    if(typeof v === "number" && Number.isFinite(v)) return v;
    const s=String(v).trim(); if(!s) return 0;
    const cleaned=s.replace(/,/g,"").replace(/[^0-9.\-]/g,"");
    const n=Number(cleaned);
    return Number.isFinite(n)?n:0;
  }
  function toPercent(v){
    if(v==null) return 0;
    if(typeof v === "number" && Number.isFinite(v)){
      if(v > 0 && v <= 1) return v * 100;
      return v;
    }
    const s = String(v).trim();
    if(!s) return 0;
    const hasPct = s.includes("%");
    const n = toNumber(s);
    if(!Number.isFinite(n)) return 0;
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
    if(!s) return null;

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

  function isNumericLike(s){
    const t = String(s||"").trim();
    if(!t) return false;
    return /^-?\d+(\.\d+)?$/.test(t);
  }
  function isTruthyFlag(raw){
    const low = String(raw||"").trim().toLowerCase();
    if(!low) return false;
    if(["y","yes","true","t","1"].includes(low)) return true;
    if(isNumericLike(low)) return Number(low) > 0;
    return false;
  }
  function isFalsyFlag(raw){
    const low = String(raw||"").trim().toLowerCase();
    if(!low) return false;
    if(["n","no","false","f","0","na","n/a","-"].includes(low)) return true;
    if(isNumericLike(low)) return Number(low) <= 0;
    return false;
  }
  function looksLikeName(raw){
    return /[a-zA-Z]/.test(String(raw||""));
  }

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

  function deriveTeamInfo(row, typeCols){
    const fallbackTeam = String(pick(row, FIELDS.teamName) || "").trim();

    for(const type of TEAM_TYPES_FIXED){
      const col = typeCols?.[type];
      if(!col) continue;

      const raw = String(row[col] ?? "").trim();
      if(!raw) continue;
      if(isFalsyFlag(raw)) continue;

      if(isTruthyFlag(raw) || !looksLikeName(raw)){
        return { teamType:type, team: fallbackTeam || "" };
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

  // Deployment parsing: keep ABSOLUTE percentages exactly as written
  function parseDeploymentCell(v){
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

  function disciplineForStage(stage){
    if(DISCIPLINE.Architecture.has(stage)) return "Architecture";
    if(DISCIPLINE.Interior.has(stage)) return "Interior";
    if(DISCIPLINE.Landscape.has(stage)) return "Landscape";
    return "Architecture";
  }

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
      status: [
        `${stageCode} Stage Status`, `${stageCode} Status`,
        `${stageCode} Ext Stage Status`, `${stageCode} External Stage Status`,
        `${stageCode} Completion`
      ],
      delDone: [
        `${stageCode} Deliverables Done`, `${stageCode} Done Deliverables`, `${stageCode} Sent Deliverables`,
        `${stageCode} Deliverables Sent`
      ],
      delRemain: [
        `${stageCode} Deliverables Remaining`, `${stageCode} Remaining Deliverables`, `${stageCode} Pending Deliverables`
      ],
      delRatio: [
        `${stageCode} Deliverables`, `${stageCode} Deliverable`
      ],
      stagePP: [
        `${stageCode} PP`, `${stageCode} Progress`, `${stageCode} Stage Progress`, `${stageCode} Stage PP`
      ]
    };
  }

  function isStageComplete(statusText){
    const s = String(statusText || "").trim().toLowerCase();
    return s.includes("complete") || s === "done" || s === "completed";
  }

  function collectStageStatusValues(row, stageCode){
    const sc = normalizeKey(stageCode);
    const vals = [];

    const explicit = pick(row, stageSchema(stageCode).status);
    if(String(explicit||"").trim()) vals.push(String(explicit).trim());

    for(const k of Object.keys(row)){
      if(k === "__keyMap") continue;
      const nk = normalizeKey(k);
      if(!nk.includes(sc)) continue;
      if(!(nk.includes("status") || nk.includes("completion") || nk.includes("complete"))) continue;
      const v = String(row[k] ?? "").trim();
      if(v) vals.push(v);
    }
    return uniq(vals);
  }

  function buildStagesFromProjectRowsWide(rowsForProject, today){
    const stageMap = new Map(STAGES.map(s => [s, {
      start:null, end:null, extEnd:null, done:false, statusText:"",
      delDone:null, delRemain:null,
      stagePP:null
    }]));

    for(const row of rowsForProject){
      for(const st of STAGES){
        const sch = stageSchema(st);

        const startDates = getAllValues(row, sch.start).map(parseDate).filter(Boolean);
        const plannedEnds = getAllValues(row, sch.plannedEnd).map(parseDate).filter(Boolean);
        const extEnds = getAllValues(row, sch.extEnd).map(parseDate).filter(Boolean);

        let s = startDates.length ? new Date(Math.min(...startDates.map(d=>d.getTime()))) : null;
        let e = plannedEnds.length ? new Date(Math.max(...plannedEnds.map(d=>d.getTime()))) : null;
        let x = extEnds.length ? new Date(Math.max(...extEnds.map(d=>d.getTime()))) : null;

        const statusVals = collectStageStatusValues(row, st);
        const cur = stageMap.get(st);

        if(statusVals.length){
          cur.statusText = statusVals.join(" | ");
          if(statusVals.some(isStageComplete)) cur.done = true;
        }

        const doneVals = getAllValues(row, sch.delDone).map(toNumber).filter(n=>Number.isFinite(n));
        const remVals  = getAllValues(row, sch.delRemain).map(toNumber).filter(n=>Number.isFinite(n));
        const ratioVals = getAllValues(row, sch.delRatio).map(v=>String(v||"").trim()).filter(Boolean);

        if(doneVals.length){
          const mx = Math.max(...doneVals);
          if(cur.delDone == null || mx > cur.delDone) cur.delDone = mx;
        }
        if(remVals.length){
          const mx = Math.max(...remVals);
          if(cur.delRemain == null || mx > cur.delRemain) cur.delRemain = mx;
        }
        if((cur.delDone == null || cur.delRemain == null) && ratioVals.length){
          for(const rv of ratioVals){
            const m = rv.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
            if(m){
              const a = Number(m[1]), b = Number(m[2]);
              if(cur.delDone == null) cur.delDone = a;
              if(cur.delRemain == null) cur.delRemain = b;
              break;
            }
          }
        }

        const ppVals = getAllValues(row, sch.stagePP).map(toPercent).filter(n=>Number.isFinite(n));
        if(ppVals.length){
          const mx = Math.max(...ppVals);
          if(cur.stagePP == null || mx > cur.stagePP) cur.stagePP = mx;
        }

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
      const start = v.start;
      const end = v.end;
      const extEnd = v.extEnd;

      const alert = { kind:"", text:"" };
      if(v.done){
        alert.kind = "ok";
        alert.text = "Complete";
      } else if(start && end){
        const dToStart = daysBetween(today, start);

        if(today > (extEnd || end)){
          alert.kind = "bad";
          alert.text = `Overdue +${Math.max(1, daysBetween((extEnd || end), today))}d`;
        } else if(today >= start && today <= (extEnd || end)){
          const spent = Math.max(0, daysBetween(start, today));
          const left = Math.max(0, daysBetween(today, (extEnd || end)));
          alert.kind = "warn";
          alert.text = `Spent ${spent}d • Left ${left}d`;
        } else if(dToStart > 0 && dToStart <= 15){
          alert.kind = "warn";
          alert.text = `In ${dToStart}d`;
        }
      }

      const delDone = (v.delDone == null && v.delRemain == null) ? null : (v.delDone || 0);
      const delRemain = (v.delDone == null && v.delRemain == null) ? null : (v.delRemain || 0);

      return {
        label: st,
        discipline: disciplineForStage(st),
        start,
        end,
        extEnd,
        done: v.done,
        statusText: v.statusText,
        deliverDone: delDone,
        deliverRemain: delRemain,
        stagePP: (v.stagePP == null ? null : clamp(v.stagePP,0,100)),
        alert
      };
    });
  }

  function computeHours(rows){
    const AH = rows.reduce((s,r)=>s+toNumber(pick(r,FIELDS.allottedHours)),0);
    const TCH = rows.reduce((s,r)=>s+toNumber(pick(r,FIELDS.consumedHours)),0);
    const bhColSum = rows.reduce((s,r)=>s+toNumber(pick(r,FIELDS.balanceHours)),0);
    const BH = Math.abs(bhColSum) > 0 ? bhColSum : (AH - TCH);
    return { AH, TCH, BH };
  }

  function computeDeploymentPeople(rows){
    const m = new Map();
    for(const r of rows){
      const cell = pick(r, FIELDS.deployment);
      for(const item of parseDeploymentCell(cell)){
        const name = String(item.name||"").trim() || "(Blank)";
        const pct = Number.isFinite(item.pct) ? item.pct : 0;
        if(pct <= 0) continue;
        m.set(name, (m.get(name)||0) + pct);
      }
    }
    return Array.from(m.entries())
      .map(([name,pct])=>({name,pct}))
      .sort((a,b)=>b.pct-a.pct);
  }

  function computeProjectPP(rows){
    if(!rows.length) return 0;
    const avg = rows.reduce((s,r)=>s+toPercent(pick(r,FIELDS.progress)),0) / rows.length;
    return clamp(avg, 0, 100);
  }

  function computeRunwayFromPeopleAndBH(people, BH){
    const factorDecimal = people.reduce((s,p)=>s + (p.pct/100), 0);
    const monthlyBurn = factorDecimal * 174.25;

    if(!Number.isFinite(monthlyBurn) || monthlyBurn <= 0) return { runwayMonths: null, runwayDate: null, factorDecimal, monthlyBurn };
    if(!Number.isFinite(BH) || BH <= 0) return { runwayMonths: 0, runwayDate: null, factorDecimal, monthlyBurn };

    const runwayMonths = BH / monthlyBurn;
    if(!Number.isFinite(runwayMonths) || runwayMonths <= 0) return { runwayMonths: 0, runwayDate: null, factorDecimal, monthlyBurn };

    const today = new Date();
    const days = runwayMonths * 30.4375;
    const runwayDate = new Date(today.getTime() + days * 86400000);

    return { runwayMonths, runwayDate, factorDecimal, monthlyBurn };
  }

  function escapeHtml(s){
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/\"/g,"&quot;").replace(/'/g,"&#039;");
  }

  // ---- DOM
  const elFile = document.getElementById("file");
  const elStatus = document.getElementById("status");
  const elProjectSelect = document.getElementById("projectSelect");
  const elSearch = document.getElementById("search");
  const elTeamTypeRadios = document.getElementById("teamTypeRadios");
  const elTeamRadios = document.getElementById("teamRadios");
  const elTable = document.getElementById("table");
  const elRowCount = document.getElementById("rowCount");

  // Views
  const elLandingView = document.getElementById("landingView");
  const elDashboardView = document.getElementById("dashboardView");
  const elBackBtn = document.getElementById("backBtn");

  // ---- state
  let csvRowsAll = [];
  let allRows = [];
  let filteredRows = [];
  let projectNameMap = new Map();
  let typeCols = { Architecture:null, Interior:null, Landscape:null };
  let activeTeamType = "";
  let activeTeam = "";
  let activeProject = "";
  let runwayDate = null;
  let view = "landing"; // "landing" | "project"

  // ---- UI helpers
  function setStatus(msg, kind){
    elStatus.textContent = msg;
    elStatus.style.color = "";
    if(kind === "ok") elStatus.style.color = "var(--ok)";
    if(kind === "warn") elStatus.style.color = "var(--warn)";
  }

  function renderRadioRow(el, values, activeValue, onPick){
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
    for(const b of el.querySelectorAll(".radioBtn")){
      b.classList.toggle("active", b.dataset.value === activeValue);
    }
  }

  function buildProjectNameMap(rows){
    projectNameMap = new Map();
    for(const r of rows){
      const pc = String(pick(r, FIELDS.projectCode) || "").trim();
      const pn = String(pick(r, FIELDS.projectName) || "").trim();
      if(pc && pn && !projectNameMap.has(pc)) projectNameMap.set(pc, pn);
    }
  }

  // IMPORTANT CHANGE: do NOT auto-pick a project anymore (landing page is default)
  function initProjectDropdown(rows){
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

    activeProject = (prev && codes.includes(prev)) ? prev : "";
    elProjectSelect.value = activeProject || "";

    elProjectSelect.disabled = codes.length === 0;
    elSearch.disabled = codes.length === 0;
  }

  function renderTable(rows){
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

  // ---- filters
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

  function setView(next){
    view = next;

    if(elLandingView) elLandingView.style.display = (view === "landing") ? "block" : "none";
    if(elDashboardView) elDashboardView.style.display = (view === "project") ? "block" : "none";
    if(elBackBtn) elBackBtn.style.display = (view === "project") ? "inline-flex" : "none";
  }

  function clearHash(){
    // remove hash without reloading
    try{
      const url = new URL(location.href);
      url.hash = "";
      history.pushState("", document.title, url.toString());
    } catch (e){
      location.hash = "";
    }
  }

  function goToLanding(opts = {}){
    const updateHash = opts.updateHash !== false;
    activeProject = "";
    if(elProjectSelect) elProjectSelect.value = "";
    setView("landing");
    renderLanding();
    renderAll(); // clears gantt/metrics/table content
    if(updateHash) clearHash();
  }

  function goToProject(code, opts = {}){
    const updateHash = opts.updateHash !== false;
    if(!code) return goToLanding(opts);

    activeProject = code;
    if(elProjectSelect) elProjectSelect.value = code;
    setView("project");
    renderAll();
    if(updateHash) location.hash = `p=${encodeURIComponent(code)}`;
  }

  function handleHashRoute(){
    const m = String(location.hash || "").match(/p=([^&]+)/);
    const want = m ? decodeURIComponent(m[1]) : "";

    if(!want){
      goToLanding({ updateHash:false });
      return;
    }

    const codes = new Set(
      uniq(allRows.map(r=>String(pick(r,FIELDS.projectCode)||"").trim()).filter(Boolean))
    );

    if(codes.has(want)) goToProject(want, { updateHash:false });
    else goToLanding({ updateHash:false });
  }

  function applyCsvFilters(){
    allRows = csvRowsAll.filter(r => rowMatchesTeamType(r) && rowMatchesTeam(r));
    buildProjectNameMap(allRows);
    initProjectDropdown(allRows);

    renderLanding();

    // If current selected project disappears due to filters, go back to landing.
    if(activeProject){
      const stillExists = allRows.some(r => String(pick(r,FIELDS.projectCode)||"").trim() === activeProject);
      if(!stillExists){
        goToLanding({ updateHash:false });
        return;
      }
    }

    // Keep view as-is
    if(view === "project" && activeProject) renderAll();
    else {
      // landing: keep dashboard content cleared
      renderAll();
    }
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

  // ---- modules
  const landing = initLanding(document.getElementById("landingMount"), {
    onSelectProject: (pc)=> goToProject(pc)
  });

  const gantt = initGantt(document.getElementById("ganttMount"), {
    fmtWindow: (a,b)=> `${fmtMonthYear(a)} → ${fmtMonthYear(b)}`
  });

  const metrics = initMetrics(document.getElementById("metricsMount"), {
    onRunwaySimulated: (sim)=>{
      runwayDate = sim?.runwayDate || null;
      gantt.setRunway(runwayDate);
    }
  });

  function pickCurrentStage(stages, today){
    const incomplete = (stages || []).filter(s => !s.done && (s.start || s.end || s.extEnd));
    if(!incomplete.length) return null;

    const started = incomplete
      .filter(s => s.start && today >= s.start)
      .sort((a,b)=>(b.start?.getTime?.()||0) - (a.start?.getTime?.()||0));
    if(started.length) return started[0];

    const upcoming = incomplete
      .filter(s => s.start && today < s.start)
      .sort((a,b)=>(a.start?.getTime?.()||0) - (b.start?.getTime?.()||0));
    if(upcoming.length) return upcoming[0];

    // fallback: first incomplete with any dates
    return incomplete[0];
  }

  function pickMostOverdueStage(stages, today){
    const overdue = (stages || [])
      .filter(s => !s.done)
      .map(s=>{
        const due = s.extEnd || s.end;
        if(!(due instanceof Date) || isNaN(due)) return null;
        if(today <= due) return null;
        return { ...s, overdueDays: Math.max(1, daysBetween(due, today)) };
      })
      .filter(Boolean)
      .sort((a,b)=> (b.overdueDays||0) - (a.overdueDays||0));
    return overdue[0] || null;
  }

  function renderLanding(){
    const today = new Date();
    const query = elSearch.value.trim().toLowerCase();

    const codes = uniq(allRows
      .map(r=>String(pick(r,FIELDS.projectCode)||"").trim())
      .filter(Boolean))
      .sort((a,b)=>a.localeCompare(b));

    const projects = [];

    for(const pc of codes){
      const rowsForProject = allRows.filter(r => String(pick(r,FIELDS.projectCode)||"").trim() === pc);
      if(!rowsForProject.length) continue;

      const pn = projectNameMap.get(pc) || "";

      const teams = uniq(rowsForProject.map(r => displayTeam(String(r.__team||"").trim()))).filter(Boolean);
      const team = teams.length ? (teams.length <= 2 ? teams.join(", ") : `${teams[0]}, ${teams[1]} +${teams.length-2}`) : TEAM_UNSPEC;

      const types = uniq(rowsForProject.map(r => String(r.__teamType||"").trim()).filter(Boolean));
      const teamType = types.length ? (types.length <= 2 ? types.join(", ") : `${types[0]}, ${types[1]} +${types.length-2}`) : TEAM_UNSPEC;

      const stages = buildStagesFromProjectRowsWide(rowsForProject, today);
      const current = pickCurrentStage(stages, today);
      const missed = pickMostOverdueStage(stages, today);

      const projectPP = computeProjectPP(rowsForProject);

      const item = {
        code: pc,
        name: pn,
        teamType,
        team,
        projectPP,
        currentStage: current ? {
          label: current.label,
          discipline: current.discipline,
          alertText: current.alert?.text || ""
        } : null,
        missedStage: missed ? {
          label: missed.label,
          discipline: missed.discipline,
          overdueDays: missed.overdueDays || 0
        } : null
      };

      projects.push(item);
    }

    // sort: missed first, then by code
    projects.sort((a,b)=>{
      const am = a.missedStage ? 1 : 0;
      const bm = b.missedStage ? 1 : 0;
      if(am !== bm) return bm - am;
      return String(a.code||"").localeCompare(String(b.code||""));
    });

    let shown = projects;
    if(query){
      shown = projects.filter(p=>{
        const hay = [
          p.code, p.name, p.teamType, p.team,
          p.currentStage?.label, p.currentStage?.alertText,
          p.missedStage?.label
        ].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(query);
      });
    }

    landing.setData({
      projects: shown,
      subtitle: csvRowsAll.length
        ? `Showing ${shown.length} of ${projects.length} projects (filters applied).`
        : "Upload a file to see project tiles."
    });
  }

  function renderAll(){
    const query = elSearch.value.trim().toLowerCase();
    activeProject = elProjectSelect.value || "";

    filteredRows = allRows.filter(row=>{
      if(activeProject){
        const code=String(pick(row,FIELDS.projectCode)||"").trim();
        if(code !== activeProject) return false;
      }
      if(!query) return true;
      return JSON.stringify(row).toLowerCase().includes(query);
    });

    elRowCount.textContent = `${filteredRows.length} rows`;
    renderTable(filteredRows);

    const rowsForProject = activeProject ? filteredRows : [];
    const today = new Date();

    const projectName = activeProject ? (projectNameMap.get(activeProject) || "") : "";
    const title = activeProject ? (projectName ? `${activeProject} — ${projectName}` : activeProject) : "Select a project";

    const stages = activeProject ? buildStagesFromProjectRowsWide(rowsForProject, today) : [];
    const projectPP = activeProject ? computeProjectPP(rowsForProject) : 0;
    const hours = activeProject ? computeHours(rowsForProject) : {AH:0,TCH:0,BH:0};
    const people = activeProject ? computeDeploymentPeople(rowsForProject) : [];

    const runway = computeRunwayFromPeopleAndBH(people, hours.BH);
    runwayDate = runway.runwayDate || null;

    gantt.setData({ title, projectPP, stages, runwayDate });
    metrics.setData({ title, hours, people, runway });

    gantt.setRunway(runwayDate);
  }

  // ---- parsing
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

  async function importFile(file){
    const name=(file?.name||"").toLowerCase();
    setStatus("Loading…");

    csvRowsAll=[]; allRows=[]; filteredRows=[];
    activeTeamType=""; activeTeam=""; activeProject="";
    runwayDate = null;

    elProjectSelect.innerHTML = `<option value="">Select a project…</option>`;
    elProjectSelect.disabled = true;
    elSearch.value = "";
    elSearch.disabled = true;

    elTeamTypeRadios.innerHTML = "";
    elTeamRadios.innerHTML = "";
    elTable.innerHTML = "";
    elRowCount.textContent = "0 rows";

    try{
      if(name.endsWith(".csv") || name.endsWith(".tsv") || name.endsWith(".txt")){
        const text = await file.text();
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

        renderRadioRow(elTeamTypeRadios, TEAM_TYPES_FIXED, "", setTeamType);
        const teamsAll = uniq(csvRowsAll.map(r=>displayTeam(String(r.__team||"").trim()))).sort((a,b)=>a.localeCompare(b));
        renderRadioRow(elTeamRadios, teamsAll, "", (v)=> setTeam(v));

        applyCsvFilters();

        // route after load (supports #p=...)
        handleHashRoute();
        if(!location.hash) goToLanding({ updateHash:false });

        setStatus(`Loaded (${delim === "\t" ? "TAB" : delim} • ${csvRowsAll.length} rows)`, "ok");
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

        // route after load (supports #p=...)
        handleHashRoute();
        if(!location.hash) goToLanding({ updateHash:false });

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
  elFile.addEventListener("change", async ()=>{
    const f = elFile.files?.[0];
    if(f) await importFile(f);
  });

  // Project dropdown: selecting a project moves to dashboard
  elProjectSelect.addEventListener("change", ()=>{
    const pc = elProjectSelect.value || "";
    if(pc) goToProject(pc);
    else goToLanding();
  });

  // Search: landing filters tiles; dashboard filters rows (existing behavior)
  elSearch.addEventListener("input", ()=>{
    if(view === "landing") renderLanding();
    else renderAll();
  });

  // Back button
  if(elBackBtn){
    elBackBtn.onclick = ()=> goToLanding();
  }

  // Hash routing
  window.addEventListener("hashchange", ()=>{
    if(!csvRowsAll.length) return;
    handleHashRoute();
  });

  // Initial
  setView("landing");
  landing.setData({ projects:[], subtitle:"Upload a file to see project tiles." });

  gantt.setData({ title:"Select a project", projectPP:0, stages:[], runwayDate:null });
  metrics.setData({ title:"", hours:{AH:0,TCH:0,BH:0}, people:[], runway:null });

  renderLanding();
}

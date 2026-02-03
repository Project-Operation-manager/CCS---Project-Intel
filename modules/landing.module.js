// modules/landing.module.js
export function initLanding(mountEl, opts = {}) {
  const onSelectProject = opts.onSelectProject || (() => {});

  let state = {
    projects: [],
    subtitle: ""
  };

  mountEl.innerHTML = `
    <style>
      .lpTop{
        display:flex; align-items:flex-end; justify-content:space-between; gap:12px;
        flex-wrap:wrap;
        margin-bottom:12px;
      }
      .lpTitle{
        display:flex; flex-direction:column; gap:4px;
        min-width: 240px;
      }
      .lpTitle b{ font-size:14px; color:var(--text); }
      .lpTitle .sub{ font-size:12px; color:var(--muted); }

      .lpGrid{
        display:grid;
        grid-template-columns: repeat(3, minmax(240px, 1fr));
        gap:12px;
      }
      @media (max-width: 1200px){
        .lpGrid{ grid-template-columns: repeat(2, minmax(220px, 1fr)); }
      }
      @media (max-width: 740px){
        .lpGrid{ grid-template-columns: 1fr; }
      }

      .tile{
        border:1px solid var(--grid);
        border-radius:14px;
        background: rgba(0,0,0,0.10);
        padding:12px;
        cursor:pointer;
        box-shadow: 0 10px 24px rgba(0,0,0,0.20);
        transition: transform .06s ease, border-color .15s ease, background .15s ease;
      }
      .tile:hover{
        transform: translateY(-1px);
        border-color: rgba(255,255,255,0.18);
        background: rgba(0,0,0,0.14);
      }
      .tile:active{ transform: translateY(0px) scale(0.995); }

      .tileTop{
        display:flex; align-items:flex-start; justify-content:space-between; gap:10px;
      }
      .tileName{
        min-width:0;
      }
      .tileName b{
        display:block;
        font-size:13px;
        color:var(--text);
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
        max-width: 100%;
      }
      .tileName .mut{
        margin-top:4px;
        font-size:12px;
        color:var(--muted);
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
      }

      .ppBadge{
        flex:0 0 auto;
        font-variant-numeric: tabular-nums;
        font-size:12px;
        padding:6px 10px;
        border-radius:999px;
        border:1px solid rgba(255,255,255,0.12);
        background: rgba(0,0,0,0.12);
        color: rgba(255,255,255,0.86);
      }
      .ppBarOuter{
        margin-top:10px;
        height:8px;
        border-radius:999px;
        background: rgba(255,255,255,0.06);
        border:1px solid rgba(255,255,255,0.10);
        overflow:hidden;
      }
      .ppBarFill{
        height:100%;
        background: var(--pp);
        width:0%;
      }

      .pillRow{
        display:flex; gap:8px; flex-wrap:wrap;
        margin-top:10px;
      }
      .pillSm{
        font-size:12px; padding:6px 10px;
        border:1px solid rgba(255,255,255,0.10);
        border-radius:999px;
        color:var(--muted);
        background: rgba(0,0,0,0.10);
        white-space:nowrap;
      }

      .metaRow{
        display:flex; flex-direction:column; gap:8px;
        margin-top:10px;
      }
      .metaLine{
        display:flex; align-items:center; justify-content:space-between; gap:10px;
        padding:8px 10px;
        border:1px solid rgba(255,255,255,0.06);
        border-radius:12px;
        background: rgba(0,0,0,0.10);
      }
      .metaL{
        display:flex; align-items:center; gap:8px; min-width:0;
      }
      .dot{
        width:10px; height:10px; border-radius:4px;
        border:1px solid rgba(255,255,255,0.18);
        flex:0 0 auto;
      }
      .metaTxt{
        font-size:12px; color:rgba(255,255,255,0.86);
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
        max-width: 100%;
      }
      .metaR{
        flex:0 0 auto;
        font-size:12px;
        color:var(--muted);
        white-space:nowrap;
      }

      .empty{
        padding:12px;
        border:1px dashed rgba(255,255,255,0.16);
        border-radius:14px;
        color:var(--muted);
        background: rgba(0,0,0,0.08);
        font-size:12px;
        line-height:1.5;
      }
    </style>

    <div class="lpTop">
      <div class="lpTitle">
        <b>Projects</b>
        <div class="sub" id="lpSub">Upload a file to see project tiles.</div>
      </div>
      <div class="pillSm" id="lpCount">0 projects</div>
    </div>

    <div id="lpGrid" class="lpGrid"></div>
  `;

  const elSub = mountEl.querySelector("#lpSub");
  const elCount = mountEl.querySelector("#lpCount");
  const elGrid = mountEl.querySelector("#lpGrid");

  function escapeHtml(s){
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/\"/g,"&quot;").replace(/'/g,"&#039;");
  }

  function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }

  function disciplineVar(d){
    if(d === "Interior") return "var(--interior)";
    if(d === "Landscape") return "var(--land)";
    return "var(--arch)";
  }

  function render(){
    const projects = (state.projects || []);
    elSub.textContent = state.subtitle || (projects.length ? "Click a project tile to open its dashboard." : "Upload a file to see project tiles.");
    elCount.textContent = `${projects.length} project${projects.length === 1 ? "" : "s"}`;

    if(!projects.length){
      elGrid.innerHTML = `
        <div class="empty">
          No projects to show yet.<br/>
          • Upload your CSV/XLSX<br/>
          • Use Discipline/Team filters to narrow down projects
        </div>
      `;
      return;
    }

    elGrid.innerHTML = projects.map(p=>{
      const code = escapeHtml(p.code || "");
      const name = escapeHtml(p.name || "");
      const teamType = escapeHtml(p.teamType || "(Unspecified)");
      const team = escapeHtml(p.team || "(Unspecified)");
      const pp = clamp(Number(p.projectPP || 0), 0, 100);

      const cur = p.currentStage;
      const miss = p.missedStage;

      const curLabel = cur ? escapeHtml(cur.label || "—") : "—";
      const curAlert = cur ? escapeHtml(cur.alertText || "") : "";
      const curColor = cur ? disciplineVar(cur.discipline) : "rgba(255,255,255,0.18)";

      const missLabel = miss ? escapeHtml(miss.label || "—") : "";
      const missRight = miss ? `Overdue +${Number(miss.overdueDays || 0)}d` : "—";

      return `
        <div class="tile" role="button" tabindex="0" data-code="${code}">
          <div class="tileTop">
            <div class="tileName">
              <b title="${code}${name ? " — " + name : ""}">${code}${name ? " — " + name : ""}</b>
              <div class="mut" title="${teamType} • ${team}">${teamType} • ${team}</div>
            </div>
            <div class="ppBadge" title="Project progress">${Math.round(pp)}%</div>
          </div>

          <div class="ppBarOuter" aria-hidden="true">
            <div class="ppBarFill" style="width:${pp.toFixed(2)}%"></div>
          </div>

          <div class="metaRow">
            <div class="metaLine" title="Current stage">
              <div class="metaL">
                <span class="dot" style="background:${curColor}"></span>
                <span class="metaTxt">Current: ${curLabel}</span>
              </div>
              <div class="metaR">${curAlert || "—"}</div>
            </div>

            <div class="metaLine" title="Missed stage (most overdue)">
              <div class="metaL">
                <span class="dot" style="background:var(--bad)"></span>
                <span class="metaTxt">Missed: ${missLabel || "—"}</span>
              </div>
              <div class="metaR">${miss ? missRight : "—"}</div>
            </div>
          </div>
        </div>
      `;
    }).join("");

    const clickTile = (el)=>{
      const code = el?.dataset?.code || "";
      if(code) onSelectProject(code);
    };

    for(const tile of elGrid.querySelectorAll(".tile")){
      tile.addEventListener("click", ()=> clickTile(tile));
      tile.addEventListener("keydown", (e)=>{
        if(e.key === "Enter" || e.key === " "){
          e.preventDefault();
          clickTile(tile);
        }
      });
    }
  }

  function setData(next){
    state = { ...state, ...(next || {}) };
    render();
  }

  render();
  return { setData };
}

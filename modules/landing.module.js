export function initLanding(mountEl, opts = {}){
  const onSelectProject = opts.onSelectProject || (()=>{});

  mountEl.innerHTML = `
    <style>
      .lpWrap{
        display:flex;
        flex-direction:column;
        gap:12px;
      }

      .tileGrid{
        display:grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap:12px;
      }
      @media (max-width: 1320px){
        .tileGrid{ grid-template-columns: repeat(3, minmax(0, 1fr)); }
      }
      @media (max-width: 980px){
        .tileGrid{ grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (max-width: 720px){
        .tileGrid{ grid-template-columns: 1fr; }
      }

      .tile{
        border:1px solid var(--grid);
        border-radius:14px;
        background: rgba(0,0,0,0.10);
        padding:12px;
        cursor:pointer;
        transition: transform .08s ease, border-color .12s ease, background .12s ease, box-shadow .12s ease;
        box-shadow: 0 10px 30px rgba(0,0,0,0.20);
      }
      .tile:hover{
        transform: translateY(-2px);
        border-color: rgba(255,255,255,0.28);
        background: rgba(255,255,255,0.06);
        box-shadow:
          0 14px 40px rgba(0,0,0,0.32),
          0 0 0 1px rgba(255,255,255,0.08) inset;
      }

      .tTop{
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:10px;
      }
      .tTitle{
        min-width:0;
      }
      .tCode{
        font-size:12px;
        color: rgba(255,255,255,0.9);
        font-weight:800;
        letter-spacing:0.2px;
      }
      .tName{
        margin-top:3px;
        font-size:12px;
        color: var(--muted);
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
      }

      .chips{
        display:flex;
        gap:6px;
        flex-wrap:wrap;
        justify-content:flex-end;
      }
      .chip{
        font-size:11px;
        padding:6px 9px;
        border-radius:999px;
        border:1px solid rgba(255,255,255,0.10);
        background: rgba(0,0,0,0.14);
        color: rgba(255,255,255,0.82);
        white-space:nowrap;
      }
      .chip.bad{ color: var(--bad); border-color: rgba(255,122,122,0.40); }
      .chip.ok{ color: var(--ok); border-color: rgba(139,255,178,0.35); }

      .tBody{
        margin-top:10px;
        display:grid;
        grid-template-columns: 1fr;
        gap:8px;
      }

      .ppWrap{
        margin-top:2px;
        border:1px solid rgba(255,255,255,0.10);
        border-radius:999px;
        background: rgba(0,0,0,0.14);
        overflow:hidden;
        height:14px;
        position:relative;
      }
      .ppFill{
        position:absolute;
        top:0; bottom:0; left:0;
        width:0%;
        background: rgba(255, 92, 162, 0.92);
      }
      .ppTxt{
        position:relative;
        z-index:1;
        font-size:11px;
        color: rgba(255,255,255,0.90);
        line-height:14px;
        text-align:right;
        padding:0 8px;
        user-select:none;
      }

      .teams{
        display:flex;
        gap:6px;
        flex-wrap:wrap;
        justify-content:flex-start;
      }
      .teamTag{
        font-size:11px;
        padding:5px 8px;
        border-radius:999px;
        border:1px solid rgba(255,255,255,0.10);
        background: rgba(0,0,0,0.10);
        color: rgba(255,255,255,0.78);
        max-width: 100%;
      }
      .teamTag b{ color: rgba(255,255,255,0.92); font-weight:600; }

      .line{
        font-size:12px;
        display:flex;
        gap:10px;
        align-items:flex-start;
        justify-content:space-between;
      }
      .k{ color: var(--muted); flex:0 0 auto; }
      .v{
        color: rgba(255,255,255,0.88);
        text-align:right;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
        max-width: 70%;
      }

      .v.multiline{
        white-space:normal;
        text-overflow:clip;
        max-width: 100%;
        text-align:left;
        line-height:1.3;
      }

      .empty{
        padding:16px;
        border:1px dashed rgba(255,255,255,0.14);
        border-radius:14px;
        color: var(--muted);
        font-size:12px;
        background: rgba(0,0,0,0.10);
      }
    </style>

    <div class="lpWrap">
      <div id="lpGrid" class="tileGrid"></div>
      <div id="lpEmpty" class="empty" style="display:none;">No projects match the current filter.</div>
    </div>
  `;

  const elGrid = mountEl.querySelector("#lpGrid");
  const elEmpty = mountEl.querySelector("#lpEmpty");

  function escapeHtml(s){
    return String(s)
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/\"/g,"&quot;")
      .replace(/'/g,"&#039;");
  }

  function fmtSlash(v){
    if(v == null) return "/";
    const s = String(v).trim();
    return s ? s : "/";
  }

  function fmtPct(v){
    if(v == null) return "/";
    const n = Number(v);
    if(!Number.isFinite(n)) return "/";
    return `${Math.round(n)}%`;
  }

  function safePct(v){
    const n = Number(v);
    if(!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(100, n));
  }

  function teamText(teams){
    const parts = [];
    for(const t of (teams||[])){
      const nm = (t?.name || "").trim();
      if(!nm) continue;
      const short = t.type === "Architecture" ? "Arch" : (t.type === "Interior" ? "Int" : "Land");
      parts.push({ short, name: nm });
    }
    return parts;
  }

  function renderTile(p){
    const missed = (p.missedStages || []).filter(Boolean);
    const pp = safePct(p.projectPP);

    const chips = [];
    if(missed.length){
      chips.push(`<span class="chip bad" title="Missed stage(s)">Missed</span>`);
    } else {
      chips.push(`<span class="chip ok">On track</span>`);
    }

    const teams = teamText(p.teams);
    const teamHtml = teams.length
      ? `<div class="teams">${teams.map(t => `<span class="teamTag"><b>${escapeHtml(t.short)}:</b> ${escapeHtml(t.name)}</span>`).join("")}</div>`
      : `<div class="teams"><span class="teamTag"><b>Team:</b> /</span></div>`;

    const missedText = missed.length ? missed.join(", ") : "/";
    const currentText = p.currentStage ? p.currentStage : "/";

    const ppText = (pp == null) ? "/" : `${Math.round(pp)}%`;
    const ppWidth = (pp == null) ? 0 : pp;

    return `
      <div class="tile" data-pc="${escapeHtml(p.pc)}" title="Open dashboard">
        <div class="tTop">
          <div class="tTitle">
            <div class="tCode">${escapeHtml(p.pc)}</div>
            <div class="tName">${escapeHtml(fmtSlash(p.name))}</div>
          </div>
          <div class="chips">${chips.join("")}</div>
        </div>

        <div class="tBody">
          <div>
            <div class="k" style="font-size:11px; margin-bottom:6px;">Project %</div>
            <div class="ppWrap" aria-label="Project progress">
              <div class="ppFill" style="width:${ppWidth}%;"></div>
              <div class="ppTxt">${escapeHtml(ppText)}</div>
            </div>
          </div>

          ${teamHtml}

          <div class="line">
            <div class="k">Current</div>
            <div class="v">${escapeHtml(currentText)}</div>
          </div>

          <div class="line">
            <div class="k">Missed</div>
            <div class="v multiline" title="${escapeHtml(missedText)}">${escapeHtml(missedText)}</div>
          </div>
        </div>
      </div>
    `;
  }

  function setData(data){
    const projects = Array.isArray(data?.projects) ? data.projects : [];

    if(!projects.length){
      elGrid.innerHTML = "";
      elEmpty.style.display = "";
      return;
    }
    elEmpty.style.display = "none";

    elGrid.innerHTML = projects.map(renderTile).join("");

    for(const tile of elGrid.querySelectorAll(".tile")){
      tile.addEventListener("click", ()=>{
        const pc = tile.getAttribute("data-pc") || "";
        if(pc) onSelectProject(pc);
      });
    }
  }

  return { setData };
}

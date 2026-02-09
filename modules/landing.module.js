export function initLanding(mountEl, opts = {}){
  const onSelectProject = opts.onSelectProject || (()=>{});

  mountEl.innerHTML = `
    <style>
      .lpWrap{
        display:flex;
        flex-direction:column;
        gap:12px;
      }
      .lpHeader{
        display:flex;
        align-items:flex-end;
        justify-content:space-between;
        gap:12px;
        flex-wrap:wrap;
      }
      .lpHeader h2{
        margin:0;
        font-size:14px;
        letter-spacing:0.2px;
      }
      .lpSub{
        margin-top:4px;
        font-size:12px;
        color: var(--muted);
      }

      .tileGrid{
        display:grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap:12px;
      }
      @media (max-width: 1100px){
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
        transition: transform .08s ease, border-color .12s ease, background .12s ease;
        box-shadow: 0 10px 30px rgba(0,0,0,0.20);
      }
      .tile:hover{
        transform: translateY(-1px);
        border-color: rgba(255,255,255,0.16);
        background: rgba(255,255,255,0.04);
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
        color: rgba(255,255,255,0.85);
        font-weight:700;
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
      .chip.warn{ color: var(--warn); border-color: rgba(255,209,138,0.30); }
      .chip.bad{ color: var(--bad); border-color: rgba(255,122,122,0.30); }
      .chip.ok{ color: var(--ok); border-color: rgba(139,255,178,0.30); }

      .tBody{
        margin-top:10px;
        display:grid;
        grid-template-columns: 1fr;
        gap:8px;
      }
      .row{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        font-size:12px;
      }
      .k{ color: var(--muted); }
      .v{ color: rgba(255,255,255,0.88); text-align:right; white-space:nowrap; }

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

      .progressBlock{ display:flex; flex-direction:column; gap:6px; }
      .progressTrack{
        width:100%;
        height:10px;
        border-radius:999px;
        border:1px solid rgba(255,255,255,0.10);
        background: rgba(0,0,0,0.14);
        overflow:hidden;
      }
      .progressTrack.na{
        background: rgba(0,0,0,0.10);
        border-style:dashed;
      }
      .progressFill{
        height:100%;
        width:0%;
        border-radius:999px;
        background: linear-gradient(90deg, rgba(139,255,178,0.55), rgba(139,255,178,0.18));
      }
      .progressTrack.na .progressFill{ width:0% !important; background: transparent; }

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
      <div class="lpHeader">
        <div>
          <h2 id="lpTitle">Projects</h2>
          <div id="lpSub" class="lpSub"></div>
        </div>
      </div>

      <div id="lpGrid" class="tileGrid"></div>
      <div id="lpEmpty" class="empty" style="display:none;">No projects match the current filter.</div>
    </div>
  `;

  const elTitle = mountEl.querySelector("#lpTitle");
  const elSub = mountEl.querySelector("#lpSub");
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

  function fmtBUA(v){
    if(v == null) return "/";
    const n = Number(v);
    if(!Number.isFinite(n)) return "/";
    return new Intl.NumberFormat(undefined, { maximumFractionDigits:0 }).format(n);
  }

  function fmtPct(v){
    if(v == null) return "/";
    const n = Number(v);
    if(!Number.isFinite(n)) return "/";
    return `${Math.round(n)}%`;
  }

  function pct01to100(v){
    if(v == null) return null;
    const n = Number(v);
    if(!Number.isFinite(n)) return null;
    // tolerate either 0–1 or 0–100 inputs
    const pct = (n <= 1 && n >= 0) ? (n * 100) : n;
    return Math.max(0, Math.min(100, pct));
  }

  function teamText(teams){
    // teams = [{type, name}]
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
    const missed = (p.missedStages || []);
    const chips = [];

    const pp = pct01to100(p.projectPP);

    if(missed.length){
      chips.push(`<span class="chip bad" title="Overdue stage(s)">${escapeHtml(missed[0])}${missed.length>1 ? ` +${missed.length-1}` : ""}</span>`);
    } else {
      chips.push(`<span class="chip ok">On track</span>`);
    }

    if(p.currentStage){
      chips.push(`<span class="chip warn" title="Current stage">${escapeHtml(p.currentStage)}</span>`);
    } else {
      chips.push(`<span class="chip">Stage /</span>`);
    }

    // Project progress is shown as a progress bar (not a chip)

    const teams = teamText(p.teams);

    const teamHtml = teams.length
      ? `<div class="teams">${teams.map(t => `<span class="teamTag"><b>${escapeHtml(t.short)}:</b> ${escapeHtml(t.name)}</span>`).join("")}</div>`
      : `<div class="teams"><span class="teamTag"><b>Team:</b> /</span></div>`;

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
          ${teamHtml}

          <div class="progressBlock" aria-label="Project progress">
            <div class="row">
              <div class="k">Progress</div>
              <div class="v">${escapeHtml(fmtPct(pp))}</div>
            </div>
            <div class="progressTrack ${pp==null ? "na" : ""}">
              <div class="progressFill" style="width:${pp==null ? 0 : Math.round(pp)}%"></div>
            </div>
          </div>

          <div class="row">
            <div class="k">BUA</div>
            <div class="v">${escapeHtml(fmtBUA(p.bua))}</div>
          </div>

          <div class="row">
            <div class="k">Status</div>
            <div class="v">${escapeHtml(fmtSlash(p.ps))}</div>
          </div>
        </div>
      </div>
    `;
  }

  function setData(data){
    const title = data?.title || "Projects";
    const subtitle = data?.subtitle || "";
    const projects = Array.isArray(data?.projects) ? data.projects : [];

    elTitle.textContent = title;
    elSub.textContent = subtitle;

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

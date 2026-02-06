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

      /* ✅ 4 in a row */
      .tileGrid{
        display:grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap:12px;
      }
      @media (max-width: 1200px){
        .tileGrid{ grid-template-columns: repeat(3, minmax(0, 1fr)); }
      }
      @media (max-width: 920px){
        .tileGrid{ grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (max-width: 620px){
        .tileGrid{ grid-template-columns: 1fr; }
      }

      /* ✅ pastel gradient tiles */
      .tile{
        border:1px solid rgba(15,23,42,0.10);
        border-radius:16px;
        background:
          linear-gradient(135deg,
            rgba(255, 236, 213, 0.85) 0%,
            rgba(232, 242, 255, 0.85) 45%,
            rgba(234, 255, 245, 0.85) 100%);
        padding:12px;
        cursor:pointer;
        transition: transform .10s ease, border-color .15s ease, box-shadow .15s ease, filter .15s ease;
        box-shadow: 0 16px 40px rgba(0,0,0,0.10);
        position:relative;
        overflow:hidden;
      }

      /* subtle “soft light” sheen */
      .tile:before{
        content:"";
        position:absolute;
        inset:-60px -60px auto auto;
        width:140px;
        height:140px;
        background: radial-gradient(circle at center, rgba(255,255,255,0.65), rgba(255,255,255,0));
        transform: rotate(15deg);
        pointer-events:none;
      }

      /* ✅ stronger hover highlight */
      .tile:hover{
        transform: translateY(-3px);
        border-color: rgba(15,23,42,0.22);
        box-shadow: 0 22px 60px rgba(0,0,0,0.18);
        filter: saturate(1.06) contrast(1.02);
      }

      .tTop{
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:10px;
      }

      .tTitle{ min-width:0; }

      .tCode{
        font-size:12px;
        color: rgba(15,23,42,0.92);
        font-weight:900;
        letter-spacing:0.2px;
      }

      .tName{
        margin-top:3px;
        font-size:12px;
        color: rgba(15,23,42,0.62);
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
        border:1px solid rgba(15,23,42,0.10);
        background: rgba(255,255,255,0.78);
        color: rgba(15,23,42,0.78);
        white-space:nowrap;
        box-shadow: 0 10px 22px rgba(0,0,0,0.06);
      }
      .chip.warn{ color: var(--warn); border-color: rgba(178,106,0,0.24); }
      .chip.bad{ color: var(--bad); border-color: rgba(198,40,40,0.22); }
      .chip.ok{ color: var(--ok); border-color: rgba(15,138,75,0.22); }

      .tBody{
        margin-top:10px;
        display:grid;
        grid-template-columns: 1fr;
        gap:8px;
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
        border:1px solid rgba(15,23,42,0.10);
        background: rgba(255,255,255,0.70);
        color: rgba(15,23,42,0.72);
        max-width: 100%;
      }
      .teamTag b{ color: rgba(15,23,42,0.92); font-weight:800; }

      .row{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        font-size:12px;
      }
      .k{ color: rgba(15,23,42,0.60); font-weight:700; }
      .v{ color: rgba(15,23,42,0.88); text-align:right; white-space:nowrap; font-weight:800; }

      .empty{
        padding:16px;
        border:1px dashed rgba(15,23,42,0.18);
        border-radius:16px;
        color: var(--muted);
        font-size:12px;
        background: rgba(255,255,255,0.70);
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

  function fmtPct(v){
    if(v == null) return "/";
    const n = Number(v);
    if(!Number.isFinite(n)) return "/";
    return `${Math.round(n)}%`;
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
    const missed = (p.missedStages || []);
    const chips = [];

    const pp = (p.projectPP == null ? null : Number(p.projectPP));

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

    chips.push(`<span class="chip" title="Project progress">${escapeHtml(fmtPct(pp))}</span>`);

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

          <!-- ✅ BUA removed -->
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

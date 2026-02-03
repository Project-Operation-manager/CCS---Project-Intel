export function initGantt(mountEl, opts = {}){
  const WINDOW_WEEKS = 52;
  const WINDOW_DAYS = WINDOW_WEEKS * 7;
  const PAN_STEP_DAYS = 1; // days per pan increment

  const fmtWindow = opts.fmtWindow || ((a,b)=>`${a.toISOString().slice(0,10)} → ${b.toISOString().slice(0,10)}`);

  let state = {
    title: "Select a project",
    projectPP: 0,
    stages: [],
    runwayDate: null
  };

  let ganttMinDate = null;
  let ganttMaxStart = 0;
  let ganttOffset = 0;

  mountEl.innerHTML = `
    <style>
      .ganttTopRow{
        display:flex; align-items:center; justify-content:space-between; gap:10px;
        margin-bottom:10px;
        flex-wrap:wrap;
      }
      .ganttTitle{ display:flex; align-items:baseline; gap:10px; min-width:240px; max-width: 55%; }
      .ganttTitle b{
        font-size:14px; font-weight:700; color:var(--text);
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
        max-width: 520px;
      }

      .ganttControlsRow{
        display:flex; align-items:center; gap:10px; flex-wrap:wrap; justify-content:flex-end;
        flex:1 1 auto;
      }

      /* Click-drag pan affordance */
      .ganttOuter{ cursor: grab; }
      .ganttOuter.dragging{ cursor: grabbing; }
      .ganttOuter.dragging *{ user-select:none; }

      .legend{
        display:flex; align-items:center; gap:10px;
        padding:8px 10px;
        border:1px solid var(--legendBorder);
        border-radius:12px;
        background: rgba(0,0,0,0.10);
      }
      .legItem{ display:flex; align-items:center; gap:8px; font-size:12px; color:var(--muted); }
      .sw{ width:10px; height:10px; border-radius:4px; border:1px solid rgba(255,255,255,0.18); }

      .ganttOuter{ border:1px solid var(--grid); border-radius:12px; overflow:hidden; background: rgba(0,0,0,0.08); }
      .ganttScroll{ max-height: calc(100vh - 260px); min-height: 560px; overflow:auto; }

      .ganttGrid{
        display:grid;
        grid-template-columns: 360px 1fr;
        align-items:stretch;
        min-width: 980px;
        width:100%;
      }
      .gHeadL, .gHeadR{
        height: 60px;
        position: sticky;
        top: 0;
        z-index: 20;
        display:flex;
        align-items:stretch;
        padding: 0;
        background: rgba(18,27,47,0.98);
        border-bottom:1px solid var(--grid);
      }
      .gHeadL{ left:0; z-index: 30; border-right:1px solid var(--grid); padding:0 12px; display:flex; align-items:center; }
      .gHeadL b{ font-size:12px; color:var(--muted); font-weight:600; }

      .headStack{ width:100%; display:flex; flex-direction:column; }
      .qRow, .mRow{
        display:flex; width:100%;
        font-size:11px; color:var(--muted);
        user-select:none;
        line-height:1;
      }
      .qSeg, .mSeg{
        border-left:1px solid rgba(255,255,255,0.06);
        padding:6px 8px;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
      }
      .qSeg{ color: rgba(255,255,255,0.65); font-weight:600; padding-top:8px; padding-bottom:5px; }
      .mSeg{ padding-top:5px; padding-bottom:8px; }

      .gCellL{
        height: var(--rowh);
        border-bottom:1px solid var(--grid);
        border-right:1px solid var(--grid);
        display:flex;
        align-items:center;
        gap:10px;
        padding:0 12px;
        background: rgba(255,255,255,0.01);
        position: sticky;
        left: 0;
        z-index: 10;
      }
      .gCellL:nth-of-type(4n+1){ background: rgba(255,255,255,0.02); }

      .leftMain{ display:flex; align-items:center; gap:10px; min-width:0; flex:1 1 auto; }
      .stageName{ font-size:12px; width:64px; flex:0 0 64px; color:var(--text); }
      .deliver{ font-size:12px; color:rgba(255,255,255,0.80); width:84px; flex:0 0 84px; text-align:right; }

      .alert{
        font-size:11px;
        padding:6px 9px;
        border-radius:999px;
        border:1px solid rgba(255,255,255,0.10);
        background: rgba(0,0,0,0.15);
        color: var(--muted);
        white-space:nowrap;
        flex:0 0 auto;
      }
      .alert.ok{ color: var(--ok); border-color: rgba(139,255,178,0.35); }
      .alert.bad{ color: var(--bad); border-color: rgba(255,122,122,0.35); }
      .alert.warn{ color: var(--warn); border-color: rgba(255,209,138,0.35); }

      .ppCircle{
        width:38px; height:38px; border-radius:999px;
        display:flex; align-items:center; justify-content:center;
        font-size:12px;
        color: rgba(255,255,255,0.95);
        border:1px solid rgba(255,255,255,0.18);
        background: rgba(0,0,0,0.18);
        flex:0 0 auto;
      }
      .ppCircle span{ font-variant-numeric: tabular-nums; }

      .gCellR{
        height: var(--rowh);
        border-bottom:1px solid var(--grid);
        position:relative;
        background: rgba(255,255,255,0.02);
        background-image: var(--gridBg);
        background-repeat: repeat;
        background-size: auto 100%;
        overflow:hidden;
      }
      .lane{ position:absolute; left:0; right:0; top:0; bottom:0; }

      .bar{
        position:absolute;
        top:2px;
        bottom:2px;
        border-radius: 12px;
        box-shadow: 0 6px 18px rgba(0,0,0,0.25);
        overflow:visible;
      }
      .barInner{ position:absolute; inset:0; border-radius:12px; }

      .barLabel{
        position:absolute;
        top:50%;
        transform:translateY(-50%);
        font-size:11px;
        color: rgba(255,255,255,0.95);
        background: rgba(0,0,0,0.20);
        padding:2px 8px;
        border-radius:999px;
        white-space:nowrap;
        pointer-events:none;
      }
      .barLabel.in{ right:10px; }
      .barLabel.out{
        left: calc(100% + 8px);
        right:auto;
        background: rgba(0,0,0,0.10);
        border:1px solid rgba(255,255,255,0.10);
      }

      .extHatch{
        position:absolute;
        top:0; bottom:0;
        border-radius: 12px;
        background-image: repeating-linear-gradient(
          45deg,
          rgba(255,255,255,0.00) 0 6px,
          rgba(255,255,255,0.18) 6px 9px
        );
        mix-blend-mode: overlay;
        pointer-events:none;
      }

      .vline{
        position:absolute;
        top:0; bottom:0;
        width:2px;
        pointer-events:none;
        z-index: 5;
      }
      .vline.today{ background: var(--todayLine); }
      .vline.runway{ background: var(--runwayLine); }

      .vtag{
        position:absolute;
        top:6px;
        transform: translateX(-50%);
        font-size:11px;
        padding:2px 7px;
        border-radius:999px;
        background: rgba(0,0,0,0.18);
        border:1px solid rgba(255,255,255,0.10);
        color: rgba(255,255,255,0.85);
        pointer-events:none;
        z-index: 6;
        white-space:nowrap;
      }
      .vtag.runway{ color: var(--warn); border-color: rgba(255,209,138,0.30); }
    </style>

    <div class="ganttTopRow">
      <div class="ganttTitle">
        <b id="gTitle">Select a project</b>
      </div>

      <div class="ganttControlsRow">
        <span id="gWindow" class="pill">—</span>

        <div class="legend" title="Stage colors by discipline">
          <div class="legItem"><span class="sw" style="background:var(--arch)"></span>Architecture</div>
          <div class="legItem"><span class="sw" style="background:var(--interior)"></span>Interior</div>
          <div class="legItem"><span class="sw" style="background:var(--land)"></span>Landscape</div>
        </div>
      </div>
    </div>

    <div class="ganttOuter">
      <div class="ganttScroll">
        <div id="gGrid" class="ganttGrid"></div>
      </div>
    </div>

    <div class="note" id="gMsg"></div>
  `;

  const elTitle = mountEl.querySelector("#gTitle");
  const elWindow = mountEl.querySelector("#gWindow");
  const elGrid = mountEl.querySelector("#gGrid");
  const elMsg = mountEl.querySelector("#gMsg");

  // Drag-to-pan state
  let isDragging = false;
  let dragStartX = 0;
  let dragStartOffset = 0;
  let dragPaneWidthPx = 0;
  let rafId = 0;

  function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

  function getRightPaneWidth(){
    // Prefer header right pane, fallback to any right cell.
    const headR = mountEl.querySelector(".gHeadR");
    if(headR){
      const w = headR.getBoundingClientRect().width;
      if(Number.isFinite(w) && w > 50) return w;
    }
    const cellR = mountEl.querySelector(".gCellR");
    if(cellR){
      const w = cellR.getBoundingClientRect().width;
      if(Number.isFinite(w) && w > 50) return w;
    }
    return 0;
  }

  function scheduleRender(){
    if(rafId) return;
    rafId = requestAnimationFrame(()=>{
      rafId = 0;
      render();
    });
  }

  function pointerDown(e){
    // Only left-click drag
    if(e.button !== 0) return;
    if(!state.stages || !state.stages.length) return;
    if(ganttMaxStart <= 0) return;

    // Only start pan if the pointer is on the timeline side (right pane)
    const onRight = e.target && (e.target.closest?.(".gHeadR") || e.target.closest?.(".gCellR"));
    if(!onRight) return;

    dragPaneWidthPx = getRightPaneWidth();
    if(!(dragPaneWidthPx > 0)) return;

    isDragging = true;
    dragStartX = e.clientX;
    dragStartOffset = ganttOffset;

    const outer = mountEl.querySelector(".ganttOuter");
    if(outer) outer.classList.add("dragging");

    try{ e.target.setPointerCapture?.(e.pointerId); } catch(_){ /* ignore */ }
    e.preventDefault();
  }

  function pointerMove(e){
    if(!isDragging) return;
    const dx = e.clientX - dragStartX;

    // Map pixels to days across the fixed window.
    // Drag left (dx negative) => move window forward (offset increases)
    const daysFloat = (-dx / dragPaneWidthPx) * WINDOW_DAYS;
    const daysDelta = Math.round(daysFloat / PAN_STEP_DAYS) * PAN_STEP_DAYS;
    const next = clamp(dragStartOffset + daysDelta, 0, ganttMaxStart);

    if(next !== ganttOffset){
      ganttOffset = next;
      scheduleRender();
    }
    e.preventDefault();
  }

  function pointerUp(e){
    if(!isDragging) return;
    isDragging = false;
    const outer = mountEl.querySelector(".ganttOuter");
    if(outer) outer.classList.remove("dragging");
    e.preventDefault();
  }

  // Attach pan handlers to the outer wrapper (pointer events bubble)
  const outerForPan = mountEl.querySelector(".ganttOuter");
  if(outerForPan){
    outerForPan.addEventListener("pointerdown", pointerDown, { passive:false });
    outerForPan.addEventListener("pointermove", pointerMove, { passive:false });
    outerForPan.addEventListener("pointerup", pointerUp, { passive:false });
    outerForPan.addEventListener("pointercancel", pointerUp, { passive:false });
    outerForPan.addEventListener("pointerleave", pointerUp, { passive:false });
  }

  function monthShort(d){ return d.toLocaleString(undefined, { month:"short" }); }

  // Fiscal quarter (Apr–Mar)
  function fiscalQuarter(d){
    const m = d.getMonth();
    if(m >= 3 && m <= 5) return "Q1";
    if(m >= 6 && m <= 8) return "Q2";
    if(m >= 9 && m <= 11) return "Q3";
    return "Q4";
  }

  function buildMonthSegments(windowStart, windowEnd){
    const segs=[];
    let segStart = new Date(windowStart);
    while(segStart < windowEnd){
      const nextMonth = new Date(segStart.getFullYear(), segStart.getMonth()+1, 1);
      const segEnd = nextMonth < windowEnd ? nextMonth : windowEnd;
      const days = Math.max(1, Math.round((segEnd - segStart)/86400000));
      segs.push({
        label: `${monthShort(segStart)} ${segStart.getFullYear()}`,
        days,
        q: fiscalQuarter(segStart)
      });
      segStart = segEnd;
    }
    return segs;
  }

  function buildQuarterSegments(monthSegs){
    const out=[];
    for(const seg of monthSegs){
      const last = out[out.length-1];
      if(last && last.q === seg.q) last.days += seg.days;
      else out.push({ q: seg.q, days: seg.days });
    }
    return out;
  }

  function daysBetween(a,b){ return Math.round((b-a)/86400000); }

  function computeMinMaxDates(){
    const today = new Date();
    const dates = [today];

    if(state.runwayDate instanceof Date && !isNaN(state.runwayDate)) dates.push(state.runwayDate);

    for(const s of state.stages){
      if(s.start instanceof Date && !isNaN(s.start)) dates.push(s.start);
      if(s.end instanceof Date && !isNaN(s.end)) dates.push(s.end);
      if(s.extEnd instanceof Date && !isNaN(s.extEnd)) dates.push(s.extEnd);
    }

    if(!dates.length) return { min:null, max:null };
    const min = new Date(Math.min(...dates.map(d=>d.getTime())));
    const max = new Date(Math.max(...dates.map(d=>d.getTime())));
    return { min, max };
  }

  function setWindowLabel(windowStart){
    if(!windowStart){ elWindow.textContent = "—"; return; }
    const windowEnd = new Date(windowStart.getTime() + WINDOW_DAYS*86400000);
    elWindow.textContent = fmtWindow(windowStart, windowEnd);
  }

  function gridBackground(){
    const weekW = (100 / WINDOW_WEEKS).toFixed(6) + "%";
    const majorW = (100 / (WINDOW_WEEKS/4)).toFixed(6) + "%";
    return (
      `repeating-linear-gradient(to right, rgba(255,255,255,0.06) 0 1px, transparent 1px ${weekW}),` +
      `repeating-linear-gradient(to right, rgba(255,255,255,0.12) 0 1px, transparent 1px ${majorW})`
    );
  }

  function disciplineVar(d){
    if(d === "Interior") return "var(--interior)";
    if(d === "Landscape") return "var(--land)";
    return "var(--arch)";
  }

  function safePct(n){
    if(!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(100, n));
  }

  function escapeHtml(s){
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/\"/g,"&quot;").replace(/'/g,"&#039;");
  }

  function appendLines(lane, windowStart, windowEnd){
    const today = new Date();

    const addLine = (date, cls, tagText)=>{
      if(!(date instanceof Date) || isNaN(date)) return;
      if(date < windowStart || date > windowEnd) return;

      const off = (date - windowStart) / 86400000;
      const pct = (off / WINDOW_DAYS) * 100;

      const line = document.createElement("div");
      line.className = `vline ${cls}`;
      line.style.left = `${pct}%`;

      const tag = document.createElement("div");
      tag.className = `vtag ${cls}`;
      tag.style.left = `${pct}%`;
      tag.textContent = tagText;

      lane.appendChild(line);
      lane.appendChild(tag);
    };

    addLine(today, "today", "Today");
    if(state.runwayDate instanceof Date && !isNaN(state.runwayDate)){
      addLine(state.runwayDate, "runway", "Runway");
    }
  }

  function render(){
    elTitle.textContent = state.title || "Select a project";
    elMsg.textContent = "";
    elGrid.innerHTML = "";

    if(!state.stages || !state.stages.length){
      elMsg.textContent = "Upload a file, pick a project, and your timeline will appear here.";
      ganttMinDate = null;
      setWindowLabel(null);
      return;
    }

    const { min, max } = computeMinMaxDates();
    ganttMinDate = min;

    const totalSpan = Math.max(0, daysBetween(min, max));
    ganttMaxStart = Math.max(0, totalSpan - WINDOW_DAYS);
    ganttMaxStart = Math.floor(ganttMaxStart / PAN_STEP_DAYS) * PAN_STEP_DAYS;

    if(ganttMaxStart <= 0) ganttOffset = 0;
    if(ganttOffset > ganttMaxStart) ganttOffset = ganttMaxStart;

    const windowStart = new Date(ganttMinDate.getTime() + ganttOffset*86400000);
    const windowEnd = new Date(windowStart.getTime() + WINDOW_DAYS*86400000);
    setWindowLabel(windowStart);

    const monthSegs = buildMonthSegments(windowStart, windowEnd);
    const quarterSegs = buildQuarterSegments(monthSegs);
    const gridBg = gridBackground();

    // Header
    const headL = document.createElement("div");
    headL.className = "gHeadL";
    headL.innerHTML = `<b style="width:64px;">Stage</b><b style="width:84px; text-align:right;">Deliv.</b><b style="margin-left:auto;">Alert / PP</b>`;

    const headR = document.createElement("div");
    headR.className = "gHeadR";

    const stack = document.createElement("div");
    stack.className = "headStack";

    const qRow = document.createElement("div");
    qRow.className = "qRow";
    for(const q of quarterSegs){
      const div = document.createElement("div");
      div.className = "qSeg";
      div.style.flex = String(q.days);
      div.textContent = q.q;
      qRow.appendChild(div);
    }

    const mRow = document.createElement("div");
    mRow.className = "mRow";
    for(const seg of monthSegs){
      const div = document.createElement("div");
      div.className = "mSeg";
      div.style.flex = String(seg.days);
      div.textContent = seg.label; // "Oct 2026"
      mRow.appendChild(div);
    }

    stack.appendChild(qRow);
    stack.appendChild(mRow);
    headR.appendChild(stack);

    elGrid.appendChild(headL);
    elGrid.appendChild(headR);

    // Project PP row
    {
      const left = document.createElement("div");
      left.className = "gCellL";
      const pp = safePct(state.projectPP);
      left.innerHTML = `
        <div class="leftMain">
          <div class="stageName">PP</div>
          <div class="deliver">—</div>
          <div style="display:flex; gap:10px; align-items:center; margin-left:auto;">
            <div class="alert" title="Project progress shown on timeline">Project</div>
            <div class="ppCircle" title="Project progress">${pp == null ? "—" : `<span>${Math.round(pp)}%</span>`}</div>
          </div>
        </div>
      `;

      const right = document.createElement("div");
      right.className = "gCellR";
      right.style.setProperty("--gridBg", gridBg);

      const lane = document.createElement("div");
      lane.className = "lane";

      // background band
      const band = document.createElement("div");
      band.className = "bar";
      band.style.left = "0%";
      band.style.width = "100%";
      const innerBand = document.createElement("div");
      innerBand.className = "barInner";
      innerBand.style.background = "rgba(255,255,255,0.06)";
      band.appendChild(innerBand);
      lane.appendChild(band);

      // PP fill
      if(pp != null){
        const fill = document.createElement("div");
        fill.className = "bar";
        fill.style.left = "0%";
        fill.style.width = `${pp}%`;
        fill.style.top = "6px";
        fill.style.bottom = "6px";
        fill.style.borderRadius = "12px";
        fill.style.boxShadow = "none";

        const inner = document.createElement("div");
        inner.className = "barInner";
        inner.style.background = "var(--pp)";
        fill.appendChild(inner);

        const lbl = document.createElement("div");
        lbl.className = (pp >= 12) ? "barLabel in" : "barLabel out";
        lbl.textContent = `${Math.round(pp)}%`;
        fill.appendChild(lbl);

        lane.appendChild(fill);
      }

      appendLines(lane, windowStart, windowEnd);

      right.appendChild(lane);
      elGrid.appendChild(left);
      elGrid.appendChild(right);
    }

    // Stage rows
    for(const s of state.stages){
      const left = document.createElement("div");
      left.className = "gCellL";

      const delText = (s.deliverDone == null && s.deliverRemain == null)
        ? "—"
        : `${Number(s.deliverDone||0)}/${Number(s.deliverRemain||0)}`;

      const pp = safePct(s.stagePP);
      const alertKind = s.alert?.kind || "";
      const alertText = s.alert?.text || "";

      const alertHtml = alertText
        ? `<div class="alert ${alertKind}">${escapeHtml(alertText)}</div>`
        : `<div class="alert" style="opacity:.35;">—</div>`;

      left.innerHTML = `
        <div class="leftMain">
          <div class="stageName">${escapeHtml(s.label)}</div>
          <div class="deliver" title="Sent / Remaining deliverables">${escapeHtml(delText)}</div>
          <div style="display:flex; align-items:center; gap:10px; margin-left:auto;">
            ${alertHtml}
            <div class="ppCircle" title="Stage progress">${pp == null ? "—" : `<span>${Math.round(pp)}%</span>`}</div>
          </div>
        </div>
      `;

      const right = document.createElement("div");
      right.className = "gCellR";
      right.style.setProperty("--gridBg", gridBg);

      const lane = document.createElement("div");
      lane.className = "lane";

      appendLines(lane, windowStart, windowEnd);

      if(s.start || s.end){
        const a = s.start || s.end;
        const b = s.end || s.start;
        const start = (a <= b) ? a : b;
        const end = (a <= b) ? b : a;

        const startOff = (start - windowStart) / 86400000;
        const endOff = (end - windowStart) / 86400000;

        const clampedStart = Math.max(0, Math.min(WINDOW_DAYS, startOff));
        const clampedEnd = Math.max(0, Math.min(WINDOW_DAYS, endOff));

        const leftPct = (clampedStart / WINDOW_DAYS) * 100;
        const widthPct = (Math.max(clampedEnd - clampedStart, 1) / WINDOW_DAYS) * 100;

        const bar = document.createElement("div");
        bar.className = "bar";
        bar.style.left = `${leftPct}%`;
        bar.style.width = `${widthPct}%`;

        const inner = document.createElement("div");
        inner.className = "barInner";
        inner.style.background = disciplineVar(s.discipline);
        bar.appendChild(inner);

        // Ext hatch from planned end -> ext end
        if(s.extEnd instanceof Date && !isNaN(s.extEnd) && s.end instanceof Date && !isNaN(s.end)){
          if(s.extEnd.getTime() > s.end.getTime()){
            const extStartOff = (s.end - windowStart) / 86400000;
            const extEndOff = (s.extEnd - windowStart) / 86400000;

            const cs = Math.max(0, Math.min(WINDOW_DAYS, extStartOff));
            const ce = Math.max(0, Math.min(WINDOW_DAYS, extEndOff));

            const hatchLeftPct = (cs / WINDOW_DAYS) * 100;
            const hatchWidthPct = (Math.max(ce - cs, 1) / WINDOW_DAYS) * 100;

            const hatch = document.createElement("div");
            hatch.className = "extHatch";
            hatch.style.left = `${hatchLeftPct - leftPct}%`;
            hatch.style.width = `${hatchWidthPct}%`;
            hatch.style.backgroundColor = disciplineVar(s.discipline);
            hatch.style.opacity = "0.55";
            bar.appendChild(hatch);
          }
        }

        const inside = widthPct >= 10;
        const lbl = document.createElement("div");
        lbl.className = "barLabel " + (inside ? "in" : "out");
        lbl.textContent = s.label;
        bar.appendChild(lbl);

        lane.appendChild(bar);
      }

      right.appendChild(lane);
      elGrid.appendChild(left);
      elGrid.appendChild(right);
    }
  }

  function setData(next){
    state = { ...state, ...next };
    ganttOffset = 0;
    render();
  }

  function setRunway(date){
    state.runwayDate = date || null;
    render();
  }

  render();
  return { setData, setRunway };
}

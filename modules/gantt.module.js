export function initGantt(mountEl, opts = {}){
  const WINDOW_WEEKS = 52;
  const WINDOW_DAYS = WINDOW_WEEKS * 7;
  const SLIDER_STEP_DAYS = 28; // 4 weeks

  const fmtWindow = opts.fmtWindow || ((a,b)=>`${a.toISOString().slice(0,10)} → ${b.toISOString().slice(0,10)}`);

  let state = {
    title: "Select a project",
    projectPP: null, // number | null
    stages: [],       // array of stage objects
    runwayDate: null  // Date | null
  };

  let ganttMinDate = null;
  let ganttMaxStart = 0;
  let ganttOffset = 0;

  mountEl.innerHTML = `
    <style>
      .ganttTopRow{
        display:flex; align-items:center; justify-content:space-between; gap:10px;
        margin-bottom:10px; flex-wrap:wrap;
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
      input[type="range"]{ width:min(420px, 100%); accent-color:#9fb0d0; }

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
        grid-template-columns: 420px 1fr;
        align-items:stretch;
        min-width: 1040px;
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
      .gHeadL{ left:0; z-index: 30; border-right:1px solid var(--grid); padding:0 12px; display:flex; align-items:center; gap:10px; }
      .gHeadL b{ font-size:12px; color:var(--muted); font-weight:600; white-space:nowrap; }

      .headStack{ width:100%; display:flex; flex-direction:column; }
      .qRow, .mRow{
        display:flex; width:100%;
        font-size:11px; color:var(--muted);
        user-select:none; line-height:1;
      }
      .qSeg, .mSeg{
        border-left:1px solid rgba(255,255,255,0.06);
        padding:6px 8px;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
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

      .leftMain{ display:flex; align-items:center; gap:10px; min-width:0; width:100%; }
      .stageName{ font-size:12px; width:56px; flex:0 0 56px; color:var(--text); }

      .colNum{ font-size:12px; color:rgba(255,255,255,0.84); text-align:right; white-space:nowrap; }
      .deliv{ width:70px; flex:0 0 70px; }
      .hrs{ width:96px; flex:0 0 96px; }
      .stat{ width:70px; flex:0 0 70px; text-align:center; }

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

      /* Planned segment (solid) */
      .bar.planned{ z-index: 2; }

      /* Extension segment (hatched) */
      .bar.ext{
        z-index: 3;
        box-shadow: none;
        filter: saturate(1.02);
      }
      .bar.ext .barInner{
        background-image: repeating-linear-gradient(
          45deg,
          rgba(255,255,255,0.00) 0 6px,
          rgba(255,255,255,0.30) 6px 9px
        );
        background-blend-mode: overlay;
        outline: 1px dashed rgba(255,255,255,0.28);
        outline-offset: -1px;
      }

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

      /* (Replaced old extHatch overlay with a true extension segment) */

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
        <input id="gSlider" type="range" min="0" max="0" value="0" step="${SLIDER_STEP_DAYS}" disabled />
        <span id="gWindow" class="pill">/</span>

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
  const elSlider = mountEl.querySelector("#gSlider");
  const elWindow = mountEl.querySelector("#gWindow");
  const elGrid = mountEl.querySelector("#gGrid");
  const elMsg = mountEl.querySelector("#gMsg");

  elSlider.oninput = ()=>{
    ganttOffset = Number(elSlider.value || 0);
    ganttOffset = Math.round(ganttOffset / SLIDER_STEP_DAYS) * SLIDER_STEP_DAYS;
    elSlider.value = String(ganttOffset);
    render();
  };

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
    let cur = new Date(windowStart.getFullYear(), windowStart.getMonth(), 1);
    while(cur < windowEnd){
      const next = new Date(cur.getFullYear(), cur.getMonth()+1, 1);
      const start = (cur < windowStart) ? windowStart : cur;
      const end = (next > windowEnd) ? windowEnd : next;
      const days = Math.max(1, Math.round((end - start)/86400000));
      segs.push({ label: `${monthShort(cur)} ${cur.getFullYear()}`, days, q: fiscalQuarter(cur) });
      cur = next;
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

  function clamp(n,a,b){ return Math.max(a, Math.min(b, n)); }

  function segmentInWindow(windowStart, windowEnd, segStart, segEnd){
    if(!(segStart instanceof Date) || isNaN(segStart)) return null;
    if(!(segEnd instanceof Date) || isNaN(segEnd)) return null;

    const s = (segStart <= segEnd) ? segStart : segEnd;
    const e = (segStart <= segEnd) ? segEnd : segStart;

    // If the segment doesn't intersect the window at all, don't draw it.
    if(e <= windowStart) return null;
    if(s >= windowEnd) return null;

    const startOff = (s - windowStart) / 86400000;
    const endOff = (e - windowStart) / 86400000;

    const cs = clamp(startOff, 0, WINDOW_DAYS);
    const ce = clamp(endOff, 0, WINDOW_DAYS);

    const leftPct = (cs / WINDOW_DAYS) * 100;
    const widthPct = (Math.max(ce - cs, 1) / WINDOW_DAYS) * 100;

    return { leftPct, widthPct, cs, ce, s, e };
  }

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
    if(!windowStart){ elWindow.textContent = "/"; return; }
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

  function fmtNumOrSlash(v, maxFrac = 0){
    if(v == null || !Number.isFinite(Number(v))) return "/";
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: maxFrac }).format(Number(v));
  }

  function fmtStatus(s){
    const raw = String(s || "").trim();
    if(raw) return raw;
    return "/";
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
      elMsg.textContent = "Upload a file (or auto-load), pick a project, and your timeline will appear here.";
      ganttMinDate = null;
      elSlider.disabled = true;
      elSlider.min = "0"; elSlider.max = "0"; elSlider.value = "0";
      setWindowLabel(null);
      return;
    }

    const { min, max } = computeMinMaxDates();
    ganttMinDate = min;

    const totalSpan = Math.max(0, daysBetween(min, max));
    let maxStart = Math.max(0, totalSpan - WINDOW_DAYS);
    maxStart = Math.floor(maxStart / SLIDER_STEP_DAYS) * SLIDER_STEP_DAYS;
    ganttMaxStart = maxStart;

    elSlider.min = "0";
    elSlider.max = String(ganttMaxStart);
    elSlider.step = String(SLIDER_STEP_DAYS);

    if(ganttOffset > ganttMaxStart) ganttOffset = ganttMaxStart;
    elSlider.value = String(ganttOffset);
    elSlider.disabled = ganttMaxStart <= 0;

    const windowStart = new Date(ganttMinDate.getTime() + ganttOffset*86400000);
    const windowEnd = new Date(windowStart.getTime() + WINDOW_DAYS*86400000);
    setWindowLabel(windowStart);

    const monthSegs = buildMonthSegments(windowStart, windowEnd);
    const quarterSegs = buildQuarterSegments(monthSegs);
    const gridBg = gridBackground();

    // Header
    const headL = document.createElement("div");
    headL.className = "gHeadL";
    headL.innerHTML = `
      <b style="width:56px;">Stage</b>
      <b style="width:70px; text-align:right;">Deliv.</b>
      <b style="width:96px; text-align:right;">Hrs A/C</b>
      <b style="width:70px; text-align:center;">Status</b>
      <b style="margin-left:auto;">Alert</b>
    `;

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
      div.textContent = seg.label;
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
      const ppText = (pp == null) ? "/" : `${Math.round(pp)}%`;

      left.innerHTML = `
        <div class="leftMain">
          <div class="stageName">PP</div>
          <div class="colNum deliv">/</div>
          <div class="colNum hrs">/</div>
          <div class="colNum stat">${escapeHtml(ppText)}</div>
          <div style="margin-left:auto;">
            <div class="alert" title="Project progress row">Project</div>
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

      const delText = fmtNumOrSlash(s.deliverables, 0);
      const hrsText = (s.allocated == null && s.consumed == null)
        ? "/"
        : `${fmtNumOrSlash(s.allocated, 0)}/${fmtNumOrSlash(s.consumed, 0)}`;

      const pp = safePct(s.stagePP);
      const statusText = s.statusText ? s.statusText : (pp == null ? "/" : `${Math.round(pp)}%`);

      const alertKind = s.alert?.kind || "";
      const alertText = s.alert?.text || "";
      const alertHtml = alertText
        ? `<div class="alert ${alertKind}">${escapeHtml(alertText)}</div>`
        : `<div class="alert" style="opacity:.45;">/</div>`;

      left.innerHTML = `
        <div class="leftMain">
          <div class="stageName">${escapeHtml(s.label)}</div>
          <div class="colNum deliv" title="Deliverables">${escapeHtml(delText)}</div>
          <div class="colNum hrs" title="Allocated / Consumed hours">${escapeHtml(hrsText)}</div>
          <div class="colNum stat" title="Status Progress">${escapeHtml(fmtStatus(statusText))}</div>
          <div style="margin-left:auto;">${alertHtml}</div>
        </div>
      `;

      const right = document.createElement("div");
      right.className = "gCellR";
      right.style.setProperty("--gridBg", gridBg);

      const lane = document.createElement("div");
      lane.className = "lane";

      appendLines(lane, windowStart, windowEnd);

      // Timeline bar
      if(s.start || s.end || s.extEnd){
        const start = (s.start instanceof Date && !isNaN(s.start)) ? s.start : (s.end instanceof Date && !isNaN(s.end) ? s.end : null);
        const end = (s.end instanceof Date && !isNaN(s.end)) ? s.end : (s.start instanceof Date && !isNaN(s.start) ? s.start : null);
        const ext = (s.extEnd instanceof Date && !isNaN(s.extEnd)) ? s.extEnd : null;

        // Planned segment: start → end
        const plannedSeg = (start && end) ? segmentInWindow(windowStart, windowEnd, start, end) : null;

        // Extension segment: end → ext (only if ext > end)
        const hasExt = !!(ext && end && ext.getTime() > end.getTime());
        const extSeg = (hasExt && end && ext) ? segmentInWindow(windowStart, windowEnd, end, ext) : null;

        // Planned bar
        let plannedBar = null;
        if(plannedSeg){
          plannedBar = document.createElement("div");
          plannedBar.className = "bar planned";
          plannedBar.style.left = `${plannedSeg.leftPct}%`;
          plannedBar.style.width = `${plannedSeg.widthPct}%`;
          plannedBar.title = [
            `Stage: ${s.label}`,
            `Start: ${s.start instanceof Date && !isNaN(s.start) ? s.start.toDateString() : "/"}`,
            `End: ${s.end instanceof Date && !isNaN(s.end) ? s.end.toDateString() : "/"}`,
            `Ext: ${s.extEnd instanceof Date && !isNaN(s.extEnd) ? s.extEnd.toDateString() : "/"}`,
            `Deliverables: ${delText}`,
            `Hours A/C: ${hrsText}`,
            `Status: ${fmtStatus(statusText)}`
          ].join("\n");

          const inner = document.createElement("div");
          inner.className = "barInner";
          inner.style.background = disciplineVar(s.discipline);
          plannedBar.appendChild(inner);

          // If there's an extension that is visible, flatten the right edge so the hatch attaches cleanly.
          if(extSeg){
            plannedBar.style.borderRadius = "12px 0 0 12px";
            inner.style.borderRadius = "12px 0 0 12px";
          }

          lane.appendChild(plannedBar);
        }

        // Extension bar (hatched)
        let extBar = null;
        if(extSeg){
          extBar = document.createElement("div");
          extBar.className = "bar ext";
          extBar.style.left = `${extSeg.leftPct}%`;
          extBar.style.width = `${extSeg.widthPct}%`;
          extBar.title = [
            `Stage extension: ${s.label}`,
            `Planned end: ${s.end instanceof Date && !isNaN(s.end) ? s.end.toDateString() : "/"}`,
            `Extended end: ${s.extEnd instanceof Date && !isNaN(s.extEnd) ? s.extEnd.toDateString() : "/"}`
          ].join("\n");

          const inner = document.createElement("div");
          inner.className = "barInner";
          // Base color + hatch overlay
          inner.style.backgroundColor = disciplineVar(s.discipline);
          inner.style.backgroundImage = `repeating-linear-gradient(45deg, rgba(255,255,255,0.00) 0 6px, rgba(255,255,255,0.30) 6px 9px)`;
          inner.style.backgroundBlendMode = "overlay";
          inner.style.opacity = "0.85";
          extBar.appendChild(inner);

          // Rounded only on the far end if it is attached to a planned segment
          if(plannedBar){
            extBar.style.borderRadius = "0 12px 12px 0";
            inner.style.borderRadius = "0 12px 12px 0";
          }

          lane.appendChild(extBar);
        }

        // Label (prefer planned segment, else extension)
        const host = plannedBar || extBar;
        const hostSeg = plannedSeg || extSeg;
        if(host && hostSeg){
          const inside = hostSeg.widthPct >= 10;
          const lbl = document.createElement("div");
          lbl.className = "barLabel " + (inside ? "in" : "out");
          lbl.textContent = s.label;
          host.appendChild(lbl);
        }
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

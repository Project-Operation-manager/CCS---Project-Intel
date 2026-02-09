export function initGantt(mountEl, opts = {}){
  const WINDOW_WEEKS = 52;
  const WINDOW_DAYS = WINDOW_WEEKS * 7;
  const SLIDER_STEP_DAYS = 28; // 4 weeks

  const fmtWindow = opts.fmtWindow || ((a,b)=>`${a.toISOString().slice(0,10)} → ${b.toISOString().slice(0,10)}`);

  let state = {
    title: "Select a project",
    projectPP: null,
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
        margin-bottom:10px; flex-wrap:wrap;
      }
      .ganttTitle{ display:flex; align-items:baseline; gap:10px; min-width:240px; max-width: 55%; }
      .ganttTitle b{
        font-size:14px; font-weight:900; color:var(--text);
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
        max-width: 520px;
      }

      .ganttControlsRow{
        display:flex; align-items:center; gap:10px; flex-wrap:wrap; justify-content:flex-end;
        flex:1 1 auto;
      }

      input[type="range"]{ width:min(420px, 100%); accent-color: rgba(15,23,42,0.45); }

      .legend{
        display:flex; align-items:center; gap:10px;
        padding:8px 10px;
        border:1px solid var(--legendBorder);
        border-radius:12px;
        background: rgba(255,255,255,0.80);
        box-shadow: 0 12px 26px rgba(0,0,0,0.08);
      }
      .legItem{ display:flex; align-items:center; gap:8px; font-size:12px; color:var(--muted); font-weight:800; }
      .sw{ width:10px; height:10px; border-radius:4px; border:1px solid rgba(15,23,42,0.12); }

      .ganttOuter{
        border:1px solid rgba(15,23,42,0.10);
        border-radius:14px;
        overflow:hidden;
        background: rgba(255,255,255,0.65);
        box-shadow: 0 18px 46px rgba(0,0,0,0.10);
      }
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
        background: rgba(255,255,255,0.92);
        border-bottom:1px solid rgba(15,23,42,0.10);
      }
      .gHeadL{
        left:0;
        z-index: 30;
        border-right:1px solid rgba(15,23,42,0.10);
        padding:0 12px;
        display:flex;
        align-items:center;
        gap:10px;
      }
      .gHeadL b{ font-size:12px; color:var(--muted); font-weight:900; white-space:nowrap; }

      .headStack{ width:100%; display:flex; flex-direction:column; }
      .qRow, .mRow{
        display:flex; width:100%;
        font-size:11px; color:var(--muted);
        user-select:none; line-height:1;
      }
      .qSeg, .mSeg{
        border-left:1px solid rgba(15,23,42,0.06);
        padding:6px 8px;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
      }
      .qSeg{ color: rgba(15,23,42,0.70); font-weight:900; padding-top:8px; padding-bottom:5px; }
      .mSeg{ padding-top:5px; padding-bottom:8px; }

      .gCellL{
        height: var(--rowh);
        border-bottom:1px solid rgba(15,23,42,0.08);
        border-right:1px solid rgba(15,23,42,0.08);
        display:flex;
        align-items:center;
        gap:10px;
        padding:0 12px;
        background: rgba(255,255,255,0.72);
        position: sticky;
        left: 0;
        z-index: 10;
      }
      .gCellL:nth-of-type(4n+1){ background: rgba(255,255,255,0.60); }

      .leftMain{ display:flex; align-items:center; gap:10px; min-width:0; width:100%; }
      .stageName{ font-size:12px; width:56px; flex:0 0 56px; color:var(--text); font-weight:900; }

      .colNum{ font-size:12px; color: rgba(15,23,42,0.88); text-align:right; white-space:nowrap; font-weight:900; }
      .deliv{ width:70px; flex:0 0 70px; }
      .hrs{ width:96px; flex:0 0 96px; }
      .stat{ width:70px; flex:0 0 70px; text-align:center; }

      .alert{
        font-size:11px;
        padding:6px 9px;
        border-radius:999px;
        border:1px solid rgba(15,23,42,0.10);
        background: rgba(255,255,255,0.85);
        color: var(--muted);
        white-space:nowrap;
        flex:0 0 auto;
        box-shadow: 0 10px 22px rgba(0,0,0,0.06);
        font-weight:900;
      }
      .alert.ok{ color: var(--ok); border-color: rgba(15,138,75,0.22); }
      .alert.bad{ color: var(--bad); border-color: rgba(198,40,40,0.22); }
      .alert.warn{ color: var(--warn); border-color: rgba(178,106,0,0.22); }

      .gCellR{
        height: var(--rowh);
        border-bottom:1px solid rgba(15,23,42,0.08);
        position:relative;
        background: rgba(255,255,255,0.60);
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
        box-shadow: 0 10px 24px rgba(0,0,0,0.12);
        overflow:visible;
      }
      .barInner{ position:absolute; inset:0; border-radius:12px; }

      .barLabel{
        position:absolute;
        top:50%;
        transform:translateY(-50%);
        font-size:11px;
        color: rgba(15,23,42,0.90);
        background: rgba(255,255,255,0.85);
        border:1px solid rgba(15,23,42,0.10);
        padding:2px 8px;
        border-radius:999px;
        white-space:nowrap;
        pointer-events:none;
        font-weight:900;
      }
      .barLabel.in{ right:10px; }
      .barLabel.out{
        left: calc(100% + 8px);
        right:auto;
      }

      .extHatch{
        position:absolute;
        top:0; bottom:0;
        border-radius: 12px;
        background-image: repeating-linear-gradient(
          45deg,
          rgba(255,255,255,0.00) 0 6px,
          rgba(255,255,255,0.45) 6px 9px
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
        background: rgba(255,255,255,0.90);
        border:1px solid rgba(15,23,42,0.10);
        color: rgba(15,23,42,0.82);
        pointer-events:none;
        z-index: 6;
        white-space:nowrap;
        font-weight:900;
      }
      .vtag.runway{ color: var(--warn); border-color: rgba(178,106,0,0.22); }
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
      `repeating-linear-gradient(to right, rgba(15,23,42,0.06) 0 1px, transparent 1px ${weekW}),` +
      `repeating-linear-gradient(to right, rgba(15,23,42,0.10) 0 1px, transparent 1px ${majorW})`
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
      elMsg.textContent = "Pick a project from landing (or upload data) and the timeline will appear here.";
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
    const qSegs = buildQuarterSegments(monthSegs);

    const rowH = 44;
    elGrid.style.setProperty("--rowh", rowH + "px");
    elGrid.style.setProperty("--gridBg", gridBackground());

    // Header left
    const headL = document.createElement("div");
    headL.className = "gHeadL";
    headL.innerHTML = `<b>Stage</b><span class="pill" style="margin-left:auto;">%</span>`;
    elGrid.appendChild(headL);

    // Header right (quarters + months)
    const headR = document.createElement("div");
    headR.className = "gHeadR";

    const headStack = document.createElement("div");
    headStack.className = "headStack";

    const qRow = document.createElement("div");
    qRow.className = "qRow";
    for(const q of qSegs){
      const div = document.createElement("div");
      div.className = "qSeg";
      div.style.flex = `${q.days} 0 0`;
      div.textContent = q.q;
      qRow.appendChild(div);
    }

    const mRow = document.createElement("div");
    mRow.className = "mRow";
    for(const m of monthSegs){
      const div = document.createElement("div");
      div.className = "mSeg";
      div.style.flex = `${m.days} 0 0`;
      div.textContent = m.label;
      mRow.appendChild(div);
    }

    headStack.appendChild(qRow);
    headStack.appendChild(mRow);
    headR.appendChild(headStack);
    elGrid.appendChild(headR);

    // Rows
    for(const s of state.stages){
      const left = document.createElement("div");
      left.className = "gCellL";

      const pp = safePct(Number(s.stagePP));
      left.innerHTML = `
        <div class="leftMain">
          <div class="stageName">${escapeHtml(s.label || "/")}</div>
          <div class="alert ${escapeHtml(s?.alert?.kind || "")}">${escapeHtml(s?.alert?.text || "/")}</div>
          <div style="margin-left:auto;" class="colNum">${pp == null ? "/" : `${Math.round(pp)}%`}</div>
        </div>
      `;
      elGrid.appendChild(left);

      const right = document.createElement("div");
      right.className = "gCellR";

      const lane = document.createElement("div");
      lane.className = "lane";

      // Bars
      const start = (s.start instanceof Date && !isNaN(s.start)) ? s.start : null;
      const end = (s.end instanceof Date && !isNaN(s.end)) ? s.end : null;
      const extEnd = (s.extEnd instanceof Date && !isNaN(s.extEnd)) ? s.extEnd : null;

      const effectiveEnd = (extEnd && end && extEnd > end) ? extEnd : (extEnd || end);

      if(start && effectiveEnd){
        const startOff = (start - windowStart)/86400000;
        const endOff = (effectiveEnd - windowStart)/86400000;

        const x0 = (startOff / WINDOW_DAYS) * 100;
        const x1 = (endOff / WINDOW_DAYS) * 100;
        const leftPct = Math.max(-5, Math.min(105, x0));
        const widthPct = Math.max(0.2, Math.min(110, x1) - leftPct);

        const bar = document.createElement("div");
        bar.className = "bar";
        bar.style.left = `${leftPct}%`;
        bar.style.width = `${widthPct}%`;

        const inner = document.createElement("div");
        inner.className = "barInner";
        inner.style.background = disciplineVar(s.discipline);

        bar.appendChild(inner);

        // Hatch only if extension exists beyond planned end
        if(end && extEnd && extEnd > end){
          const end1 = (end - windowStart)/86400000;
          const xEnd = (end1 / WINDOW_DAYS) * 100;
          const hatchLeft = Math.max(0, xEnd - leftPct);
          const hatch = document.createElement("div");
          hatch.className = "extHatch";
          hatch.style.left = `${hatchLeft}%`;
          hatch.style.width = `${Math.max(0, widthPct - hatchLeft)}%`;
          bar.appendChild(hatch);
        }

        const lbl = document.createElement("div");
        lbl.className = "barLabel in";
        lbl.textContent = `${escapeHtml(s.label || "")}`;
        bar.appendChild(lbl);

        lane.appendChild(bar);
      }

      appendLines(lane, windowStart, windowEnd);

      right.appendChild(lane);
      elGrid.appendChild(right);
    }
  }

  function setData(next){
    state = {
      title: next?.title ?? state.title,
      projectPP: (next?.projectPP ?? state.projectPP),
      stages: Array.isArray(next?.stages) ? next.stages : (state.stages || []),
      runwayDate: next?.runwayDate ?? state.runwayDate
    };
    render();
  }

  function setRunway(date){
    state.runwayDate = date;
    render();
  }

  // initial render
  render();

  return { setData, setRunway };
}

export function initGantt(mountEl, opts = {}){
  const WINDOW_WEEKS = 52;
  const WINDOW_DAYS = WINDOW_WEEKS * 7;
  const SLIDER_STEP_DAYS = 28; // 4 weeks

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

  // Build DOM skeleton
  mountEl.innerHTML = `
    <div class="ganttTopRow">
      <div class="ganttTitle">
        <b id="gTitle">Select a project</b>
      </div>

      <div class="ganttControlsRow">
        <input id="gSlider" type="range" min="0" max="0" value="0" step="${SLIDER_STEP_DAYS}" disabled />
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

  function monthShort(d){
    return d.toLocaleString(undefined, { month:"short" });
  }

  // Fiscal quarter (Apr-Mar)
  function fiscalQuarter(d){
    const m = d.getMonth(); // 0=Jan
    if(m >= 3 && m <= 5) return "Q1";     // Apr-Jun
    if(m >= 6 && m <= 8) return "Q2";     // Jul-Sep
    if(m >= 9 && m <= 11) return "Q3";    // Oct-Dec
    return "Q4";                          // Jan-Mar
  }

  function buildMonthSegments(windowStart, windowEnd){
    const segs=[];
    let cur = new Date(windowStart.getFullYear(), windowStart.getMonth(), 1);
    if(cur > windowStart) cur = new Date(windowStart.getFullYear(), windowStart.getMonth(), 1);
    // move cur to the windowStart month boundary
    cur = new Date(windowStart.getFullYear(), windowStart.getMonth(), 1);

    // ensure start at windowStart for segment day counting
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
      if(last && last.q === seg.q){
        last.days += seg.days;
      } else {
        out.push({ q: seg.q, days: seg.days });
      }
    }
    return out;
  }

  function daysBetween(a,b){ return Math.round((b-a)/86400000); }

  function computeMinMaxDates(){
    const today = new Date();
    const dates = [];

    if(state.runwayDate instanceof Date && !isNaN(state.runwayDate)) dates.push(state.runwayDate);
    dates.push(today);

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
    if(!windowStart){
      elWindow.textContent = "—";
      return;
    }
    const windowEnd = new Date(windowStart.getTime() + WINDOW_DAYS*86400000);
    elWindow.textContent = fmtWindow(windowStart, windowEnd);
  }

  function gridBackground(){
    // weekly + 4-week major
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

  function render(){
    elTitle.textContent = state.title || "Select a project";
    elMsg.textContent = "";

    elGrid.innerHTML = "";

    if(!state.stages || !state.stages.length){
      elMsg.textContent = "Upload a file, pick a project, and your timeline will appear here.";
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
    maxStart = Math.floor(maxStart / 28) * 28;
    ganttMaxStart = maxStart;

    elSlider.min = "0";
    elSlider.max = String(ganttMaxStart);
    elSlider.step = "28";
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
    headL.innerHTML = `<b style="width:64px;">Stage</b><b style="width:72px; text-align:right;">Deliv.</b><b style="margin-left:auto;">Alert / PP</b>`;

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

    // Project PP row (above stages)
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

      // draw a full-width project PP progress bar band
      const lane = document.createElement("div");
      lane.className = "lane";

      const band = document.createElement("div");
      band.className = "bar";
      band.style.left = "0%";
      band.style.width = "100%";

      const inner = document.createElement("div");
      inner.className = "barInner";
      inner.style.background = "rgba(255,255,255,0.06)";
      band.appendChild(inner);

      if(pp != null){
        const fill = document.createElement("div");
        fill.className = "bar";
        fill.style.left = "0%";
        fill.style.width = `${pp}%`;
        fill.style.top = "6px";
        fill.style.bottom = "6px";
        fill.style.borderRadius = "10px";
        fill.style.boxShadow = "none";
        fill.style.background = "var(--pp)";
        lane.appendChild(fill);

        const lbl = document.createElement("div");
        lbl.className = "barLabel in";
        lbl.textContent = `${Math.round(pp)}%`;
        // if very small, put outside
        if(pp < 12){
          lbl.className = "barLabel out";
        }
        fill.appendChild(lbl);
      }

      lane.appendChild(band);

      // add today/runway lines
      appendLines(lane, windowStart, windowEnd);

      right.appendChild(lane);
      elGrid.appendChild(left);
      elGrid.appendChild(right);
    }

    // Stage rows
    for(const s of state.stages){
      const left = document.createElement("div");
      left.className = "gCellL";

      const done = (s.deliverDone == null && s.deliverRemain == null)
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
          <div class="deliver" title="Sent / Remaining deliverables">${escapeHtml(done)}</div>
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

      // today & runway lines per lane
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

            const l = (cs / WINDOW_DAYS) * 100;
            const w = (Math.max(ce - cs, 1) / WINDOW_DAYS) * 100;

            const hatch = document.createElement("div");
            hatch.className = "extHatch";
            hatch.style.left = `${l - leftPct}%`;     // relative inside bar
            hatch.style.width = `${w}%`;
            hatch.style.backgroundColor = disciplineVar(s.discipline);
            hatch.style.opacity = "0.55";
            bar.appendChild(hatch);
          }
        }

        // Label inside if fits, else outside
        const lbl = document.createElement("div");
        const inside = widthPct >= 10;
        lbl.className = "barLabel " + (inside ? "in" : "out");
        lbl.textContent = s.label;
        bar.appendChild(lbl);

        bar.title = `${s.label} • ${s.discipline}`;

        lane.appendChild(bar);
      }

      right.appendChild(lane);
      elGrid.appendChild(left);
      elGrid.appendChild(right);
    }
  }

  function appendLines(lane, windowStart, windowEnd){
    const today = new Date();
    const addLine = (date, cls, tagText)=>{
      if(!(date instanceof Date) || isNaN(date)) return;
      if(date < windowStart || date > windowEnd) return;

      const off = (date - windowStart) / 86400000;
      const pct = (off / (WINDOW_DAYS)) * 100;

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

  function escapeHtml(s){
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/\"/g,"&quot;").replace(/'/g,"&#039;");
  }

  function setData(next){
    state = { ...state, ...next };
    // reset offset when project changes
    ganttOffset = 0;
    render();
  }

  function setRunway(date){
    state.runwayDate = date || null;
    render();
  }

  // first render
  render();

  return { setData, setRunway };
}

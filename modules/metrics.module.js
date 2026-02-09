export function initMetrics(mountEl, opts = {}){
  const onRunwaySimulated = opts.onRunwaySimulated || (()=>{});

  let chart = null;

  let state = {
    title: "",
    hours: { AH:null, TCH:null, BH:null },
    people: [],
    deploymentNames: [],
    runway: null
  };

  mountEl.innerHTML = `
    <style>
      .mSection{ display:flex; flex-direction:column; gap:14px; }

      .mTitle{ font-size:13px; font-weight:900; color: var(--text); }
      .mNote{ margin-top:6px; color: var(--muted); font-size:12px; line-height:1.35; }

      .mPanel{
        margin-top:10px;
        border:1px solid rgba(15,23,42,0.10);
        border-radius:14px;
        background: rgba(255,255,255,0.75);
        padding:10px;
        box-shadow: 0 14px 34px rgba(0,0,0,0.10);
      }

      .mDivider{ border-top:1px solid rgba(15,23,42,0.08); padding-top:14px; }

      .mGrid2{
        display:grid;
        grid-template-columns: 180px 1fr;
        gap:10px;
        align-items:center;
        margin-top:10px;
      }

      .mLegend{
        border:1px solid rgba(15,23,42,0.10);
        border-radius:12px;
        padding:10px;
        max-height: 210px;
        overflow:auto;
        background: rgba(255,255,255,0.75);
        box-shadow: 0 14px 34px rgba(0,0,0,0.10);
      }

      .mBtn{
        border:1px solid rgba(15,23,42,0.14);
        background: rgba(255,255,255,0.90);
        color: rgba(15,23,42,0.90);
        border-radius:12px;
        padding:10px 12px;
        cursor:pointer;
        font-weight:900;
        box-shadow: 0 10px 26px rgba(0,0,0,0.08);
      }
      .mBtn:hover{ border-color: rgba(15,23,42,0.24); box-shadow: 0 14px 34px rgba(0,0,0,0.12); }

      .pill{
        font-size:12px;
        padding:6px 10px;
        border-radius:999px;
        border:1px solid rgba(15,23,42,0.12);
        background: rgba(255,255,255,0.85);
        color: rgba(15,23,42,0.85);
        font-weight:900;
      }

      .simWrap{
        margin-top:10px;
        border:1px solid rgba(15,23,42,0.10);
        border-radius:12px;
        background: rgba(255,255,255,0.75);
        overflow:hidden;
        box-shadow: 0 14px 34px rgba(0,0,0,0.10);
      }

      .simRow{
        display:grid;
        grid-template-columns: 1fr 90px 44px;
        gap:8px;
        padding:10px;
        border-bottom:1px solid rgba(15,23,42,0.08);
        align-items:center;
      }

      .simName{
        font-size:12px;
        font-weight:900;
        color: rgba(15,23,42,0.90);
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
      }

      .simInput{
        width:100%;
        border-radius:10px;
        border:1px solid rgba(15,23,42,0.12);
        background: rgba(255,255,255,0.95);
        padding:8px 10px;
        font-weight:900;
        color: rgba(15,23,42,0.90);
        outline:none;
      }

      .simUnit{
        font-size:12px;
        font-weight:900;
        color: rgba(15,23,42,0.70);
        text-align:center;
      }
    </style>

    <div class="mSection">

      <div>
        <div class="mTitle">Hours utilization</div>
        <div class="mNote">Bar fills by TCH vs AH. If TCH exceeds AH, the extra is hatched. Missing values show “/”.</div>
        <div id="hoursBar" class="mPanel"></div>
      </div>

      <div class="mDivider">
        <div class="mTitle">Deployment (DYT)</div>
        <div class="mNote">Uses absolute percentages if present (e.g., Name (10%)). If only names exist, they’re listed with “/”.</div>

        <div class="mGrid2">
          <canvas id="deployChart" height="170"></canvas>
          <div id="deployLegend" class="mLegend"></div>
        </div>
      </div>

      <div class="mDivider">
        <div class="mTitle">Runway simulator</div>
        <div class="mNote">Edit each person’s % (absolute). Runway = BH ÷ ((sum(%)/100) × 174.25).</div>

        <div id="runwaySummary" style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;"></div>
        <div id="simList" class="simWrap"></div>

        <div style="display:flex; gap:10px; margin-top:10px; flex-wrap:wrap;">
          <button id="resetSim" type="button" class="mBtn">Reset to file values</button>
        </div>
      </div>

    </div>
  `;

  const elHoursBar = mountEl.querySelector("#hoursBar");
  const elDeployLegend = mountEl.querySelector("#deployLegend");
  const elRunwaySummary = mountEl.querySelector("#runwaySummary");
  const elSimList = mountEl.querySelector("#simList");
  const elReset = mountEl.querySelector("#resetSim");

  let baselinePeople = [];
  let simPeople = [];

  function fmt(n, maxFrac=1){
    if(n == null) return "/";
    if(!Number.isFinite(n)) return "/";
    return new Intl.NumberFormat(undefined,{maximumFractionDigits:maxFrac}).format(n);
  }

  function computeRunway(people, BH){
    const factorDecimal = (people||[]).reduce((s,p)=>s + (p.pct/100), 0);
    const monthlyBurn = factorDecimal * 174.25;

    if(BH == null || !Number.isFinite(BH)) return { runwayMonths: null, runwayDate: null, factorDecimal, monthlyBurn };
    if(!Number.isFinite(monthlyBurn) || monthlyBurn <= 0) return { runwayMonths: null, runwayDate: null, factorDecimal, monthlyBurn };
    if(BH <= 0) return { runwayMonths: 0, runwayDate: null, factorDecimal, monthlyBurn };

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

  function renderHoursUtil(hours){
    const AH = (hours?.AH == null) ? null : Math.max(0, Number(hours.AH));
    const TCH = (hours?.TCH == null) ? null : Math.max(0, Number(hours.TCH));
    const BH = (hours?.BH == null) ? null : Number(hours.BH);

    const hasAny = (AH != null) || (TCH != null) || (BH != null);

    if(!hasAny){
      elHoursBar.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px; flex-wrap:wrap;">
          <span class="pill">AH: /</span>
          <span class="pill">TCH: /</span>
          <span class="pill">BH: /</span>
        </div>
        <div class="mNote">/</div>
      `;
      return;
    }

    const a = (AH == null) ? 0 : AH;
    const t = (TCH == null) ? 0 : TCH;

    const exceed = Math.max(0, t - a);
    const within = Math.min(a, t);

    const base = Math.max(a, 1);
    const extraCap = base * 0.35;
    const shownExtra = Math.min(exceed, extraCap);
    const totalScale = base + shownExtra;

    const withinPct = (within / totalScale) * 100;
    const basePct = (a / totalScale) * 100;
    const exceedPct = (shownExtra / totalScale) * 100;

    const insideLabel = (pct)=> pct >= 14;

    elHoursBar.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px; flex-wrap:wrap;">
        <span class="pill">AH: ${escapeHtml(fmt(AH,1))}</span>
        <span class="pill">TCH: ${escapeHtml(fmt(TCH,1))}</span>
        <span class="pill">BH: ${escapeHtml(fmt(BH,1))}</span>
      </div>

      <div style="
        position:relative;
        height:20px;
        border-radius:999px;
        background: rgba(15,23,42,0.06);
        border:1px solid rgba(15,23,42,0.10);
        overflow:visible;
      ">
        <div style="position:absolute; left:${basePct}%; top:-6px; bottom:-6px; width:2px; background:rgba(15,23,42,0.18);"></div>

        <div style="
          position:absolute; left:0; top:0; bottom:0;
          width:${withinPct}%;
          border-radius:999px;
          background: var(--arch);
          display:flex; align-items:center;
          justify-content:${insideLabel(withinPct) ? "center" : "flex-start"};
        ">
          ${insideLabel(withinPct)
            ? `<span style="font-size:11px; color:rgba(15,23,42,0.92); padding:0 8px; white-space:nowrap; font-weight:900;">${escapeHtml(fmt(within,1))}</span>`
            : `<span style="position:absolute; left:calc(${withinPct}% + 8px); font-size:11px; color:rgba(15,23,42,0.82); white-space:nowrap; font-weight:900;">${escapeHtml(fmt(within,1))}</span>`
          }
        </div>

        ${exceed > 0 ? `
          <div style="
            position:absolute;
            left:${basePct}%;
            top:0; bottom:0;
            width:${exceedPct}%;
            border-radius:999px;
            background-image: repeating-linear-gradient(
              45deg,
              rgba(255,255,255,0.00) 0 6px,
              rgba(255,255,255,0.45) 6px 9px
            );
            background-color: rgba(198,40,40,0.55);
            border:1px solid rgba(198,40,40,0.22);
          "></div>
        ` : ``}
      </div>
    `;
  }

  function renderDeployment(people){
    const items = Array.isArray(people) ? people.slice() : [];
    const labels = items.map(p => p.name || "(Blank)");
    const data = items.map(p => Number(p.pct || 0));

    // Legend
    elDeployLegend.innerHTML = labels.length
      ? labels.map((name, i)=>`
          <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:6px 0; border-bottom:1px solid rgba(15,23,42,0.08);">
            <div style="font-size:12px; font-weight:900; color:rgba(15,23,42,0.88); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
              ${escapeHtml(name)}
            </div>
            <div style="font-size:12px; font-weight:900; color:rgba(15,23,42,0.72);">${escapeHtml(fmt(data[i],1))}%</div>
          </div>
        `).join("")
      : `<div class="mNote">/</div>`;

    const canvas = mountEl.querySelector("#deployChart");
    if(!canvas || typeof Chart === "undefined") return;

    if(chart){
      chart.destroy();
      chart = null;
    }

    chart = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels,
        datasets: [{
          data
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display:false },
          tooltip: {
            callbacks: {
              label: (ctx)=> `${ctx.label}: ${ctx.parsed}%`
            }
          }
        },
        cutout: "62%"
      }
    });
  }

  function renderRunwaySummary(runway){
    const months = runway?.runwayMonths;
    const date = runway?.runwayDate;

    const monthsTxt = (months == null) ? "/" : (Number.isFinite(months) ? months.toFixed(2) : "/");
    const dateTxt = (date instanceof Date && !isNaN(date)) ? date.toLocaleDateString() : "/";

    elRunwaySummary.innerHTML = `
      <span class="pill">Runway (months): ${escapeHtml(monthsTxt)}</span>
      <span class="pill">Runway date: ${escapeHtml(dateTxt)}</span>
    `;
  }

  function renderSimList(){
    if(!simPeople.length){
      elSimList.innerHTML = `<div style="padding:10px;" class="mNote">/</div>`;
      return;
    }

    elSimList.innerHTML = simPeople.map((p, idx)=>`
      <div class="simRow">
        <div class="simName" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
        <input class="simInput" data-idx="${idx}" type="number" min="0" step="0.1" value="${escapeHtml(String(p.pct ?? 0))}" />
        <div class="simUnit">%</div>
      </div>
    `).join("");

    for(const input of elSimList.querySelectorAll(".simInput")){
      input.addEventListener("input", ()=>{
        const i = Number(input.getAttribute("data-idx"));
        const v = Number(input.value);
        if(Number.isFinite(i) && simPeople[i]){
          simPeople[i].pct = Number.isFinite(v) ? v : 0;
          const rw = computeRunway(simPeople, state.hours?.BH);
          state.runway = rw;
          renderRunwaySummary(rw);
          onRunwaySimulated(rw);
        }
      });
    }
  }

  elReset.addEventListener("click", ()=>{
    simPeople = baselinePeople.map(p => ({...p}));
    const rw = computeRunway(simPeople, state.hours?.BH);
    state.runway = rw;
    renderRunwaySummary(rw);
    renderSimList();
    onRunwaySimulated(rw);
  });

  function setData(next){
    state = {
      ...state,
      ...next,
      hours: next?.hours ?? state.hours,
      people: Array.isArray(next?.people) ? next.people : state.people
    };

    // Setup baseline simulator from file values
    baselinePeople = (state.people || []).map(p => ({ name: p.name, pct: Number(p.pct || 0) }));
    simPeople = baselinePeople.map(p => ({...p}));

    // Compute runway
    const rw = computeRunway(simPeople, state.hours?.BH);
    state.runway = rw;

    renderHoursUtil(state.hours);
    renderDeployment(state.people);
    renderRunwaySummary(rw);
    renderSimList();

    onRunwaySimulated(rw);
  }

  return { setData };
}

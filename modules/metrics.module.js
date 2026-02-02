export function initMetrics(mountEl, opts = {}){
  const onRunwaySimulated = opts.onRunwaySimulated || (()=>{});

  let chart = null;

  let state = {
    title: "",
    hours: { AH:0, TCH:0, BH:0 },
    people: [],
    runway: null
  };

  mountEl.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:14px;">

      <div>
        <b style="font-size:13px;">Hours utilization</b>
        <div class="note" style="margin-top:6px;">Bar fills by TCH vs AH. If TCH exceeds AH, the extra is hatched.</div>

        <div id="hoursBar" style="
          margin-top:10px;
          border:1px solid rgba(255,255,255,0.10);
          border-radius:14px;
          background: rgba(0,0,0,0.10);
          padding:10px;
        "></div>
      </div>

      <div style="border-top:1px solid rgba(255,255,255,0.06); padding-top:14px;">
        <b style="font-size:13px;">Deployment (DYT)</b>
        <div class="note" style="margin-top:6px;">Shows absolute percentages as in your file. Unallocated is shown as the remaining % to 100.</div>

        <div style="display:grid; grid-template-columns: 180px 1fr; gap:10px; align-items:center; margin-top:10px;">
          <canvas id="deployChart" height="170"></canvas>
          <div id="deployLegend" style="
            border:1px solid rgba(255,255,255,0.10);
            border-radius:12px;
            padding:10px;
            max-height: 210px;
            overflow:auto;
            background: rgba(0,0,0,0.10);
          "></div>
        </div>
      </div>

      <div style="border-top:1px solid rgba(255,255,255,0.06); padding-top:14px;">
        <b style="font-size:13px;">Runway simulator</b>
        <div class="note" style="margin-top:6px;">
          Edit each person’s % (absolute). Runway = BH ÷ ((sum(%)/100) × 174.25).
        </div>

        <div id="runwaySummary" style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;"></div>

        <div id="simList" style="
          margin-top:10px;
          border:1px solid rgba(255,255,255,0.10);
          border-radius:12px;
          background: rgba(0,0,0,0.10);
          overflow:hidden;
        "></div>

        <div style="display:flex; gap:10px; margin-top:10px; flex-wrap:wrap;">
          <button id="resetSim" type="button" style="
            border:1px solid rgba(255,255,255,0.12);
            background:#0f172a;
            color:rgba(255,255,255,0.86);
            border-radius:12px;
            padding:10px 12px;
            cursor:pointer;
          ">Reset to file values</button>
        </div>
      </div>

    </div>
  `;

  const elHoursBar = mountEl.querySelector("#hoursBar");
  const elDeployLegend = mountEl.querySelector("#deployLegend");
  const elRunwaySummary = mountEl.querySelector("#runwaySummary");
  const elSimList = mountEl.querySelector("#simList");
  const elReset = mountEl.querySelector("#resetSim");

  let baselinePeople = [];    // from file
  let simPeople = [];         // editable

  function fmt(n){
    if(!Number.isFinite(n)) return "0";
    return new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(n);
  }

  function computeRunway(people, BH){
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

  // Hours bar: TCH fill inside AH track; if exceed, hatch outside
  function renderHoursUtil(hours){
    const AH = Math.max(0, Number(hours?.AH || 0));
    const TCH = Math.max(0, Number(hours?.TCH || 0));
    const BH = Number(hours?.BH || 0);

    const exceed = Math.max(0, TCH - AH);
    const within = Math.min(AH, TCH);

    // scale: use AH as base. if exceed, show extra zone to the right (up to 35% extra)
    const base = Math.max(AH, 1);
    const maxExtra = Math.max(exceed, 0);
    const extraCap = base * 0.35;
    const shownExtra = Math.min(maxExtra, extraCap);
    const totalScale = base + shownExtra;

    const withinPct = (within / totalScale) * 100;
    const basePct = (AH / totalScale) * 100;
    const exceedPct = (shownExtra / totalScale) * 100;

    const insideLabel = (pct)=> pct >= 14;

    elHoursBar.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px;">
        <span class="pill">AH: ${fmt(AH)}</span>
        <span class="pill">TCH: ${fmt(TCH)}</span>
        <span class="pill">BH: ${fmt(BH)}</span>
      </div>

      <div style="
        position:relative;
        height:20px;
        border-radius:999px;
        background: rgba(255,255,255,0.06);
        border:1px solid rgba(255,255,255,0.10);
        overflow:visible;
      ">
        <!-- AH marker (end of base) -->
        <div style="position:absolute; left:${basePct}%; top:-6px; bottom:-6px; width:2px; background:rgba(255,255,255,0.25);"></div>

        <!-- Within fill -->
        <div id="withinSeg" style="
          position:absolute; left:0; top:0; bottom:0;
          width:${withinPct}%;
          border-radius:999px;
          background: rgba(90, 173, 255, 0.92);
          display:flex; align-items:center;
          justify-content:${insideLabel(withinPct) ? "center" : "flex-start"};
        ">
          ${insideLabel(withinPct)
            ? `<span style="font-size:11px; color:rgba(255,255,255,0.95); padding:0 8px; white-space:nowrap;">${fmt(within)}</span>`
            : `<span style="position:absolute; left:calc(${withinPct}% + 8px); font-size:11px; color:rgba(255,255,255,0.85); white-space:nowrap;">${fmt(within)}</span>`
          }
        </div>

        <!-- Exceed hatched -->
        ${exceed > 0 ? `
          <div id="exceedSeg" style="
            position:absolute;
            left:${basePct}%;
            top:0; bottom:0;
            width:${exceedPct}%;
            border-radius:999px;
            background-image: repeating-linear-gradient(
              45deg,
              rgba(255,255,255,0.00) 0 6px,
              rgba(255,255,255,0.28) 6px 9px
            );
            background-color: rgba(255,122,122,0.70);
            border:1px solid rgba(255,122,122,0.30);
            display:flex; align-items:center;
            justify-content:${insideLabel(exceedPct) ? "center" : "flex-start"};
          ">
            ${insideLabel(exceedPct)
              ? `<span style="font-size:11px; color:rgba(255,255,255,0.95); padding:0 8px; white-space:nowrap;">+${fmt(exceed)}</span>`
              : `<span style="position:absolute; left:calc(${basePct + exceedPct}% + 8px); font-size:11px; color:rgba(255,255,255,0.85); white-space:nowrap;">+${fmt(exceed)}</span>`
            }
          </div>
        ` : ``}
      </div>
    `;
  }

  function destroyChart(){
    if(chart){ chart.destroy(); chart=null; }
  }

  // Deployment donut with ABSOLUTE %: add Unallocated or Over-allocated slice
  function renderDeploymentChart(people){
    destroyChart();

    const top = (people || []).slice(0, 12);
    const total = top.reduce((s,p)=>s+p.pct, 0);

    const labels = top.map(p=>p.name);
    const values = top.map(p=>p.pct);

    // Add remainder to 100
    const remainder = 100 - total;
    if(remainder > 0){
      labels.push("Unallocated");
      values.push(remainder);
    } else if(remainder < 0){
      labels.push("Over-allocated");
      values.push(Math.abs(remainder));
    }

    const canvas = mountEl.querySelector("#deployChart");
    if(!labels.length){
      elDeployLegend.innerHTML = `<div class="note">No deployment data.</div>`;
      return;
    }

    chart = new Chart(canvas, {
      type:"doughnut",
      data:{ labels, datasets:[{ data: values }]},
      options:{
        responsive:true,
        plugins:{
          legend:{ display:false },
          tooltip:{
            callbacks:{
              label:(ctx)=>{
                const v = Number(ctx.raw || 0);
                return `${ctx.label}: ${v.toFixed(1)}%`;
              }
            }
          }
        }
      }
    });

    // Legend: show absolute %
    const meta = chart.getDatasetMeta(0);
    const colors = meta?.data?.map(el => el.options?.backgroundColor) || labels.map(()=> "rgba(255,255,255,0.25)");

    elDeployLegend.innerHTML = labels.map((name, i)=>`
      <div style="
        display:flex; align-items:center; justify-content:space-between; gap:10px;
        padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.06);
        font-size:12px;
      ">
        <div style="display:flex; align-items:center; gap:8px; min-width:0;">
          <span style="width:10px; height:10px; border-radius:3px; border:1px solid rgba(255,255,255,0.20); background:${colors[i]};"></span>
          <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:200px;">${escapeHtml(name)}</span>
        </div>
        <div style="color:var(--muted); flex:0 0 auto;">${Number(values[i]).toFixed(1)}%</div>
      </div>
    `).join("");
  }

  function renderRunwaySummary(runway){
    const rm = runway?.runwayMonths;
    const factor = runway?.factorDecimal;
    const burn = runway?.monthlyBurn;

    const pill = (txt)=>`<span class="pill">${escapeHtml(txt)}</span>`;

    const parts = [];
    parts.push(pill(`Factor: ${Number.isFinite(factor) ? factor.toFixed(2) : "—"}`));
    parts.push(pill(`Monthly: ${Number.isFinite(burn) ? burn.toFixed(1) : "—"} hrs`));

    if(rm == null){
      parts.push(pill(`Runway: —`));
    } else {
      parts.push(pill(`Runway: ${rm.toFixed(2)} mo`));
    }

    elRunwaySummary.innerHTML = parts.join("");
  }

  function renderSimulatorList(){
    if(!simPeople.length){
      elSimList.innerHTML = `<div style="padding:10px;" class="note">No editable deployment entries (need Name (xx%) format).</div>`;
      return;
    }

    elSimList.innerHTML = simPeople.map((p, idx)=>`
      <div style="
        display:flex; align-items:center; justify-content:space-between; gap:10px;
        padding:10px 12px;
        border-bottom:1px solid rgba(255,255,255,0.06);
      ">
        <div style="min-width:0;">
          <div style="font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:240px;">${escapeHtml(p.name)}</div>
          <div style="font-size:11px; color:var(--muted); margin-top:2px;">Absolute %</div>
        </div>

        <div style="display:flex; align-items:center; gap:8px; flex:0 0 auto;">
          <input data-idx="${idx}" type="number" min="0" step="0.1" value="${Number(p.pct||0)}" style="
            width:100px;
            background:#0f172a; border:1px solid rgba(255,255,255,0.12);
            color:rgba(255,255,255,0.92);
            border-radius:12px; padding:8px 10px;
          " />
          <span class="pill">%</span>
        </div>
      </div>
    `).join("");

    // hook inputs
    for(const inp of elSimList.querySelectorAll("input[type=number]")){
      inp.addEventListener("input", ()=>{
        const idx = Number(inp.dataset.idx);
        const v = Number(inp.value);
        simPeople[idx].pct = Number.isFinite(v) ? Math.max(0, v) : 0;

        const runway = computeRunway(simPeople, state.hours.BH);
        renderRunwaySummary(runway);
        onRunwaySimulated(runway);
      });
    }
  }

  function escapeHtml(s){
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/\"/g,"&quot;").replace(/'/g,"&#039;");
  }

  elReset.onclick = ()=>{
    simPeople = baselinePeople.map(p=>({ ...p }));
    const runway = computeRunway(simPeople, state.hours.BH);
    renderRunwaySummary(runway);
    renderSimulatorList();
    onRunwaySimulated(runway);
  };

  function setData(next){
    state = { ...state, ...next };

    // hours
    renderHoursUtil(state.hours);

    // deployment
    baselinePeople = (state.people || []).map(p=>({ name:p.name, pct:Number(p.pct||0) }));
    simPeople = baselinePeople.map(p=>({ ...p }));

    renderDeploymentChart(baselinePeople);

    // runway baseline
    const runway = computeRunway(simPeople, state.hours.BH);
    renderRunwaySummary(runway);
    renderSimulatorList();

    onRunwaySimulated(runway);
  }

  return { setData };
}

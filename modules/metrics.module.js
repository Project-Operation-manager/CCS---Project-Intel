export function initMetrics(mountEl, opts = {}){
  const onRunwaySimulated = opts.onRunwaySimulated || (()=>{});

  let chart = null;

  let state = {
    title: "",
    hours: { AH:null, TCH:null, BH:null },
    people: [],              // [{name,pct}]
    deploymentNames: [],     // fallback list of names (no %)
    runway: null
  };

  mountEl.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:14px;">

      <div>
        <b style="font-size:13px;">Hours utilization</b>
        <div class="note" style="margin-top:6px;">Bar fills by TCH vs AH. If TCH exceeds AH, the extra is hatched. Missing values show as “/”.</div>

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
        <div class="note" style="margin-top:6px;">Uses absolute percentages if present (e.g., Name (10%)). If only names exist, they’re listed with “/”.</div>

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
        <div class="note">/</div>
      `;
      return;
    }

    // Render bar using numeric fallbacks (so layout stays stable)
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
        background: rgba(255,255,255,0.06);
        border:1px solid rgba(255,255,255,0.10);
        overflow:visible;
      ">
        <div style="position:absolute; left:${basePct}%; top:-6px; bottom:-6px; width:2px; background:rgba(255,255,255,0.25);"></div>

        <div style="
          position:absolute; left:0; top:0; bottom:0;
          width:${withinPct}%;
          border-radius:999px;
          background: rgba(90, 173, 255, 0.92);
          display:flex; align-items:center;
          justify-content:${insideLabel(withinPct) ? "center" : "flex-start"};
        ">
          ${insideLabel(withinPct)
            ? `<span style="font-size:11px; color:rgba(255,255,255,0.95); padding:0 8px; white-space:nowrap;">${escapeHtml(fmt(within,1))}</span>`
            : `<span style="position:absolute; left:calc(${withinPct}% + 8px); font-size:11px; color:rgba(255,255,255,0.85); white-space:nowrap;">${escapeHtml(fmt(within,1))}</span>`
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
              rgba(255,255,255,0.28) 6px 9px
            );
            background-color: rgba(255,122,122,0.70);
            border:1px solid rgba(255,122,122,0.30);
            display:flex; align-items:center;
            justify-content:${insideLabel(exceedPct) ? "center" : "flex-start"};
          ">
            ${insideLabel(exceedPct)
              ? `<span style="font-size:11px; color:rgba(255,255,255,0.95); padding:0 8px; white-space:nowrap;">+${escapeHtml(fmt(exceed,1))}</span>`
              : `<span style="position:absolute; left:calc(${basePct + exceedPct}% + 8px); font-size:11px; color:rgba(255,255,255,0.85); white-space:nowrap;">+${escapeHtml(fmt(exceed,1))}</span>`
            }
          </div>
        ` : ``}
      </div>
    `;
  }

  function destroyChart(){
    if(chart){ chart.destroy(); chart=null; }
  }

  function renderDeploymentChart(people, deploymentNames){
    destroyChart();

    const numeric = (people || []).filter(p => Number.isFinite(p.pct) && p.pct > 0);
    const namesOnly = (deploymentNames || []).filter(Boolean);

    if(!numeric.length){
      // No numeric % data — show names if present
      const items = namesOnly.length ? namesOnly : [];
      if(!items.length){
        elDeployLegend.innerHTML = `<div class="note">/</div>`;
        return;
      }
      elDeployLegend.innerHTML = items.map(n=>`
        <div style="
          display:flex; align-items:center; justify-content:space-between; gap:10px;
          padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.06);
          font-size:12px;
        ">
          <div style="display:flex; align-items:center; gap:8px; min-width:0;">
            <span style="width:10px; height:10px; border-radius:3px; border:1px solid rgba(255,255,255,0.20); background:rgba(255,255,255,0.25);"></span>
            <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:200px;">${escapeHtml(n)}</span>
          </div>
          <div style="color:var(--muted); flex:0 0 auto;">/</div>
        </div>
      `).join("");
      return;
    }

    const top = numeric.slice(0, 12);
    const total = top.reduce((s,p)=>s+p.pct, 0);

    const labels = top.map(p=>p.name);
    const values = top.map(p=>p.pct);

    const remainder = 100 - total;
    if(remainder > 0){
      labels.push("Unallocated");
      values.push(remainder);
    } else if(remainder < 0){
      labels.push("Over-allocated");
      values.push(Math.abs(remainder));
    }

    if(typeof Chart === "undefined"){
      elDeployLegend.innerHTML = `<div class="note">Chart.js not loaded (check network).</div>`;
      return;
    }

    const canvas = mountEl.querySelector("#deployChart");
    chart = new Chart(canvas, {
      type:"doughnut",
      data:{ labels, datasets:[{ data: values }]},
      options:{
        responsive:true,
        plugins:{
          legend:{ display:false },
          tooltip:{ callbacks:{ label:(ctx)=> `${ctx.label}: ${Number(ctx.raw||0).toFixed(1)}%` } }
        }
      }
    });

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
    parts.push(pill(`Factor: ${Number.isFinite(factor) ? factor.toFixed(2) : "/"}`));
    parts.push(pill(`Burn/mo: ${Number.isFinite(burn) ? burn.toFixed(1) : "/"}`));

    if(rm == null) parts.push(pill(`Runway: /`));
    else parts.push(pill(`Runway: ${rm.toFixed(1)} mo`));

    elRunwaySummary.innerHTML = parts.join("");
  }

  function renderSimList(){
    if(!simPeople.length){
      elSimList.innerHTML = `<div class="note" style="padding:10px;">/</div>`;
      return;
    }

    elSimList.innerHTML = `
      <table style="width:100%; border-collapse:collapse; font-size:12px;">
        <thead>
          <tr>
            <th style="text-align:left; padding:8px 10px; border-bottom:1px solid rgba(255,255,255,0.06); color:var(--muted);">Name</th>
            <th style="text-align:right; padding:8px 10px; border-bottom:1px solid rgba(255,255,255,0.06); color:var(--muted);">%</th>
          </tr>
        </thead>
        <tbody>
          ${simPeople.map((p, idx)=>`
            <tr>
              <td style="padding:8px 10px; border-bottom:1px solid rgba(255,255,255,0.06);">${escapeHtml(p.name)}</td>
              <td style="padding:8px 10px; border-bottom:1px solid rgba(255,255,255,0.06); text-align:right;">
                <input data-idx="${idx}" type="number" min="0" max="100" step="0.5" value="${Number(p.pct).toFixed(1)}"
                  style="width:90px; text-align:right; background:#0f172a; border:1px solid rgba(255,255,255,0.10); color:var(--text); border-radius:10px; padding:6px 8px;" />
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

    elSimList.querySelectorAll("input[type=number]").forEach(inp=>{
      inp.addEventListener("input", ()=>{
        const idx = Number(inp.dataset.idx || 0);
        const v = Number(inp.value || 0);
        simPeople[idx].pct = Math.max(0, Math.min(100, v));
        const runway = computeRunway(simPeople, Number(state.hours?.BH));
        renderRunwaySummary(runway);
        onRunwaySimulated(runway);
      });
    });
  }

  function setData(next){
    state = { ...state, ...next };
    baselinePeople = (state.people || []).map(p=>({ ...p }));
    simPeople = baselinePeople.map(p=>({ ...p }));

    renderHoursUtil(state.hours);
    renderDeploymentChart(state.people, state.deploymentNames);
    const runway = state.runway || computeRunway(state.people, Number(state.hours?.BH));
    renderRunwaySummary(runway);
    renderSimList();
  }

  elReset.onclick = ()=>{
    simPeople = baselinePeople.map(p=>({ ...p }));
    renderSimList();
    const runway = computeRunway(simPeople, Number(state.hours?.BH));
    renderRunwaySummary(runway);
    onRunwaySimulated(runway);
  };

  // init empty
  setData(state);
  return { setData };
}

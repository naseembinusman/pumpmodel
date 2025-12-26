document.addEventListener("DOMContentLoaded", () => {
    const flowSelect = document.getElementById("flowSelect");
    const modelSelect = document.getElementById("modelSelect");

    fetch("data/pumps.xml")
        .then(res => res.text())
        .then(xmlText => {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, "text/xml");
            const flows = xmlDoc.getElementsByTagName("Flow");

            // Populate flows
            for (let flow of flows) {
                const rate = flow.getAttribute("rate");
                const opt = document.createElement("option");
                opt.value = rate;
                opt.textContent = rate;
                flowSelect.appendChild(opt);
            }

            flowSelect.addEventListener("change", () => {
                modelSelect.innerHTML = '<option value="">-- Select Pump Model --</option>';
                modelSelect.disabled = true;

                if (!flowSelect.value) return;

                for (let flow of flows) {
                    if (flow.getAttribute("rate") === flowSelect.value) {
                        const models = flow.getElementsByTagName("PumpModel");
                        for (let m of models) {
                            const opt = document.createElement("option");
                            opt.value = m.textContent;
                            opt.textContent = m.textContent;
                            modelSelect.appendChild(opt);
                        }
                        modelSelect.disabled = false;
                        break;
                    }
                }
            });
        })
        .catch(err => console.error("Failed to load XML", err));
});


let minDB, maxDB;

async function loadXML(path) {
    const res = await fetch(path);
    const text = await res.text();
    return new DOMParser().parseFromString(text, "text/xml");
}

async function loadDatabases() {
    minDB = await loadXML("data/min.xml");
    maxDB = await loadXML("data/max.xml");
}

loadDatabases();

const modelSelect = document.getElementById("modelSelect");

modelSelect.addEventListener("change", () => {
    const modelName = modelSelect.value;
    if (!modelName) return;

    const minData = getPumpData(minDB, modelName);
    const maxData = getPumpData(maxDB, modelName);

    console.log("MIN IMPELLER DATA:", minData);
    console.log("MAX IMPELLER DATA:", maxData);

    // Later you can:
    // draw curves
    // interpolate head
    // calculate power
});

function getPumpData(xmlDoc, modelName) {
    const pump = xmlDoc.querySelector(`PumpModel[name="${modelName}"]`);
    if (!pump) {
        console.warn(`Pump ${modelName} not found`);
        return null;
    }

    const points = [];
    const dataPoints = pump.querySelectorAll("DataPoint");

    dataPoints.forEach(dp => {
        points.push({
            gpm: parseFloat(dp.querySelector("GPM").textContent),
            head: parseFloat(dp.querySelector("M").textContent),
            kw: parseFloat(dp.querySelector("KW").textContent)
        });
    });

    return points;
}

const HIGH_SPEED_PUMPS = [
  "EHES425250",
  "EHES53250",
  "EHES54200",
  "EHES64200",
  "FK150-290-60"
];

function getBaseSpeed(model) {
  return HIGH_SPEED_PUMPS.includes(model) ? 3550 : 2900;
}

function headToMeter(value, unit) {
  if (unit === "bar") return value * 10.197;
  if (unit === "psi") return value * 0.703;
  return value;
}

function meterToUnit(value, unit) {
  if (unit === "bar") return value / 10.197;
  if (unit === "psi") return value / 0.703;
  return value;
}

function interpolate(x, x1, y1, x2, y2) {
  return y1 + ((x - x1) * (y2 - y1)) / (x2 - x1);
}

function getValueAtFlow(curve, flow, key) {
  for (let i = 0; i < curve.length - 1; i++) {
    if (flow >= curve[i].gpm && flow <= curve[i + 1].gpm) {
      return interpolate(
        flow,
        curve[i].gpm,
        curve[i][key],
        curve[i + 1].gpm,
        curve[i + 1][key]
      );
    }
  }
  return null;
}

function calculateImpellerDiameter(targetHead, minHead, maxHead, dMin, dMax) {
  const ratio = (targetHead - minHead) / (maxHead - minHead);
  if (ratio < 0 || ratio > 1) return null;

  return Math.sqrt(
    dMin ** 2 + ratio * (dMax ** 2 - dMin ** 2)
  );
}

function applySpeedCorrection(flow, head, power, baseRPM, ratedRPM) {
  const ratio = ratedRPM / baseRPM;

  return {
    flow: flow * ratio,
    head: head * ratio * ratio,
    power: power * ratio * ratio * ratio
  };
}

document.getElementById("calculateBtn").addEventListener("click", () => {

  const model = modelSelect.value;
  const ratedFlow = parseFloat(ratedFlowInput.value);
  const ratedRPM = parseFloat(ratedRPMInput.value);
  const unit = pressureUnit.value;

  const ratedHeadM = headToMeter(
    parseFloat(ratedHeadInput.value),
    unit
  );

  const baseRPM = getBaseSpeed(model);

  const minCurve = getPumpData(minDB, model);
  const maxCurve = getPumpData(maxDB, model);

  if (!minCurve || !maxCurve) return alert("Pump data missing");

  // Head at rated flow
  const Hmin = getValueAtFlow(minCurve, ratedFlow, "head");
  const Hmax = getValueAtFlow(maxCurve, ratedFlow, "head");

  // Example impeller diameters (replace from XML if available)
  const dMin = 200;
  const dMax = 250;

  const impeller = calculateImpellerDiameter(
    ratedHeadM, Hmin, Hmax, dMin, dMax
  );

  if (!impeller) return alert("Duty outside pump envelope");

  // Speed correction
  const ratedCurve = minCurve.map(p => {
    const blendedHead = Hmin + (impeller ** 2 - dMin ** 2) /
      (dMax ** 2 - dMin ** 2) * (Hmax - Hmin);

    return applySpeedCorrection(
      p.gpm,
      blendedHead,
      p.kw,
      baseRPM,
      ratedRPM
    );
  });

  // Store results
  flow_r = ratedCurve.map(p => p.flow);
  head_r = ratedCurve.map(p => p.head);
  power_r = ratedCurve.map(p => p.power);

  printResults(model, ratedCurve, unit);
});

function printResults(model, curve, unit) {

  const rated = curve[1];
  const churn = curve[0];
  const flow150 = curve.find(p => p.flow >= rated.flow * 1.5);

  console.table({
    "Pump Model": model,
    "Rated Flow (GPM)": rated.flow.toFixed(1),
    "Rated Pressure": meterToUnit(rated.head, unit).toFixed(2),
    "Churn Pressure": meterToUnit(churn.head, unit).toFixed(2),
    "Pressure @150%": meterToUnit(flow150.head, unit).toFixed(2),
    "Power @Rated (kW)": rated.power.toFixed(2),
    "Power @150% (kW)": flow150.power.toFixed(2),
    "Max Power (kW)": Math.max(...curve.map(p => p.power)).toFixed(2)
  });
}

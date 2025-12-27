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
        modelSelect.addEventListener("change", () => {
            const modelName = modelSelect.value;
            console.log(`Model: ${modelName}`);
            if (!modelName){
                return;
            }
        
            const minData = getPumpData(minDB, modelName);
            const maxData = getPumpData(maxDB, modelName);
            showPanel();
        });
});

let minDB, maxDB;
let impellerDB;

async function loadXML(path) {
    const res = await fetch(path);
    const text = await res.text();
    return new DOMParser().parseFromString(text, "text/xml");
}

async function loadDatabases() {
    minDB = await loadXML("data/min.xml");
    maxDB = await loadXML("data/max.xml");
    impellerDB = await loadXML("data/impeller.xml");
}

loadDatabases();

function getImpellerRange(modelName) {
    if (!impellerDB) {
        alert("Database still loading, please wait");
        return;
    }
    const pumps = impellerDB.querySelectorAll("Pump");
    for (let pump of pumps) {
        const name = pump.querySelector("Model").textContent.trim();
        if (name === modelName) {
            const dMin = parseFloat(pump.querySelector("MinImpeller").textContent);
            const dMax = parseFloat(pump.querySelector("MaxImpeller").textContent);
            return { dMin, dMax };
        }
    }
    return null;
}

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

function showPanel() {
    const panel = document.getElementById("inputPanel");
    panel.style.display = "block";
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
    const ratedFlow = parseFloat(flowSelect.value);
    const ratedRPM = parseFloat(document.getElementById("ratedRPM").value);
    const unit = document.getElementById("pressureUnit").value;

    const ratedHeadM = headToMeter(
        parseFloat(document.getElementById("ratedHead").value),
        unit
    );

    if (!model || !ratedFlow || !ratedRPM || !ratedHeadM) {
        return alert("Please complete all inputs");
    }

    const baseRPM = getBaseSpeed(model);

    const minCurve = getPumpData(minDB, model);
    const maxCurve = getPumpData(maxDB, model);

    if (!minCurve || !maxCurve) {
        return alert("Pump database not found");
    }

    const Hmin = getValueAtFlow(minCurve, ratedFlow, "head");
    const Hmax = getValueAtFlow(maxCurve, ratedFlow, "head");

    if (Hmin === null || Hmax === null) {
        return alert("Rated flow is outside pump curve range");
    }

    const range = getImpellerRange(model);
    if (!range) {
        alert("Impeller range not found for selected pump");
        return;
    }
    const { dMin, dMax } = range;

    const impeller = calculateImpellerDiameter(ratedHeadM, Hmin, Hmax, dMin, dMax);

    if (!impeller) {
        return alert("Required head is outside impeller range");
    }

    const ratedCurve = minCurve.map((p, i) => {
        const hMin = minCurve[i].head;
        const hMax = maxCurve[i].head;

        const blendedHead =
            hMin + (impeller ** 2 - dMin ** 2) /
            (dMax ** 2 - dMin ** 2) * (hMax - hMin);

        return applySpeedCorrection(p.gpm, blendedHead, p.kw, baseRPM, ratedRPM);
    });

    if (!range) {
        alert("Impeller range not found");
        return;
    }


    // Print results with warnings
    printResults(model, ratedCurve, unit, ratedFlow, impeller, dMin, dMax);

});

function printResults(model, curve, unit, ratedFlow, impeller, dMin, dMax) {
    const sorted = [...curve].sort((a, b) => a.flow - b.flow);

    const interp = (flow, key) => {
        for (let i = 0; i < sorted.length - 1; i++) {
            const p1 = sorted[i];
            const p2 = sorted[i + 1];
            if (flow >= p1.flow && flow <= p2.flow) {
                return interpolate(flow, p1.flow, p1[key], p2.flow, p2[key]);
            }
        }
        return null;
    };

    const ratedHead = interp(ratedFlow, "head");
    const ratedPower = interp(ratedFlow, "power");
    const churnHead = interp(0, "head");

    const flow150 = ratedFlow * 1.5;
    const head150 = interp(flow150, "head");
    const power150 = interp(flow150, "power");

    const maxPower = Math.max(...sorted.map(p => p.power));
    const maxFlow = sorted[sorted.length - 1].flow;

    const resultsPanel = document.getElementById("resultsPanel");
    const tbody = document.querySelector("#resultsTable tbody");
    tbody.innerHTML = "";

    const addRow = (param, value, warn = false) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${param}</td><td class="${warn ? 'warning' : 'safe'}">${value}</td>`;
        tbody.appendChild(tr);
    };

    addRow("Pump Model", model);
    addRow("Rated Flow (GPM)", ratedFlow.toFixed(1));
    addRow("Rated Pressure (" + unit + ")", meterToUnit(ratedHead, unit).toFixed(2));
    addRow("Churn Pressure (" + unit + ")", churnHead ? meterToUnit(churnHead, unit).toFixed(2) : "N/A");
    addRow("Pressure @150%", head150 ? meterToUnit(head150, unit).toFixed(2) : "Out of Curve", flow150 > maxFlow);
    addRow("Power @Rated (kW)", ratedPower?.toFixed(2));
    addRow("Power @150% (kW)", power150 ? power150.toFixed(2) : "Out of Curve", flow150 > maxFlow);
    addRow("Max Power (kW)", maxPower.toFixed(2));
    addRow("Calculated Impeller Diameter", impeller.toFixed(2), impeller < dMin || impeller > dMax);

    resultsPanel.style.display = "block";
}

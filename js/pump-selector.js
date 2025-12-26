/**
 * Al Aman Pump Selector Logic
 * Cleaned & Modularized
 */

const PumpApp = {
    // State
    db: { min: null, max: null, impeller: null, flowList: null },
    elements: {},
    highSpeedPumps: ["EHES425250", "EHES53250", "EHES54200", "EHES64200", "FK150-290-60"],

    async init() {
        // 1. Map DOM Elements
        this.elements = {
            flowSelect: document.getElementById("flowSelect"),
            modelSelect: document.getElementById("modelSelect"),
            calculateBtn: document.getElementById("calculateBtn"),
            ratedHead: document.getElementById("ratedHead"),
            ratedRPM: document.getElementById("ratedRPM"),
            pressureUnit: document.getElementById("pressureUnit"),
            resultsPanel: document.getElementById("resultsPanel"),
            resultsBody: document.querySelector("#resultsTable tbody")
        };

        // 2. Load XML Data
        try {
            const [flowXml, minXml, maxXml, impellerXml] = await Promise.all([
                this.fetchXml("data/pumps.xml"),
                this.fetchXml("data/min.xml"),
                this.fetchXml("data/max.xml"),
                this.fetchXml("data/impeller.xml")
            ]);

            this.db.flowList = flowXml;
            this.db.min = minXml;
            this.db.max = maxXml;
            this.db.impeller = impellerXml;

            this.populateFlows();
            this.attachEvents();
            console.log("Databases loaded successfully.");
        } catch (err) {
            alert("Critical Error: Could not load pump databases.");
            console.error(err);
        }
    },

    async fetchXml(path) {
        const res = await fetch(path);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const text = await res.text();
        return new DOMParser().parseFromString(text, "text/xml");
    },

    attachEvents() {
        this.elements.flowSelect.addEventListener("change", () => this.handleFlowChange());
        this.elements.calculateBtn.addEventListener("click", () => this.calculate());
    },

    populateFlows() {
        const flows = this.db.flowList.getElementsByTagName("Flow");
        for (let flow of flows) {
            const rate = flow.getAttribute("rate");
            const opt = new Option(rate, rate);
            this.elements.flowSelect.add(opt);
        }
    },

    handleFlowChange() {
        const selectedFlow = this.elements.flowSelect.value;
        const { modelSelect } = this.elements;

        modelSelect.innerHTML = '<option value="">-- Select Pump Model --</option>';
        modelSelect.disabled = !selectedFlow;

        if (!selectedFlow) return;

        const flows = this.db.flowList.getElementsByTagName("Flow");
        for (let flow of flows) {
            if (flow.getAttribute("rate") === selectedFlow) {
                const models = flow.getElementsByTagName("PumpModel");
                for (let m of models) {
                    modelSelect.add(new Option(m.textContent, m.textContent));
                }
                break;
            }
        }
    },

    // --- Math & Physics Logic ---

    getPumpData(xmlDoc, modelName) {
        const pump = xmlDoc.querySelector(`PumpModel[name="${modelName}"]`);
        if (!pump) return null;

        return Array.from(pump.querySelectorAll("DataPoint")).map(dp => ({
            gpm: parseFloat(dp.querySelector("GPM").textContent),
            head: parseFloat(dp.querySelector("M").textContent),
            kw: parseFloat(dp.querySelector("KW").textContent)
        }));
    },

    getImpellerRange(modelName) {
        const pumps = this.db.impeller.querySelectorAll("Pump");
        for (let pump of pumps) {
            if (pump.querySelector("Model").textContent.trim() === modelName) {
                return {
                    dMin: parseFloat(pump.querySelector("MinImpeller").textContent),
                    dMax: parseFloat(pump.querySelector("MaxImpeller").textContent)
                };
            }
        }
        return null;
    },

    applyAffinityLaws(flow, head, power, baseRPM, ratedRPM) {
        const ratio = ratedRPM / baseRPM;
        return {
            flow: flow * ratio,
            head: head * (ratio ** 2),
            power: power * (ratio ** 3)
        };
    },

    interpolate(x, points, key) {
        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];
            if (x >= p1.gpm && x <= p2.gpm) {
                return p1[key] + ((x - p1.gpm) * (p2[key] - p1[key])) / (p2.gpm - p1.gpm);
            }
        }
        return null;
    },

    // --- Main Calculation ---

    calculate() {
        const model = this.elements.modelSelect.value;
        const ratedFlow = parseFloat(this.elements.flowSelect.value);
        const ratedRPM = parseFloat(this.elements.ratedRPM.value);
        const unit = this.elements.pressureUnit.value;
        const inputHead = parseFloat(this.elements.ratedHead.value);

        if (!model || isNaN(ratedFlow) || isNaN(ratedRPM) || isNaN(inputHead)) {
            return alert("Please fill in all fields correctly.");
        }

        const targetHeadM = this.convertHeadToMeter(inputHead, unit);
        const baseRPM = this.highSpeedPumps.includes(model) ? 3550 : 2900;

        const minCurve = this.getPumpData(this.db.min, model);
        const maxCurve = this.getPumpData(this.db.max, model);
        const range = this.getImpellerRange(model);

        if (!minCurve || !maxCurve || !range) return alert("Data error for selected model.");

        const hMinAtFlow = this.interpolate(ratedFlow, minCurve, 'head');
        const hMaxAtFlow = this.interpolate(ratedFlow, maxCurve, 'head');

        if (hMinAtFlow === null || hMaxAtFlow === null) return alert("Flow is outside curve range.");

        // Calculate Impeller via Area Ratio
        const { dMin, dMax } = range;
        const ratio = (targetHeadM - hMinAtFlow) / (hMaxAtFlow - hMinAtFlow);
        
        if (ratio < -0.05 || ratio > 1.05) return alert("Head requirement is outside pump impeller range.");
        
        const impeller = Math.sqrt(dMin ** 2 + Math.max(0, Math.min(1, ratio)) * (dMax ** 2 - dMin ** 2));

        // Generate Rated Curve
        const ratedCurve = minCurve.map((p, i) => {
            const blendedHead = minCurve[i].head + (impeller ** 2 - dMin ** 2) / (dMax ** 2 - dMin ** 2) * (maxCurve[i].head - minCurve[i].head);
            return this.applyAffinityLaws(p.gpm, blendedHead, p.kw, baseRPM, ratedRPM);
        });

        this.renderResults(model, ratedCurve, unit, ratedFlow, impeller, dMin, dMax);
    },

    convertHeadToMeter(val, unit) {
        const factors = { "bar": 10.197, "psi": 0.703, "m": 1 };
        return val * factors[unit];
    },

    convertMeterToUnit(val, unit) {
        const factors = { "bar": 10.197, "psi": 0.703, "m": 1 };
        return val / factors[unit];
    },

    renderResults(model, curve, unit, ratedFlow, impeller, dMin, dMax) {
        const sorted = [...curve].sort((a, b) => a.flow - b.flow);
        
        const getVal = (f, k) => {
            // Re-using interpolation logic for arbitrary keys
            for (let i = 0; i < sorted.length - 1; i++) {
                if (f >= sorted[i].flow && f <= sorted[i+1].flow) {
                    return sorted[i][k] + ((f - sorted[i].flow) * (sorted[i+1][k] - sorted[i][k])) / (sorted[i+1].flow - sorted[i].flow);
                }
            }
            return null;
        };

        const head150 = getVal(ratedFlow * 1.5, "head");
        
        this.elements.resultsBody.innerHTML = "";
        this.addResultRow("Pump Model", model);
        this.addResultRow("Rated Flow", `${ratedFlow} GPM`);
        this.addResultRow(`Rated Pressure (${unit})`, this.convertMeterToUnit(getVal(ratedFlow, "head"), unit).toFixed(2));
        this.addResultRow(`Churn Pressure (${unit})`, this.convertMeterToUnit(sorted[0].head, unit).toFixed(2));
        this.addResultRow("Pressure @150%", head150 ? this.convertMeterToUnit(head150, unit).toFixed(2) : "N/A", !head150);
        this.addResultRow("Impeller Diameter", impeller.toFixed(2), (impeller < dMin || impeller > dMax));

        this.elements.resultsPanel.style.display = "block";
    },

    addResultRow(label, value, isWarning = false) {
        const row = `<tr><td>${label}</td><td class="${isWarning ? 'warning' : 'safe'}">${value}</td></tr>`;
        this.elements.resultsBody.insertAdjacentHTML('beforeend', row);
    }
};

// Start the app
document.addEventListener("DOMContentLoaded", () => PumpApp.init());

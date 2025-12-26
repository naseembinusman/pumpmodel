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

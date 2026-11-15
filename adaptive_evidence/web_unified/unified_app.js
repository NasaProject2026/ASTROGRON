(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const DEFAULT_VIEW = { x: -180, y: -90, w: 360, h: 180 };
  let currentView = { ...DEFAULT_VIEW };
  let presetsById = {};
  let sessionHistory = [];
  let activePayloadOverride = null;

  const $ = (id) => document.getElementById(id);

  function setViewBox() {
    const svg = $("world-map-svg");
    if (!svg) return;
    svg.setAttribute(
      "viewBox",
      `${currentView.x.toFixed(2)} ${currentView.y.toFixed(2)} ${currentView.w.toFixed(2)} ${currentView.h.toFixed(2)}`
    );
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      el.setAttribute(k, String(v));
    }
    return el;
  }

  function renderGraticule(layer) {
    for (let lon = -150; lon <= 150; lon += 30) {
      layer.appendChild(svgEl("line", { x1: lon, y1: -90, x2: lon, y2: 90, class: lon === 0 ? "map-equator" : "map-graticule" }));
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      layer.appendChild(svgEl("line", { x1: -180, y1: -lat, x2: 180, y2: -lat, class: lat === 0 ? "map-equator" : "map-graticule" }));
    }
  }

  function updateMapSelection() {
    const markerLayer = $("map-marker-layer");
    const polyLayer = $("map-polygon-layer");
    if (!markerLayer || !polyLayer) return;

    markerLayer.textContent = "";
    polyLayer.textContent = "";

    const lon = parseFloat($("lon-input").value);
    const lat = parseFloat($("lat-input").value);
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      const y = -lat;
      const rScale = Math.max(0.8, currentView.w / 120);
      markerLayer.appendChild(svgEl("circle", { cx: lon, cy: y, r: (rScale * 1.9).toFixed(2), class: "map-selected-ring" }));
      markerLayer.appendChild(svgEl("circle", { cx: lon, cy: y, r: (rScale * 0.8).toFixed(2), class: "map-selected-dot" }));
    }

    const rawGeo = ($("geojson-input").value || "").trim();
    if (!rawGeo) return;
    try {
      const parsed = JSON.parse(rawGeo);
      const geom = parsed && parsed.type === "Feature" ? parsed.geometry : parsed;
      if (!geom || !geom.coordinates) return;
      const polys =
        geom.type === "Polygon"
          ? [geom.coordinates]
          : geom.type === "MultiPolygon"
          ? geom.coordinates
          : [];
      for (const rings of polys) {
        if (!Array.isArray(rings) || rings.length === 0) continue;
        const outer = rings[0];
        if (!Array.isArray(outer) || outer.length < 3) continue;
        const d =
          "M" +
          outer
            .map((pt) => `${Number(pt[0]).toFixed(4)} ${(-Number(pt[1])).toFixed(4)}`)
            .join("L") +
          "Z";
        polyLayer.appendChild(svgEl("path", { d, class: "map-polygon-overlay" }));
      }
    } catch (_err) {
      // Malformed JSON stays in textarea until validated/submitted
    }
  }

  function clientToLonLat(evt) {
    const svg = $("world-map-svg");
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const fx = (evt.clientX - rect.left) / rect.width;
    const fy = (evt.clientY - rect.top) / rect.height;
    const lon = Math.max(-180, Math.min(180, currentView.x + fx * currentView.w));
    const lat = Math.max(-90, Math.min(90, -(currentView.y + fy * currentView.h)));
    return [Number(lon.toFixed(4)), Number(lat.toFixed(4))];
  }

  function zoomMap(factor) {
    const cx = currentView.x + currentView.w / 2;
    const cy = currentView.y + currentView.h / 2;
    const nw = Math.max(12, Math.min(360, currentView.w * factor));
    const nh = nw / 2;
    currentView = {
      x: Math.max(-180, Math.min(180 - nw, cx - nw / 2)),
      y: Math.max(-90, Math.min(90 - nh, cy - nh / 2)),
      w: nw,
      h: nh,
    };
    setViewBox();
    updateMapSelection();
  }

  function panMap(dxFrac, dyFrac) {
    const nx = Math.max(-180, Math.min(180 - currentView.w, currentView.x + dxFrac * currentView.w));
    const ny = Math.max(-90, Math.min(90 - currentView.h, currentView.y + dyFrac * currentView.h));
    currentView.x = nx;
    currentView.y = ny;
    setViewBox();
  }

  function resetMapView() {
    currentView = { ...DEFAULT_VIEW };
    setViewBox();
    updateMapSelection();
  }

  function loadWorldMap() {
    const graticuleLayer = $("map-graticule-layer");
    const landLayer = $("map-land-layer");
    if (!graticuleLayer || !landLayer) return;
    renderGraticule(graticuleLayer);

    fetch("/api/v1/adaptive-evidence/world-map.json")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        landLayer.textContent = "";
        for (const d of data.paths || []) {
          landLayer.appendChild(svgEl("path", { d, class: "map-land" }));
        }
        $("map-source-caption").textContent = `${data.source} (${data.license}). ${data.notice} Click any point to set EPSG:4326 coordinates.`;
      })
      .catch((err) => {
        $("map-source-caption").textContent = `Map overlay unavailable (${err.message}); coordinate & GeoJSON inputs remain fully usable.`;
      });
  }

  function getSelectedCrops() {
    const boxes = document.querySelectorAll(".crop-checkbox");
    const list = [];
    for (const cb of boxes) {
      if (cb.checked) list.push(cb.value);
    }
    const customRaw = ($("custom-crops").value || "").trim();
    if (customRaw) {
      for (const item of customRaw.split(",")) {
        const clean = item.trim();
        if (clean && !list.includes(clean)) list.push(clean);
      }
    }
    return list;
  }

  function setSelectedCrops(crops) {
    const target = new Set(Array.isArray(crops) ? crops : []);
    const custom = [];
    const known = new Set();
    for (const cb of document.querySelectorAll(".crop-checkbox")) {
      known.add(cb.value);
      cb.checked = target.has(cb.value);
    }
    for (const c of target) {
      if (!known.has(c)) custom.push(c);
    }
    $("custom-crops").value = custom.join(", ");
  }

  function buildPayloadFromForm() {
    const rawOverrideText = ($("raw-json-input").value || "").trim();
    if ($("use-raw-json").checked && rawOverrideText) {
      return JSON.parse(rawOverrideText);
    }

    const lon = parseFloat($("lon-input").value);
    const lat = parseFloat($("lat-input").value);
    const crs = $("crs-select").value || "EPSG:4326";
    const siteId = ($("site-id").value || "").trim() || `CUSTOM_${Number.isFinite(lon) ? lon.toFixed(2) : "0"}_${Number.isFinite(lat) ? lat.toFixed(2) : "0"}`;
    const siteName = ($("site-name").value || "").trim() || "User-Selected Global Farm Coordinate";
    const acqEl = document.querySelector('input[name="acquisition"]:checked');
    const acquisition = acqEl ? acqEl.value : "CACHE_ONLY";

    let geometry = undefined;
    const rawGeo = ($("geojson-input").value || "").trim();
    if (rawGeo) {
      const parsedGeo = JSON.parse(rawGeo);
      geometry = parsedGeo && parsedGeo.type === "Feature" ? parsedGeo.geometry : parsedGeo;
    }

    let depths = [[0, 5], [5, 15], [15, 30]];
    const depthText = ($("depth-intervals").value || "").trim();
    if (depthText) {
      depths = JSON.parse(depthText);
    }

    const location = {
      site_id: siteId,
      name: siteName,
      point_lon_lat: [Number.isFinite(lon) ? lon : $("lon-input").value, Number.isFinite(lat) ? lat : $("lat-input").value],
      crs,
    };
    if (geometry !== undefined) {
      location.geometry = geometry;
    }

    const regimeVal = $("water-regime").value;
    const waterScenario = { regime: regimeVal === "unknown" ? null : regimeVal };
    const supplyRaw = ($("seasonal-supply").value || "").trim();
    if (supplyRaw !== "") {
      waterScenario.seasonal_supply_m3_ha = Number(supplyRaw);
    }

    const userMeasurements = {};
    const mineralN = ($("mineral-n").value || "").trim();
    if (mineralN !== "") userMeasurements.mineral_n_kg_ha = Number(mineralN);
    const thetaFc = ($("theta-fc").value || "").trim();
    if (thetaFc !== "") userMeasurements.theta_fc = Number(thetaFc);
    const thetaWp = ($("theta-wp").value || "").trim();
    if (thetaWp !== "") userMeasurements.theta_wp = Number(thetaWp);

    const payload = {
      schema: "astragron.adaptive-evidence.request.v1",
      request_id: `ui-${Date.now()}`,
      location,
      period: {
        start: $("period-start").value || "2016-01-01",
        end: $("period-end").value || "2020-12-31",
      },
      soil_depth_intervals_cm: depths,
      candidate_crops: getSelectedCrops(),
      water_supply_scenario: waterScenario,
      options: {
        acquisition,
        allow_offline_reference_fixture: false,
        allow_conditional_crop_planning: true,
      },
    };
    if (Object.keys(userMeasurements).length > 0) {
      payload.user_measurements = userMeasurements;
    }
    return payload;
  }

  function applyPreset(presetId) {
    const preset = presetsById[presetId];
    if (!preset) return;
    const payload = preset.payload;
    activePayloadOverride = payload;

    const isNested =
      payload.schema !== "astragron.adaptive-evidence.request.v1" ||
      Boolean(payload.research_decision_request) ||
      Boolean(payload.engine_request);
    const loc =
      payload.location ||
      (payload.engine_request && payload.engine_request.location) ||
      {};

    $("site-id").value = loc.site_id || preset.label || "";
    $("site-name").value = loc.name || loc.jurisdiction || preset.label || "";
    if (Array.isArray(loc.point_lon_lat) && loc.point_lon_lat.length >= 2) {
      $("lon-input").value = loc.point_lon_lat[0];
      $("lat-input").value = loc.point_lon_lat[1];
    }
    $("crs-select").value = loc.crs || "EPSG:4326";
    $("geojson-input").value = loc.geometry ? JSON.stringify(loc.geometry, null, 2) : "";

    if (Array.isArray(payload.candidate_crops)) {
      setSelectedCrops(payload.candidate_crops);
    } else if (payload.engine_request && Array.isArray(payload.engine_request.fields)) {
      const crops = [];
      for (const f of payload.engine_request.fields) {
        for (const c of f.crop_candidates || []) crops.push(c);
      }
      setSelectedCrops(crops);
    } else if (Array.isArray(payload.fields)) {
      const crops = [];
      for (const f of payload.fields) {
        for (const c of f.crop_candidates || []) crops.push(c);
      }
      setSelectedCrops(crops);
    }

    const ws = payload.water_supply_scenario || {};
    $("water-regime").value = ws.regime || "unknown";
    $("seasonal-supply").value = ws.seasonal_supply_m3_ha != null ? String(ws.seasonal_supply_m3_ha) : "";

    const acq =
      (payload.options && payload.options.acquisition) ||
      (payload.engine_request && payload.engine_request.source && payload.engine_request.source.acquisition) ||
      (payload.source && payload.source.acquisition) ||
      "CACHE_ONLY";
    const radio = document.querySelector(`input[name="acquisition"][value="${acq}"]`);
    if (radio) radio.checked = true;

    $("use-raw-json").checked = isNested;
    $("raw-json-input").value = JSON.stringify(payload, null, 2);
    if (isNested) {
      $("raw-json-details").open = true;
    }
    updateMapSelection();
  }

  function loadPresets() {
    fetch("/api/v1/adaptive-evidence/presets")
      .then((res) => res.json())
      .then((data) => {
        const container = $("preset-buttons");
        const pinLayer = $("map-presets-layer");
        if (!container) return;
        container.textContent = "";
        if (pinLayer) pinLayer.textContent = "";
        for (const p of data.presets || []) {
          presetsById[p.id] = p;
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "btn btn-small";
          btn.textContent = p.label;
          btn.dataset.presetId = p.id;
          btn.addEventListener("click", () => applyPreset(p.id));
          container.appendChild(btn);

          const pt = p.pin_lon_lat;
          if (pinLayer && Array.isArray(pt) && pt.length === 2) {
            const dot = svgEl("circle", {
              cx: pt[0],
              cy: -pt[1],
              r: "1.6",
              class: "map-preset-pin",
            });
            dot.setAttribute("data-preset-pin", p.id);
            const title = svgEl("title", {});
            title.textContent = p.label;
            dot.appendChild(title);
            dot.addEventListener("click", (evt) => {
              evt.stopPropagation();
              applyPreset(p.id);
            });
            pinLayer.appendChild(dot);
          }
        }
      })
      .catch(() => {
        // Non-fatal
      });
  }

  function statusClassName(outcome) {
    return "status-banner status-" + String(outcome || "evidence_blocked").toLowerCase();
  }

  function renderTableRows(tbodyId, rows, emptyMsg, cols) {
    const tbody = $(tbodyId);
    if (!tbody) return;
    tbody.textContent = "";
    if (!rows || rows.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = cols;
      td.textContent = emptyMsg;
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    for (const cells of rows) {
      const tr = document.createElement("tr");
      for (const cellVal of cells) {
        const td = document.createElement("td");
        td.textContent = cellVal == null ? "" : String(cellVal);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  function renderEnvelope(env) {
    $("results-empty").classList.add("hidden");
    $("results-panel").classList.remove("hidden");

    const banner = $("result-status-banner");
    banner.className = statusClassName(env.status_outcome);
    banner.textContent = `Status Outcome: ${env.status_outcome} — Summary: ${env.overall_summary_status}`;

    const ae = env.adaptive_evidence || {};
    const caps = ae.capabilities || {};
    const c1 = caps.C1 || {};
    const gr = env.scientific_guardrails || {};

    $("guardrail-coords").textContent = JSON.stringify(c1.point_lon_lat || null);
    $("guardrail-land").textContent = `${c1.land_status || "UNKNOWN"} / ${c1.physical_surface || "UNKNOWN"}`;
    $("guardrail-validated").textContent = `${String(gr.field_validated)} (yield: ${String(gr.marketable_yield)}, profit: ${String(gr.profit)})`;
    $("guardrail-reqid").textContent = env.result_id ? env.result_id.slice(0, 16) : env.request_id || "";

    // Capability cards C1-C10
    const capGrid = $("capability-grid");
    capGrid.textContent = "";
    for (const cid of Object.keys(caps)) {
      const cap = caps[cid];
      const div = document.createElement("div");
      div.className = "cap-card";
      const head = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = `${cid}: `;
      const badge = document.createElement("span");
      badge.className = `badge badge-${String(cap.status || "blocked").toLowerCase()}`;
      badge.textContent = cap.status || "UNKNOWN";
      head.appendChild(title);
      head.appendChild(badge);
      const nameDiv = document.createElement("div");
      nameDiv.textContent = cap.name || "";
      const detailDiv = document.createElement("div");
      detailDiv.className = "muted";
      detailDiv.textContent = cap.missing_reason ? `[${cap.missing_reason}] ${cap.detail || ""}` : cap.detail || "";
      div.appendChild(head);
      div.appendChild(nameDiv);
      div.appendChild(detailDiv);
      capGrid.appendChild(div);
    }

    // 5-Year Decision vs C7 Screening
    const fiveYrSection = $("five-year-section");
    const c7Section = $("c7-screening-section");
    fiveYrSection.classList.add("hidden");
    c7Section.classList.add("hidden");

    const fiveYr = env.five_year_research_plan;
    const upstreamCd = env.upstream_client_decision_response;
    if (fiveYr && (fiveYr.status === "RESEARCH_COMPARISON_COMPLETE" || fiveYr.status === "CONDITIONAL_RESEARCH_COMPLETE")) {
      fiveYrSection.classList.remove("hidden");
      const selected = (fiveYr.selected_policy_ids || []).join(", ") || "None";
      $("five-year-summary-note").textContent = upstreamCd
        ? `Authoritative Codex A ClientDecisionService (${upstreamCd.schema}): status=${upstreamCd.status}, selected policies=${selected}.`
        : `WaterCore 5-Year Research Planner: status=${fiveYr.status}, selected policies=${selected}.`;

      const candRows = (fiveYr.candidates || []).map((c) => [
        c.policy_id,
        c.origin,
        JSON.stringify(c.five_year_choices || {}),
      ]);
      renderTableRows("five-year-candidates-tbody", candRows, "No candidate rows.", 3);

      const scenRows = (fiveYr.scenario_outcomes || []).map((s) => [
        s.policy_id,
        s.scenario_id,
        s.status,
        String(s.service_pass),
        s.ET_shortfall_m3_equivalent,
        s.source_withdrawal_m3,
      ]);
      renderTableRows("five-year-scenarios-tbody", scenRows, "No scenario outcomes.", 6);

      if (upstreamCd && upstreamCd.report_dto) {
        $("codex-dto-pre").textContent = JSON.stringify(upstreamCd.report_dto.summary || upstreamCd.report_dto, null, 2);
        $("codex-dto-wrap").classList.remove("hidden");
      } else {
        $("codex-dto-wrap").classList.add("hidden");
      }
    } else if (caps.C7 && caps.C7.status === "CONDITIONAL" && caps.C7.diagnostics) {
      c7Section.classList.remove("hidden");
      const ranks = (caps.C7.diagnostics.candidate_ranking || []).map((r) => [
        r.crop,
        r.botanical_family || "",
        r.composite_water_adequacy_score,
        `${r.net_deficit_ref_mm} mm`,
        `${r.net_deficit_worst_mm} mm`,
      ]);
      renderTableRows("c7-ranking-tbody", ranks, "No C7 crop ranking rows.", 5);
    }

    // Usable C2/C3/C4 Summary
    const usableSummary = [];
    if (caps.C2 && caps.C2.diagnostics) {
      const d = caps.C2.diagnostics;
      usableSummary.push(`C2 Climate (${caps.C2.fixture_origin}): Mean Precip ${d.mean_annual_precipitation_mm} mm/yr, ET0 ${d.conditional_hs_et0_mm_year} mm/yr, Mean Temp ${d.mean_temperature_c} C, Days Verified ${d.days_verified}`);
    }
    if (caps.C3 && caps.C3.diagnostics) {
      const d = caps.C3.diagnostics;
      const p = d.properties_si || {};
      const clay = p.clay ? `${p.clay.mean}%` : "N/A";
      const sand = p.sand ? `${p.sand.mean}%` : "N/A";
      const silt = p.silt ? `${p.silt.mean}%` : "N/A";
      const soc = p.soc ? `${p.soc.mean} ${p.soc.unit || "g/kg"}` : "N/A";
      const ph = p.phh2o ? `${p.phh2o.mean}` : "N/A";
      const bd = p.bdod ? `${p.bdod.mean} ${p.bdod.unit || "kg/dm3"}` : "N/A";
      const dep = Array.isArray(d.depth_interval_cm) ? `${d.depth_interval_cm[0]}-${d.depth_interval_cm[1]} cm` : "";
      usableSummary.push(`C3 SoilGrids 250m (${caps.C3.fixture_origin}${dep ? ", " + dep : ""}): Clay ${clay}, Sand ${sand}, Silt ${silt}, SOC ${soc}, pH ${ph}, BD ${bd}`);
    }
    $("climate-soil-summary").textContent = usableSummary.length > 0 ? usableSummary.join(" | ") : "No C2/C3 environmental metrics available for this request.";

    // Blocked & Next Measurements & Provenance
    const blockedRows = (ae.blocked_claims || []).map((b) => [
      b.capability_id,
      b.capability_name,
      b.missing_reason,
      b.explanation,
    ]);
    renderTableRows("blocked-claims-tbody", blockedRows, "No blocked capabilities.", 4);

    const nextRows = (ae.minimal_next_measurements || []).map((m) => [
      m.priority_rank,
      m.parameter,
      m.measurement_action,
      (m.upgrades_capabilities || []).join(", "),
    ]);
    renderTableRows("next-meas-tbody", nextRows, "No additional measurements needed for current tier.", 4);

    const evObjs = (ae.provenance_and_uncertainty_ledger && ae.provenance_and_uncertainty_ledger.evidence_objects) || [];
    const provRows = evObjs.map((ev) => [
      ev.parameter_path,
      ev.provider,
      ev.fixture_origin,
      ev.converted_si_value != null ? `${ev.converted_si_value} ${ev.si_unit || ""}` : "Unavailable",
      (ev.raw_source_sha256 || ev.receipt_sha256 || "N/A").slice(0, 16),
      ev.retrieved_at || "N/A",
    ]);
    renderTableRows("provenance-tbody", provRows, "No external source receipts attached.", 6);

    // Export links
    const arts = env.artifacts || {};
    $("export-html-link").href = arts.html_report || "#";
    $("export-json-link").href = arts.json_export || "#";
    $("export-csv-link").href = arts.csv_export || "#";
    $("raw-response-pre").textContent = JSON.stringify(env, null, 2);

    // History pill
    const existingIdx = sessionHistory.findIndex((item) => item.result_id === env.result_id);
    if (existingIdx >= 0) sessionHistory.splice(existingIdx, 1);
    sessionHistory.unshift(env);
    if (sessionHistory.length > 8) sessionHistory.pop();
    renderHistory();
  }

  function renderHistory() {
    const bar = $("session-history-list");
    if (!bar) return;
    bar.textContent = "";
    for (const item of sessionHistory) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-small";
      const pt = ((item.adaptive_evidence || {}).capabilities || {}).C1;
      const ptText = pt && pt.point_lon_lat ? `[${pt.point_lon_lat.join(", ")}]` : item.request_id;
      btn.textContent = `${ptText} (${item.status_outcome})`;
      btn.addEventListener("click", () => renderEnvelope(item));
      bar.appendChild(btn);
    }
  }

  async function runAnalysis() {
    const errBox = $("ui-error-box");
    const loadingBox = $("ui-loading-box");
    const btn = $("run-analysis-btn");
    errBox.classList.add("hidden");
    errBox.textContent = "";

    let payload;
    try {
      payload = buildPayloadFromForm();
    } catch (err) {
      errBox.textContent = `Invalid input JSON/syntax: ${err.message}`;
      errBox.classList.remove("hidden");
      return;
    }

    loadingBox.classList.remove("hidden");
    btn.disabled = true;
    try {
      const res = await fetch("/api/v1/adaptive-evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (_parseErr) {
        throw new Error(`HTTP ${res.status}: non-JSON server response (${text.slice(0, 140)})`);
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${data.status || text}`);
      }
      renderEnvelope(data);
    } catch (err) {
      errBox.textContent = `Request failed: ${err.message}`;
      errBox.classList.remove("hidden");
    } finally {
      loadingBox.classList.add("hidden");
      btn.disabled = false;
    }
  }

  function bindEvents() {
    const svg = $("world-map-svg");
    if (svg) {
      svg.addEventListener("click", (evt) => {
        const coords = clientToLonLat(evt);
        if (!coords) return;
        $("lon-input").value = coords[0];
        $("lat-input").value = coords[1];
        $("site-id").value = `MAP_${coords[0]}_${coords[1]}`;
        $("site-name").value = `Selected Map Point [${coords[0]}, ${coords[1]}]`;
        $("use-raw-json").checked = false;
        updateMapSelection();
      });
    }

    $("zoom-in-btn").addEventListener("click", () => zoomMap(0.6));
    $("zoom-out-btn").addEventListener("click", () => zoomMap(1.5));
    $("pan-left-btn").addEventListener("click", () => panMap(-0.2, 0));
    $("pan-right-btn").addEventListener("click", () => panMap(0.2, 0));
    $("reset-map-btn").addEventListener("click", resetMapView);

    $("lon-input").addEventListener("input", updateMapSelection);
    $("lat-input").addEventListener("input", updateMapSelection);
    $("geojson-input").addEventListener("input", updateMapSelection);
    $("clear-geojson-btn").addEventListener("click", () => {
      $("geojson-input").value = "";
      updateMapSelection();
    });

    $("geojson-file").addEventListener("change", (evt) => {
      const file = evt.target.files && evt.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        $("geojson-input").value = String(reader.result || "");
        updateMapSelection();
      };
      reader.readAsText(file);
    });

    $("sync-raw-json-btn").addEventListener("click", () => {
      try {
        const wasChecked = $("use-raw-json").checked;
        $("use-raw-json").checked = false;
        const p = buildPayloadFromForm();
        $("raw-json-input").value = JSON.stringify(p, null, 2);
        $("use-raw-json").checked = wasChecked;
      } catch (err) {
        $("ui-error-box").textContent = `Cannot build JSON: ${err.message}`;
        $("ui-error-box").classList.remove("hidden");
      }
    });

    $("run-analysis-btn").addEventListener("click", runAnalysis);
  }

  document.addEventListener("DOMContentLoaded", () => {
    setViewBox();
    loadWorldMap();
    loadPresets();
    bindEvents();
    updateMapSelection();
  });
})();

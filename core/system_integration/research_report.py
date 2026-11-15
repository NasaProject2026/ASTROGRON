"""Additive B-renderer support for A's successful, unselected native Pareto comparison."""
from customer_reports.render import CSS, english

CROPS = {'research:NL:potato_Fontane': 'Potato (Fontane)',
         'research:NL:sugarbeet_601': 'Sugar beet (601)',
         'research:NL:spring_barley_301': 'Spring barley (301)'}
SCENARIOS = {'REFERENCE': 'Reference inputs', 'LOW_INITIAL_MINERAL_N': 'Zero initial mineral N',
             'HALF_RAIN': 'Half historical rainfall'}


def render(report):
    r = report.response
    decision = r['decision']
    pareto = decision.get('pareto_ids', [])
    if decision.get('selected_ids') or len(pareto) != 2 or len(r['report_dto']['five_year_rows']) != 30:
        raise ValueError('NATIVE_PARETO_REPORT_SCOPE_NOT_VISUALLY_QUALIFIED')
    alternatives = [(i, a) for i, a in enumerate(r['alternatives']) if a['policy_id'] in pareto]
    names = {a['policy_id']: f'Alternative {i+1}' for i, (_, a) in enumerate(alternatives)}
    rows = list(enumerate(report.dto['five_year_rows']))
    if any(row['crop_use_id'] not in CROPS for _, row in rows):
        raise ValueError('UNKNOWN_NATIVE_CROP_LABEL')
    pages = []
    body = '<span class="tag">Conditional research comparison</span><p class="lead">Wageningen, Netherlands: one historical research analogue.</p>'
    body += '<div class="notice"><strong>Two research alternatives; no overall winner.</strong> Both sequences remain on the Pareto frontier. The comparison does not select or recommend either crop plan for a farm.</div>'
    body += '<p>Five annual crop seasons use the same 2016-2020 NASA weather record and an unmeasured teaching soil. Field suitability, marketable yield and profit remain unavailable.</p>'
    table = []
    for year in range(2016, 2021):
        record = [str(year)]
        for _, alternative in alternatives:
            row = next(row for _, row in rows if row['policy_id'] == alternative['policy_id'] and row['source_year'] == year and row['scenario_id'] == 'REFERENCE')
            record.append(english(CROPS[row['crop_use_id']]))
        table.append(record)
    body += '<h2>Five historical crop seasons</h2>' + report.table(['Source weather year', 'Alternative 1', 'Alternative 2'], table)
    body += '<p class="note">These source years support historical analogues. Planning slots are labels, not future weather forecasts. Each season produces a modeled crop; there are uncropped intervals between seasons.</p>'
    area_pointer = report.dto['result_pointers']['raw_science'] + '/normalized_request/fields/0/area_ha'
    body += '<p>Declared field area: ' + report.number(area_pointer, 'ha') + ' ha. The complete request and all field/year/scenario records accompany this report.</p>'
    body += '<h2>Before using these results</h2><p>Confirm field soil measurements, initial water and nutrient stocks, crop calendars and local permissions with a qualified adviser. The model does not establish crop protection or water extraction clearance.</p>'
    pages.append(report.page('Your Research Comparison', body, True))

    body = '<p class="lead">Crop services and nitrogen loss are separate research objectives. They do not establish a common crop value or an economic ranking.</p>'
    body += '<p>Values below cover all five years for the declared field. Dry matter means modeled living storage organs, not harvested marketable produce. Different crop dry matter totals must not be treated as interchangeable sales yield.</p>'
    table = []
    for index, case in enumerate(r['engine_result']['cases']):
        base = f'/engine_result/cases/{index}/five_year_services'
        row = [names[case['policy_id']], english(SCENARIOS.get(case['scenario_id'], 'Declared intervention'))]
        for crop in CROPS:
            row.append(report.number(base + '/crop_storage_DM_kg_field_by_crop/' + crop, 'kg modeled storage-organ DM/field'))
        row.append(report.number(base + '/N_leaching_kg_N_field', 'kg N/field'))
        table.append(row)
    body += report.table(['Plan', 'Matched inputs', 'Potato DM (kg/field)', 'Beet DM (kg/field)', 'Barley DM (kg/field)', 'N leached (kg/field)'], table, 'smalltable')
    body += '<h2>How to read the interventions</h2><p>Scenario labels identify requested input experiments. Initial mineral nitrogen and rainfall are explicit assumptions, using the same source weather record.</p><ul>'
    for si, scenario in enumerate(r['engine_result']['normalized_request']['scenarios']):
        body += '<li>' + english(SCENARIOS.get(scenario['scenario_id'], 'Declared intervention')) + ': rainfall multiplier ' + report.number(f'/engine_result/normalized_request/scenarios/{si}/rain_factor', 'dimensionless rainfall input multiplier') + '.</li>'
    body += '</ul>'
    body += '<div class="notice">These three matched input scenarios are not probabilities, forecasts or a calibrated range of farm outcomes. No overall winner is supported.</div>'
    body += '<p class="note">Scenario names identify the submitted interventions. The source request retains the exact rainfall factors and all assumptions.</p>'
    pages.append(report.page('Alternatives and Uncertainty', body))

    reference = [(i, row) for i, row in rows if row['scenario_id'] == 'REFERENCE']
    body = '<p class="lead">Water and nitrogen continue across annual boundaries. This table shows reference-input records for both alternatives.</p>'
    table = []
    for i, row in reference:
        water = ' / '.join(report.cell(i, f'growth_model/water_end_total_layer_mm/{layer}', 'mm total layer water') for layer in range(4))
        table.append([names[row['policy_id']], str(row['source_year']), english(CROPS[row['crop_use_id']]), water,
                      report.cell(i, 'biological_uptake/value', 'kg N/ha')])
    body += report.table(['Plan', 'Source year', 'Crop', 'Ending water, layers 1 / 2 / 3 / 4 (mm)', 'Modeled N uptake (kg/ha)'], table, 'smalltable')
    body += '<p class="note">Native water is total water in each soil layer, rather than legacy plant-available water. Boundary dates remain in the canonical records. The final boundary is 31 December 2020 at the start of day: 1,827 forcing dates and 1,826 modeled intervals.</p>'
    body += '<h2>What continuity establishes</h2><p>Modeled water and soil nitrogen states carry from one year into the next. Model-domain nitrogen accounting is not a complete physical field budget for harvest and residues. Plant uptake is an unvalidated process-model result.</p>'
    pages.append(report.page('Water and Nitrogen Carryover', body))

    body = '<p class="lead">Phosphorus and potassium follow explicitly declared elemental inventories. They do not constrain crop physiology in this model.</p>'
    table = []
    for i, row in reference:
        for si, annual in enumerate(row.get('soil_accounting') or []):
            table.append([names[row['policy_id']], str(row['source_year']),
                          report.cell(i, f'soil_accounting/{si}/balance/P/ending_total', 'kg P/ha'),
                          report.cell(i, f'soil_accounting/{si}/balance/K/ending_total', 'kg K/ha')])
    body += report.table(['Plan', 'Source year', 'Ending P inventory (kg/ha)', 'Ending K inventory (kg/ha)'], table)
    body += '<div class="notice">Inventory totals include the declared soil, crop and retained-residue accounting scope. These amounts are not laboratory soil results, plant availability, predicted biological P/K uptake or fertilizer recommendations.</div>'
    body += '<h2>Important evidence gaps</h2><p>No local field calibration, observed commercial yield, physical harvest/residue fate, physiological P/K response or economic crop-value comparison is established. Wheat is outside the admitted producing profile because the native nitrogen process failed its scientific gate.</p>'
    body += '<p class="note">All three input scenarios and their exact P/K balances are preserved in the JSON and CSV. The reference table is a readable subset, not a substitute for those records.</p>'
    pages.append(report.page('Phosphorus and Potassium', body))

    body = '<h2>Costs and Returns</h2><div class="notice"><strong>Unavailable.</strong> No qualified marketable yield, model-linked profit or overall economic winner is supplied. Missing values are not zero.</div>'
    body += '<h2>Where the evidence comes from</h2><p>NASA Langley Research Center POWER supplies the original 2016-2020 UTC point weather series near Wageningen. Meteorology uses MERRA2 and solar data use CERES SYN1deg. Regional grid values are not measurements at the field.</p>'
    body += '<p>PCSE 6.0.13 runs the source-pinned native water, crop growth and nitrogen processes. Published crop parameters and the teaching soil define a bounded research profile. Exact dataset retrieval receipts, units, source identities and evidence pointers are in the separate technical appendix.</p>'
    body += '<h2>Your Next Steps</h2><ol><li>Collect dated field soil and water measurements with layer depths, units and methods.</li><li>Verify crop history, local calendars, water access and responsible-authority permissions.</li><li>Obtain observed yield and complete, dated market and cost evidence before an economic comparison.</li><li>Review both research alternatives with a local adviser before any field decision.</li></ol>'
    body += '<h2>Accompanying Records</h2><p>The canonical API response, lossless field/year CSV, numeric source bindings and technical appendix retain the evidence. Tables display two decimals using the declared rounding rule. The report copies model values and does not recalculate science or select a plan.</p>'
    pages.append(report.page('Evidence and Next Steps', body))
    extra = '.native table{font-size:12px}.native th,.native td{padding:7px 6px}.native .smalltable{font-size:11px}@media print{.native table{font-size:8.5pt}.native th{font-size:8pt}.native td,.native th{padding:5px 4px}.native h1{font-size:26pt}.native p{margin:8px 0 11px}.native li{margin:7px 0}}'
    return '<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ASTRAGRON Farm Decision Summary</title><style>' + CSS + extra + '</style></head><body class="native"><main>' + ''.join(pages) + '</main></body></html>'

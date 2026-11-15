"""Plain-English presentation of A's v1 DTO and its exact result pointers.

No engine imports, agronomic calculations, economic calculations or new ranking.
All numerical cells retain JSON pointers and raw values in a binding export.
"""
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from html import escape
from pathlib import Path
import argparse
import csv
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]
CSS = '''
:root{--ink:#173039;--muted:#52676d;--green:#186653;--pale:#eef5f1;--line:#cbd9d5;--amber:#8a5118}
*{box-sizing:border-box}body{margin:0;background:#e9eeeb;color:var(--ink);font:15px/1.5 Arial,sans-serif}
main{max-width:900px;margin:auto}.page{background:white;padding:40px 46px;margin:24px 0;min-height:1010px;position:relative}
.brand{font-size:14px;letter-spacing:3px;font-weight:bold;color:var(--green);border-bottom:2px solid var(--green);padding-bottom:13px}
.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);margin-top:28px}
h1{font-size:36px;line-height:1.12;letter-spacing:-1px;margin:9px 0 18px}h2{font-size:25px;line-height:1.2;margin:24px 0 12px}h3{font-size:17px;margin:20px 0 8px}
p{margin:9px 0 14px}.lead{font-size:18px;line-height:1.5}.tag{display:inline-block;background:var(--pale);padding:7px 11px;border-radius:3px;font-weight:bold;font-size:13px;color:var(--green)}
.notice{border-left:4px solid var(--amber);background:#fbf5eb;padding:12px 16px;margin:18px 0}.muted,.note{color:var(--muted)}.note{font-size:12px;line-height:1.5}
.facts{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:20px 0}.fact{background:var(--pale);padding:14px 17px}.fact b{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.7px;color:var(--muted)}
table{width:100%;border-collapse:collapse;margin:14px 0 18px;font-size:13px;table-layout:fixed}th{background:var(--pale);color:var(--ink);text-align:left;font-size:12px}th,td{padding:10px 8px;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}
td.number{text-align:right;font-variant-numeric:tabular-nums}li{margin:9px 0}ul,ol{padding-left:22px}.reason{font-size:13px}.rule{border-top:1px solid var(--line);margin:20px 0}.footer{font-size:11px;color:var(--muted);margin-top:25px;padding-top:12px;border-top:1px solid var(--line)}
.barrow{display:grid;grid-template-columns:60px 1fr 105px;gap:12px;align-items:center;margin:14px 0;font-size:13px}.track{height:18px;background:#edf1ef;border-radius:3px}.bar{height:100%;min-width:1px;background:var(--green);border-radius:3px}.value{text-align:right;font-variant-numeric:tabular-nums}
.compact .page{min-height:0}.compact h1{font-size:31px}.smalltable{font-size:12px}
.page:first-child .footer{display:none}.prepared{float:right;font-size:10px;letter-spacing:0;font-weight:normal;color:var(--muted)}
@media(max-width:600px){body{font-size:15px}.page{margin:0 0 12px;padding:25px 18px;min-height:0}h1{font-size:30px}.facts{grid-template-columns:1fr}th,td{padding:8px 5px;font-size:11px}.barrow{grid-template-columns:45px 1fr 90px;gap:7px}.lead{font-size:17px}}
@page{size:A4;margin:14mm 14mm 17mm}
@media print{body{background:white;font-size:11pt;line-height:1.45}main{max-width:none}.page{min-height:0;margin:0;padding:0;break-after:page}.page:last-child{break-after:auto}.brand{font-size:11pt}h1{font-size:29pt}h2{font-size:20pt}table{font-size:10pt}th{font-size:9pt}.note{font-size:9pt}.footer{font-size:8pt}tr,.notice,.fact,.barrow{break-inside:avoid}thead{display:table-header-group}.facts{grid-template-columns:1fr 1fr}th,td{padding:8px 6px}}
'''

CROPS = {
 'research:AU:wheat_inventory_scenario':'Wheat',
 'research:AU:chickpea_inventory_scenario':'Chickpea',
 'research:AU:earlier_sowing':'Earlier-sown research crop',
 'research:AU:later_sowing':'Later-sown research crop',
 'research:KE:earlier_sowing':'Earlier-sown research crop',
 'research:KE:later_sowing':'Later-sown research crop',
}
PLACES={'AU_WAGGA_REGION':'Research site near Wagga Wagga, Australia',
        'KE_NYERI_REGION':'Research site near Nyeri, Kenya',
        'SE_UPPSALA':'Research site near Uppsala, Sweden'}

def pointer(data, path):
    for key in path.strip('/').split('/'):
        key=key.replace('~1','/').replace('~0','~')
        data=data[int(key)] if isinstance(data,list) else data[key]
    return data

def decimal_text(value):
    if value is None:
        return 'Unavailable'
    number=Decimal(str(value))
    if not number.is_finite():
        raise ValueError('Nonfinite report number')
    return format(number.quantize(Decimal('0.01'),rounding=ROUND_HALF_UP),',.2f')

def english(text):
    if re.search(r'[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]',text):
        raise ValueError('English-only customer report')
    return escape(text)

class Report:
    def __init__(self, response):
        if response.get('schema')!='astragron.client-decision.response.v1':
            raise ValueError('Unsupported API response')
        self.response=response
        self.dto=response['report_dto']
        if self.dto.get('schema')!='astragron.client-report-dto.v1':
            raise ValueError('Unsupported canonical report DTO')
        self.bindings=[]
        self.science=pointer(response,self.dto['result_pointers']['raw_science'])
        self.request=self.science['normalized_request']
        self.decision=pointer(response,self.dto['result_pointers']['decision']) or {}
        self.alternatives=pointer(response,self.dto['result_pointers']['alternatives'])
        self.selected=self.decision.get('selected_ids',[])
        # Never elect a substitute policy when the API abstains.
        self.rows=[(i,r) for i,r in enumerate(self.dto['five_year_rows']) if r['policy_id'] in self.selected]
        self.fields={f['field_id']:f'Field {i+1}' for i,f in enumerate(self.request['fields'])}
        self.policy_names={a['policy_id']:f'Sequence {i+1}' for i,a in enumerate(self.alternatives)}
        self.scenario_names={s['scenario_id']:f'Historical comparison {i+1}' for i,s in enumerate(self.request['scenarios'])}

    def number(self,path,unit):
        value=pointer(self.response,path)
        displayed=decimal_text(value)
        self.bindings.append({'pointer':path,'canonical_value':value,'display_value':displayed,'unit':unit})
        return f'<span class="numeric" data-source="{escape(path,quote=True)}" data-value="{escape(json.dumps(value),quote=True)}">{displayed}</span>'

    def cell(self,i,suffix,unit):
        return self.number(f'/report_dto/five_year_rows/{i}/{suffix}',unit)

    def page(self,title,body,first=False):
        heading=f'<div class="eyebrow">Your farm decision summary</div><h1>{title}</h1>' if first else f'<h1>{title}</h1>'
        prepared=datetime.now(timezone.utc).strftime('%d %B %Y')
        return f'<section class="page"><div class="brand">ASTRAGRON<span class="prepared">Prepared {prepared}</span></div>{heading}{body}<div class="footer">Research comparison | Historical weather, declared inputs</div></section>'

    def table(self,head,rows,cls=''):
        return f'<table class="{cls}"><thead><tr>'+''.join(f'<th>{english(c)}</th>' for c in head)+'</tr></thead><tbody>'+''.join('<tr>'+''.join(f'<td>{c}</td>' for c in row)+'</tr>' for row in rows)+'</tbody></table>'

    def gaps(self):
        gaps=pointer(self.response,self.dto['result_pointers']['missing_evidence'])
        categories=[]
        mapping=[('crop','Provide locally suitable crop calendars, crop water parameters and dated sources.'),
                 ('soil','Provide field soil measurements, layer depths and initial water or nutrient stocks.'),
                 ('source','Restore the required historical weather source and its retrieval receipt.'),
                 ('weather','Restore complete historical weather with verified units and dates.'),
                 ('nutrient','Provide independently supported nutrient-response evidence before using growth or yield outputs.'),
                 ('supply','Verify physical water access, supply limits and extraction rights locally.'),
                 ('water','Verify physical water access, supply limits and extraction rights locally.')]
        for gap in gaps:
            description=(str(gap.get('path',''))+' '+str(gap.get('reason',''))).lower()
            if 'source_ablated' in description:
                description='source'
            match=next((sentence for key,sentence in mapping if key in description),
                       'Supply the additional verified farm inputs identified in the separate technical appendix.')
            if match not in categories:
                categories.append(match)
        return categories

    def render(self):
        if self.dto.get("research_comparison") and self.response["status"] == "CONDITIONAL_RESEARCH_COMPLETE":
            from system_integration.research_report import render
            return render(self)
        pages=[]
        site=PLACES.get(self.request.get('location',{}).get('site_id'),'Declared research site')
        complete=self.response['status']=='CONDITIONAL_RESEARCH_COMPLETE'
        has_plan=bool(self.rows)
        tag='Conditional research comparison' if complete else 'More verified information is needed'
        intro=f'<span class="tag">{tag}</span><p class="lead">{english(site)}</p>'
        intro+='<p>This report compares declared crop sequences under historical weather. It is a research scenario and has not been validated for use on this farm.</p>'
        if not has_plan:
            intro+='<div class="notice"><strong>No crop plan is recommended.</strong> The available evidence is insufficient to complete the requested comparison.</div>'
            intro+='<h2>What to do next</h2><ol>'+''.join('<li>'+english(g)+'</li>' for g in self.gaps())+'</ol>'
            intro+='<h2>What remains unavailable</h2><p>Crop yield, fertilizer prescriptions, profit estimates and pesticide clearance are unavailable. Missing results are not zero values.</p>'
            intro+='<p>Confirm field boundaries and soil measurements, provide dated farm inputs, and verify local water rights before seeking a field-specific recommendation.</p>'
            pages.append(self.page('Your Farm at a Glance',intro,True))
        else:
            scenario_ids=list(dict.fromkeys(r['scenario_id'] for _,r in self.rows))
            # First-page plan is not silently repeated once per historical analogue.
            primary=scenario_ids[0]
            primary_rows=[(i,r) for i,r in self.rows if r['scenario_id']==primary]
            fields=[]
            for index,field in enumerate(self.request['fields']):
                value=self.number(f"{self.dto['result_pointers']['raw_science']}/normalized_request/fields/{index}/area_ha",'ha')
                fields.append(f'<div class="fact"><b>{self.fields[field["field_id"]]} area - assumed</b>{value} hectares</div>')
            intro+='<div class="facts">'+''.join(fields)+'</div>'
            selected_scenarios=[s for a in self.alternatives if a['policy_id'] in self.selected for s in a['scenarios']]
            service_failed=any(s.get('service_pass') is False for s in selected_scenarios)
            first_takeaway=('The selected research sequence still exceeds the declared water-shortfall limit.' if service_failed else
                            'The sequence below is a conditional research result. Local crop suitability is still unverified.')
            intro+='<h2>Three things to know</h2><ul><li>'+first_takeaway+'</li><li>Weather comes from NASA regional data. Historical comparisons are not forecasts for the planning years.</li><li>Nutrient stocks are declared accounting inputs. They do not predict growth, yield or fertilizer need.</li></ul>'
            plan=[]
            legacy_demo=any(r.get('soil_accounting') for _,r in self.rows) and set(CROPS).issuperset({r['crop_use_id'] for _,r in self.rows}) and any(r['crop_use_id']=='research:AU:chickpea_inventory_scenario' for _,r in self.rows)
            for i,r in primary_rows:
                crop=CROPS.get(r['crop_use_id'],'Crop name requires confirmation')
                year=r['planning_year_slot'] if r['planning_year_slot'] is not None else r['source_year']
                reason='Declared nutrient stock' if any(r.get('soil_accounting') for _,r in self.rows) else 'Historical water comparison'
                if legacy_demo:
                    reason='Lower stated first-year withdrawal' if r['crop_use_id']=='research:AU:chickpea_inventory_scenario' else 'Declared follow-on crop'
                plan.append([self.fields[r['field_id']],str(year),english(crop),reason])
            intro+='<h2>Your Five-Year Crop Plan</h2>'+self.table(['Field','Planning year','Crop','Principal reason'],plan)
            intro+='<p class="note">Crop names identify hypothetical research budgets. Identical water profiles were deliberately assigned to wheat and chickpea in this demonstration. No real-world crop advantage is established.</p>'
            pages.append(self.page('Your Farm at a Glance',intro,True))

            body=('<p class="lead">This is a least-violating research option. The declared water-shortfall limit is still exceeded.</p>' if service_failed else
                  '<p class="lead">The engine selected this sequence within the submitted alternatives. Its suitability for this farm still needs checking.</p>')
            body+='<h2>Why these crops</h2><p>The previous crop changes the nutrient stock left for the next year through explicitly supplied withdrawal and residue budgets. Stocks carry forward rather than restarting each year. This is bookkeeping under study assumptions; there is no inferred nitrogen fixation bonus.</p>'
            if legacy_demo:
                body+='<p>In this example, the first-year chickpea budget withdraws less tracked nutrient than the wheat budget. Both submitted sequences then use the same follow-on wheat crop. These are declared scenario inputs, rather than observed crop performance.</p>'
            body+='<p>Each crop choice follows the same stated condition: compare the remaining nutrient stock and water shortfall within the submitted sequences. Local crop coefficients, rooting, sowing dates and soil measurements remain unqualified.</p>'
            altrows=[]
            for ai,a in enumerate(self.alternatives):
                for si,s in enumerate(a['scenarios']):
                    selected='Selected by the research comparison' if a['policy_id'] in self.selected else 'Alternative in the comparison'
                    worst=self.number(f'/alternatives/{ai}/scenarios/{si}/worst_service_deficit_mm','mm per harvest year')
                    failing=s.get('first_violated_constraint')
                    kind=(failing or {}).get('kind','')
                    risk={'DECLARED_SOIL_CONSTRAINT':'Declared nutrient-stock rule was not met',
                          'DECLARED_ELEMENT_BUDGET':'A declared nutrient withdrawal exceeded the tracked stock',
                          'DECLARED_WATER_SERVICE':'The declared water-shortfall limit was exceeded'}.get(kind,'No recorded rule violation in this evaluated scenario')
                    if s.get('service_pass') is False and not kind:
                        risk='The declared water-shortfall limit was exceeded'
                    altrows.append([self.policy_names[a['policy_id']],selected,worst,english(risk)])
            body+='<h2>Alternatives and first limiting resource</h2>'+self.table(['Sequence','Research result','Largest water deficit (mm)','First recorded limit'],altrows)
            body+='<h2>Risks that can change the plan</h2><ul><li><strong>High priority:</strong> local crop and soil parameters are assumptions. Measure them before field use.</li><li><strong>High priority:</strong> water access and extraction rights have not been independently verified.</li><li><strong>Uncertain:</strong> different historical weather, resource limits or crop budgets may change the ranking.</li></ul>'
            if len(scenario_ids)==1:
                body+='<div class="notice">Only one historical weather comparison is included in this run. A best-versus-worst climate range cannot be established from this sample.</div>'
            else:
                body+='<p>All evaluated historical comparisons remain in the accompanying data. They have no assigned probabilities and do not form a calibrated forecast range.</p>'
            pages.append(self.page('Why This Plan May Change',body))

            body='<p class="lead">Water deficit is the modeled gap between potential crop water use and actual use. It does not directly predict a yield loss.</p>'
            for sid in scenario_ids:
                rows=[(i,r) for i,r in self.rows if r['scenario_id']==sid]
                body+=f'<h2>{self.scenario_names[sid]}</h2>'
                if any(s.get('rain_factor',1)!=1 for s in self.request['scenarios'] if s['scenario_id']==sid):
                    body+='<div class="notice">Changed-input stress test: rainfall was deliberately altered. This is an intervention on historical data, not a weather forecast.</div>'
                maximum=max([float(r['water']['crop_ET_deficit_mm']) for _,r in rows]+[1])
                for i,r in rows:
                    width=100*float(r['water']['crop_ET_deficit_mm'])/maximum
                    val=self.cell(i,'water/crop_ET_deficit_mm','mm')
                    body+=f'<div class="barrow"><div>{r["planning_year_slot"] or r["source_year"]}</div><div class="track"><div class="bar" style="width:{width:.4f}%"></div></div><div class="value">{val} mm</div></div>'
                waterrows=[]
                for i,r in rows:
                    waterrows.append([str(r['planning_year_slot'] or r['source_year']),str(r['source_year']),
                        self.cell(i,'water/ET_potential_mm','mm'),self.cell(i,'water/ET_actual_mm','mm'),
                        self.cell(i,'water/source_withdrawal_m3','m3')])
                body+=self.table(['Planning year','Weather year','Potential use (mm)','Actual use (mm)','Source water (m3)'],waterrows)
            body+='<p class="note">Bars show crop water deficits in millimetres for each displayed harvest year. Larger bars mean a greater modeled gap. Source water is withdrawal from the declared supply; zero means a calculated zero, not missing information.</p>'
            body+='<h2>How to read this comparison</h2><p>Historical weather years are kept beside planning years so the time basis stays clear. Water is simulated continuously across years; initial soil moisture is not restored at each new year.</p>'
            body+='<p class="note">NASA POWER provides regional meteorological estimates, rather than a weather station or soil measurement on this farm. Credit: NASA Langley Research Center POWER project, Earth Science Division. Access date and service version are retained in the separate technical appendix.</p>'
            pages.append(self.page('Water: Pressure Across Years',body))

            soilrows=[]
            for i,r in primary_rows:
                for si,annual in enumerate(r.get('soil_accounting') or []):
                    if annual['uncertainty_scenario']!='POINT':
                        continue
                    suffix=f'soil_accounting/{si}'
                    completeness='Full calendar year' if annual.get('complete_calendar_year') else 'Partial year; calculation stopped'
                    soilrows.append([str(r['planning_year_slot'] or r['source_year']),
                        self.cell(i,f'{suffix}/balance/N/ending_total','kg N/ha'),
                        self.cell(i,f'{suffix}/balance/P/ending_total','kg P/ha'),
                        self.cell(i,f'{suffix}/balance/K/ending_total','kg K/ha'),completeness])
            body='<p class="lead">Nitrogen, phosphorus and potassium are tracked as elemental stocks. These stocks include soil, standing crop and retained residues.</p>'
            body+='<div class="notice">All nutrient amounts in this example are hypothetical research inputs. A tracked stock is not a laboratory soil result or a measure of nutrients available to plants.</div>'
            if soilrows:
                body+=self.table(['Planning year','Nitrogen (kg/ha)','Phosphorus (kg/ha)','Potassium (kg/ha)','Coverage'],soilrows)
                body+='<p class="note">Year-end totals under the central declared input scenario, per hectare. Nitrogen, phosphorus and potassium are also known as N, P and K. Retained residue stock has no decomposition model in this release.</p>'
            else:
                body+='<p>Nutrient-stock estimates are unavailable for this run. Provide verified initial stocks and dated crop budgets to enable a conditional comparison.</p>'
            body+='<h2>What the uncertainty means</h2><p>Lower, central and upper input scenarios test different declared budgets. They are not probabilities, statistical confidence intervals or a complete range of field outcomes.</p>'
            body+='<h2>What to measure</h2><ul><li>Take representative soil samples with sampling date, laboratory method, layer depth and units.</li><li>Confirm previous crops, residue handling and all nutrient additions or removals.</li><li>Record soil texture, water storage, drainage and actual irrigation access.</li></ul>'
            body+='<p>Soil acidity, salinity, organic matter, compaction and pest or disease response are not predicted by this nutrient ledger.</p>'
            pages.append(self.page('Water and Soil: Carryover',body))

            body='<h2>Costs and Returns</h2>'
            supplied=[(i,r) for i,r in self.rows if (r.get('economics') or {}).get('conditional_margin') is not None]
            if supplied:
                econrows=[]
                for i,r in supplied:
                    e=r['economics']
                    econrows.append([str(r['planning_year_slot'] or r['source_year']),
                        self.cell(i,'economics/assumed_yield_t_ha','t/ha'),
                        self.cell(i,'economics/inputs/price_per_t',e['currency']+'/t'),
                        self.cell(i,'economics/inputs/cost_per_ha',e['currency']+'/ha'),
                        self.cell(i,'economics/conditional_margin',e['currency']),english(e['currency'])])
                body+=self.table(['Year','Assumed yield (t/ha)','Price per tonne','Cost per hectare','Conditional margin','Currency'],econrows)
                body+='<p>These are farm-supplied assumptions. Margins are copied from the API and do not affect crop ranking. Missing years remain unavailable.</p>'
            else:
                body+='<div class="notice"><strong>Estimate unavailable.</strong> Provide dated farm-supplied yield, sale price, costs, currency and uncertainty for each field and year.</div>'
                body+='<p>The model has no qualified yield response. A future calculation from farm-supplied figures would be an assumption-based budget, rather than a predicted return.</p>'
            body+='<h2>Your Next Steps</h2><ol><li><strong>Confirm the field inputs.</strong> Verify area, previous crops, sowing calendar and local crop parameters.</li><li><strong>Measure soil and water.</strong> Obtain dated soil tests, initial water conditions and actual supply capacity.</li><li><strong>Verify permissions locally.</strong> Check water extraction rights and any proposed crop-protection product with the responsible authority.</li><li><strong>Update the comparison.</strong> Add complete farm costs and yields only with a clear source and uncertainty.</li><li><strong>Review with a local adviser.</strong> Use the research comparison as a discussion aid before making field decisions.</li></ol>'
            body+='<h2>Application Limits</h2><p>No fertilizer or pesticide dose, pest diagnosis, field-certified crop recommendation, yield guarantee or legal clearance is supplied. This report compares a finite set of declared alternatives under historical conditions.</p>'
            body+='<p class="note">Customer tables show two decimal places. The accompanying JSON and CSV preserve original values, units and exact source pointers; displayed values are verified at the stated rounding precision. Full methods and provenance are supplied separately.</p>'
            pages.append(self.page('Costs, Risks and Next Steps',body))
        body=''.join(pages)
        if re.search(r'\b(?:EVIDENCE_BLOCKED|NOT_VERIFIED|NOT_MODELED|CONDITIONAL_RESEARCH_COMPLETE|[a-f0-9]{64})\b',re.sub('<[^>]*>',' ',body)):
            raise ValueError('Internal status or hash leaked into customer text')
        return '<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ASTRAGRON Farm Decision Summary</title><style>'+CSS+'</style></head><body><main>'+body+'</main></body></html>'

def generate(source, output):
    raw=source.read_bytes()
    response=json.loads(raw)
    report=Report(response)
    html=report.render()
    output.mkdir(parents=True,exist_ok=True)
    (output/'Farm_Decision_Summary.html').write_text(html,encoding='utf-8')
    (output/'Canonical_API_Response.json').write_bytes(raw)
    (output/'Numeric_Source_Bindings.json').write_text(json.dumps(report.bindings,indent=2)+'\n',encoding='utf-8')
    with (output/'Numeric_Source_Bindings.csv').open('w',encoding='utf-8',newline='') as f:
        w=csv.DictWriter(f,fieldnames=['pointer','canonical_value','display_value','unit'])
        w.writeheader()
        w.writerows(report.bindings)
    # Full canonical scientific rows as exact JSON cells avoid a rival transport schema.
    with (output/'Canonical_Report_Rows.csv').open('w',encoding='utf-8',newline='') as f:
        w=csv.writer(f);w.writerow(['policy_id','scenario_id','field_id','source_year','canonical_report_row_json'])
        for r in response['report_dto']['five_year_rows']:
            w.writerow([r[k] for k in ['policy_id','scenario_id','field_id','source_year']]+[json.dumps(r,separators=(',',':'),allow_nan=False)])
    metadata={'api_response_sha256':hashlib.sha256(raw).hexdigest(),'run_id':response['run_id'],
              'generated_at_utc':datetime.now(timezone.utc).isoformat(),'report_pages_designed':html.count('<section class="page">'),
              'numeric_bindings':len(report.bindings),'precision':'2 decimal places, half up; raw values retained',
              'no_science_or_economics_recomputation':True}
    (output/'Report_Generation_Receipt.json').write_text(json.dumps(metadata,indent=2)+'\n',encoding='utf-8')
    return metadata

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('output',type=Path)
    args=p.parse_args();print(json.dumps(generate(args.source,args.output)))

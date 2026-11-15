"""Focused independent checks, including tamper controls; no engine execution."""
from copy import deepcopy
from pathlib import Path
import csv
import importlib.util
import json
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,ROOT/path)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

audit=load('independent_audit','evidence/independent_audit.py')
render=load('customer_renderer','customer_reports/render.py')
fixtures={p.name.split('.')[0]:audit.read(p) for p in (ROOT/'evidence/fixtures').glob('*.response.json')}

class IndependentAcceptance(unittest.TestCase):
    def test_all_fixtures_match_committed_response_schema(self):
        import jsonschema
        schema=audit.read(ROOT/'contracts/client_decision_response_v1.schema.json')
        for response in fixtures.values():jsonschema.validate(response,schema)

    def test_black_box_interventions_and_abstention(self):
        audit.api_checks(fixtures)

    def test_soil_mass_boundary_and_pool_totals(self):
        self.assertEqual(audit.soil_balances(fixtures['valid']['engine_result']),105)

    def test_tampered_external_mass_is_rejected(self):
        r=deepcopy(fixtures['valid']['engine_result'])
        r['soil_memory']['cases'][0]['annual'][0]['balance']['N']['external_inputs']='1'
        with self.assertRaises(AssertionError):audit.soil_balances(r)

    def test_tampered_pool_total_is_rejected(self):
        r=deepcopy(fixtures['valid']['engine_result'])
        r['soil_memory']['cases'][0]['annual'][0]['end_pools_kg_element_per_ha']['RESIDUE_P']='999'
        with self.assertRaises(AssertionError):audit.soil_balances(r)

    def test_harvest_depth_volume_and_year_continuity(self):
        self.assertEqual(audit.water_checks(fixtures['valid']['engine_result']),10)

    def test_tampered_water_deficit_is_rejected(self):
        r=deepcopy(fixtures['valid']['engine_result'])
        r['cases'][0]['field_harvest_years'][0]['crop_ET_deficit_mm']+=1
        with self.assertRaises(AssertionError):audit.water_checks(r)

    def test_false_profit_for_missing_inputs_is_rejected(self):
        f=deepcopy(fixtures)
        for a in f['valid']['alternatives']:
            for s in a['scenarios']:
                s['field_years'][0]['economics']['conditional_margin']=0
        with self.assertRaises(AssertionError):audit.api_checks(f)

    def test_dto_numbers_point_to_original_values(self):
        for name in ['valid','rain_zero','blocked']:
            r=render.Report(fixtures[name]);r.render()
            for cell in r.bindings:
                self.assertEqual(cell['canonical_value'],render.pointer(fixtures[name],cell['pointer']))
                self.assertEqual(cell['display_value'],render.decimal_text(cell['canonical_value']))

    def test_customer_cannot_leak_codes_or_arabic(self):
        for name in ['valid','rain_zero','blocked']:
            html=render.Report(fixtures[name]).render()
            text=__import__('re').sub('<[^>]*>',' ',html)
            self.assertNotRegex(text,r'EVIDENCE_BLOCKED|NOT_VERIFIED|NOT_MODELED|research:AU:|[a-f0-9]{64}|[\u0600-\u06ff]')
        with self.assertRaises(ValueError):render.english('\u0645\u062b\u0627\u0644')

    def test_blocked_case_has_no_substitute_plan(self):
        report=render.Report(fixtures['blocked']);html=report.render()
        self.assertEqual(report.rows,[])
        self.assertIn('No crop plan is recommended.',html)
        self.assertEqual(report.bindings,[])
        self.assertNotIn('Restore the required historical weather',html)
        self.assertIn('supply limits',html)

    def test_changed_rainfall_discloses_failed_water_limit(self):
        html=render.Report(fixtures['rain_zero']).render()
        self.assertIn('still exceeds the declared water-shortfall limit',html)

    def test_missing_values_are_not_zero(self):
        self.assertEqual(render.decimal_text(None),'Unavailable')
        self.assertEqual(render.decimal_text(0),'0.00')

    def test_renderer_does_not_mutate_api_response(self):
        original=deepcopy(fixtures['valid'])
        render.Report(fixtures['valid']).render()
        self.assertEqual(original,fixtures['valid'])

    def test_csv_json_projection_is_exact(self):
        # Temporary files are explicitly inside B's private runtime.
        parent=ROOT/'runtime/agent-b/test-output';parent.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=parent) as temporary:
            out=Path(temporary)
            render.generate(ROOT/'evidence/fixtures/valid.response.json',out)
            with (out/'Canonical_Report_Rows.csv').open(encoding='utf-8',newline='') as f:
                actual=[json.loads(r['canonical_report_row_json']) for r in csv.DictReader(f)]
            self.assertEqual(actual,fixtures['valid']['report_dto']['five_year_rows'])

    def test_foreign_report_schema_is_rejected(self):
        response=deepcopy(fixtures['valid']);response['report_dto']['schema']='unrecognized.v2'
        with self.assertRaises(ValueError):render.Report(response)

if __name__=='__main__':unittest.main(verbosity=2)

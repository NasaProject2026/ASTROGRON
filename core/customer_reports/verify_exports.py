"""Verify lossless machine parity and rounded customer-visible numeric parity."""
from pathlib import Path
from collections import Counter
import csv
import hashlib
import json
import re
from pypdf import PdfReader
from render import pointer,decimal_text

ROOT=Path(__file__).resolve().parents[1]

def demand(c,m):
    if not c:raise AssertionError(m)

def main():
    browser=json.loads((ROOT/'evidence/BROWSER_PRINT_VERIFICATION.json').read_text())
    results=[]
    fixture_names={'Supported_Research':'valid','Missing_Inputs':'blocked','Changed_Rainfall':'rain_zero'}
    for directory,name in fixture_names.items():
        d=ROOT/'customer_reports/samples'/directory
        source=ROOT/f'evidence/fixtures/{name}.response.json'
        demand(source.read_bytes()==(d/'Canonical_API_Response.json').read_bytes(),'Canonical bytes differ')
        response=json.loads(source.read_text());bindings=json.loads((d/'Numeric_Source_Bindings.json').read_text())
        with (d/'Canonical_Report_Rows.csv').open(encoding='utf-8',newline='') as f:
            rows=[json.loads(r['canonical_report_row_json']) for r in csv.DictReader(f)]
        demand(rows==response['report_dto']['five_year_rows'],'CSV row projection differs')
        with (d/'Numeric_Source_Bindings.csv').open(encoding='utf-8',newline='') as f:
            csvbindings=list(csv.DictReader(f))
        for b,c in zip(bindings,csvbindings,strict=True):
            demand(pointer(response,b['pointer'])==b['canonical_value'],'Binding changed original value')
            demand(str(b['canonical_value'])==c['canonical_value'],'CSV numeric raw value differs')
            demand(decimal_text(b['canonical_value'])==c['display_value']==b['display_value'],'Displayed precision differs')
        b=next(r for r in browser if Path(r['directory']).name==directory)
        for mode in ['desktop','mobile']:
            demand(len(b[mode]['numericBindings'])==len(bindings),'HTML binding count differs')
            for actual,expected in zip(b[mode]['numericBindings'],bindings,strict=True):
                demand(actual=={'pointer':expected['pointer'],'raw':expected['canonical_value'],'display':expected['display_value']},'HTML numbers differ')
        pdf_results=[]
        for pdf_name in ['Farm_Decision_Summary.pdf','Farm_Decision_Summary_Mobile_Print.pdf']:
            pdf=PdfReader(d/pdf_name);texts=[p.extract_text() for p in pdf.pages];text='\n'.join(texts)
            designed=5 if name!='blocked' else 1
            demand(len(pdf.pages)==designed,'Unexpected pagination or orphan page')
            demand(all(len(t)>600 for t in texts),'Near-empty or orphan PDF page')
            demand(not re.search(r'EVIDENCE_BLOCKED|NOT_VERIFIED|NOT_MODELED|research:AU:|[a-f0-9]{64}|[\u0600-\u06ff]',text),'Raw code or non-English text in PDF')
            demand('No crop plan is recommended.' in text if name=='blocked' else 'Five-Year Crop Plan' in text,'Missing first-page decision')
            expected=Counter(b['display_value'] for b in bindings)
            actual=Counter(re.findall(r'(?<![\d.,])(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}(?!\d)',text))
            for token,count in expected.items():demand(actual[token]>=count,'Visible PDF number missing: '+token)
            pdf_results.append({'file':str((d/pdf_name).relative_to(ROOT)),'pages':len(pdf.pages),
                'sha256':hashlib.sha256((d/pdf_name).read_bytes()).hexdigest(),'numeric_display_parity':True,
                'text_lengths':[len(t) for t in texts],'visual_QA':'Separate rendered-PNG inspection required'})
        results.append({'sample':directory,'exact_api_json_csv_parity':True,'html_pointer_numeric_parity':True,
                        'display_precision':'2 decimals, half up','numeric_bindings':len(bindings),'pdfs':pdf_results})
    (ROOT/'evidence/EXPORT_PARITY_VERIFICATION.json').write_text(json.dumps(results,indent=2)+'\n',encoding='utf-8')
    print(json.dumps([{'sample':r['sample'],'pages':r['pdfs'][0]['pages'],'numbers':r['numeric_bindings']} for r in results]))

if __name__=='__main__':main()

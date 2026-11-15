"""Retain B's DTO/HTML/CSV pipeline and add bounded, private PDF export."""
import os
from pathlib import Path
import subprocess

from brain.baseline import ROOT
from .codec import parse, write


def generate(source, directory, *, pdf=True, env=None, cancel=None, stop=None):
    from customer_reports.render import generate as render
    receipt = render(Path(source), Path(directory))
    response = parse(Path(source).read_text(encoding='utf-8'))
    appendix = {'schema': 'astragron.integration-evidence-appendix.v1', 'run_id': response['run_id'],
                'scientific_result_sha256': response['engine_result'].get('scientific_result_sha256'),
                'provenance': response['provenance'], 'qualification': response['qualification'],
                'warnings': response['warnings'], 'missing_requirements': response['missing_requirements'],
                'result_pointers': response['report_dto']['result_pointers'],
                'claim_register': parse((Path(directory) / 'Numeric_Source_Bindings.json').read_text(encoding='utf-8')),
                'old_b_fixtures': 'Historical A e8bd31e fixtures remain unchanged; they do not qualify this latest-A response.',
                'scientific_scope': 'Conditional historical research; no field advice, marketable yield, profit or overall winner.'}
    write(Path(directory) / 'Technical_Evidence_Appendix.json', appendix)
    if pdf:
        inherited = os.environ if env is None else env
        export_env = {k: v for k, v in inherited.items() if not any(x in k.upper() for x in ('API_KEY', 'TOKEN', 'SECRET', 'PASSWORD', 'AUTH_JSON'))}
        # Edge resolves its Windows default profile via the user token. A synthetic
        # Python USERPROFILE makes that lookup fail before CDP connects. Playwright
        # still creates its separate temporary browser profile below package TEMP.
        if os.name == 'nt': export_env.pop('USERPROFILE', None)
        from .processes import OwnedProcess
        import time
        owned = OwnedProcess([inherited.get('ASTRAGRON_NODE', 'node'), str(ROOT / 'system_integration/print.cjs'), str(Path(directory).resolve())],
                             cwd=ROOT, env=export_env, memory_bytes=1024**3)
        started = time.monotonic()
        try:
            while owned.process.poll() is None:
                if (cancel and cancel.is_set()) or (stop and stop.is_set()):
                    owned.terminate()
                    raise RuntimeError('REPORT_CANCELLED')
                if time.monotonic()-started > 60:
                    owned.terminate()
                    raise RuntimeError('REPORT_EXPORT_TIMEOUT')
                time.sleep(.1)
            if owned.process.returncode:
                raise RuntimeError('REPORT_EXPORT_FAILED')
        finally:
            owned.close()
    return receipt

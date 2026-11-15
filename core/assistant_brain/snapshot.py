"""Lossless scalar/row projection for the published producing v1 response.

Trusted D host boundary only. This removes duplicated native traces, never computes
new science or grants remote-data consent. Full originals stay in D/A storage.
"""
from copy import deepcopy
from .codec import digest, canonical, resolve
from .errors import ChatError
from .context import ScientificContext

A_SNAPSHOT = "7e64e67cf28d1bbe3910cff016580fd9379ef276"
PROFILE = "wageningen-three-crop-producing-research-v1"


def project_for_chat_v1(response):
    if (response.get("schema") != "astragron.client-decision.response.v1"
        or response.get("growth_evaluation", {}).get("schema") != "astragron.growth-decision.response.v1"
        or any(row.get("growth_model", {}).get("provider") != PROFILE
               for row in response.get("report_dto", {}).get("five_year_rows", []))):
        raise ChatError("SNAPSHOT_PROJECTION_NOT_SUPPORTED")
    result = {k:deepcopy(v) for k,v in response.items() if k not in {"engine_result", "growth_evaluation"}}
    engine = response["engine_result"]
    result["engine_result"] = {k:deepcopy(engine[k]) for k in ("schema", "status", "normalized_request", "provenance", "execution") if k in engine}
    soil = engine.get("soil_memory", {})
    result["engine_result"]["soil_memory"] = {k:deepcopy(soil[k]) for k in ("schema", "scope", "status", "missing_requirements") if k in soil}
    g = response["growth_evaluation"]
    result["growth_evaluation"] = {k:deepcopy(g[k]) for k in ("schema", "scope", "field_validated", "marketable_yield", "profit", "source_snapshot", "input_identity", "N", "P_K") if k in g}
    if len(canonical(result).encode())>8*1024*1024: raise ChatError("ANALYSIS_SIZE_LIMIT",413)
    context = ScientificContext("projection-audit",result)
    if context.issues: raise ChatError("PROJECTION_EVIDENCE_CONFLICT")
    for fact in context.facts.values():
        if canonical(resolve(response,fact.pointer))!=canonical(fact.value):
            raise ChatError("PROJECTION_CHANGED_SCIENCE")
    receipt = {"schema":"astragron.chat-snapshot-projection.v1", "compatible_a_contract_checkpoint":A_SNAPSHOT,
               "original_canonical_sha256":digest(response), "projection_canonical_sha256":digest(result),
               "verified_scalar_pointers":len(context.facts), "scientific_recomputation":False,
               "remote_disclosure_approved":False,
               "preserved":"All report rows, canonical alternative rows, decisions, qualification and emitted source pointers are unchanged. D retains the full original; C omits duplicate native traces."}
    return result, receipt

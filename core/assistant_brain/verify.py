"""Read-only verification of the delivered evidence and protected baseline."""
from pathlib import Path
import hashlib
from .codec import strict_loads, digest, resolve, canonical
from .context import ScientificContext
from .validation import validate_response

def main():
    root = Path(__file__).resolve().parents[1]
    folder = root / "assistant_brain"
    receipt = strict_loads((folder / "acceptance/ACCEPTANCE.json").read_bytes())
    current=folder/"final_chat/TEST_RECEIPT.json"
    if not current.exists():current=folder/"unified/TEST_RECEIPT.json"
    if not current.exists():current=folder/"jury/TEST_RECEIPT.json"
    current_receipt=strict_loads(current.read_bytes()) if current.exists() else {}
    identity=current_receipt.get("implementation_sha256",receipt["implementation_sha256"])
    current_flags=current_receipt.get("verdict",{})
    for name, expected in identity.items():
        if hashlib.sha256((root / name).read_bytes()).hexdigest() != expected:
            raise ValueError("IMPLEMENTATION_IDENTITY_MISMATCH:" + name)
    fixtures = strict_loads((folder / "fixtures/RECEIPT.json").read_bytes())
    facts = 0
    for row in fixtures["fixtures"]:
        path = root / row["file"]
        if hashlib.sha256(path.read_bytes()).hexdigest() != row["sha256"]:
            raise ValueError("FIXTURE_IDENTITY_MISMATCH")
        context = ScientificContext(row["file"], strict_loads(path.read_bytes()))
        if context.issues:
            raise ValueError("EVIDENCE_CONTRADICTION")
        for fact in context.facts.values():
            if canonical(fact.value) != canonical(resolve(context.document, fact.pointer)):
                raise ValueError("NUMERICAL_TRACE_MISMATCH")
            facts += 1
    actual = strict_loads((folder / "acceptance/real_rain_080.response.json").read_bytes())
    if digest(actual) != receipt["actual_engine_what_if"]["result_sha256"]:
        raise ValueError("ACTUAL_ENGINE_RESULT_CHANGED")
    sample = strict_loads((folder / "examples/real-engine-what-if.json").read_bytes())["assistant"]
    validate_response(sample, [ScientificContext(sample["analysis_id"], actual)])
    projection_path=folder/"final_chat/producing.projection.json"
    projected_facts=0
    if projection_path.exists():
        proof=strict_loads((folder/"final_chat/A_SNAPSHOT_RECEIPT.json").read_bytes())
        projection=strict_loads(projection_path.read_bytes())
        if digest(projection)!=proof["projection_canonical_sha256"]:raise ValueError("PROJECTION_IDENTITY_MISMATCH")
        context=ScientificContext("projection",projection)
        if context.issues:raise ValueError("PROJECTION_EVIDENCE_CONFLICT")
        for fact in context.facts.values():
            if canonical(fact.value)!=canonical(resolve(projection,fact.pointer)):raise ValueError("PROJECTION_POINTER_MISMATCH")
            projected_facts+=1
        if projected_facts!=proof["verified_scalar_pointers"]:raise ValueError("PROJECTION_FACT_COUNT_CHANGED")
    from brain.baseline import verify
    protected = verify()
    print(canonical({"implementation_files": len(identity),
                     "protected_files": protected["files_verified"], "fact_pointers_verified": facts,
                     "actual_scientific_result_verified": True, "new_a_projection_fact_pointers":projected_facts, "live_llm_verified": bool(current_flags.get("LIVE_GEMINI_LITE_VERIFIED") or current_flags.get("LIVE_GROQ_VERIFIED") or current_flags.get("GEMINI_LITE_LIVE_VERIFIED") or receipt["LIVE_LLM_VERIFIED"]),
                     "live_gemini_advanced_verified":current_flags.get("LIVE_GEMINI_ADVANCED_VERIFIED",False)}))

if __name__ == "__main__":
    main()

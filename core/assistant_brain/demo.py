"""Reproducible conversations over actual captured science; optional real backend rerun."""
import argparse
from pathlib import Path
import time
from .codec import strict_loads, canonical
from .config import Settings
from .providers import MockProvider
from .service import ConversationService, Principal
from .tools import EngineBackend

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="runtime/agent-c/demo.json")
    parser.add_argument("--simulate", action="store_true")
    parser.add_argument("--live-provider", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    output = (root / args.output).resolve()
    if not output.is_relative_to(root / "runtime/agent-c"):
        parser.error("Outputs must stay under runtime/agent-c in this checkout")
    output.parent.mkdir(parents=True, exist_ok=True)
    start = time.monotonic()
    settings = Settings.from_env()
    if args.live_provider and settings.provider == "offline":
        parser.error("Configure ASTRAGRON_CHAT_PROVIDER and MODEL for a live demonstration")
    service = ConversationService(settings, provider=None if args.live_provider else MockProvider(),
                                  backend=EngineBackend(root, settings.simulation_timeout) if args.simulate else None)
    data = strict_loads((root / "assistant_brain/fixtures/valid.response.json").read_bytes())
    request = strict_loads((root / "examples/engine/supported_soil.json").read_bytes())
    principal = Principal("demo-tenant", frozenset({data["farm_id"]}), "demo-farmer")
    aid = service.register_analysis(principal, data, request, public_research=bool(args.live_provider))
    sid = service.create_session(principal, aid)["session_id"]
    transcript = []
    for text in ["Explain my five-year crop plan", "Why was this sequence preferred?", "Compare my crop sequences", 
                 "Explain water for field F1 year 1", "And the second year?",
                 "Explain nitrogen phosphorus potassium for field F1 year 2", "What measurements would improve this?",
                 "What are the source references?", "What yield and profit could I expect?",
                 "What if rainfall decreases by 20%?"]:
        answer = service.send(principal, sid, text)
        transcript.append({"user": text, "assistant": answer})
    blocked = strict_loads((root / "assistant_brain/fixtures/blocked.response.json").read_bytes())
    bp = Principal("demo-tenant", frozenset({blocked["farm_id"]}), "demo-farmer")
    bid = service.register_analysis(bp, blocked)
    bsid = service.create_session(bp, bid)["session_id"]
    transcript.append({"user": "Explain why my analysis is blocked", "assistant": service.send(bp, bsid, "Explain why my analysis is blocked")})
    last = transcript[-2]["assistant"]
    if last.get("tool", {}).get("status") == "NEW_ANALYSIS_CREATED":
        child = service.analyses[last["analysis_id"]].context.document
        (output.parent / "demo-engine-result.json").write_text(canonical(child) + "\n", encoding="utf-8")
    receipt = {"provider_mode": "REQUESTED_LIVE_VERIFY_EACH_TURN" if args.live_provider else "DETERMINISTIC_FALLBACK over authentic scientific analyses",
               "live_provider_verified": args.live_provider and any(t["assistant"]["provider_status"] == "LIVE" for t in transcript),
               "scientific_backend_rerun": args.simulate, "elapsed_seconds": time.monotonic()-start,
               "transcript": transcript, "metrics": dict(service.metrics)}
    output.write_text(canonical(receipt) + "\n", encoding="utf-8")
    print("Saved", len(transcript), "turns to", output)
    print("Live provider verified:", receipt["live_provider_verified"])
    print("Scientific what-if:", last.get("tool"))

if __name__ == "__main__":
    main()

"""Allowlisted scientific requests. No farmer-controlled shell, paths or URL tools."""
from copy import deepcopy
from decimal import Decimal
from pathlib import Path
import re
import subprocess
import shutil
import sys
import threading
import uuid
from .codec import canonical, strict_loads
from .errors import ChatError

OPERATIONS = {"rain_factor", "first_crop"}

def parse_rain_change(text, context, scope):
    match = re.search(r"rain(?:fall)?\s+(decreases?|decreased|drops?|falls?|increases?|increased)\s+by\s+(\d+(?:\.\d+)?)\s*%", text.lower())
    if not match:
        return None
    percent = Decimal(match[2])
    if not 0 <= percent <= 100:
        raise ChatError("RAINFALL_PERCENT_LIMIT")
    scenarios = context.document.get("engine_result", {}).get("normalized_request", {}).get("scenarios", [])
    sid = scope.get("scenario_id")
    selected = [s for s in scenarios if not sid or s.get("scenario_id") == sid]
    if len(selected) != 1:
        raise ChatError("EXPLICIT_SOURCE_SCENARIO_REQUIRED")
    baseline = Decimal(str(selected[0].get("rain_factor", 1)))
    sign = -1 if match[1].startswith(("decreas", "drop", "fall")) else 1
    factor = baseline * (1 + sign * percent / 100)
    return {"operation": "rain_factor", "source_scenario_id": selected[0]["scenario_id"], "value": float(factor)}

def changed_request(original, change):
    if not isinstance(original, dict):
        raise ChatError("ORIGINAL_ENGINE_REQUEST_UNAVAILABLE", 409)
    if not isinstance(change, dict) or change.get("operation") not in OPERATIONS:
        raise ChatError("UNSUPPORTED_SCIENTIFIC_OPERATION", 422)
    if "growth_decision" in original:
        raise ChatError("GROWTH_WHAT_IF_NOT_YET_ADMITTED", 422)
    request = deepcopy(original)
    engine = request.get("engine_request", {})
    op = change["operation"]
    if op == "rain_factor":
        if set(change) != {"operation", "source_scenario_id", "value"}:
            raise ChatError("EXACT_TOOL_KEYS_REQUIRED")
        value = change["value"]
        if type(value) not in (int, float) or not 0 <= value <= 2:
            raise ChatError("RAIN_FACTOR_LIMIT")
        scenarios = [s for s in engine.get("scenarios", []) if s.get("scenario_id") == change["source_scenario_id"]]
        if len(scenarios) != 1:
            raise ChatError("SCENARIO_NOT_FOUND")
        scenarios[0]["rain_factor"] = value
        from .codec import digest
        scenarios[0]["scenario_id"] = str(change["source_scenario_id"])[:45]+"_CHAT_"+digest([change,original])[:12]
        # Preserve exact declared soil stocks under the child scenario namespace, then reseal
        # the existing v1 input capsule. No measurement, process or coefficient is changed.
        extension=engine.get("extensions",{}).get("soil_memory")
        if isinstance(extension,dict):
            old_id=change["source_scenario_id"];new_id=scenarios[0]["scenario_id"]
            states=extension.get("initial_states",{})
            if old_id in states:states[new_id]=states.pop(old_id)
            for group in ("management_events","observations"):
                for row in extension.get(group,[]):
                    if isinstance(row,dict) and row.get("scenario_id")==old_id:row["scenario_id"]=new_id
            extension["parameter_id"]=digest({k:v for k,v in extension.items() if k!="parameter_id"})
    else:
        if set(change) != {"operation", "field_id", "crop_use_id"}:
            raise ChatError("EXACT_TOOL_KEYS_REQUIRED")
        field = change["field_id"]
        profiles = engine.get("crop_profiles", {})
        crop = change["crop_use_id"]
        candidates = engine.get("candidates", [])
        if not isinstance(crop, str) or crop not in profiles:
            raise ChatError("CROP_PROFILE_NOT_SUPPORTED", 422)
        if not candidates or any(field not in c.get("choices", {}) for c in candidates):
            raise ChatError("FIELD_NOT_FOUND")
        unique = {}
        for candidate in candidates:
            candidate["choices"][field][0] = crop
            candidate["label"] = "Conversation-requested first-crop research change"
            unique.setdefault(canonical(candidate["choices"]), candidate)
        engine["candidates"] = list(unique.values())
    # Chat reruns never trigger data acquisition or expand the declared search budget.
    source = engine.get("source")
    if isinstance(source, dict):
        source["acquisition"] = "CACHE_ONLY"
    if isinstance(source, dict) and "policy" in source:
        source["policy"] = "CACHE_ONLY"
    if isinstance(source, dict) and "fetch_policy" in source:
        source["fetch_policy"] = "CACHE_ONLY"
    return request

class EngineBackend:
    """Calls A's public service in a bounded child process, in C's own checkout."""
    def __init__(self, root, timeout=120):
        self.root, self.timeout = Path(root).resolve(), timeout
        self.gate = threading.BoundedSemaphore(1)
    def run(self, request):
        if not self.gate.acquire(blocking=False):
            raise ChatError("SIMULATION_BUSY", 429)
        try:
            folder = self.root / "runtime/agent-a/conversational-c" / uuid.uuid4().hex
            folder.mkdir(parents=True, exist_ok=False)
            inp, out = folder / "request.json", folder / "response.json"
            inp.write_text(canonical(request), encoding="utf-8")
            try:
                result = subprocess.run([sys.executable, "-B", "-X", "utf8", "-m", "assistant_brain.engine_worker",
                                         str(inp), str(out)], cwd=self.root, timeout=self.timeout,
                                        capture_output=True, check=False)
            except subprocess.TimeoutExpired:
                raise ChatError("SIMULATION_TIMEOUT", 503) from None
            if result.returncode or not out.is_file():
                raise ChatError("SCIENTIFIC_BACKEND_REJECTED", 422)
            return strict_loads(out.read_bytes())
        finally:
            if "folder" in locals() and folder.exists():
                allowed = (self.root / "runtime/agent-a/conversational-c").resolve()
                resolved = folder.resolve()
                if resolved.is_relative_to(allowed) and resolved != allowed:
                    shutil.rmtree(resolved)
            self.gate.release()

"""Bounded in-memory orchestration with server-authenticated farm ownership."""
from collections import Counter
from copy import deepcopy
from dataclasses import dataclass, field
import re
import threading
import time
import uuid
from .codec import canonical, digest
from .config import Settings
from .context import ScientificContext, CATEGORIES, RESTRICTIONS
from .errors import ChatError
from .intent import understand, focus
from .localization import MESSAGES
from .providers import build_provider, OfflineProvider, ProviderFailure, RateLimiter, validate_plan
from .tools import changed_request, parse_rain_change
from .validation import validate_response
from .dialogue import question_spec, compile_plan, render_plan

@dataclass(frozen=True)
class Principal:
    tenant_id: str
    farm_ids: frozenset
    subject_id: str = "trusted-host"

@dataclass
class Analysis:
    tenant_id: str
    context: ScientificContext
    request: dict | None
    created: float
    parent_id: str | None = None
    public_research: bool = False

@dataclass
class Session:
    tenant_id: str
    subject_id: str
    farm_id: str
    analysis_id: str
    locale: str
    expires: float
    scope: dict = field(default_factory=dict)
    intent: str = "plan"
    calls: int = 0
    tokens_reserved_or_measured: int = 0
    responses: list = field(default_factory=list)
    dialogue_spec: dict | None = None
    comparison_ids: list = field(default_factory=list)

class ConversationService:
    def __init__(self, settings=None, provider=None, backend=None, clock=time.monotonic):
        self.settings = settings or Settings()
        self.provider = provider or build_provider(self.settings)
        self.backend, self.clock = backend, clock
        self.analyses, self.sessions = {}, {}
        self.metrics = Counter()
        self.lock = threading.RLock()
        self.limiter = RateLimiter(self.settings.calls_per_minute, clock)

    def _prune(self):
        now = self.clock()
        self.sessions = {k: v for k, v in self.sessions.items() if v.expires > now}
        active = {s.analysis_id for s in self.sessions.values()}
        self.analyses = {k: v for k, v in self.analyses.items()
                         if k in active or v.created + self.settings.retention_seconds > now}

    def register_analysis(self, principal, response, request=None, parent_id=None, public_research=False):
        # Trusted application ingestion only; intentionally absent from the HTTP API.
        with self.lock:
            self._prune()
            if response.get("farm_id") not in principal.farm_ids:
                raise ChatError("NOT_FOUND", 404)
            if len(canonical(response).encode()) > 8 * 1024 * 1024:
                raise ChatError("ANALYSIS_SIZE_LIMIT", 413)
            if request:
                if request.get("farm_id") != response["farm_id"]:
                    raise ChatError("REQUEST_FARM_MISMATCH")
                if response.get("provenance", {}).get("request_sha256") != digest(request):
                    raise ChatError("REQUEST_ANALYSIS_IDENTITY_MISMATCH")
            if len(self.analyses) >= self.settings.max_analyses:
                raise ChatError("ANALYSIS_CAPACITY", 429)
            if public_research:
                if parent_id is None:
                    from .privacy import PUBLIC_SNAPSHOT_SHA256
                    if digest(response) not in PUBLIC_SNAPSHOT_SHA256:raise ChatError("PUBLIC_FIXTURE_NOT_PREVALIDATED")
                else:
                    parent=self._analysis(principal,parent_id)
                    if not parent.public_research or parent.context.farm_id!=response["farm_id"]:
                        raise ChatError("PUBLIC_PARENT_NOT_APPROVED")
            aid = "a_" + uuid.uuid4().hex
            context = ScientificContext(aid, response)
            self.analyses[aid] = Analysis(principal.tenant_id, context, deepcopy(request), self.clock(), parent_id, public_research)
            return aid

    def _analysis(self, principal, aid):
        self._prune()
        item = self.analyses.get(aid)
        if item is None or item.tenant_id != principal.tenant_id or item.context.farm_id not in principal.farm_ids:
            raise ChatError("NOT_FOUND", 404)
        return item

    def _session(self, principal, sid):
        self._prune()
        item = self.sessions.get(sid)
        if item is None or item.tenant_id != principal.tenant_id or item.subject_id != principal.subject_id or item.farm_id not in principal.farm_ids:
            raise ChatError("NOT_FOUND", 404)
        return item

    def create_session(self, principal, analysis_id, locale="en"):
        with self.lock:
            if locale not in MESSAGES:
                raise ChatError("LOCALE_NOT_ENABLED", 422)
            analysis = self._analysis(principal, analysis_id)
            if len(self.sessions) >= self.settings.max_sessions:
                raise ChatError("SESSION_CAPACITY", 429)
            sid = "c_" + uuid.uuid4().hex
            self.sessions[sid] = Session(principal.tenant_id, principal.subject_id, analysis.context.farm_id, analysis_id,
                                         locale, self.clock() + self.settings.retention_seconds)
            return {"session_id": sid, "analysis_id": analysis_id, "locale": locale,
                    "retention_seconds": self.settings.retention_seconds}

    def attach(self, principal, session_id, analysis_id):
        with self.lock:
            session = self._session(principal, session_id)
            analysis = self._analysis(principal, analysis_id)
            if analysis.context.farm_id != session.farm_id:
                raise ChatError("NOT_FOUND", 404)
            session.analysis_id, session.scope, session.intent = analysis_id, {}, "plan"
            session.dialogue_spec = None
            if analysis_id not in session.comparison_ids: session.comparison_ids = []
            return {"session_id": session_id, "analysis_id": analysis_id}

    def delete_session(self, principal, session_id):
        with self.lock:
            self._session(principal, session_id)
            del self.sessions[session_id]
            return {"deleted": True}

    def history(self, principal, session_id):
        with self.lock:
            session = self._session(principal, session_id)
            return {"analysis_id": session.analysis_id, "responses": deepcopy(session.responses)}

    def _answer(self, session, contexts, intent, facts, scope, no_scope=False, provider_status="OFFLINE", tool=None, runtime=None, dialogue_spec=None):
        context = contexts[0]
        issues = sorted({issue for c in contexts for issue in c.issues})
        status = "EVIDENCE_BLOCKED" if any(c.restricted for c in contexts) else "BOUNDED_PARTIAL" if any(c.document["status"] == "BOUNDED_PARTIAL" for c in contexts) else context.document["status"]
        if issues:
            facts = [f for f in facts if f.pointer == "/status"]
        spec = dialogue_spec or {"topic":intent,"style":"brief","notices":[]}
        plan, facts = compile_plan(contexts,intent,scope,spec,tool,no_scope,[f.evidence_id for f in facts][:24])
        categories = {k: [f.evidence_id for f in facts if f.category == k] for k in CATEGORIES}
        response = {"schema": "astragron.conversation-response.v1", "locale": session.locale,
                    "analysis_id": context.analysis_id, "attached_analysis_id": session.analysis_id,
                    "analysis_status": status, "intent": intent, "scope": deepcopy(scope),
                    "scope_unavailable": no_scope, "field_agronomy_qualified": False,
                    "claims": [f.public() for f in facts], "evidence_categories": categories,
                    "evidence_issues": issues, "limitations": list(RESTRICTIONS),
                    "provider_status": provider_status, "tool": tool,
                    "text": ""}
        runtime = runtime or {"mode":"DETERMINISTIC_FALLBACK", "provider":None, "model":None,
                              "reason_code":"NO_LLM_REQUIRED", "provider_latency_ms":0, "usage":{}}
        response.update(runtime)
        response["answer_plan"] = plan
        response["text"] = render_plan(plan,facts,contexts,response["mode"],response["reason_code"])
        response.update(answer=response["text"],scientific_status=status,citations=[f.evidence_id for f in facts],
                        report_reference={"href":"/v1/analyses/"+context.analysis_id+"/report","source_contract":"astragron.client-report-dto.v1"},
                        scenario_reference={"analysis_id":context.analysis_id,
                            "parent_analysis_id":tool.get("parent_analysis_id") if tool else None,
                            "scenario_ids":[x.get("scenario_id") for x in context.document.get("engine_result",{}).get("normalized_request",{}).get("scenarios",[])]})
        validate_response(response, contexts)
        session.responses.append(deepcopy(response))
        session.responses[:] = session.responses[-8:]
        self.metrics["responses"] += 1
        return response

    def send(self, principal, session_id, text, scope=None, change=None, quality_mode="standard"):
        with self.lock:
            session = self._session(principal, session_id)
            if quality_mode not in {"standard","advanced"}:raise ChatError("QUALITY_MODE_INVALID")
            if not isinstance(text, str) or not text.strip() or len(text) > 4000:
                raise ChatError("MESSAGE_LENGTH")
            if session.calls >= self.settings.max_calls_per_session:
                raise ChatError("SESSION_CALL_BUDGET", 429)
            self.limiter.take()
            session.calls += 1
            context = self._analysis(principal, session.analysis_id).context
            intent = understand(text, session.intent)
            spec = question_spec(text,intent,session.dialogue_spec)
            if spec["topic"] == "water" and intent == "unsupported": intent = "water"
            if spec["topic"] in {"navigation","security","language"}:
                return self._answer(session,[context],"plan",[],{},dialogue_spec=spec)
            if intent == "compare" and re.search(r"original|before|previous analysis",text.lower()):
                if session.comparison_ids:
                    return self.compare(principal,session_id,session.comparison_ids)
                return self._answer(session,[context],"compare",[],{},no_scope=True,dialogue_spec=spec)
            scoped, unknown = focus(text, context, session.scope, scope, intent)
            if intent == "what_if" or change is not None:
                if unknown:
                    return self._answer(session, [context], "what_if", [], scoped, no_scope=True)
                if change is None:
                    try:
                        change = parse_rain_change(text, context, scoped)
                    except ChatError as error:
                        return self._answer(session,[context],"what_if",[],scoped,tool={"status":"UNSUPPORTED_CHANGE","reason":error.code,"supported_operations":["rain_factor"]})
                if change is not None:
                    return self._simulate(principal, session, change, scoped)
                return self._answer(session, [context], "what_if", [], scoped, tool={
                    "status": "UNSUPPORTED_CHANGE", "supported_operations": ["rain_factor"],
                    "reason": "An explicit supported change and the original authenticated request are required. Initial-nitrogen changes are not admitted by this adapter."})
            facts = [] if unknown else context.retrieve(intent, scoped)
            selected, status = facts[:12], "OFFLINE"
            runtime={"mode":"DETERMINISTIC_FALLBACK","provider":None,"model":None,"reason_code":"OFFLINE_PROVIDER","provider_latency_ms":0,"usage":{}}
            if facts and not context.issues and intent != "unsupported":
                envelope = {"intent": intent, "user_message": text, "scope": scoped,
                            "facts": [f.public() for f in facts]}
                # Whole facts only; bound bytes before any external provider sees data.
                while envelope["facts"] and (len(canonical(envelope)) > self.settings.max_input_chars or
                                             len(canonical(envelope).encode()) + 1024 > self.settings.max_input_tokens):
                    envelope["facts"].pop()
                budget_reserved=0
                try:
                    self.metrics["provider_calls"] += 1
                    if hasattr(self.provider,"complete"):
                        from .remote import ProviderRequest, RemoteError
                        reserved=self.settings.remote_context_bytes+1600+max(self.settings.remote_output_tokens,self.settings.groq_output_tokens,self.settings.advanced_output_tokens)
                        if session.tokens_reserved_or_measured+reserved*2>self.settings.max_tokens_per_session:
                            raise RemoteError("SESSION_TOKEN_BUDGET")
                        session.tokens_reserved_or_measured+=reserved*2
                        budget_reserved=reserved*2
                        token=uuid.uuid4().hex
                        request=ProviderRequest(deepcopy(envelope),token,self._analysis(principal,session.analysis_id).public_research,quality_mode=quality_mode)
                        result=self.provider.complete(request)
                        if result.context_token!=token:raise RemoteError("PROVIDER_SESSION_MISMATCH")
                        if result.provider not in {"gemini","groq"} or result.mode!="LIVE_"+result.provider.upper():
                            raise RemoteError("PROVIDER_IDENTITY_MISMATCH")
                        session.tokens_reserved_or_measured-=reserved*2
                        session.tokens_reserved_or_measured+=result.quota_tokens_charged
                        budget_reserved=0
                        plan=validate_plan(result.plan,{f["evidence_id"] for f in envelope["facts"]})
                        runtime={"mode":result.mode,"provider":result.provider,"model":result.model,"reason_code":None,
                                 "provider_latency_ms":result.latency_ms,"usage":result.usage}
                    else:
                        plan = validate_plan(self.provider.select(deepcopy(envelope)), {f["evidence_id"] for f in envelope["facts"]})
                    # High-priority intent and scope decisions cannot be overridden by model output.
                    selected = [context.facts[eid] for eid in plan["fact_ids"]]
                    status = "OFFLINE" if self.provider.name in {"offline", "mock"} else "LIVE"
                    if self.provider.name=="ollama":runtime.update(mode="LIVE_OLLAMA",provider="ollama",model=self.settings.model,reason_code=None)
                except (ProviderFailure, TimeoutError, OSError) as error:
                    if budget_reserved:
                        session.tokens_reserved_or_measured-=budget_reserved
                        session.tokens_reserved_or_measured+=getattr(error,"quota_tokens_charged",budget_reserved)
                    status = "FALLBACK_VALIDATED_FACTS"
                    self.metrics["provider_failures"] += 1
                    selected = facts[:12]
                    code=getattr(error,"code",None) or "PROVIDER_UNAVAILABLE"
                    runtime={"mode":"DETERMINISTIC_FALLBACK","provider":None,"model":None,"reason_code":code,
                             "provider_latency_ms":0,"usage":{}}
            if not unknown and not context.issues:
                # Actual Lite selection omitted the criterion once: mandatory source anchors are
                # enforced here, outside every provider. They never introduce new science.
                paths={"/status"}
                if intent in {"why","compare"}:paths|={"/decision/preference","/decision/criterion","/engine_result/soil_memory/ranking_effect"}
                anchors=[f for f in context.facts.values() if f.pointer in paths]
                unique={f.evidence_id:f for f in anchors+selected}
                selected=list(unique.values())[:12]
            if not unknown:
                session.scope, session.intent = scoped, intent
                session.dialogue_spec = spec
            return self._answer(session, [context], intent, selected, scoped, unknown, status, runtime=runtime,dialogue_spec=spec)

    def _simulate(self, principal, session, change, scope):
        original = self._analysis(principal, session.analysis_id)
        if original.context.issues:
            raise ChatError("CONTRADICTORY_ORIGINAL_ANALYSIS", 409)
        try:
            if not isinstance(change,dict) or change.get("operation") != "rain_factor":
                raise ChatError("UNSUPPORTED_SCIENTIFIC_OPERATION",422)
            request = changed_request(original.request, change)
        except ChatError as error:
            return self._answer(session,[original.context],"what_if",[],scope,tool={"status":"UNSUPPORTED_CHANGE","reason":error.code,"supported_operations":["rain_factor"]})
        if self.backend is None:
            return self._answer(session, [original.context], "what_if", [], scope,
                                tool={"status": "BACKEND_UNAVAILABLE", "requested_change": deepcopy(change)})
        try:
            self.metrics["simulation_calls"] += 1
            result = self.backend.run(request)
            if result.get("provenance", {}).get("request_sha256") != digest(request):
                raise ChatError("BACKEND_REQUEST_IDENTITY_MISMATCH", 502)
            aid = self.register_analysis(principal, result, request, session.analysis_id, original.public_research)
        except ChatError as error:
            return self._answer(session, [original.context], "what_if", [], scope,
                                tool={"status": "COMPUTATION_UNAVAILABLE", "reason": error.code})
        child = self._analysis(principal, aid).context
        session.comparison_ids = [session.analysis_id,aid]
        facts = child.retrieve("water", {})[:12]
        return self._answer(session, [child], "what_if", facts, {}, tool={
            "status": "NEW_ANALYSIS_CREATED", "analysis_id": aid, "parent_analysis_id": session.analysis_id,
            "requested_change": deepcopy(change), "original_preserved": True,
            "scenario_id":child.document.get("engine_result",{}).get("normalized_request",{}).get("scenarios",[{}])[0].get("scenario_id"),
            "comparison_analysis_ids":[session.analysis_id,aid],
            "attach_required": True})

    def compare(self, principal, session_id, analysis_ids):
        with self.lock:
            session = self._session(principal, session_id)
            if not isinstance(analysis_ids, list) or not 1 <= len(analysis_ids) <= 2 or len(set(analysis_ids)) != len(analysis_ids):
                raise ChatError("COMPARISON_LIMIT")
            contexts = [self._analysis(principal, aid).context for aid in analysis_ids]
            if any(c.farm_id != session.farm_id for c in contexts):
                raise ChatError("NOT_FOUND", 404)
            if len(contexts)==2 and contexts[0].sha256==contexts[1].sha256:
                return self._answer(session,[contexts[0]],"compare",[],{},tool={"status":"IDENTICAL_SNAPSHOTS","analysis_ids":list(analysis_ids)})
            facts = [f for context in contexts for f in context.retrieve("compare", {})[:12]]
            return self._answer(session, contexts, "compare", facts, {})

    def evidence(self, principal, session_id, evidence_id):
        with self.lock:
            session = self._session(principal, session_id)
            # References are readable only for this session's attached or returned analyses.
            ids = {session.analysis_id} | {r["analysis_id"] for r in session.responses} | {c["analysis_id"] for r in session.responses for c in r["claims"]}
            for aid in ids:
                context = self._analysis(principal, aid).context
                if evidence_id in context.facts:
                    return context.facts[evidence_id].public()
            raise ChatError("NOT_FOUND", 404)

    def health(self):
        with self.lock:
            return self.provider.health() if hasattr(self.provider,"health") else {"providers":[],"mode":"DETERMINISTIC_FALLBACK","reason_code":"OFFLINE_PROVIDER"}

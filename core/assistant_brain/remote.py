"""Gemini/Groq use constrained JSON fact selection; all science stays outside the LLM."""
from dataclasses import dataclass, field
from email.utils import parsedate_to_datetime
import json
import random
import re
import threading
import time
from typing import Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, build_opener, ProxyHandler
from .codec import canonical, strict_loads
from .providers import PLAN_SCHEMA, SYSTEM, ProviderFailure, NoRedirect, validate_plan
from .quota import Limits, Quota, QuotaExceeded

ENDPOINTS = {
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai/",
    "groq": "https://api.groq.com/openai/v1/",
}
HEALTH = {"HEALTHY", "RATE_LIMITED", "AUTH_MISSING", "UNAVAILABLE", "UNTESTED"}

@dataclass(frozen=True)
class ProviderRequest:
    envelope: dict
    context_token: str
    public_research: bool = False
    deadline: float | None = None
    quality_mode: str = "standard"

@dataclass(frozen=True)
class ProviderReply:
    plan: dict
    context_token: str
    provider: str
    model: str | None
    mode: str
    latency_ms: float = 0
    usage: dict = field(default_factory=dict)
    reason_code: str | None = None
    quota_tokens_charged: int = 0

class Provider(Protocol):
    name: str
    def complete(self, request: ProviderRequest) -> ProviderReply: ...
    def health(self) -> dict: ...

class RemoteError(ProviderFailure):
    def __init__(self, code, status=None, retry_after=0):
        self.code, self.status, self.retry_after = code, status, retry_after
        self.quota_tokens_charged = 0
        super().__init__(code)

def retry_seconds(value, now):
    try:
        return max(0, min(86400, float(value)))
    except (ValueError, TypeError):
        try:
            return max(0, min(86400, parsedate_to_datetime(value).timestamp()-now))
        except (ValueError, TypeError, OverflowError):
            return 0

def compact(envelope, max_bytes=3200):
    # No raw farmer text, identities, coordinates, source URLs, paths or report documents.
    safe = {"intent": envelope["intent"], "facts": [], "restrictions": ["RESEARCH_ONLY", "NO_FIELD_VALIDATION", "NO_MARKETABLE_YIELD_OR_PROFIT", "NO_LEGAL_CLEARANCE"]}
    aliases = {}
    for fact in envelope.get("facts", [])[:24]:
        scope = {}
        for key in ("field_id", "policy_id", "scenario_id", "crop_use_id"):
            value = fact.get("scope", {}).get(key)
            if value is not None:
                pair = (key, str(value))
                aliases.setdefault(pair, key.removesuffix("_id") + "_" + chr(65+len(aliases)))
                scope[key] = aliases[pair]
        for key in ("source_year", "planning_year_slot", "uncertainty_scenario"):
            if key in fact.get("scope", {}):scope[key] = fact["scope"][key]
        value = fact["value"]
        pointer = fact.get("pointer", "")
        if isinstance(value, str) and ("sha256" in pointer or "source_url" in pointer or pointer.endswith(("crop_use_id", "/id")) or "/selected_ids/" in pointer):
            value = "verified scoped reference"
        item = {"evidence_id":fact["evidence_id"], "label":fact["label"], "value":value,
                "unit":fact["unit"], "category":fact["category"], "scope":scope}
        safe["facts"].append(item)
        if len(canonical(safe).encode()) > max_bytes:
            safe["facts"].pop();break
    if not safe["facts"]:
        raise RemoteError("COMPACT_CONTEXT_EMPTY")
    return safe

class RemoteProvider:
    def __init__(self, name, key, model, settings, transport=None, clock=time.time, project_quota=None, catalog=None):
        if name not in ENDPOINTS:raise ValueError("REMOTE_PROVIDER_NOT_ALLOWED")
        if not re.fullmatch(r"[a-zA-Z0-9_.:/-]{1,120}",model):raise ValueError("INVALID_MODEL_ID")
        self.name,self.key,self.model,self.settings = name,key,model,settings
        self.clock,self.transport = clock,transport or self._transport
        self.opener = build_opener(ProxyHandler({}),NoRedirect())
        self.role="advanced" if name=="gemini" and model==settings.gemini_advanced_model else "lite" if name=="gemini" else "backup"
        prefix="advanced" if self.role=="advanced" else name
        cap=settings.gemini_advanced_review_calls if self.role=="advanced" else settings.gemini_lite_review_calls if name=="gemini" else settings.groq_review_calls
        self.quota=Quota(Limits(*(getattr(settings,prefix+"_"+k) for k in ("rpm","tpm","rpd","tpd")),min(cap,settings.live_call_budget)),clock)
        self.project_quota=project_quota
        self.catalog=catalog if catalog is not None else {}
        self.discovery_verified=False
        self.last_response_metadata={}
        self._project_events={}
        self.state = "UNTESTED" if key else "AUTH_MISSING"
        self.reason = None if key else "AUTH_MISSING"
        self.until,self.last_latency,self.verified,self.model_checked = 0, None, False, False
        self.discovery_calls = 0
        self.lock = threading.RLock()
    def _transport(self, request, timeout):
        try:
            with self.opener.open(request,timeout=timeout) as response:
                raw=response.read(65537)
                if len(raw)>65536:raise RemoteError("PROVIDER_RESPONSE_LIMIT")
                return response.status,dict(response.headers),strict_loads(raw)
        except HTTPError as error:
            # Never expose raw error bodies: providers may echo keys, prompts and request data.
            status,headers=error.code,dict(error.headers)
            raw=error.read(16384);error.close()
            safe={}
            try:
                details=strict_loads(raw).get("error",{})
                message=str(details.get("message",""))
                safe["parameter_hints"]=[p for p in ("max_completion_tokens","max_tokens","response_format","strict","additionalProperties","reasoning_effort","model") if p in message]
                code=details.get("type") or details.get("status") or details.get("code")
                allowed={"invalid_request_error","authentication_error","permission_error","rate_limit_exceeded","json_validate_failed","INVALID_ARGUMENT","PERMISSION_DENIED","UNAUTHENTICATED","RESOURCE_EXHAUSTED","NOT_FOUND","400","401","403","429"}
                if str(code) in allowed:safe["error_class"]=str(code)
                if str(details.get("code")) in allowed:safe["error_code"]=str(details["code"])
            except Exception:pass
            return status,headers,{"_safe_error":safe}
        except TimeoutError:
            raise RemoteError("PROVIDER_TIMEOUT") from None
        except (OSError,URLError):
            raise RemoteError("PROVIDER_NETWORK_UNAVAILABLE") from None
        except Exception:
            raise RemoteError("PROVIDER_MALFORMED_RESPONSE") from None
    def _request(self, suffix, body=None, timeout=None):
        native=self.role=="advanced" and self.settings.gemini_advanced_native and suffix=="chat/completions"
        headers={"Content-Type":"application/json","User-Agent":"ASTRAGRON-Conversational-Brain/1.0","Accept":"application/json"}
        url=ENDPOINTS[self.name]+suffix
        if native:
            url="https://generativelanguage.googleapis.com/v1beta/models/"+quote(self.model,safe="")+":generateContent"
            headers["x-goog-api-key"]=self.key
            body={"systemInstruction":{"parts":[{"text":body["messages"][0]["content"]}]},
                  "contents":[{"role":"user","parts":[{"text":body["messages"][1]["content"]}]}],
                  "generationConfig":{"maxOutputTokens":body["max_completion_tokens"],"responseMimeType":"application/json",
                      "responseJsonSchema":PLAN_SCHEMA,"thinkingConfig":{"thinkingLevel":"LOW","includeThoughts":False}}}
        else:headers["Authorization"]="Bearer "+self.key
        req=Request(url,data=canonical(body).encode() if body is not None else None,headers=headers,
                    method="POST" if body is not None else "GET")
        try:
            status,response_headers,data=self.transport(req,timeout or self.settings.remote_timeout_seconds)
            if native and 200<=status<300 and isinstance(data,dict):
                choices=[]
                for candidate in data.get("candidates",[]):
                    parts=candidate.get("content",{}).get("parts",[])
                    text="".join(part.get("text","") for part in parts if not part.get("thought"))
                    message={"content":text}
                    if any("functionCall" in part for part in parts):message["tool_calls"]=[True]
                    finish={"STOP":"stop","MAX_TOKENS":"length","SAFETY":"content_filter"}.get(candidate.get("finishReason"),"UNKNOWN")
                    choices.append({"finish_reason":finish,"message":message})
                usage=data.get("usageMetadata",{});mapped={}
                for old,new in (("promptTokenCount","prompt_tokens"),("totalTokenCount","total_tokens")):
                    if type(usage.get(old)) is int:mapped[new]=usage[old]
                if type(usage.get("candidatesTokenCount")) is int:
                    mapped["completion_tokens"]=usage["candidatesTokenCount"]+(usage.get("thoughtsTokenCount",0) if type(usage.get("thoughtsTokenCount",0)) is int else 0)
                data={"choices":choices,"usage":mapped,**({"model":data["modelVersion"]} if isinstance(data.get("modelVersion"),str) else {})}
            return status,response_headers,data
        except RemoteError:raise
        except TimeoutError:raise RemoteError("PROVIDER_TIMEOUT") from None
        except OSError:raise RemoteError("PROVIDER_NETWORK_UNAVAILABLE") from None
    def _reserve(self,tokens):
        if self.project_quota is None:return self.quota.reserve(tokens)
        with self.project_quota.lock,self.quota.lock:
            self.project_quota.check(tokens);self.quota.check(tokens)
            event=self.quota.reserve(tokens);self._project_events[id(event)]=self.project_quota.reserve(tokens)
            return event
    def _settle(self,event,measured=None,headers=None):
        self.quota.settle(event,measured,headers)
        if self.project_quota is not None:
            project_event=self._project_events.get(id(event)) if event is not None else None
            self.project_quota.settle(project_event,measured if project_event is not None else None,headers)
    def discover(self,timeout=None):
        if not self.key:raise RemoteError("AUTH_MISSING")
        if "ids" in self.catalog:
            self.model_checked=self.model in self.catalog["ids"];self.discovery_verified=self.model_checked
            if not self.model_checked:raise RemoteError("MODEL_NOT_ACCESSIBLE")
            return {"provider":self.name,"model":self.model,"accessible_in_model_list":True,"cached":True}
        try:self._reserve(0)
        except QuotaExceeded:raise RemoteError("LOCAL_QUOTA_ESTIMATE_EXHAUSTED") from None
        self.discovery_calls += 1
        status,headers,data=self._request("models",timeout=timeout)
        self._http(status,headers,data)
        ids={str(row.get("id","")).removeprefix("models/") for row in (data or {}).get("data",[]) if isinstance(row,dict)}
        self.catalog["ids"]=ids
        self.model_checked=self.model in ids
        self.discovery_verified=self.model_checked
        if not self.model_checked:raise RemoteError("MODEL_NOT_ACCESSIBLE")
        return {"provider":self.name,"model":self.model,"accessible_in_model_list":True,
                "free_tier_account_verified":getattr(self.settings,self.name+"_free_tier_confirmed"),
                "model_listing_is_inference":False}
    def _http(self,status,headers,data=None):
        self.last_response_metadata["http_status"]=status
        if isinstance(data,dict) and "_safe_error" in data:self.last_response_metadata.update(data["_safe_error"])
        self._settle(None,headers=headers)
        if status in {401,403}:raise RemoteError("PROVIDER_AUTH_REJECTED",status)
        if status==429:raise RemoteError("PROVIDER_RATE_LIMITED",status,retry_seconds(headers.get("Retry-After",headers.get("retry-after")),self.clock()))
        if status>=500:raise RemoteError("PROVIDER_SERVER_ERROR",status)
        if not 200<=status<300:raise RemoteError("PROVIDER_REQUEST_REJECTED",status)
    def available(self):
        return bool(self.key) and self.clock()>=self.until
    def _failed(self,error):
        self.reason=error.code
        self.state="AUTH_MISSING" if error.code in {"AUTH_MISSING","PROVIDER_AUTH_REJECTED"} else "RATE_LIMITED" if error.code in {"PROVIDER_RATE_LIMITED","LOCAL_QUOTA_ESTIMATE_EXHAUSTED"} else "UNAVAILABLE"
        cooldown=error.retry_after if error.code=="PROVIDER_RATE_LIMITED" else self.settings.provider_cooldown_seconds
        if error.code=="PROVIDER_AUTH_REJECTED":cooldown=max(cooldown,300)
        self.until=self.clock()+max(cooldown,self.settings.provider_cooldown_seconds)+random.uniform(0,0.1)
    def complete(self,request):
        with self.lock:
            if not self.key:raise RemoteError("AUTH_MISSING")
            if not request.public_research:raise RemoteError("PRIVACY_NOT_APPROVED")
            if not getattr(self.settings,self.name+"_free_tier_confirmed"):raise RemoteError("FREE_TIER_UNVERIFIED")
            if self.role=="advanced" and (not self.settings.advanced_enabled or request.quality_mode!="advanced"):
                raise RemoteError("ADVANCED_EXPLICIT_APPROVAL_REQUIRED")
            if not self.available():raise RemoteError(self.reason or "PROVIDER_COOLDOWN")
            payload=compact(request.envelope,self.settings.remote_context_bytes)
            # Build only tested compatible text+structured-output fields. No vendor tools or streaming.
            body={"model":self.model,"stream":False,"messages":[{"role":"system","content":SYSTEM},
                  {"role":"user","content":canonical(payload)}],
                  "response_format":{"type":"json_schema","json_schema":{"name":"evidence_selection","strict":True,"schema":PLAN_SCHEMA}},
                  "max_completion_tokens":self.settings.groq_output_tokens if self.name=="groq" else self.settings.remote_output_tokens}
            if self.name=="groq":body["reasoning_effort"]="low"
            if self.role=="advanced":
                body["reasoning_effort"]="low";body["max_completion_tokens"]=self.settings.advanced_output_tokens
            start=time.monotonic();event=None
            try:
                def remaining():
                    duration=(request.deadline-time.monotonic()) if request.deadline else self.settings.remote_timeout_seconds
                    if duration<=0:raise RemoteError("PROVIDER_TIMEOUT")
                    return min(duration,self.settings.remote_timeout_seconds)
                if self.settings.discover_before_inference and not self.model_checked:self.discover(remaining())
                estimated=len(canonical(body).encode())+body["max_completion_tokens"]
                event=self._reserve(estimated)
                status,headers,data=self._request("chat/completions",body,remaining())
                remaining()
                self._http(status,headers,data)
                if not isinstance(data,dict):raise RemoteError("PROVIDER_MALFORMED_RESPONSE")
                reported=data.get("model")
                if reported is not None:
                    if not isinstance(reported,str) or reported.removeprefix("models/")!=self.model:
                        self.last_response_metadata["reported_model"]="DIFFERENT_MODEL"
                        raise RemoteError("PROVIDER_MODEL_MISMATCH")
                usage=data.get("usage",{})
                safe_usage={k:v for k,v in usage.items() if k in {"prompt_tokens","completion_tokens","total_tokens"} and type(v) is int and v>=0}
                self._settle(event,safe_usage.get("total_tokens"),headers)
                self.last_response_metadata={"http_status":status,"usage":safe_usage,"finish_reason":None,"requested_model":self.model,"reported_model":self.model if reported is not None else None}
                choices=data.get("choices",[])
                self.last_response_metadata["finish_reason"]=choices[0].get("finish_reason") if choices and choices[0].get("finish_reason") in {"stop","length","content_filter","tool_calls","function_call"} else "UNKNOWN"
                if len(choices)!=1 or choices[0].get("finish_reason") not in {"stop"}:raise RemoteError("PROVIDER_INCOMPLETE")
                msg=choices[0].get("message",{})
                if msg.get("tool_calls") or msg.get("refusal"):raise RemoteError("PROVIDER_UNSUPPORTED_TOOL_OR_REFUSAL")
                if safe_usage.get("completion_tokens",0)>body["max_completion_tokens"]:raise RemoteError("PROVIDER_OUTPUT_BUDGET")
                plan=strict_loads(msg.get("content",""))
                validate_plan(plan,{f["evidence_id"] for f in payload["facts"]})
                if not plan["fact_ids"]:raise RemoteError("PROVIDER_EMPTY_SELECTION")
                self.last_latency=round((time.monotonic()-start)*1000,3)
                self.state,self.reason,self.verified="HEALTHY",None,True
                self.model_checked=True
                return ProviderReply(plan,request.context_token,self.name,self.model,"LIVE_"+self.name.upper(),self.last_latency,safe_usage,quota_tokens_charged=event[1])
            except QuotaExceeded as problem:
                error=RemoteError(str(problem));self._failed(error);raise error from None
            except RemoteError as error:
                self.last_latency=round((time.monotonic()-start)*1000,3)
                error.quota_tokens_charged=event[1] if event else 0
                self._failed(error);raise
            except Exception:
                error=RemoteError("PROVIDER_INVALID_STRUCTURED_RESULT");error.quota_tokens_charged=event[1] if event else 0;self._failed(error);raise error from None
    def health(self):
        return {"provider":self.name,"model":self.model,"state":self.state,"reason_code":self.reason,
                "live_verified_in_this_process":self.verified,"model_list_verified":self.discovery_verified,"model_access_verified":self.model_checked,"role":self.role,"transport":"GOOGLE_NATIVE" if self.role=="advanced" and self.settings.gemini_advanced_native else "OPENAI_COMPATIBLE",
                "last_response_metadata":self.last_response_metadata,
                "last_latency_ms":self.last_latency,"cooldown_remaining_seconds":round(max(0,self.until-self.clock()),3),
                "free_tier_confirmed_by_operator":getattr(self.settings,self.name+"_free_tier_confirmed"),
                "quota":self.quota.snapshot(),"discovery_gets":self.discovery_calls}

class ProviderRouter:
    name="dual"
    def __init__(self,settings,providers=None):
        self.settings=settings
        self.gemini_project=Quota(Limits(settings.gemini_rpm,settings.gemini_tpm,settings.gemini_rpd,settings.gemini_tpd,
                                         settings.gemini_lite_review_calls+settings.gemini_advanced_review_calls))
        catalog={}
        self.providers=providers if providers is not None else [
            RemoteProvider("gemini",settings.gemini_api_key,settings.gemini_model,settings,project_quota=self.gemini_project,catalog=catalog),
            RemoteProvider("groq",settings.groq_api_key,settings.groq_model,settings)]
        self.advanced=RemoteProvider("gemini",settings.gemini_api_key,settings.gemini_advanced_model,settings,
                                     project_quota=self.gemini_project,catalog=catalog) if providers is None else None
        self.slots=threading.BoundedSemaphore(settings.remote_concurrency)
    def complete(self,request):
        if not self.slots.acquire(blocking=False):raise RemoteError("PROVIDER_QUEUE_FULL")
        try:
            candidates=self.providers
            if request.quality_mode=="advanced":
                if not self.settings.advanced_enabled or self.advanced is None:raise RemoteError("ADVANCED_NOT_ENABLED")
                candidates=[self.advanced]+[p for p in self.providers if p.name=="groq"]
            failures=[];charged=0
            deadline=time.monotonic()+self.settings.remote_timeout_seconds
            available_count=max(1,sum(p.available() for p in candidates))
            for provider in candidates:
                if not provider.available():
                    failures.append(provider.reason or "AUTH_MISSING");continue
                try:
                    from dataclasses import replace
                    bounded=replace(request,deadline=min(deadline,time.monotonic()+self.settings.remote_timeout_seconds/available_count))
                    result=provider.complete(bounded)
                    return replace(result,quota_tokens_charged=result.quota_tokens_charged+charged)
                except RemoteError as error:
                    failures.append(error.code);charged+=error.quota_tokens_charged
            reason=failures[-1] if failures else "AUTH_MISSING"
            # Prefer the actionable primary failure over an absent backup.
            if failures and failures[0] not in {"AUTH_MISSING","PROVIDER_COOLDOWN"}:reason=failures[0]
            error=RemoteError(reason);error.quota_tokens_charged=charged;raise error
        finally:self.slots.release()
    def health(self):
        return {"policy":"Gemini Lite then Groq; advanced Gemini is explicit only and never an automatic Lite retry",
                "providers":[p.health() for p in self.providers],"advanced":self.advanced.health() if self.advanced else None,
                "shared_gemini_project_budget":self.gemini_project.snapshot(),"demo_mode":self.settings.demo_mode}

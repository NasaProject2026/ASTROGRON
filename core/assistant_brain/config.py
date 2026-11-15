from dataclasses import dataclass, field
import os

@dataclass(frozen=True)
class Settings:
    provider: str = "offline"
    model: str = ""
    provider_url: str = "http://127.0.0.1:11434"
    provider_key: str = field(default="", repr=False)
    timeout_seconds: float = 15.0
    retries: int = 1
    max_input_chars: int = 24000
    max_output_tokens: int = 384
    max_input_tokens: int = 8192
    calls_per_minute: int = 12
    max_calls_per_session: int = 40
    retention_seconds: int = 3600
    max_sessions: int = 256
    max_analyses: int = 128
    simulation_timeout: int = 120

    demo_mode: bool = False
    gemini_advanced_model: str = "gemini-3.8-flash"
    advanced_enabled: bool = False
    gemini_advanced_native: bool = True
    discover_before_inference: bool = True
    gemini_lite_review_calls: int = 6
    gemini_advanced_review_calls: int = 3
    groq_review_calls: int = 6
    advanced_output_tokens: int = 768
    groq_output_tokens: int = 1024
    advanced_rpm: int = 1
    advanced_tpm: int = 6000
    advanced_rpd: int = 3
    advanced_tpd: int = 15000
    gemini_api_key: str = field(default="", repr=False)
    groq_api_key: str = field(default="", repr=False)
    gemini_model: str = "gemini-3.5-flash-lite"
    groq_model: str = "openai/gpt-oss-120b"
    gemini_free_tier_confirmed: bool = False
    groq_free_tier_confirmed: bool = False
    remote_timeout_seconds: float = 8.0
    provider_cooldown_seconds: float = 30.0
    remote_output_tokens: int = 384
    remote_context_bytes: int = 3200
    remote_concurrency: int = 1
    live_call_budget: int = 15
    allow_extended_live_budget: bool = False
    max_tokens_per_session: int = 30000
    gemini_rpm: int = 3
    gemini_tpm: int = 12000
    gemini_rpd: int = 30
    gemini_tpd: int = 50000
    groq_rpm: int = 3
    groq_tpm: int = 6000
    groq_rpd: int = 30
    groq_tpd: int = 50000

    def __post_init__(self):
        if self.demo_mode:
            caps={"remote_output_tokens":384,"remote_context_bytes":3200,"remote_concurrency":1,"live_call_budget":15,
                  "max_calls_per_session":40,"max_tokens_per_session":30000}
            for vendor in ("gemini","groq"):
                caps.update({vendor+"_rpm":3,vendor+"_tpm":12000 if vendor=="gemini" else 6000,vendor+"_rpd":30,vendor+"_tpd":50000})
            for key,cap in caps.items():object.__setattr__(self,key,min(getattr(self,key),cap))
        if self.provider not in {"offline", "ollama", "auto", "gemini", "groq"}:
            raise ValueError("UNSUPPORTED_PROVIDER")
        if self.provider == "ollama" and not self.model:
            raise ValueError("MODEL_REQUIRED")
        if self.gemini_model==self.gemini_advanced_model and self.provider in {"auto","gemini"}:
            raise ValueError("ADVANCED_MODEL_CANNOT_BE_DEFAULT")
        if self.provider in {"auto","gemini"} and "flash-lite" not in self.gemini_model:
            raise ValueError("LITE_PRIMARY_REQUIRED")
        for name,cap in (("gemini_lite_review_calls",6),("gemini_advanced_review_calls",3),("groq_review_calls",6)):
            if not 1<=getattr(self,name)<=(100 if self.allow_extended_live_budget else cap):
                raise ValueError("MODEL_REVIEW_BUDGET_LIMIT:"+name)
        if self.live_call_budget < 1 or self.live_call_budget > (100 if self.allow_extended_live_budget else 15):
            raise ValueError("EXPLICIT_APPROVAL_REQUIRED_FOR_EXTENDED_LIVE_BUDGET")
        if not 0.1 <= self.remote_timeout_seconds <= 30 or not 1 <= self.provider_cooldown_seconds <= 3600:
            raise ValueError("REMOTE_TIMING_LIMIT")
        if not 128<=self.advanced_output_tokens<=1024:raise ValueError("ADVANCED_OUTPUT_TOKEN_LIMIT")
        if not 128<=self.groq_output_tokens<=1024:raise ValueError("GROQ_OUTPUT_TOKEN_LIMIT")
        if not 128 <= self.remote_output_tokens <= 1024 or not 1000 <= self.remote_context_bytes <= 6000:
            raise ValueError("REMOTE_CONTEXT_LIMIT")
        if not 1 <= self.remote_concurrency <= 4 or not 1000 <= self.max_tokens_per_session <= 200000:
            raise ValueError("REMOTE_RESOURCE_LIMIT")
        for name in ("gemini", "groq", "advanced"):
            if any(type(getattr(self,name+"_"+unit)) is not int or getattr(self,name+"_"+unit)<1 for unit in ("rpm","tpm","rpd","tpd")):
                raise ValueError("QUOTA_CAP_LIMIT")
        bounds = {"timeout_seconds": (0.1, 60), "retries": (0, 2),
                  "max_input_chars": (2000, 64000), "max_input_tokens": (2048, 32768), "max_output_tokens": (64, 2048),
                  "calls_per_minute": (1, 120), "max_calls_per_session": (1, 200),
                  "retention_seconds": (1, 86400), "max_sessions": (1, 4096),
                  "max_analyses": (1, 2048), "simulation_timeout": (1, 300)}
        for key, (low, high) in bounds.items():
            if not low <= getattr(self, key) <= high:
                raise ValueError("CONFIG_LIMIT:" + key)

    @classmethod
    def from_env(cls):
        fields = cls.__dataclass_fields__
        kwargs = {}
        for name, item in fields.items():
            value = os.getenv("ASTRAGRON_CHAT_" + name.upper())
            if value is not None:
                if type(item.default) is bool:
                    if value.lower() not in {"true","false","1","0"}:raise ValueError("CONFIG_BOOLEAN:"+name)
                    kwargs[name]=value.lower() in {"true","1"}
                else:kwargs[name] = type(item.default)(value)
        kwargs.setdefault("provider","auto")
        from .credentials import read_secret
        kwargs["gemini_api_key"]=read_secret("GEMINI_API_KEY") or kwargs.get("gemini_api_key","")
        kwargs["groq_api_key"]=read_secret("GROQ_API_KEY") or kwargs.get("groq_api_key","")
        if "DEMO_MODE" in os.environ:
            if os.environ["DEMO_MODE"].lower() not in {"true","false","1","0"}:raise ValueError("CONFIG_BOOLEAN:DEMO_MODE")
            kwargs["demo_mode"]=os.environ["DEMO_MODE"].lower() in {"true","1"}
        return cls(**kwargs)

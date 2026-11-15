"""Conservative local rolling limits; configuration estimates are not account quotas."""
from collections import deque
from dataclasses import dataclass
import threading
import time
import re

@dataclass(frozen=True)
class Limits:
    rpm: int = 3
    tpm: int = 6000
    rpd: int = 30
    tpd: int = 50000
    review_calls: int = 15

class QuotaExceeded(Exception):
    pass

class Quota:
    def __init__(self, limits=None, clock=time.time):
        self.limits, self.clock = limits or Limits(), clock
        self.events, self.total_calls, self.observed = deque(), 0, {}
        self.blocked_until=0
        self.observed_at=0
        self.lock = threading.RLock()
    def check(self,tokens):
        with self.lock:
            now=self.clock()
            while self.events and self.events[0][0]<=now-86400:self.events.popleft()
            if now<self.blocked_until:raise QuotaExceeded("OBSERVED_PROVIDER_QUOTA_PRESSURE")
            minute=[e for e in self.events if e[0]>now-60]
            if (self.total_calls>=self.limits.review_calls or len(minute)>=self.limits.rpm or
                len(self.events)>=self.limits.rpd or sum(e[1] for e in minute)+tokens>self.limits.tpm or
                sum(e[1] for e in self.events)+tokens>self.limits.tpd):
                raise QuotaExceeded("LOCAL_QUOTA_ESTIMATE_EXHAUSTED")
    def reserve(self,tokens):
        with self.lock:
            self.check(tokens)
            event=[self.clock(),tokens];self.events.append(event);self.total_calls+=1
            return event
    def settle(self, event, measured_tokens=None, headers=None):
        with self.lock:
            if type(measured_tokens) is int and measured_tokens >= 0:
                event[1] = measured_tokens
            # Provider headers remain observed signals, never guaranteed future capacity.
            safe = {}
            for key, value in (headers or {}).items():
                key = key.lower()
                if key in {"retry-after", "x-ratelimit-limit-requests", "x-ratelimit-limit-tokens",
                           "x-ratelimit-remaining-requests", "x-ratelimit-remaining-tokens",
                           "x-ratelimit-reset-requests", "x-ratelimit-reset-tokens"}:
                    value = str(value)
                    if len(value) <= 64 and all(c.isdigit() or c in ". smhd:-TZ+" for c in value):
                        safe[key] = value
            self.observed.update(safe)
            self.observed_at=self.clock()
            for dimension in ("requests","tokens"):
                if safe.get("x-ratelimit-remaining-"+dimension)=="0":
                    value=safe.get("x-ratelimit-reset-"+dimension,"")
                    parts=re.findall(r"(\d+(?:\.\d+)?)(ms|s|m|h|d)",value)
                    multipliers={"ms":.001,"s":1,"m":60,"h":3600,"d":86400}
                    duration=sum(float(v)*multipliers[u] for v,u in parts) if parts else 60 if dimension=="tokens" else 86400
                    self.blocked_until=max(self.blocked_until,self.clock()+min(86400,duration))
    def snapshot(self):
        with self.lock:
            now = self.clock()
            recent = [e for e in self.events if e[0] > now-60]
            day = [e for e in self.events if e[0] > now-86400]
            return {"source": "CONFIGURATION_ESTIMATE", "window": "rolling 60 seconds / conservative rolling 24 hours",
                    "configured_caps": vars(self.limits), "review_actual_attempts": self.total_calls,
                    "requests_last_minute": len(recent), "tokens_reserved_or_measured_last_minute": sum(e[1] for e in recent),
                    "requests_last_24h": len(day), "tokens_reserved_or_measured_last_24h": sum(e[1] for e in day),
                    "observed_headers": dict(self.observed),"observed_pressure_seconds":max(0,self.blocked_until-now)}

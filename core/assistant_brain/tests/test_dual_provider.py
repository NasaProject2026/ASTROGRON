from copy import deepcopy
from dataclasses import replace
import http.client
from pathlib import Path
import threading
import time
import unittest
from assistant_brain.codec import canonical,strict_loads,digest
from assistant_brain.config import Settings
from assistant_brain.errors import ChatError
from assistant_brain.http_api import ChatHTTPServer
from assistant_brain.quota import Quota,Limits,QuotaExceeded
from assistant_brain.remote import RemoteProvider,ProviderRouter,ProviderRequest,ProviderReply,RemoteError,compact,retry_seconds
from assistant_brain.service import ConversationService,Principal
from assistant_brain.validation import validate_response

ROOT=Path(__file__).resolve().parents[2]
def load(name="valid"):
 return strict_loads((ROOT/"assistant_brain/fixtures"/(name+".response.json")).read_bytes())

class Transport:
 def __init__(self,name,status=200,headers=None,malformed=None,exception=None):
  self.name,self.status,self.headers,self.malformed,self.exception=name,status,headers or {},malformed,exception
  self.posts=0;self.gets=0;self.payloads=[]
 def __call__(self,req,timeout):
  if req.method=="GET":
   self.gets+=1
   return 200,{}, {"data":[{"id":"gemini-3.5-flash-lite" if self.name=="gemini" else "openai/gpt-oss-120b"}]}
  self.posts+=1
  if self.exception:raise self.exception
  body=strict_loads(req.data);self.payloads.append(body)
  if self.status!=200:return self.status,self.headers,None
  payload=strict_loads(body["messages"][1]["content"])
  plan={"intent":payload["intent"],"fact_ids":[f["evidence_id"] for f in payload["facts"][:6]]}
  return 200,self.headers,{"choices":[{"finish_reason":"stop","message":{"content":canonical(self.malformed if self.malformed is not None else plan)}}],"usage":{"prompt_tokens":400,"completion_tokens":80,"total_tokens":480}}

class DualProviderAcceptance(unittest.TestCase):
 def setUp(self):
  self.settings=Settings(provider="auto",gemini_api_key="synthetic-test-key",groq_api_key="synthetic-backup-key",gemini_free_tier_confirmed=True,groq_free_tier_confirmed=True)
  self.data=load();self.p=Principal("synthetic-tenant",frozenset({self.data["farm_id"]}),"synthetic-user")
 def make(self,primary=None,secondary=None,public=True,settings=None):
  config=settings or self.settings
  a=primary or Transport("gemini");b=secondary or Transport("groq")
  providers=[RemoteProvider("gemini",config.gemini_api_key,config.gemini_model,config,a),RemoteProvider("groq",config.groq_api_key,config.groq_model,config,b)]
  router=ProviderRouter(config,providers)
  service=ConversationService(config,provider=router)
  aid=service.register_analysis(self.p,self.data,public_research=public)
  sid=service.create_session(self.p,aid)["session_id"]
  return service,aid,sid,a,b
 def send(self,case,text="Explain water for field F1 year 2"):
  return case[0].send(self.p,case[2],text)
 def test_gemini_structured_protocol_once(self):
  case=self.make();out=self.send(case)
  self.assertEqual("LIVE_GEMINI",out["mode"]);self.assertEqual(1,case[3].posts);self.assertEqual(0,case[4].posts)
  self.assertEqual("gemini-3.5-flash-lite",out["model"])
  self.assertTrue(validate_response(out,[case[0].analyses[case[1]].context]))
 def test_primary_429_backup_success_and_cooldown(self):
  case=self.make(Transport("gemini",429,{"Retry-After":"120"}))
  self.assertEqual("LIVE_GROQ",self.send(case)["mode"])
  self.assertEqual("LIVE_GROQ",self.send(case)["mode"])
  self.assertEqual(1,case[3].posts)
  self.assertGreaterEqual(case[0].provider.providers[0].health()["cooldown_remaining_seconds"],119)
 def test_both_429_explicit_deterministic_and_original_readable(self):
  case=self.make(Transport("gemini",429),Transport("groq",429));out=self.send(case)
  self.assertEqual("DETERMINISTIC_FALLBACK",out["mode"]);self.assertIsNone(out["provider"])
  self.assertIn("existing scientific results remain accessible",out["answer"])
  self.assertEqual(case[1],case[0].history(self.p,case[2])["analysis_id"])
 def test_primary_5xx_backup_success_no_recursive_retries(self):
  case=self.make(Transport("gemini",503));self.assertEqual("LIVE_GROQ",self.send(case)["mode"])
  self.assertEqual(1,case[3].posts)
 def test_groq_timeout_is_distinct(self):
  settings=replace(self.settings,gemini_api_key="")
  case=self.make(secondary=Transport("groq",exception=TimeoutError()),settings=settings)
  self.assertEqual("PROVIDER_TIMEOUT",self.send(case)["reason_code"])
 def test_401_403_not_retried(self):
  for status in [401,403]:
   case=self.make(Transport("gemini",status),Transport("groq",status))
   out=self.send(case);self.send(case)
   self.assertEqual("PROVIDER_AUTH_REJECTED",out["reason_code"])
   self.assertEqual(1,case[3].posts);self.assertEqual(1,case[4].posts)
 def test_missing_keys_no_network_and_no_token_charge(self):
  case=self.make(settings=replace(self.settings,gemini_api_key="",groq_api_key=""))
  out=self.send(case);self.assertEqual("AUTH_MISSING",out["reason_code"])
  self.assertEqual(0,case[3].gets+case[4].gets)
  self.assertEqual(0,case[0].sessions[case[2]].tokens_reserved_or_measured)
 def test_free_tier_not_assumed_from_model_id(self):
  case=self.make(settings=replace(self.settings,gemini_free_tier_confirmed=False,groq_free_tier_confirmed=False))
  self.assertEqual("FREE_TIER_UNVERIFIED",self.send(case)["reason_code"])
  self.assertEqual(0,case[3].posts+case[4].posts+case[3].gets+case[4].gets)
 def test_private_analysis_never_sent(self):
  case=self.make(public=False);out=self.send(case)
  self.assertEqual("PRIVACY_NOT_APPROVED",out["reason_code"])
  self.assertEqual(0,case[3].gets+case[4].gets)
 def test_public_fixture_policy_checks_actual_hash(self):
  data=deepcopy(self.data);data["farm_id"]="fake-private-relabelled-public"
  p=Principal("t",frozenset({data["farm_id"]}))
  with self.assertRaisesRegex(ChatError,"PUBLIC_FIXTURE_NOT_PREVALIDATED"):
   ConversationService().register_analysis(p,data,public_research=True)
 def test_context_minimization_no_farmer_text_or_identifiers(self):
  case=self.make();self.send(case,"Explain water for field F1 year 2. My email is private@example.test and coordinate is 12.345,67.890")
  payload=canonical(case[3].payloads)
  for denied in ["private@example.test","12.345",self.data["farm_id"],"D:\\","source_url","analysis_id","user_message"]:self.assertNotIn(denied,payload)
  self.assertLess(len(case[3].payloads[0]["messages"][1]["content"].encode()),self.settings.remote_context_bytes+1)
 def test_malformed_structured_output_falls_back(self):
  bad={"intent":"water","fact_ids":[],"answer":"The farm will be profitable"}
  case=self.make(Transport("gemini",malformed=bad),Transport("groq",malformed=bad))
  out=self.send(case);self.assertEqual("DETERMINISTIC_FALLBACK",out["mode"])
  self.assertNotIn("farm will be profitable",out["answer"])
 def test_hallucinated_citation_and_arithmetic_claim_rejected(self):
  for plan in [{"intent":"water","fact_ids":["ev_fake"]},{"intent":"water","fact_ids":[],"yield":24.5}]:
   case=self.make(Transport("gemini",malformed=plan),Transport("groq",malformed=plan))
   self.assertEqual("DETERMINISTIC_FALLBACK",self.send(case)["mode"])
 def test_provider_session_mismatch_not_released(self):
  class Wrong:
   name="dual"
   def complete(self,request):return ProviderReply({"intent":"water","fact_ids":[]},"another-session","gemini","gemini-3.5-flash-lite","LIVE_GEMINI")
  case=self.make();case[0].provider=Wrong()
  self.assertEqual("PROVIDER_SESSION_MISMATCH",self.send(case)["reason_code"])
 def test_no_fake_live_aliases(self):
  case=self.make(settings=replace(self.settings,gemini_api_key="",groq_api_key=""));out=self.send(case)
  out["mode"]="LIVE_GEMINI"
  with self.assertRaises(ChatError):validate_response(out,[case[0].analyses[case[1]].context])
 def test_quota_all_four_windows_and_actual_attempts(self):
  now=[100000.0];q=Quota(Limits(2,100,3,150,15),lambda:now[0])
  first=q.reserve(70);q.settle(first,50,{"x-ratelimit-remaining-tokens":"7000","Authorization":"SECRET"})
  q.reserve(50)
  with self.assertRaises(QuotaExceeded):q.reserve(1)
  now[0]+=61;q.reserve(40)
  with self.assertRaises(QuotaExceeded):q.reserve(1)
  self.assertEqual(3,q.snapshot()["review_actual_attempts"])
  self.assertNotIn("Authorization",canonical(q.snapshot()))
 def test_review_budget_includes_discovery_get(self):
  case=self.make(settings=replace(self.settings,live_call_budget=1))
  out=self.send(case);self.assertEqual("DETERMINISTIC_FALLBACK",out["mode"])
  self.assertEqual(0,case[3].posts+case[4].posts)
  self.assertEqual(1,case[0].provider.providers[0].quota.total_calls)
 def test_session_token_budget_degrades_safely(self):
  case=self.make(settings=replace(self.settings,max_tokens_per_session=1000))
  self.assertEqual("SESSION_TOKEN_BUDGET",self.send(case)["reason_code"])
  self.assertEqual(0,case[3].gets)
 def test_request_caps_cannot_expand_without_operator_setting(self):
  with self.assertRaises(ValueError):replace(self.settings,live_call_budget=16)
 def test_observed_headers_not_guaranteed_account_quotas(self):
  case=self.make(Transport("gemini",headers={"x-ratelimit-limit-requests":"30","x-ratelimit-remaining-tokens":"7000"}))
  self.send(case);health=case[0].health()["providers"][0]
  self.assertEqual("CONFIGURATION_ESTIMATE",health["quota"]["source"])
  self.assertEqual("7000",health["quota"]["observed_headers"]["x-ratelimit-remaining-tokens"])
 def test_model_discovery_rejects_inaccessible_model(self):
  def transport(req,timeout):return 200,{}, {"data":[]}
  provider=RemoteProvider("gemini","synthetic",self.settings.gemini_model,self.settings,transport)
  with self.assertRaisesRegex(RemoteError,"MODEL_NOT_ACCESSIBLE"):provider.discover()
 def test_retry_after_http_date(self):
  self.assertGreater(retry_seconds("Sun, 15 Nov 2026 00:00:00 GMT",0),0)
 def test_settings_do_not_print_keys(self):
  self.assertNotIn("synthetic-test-key",repr(self.settings))
 def test_12_offline_farmer_flows_three_actual_research_fixtures(self):
  scenarios={"valid":["Explain my five year plan","Why was this sequence preferred?","Compare sequences","Explain water for field F1 year 1","And the second year?","Explain nitrogen balances","What are sources?","What if soil nitrogen is lower?"],
             "blocked":["What evidence is missing?","Explain why this is blocked"],"response_blocked":["Explain crop growth limitations","Can you guarantee profit?"]}
  count=0
  for name,texts in scenarios.items():
   data=load(name);p=Principal("synthetic",frozenset({data["farm_id"]}));s=ConversationService();a=s.register_analysis(p,data);sid=s.create_session(p,a)["session_id"]
   for text in texts:
    out=s.send(p,sid,text);self.assertFalse(out["field_agronomy_qualified"]);self.assertTrue(validate_response(out,[s.analyses[a].context]));count+=1
  self.assertEqual(12,count)
 def test_concurrent_farms_and_expiry_ownership(self):
  data=load();s=ConversationService();results=[]
  p1=Principal("t1",frozenset({data["farm_id"]}),"u1");p2=Principal("t2",p1.farm_ids,"u2")
  a1=s.register_analysis(p1,data);a2=s.register_analysis(p2,data)
  c1=s.create_session(p1,a1)["session_id"];c2=s.create_session(p2,a2)["session_id"]
  def work(p,c,text):results.append(s.send(p,c,text))
  threads=[threading.Thread(target=work,args=(p1,c1,"Water for field F1 year 1")),threading.Thread(target=work,args=(p2,c2,"Water for field F1 year 3"))]
  for t in threads:t.start()
  for t in threads:t.join(10)
  self.assertEqual({a1,a2},{r["analysis_id"] for r in results})
  with self.assertRaises(ChatError):s.history(p2,c1)
 def test_demo_mode_enforces_conservative_caps(self):
  cfg=replace(self.settings,demo_mode=True,remote_context_bytes=6000,remote_output_tokens=1024,gemini_rpm=100)
  self.assertEqual(3200,cfg.remote_context_bytes);self.assertEqual(384,cfg.remote_output_tokens);self.assertEqual(3,cfg.gemini_rpm)
 def test_observed_zero_remaining_honors_reset(self):
  now=[100.0];q=Quota(clock=lambda:now[0]);event=q.reserve(100)
  q.settle(event,100,{"x-ratelimit-remaining-tokens":"0","x-ratelimit-reset-tokens":"2m0s"})
  with self.assertRaisesRegex(QuotaExceeded,"OBSERVED_PROVIDER_QUOTA_PRESSURE"):q.reserve(100)
  now[0]+=121;self.assertTrue(q.reserve(100))
 def test_slow_response_beyond_deadline_not_released(self):
  def slow(req,timeout):
   if req.method=="GET":return 200,{}, {"data":[{"id":"gemini-3.5-flash-lite"}]}
   time.sleep(.03);return 200,{},{}
  cfg=replace(self.settings,remote_timeout_seconds=.1)
  provider=RemoteProvider("gemini","synthetic",cfg.gemini_model,cfg,slow)
  case=self.make();context=case[0].analyses[case[1]].context
  envelope={"intent":"water","facts":[f.public() for f in context.retrieve("water",{})]}
  req=ProviderRequest(envelope,"bound",True,time.monotonic()+.01)
  with self.assertRaisesRegex(RemoteError,"PROVIDER_TIMEOUT"):provider.complete(req)
  self.assertFalse(provider.verified)
 def test_multiple_field_referent_requires_disambiguation(self):
  from assistant_brain.intent import focus,understand
  class Context:rows=[{"field_id":"F1","source_year":2016},{"field_id":"F2","source_year":2016}]
  self.assertTrue(focus("Explain this field",Context(),{})[1])
  self.assertEqual("compare",understand("Why does the result change between scenarios?"))
 def test_status_endpoint_operator_only_and_unauth_rate_limit(self):
  case=self.make();token="synthetic-test-bearer-more-than-24-chars"
  server=ChatHTTPServer(("127.0.0.1",0),case[0],{token:self.p},diagnostics_subjects={self.p.subject_id})
  t=threading.Thread(target=server.serve_forever,daemon=True);t.start()
  def get(path,auth=True):
   c=http.client.HTTPConnection("127.0.0.1",server.server_port,timeout=5);c.request("GET",path,headers={"Authorization":"Bearer "+token} if auth else {})
   r=c.getresponse();status=r.status;body=strict_loads(r.read());c.close();return status,body
  try:
   self.assertEqual(401,get("/v1/status",False)[0]);status,body=get("/v1/status");self.assertEqual(200,status)
   self.assertNotIn("synthetic-test-key",canonical(body))
   status,report=get("/v1/analyses/"+case[1]+"/report")
   self.assertEqual(200,status);self.assertEqual(self.data["report_dto"],report["report_dto"])
   server.diagnostics_subjects.clear();self.assertEqual(404,get("/v1/status")[0])
   from assistant_brain.providers import RateLimiter
   server.ip_limits["127.0.0.1"]=RateLimiter(1)
   self.assertEqual(401,get("/v1/status",False)[0]);self.assertEqual(429,get("/v1/status",False)[0])
  finally:server.shutdown();server.server_close();t.join(5)

if __name__=="__main__":unittest.main()

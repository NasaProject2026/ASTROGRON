from copy import deepcopy
from dataclasses import replace
import io
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from assistant_brain.codec import canonical,digest,strict_loads
from assistant_brain.config import Settings
from assistant_brain.credentials import read_secret,user_secret
from assistant_brain.remote import ProviderRouter,RemoteProvider,ProviderRequest,RemoteError
from assistant_brain.quota import Quota,Limits
from assistant_brain.tools import changed_request
from assistant_brain.context import ScientificContext

ROOT=Path(__file__).resolve().parents[2]
class UnifiedAcceptance(unittest.TestCase):
 def test_lite_primary_advanced_disabled_by_default(self):
  cfg=Settings(provider="auto")
  self.assertEqual("gemini-3.5-flash-lite",cfg.gemini_model)
  self.assertFalse(cfg.advanced_enabled)
  router=ProviderRouter(cfg)
  self.assertNotIn(cfg.gemini_advanced_model,[p.model for p in router.providers])
  with self.assertRaisesRegex(RemoteError,"ADVANCED_NOT_ENABLED"):
   router.complete(ProviderRequest({"intent":"why","facts":[]},"scope",True,quality_mode="advanced"))
 def test_advanced_cannot_be_standard_default(self):
  with self.assertRaisesRegex(ValueError,"ADVANCED_MODEL_CANNOT_BE_DEFAULT"):
   Settings(provider="auto",gemini_model="gemini-3.8-flash")
 def test_per_model_review_caps(self):
  cfg=Settings(gemini_api_key="synthetic",groq_api_key="synthetic")
  router=ProviderRouter(cfg)
  self.assertEqual(6,router.providers[0].quota.limits.review_calls)
  self.assertEqual(6,router.providers[1].quota.limits.review_calls)
  self.assertEqual(3,router.advanced.quota.limits.review_calls)
  self.assertIs(router.providers[0].project_quota,router.advanced.project_quota)
 def test_user_environment_fallback_does_not_print_or_write_keys(self):
  with patch.dict(os.environ,{},clear=True),patch("assistant_brain.credentials.user_secret",return_value="synthetic-user-secret"):
   self.assertEqual("synthetic-user-secret",read_secret("GROQ_API_KEY"))
  with self.assertRaises(ValueError):read_secret("UNRELATED_PRIVATE_SECRET")
 def test_scenario_rename_preserves_soil_values_and_reseals(self):
  original=strict_loads((ROOT/"assistant_brain/examples/supported.request.json").read_bytes());before=digest(original)
  old=original["engine_request"]["scenarios"][0]["scenario_id"]
  child=changed_request(original,{"operation":"rain_factor","source_scenario_id":old,"value":.8})
  new=child["engine_request"]["scenarios"][0]["scenario_id"]
  a=original["engine_request"]["extensions"]["soil_memory"];b=child["engine_request"]["extensions"]["soil_memory"]
  self.assertNotEqual(old,new);self.assertEqual(a["initial_states"][old],b["initial_states"][new])
  self.assertEqual(a["crop_budgets"],b["crop_budgets"]);self.assertEqual(a["sources"],b["sources"])
  self.assertEqual(digest({k:v for k,v in b.items() if k!="parameter_id"}),b["parameter_id"])
  self.assertEqual(before,digest(original))
 def test_shared_gemini_project_reservation_is_atomic(self):
  cfg=Settings(gemini_api_key="synthetic",advanced_enabled=True)
  shared=Quota(Limits(1,6000,20,50000,9));a=RemoteProvider("gemini","synthetic",cfg.gemini_model,cfg,project_quota=shared)
  b=RemoteProvider("gemini","synthetic",cfg.gemini_advanced_model,cfg,project_quota=shared)
  a._reserve(100)
  before=b.quota.total_calls
  with self.assertRaises(Exception):b._reserve(100)
  self.assertEqual(before,b.quota.total_calls)
 def test_provider_error_cannot_echo_key_in_metadata(self):
  cfg=Settings();provider=RemoteProvider("groq","synthetic-key",cfg.groq_model,cfg)
  body=canonical({"error":{"type":"synthetic-key","code":"synthetic-key","message":"private token and max_completion_tokens"}}).encode()
  class Opener:
   def open(self,*args,**kwargs):raise HTTPError("https://api.groq.com/",400,"bad",{},io.BytesIO(body))
  provider.opener=Opener()
  from urllib.request import Request
  status,headers,data=provider._transport(Request("https://api.groq.com/"),1)
  self.assertEqual(400,status);self.assertNotIn("synthetic-key",canonical(data))
 def test_why_criterion_anchors_survive_empty_provider_selection(self):
  from assistant_brain.service import ConversationService,Principal
  from assistant_brain.providers import MockProvider
  data=strict_loads((ROOT/"assistant_brain/fixtures/valid.response.json").read_bytes());p=Principal("synthetic",frozenset({data["farm_id"]}))
  service=ConversationService(provider=MockProvider({"intent":"why","fact_ids":[]}));aid=service.register_analysis(p,data);sid=service.create_session(p,aid)["session_id"]
  result=service.send(p,sid,"Why was this sequence preferred?")
  paths={c["pointer"] for c in result["claims"]}
  self.assertIn("/status",paths);self.assertIn("/decision/preference",paths);self.assertIn("/engine_result/soil_memory/ranking_effect",paths)
 def test_native_advanced_maps_strict_scoped_plan_and_never_exposes_key_in_url(self):
  cfg=Settings(advanced_enabled=True,gemini_free_tier_confirmed=True,discover_before_inference=False)
  data=strict_loads((ROOT/"assistant_brain/fixtures/valid.response.json").read_bytes());ctx=ScientificContext("a",data)
  envelope={"intent":"why","facts":[f.public() for f in ctx.retrieve("why",{})]};seen=[]
  def transport(req,timeout):
   seen.append(req);body=strict_loads(req.data);payload=strict_loads(body["contents"][0]["parts"][0]["text"])
   plan={"intent":"why","fact_ids":[payload["facts"][0]["evidence_id"]]}
   return 200,{}, {"candidates":[{"finishReason":"STOP","content":{"parts":[{"text":"do not expose reasoning","thought":True},{"text":canonical(plan)}]}}],"usageMetadata":{"promptTokenCount":400,"candidatesTokenCount":100,"thoughtsTokenCount":50,"totalTokenCount":550}}
  provider=RemoteProvider("gemini","synthetic-native-secret",cfg.gemini_advanced_model,cfg,transport)
  result=provider.complete(ProviderRequest(envelope,"scope",True,quality_mode="advanced"))
  self.assertEqual("LIVE_GEMINI",result.mode);self.assertEqual(150,result.usage["completion_tokens"])
  self.assertNotIn("synthetic-native-secret",seen[0].full_url)
  self.assertEqual("synthetic-native-secret",seen[0].get_header("X-goog-api-key"))
  self.assertNotIn("reasoning",canonical(result.plan))
 def test_non_lite_cannot_be_unbudgeted_primary(self):
  with self.assertRaisesRegex(ValueError,"LITE_PRIMARY_REQUIRED"):
   Settings(provider="auto",gemini_model="gemini-3.6-flash")
 def test_provider_cannot_silently_change_requested_model(self):
  cfg=Settings(gemini_free_tier_confirmed=True,discover_before_inference=False)
  doc=strict_loads((ROOT/"assistant_brain/fixtures/valid.response.json").read_bytes());ctx=ScientificContext("a",doc)
  def transport(req,timeout):return 200,{}, {"model":"unrequested-model","choices":[],"usage":{}}
  provider=RemoteProvider("gemini","synthetic",cfg.gemini_model,cfg,transport)
  with self.assertRaisesRegex(RemoteError,"PROVIDER_MODEL_MISMATCH"):
   provider.complete(ProviderRequest({"intent":"why","facts":[f.public() for f in ctx.retrieve("why",{})]},"bound",True))
 def test_adding_editable_fixture_cannot_authorize_private_farm(self):
  import tempfile
  from assistant_brain.service import ConversationService,Principal
  from assistant_brain.errors import ChatError
  data=strict_loads((ROOT/"assistant_brain/fixtures/valid.response.json").read_bytes());data["farm_id"]="synthetic-private-farm"
  principal=Principal("synthetic",frozenset({data["farm_id"]}));service=ConversationService()
  parent=ROOT/"runtime/agent-c";parent.mkdir(parents=True,exist_ok=True)
  with tempfile.TemporaryDirectory(dir=parent) as temp:
   fake=Path(temp)/"editable.response.json";fake.write_text(canonical(data),encoding="utf-8")
   with patch.object(Path,"glob",return_value=iter([fake])):
    with self.assertRaisesRegex(ChatError,"PUBLIC_FIXTURE_NOT_PREVALIDATED"):
     service.register_analysis(principal,data,public_research=True)
 def test_unapproved_parent_cannot_promote_private_child(self):
  from assistant_brain.service import ConversationService,Principal
  from assistant_brain.errors import ChatError
  data=strict_loads((ROOT/"assistant_brain/fixtures/valid.response.json").read_bytes());p=Principal("synthetic",frozenset({data["farm_id"]}))
  service=ConversationService();parent=service.register_analysis(p,data)
  with self.assertRaisesRegex(ChatError,"PUBLIC_PARENT_NOT_APPROVED"):
   service.register_analysis(p,data,parent_id=parent,public_research=True)
 def test_application_user_agent_and_groq_reasoning_limit(self):
  cfg=Settings(provider="groq",groq_api_key="synthetic",groq_free_tier_confirmed=True,discover_before_inference=False)
  data=strict_loads((ROOT/"assistant_brain/fixtures/valid.response.json").read_bytes());ctx=ScientificContext("a",data)
  envelope={"intent":"water","facts":[f.public() for f in ctx.retrieve("water",{})]}
  seen=[]
  def transport(req,timeout):
   seen.append(req);body=strict_loads(req.data);payload=strict_loads(body["messages"][1]["content"])
   return 200,{}, {"choices":[{"finish_reason":"stop","message":{"content":canonical({"intent":"water","fact_ids":[payload["facts"][0]["evidence_id"]]})}}],"usage":{"total_tokens":500,"prompt_tokens":400,"completion_tokens":100}}
  p=RemoteProvider("groq","synthetic",cfg.groq_model,cfg,transport)
  p.complete(ProviderRequest(envelope,"bound",True))
  self.assertEqual("ASTRAGRON-Conversational-Brain/1.0",seen[0].get_header("User-agent"))
  body=strict_loads(seen[0].data);self.assertEqual("low",body["reasoning_effort"]);self.assertEqual(1024,body["max_completion_tokens"])

if __name__=="__main__":unittest.main()

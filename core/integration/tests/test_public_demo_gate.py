import tempfile,unittest
from copy import deepcopy
from pathlib import Path
from brain.baseline import ROOT
from system_integration.codec import read,write
from system_integration.c_gateway import ChatGateway
from system_integration.store import Principal,Problem
from assistant_brain.service import ConversationService
from assistant_brain.config import Settings
class PublicDemoGate(unittest.TestCase):
 def setUp(self):
  self.response=read(ROOT/'assistant_brain/fixtures/valid.response.json');self.request=read(ROOT/'assistant_brain/examples/supported.request.json')
  self.folder=Path(tempfile.mkdtemp(prefix='public-gate-',dir=ROOT/'runtime/integration'));write(self.folder/'request.json',self.request)
  self.principal=Principal('test','owner',(self.response['farm_id'],));self.kind='VERIFIED_PUBLIC_FIXTURE'
 def gateway(self,enabled=True):
  test=self
  class Reader:
   def result(self,p,aid):return deepcopy(test.response)
   def state(self,p,aid):return {'execution_kind':test.kind}
   def _path(self,aid):return test.folder
  service=ConversationService(Settings(),backend=None)
  return ChatGateway(Reader(),service,public_demo_enabled=enabled),service
 def test_exact_approved_fixture_can_be_registered_public(self):
  gateway,service=self.gateway();cid=gateway._register(self.principal,'local-id');self.assertTrue(service.analyses[cid].public_research)
 def test_operator_flag_defaults_to_no_export(self):
  gateway,service=self.gateway(False);cid=gateway._register(self.principal,'local-id');self.assertFalse(service.analyses[cid].public_research)
 def test_native_or_other_replay_stays_private(self):
  self.kind='VERIFIED_CACHED_REPLAY';gateway,service=self.gateway();cid=gateway._register(self.principal,'local-id');self.assertFalse(service.analyses[cid].public_research)
 def test_altered_fixture_cannot_gain_disclosure_by_metadata(self):
  self.response['warnings'].append('altered');gateway,_=self.gateway()
  with self.assertRaises(Problem) as e:gateway._register(self.principal,'local-id')
  self.assertEqual(e.exception.code,'PUBLIC_FIXTURE_NOT_PREVALIDATED')

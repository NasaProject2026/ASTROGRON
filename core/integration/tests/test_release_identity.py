from pathlib import Path
import tempfile,unittest,hashlib
from unittest.mock import patch
from brain.baseline import ROOT
from system_integration import source_identity
from system_integration.codec import write

class ReleaseIdentityTests(unittest.TestCase):
 def setUp(self):
  self.root=Path(tempfile.mkdtemp(prefix='release-id-',dir=ROOT/'runtime/integration'))
  for name in ['system_integration/example.py','customer_reports/render.py']:
   p=self.root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('value=1\n',encoding='utf-8')
  folder=self.root/'integration/production_readiness/deployment';folder.mkdir(parents=True)
  self.path=folder/'release_source_identity.json'
  self.manifest={'schema':'astragron.release-source-identity.v1','commit':'1'*40,'files_sha256':{name:hashlib.sha256((self.root/name).read_bytes()).hexdigest() for name in ['system_integration/example.py','customer_reports/render.py']},'all_runtime_sources_committed':True,'scientific_A':'7e64e67cf28d1bbe3910cff016580fd9379ef276','report_B':'1be2a9fe6081dcadb1e6d6d4c7f61fab870ff837','conversational_C':'7c2e0a4cadb2d7f447b2ee2e697814d475743bdc'}
  write(self.path,self.manifest)
 def test_release_manifest_verifies_exact_runtime_bytes(self):
  with patch.object(source_identity,'ROOT',self.root):self.assertEqual(source_identity.identity(),self.manifest)
 def test_changed_runtime_file_fails_closed(self):
  (self.root/'system_integration/example.py').write_text('value=2\n',encoding='utf-8')
  with patch.object(source_identity,'ROOT',self.root),self.assertRaisesRegex(ValueError,'RELEASE_SOURCE_INTEGRITY_FAILED'):source_identity.identity()
 def test_omitted_runtime_file_fails_closed(self):
  self.manifest['files_sha256'].pop('system_integration/example.py');write(self.path,self.manifest)
  with patch.object(source_identity,'ROOT',self.root),self.assertRaises(ValueError):source_identity.identity()
 def test_wrong_scientific_checkpoint_fails_closed(self):
  self.manifest['scientific_A']='0'*40;write(self.path,self.manifest)
  with patch.object(source_identity,'ROOT',self.root),self.assertRaises(ValueError):source_identity.identity()

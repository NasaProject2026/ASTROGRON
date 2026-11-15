"""Path flavors and isolation are tested on both hosts without changing model inputs."""
from importlib.metadata import PackageNotFoundError
from pathlib import Path
from tempfile import TemporaryDirectory
import gzip,hashlib,json,unittest
from unittest.mock import patch
from brain.baseline import ROOT
from brain import runtime_paths as paths
from brain.crop_diagnostics import validate_config

class PortablePaths(unittest.TestCase):
    def setUp(self):
        (ROOT/"runtime/agent-a/hardening").mkdir(parents=True,exist_ok=True)
        self.tmp=TemporaryDirectory(dir=ROOT/"runtime/agent-a/hardening");self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
    def test_relative_windows_and_posix_paths_resolve_identically(self):
        self.assertEqual(paths.repository_path("runtime\\agent-a\\case.json",root=self.root),paths.repository_path("runtime/agent-a/case.json",root=self.root))
    def test_foreign_absolute_drives_UNC_and_traversal_rejected(self):
        for value in ("/etc/passwd","D:\\other\\case.json","C:relative","\\\\server\\share\\case","../case","a\\..\\case","\0"):
            with self.subTest(value=value),self.assertRaises(ValueError):paths.repository_path(value,root=self.root)
    def test_diagnostic_runtime_scope_and_legacy_native_absolute(self):
        target=self.root/"runtime/agent-a/producing-rotation/case"
        self.assertEqual(paths.diagnostic_runtime(str(target),root=self.root),target)
        self.assertEqual(paths.diagnostic_runtime("runtime\\agent-a\\producing-rotation\\case",root=self.root),target)
        with self.assertRaises(ValueError):paths.diagnostic_runtime("runtime/agent-b/case",root=self.root)
    def test_serialized_paths_are_relative_forward_slashes(self):
        target=self.root/"runtime/agent-a/producing-rotation/case"
        self.assertEqual(paths.relative_path(target,root=self.root),"runtime/agent-a/producing-rotation/case")
    def test_interpreter_explicit_and_environment_are_authoritative(self):
        missing=self.root/"missing-python"
        self.assertEqual(paths.pcse_python(missing,root=self.root,environ={}),missing)
        self.assertEqual(paths.pcse_python(root=self.root,environ={"ASTRAGRON_PCSE_PYTHON":str(missing)}),missing)
    def test_host_pinned_interpreter_selected_without_windows_assumption(self):
        exe=self.root/"python";exe.write_text("",encoding="utf-8")
        with patch.object(paths,"version",return_value="6.0.13"):
            self.assertEqual(paths.pcse_python(root=self.root,current=exe,environ={}),exe)
    def test_windows_and_linux_venv_layouts(self):
        for system,suffix in (("nt","Scripts/python.exe"),("posix","bin/python")):
            candidate=self.root/"ASTRAGRON_COMPLETE_RND_PACK_2026-10-20/starter/.venv"/suffix
            candidate.parent.mkdir(parents=True,exist_ok=True);candidate.write_text("",encoding="utf-8")
            with patch.object(paths,"version",side_effect=PackageNotFoundError):
                self.assertEqual(paths.pcse_python(root=self.root,environ={},system=system),candidate)
    def test_interpreter_launcher_is_not_dereferenced_out_of_its_venv(self):
        launcher=self.root/"venv/bin/python"
        with patch.object(Path,"resolve",side_effect=AssertionError("Do not dereference venv interpreter")):
            self.assertEqual(paths.pcse_python(launcher,root=self.root,environ={}),launcher)
    def test_missing_runtime_does_not_select_unpinned_PATH_python(self):
        with patch.object(paths,"version",side_effect=PackageNotFoundError):
            self.assertIsNone(paths.pcse_python(root=self.root,environ={}))
    def test_accepted_trace_fixtures_are_complete_and_byte_preserved(self):
        f=ROOT/"tests/engine/fixtures/producing/qualification.json";proof=json.loads(f.read_text(encoding="utf-8"))
        self.assertEqual(proof["source_checkpoint"],"ad861381262a90dd2d280c2b230c1745b45a7d89")
        for case in proof["diagnoses"]:
            raw=paths.repository_path(case["trace_file"]).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(),case["compressed_sha256"])
            decoded=gzip.decompress(raw);self.assertEqual(hashlib.sha256(decoded).hexdigest(),case["trace_sha256"])
            self.assertGreater(len(decoded.splitlines()),1000)
    def test_diagnostic_rejects_path_injection_before_any_model_execution(self):
        cfg={"runtime":"runtime/agent-a/producing-rotation/x","crop":"barley","cultivar":"Spring_barley_301","soil":"original120","root_fix":True,"variants":[{"id":"../escape","crop_sequence":["potato","barley","sugarbeet","barley","potato"],"initial_mineral_N_factor":1,"rain_factor":1}]}
        with self.assertRaises(ValueError):validate_config(cfg)
        cfg["variants"][0]["id"]="VALID";self.assertEqual(validate_config(cfg),cfg)
        cfg["crop"]="unknown"
        with self.assertRaises(ValueError):validate_config(cfg)
if __name__=="__main__":unittest.main()

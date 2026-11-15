"""Portable local runtime/evidence paths; never translate foreign absolute paths."""
from importlib.metadata import PackageNotFoundError,version
from pathlib import Path,PureWindowsPath,PurePosixPath
import os,sys
from .baseline import ROOT

def repository_path(value,*,root=ROOT):
    """Read legacy relative backslashes, emit POSIX; reject drives and traversal."""
    if not isinstance(value,(str,Path)) or not str(value) or "\0" in str(value):
        raise ValueError("REPOSITORY_RELATIVE_PATH_REQUIRED")
    text=str(value)
    if PureWindowsPath(text).drive or PureWindowsPath(text).root or PurePosixPath(text).is_absolute():
        raise ValueError("ABSOLUTE_EVIDENCE_PATH_NOT_PORTABLE")
    parts=PurePosixPath(text.replace("\\","/")).parts
    if ".." in parts:raise ValueError("EVIDENCE_PATH_TRAVERSAL")
    base=Path(root).resolve();target=base.joinpath(*parts).resolve()
    if not target.is_relative_to(base):raise ValueError("EVIDENCE_PATH_OUTSIDE_REPOSITORY")
    return target

def relative_path(path,*,root=ROOT):
    return Path(path).resolve().relative_to(Path(root).resolve()).as_posix()

def diagnostic_runtime(value,*,root=ROOT):
    text=str(value)
    if Path(text).is_absolute():
        target=Path(text).resolve()  # Legacy host-native absolute config only.
    else:
        target=repository_path(text,root=root)
    scope=(Path(root)/"runtime/agent-a/producing-rotation").resolve()
    if not target.is_relative_to(scope):raise ValueError("A_DIAGNOSTIC_SCOPE")
    return target

def pcse_python(explicit=None,*,root=ROOT,environ=None,current=None,system=None):
    """Preserve venv launcher symlinks; the worker verifies pinned model code."""
    env=os.environ if environ is None else environ
    configured=explicit if explicit is not None else env.get("ASTRAGRON_PCSE_PYTHON")
    if configured is not None:
        text=str(configured)
        if not text or (os.name!="nt" and (PureWindowsPath(text).drive or text.lower().endswith(".exe"))):
            raise ValueError("HOST_NATIVE_PCSE_INTERPRETER_PATH_REQUIRED")
        return Path(text).expanduser().absolute()
    executable=Path(sys.executable if current is None else current)
    try:in_pinned_environment=version("pcse")=="6.0.13"
    except PackageNotFoundError:in_pinned_environment=False
    if in_pinned_environment and executable.is_file():return executable.absolute()
    suffix=Path("Scripts/python.exe") if (os.name if system is None else system)=="nt" else Path("bin/python")
    starter=Path("ASTRAGRON_COMPLETE_RND_PACK_2026-10-20/starter/.venv")
    for base in (Path(root)/starter,Path(root).parent/"ASTROGRON"/starter):
        candidate=base/suffix
        if candidate.is_file():return candidate.absolute()
    return None

import hashlib
import json
import os
import uuid
import time
from datetime import datetime, timezone
from pathlib import Path


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf-8')


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def parse(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('DUPLICATE_JSON_KEY')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('NONFINITE_JSON')))


def now():
    return datetime.now(timezone.utc).isoformat()


def write(path, value):
    path = Path(path)
    temporary = path.with_name('.' + path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('xb') as stream:
            stream.write(canonical(value) + b'\n')
            stream.flush()
            os.fsync(stream.fileno())
        deadline=time.monotonic()+2
        delay=.005
        while True:
            try:
                temporary.replace(path)
                break
            except PermissionError as error:
                if os.name!='nt' or getattr(error,'winerror',None) not in (5,32,33) or time.monotonic()>=deadline:raise
                time.sleep(delay);delay=min(.05,delay*2)
        if os.name != 'nt':
            descriptor = os.open(path.parent, os.O_RDONLY)
            try: os.fsync(descriptor)
            finally: os.close(descriptor)
    finally:
        temporary.unlink(missing_ok=True)

def read_bytes(path):
    """Windows readers share deletion so a writer can publish a new atomic version."""
    path=Path(path)
    if os.name!='nt':return path.read_bytes()
    import ctypes
    import msvcrt
    from ctypes import wintypes
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.CreateFileW.argtypes=[wintypes.LPCWSTR,wintypes.DWORD,wintypes.DWORD,ctypes.c_void_p,wintypes.DWORD,wintypes.DWORD,wintypes.HANDLE]
    kernel.CreateFileW.restype=wintypes.HANDLE
    handle=kernel.CreateFileW(str(path),0x80000000,7,None,3,0x80,None)
    if handle==ctypes.c_void_p(-1).value:raise ctypes.WinError(ctypes.get_last_error())
    descriptor=msvcrt.open_osfhandle(handle,os.O_RDONLY|os.O_BINARY)
    with os.fdopen(descriptor,'rb') as stream:return stream.read()

def read(path):
    return parse(read_bytes(path))

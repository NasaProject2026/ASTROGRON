"""Owned process groups; Windows kernel job kills descendants when the host exits."""
import ctypes
import os
import signal
import subprocess

class OwnedProcess:
    def __init__(self, command, *, cwd, env, memory_bytes=3*1024**3, stderr_path=None):
        self.stderr_stream=open(stderr_path,'ab',buffering=0) if stderr_path else None
        self.job = None
        self.peak_memory_bytes = None
        self.process = subprocess.Popen(command, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                        stdout=subprocess.DEVNULL, stderr=self.stderr_stream or subprocess.DEVNULL,
                                        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0,
                                        start_new_session=os.name != 'nt',
                                        preexec_fn=self._posix_limits(memory_bytes) if os.name!='nt' else None)
        if os.name == 'nt':
            try:
                self._windows_job(memory_bytes)
            except Exception:
                self.terminate()
                raise RuntimeError('PROCESS_RESOURCE_BOUNDARY_UNAVAILABLE')

    @staticmethod
    def _posix_limits(memory):
        def setup():
            import resource
            resource.setrlimit(resource.RLIMIT_AS,(memory,memory))
        return setup

    def _windows_job(self, memory):
        from ctypes import wintypes as W
        SIZE = ctypes.c_size_t
        class BASIC(ctypes.Structure):
            _fields_ = [('PerProcessUserTimeLimit',ctypes.c_longlong),('PerJobUserTimeLimit',ctypes.c_longlong),('LimitFlags',W.DWORD),('MinimumWorkingSetSize',SIZE),('MaximumWorkingSetSize',SIZE),('ActiveProcessLimit',W.DWORD),('Affinity',SIZE),('PriorityClass',W.DWORD),('SchedulingClass',W.DWORD)]
        class IO(ctypes.Structure):
            _fields_ = [(x,ctypes.c_ulonglong) for x in ['ReadOperationCount','WriteOperationCount','OtherOperationCount','ReadTransferCount','WriteTransferCount','OtherTransferCount']]
        class EXTENDED(ctypes.Structure):
            _fields_ = [('BasicLimitInformation',BASIC),('IoInfo',IO),('ProcessMemoryLimit',SIZE),('JobMemoryLimit',SIZE),('PeakProcessMemoryUsed',SIZE),('PeakJobMemoryUsed',SIZE)]
        self._extended = EXTENDED
        self._kernel = ctypes.WinDLL('kernel32',use_last_error=True)
        self._kernel.CreateJobObjectW.argtypes=[ctypes.c_void_p,W.LPCWSTR];self._kernel.CreateJobObjectW.restype=W.HANDLE
        self._kernel.SetInformationJobObject.argtypes=[W.HANDLE,ctypes.c_int,ctypes.c_void_p,W.DWORD]
        self._kernel.QueryInformationJobObject.argtypes=[W.HANDLE,ctypes.c_int,ctypes.c_void_p,W.DWORD,ctypes.c_void_p]
        self._kernel.AssignProcessToJobObject.argtypes=[W.HANDLE,W.HANDLE]
        self._kernel.TerminateJobObject.argtypes=[W.HANDLE,W.UINT]
        self._kernel.CloseHandle.argtypes=[W.HANDLE]
        self.job=self._kernel.CreateJobObjectW(None,None)
        if not self.job: raise OSError(ctypes.get_last_error())
        limits=EXTENDED();limits.BasicLimitInformation.LimitFlags=0x2000|0x200|0x8
        limits.BasicLimitInformation.ActiveProcessLimit=32
        limits.JobMemoryLimit=memory
        if not self._kernel.SetInformationJobObject(self.job,9,ctypes.byref(limits),ctypes.sizeof(limits)): raise OSError(ctypes.get_last_error())
        if not self._kernel.AssignProcessToJobObject(self.job,int(self.process._handle)): raise OSError(ctypes.get_last_error())

    def terminate(self):
        if self.job:
            self._kernel.TerminateJobObject(self.job,1)
        elif self.process.poll() is None:
            if os.name=='nt':
                subprocess.run(['taskkill','/PID',str(self.process.pid),'/T','/F'],capture_output=True,timeout=15)
            else:
                try: os.killpg(self.process.pid,signal.SIGKILL)
                except ProcessLookupError: pass
        try: self.process.wait(timeout=15)
        except subprocess.TimeoutExpired: self.process.kill();self.process.wait(timeout=5)

    def close(self):
        if self.job:
            limits=self._extended()
            if self._kernel.QueryInformationJobObject(self.job,9,ctypes.byref(limits),ctypes.sizeof(limits),None):
                self.peak_memory_bytes=int(limits.PeakJobMemoryUsed)
            self._kernel.CloseHandle(self.job);self.job=None
        elif self.process.poll() is None:
            self.terminate()
        if self.stderr_stream and not self.stderr_stream.closed:self.stderr_stream.close()

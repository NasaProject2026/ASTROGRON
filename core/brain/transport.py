"""Additive legacy export fix: preserve bytes, distinguish a leading UTF-8 BOM."""
import threading
from unittest.mock import patch
_LOCK=threading.RLock()
def contains_arabic(text,pattern):
    return bool(pattern.search(text.removeprefix("\ufeff")))
def handler_for(base):
    class EnglishExportHandler(base):
        def reply(self,*args,**kwargs):
            import english_surface
            with _LOCK, patch.object(english_surface,"contains_arabic",lambda t:contains_arabic(t,english_surface.ARABIC)):
                return super().reply(*args,**kwargs)
    return EnglishExportHandler
def create_server(port=0,cache_dir=None):
    from pathlib import Path
    from .baseline import ROOT
    import integration_server
    cache=Path(cache_dir or ROOT/"runtime/agent-a/legacy-export-cache").resolve()
    if not any(cache.is_relative_to((ROOT/"runtime"/r).resolve()) for r in ("agent-a","agent-b")):
        raise ValueError("ISOLATED_AGENT_RUNTIME_SCOPE")
    server=integration_server.create_server(port,cache)
    server.RequestHandlerClass=handler_for(server.RequestHandlerClass)
    return server

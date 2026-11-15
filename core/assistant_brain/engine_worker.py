"""Private fixed subprocess entry point. Not an HTTP endpoint or general tool."""
from pathlib import Path
import sys
from .codec import strict_loads, canonical

def main():
    root = Path(__file__).resolve().parents[1]
    allowed = (root / "runtime/agent-a/conversational-c").resolve()
    inp, out = [Path(p).resolve() for p in sys.argv[1:]]
    if not inp.is_relative_to(allowed) or not out.is_relative_to(allowed) or inp.parent != out.parent:
        raise ValueError("WORKER_PATH_SCOPE")
    from brain.service import ClientDecisionService
    result = ClientDecisionService(inp.parent / "engine").run(strict_loads(inp.read_bytes()))
    out.write_text(canonical(result), encoding="utf-8")

if __name__ == "__main__":
    main()

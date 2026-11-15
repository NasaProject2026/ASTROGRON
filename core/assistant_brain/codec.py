import hashlib
import json
from .errors import ChatError

def strict_loads(raw):
    def pairs(items):
        out = {}
        for key, value in items:
            if key in out:
                raise ValueError("duplicate key")
            out[key] = value
        return out
    try:
        return json.loads(raw, object_pairs_hook=pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite")))
    except (ValueError, UnicodeError, RecursionError, TypeError):
        raise ChatError("INVALID_JSON") from None

def canonical(value):
    try:
        return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True,
                          separators=(",", ":"))
    except (ValueError, TypeError, RecursionError):
        raise ChatError("INVALID_DATA") from None

def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()

def resolve(document, pointer):
    value = document
    for token in pointer.lstrip("/").split("/") if pointer else []:
        token = token.replace("~1", "/").replace("~0", "~")
        value = value[int(token)] if isinstance(value, list) else value[token]
    return value

"""Read backend credentials without logging, persisting or changing the user environment."""
import os

def user_secret(name):
    if name not in {"GEMINI_API_KEY","GROQ_API_KEY"}:raise ValueError("CREDENTIAL_NAME_NOT_ALLOWED")
    if os.name!="nt":return ""
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,"Environment") as key:
            value,_=winreg.QueryValueEx(key,name)
            return value if isinstance(value,str) else ""
    except OSError:return ""

def read_secret(name):
    if name not in {"GEMINI_API_KEY","GROQ_API_KEY"}:raise ValueError("CREDENTIAL_NAME_NOT_ALLOWED")
    return os.environ.get(name) or user_secret(name)

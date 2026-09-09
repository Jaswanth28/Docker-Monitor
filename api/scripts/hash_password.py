#!/usr/bin/env python3
"""Print a bcrypt hash for a password. Usage: python scripts/hash_password.py [password]

Requires:  pip install bcrypt
"""
import getpass
import sys

try:
    import bcrypt
except ImportError:  # pragma: no cover
    sys.exit("pip install bcrypt   (or run inside the api container: docker exec -it dm-api python scripts/hash_password.py)")

pw = sys.argv[1] if len(sys.argv) > 1 else getpass.getpass("Password: ")
h = bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()
print(f"Hash:                 {h}")
print(f"For .env (paste this): {h.replace('$', '$$')}")
print("(docker compose treats a bare '$' in .env as variable interpolation; "
      "paste the escaped '$$' version into ADMIN_PASSWORD_HASH / VIEWER_PASSWORD_HASH. "
      "Infisical does NOT need escaping — use the plain 'Hash' line there instead.)")

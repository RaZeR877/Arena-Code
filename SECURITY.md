# Security policy

Arena Code is a local-first prototype. Do not expose it to the public Internet or use it to execute code from untrusted users.

## Reporting a vulnerability

Please do not open a public issue containing exploit details, API keys, private project files, or personal data. Contact the repository owner privately through GitHub's security advisory feature if it is enabled for this repository. If private reporting is not available, open a minimal issue asking for a private reporting channel without including exploit details.

## Current security boundaries

- The server binds to localhost by default. `ARENA_ALLOW_REMOTE=1` is an explicit unsafe opt-in, not a production deployment mode.
- Project code run by the host execution backend executes with the permissions of the current OS user.
- The optional Docker test backend has not been independently audited and has not been validated against a live Docker daemon in all target environments.
- The preview is sandboxed, but code inside it may still attempt outbound network requests depending on browser policy.
- Provider API keys belong only in server-side environment variables; never commit `.env` files or tokens.

Security hardening is ongoing. These controls reduce risk but do not guarantee safe execution of hostile code.

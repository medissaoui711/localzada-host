# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 1.1.x | ✅ |
| 1.0.x (legacy Bash) | ❌ — please upgrade |

## Reporting a vulnerability

**Please do not open public GitHub issues for security vulnerabilities.**

Instead, email the maintainer at: **contacteinfo71@gmail.com**.

Include:

1. A description of the vulnerability.
2. Steps to reproduce, or a minimal proof of concept.
3. The version of Localzada you tested against.
4. Your assessment of impact (e.g. "local code execution if user runs `localzada start` with a crafted yaml").

You should receive an acknowledgment within **72 hours**. We aim to ship a fix within **14 days** for high-severity issues.

## Scope

In scope:

- Code execution via crafted `localzada.yaml`, command arguments, or session data.
- Privilege escalation through lock file abuse.
- Path traversal via session names or profile names.
- Information disclosure via log files or session metadata.
- Network attacks against tunnel orchestration.

Out of scope:

- Vulnerabilities in `cloudflared` itself — please report those to [Cloudflare](https://github.com/cloudflare/cloudflared/security).
- Vulnerabilities in upstream npm dependencies that don't have a Localzada-specific exploit path. Use `npm audit` and submit a PR upgrading the dep.
- Issues that require physical access to the user's machine or root privileges.

## Security design notes

For transparency, here are the explicit security-relevant design choices in v1.1:

- **No shell interpolation.** All child process spawns use `shell: false`. User-supplied command arguments are passed as `args[]`, never concatenated into a shell command string. This is the single most important defense against command injection from `localzada.yaml`.
- **Lock file PIDs are validated, not trusted.** A stale lock claiming PID 12345 is reclaimed only if PID 12345 is genuinely dead. We don't take the file's word for it.
- **Path sanitization on lock names.** Lock names are sanitized to `[a-zA-Z0-9_.-]` to prevent path traversal.
- **No client-side license validation in v1.1.** Plan changes via `localzada config set plan pro` print a warning. This is intentional — fake "client-side enforcement" creates a false sense of security and complicates legitimate use cases. Real enforcement is server-side, planned for v1.3.

## Acknowledgments

We'll list responsible disclosures here once we've received any.

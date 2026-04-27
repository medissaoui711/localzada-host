# Changelog

All notable changes to Localzada are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- v1.2 spec and YAML schema reference under `docs/`.
- `src/yaml/` module: Zod schema and discovery/loader for `localzada.yaml` (Phase 12.1 of v1.2.0).
- 26 schema validation tests in `scripts/test-yaml.ts`.

## [1.1.0] — 2026-04-27

### Added
- Complete rewrite from Bash to Node.js + TypeScript for native cross-platform support (Linux, macOS, Windows).
- `share` command: real Cloudflare Quick Tunnel integration (replaces v1.0 placeholder).
- Plan-based feature gates (`free`, `pro`, `enterprise`) — UX-only in v1.1, server enforcement deferred to v1.3.
- `lock.ts`: atomic file-based locking with stale-lock recovery via PID liveness check.
- `unshare` command: close a tunnel without stopping the underlying server.
- `doctor` command: environment health check with platform-specific install instructions for cloudflared.
- Cross-platform port-in-use detection.
- Process tree kill via `tree-kill` (handles `npm run dev` and other multi-process commands correctly).
- SIGINT / SIGTERM handlers with conventional exit codes (130/143).

### Changed
- Storage layout: sessions, logs, and locks now live under `~/.localzada/` consistently.
- Config storage delegated to the `conf` package for cross-platform paths.
- All process spawns use `shell: false` to prevent command injection.

### Fixed
- v1.0 used a Bash placeholder for `share`; now actually works.
- Lock directory is created on first use (would fail silently if the app dir didn't exist).
- Tunnel lifecycle no longer destroys cloudflared's stderr stream after URL acquisition (would SIGPIPE the tunnel).

### Security
- `shell: false` enforced for all child process spawns.
- User-supplied command arguments are passed through `args[]`, never interpolated into a shell command string.

## [1.0.0] — 2026-XX-XX (legacy)

Initial Bash prototype. Self-installing script with `start`, `stop`, `status`, `logs`, `doctor`. The `share` command was a placeholder.

Superseded by v1.1. Install via `npm install -g localzada` to upgrade.

[Unreleased]: https://github.com/YOUR_USERNAME/localzada/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/YOUR_USERNAME/localzada/releases/tag/v1.1.0

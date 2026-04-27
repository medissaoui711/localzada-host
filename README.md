<div align="center">

# Localzada

**Run and share local servers with one command.**

شغّل وشارك سيرفراتك المحلية بأمر واحد.

[![CI](https://github.com/medissaoui711/localzada-host/actions/workflows/ci.yml/badge.svg)](https://github.com/medissaoui711/localzada-host/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/localzada.svg)](https://www.npmjs.com/package/localzada)
[![Node.js Version](https://img.shields.io/node/v/localzada.svg)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

---

## Why Localzada?

You're tired of:

- Opening five terminals every morning to run your dev environment.
- Pasting `ngrok http 3000` and getting a different URL every restart, then updating Telegram/Stripe webhooks again.
- Forgetting which port `npm run dev` uses for which project.

Localzada is a single CLI that:

- **Runs** your local servers in the background, tracked by name and port.
- **Shares** them publicly via Cloudflare Tunnel — instantly with `share`, or with a stable subdomain via `tunnel up`.
- **Orchestrates** multi-process dev environments declaratively (`localzada.yaml`).

Built cross-platform (Linux, macOS, Windows). Written in TypeScript. Free for solo devs.

---

## Quick start

```bash
# Install
npm install -g localzada

# Run a local server in the background
localzada start --port 3000 -- npm run dev

# Share it publicly (requires cloudflared installed — run `localzada doctor` to check)
localzada share --port 3000

# See what's running
localzada status

# Stop everything
localzada stop --all
```

### Examples

```bash
# Start a dev server on port 3000
localzada start -p 3000 npm run dev

# With host flag (for Vite, etc.)
localzada start -p 3000 -- npm run dev -- --host

# Stop a specific session
localzada stop session-0345ae06
```

Short alias `lz` works everywhere `localzada` does.

---

## Commands

| Command | Description |
|---|---|
| `start --port <p> -- <cmd>` | Run a command in the background, tracked on a given port |
| `share --port <p>` | Open a Cloudflare Quick Tunnel to a local port |
| `unshare [id]` | Close a tunnel, keep the server running |
| `stop [id]` \| `stop --all` | Stop a session (or all of them) |
| `status` \| `list` \| `ls` | Show running sessions |
| `logs <id> [-f]` | Print or follow session logs |
| `doctor` | Check environment and dependencies |
| `config get/set/reset` | Manage configuration |

Run `localzada <command> --help` for full options.

---

## Plans

Localzada uses an **open core** model. All v1.1 commands are free forever.

| Feature | Free | Pro |
|---|:---:|:---:|
| `start`, `stop`, `status`, `logs`, `doctor` | ✓ | ✓ |
| Quick Tunnels (random `*.trycloudflare.com`) | ✓ | ✓ |
| Concurrent sessions | 2 | 10 |
| Concurrent tunnels | 1 | 5 |
| Named tunnels (stable subdomain on your domain) | ✗ | ✓ (v1.2) |
| Multi-service `localzada dev` | ✗ | ✓ (v1.2) |

> Pro features are in the [v1.2 spec](docs/v1.2-spec.md) and not yet released. v1.1 is fully functional as-is.

---

## Requirements

- **Node.js** ≥ 18
- **For `share`:** [cloudflared](https://github.com/cloudflare/cloudflared) on PATH

`localzada doctor` will tell you what's missing and how to install it.

---

## Storage

Localzada keeps runtime data under platform-specific directories:

| Path | Purpose |
|---|---|
| `~/.localzada/sessions.json` | Active session registry |
| `~/.localzada/logs/` | Per-session log files |
| `~/.localzada/*.lock` | File-based locks (auto-released) |

Config lives where the [`conf`](https://github.com/sindresorhus/conf) package places it:

| OS | Config path |
|---|---|
| Windows | `%APPDATA%\localzada-nodejs\config.json` |
| macOS | `~/Library/Preferences/localzada-nodejs/config.json` |
| Linux | `~/.config/localzada-nodejs/config.json` |

---

## Architecture

Localzada is intentionally small. The whole CLI is around 1500 LOC of TypeScript.

```
src/
├── cli.ts             # Commander entry, command wiring
├── commands/          # One file per command (start, stop, share, ...)
├── runner.ts          # Cross-platform process spawning + port checks
├── tunnel.ts          # Cloudflare Tunnel orchestration
├── sessions.ts        # Session registry (sessions.json)
├── lock.ts            # Atomic file-based locking with stale recovery
├── plan.ts            # Open core feature gates
├── config.ts          # User config (via `conf` package)
├── ui.ts              # Colored output helpers
├── cloudflared.ts     # cloudflared discovery + install instructions
└── yaml/              # v1.2: localzada.yaml schema + loader
    ├── schema.ts
    └── loader.ts
```

For deeper dives, see [`docs/architecture.md`](docs/architecture.md).

---

## Roadmap

- **v1.1** ✅ — `start`, `share` (Quick Tunnel), `stop`, `status`, `logs`, `doctor`
- **v1.2.0** 🚧 — `localzada dev` multi-process orchestrator with `localzada.yaml`
- **v1.2.1** 📋 — Named tunnels with stable subdomains
- **v1.3** 📋 — License server, Stripe billing, plan enforcement

Full v1.2 spec: [`docs/v1.2-spec.md`](docs/v1.2-spec.md).

---

## Contributing

PRs welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for development setup, coding style, and how to propose changes.

For security issues, please email instead of opening a public issue. See [`SECURITY.md`](SECURITY.md).

---

## License

[MIT](LICENSE) © 2026 Mohammed (Ai RawayieAldhaka)

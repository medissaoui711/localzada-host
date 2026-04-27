# Architecture

This doc explains how Localzada is built so you can extend it without breaking concurrency or cross-platform behavior.

> Audience: contributors, security reviewers, future-you in six months.

## High-level shape

Localzada is a CLI that:

1. Spawns user-supplied commands as detached background processes.
2. Tracks them in a JSON registry on disk (`~/.localzada/sessions.json`).
3. Optionally exposes them publicly via Cloudflare Tunnel (delegating to the `cloudflared` binary).

There is no daemon, no socket, no IPC. Every `localzada` invocation reads the registry, does its work, writes back, and exits. State is the registry plus the actual OS processes.

```
            ┌────────────────────────┐
            │   CLI invocation       │
            │  (one-shot, exits)     │
            └─────────┬──────────────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
        ▼             ▼             ▼
   ┌─────────┐   ┌─────────┐   ┌──────────┐
   │ commands│   │  lock   │   │ sessions │
   │         │──▶│         │──▶│   .json  │
   └────┬────┘   └─────────┘   └──────────┘
        │
        ▼
   ┌─────────┐
   │ runner  │── spawn detached ──▶ (user's dev server)
   └────┬────┘
        │
        ▼
   ┌─────────┐
   │ tunnel  │── spawn detached ──▶ (cloudflared)
   └─────────┘
```

## Module map

| Module | Responsibility | Key invariants |
|---|---|---|
| `cli.ts` | Commander wiring, signal handlers | No business logic; just routes args to commands/ |
| `commands/*.ts` | One file per CLI subcommand | Each exports a function that returns an exit code |
| `runner.ts` | `spawn`, port checks, process tree kill | All spawns use `shell: false` |
| `tunnel.ts` | Cloudflare Quick Tunnel lifecycle | Never destroys cloudflared's stderr after URL acquisition |
| `sessions.ts` | Read/write `sessions.json`, PID liveness check | All mutations under lock (callers must wrap) |
| `lock.ts` | Atomic file lock with stale-PID recovery | Locks are PID-tagged and reclaimed when owner is dead |
| `plan.ts` | Open core feature gates | Pure functions, no side effects |
| `config.ts` | User config via `conf` package | Cross-platform paths handled by `conf` |
| `cloudflared.ts` | Detect cloudflared on PATH or bundled | Pure detection; no side effects beyond child spawns |
| `ui.ts` | Colored output, formatters | `dim()` prints; `gray()`/`code()`/`url()` return strings |
| `yaml/schema.ts` | Zod schema for `localzada.yaml` (v1.2) | Strict on shape; cross-field rules in `.refine()` |
| `yaml/loader.ts` | Discover + load + validate YAML | Discovery stops at `.git` boundary |

## Concurrency model

Localzada is invoked by users running multiple terminals at once. Race conditions are real and have happened in development.

### What's shared between processes

- `~/.localzada/sessions.json` — the session registry.
- `~/.localzada/*.lock` — lock files.
- The OS process table — when one CLI invocation reads `pid: 12345` from the registry, another might be killing it concurrently.

### Locking discipline

Two named locks today:

| Lock | Held by | Purpose |
|---|---|---|
| `sessions` | `start`, `stop`, `share`, `unshare` | Protects the read-modify-write cycle on `sessions.json` |
| `port-<N>` | `start` | Prevents two concurrent `start` calls on the same port from both succeeding |

Read-only commands (`status`, `logs`) **do not take locks**. Rationale: `loadSessions()` reads atomically with `readFileSync`. If a write is mid-flight and we get a partial JSON, `JSON.parse` throws and `loadSessions` returns `[]`. We see a stale snapshot at worst, never corrupted state.

### Lock implementation

Atomic create-exclusive via `fs.openSync(path, 'wx')`. The lock file contains the owner's PID. On acquire:

1. If the lock file doesn't exist → create it with our PID.
2. If it exists → read the PID. If the PID is dead (`process.kill(pid, 0)` throws ESRCH) → reclaim. Otherwise throw `LockError`.
3. The race between "checked, file didn't exist" and "tried to create, EEXIST" is handled by the `wx` flag, which is atomic on Linux/macOS/Windows.

### Why not `proper-lockfile`?

`proper-lockfile` is excellent but adds a dependency for ~80 lines of logic we'd write anyway. We may switch in v1.3 if we need NFS support; for local-only use the inline implementation suffices.

## Process lifecycle

### `start`

1. Acquire `port-<N>` lock (fast fail for double-starts on same port).
2. Acquire `sessions` lock.
3. Reconcile sessions — mark dead PIDs as `crashed`.
4. Check plan limit on running sessions.
5. Check OS-level port-in-use (a non-Localzada process might have it).
6. Spawn detached: `shell: false`, stdio redirected to a log file, child gets `unref()`.
7. Persist the session record.
8. Release both locks.

The user's process now lives independently — if our CLI crashes mid-way, the spawned process keeps running and `status` will pick it up next time (or mark it as orphaned if `sessions.json` wasn't written).

### `stop`

1. Acquire `sessions` lock briefly to find the target session.
2. **Release the lock** before killing.
3. `tree-kill` the PID (sends SIGTERM, then SIGKILL after grace period).
4. Re-acquire `sessions` lock to update status.

Killing happens *outside* the lock because:
- It can take seconds for stubborn processes.
- During those seconds, `status` should still respond.
- The PID isn't reused mid-call (Linux PID reuse takes minutes; we're milliseconds).

### `share`

1. Find cloudflared (PATH first, then bundled location).
2. Spawn `cloudflared tunnel --url http://localhost:PORT`.
3. **Critical:** read stderr until we see a `*.trycloudflare.com` URL. Then **pipe** stderr to the log file (don't destroy it). Destroying stderr after `unref()` SIGPIPEs cloudflared and kills the tunnel.
4. `unref()` the child.
5. Persist tunnel info under the `sessions` lock.

## Cross-platform considerations

| Concern | How we handle it |
|---|---|
| Paths | Always `node:path` `join`/`resolve`. Never string concat. |
| Home dir | `node:os` `homedir()`. Never `$HOME`. |
| Process tree kill | `tree-kill` package (uses `taskkill /T /F` on Windows). |
| File locks | `fs.openSync` with `'wx'` is atomic on all three OSes. |
| Signals | Only SIGINT and SIGTERM. POSIX-only signals (SIGUSR1 etc) are off-limits. |
| Detached children | `detached: true, windowsHide: true` plus `unref()`. |

## Where to look when something breaks

| Symptom | Look at |
|---|---|
| "Tunnel disconnects after a few seconds" | `tunnel.ts` — usually a lifecycle bug (destroyed stderr, premature unref, etc) |
| "Two start commands on same port both succeed" | `lock.ts` — check that `port-<N>` lock is being acquired |
| "sessions.json contains stopped sessions forever" | `sessions.ts` `reconcileSessions()` — check PID liveness logic |
| "Locks left behind after crash" | `lock.ts` `acquireLock()` — stale recovery checks PID liveness |
| "Won't run on Windows" | `runner.ts` — check `shell: false` + `windowsHide: true`; check signals |

## Things we deliberately did not build

- **No daemon.** Adds installation complexity and a new failure mode (daemon crashed).
- **No IPC between CLI invocations.** The registry on disk is the IPC.
- **No process supervision (auto-restart).** Localzada surfaces failures; it doesn't loop-restart. Use a real process manager (pm2, systemd, supervisord) if that's what you need.
- **No HTTP API on top of the registry.** A future version could expose one over a Unix socket, but it's not part of the v1.x scope.

These are not features; they're scope boundaries. Crossing them changes Localzada into something else.

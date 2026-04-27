# Concurrency

A short tour of the race conditions Localzada had to solve, and how we solved them.

> Read this before changing anything in `lock.ts`, `sessions.ts`, or any command that mutates `sessions.json`.

## Why this matters

Localzada is a CLI users invoke from multiple terminals. There is no daemon to serialize requests. Every invocation is a new process that:

1. Reads `sessions.json` from disk.
2. Decides what to do.
3. Writes back.

Without locks, two concurrent invocations can interleave their reads and writes, producing a registry that's inconsistent with reality.

## Races we observed during development

### Race 1: Two `start` commands on the same port

```
Time  Terminal A                          Terminal B
──────────────────────────────────────────────────────
t0    start --port 3000 -- npm run dev
t1    [check port 3000: free]              start --port 3000 -- npm run dev
t2    [spawn process A, PID 100]           [check port 3000: free]   ← LIES
t3    [write sessions.json: A]
t4                                         [spawn process B, PID 200]
t5                                         [write sessions.json: B]   ← overwrites A
```

Final state: `sessions.json` has only B. PID 100 is orphaned — we lost track of it. Both processes are now fighting over port 3000.

**Fix:** A `port-<N>` lock acquired by `start` before any other check. The first acquirer wins; the second sees `LockError` and exits cleanly with a message naming the lock holder.

### Race 2: `status` during a write

```
Time  Terminal A (start)                  Terminal B (status)
────────────────────────────────────────────────────────────
t0    [load sessions.json]
t1                                          [load sessions.json: still empty]
t2    [start succeeds]
t3    [write sessions.json: 50% done]
t4                                          [reading mid-write...]
t5    [write done]
```

If B reads a half-written file, `JSON.parse` throws.

**Fix:** B's `loadSessions()` catches the parse error and returns `[]`. The user sees "no sessions" instead of a crash. Next `status` call works fine. This is acceptable because `status` is read-only and idempotent.

We do *not* lock for reads. Locking every read would mean `status` blocks waiting for `start` to finish — bad UX for a status command.

### Race 3: `stop` while another command updates the same session

```
Time  Terminal A (stop session-foo)        Terminal B (share --session foo)
────────────────────────────────────────────────────────────────
t0    [load: foo is running]
t1                                          [load: foo is running]
t2    [kill foo's PID]
t3                                          [open tunnel for foo]   ← tunnel pointing at dead process
t4    [remove foo from registry]
t5                                          [write: foo with tunnel]   ← resurrects deleted session
```

**Fix:** The `sessions` lock is held during both reads and writes of the registry. Both A and B serialize. The second one to acquire the lock sees the actual current state.

The kill itself happens *outside* the lock — see "Lock granularity" below.

## Lock granularity rules

Locks are expensive — they serialize work. We want them held as briefly as possible.

| Operation | Lock held? | Why |
|---|---|---|
| `loadSessions()` (read) | No | Read is atomic via `readFileSync`. If parse fails, return `[]`. |
| Plan-limit check | Yes (sessions lock) | Reads sessions count, must not race with another start writing |
| Port-in-use check | Yes (sessions lock + port lock) | Cross-references registry and OS state |
| Spawning a child process | Yes (port lock; sessions lock optional) | Want the spawn to be atomic with the registry write |
| Writing sessions.json | Yes (sessions lock) | Required |
| Killing a process | **No** | Slow operation, doesn't touch registry |
| Following logs (`logs -f`) | No | Read-only, runs indefinitely |

The pattern is: **lock the registry mutation, not the side effect.** Killing is a side effect on the OS; updating "this session is stopped" in the registry is the mutation.

## Stale lock recovery

If the lock-holding process crashes (kill -9, OOM, panic), the lock file lingers. New invocations would block forever without recovery.

Our recovery:

1. Read the PID stored in the lock file.
2. Check if PID is alive via `process.kill(pid, 0)`. ESRCH means dead.
3. If dead, reclaim the lock.
4. If alive, throw `LockError` — the holder is genuinely working.

This is safe because:

- The PID-in-file check is atomic (one syscall).
- PID reuse takes minutes on Linux, hours on macOS. Our locks are held for milliseconds.
- We don't trust the lock contents blindly — invalid or unparseable contents are also reclaimed.

## Things that are still not handled

These are known gaps, mostly minor:

1. **Two `stop --all` running concurrently** can both decide to kill the same session. Result is still correct (idempotent: SIGTERM to a dead process is a no-op), but you might see two "Stopped" messages for the same session. Acceptable.

2. **Lock starvation under contention.** If 50 invocations all want the `sessions` lock, ordering is whatever the OS scheduler decides. Not fair, not FIFO. In practice, contention is 2-3 invocations max from one user.

3. **Network filesystems (NFS).** Our locks rely on local filesystem semantics. If `~/.localzada/` is on NFS, behavior is undefined. We don't claim to support that.

4. **Cross-host coordination.** A user with two laptops sharing `~/.localzada/` over Dropbox could absolutely break things. Don't do that.

## Testing concurrency

The reproducible race test from development:

```bash
# In one terminal:
(localzada start --port 9001 --name a -- node -e "require('http').createServer((q,s)=>s.end()).listen(9001)" 2>&1 | sed 's/^/[A] /' &) && \
(localzada start --port 9001 --name b -- node -e "require('http').createServer((q,s)=>s.end()).listen(9001)" 2>&1 | sed 's/^/[B] /' &) && \
sleep 2 && localzada status
```

Expected output: one of A/B succeeds, the other fails with a clear "lock held by PID X" message. `status` shows exactly one session.

We'll formalize this into Vitest scenarios in v1.3.

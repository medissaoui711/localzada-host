# Contributing to Localzada

Thanks for your interest in Localzada. This document explains how to contribute productively.

## Ground rules

1. **Open an issue before a large PR.** Small fixes (typos, obvious bugs) can go straight to PR. Anything bigger — a new command, a refactor, a behavior change — discuss in an issue first so we don't waste your time.
2. **One change per PR.** Easier to review, easier to revert.
3. **Tests pass on your branch.** `npm test` must be green.

## Development setup

```bash
git clone https://github.com/YOUR_USERNAME/localzada.git
cd localzada
npm install

# Run the CLI in dev mode (no build step)
npm run dev -- --help

# Run the test suite
npm test

# Build for production
npm run build

# Try the built binary
node dist/cli.js doctor
```

We require **Node.js ≥ 18**. The CI matrix tests against Node 18, 20, and 22.

## Project structure

```
src/                  Source code (TypeScript)
  cli.ts              Entry point — Commander wiring only
  commands/           One file per CLI subcommand
  runner.ts           Process spawning, port checks, kill helpers
  tunnel.ts           Cloudflare Tunnel lifecycle
  lock.ts             File-based locks (atomic, with stale recovery)
  sessions.ts         Session registry (sessions.json)
  plan.ts             Free/Pro feature gates
  yaml/               v1.2 — localzada.yaml schema and loader

scripts/              Test runners and dev tooling (not shipped to npm)
docs/                 Long-form architecture and spec docs
examples/             Sample localzada.yaml files
.github/              CI workflows, issue/PR templates
```

## Coding conventions

### TypeScript

- **Strict mode is non-negotiable.** `tsconfig.json` has `strict: true`, `noUnusedLocals`, and `noImplicitReturns` on. Keep them on.
- **No `any`.** Use `unknown` and narrow it. If you genuinely need an escape hatch, leave a comment explaining why.
- **ESM only.** All imports use `.js` extensions (yes, even though the source is `.ts` — this is the ESM/TypeScript convention).

### Style

- Two-space indent, single quotes, trailing commas. Enforced by `.editorconfig` and (in v1.3) Prettier.
- Prefer `const` over `let`. Prefer `for...of` over `forEach` when you might `await` or `break`.
- Functions should do one thing. If a function in `commands/` exceeds ~80 lines, extract helpers.

### Errors

- **Throw typed errors, not strings.** `LockError`, `YamlValidationError`, etc.
- **User-facing messages should be actionable.** "X is not installed. Install it via: ..." is better than "X not found."
- **Exit codes matter.** See `EXIT` constants in `src/constants.ts`. Pick the most specific one.

### Comments

- **Comment intent, not mechanics.** `// increment counter` is noise. `// We retry once because cloudflared sometimes drops the first connection mid-handshake` is gold.
- Bilingual (English/Arabic) comments are welcome on user-facing strings or anything where Arabic context helps. Code comments stay English.

## Concurrency rules

Localzada is a multi-process CLI. State lives in `sessions.json` and `~/.localzada/`. Race conditions are real.

- **Any code path that reads `sessions.json`, decides something, then writes back must hold a lock.** Use `withLock('sessions', ...)` from `src/lock.ts`.
- **Don't hold locks across slow operations.** Killing a process can take seconds; reading config takes microseconds. Lock the second, not the first. See `commands/stop.ts` for the pattern.
- **Process spawns use `shell: false`.** Always. We pass user commands through as args; we never let the shell parse them. This prevents command injection from malicious YAML or args.

## Cross-platform expectations

We support Linux, macOS, and Windows (native, not just WSL). When you write code:

- **Use `node:path`'s `join` and `resolve`.** No string concatenation of paths.
- **Use `node:os` `homedir()`.** Never `$HOME` directly.
- **Test on Windows if you touch:** process spawning, signals, file locks, paths.
- **Don't rely on POSIX-only behavior.** No fork+exec patterns, no signals beyond SIGINT/SIGTERM.

If you can't test on a given OS, say so in the PR description. Maintainers can help.

## Tests

v1.2 uses lightweight `tsx`-based test scripts in `scripts/`. We're migrating to **Vitest in v1.3**. Until then:

- Add test cases to `scripts/test-yaml.ts` (or create a new `scripts/test-<name>.ts`) that follow the existing pattern.
- Each test should be self-contained (uses `mkdtempSync` for tmp files, cleans up after).
- Run `npm test` before pushing. CI will catch you anyway, but local feedback is faster.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(yaml): support .yml extension as alias
fix(lock): handle missing app dir on first run
docs(readme): clarify cloudflared install steps
chore(deps): bump zod to 4.4
test(loader): cover diamond dependsOn graph
```

Allowed types: `feat`, `fix`, `docs`, `chore`, `test`, `refactor`, `perf`, `ci`.

Scope is the affected area (yaml, lock, runner, share, etc.) — keep it short.

## Pull request checklist

Before submitting:

- [ ] `npm test` passes locally
- [ ] `npm run build` succeeds with no TypeScript errors
- [ ] You added or updated tests for behavior changes
- [ ] You updated docs if you changed public CLI surface
- [ ] Your commits follow Conventional Commits
- [ ] You updated `CHANGELOG.md` under "Unreleased"

## Releases

Maintainer-only:

```bash
npm version patch    # or minor / major
git push --follow-tags
# CI builds and publishes to npm
```

## Questions?

Open a [Discussion](https://github.com/YOUR_USERNAME/localzada/discussions) or comment on an existing issue. Shipping software solo is hard; collaboration is welcome.

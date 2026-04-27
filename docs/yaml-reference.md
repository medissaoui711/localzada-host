# `localzada.yaml` reference

Companion to v1.2 spec. This is the schema users will write against.

## Minimal example

```yaml
version: 1
profile: my-app

services:
  app:
    cmd: npm run dev
    port: 3000
```

That's it. No tunnel, no env, no health checks. Equivalent to:

```bash
localzada start --port 3000 --name app -- npm run dev
```

## Full example with all features

```yaml
version: 1                          # required, currently always 1
profile: qanunai                    # required, used for group naming

# --- services ---
services:
  api:                              # service name (key)
    cmd: uvicorn main:app --port 8000   # required
    port: 8000                          # optional but needed for waitFor: tcp
    cwd: ./backend                       # optional, default: project root
    env:                                 # optional, merged with shell env
      DATABASE_URL: postgresql://localhost/qanunai_dev
      LOG_LEVEL: debug
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}    # interpolated from shell
    waitFor: tcp                         # none | tcp | http
    healthTimeout: 30s                   # how long to wait for healthy
    # If waitFor: http, also set:
    # healthPath: /healthz

  worker:
    cmd: python worker.py
    dependsOn: [api]                     # array of service names
    env:
      QUEUE_URL: redis://localhost:6379

  telegram-bot:
    cmd: python bot.py
    dependsOn: [api]
    env:
      WEBHOOK_URL: https://qanunai-dev.example.dev/webhook

# --- tunnel (optional) ---
tunnel:
  type: named                            # named | quick
  hostname: qanunai-dev.example.dev      # required if type=named
  service: http://localhost:8000         # what to expose
  startWith: api                         # wait for this service to be healthy
                                          # (defaults to first service in topo order)

# --- environment loading (optional) ---
env:
  load:                                  # files to source before spawning
    - .env
    - .env.development
  inherit: true                          # also pass through shell env (default true)
```

## Field reference

### Top level

| Field | Type | Required | Description |
|---|---|---|---|
| `version` | int | yes | Schema version. Always `1` in v1.2. |
| `profile` | string | yes | Group name. Used in logs, `localzada status --group`, etc. |
| `services` | map | yes | At least one service required. |
| `tunnel` | object | no | If present, opens automatically with `localzada dev`. |
| `env` | object | no | Project-wide env handling. |

### `services.<name>`

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `cmd` | string | yes | — | Command to run. Parsed with shell-quote rules; no shell expansion. |
| `port` | int | no | — | Local port. Required if `waitFor: tcp`. |
| `cwd` | string | no | `.` | Working directory, relative to `localzada.yaml`. |
| `env` | map | no | `{}` | Per-service env vars. Merged on top of project `env`. |
| `dependsOn` | string[] | no | `[]` | Names of services that must be healthy first. |
| `waitFor` | enum | no | `none` | `none` \| `tcp` \| `http` |
| `healthTimeout` | duration | no | `30s` | `5s`, `1m`, `90s` etc. |
| `healthPath` | string | no | `/` | Used when `waitFor: http`. |

### `tunnel`

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | enum | no | `named` \| `quick`. Default: `named` if hostname is set, else `quick`. |
| `hostname` | string | conditional | Required for `named`. Must be a DNS name in a zone the active CF account owns. |
| `service` | string | yes | The local URL to expose, e.g. `http://localhost:8000`. |
| `startWith` | string | no | Service name to wait for. Default: first in topo order. |

### `env`

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `load` | string[] | no | `[]` | Dotenv-format files to load. Files later in the list override earlier ones. |
| `inherit` | bool | no | `true` | Whether to pass shell env through to children. |

## Variable interpolation

`${VAR}` in any string field is replaced from the merged env at load time.
Missing variables → spec validation fails with a clear "Required env var X is not set."

To use a literal `${...}` (e.g. in a regex), escape with `$${...}`.

## Validation

`localzada` validates the file against this schema before doing anything else. Errors print line numbers when possible.

Examples of errors caught at load:
- Cyclic `dependsOn`.
- `dependsOn` referencing an undefined service.
- `tunnel.hostname` not a valid DNS name.
- `waitFor: tcp` without `port`.
- Unknown top-level keys (warns, doesn't fail — forward compat).

## Plan-based limits (enforced at runtime, not parse time)

The schema accepts any number of services and any tunnel type. Limits are checked when `localzada dev` actually runs:

| Limit | Free | Pro |
|---|---|---|
| Services per profile | 3 | 5 |
| Concurrent service groups | 2 | 5 |
| `tunnel.type: quick` | ✓ | ✓ |
| `tunnel.type: named` | ✗ | ✓ |

If your YAML defines 4 services on the free plan, parse succeeds — but `localzada dev` will refuse to start with a clear "Plan free supports up to 3 services; this profile has 4. Upgrade to pro or remove a service."

This separation is intentional: YAML files should be portable across plans without rewriting.

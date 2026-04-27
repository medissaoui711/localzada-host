/**
 * Zod schema for localzada.yaml — single source of truth.
 * مرجع unique للـ schema
 *
 * Validation philosophy:
 *   - Be strict on shape (unknown top-level keys warn but don't fail).
 *   - Be permissive on values until they actually run (e.g. accept any
 *     command string; only check it can spawn at runtime).
 *   - Cross-field invariants (e.g. waitFor: tcp requires port) are checked
 *     in refine() blocks AFTER basic shape validation.
 */

import { z } from 'zod';

// ---- Primitives ----

/** Service name: lowercase, alphanumeric + hyphens, 1-32 chars. */
const ServiceName = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z][a-z0-9-]*$/, {
    message: 'Service names must be lowercase letters, digits, and hyphens; must start with a letter',
  });

/** Profile name: same rules as service name but more lenient on length. */
const ProfileName = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/);

/** Duration string like "30s", "5m", "1h". Returns ms. */
const Duration = z.string().regex(/^\d+(ms|s|m|h)$/).transform((s): number => {
  const match = /^(\d+)(ms|s|m|h)$/.exec(s);
  if (!match) throw new Error('unreachable: regex enforces shape');
  const value = parseInt(match[1]!, 10);
  const unit = match[2]!;
  switch (unit) {
    case 'ms': return value;
    case 's': return value * 1000;
    case 'm': return value * 60_000;
    case 'h': return value * 3_600_000;
    default: throw new Error(`unreachable: unit ${unit}`);
  }
});

/** TCP port: 1-65535. */
const Port = z.number().int().min(1).max(65535);

/** Hostname: at least one dot, no protocol prefix, no trailing slash. */
const Hostname = z
  .string()
  .min(3)
  .max(253)
  .regex(/^(?!https?:\/\/)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i, {
    message: 'Hostname must be a bare DNS name (no scheme, no path), e.g. "app.example.dev"',
  });

/** http(s)://host[:port][/path] URL. */
const ServiceUrl = z
  .string()
  .regex(/^https?:\/\/[a-z0-9.-]+(:\d+)?(\/.*)?$/i, {
    message: 'service must be an http(s) URL like "http://localhost:8000"',
  });

// ---- Service definition ----

const ServiceWaitFor = z.enum(['none', 'tcp', 'http']);

const ServiceConfig = z
  .object({
    cmd: z.string().min(1, 'cmd is required'),
    port: Port.optional(),
    cwd: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    dependsOn: z.array(ServiceName).optional().default([]),
    waitFor: ServiceWaitFor.optional().default('none'),
    healthTimeout: Duration.optional(),
    healthPath: z.string().startsWith('/').optional().default('/'),
  })
  .strict() // unknown service-level keys = error (catches typos like "command:" instead of "cmd:")
  .refine((s) => !(s.waitFor === 'tcp' && s.port == null), {
    message: 'waitFor: tcp requires `port` to be set on this service',
    path: ['waitFor'],
  });

// ---- Tunnel block ----

const TunnelType = z.enum(['quick', 'named']);

const TunnelConfigBase = z
  .object({
    type: TunnelType.optional(),
    hostname: Hostname.optional(),
    service: ServiceUrl,
    startWith: ServiceName.optional(),
  })
  .strict();

/**
 * tunnel.type defaults:
 *   - if hostname is set → named
 *   - else → quick
 */
const TunnelConfig = TunnelConfigBase.transform((t) => ({
  ...t,
  type: t.type ?? (t.hostname ? ('named' as const) : ('quick' as const)),
})).refine(
  (t) => !(t.type === 'named' && !t.hostname),
  { message: 'tunnel.type: named requires `hostname`', path: ['hostname'] },
);

// ---- Env block ----

const EnvConfig = z
  .object({
    load: z.array(z.string()).optional().default([]),
    inherit: z.boolean().optional().default(true),
  })
  .strict();

// ---- Top-level YAML ----

export const LocalzadaYamlSchema = z
  .object({
    version: z.literal(1, { message: 'version must be 1 (only supported version in v1.2)' }),
    profile: ProfileName,
    services: z.record(ServiceName, ServiceConfig).refine(
      (services) => Object.keys(services).length >= 1,
      { message: 'At least one service is required' },
    ),
    tunnel: TunnelConfig.optional(),
    env: EnvConfig.optional().default({ load: [], inherit: true }),
  })
  .strict()
  // Cross-field validations
  .refine(
    (cfg) => {
      // Every dependsOn entry must reference a defined service
      const names = new Set(Object.keys(cfg.services));
      for (const [, svc] of Object.entries(cfg.services)) {
        for (const dep of svc.dependsOn ?? []) {
          if (!names.has(dep)) return false;
        }
      }
      return true;
    },
    {
      message: 'A service depends on another service that is not defined',
      path: ['services'],
    },
  )
  .refine(
    (cfg) => {
      // No cycles in dependsOn
      return !hasCycle(cfg.services);
    },
    {
      message: 'Cyclic dependsOn detected — services cannot depend on each other in a loop',
      path: ['services'],
    },
  )
  .refine(
    (cfg) => {
      // tunnel.startWith must reference an existing service
      if (cfg.tunnel?.startWith == null) return true;
      return Object.prototype.hasOwnProperty.call(cfg.services, cfg.tunnel.startWith);
    },
    {
      message: 'tunnel.startWith references a service that is not defined',
      path: ['tunnel', 'startWith'],
    },
  );

export type LocalzadaYaml = z.infer<typeof LocalzadaYamlSchema>;
export type ServiceDef = LocalzadaYaml['services'][string];
export type TunnelDef = NonNullable<LocalzadaYaml['tunnel']>;

// ---- Helpers ----

function hasCycle(services: Record<string, { dependsOn?: string[] }>): boolean {
  // Standard DFS-based cycle detection: WHITE / GRAY / BLACK colors.
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color: Record<string, number> = {};
  for (const name of Object.keys(services)) color[name] = WHITE;

  function visit(name: string): boolean {
    if (color[name] === GRAY) return true; // back edge → cycle
    if (color[name] === BLACK) return false;
    color[name] = GRAY;
    const deps = services[name]?.dependsOn ?? [];
    for (const dep of deps) {
      // dep may not exist; the previous refine catches that — here we just skip
      if (!(dep in services)) continue;
      if (visit(dep)) return true;
    }
    color[name] = BLACK;
    return false;
  }

  for (const name of Object.keys(services)) {
    if (color[name] === WHITE && visit(name)) return true;
  }
  return false;
}

/**
 * Topologically sort services.
 * Returns service names in startup order (deps first).
 * Caller MUST validate the schema first — this assumes no cycles, no missing deps.
 */
export function topoSort(services: Record<string, { dependsOn?: string[] }>): string[] {
  const result: string[] = [];
  const visited = new Set<string>();

  function visit(name: string): void {
    if (visited.has(name)) return;
    visited.add(name);
    for (const dep of services[name]?.dependsOn ?? []) {
      if (dep in services) visit(dep);
    }
    result.push(name);
  }

  for (const name of Object.keys(services)) visit(name);
  return result;
}

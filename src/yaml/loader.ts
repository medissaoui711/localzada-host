/**
 * Discover and load localzada.yaml from the filesystem.
 * اكتشاف وتحميل ملف الإعدادات
 *
 * Discovery walks upward from cwd looking for `localzada.yaml`, stopping at:
 *   - filesystem root, OR
 *   - a directory containing `.git`, OR
 *   - a directory containing `package.json` (one level past, see below).
 *
 * The "one level past" detail: we *don't* stop at the first package.json,
 * because monorepos have package.json at every workspace level. We stop
 * when we'd be about to leave the project root entirely (e.g. crossed `.git`).
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import { LocalzadaYamlSchema, type LocalzadaYaml } from './schema.js';

export const YAML_FILENAME = 'localzada.yaml';
const ALT_FILENAME = 'localzada.yml'; // accept .yml as alias

export interface DiscoveryResult {
  /** Absolute path to the YAML file, or null if not found */
  path: string | null;
  /** Project root (directory containing the YAML or where we stopped looking) */
  projectRoot: string | null;
  /** How we stopped — useful for error messages */
  stoppedAt: 'found' | 'fs-root' | 'git-boundary';
}

/**
 * Walk upward from `startDir` to find a localzada.yaml file.
 * Pure function — does not throw on missing file, just returns null path.
 */
export function discoverYaml(startDir: string = process.cwd()): DiscoveryResult {
  let dir = resolve(startDir);
  const root = parse(dir).root;

  while (true) {
    const yamlPath = join(dir, YAML_FILENAME);
    const altPath = join(dir, ALT_FILENAME);

    if (existsSync(yamlPath)) {
      return { path: yamlPath, projectRoot: dir, stoppedAt: 'found' };
    }
    if (existsSync(altPath)) {
      return { path: altPath, projectRoot: dir, stoppedAt: 'found' };
    }

    // Stop if we just crossed a project boundary (.git is the strongest signal).
    if (existsSync(join(dir, '.git'))) {
      return { path: null, projectRoot: dir, stoppedAt: 'git-boundary' };
    }

    // Hit fs root → stop
    if (dir === root) {
      return { path: null, projectRoot: null, stoppedAt: 'fs-root' };
    }

    const parent = dirname(dir);
    if (parent === dir) {
      // Defensive: should be caught by `dir === root`, but on some platforms
      // dirname of root behaves oddly (Windows UNC paths, etc).
      return { path: null, projectRoot: null, stoppedAt: 'fs-root' };
    }
    dir = parent;
  }
}

// ---- Errors ----

export class YamlLoadError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'YamlLoadError';
  }
}

export class YamlValidationError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    public readonly issues: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = 'YamlValidationError';
  }
}

// ---- Loading ----

export interface LoadResult {
  /** Validated config */
  config: LocalzadaYaml;
  /** Absolute path of the file we loaded */
  filePath: string;
  /** Project root (directory of the YAML file) */
  projectRoot: string;
}

/**
 * Load and validate a localzada.yaml.
 * Throws YamlLoadError or YamlValidationError on failure.
 */
export function loadYaml(filePath: string): LoadResult {
  const absPath = isAbsolute(filePath) ? filePath : resolve(filePath);

  // Check file exists & is a regular file
  let stat;
  try {
    stat = statSync(absPath);
  } catch (err) {
    throw new YamlLoadError(
      `localzada.yaml not found at ${absPath}`,
      absPath,
      err,
    );
  }
  if (!stat.isFile()) {
    throw new YamlLoadError(
      `${absPath} is not a regular file`,
      absPath,
    );
  }

  // Read
  let raw: string;
  try {
    raw = readFileSync(absPath, 'utf-8');
  } catch (err) {
    throw new YamlLoadError(
      `Failed to read ${absPath}: ${(err as Error).message}`,
      absPath,
      err,
    );
  }

  // Parse YAML (this is where syntax errors surface, with line numbers)
  let parsed: unknown;
  try {
    parsed = parseYaml(raw, { strict: true });
  } catch (err) {
    if (err instanceof YAMLParseError) {
      throw new YamlLoadError(
        `YAML syntax error in ${absPath}:\n  ${err.message}`,
        absPath,
        err,
      );
    }
    throw new YamlLoadError(
      `Failed to parse ${absPath}: ${(err as Error).message}`,
      absPath,
      err,
    );
  }

  if (parsed == null || typeof parsed !== 'object') {
    throw new YamlLoadError(
      `${absPath} must contain a YAML mapping at the top level`,
      absPath,
    );
  }

  // Validate against schema
  const result = LocalzadaYamlSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((iss) => ({
      path: iss.path.length > 0 ? iss.path.join('.') : '<root>',
      message: iss.message,
    }));
    throw new YamlValidationError(
      `Invalid ${absPath}: ${issues.length} issue(s)`,
      absPath,
      issues,
    );
  }

  return {
    config: result.data,
    filePath: absPath,
    projectRoot: dirname(absPath),
  };
}

/**
 * Convenience: discover + load in one call.
 * Returns null if no YAML was found (caller decides if that's an error).
 */
export function discoverAndLoad(startDir?: string): LoadResult | null {
  const discovery = discoverYaml(startDir);
  if (!discovery.path) return null;
  return loadYaml(discovery.path);
}

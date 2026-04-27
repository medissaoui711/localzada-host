/**
 * Manual test cases for yaml/loader.ts and yaml/schema.ts
 * Run with: npx tsx scripts/test-yaml.ts
 *
 * This is intentionally NOT a Vitest suite — that's a v1.3 deliverable.
 * For now we just want fast feedback that the schema catches what it should.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  discoverYaml,
  loadYaml,
  YamlLoadError,
  YamlValidationError,
} from '../src/yaml/loader.js';
import { topoSort } from '../src/yaml/schema.js';

let pass = 0;
let fail = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${(err as Error).message}`);
    fail++;
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function expectThrows<T extends Error>(
  fn: () => unknown,
  ctor: new (...a: never[]) => T,
  msgIncludes?: string,
): T {
  try {
    fn();
  } catch (err) {
    assert(err instanceof ctor, `Expected ${ctor.name}, got ${(err as Error).constructor.name}: ${(err as Error).message}`);
    if (msgIncludes) {
      // For YamlValidationError, check issue messages too — they contain
      // the actual schema error, while the top-level message is a summary.
      const haystack = [
        (err as Error).message,
        ...((err as YamlValidationError).issues ?? []).map((i) => i.message),
      ].join(' | ');
      assert(
        haystack.includes(msgIncludes),
        `Expected message/issues to include "${msgIncludes}", got: ${haystack}`,
      );
    }
    return err;
  }
  throw new Error(`Expected ${ctor.name} but no error was thrown`);
}

// ---- Test fixtures ----

const tmpRoot = mkdtempSync(join(tmpdir(), 'localzada-test-'));

function writeYaml(name: string, content: string): string {
  const dir = join(tmpRoot, name);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, 'localzada.yaml');
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

console.log('\n=== Schema validation ===\n');

test('minimal valid yaml', () => {
  const path = writeYaml('minimal', `
version: 1
profile: my-app
services:
  app:
    cmd: npm run dev
    port: 3000
`);
  const { config } = loadYaml(path);
  assert(config.profile === 'my-app', 'profile parsed wrong');
  assert(config.services['app']!.cmd === 'npm run dev', 'cmd parsed wrong');
  assert(config.services['app']!.port === 3000, 'port parsed wrong');
});

test('rejects missing version', () => {
  const path = writeYaml('no-version', `
profile: app
services:
  api:
    cmd: x
`);
  expectThrows(() => loadYaml(path), YamlValidationError);
});

test('rejects unsupported version', () => {
  const path = writeYaml('bad-version', `
version: 99
profile: app
services:
  api:
    cmd: x
`);
  expectThrows(() => loadYaml(path), YamlValidationError, 'version must be 1');
});

test('rejects unknown top-level key (strict)', () => {
  const path = writeYaml('unknown-key', `
version: 1
profile: app
services:
  api:
    cmd: x
mystery: 42
`);
  expectThrows(() => loadYaml(path), YamlValidationError);
});

test('rejects unknown service-level key (typo guard)', () => {
  const path = writeYaml('typo', `
version: 1
profile: app
services:
  api:
    command: npm run dev
`);
  expectThrows(() => loadYaml(path), YamlValidationError);
});

test('rejects invalid service name (uppercase)', () => {
  const path = writeYaml('upper', `
version: 1
profile: app
services:
  API:
    cmd: x
`);
  expectThrows(() => loadYaml(path), YamlValidationError);
});

test('rejects waitFor:tcp without port', () => {
  const path = writeYaml('tcp-no-port', `
version: 1
profile: app
services:
  api:
    cmd: x
    waitFor: tcp
`);
  expectThrows(() => loadYaml(path), YamlValidationError, 'waitFor: tcp requires');
});

test('rejects dependsOn referencing missing service', () => {
  const path = writeYaml('missing-dep', `
version: 1
profile: app
services:
  api:
    cmd: x
    dependsOn: [nonexistent]
`);
  expectThrows(() => loadYaml(path), YamlValidationError);
});

test('rejects cyclic dependsOn (a->b->a)', () => {
  const path = writeYaml('cycle', `
version: 1
profile: app
services:
  a:
    cmd: x
    dependsOn: [b]
  b:
    cmd: y
    dependsOn: [a]
`);
  expectThrows(() => loadYaml(path), YamlValidationError, 'Cyclic');
});

test('rejects self-loop dependsOn', () => {
  const path = writeYaml('self-loop', `
version: 1
profile: app
services:
  a:
    cmd: x
    dependsOn: [a]
`);
  expectThrows(() => loadYaml(path), YamlValidationError, 'Cyclic');
});

test('accepts diamond dependsOn (a->b, a->c, b->d, c->d)', () => {
  const path = writeYaml('diamond', `
version: 1
profile: app
services:
  a:
    cmd: x
  b:
    cmd: x
    dependsOn: [a]
  c:
    cmd: x
    dependsOn: [a]
  d:
    cmd: x
    dependsOn: [b, c]
`);
  const { config } = loadYaml(path);
  const order = topoSort(config.services);
  // a must come first; d must come last
  assert(order[0] === 'a', `expected a first, got ${order[0]}`);
  assert(order[order.length - 1] === 'd', `expected d last, got ${order[order.length - 1]}`);
  // b and c must both come before d
  assert(order.indexOf('b') < order.indexOf('d'), 'b must precede d');
  assert(order.indexOf('c') < order.indexOf('d'), 'c must precede d');
});

test('parses duration strings into ms', () => {
  const path = writeYaml('durations', `
version: 1
profile: app
services:
  api:
    cmd: x
    port: 3000
    waitFor: tcp
    healthTimeout: 90s
`);
  const { config } = loadYaml(path);
  assert(config.services['api']!.healthTimeout === 90_000, `expected 90000, got ${config.services['api']!.healthTimeout}`);
});

test('rejects invalid duration format', () => {
  const path = writeYaml('bad-duration', `
version: 1
profile: app
services:
  api:
    cmd: x
    port: 3000
    waitFor: tcp
    healthTimeout: 90 seconds
`);
  expectThrows(() => loadYaml(path), YamlValidationError);
});

console.log('\n=== Tunnel block ===\n');

test('tunnel.type defaults to named when hostname set', () => {
  const path = writeYaml('tunnel-named-default', `
version: 1
profile: app
services:
  api:
    cmd: x
    port: 8000
tunnel:
  hostname: app.example.dev
  service: http://localhost:8000
`);
  const { config } = loadYaml(path);
  assert(config.tunnel!.type === 'named', `expected named, got ${config.tunnel!.type}`);
});

test('tunnel.type defaults to quick when no hostname', () => {
  const path = writeYaml('tunnel-quick-default', `
version: 1
profile: app
services:
  api:
    cmd: x
    port: 8000
tunnel:
  service: http://localhost:8000
`);
  const { config } = loadYaml(path);
  assert(config.tunnel!.type === 'quick', `expected quick, got ${config.tunnel!.type}`);
});

test('rejects tunnel.type:named without hostname', () => {
  const path = writeYaml('tunnel-bad', `
version: 1
profile: app
services:
  api:
    cmd: x
    port: 8000
tunnel:
  type: named
  service: http://localhost:8000
`);
  expectThrows(() => loadYaml(path), YamlValidationError, 'requires `hostname`');
});

test('rejects tunnel.startWith referencing missing service', () => {
  const path = writeYaml('tunnel-bad-start', `
version: 1
profile: app
services:
  api:
    cmd: x
    port: 8000
tunnel:
  service: http://localhost:8000
  startWith: nonexistent
`);
  expectThrows(() => loadYaml(path), YamlValidationError);
});

test('rejects tunnel.hostname with scheme', () => {
  const path = writeYaml('tunnel-with-scheme', `
version: 1
profile: app
services:
  api:
    cmd: x
    port: 8000
tunnel:
  hostname: https://app.example.dev
  service: http://localhost:8000
`);
  expectThrows(() => loadYaml(path), YamlValidationError);
});

test('rejects tunnel.service without scheme', () => {
  const path = writeYaml('tunnel-bad-svc', `
version: 1
profile: app
services:
  api:
    cmd: x
    port: 8000
tunnel:
  hostname: app.example.dev
  service: localhost:8000
`);
  expectThrows(() => loadYaml(path), YamlValidationError);
});

console.log('\n=== Discovery ===\n');

test('discovery finds yaml in cwd', () => {
  const dir = join(tmpRoot, 'discovery-cwd');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'localzada.yaml'), 'version: 1\nprofile: x\nservices:\n  a:\n    cmd: x\n');
  const result = discoverYaml(dir);
  assert(result.path?.endsWith('localzada.yaml'), `expected to find yaml, got ${result.path}`);
  assert(result.stoppedAt === 'found');
});

test('discovery walks up to parent', () => {
  const root = join(tmpRoot, 'discovery-parent');
  const child = join(root, 'src', 'subdir');
  mkdirSync(child, { recursive: true });
  writeFileSync(join(root, 'localzada.yaml'), 'version: 1\nprofile: x\nservices:\n  a:\n    cmd: x\n');
  const result = discoverYaml(child);
  assert(result.path === join(root, 'localzada.yaml'), `expected ${root}/localzada.yaml, got ${result.path}`);
});

test('discovery stops at .git boundary', () => {
  // Create: tmpRoot/git-boundary/.git/  (no yaml here)
  //         tmpRoot/git-boundary/sub/   (search starts here)
  // and    tmpRoot/localzada.yaml       (should NOT be found — we stop at .git)
  const projRoot = join(tmpRoot, 'git-boundary');
  mkdirSync(join(projRoot, '.git'), { recursive: true });
  mkdirSync(join(projRoot, 'sub'), { recursive: true });
  writeFileSync(
    join(tmpRoot, 'localzada.yaml'),
    'version: 1\nprofile: should-not-find\nservices:\n  a:\n    cmd: x\n',
  );
  const result = discoverYaml(join(projRoot, 'sub'));
  assert(result.path === null, `expected null, got ${result.path}`);
  assert(result.stoppedAt === 'git-boundary');
});

test('discovery returns null if no yaml anywhere', () => {
  // Use a completely isolated tmpdir to avoid finding yaml from sibling tests
  const isolated = mkdtempSync(join(tmpdir(), 'localzada-isolated-'));
  try {
    const result = discoverYaml(isolated);
    assert(result.path === null, `expected null, got ${result.path}`);
  } finally {
    rmSync(isolated, { recursive: true, force: true });
  }
});

console.log('\n=== Error handling ===\n');

test('YamlLoadError when file does not exist', () => {
  expectThrows(() => loadYaml('/nonexistent/path/localzada.yaml'), YamlLoadError);
});

test('YamlLoadError on syntax error includes line info', () => {
  const path = writeYaml('syntax-error', `
version: 1
profile: app
services:
  api
    cmd: x
`);
  const err = expectThrows(() => loadYaml(path), YamlLoadError, 'YAML syntax');
  assert(err.path === path);
});

console.log('\n=== End-to-end realistic example (QanunAI) ===\n');

test('QanunAI-style yaml validates and topo-sorts correctly', () => {
  const path = writeYaml('qanunai', `
version: 1
profile: qanunai

services:
  api:
    cmd: uvicorn main:app --reload --port 8000
    port: 8000
    env:
      DATABASE_URL: postgresql://localhost/qanunai_dev
      LOG_LEVEL: debug
    waitFor: tcp
    healthTimeout: 30s

  worker:
    cmd: python worker.py
    dependsOn: [api]

  telegram-bot:
    cmd: python bot.py
    dependsOn: [api]

tunnel:
  type: named
  hostname: qanunai-dev.example.dev
  service: http://localhost:8000
  startWith: api

env:
  load:
    - .env
    - .env.development
  inherit: true
`);
  const { config } = loadYaml(path);
  assert(config.profile === 'qanunai');
  assert(Object.keys(config.services).length === 3);
  assert(config.tunnel?.type === 'named');
  assert(config.tunnel?.hostname === 'qanunai-dev.example.dev');

  const order = topoSort(config.services);
  assert(order[0] === 'api', `api should be first, got ${order[0]}`);
  assert(order.indexOf('worker') > order.indexOf('api'));
  assert(order.indexOf('telegram-bot') > order.indexOf('api'));
});

// ---- Cleanup & summary ----

rmSync(tmpRoot, { recursive: true, force: true });

console.log(`\n=== Results ===`);
console.log(`  Passed: ${pass}`);
console.log(`  Failed: ${fail}`);
console.log();

if (fail > 0) process.exit(1);

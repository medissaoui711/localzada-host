/**
 * `localzada logs` — print or tail logs of a session
 * متابعة سجلات الجلسة
 */

import { createReadStream, statSync, watch } from 'node:fs';
import { ui } from '../ui.js';
import { EXIT } from '../constants.js';
import { findSession } from '../sessions.js';

export interface LogsOptions {
  follow: boolean;
  lines: number;
}

export async function logsCommand(
  idOrName: string,
  opts: LogsOptions,
): Promise<number> {
  const session = findSession(idOrName);
  if (!session) {
    ui.error(`No session named "${idOrName}".`);
    return EXIT.NOT_FOUND;
  }

  try {
    statSync(session.logFile);
  } catch {
    ui.warn(`Log file not found yet: ${session.logFile}`);
    return EXIT.NOT_FOUND;
  }

  // Print last N lines
  await printTail(session.logFile, opts.lines);

  if (opts.follow) {
    ui.dim(`-- following ${session.logFile} (Ctrl+C to exit) --`);
    await followLogs(session.logFile);
  }

  return EXIT.OK;
}

async function printTail(file: string, lines: number): Promise<void> {
  const data = await readWholeFile(file);
  const split = data.split('\n');
  const tail = split.slice(-lines - 1).join('\n');
  process.stdout.write(tail);
  if (!tail.endsWith('\n')) process.stdout.write('\n');
}

function readWholeFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let acc = '';
    const stream = createReadStream(file, { encoding: 'utf-8' });
    stream.on('data', (chunk) => {
      acc += chunk;
    });
    stream.on('end', () => resolve(acc));
    stream.on('error', reject);
  });
}

function followLogs(file: string): Promise<void> {
  return new Promise((resolve) => {
    let lastSize = statSync(file).size;
    const watcher = watch(file, (eventType) => {
      if (eventType !== 'change') return;
      try {
        const newSize = statSync(file).size;
        if (newSize > lastSize) {
          const stream = createReadStream(file, {
            start: lastSize,
            end: newSize,
            encoding: 'utf-8',
          });
          stream.on('data', (chunk) => process.stdout.write(chunk));
          lastSize = newSize;
        } else if (newSize < lastSize) {
          // file was truncated
          lastSize = 0;
        }
      } catch { /* ignore transient errors */ }
    });

    process.on('SIGINT', () => {
      watcher.close();
      resolve();
    });
  });
}

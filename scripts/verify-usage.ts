/**
 * Independent recount of the usage the dashboard reports.
 *
 * It reads the persisted session logs directly, folds them with the same pure fold the plugin
 * uses, and prints the totals per provider and model. With `--cache <file>` it also compares the
 * result against the aggregate cache the Host wrote, which verifies the pipeline (enumeration,
 * signatures, folding) rather than the fold's arithmetic alone.
 *
 * A running Host also counts sessions that are not persisted yet, so a live session can make the
 * cached total larger than this recount; the comparison reports the difference instead of hiding it.
 *
 * Usage: node scripts/verify-usage.ts [--home <dsh home>] [--cache <usage-v1.json>]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { cacheTotals, parseCache } from '../packages/plugin/src/cache.ts';
import { foldSession, mergeInto, splitSeriesId, totalTokens, type BucketTotals, type UsageEventLike } from '../packages/plugin/src/fold.ts';

const SESSION_FILE = 'session.v4.jsonl.zstd';

/** First four bytes of a standard zstd frame. */
const FRAME_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/**
 * Decompress a whole session log.
 *
 * The JSONL backend appends one frame per durable batch, and Node's zstd API stops at the end of
 * the first frame, so the stream is split at frame boundaries and each frame is decoded on its
 * own. A candidate boundary that does not decode is not a boundary: the slice is extended to the
 * next one. Skippable frames are not expected in this format and are not handled.
 */
function decompressFrames(bytes: Buffer): Buffer {
  const parts: Buffer[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = bytes.indexOf(FRAME_MAGIC, start + FRAME_MAGIC.length);
    let decoded: Buffer | undefined;
    while (decoded === undefined) {
      try {
        decoded = zstdDecompressSync(bytes.subarray(start, end < 0 ? bytes.length : end));
      } catch (error) {
        if (end < 0) throw error;
        end = bytes.indexOf(FRAME_MAGIC, end + FRAME_MAGIC.length);
      }
    }
    parts.push(decoded);
    if (end < 0) break;
    start = end;
  }
  return Buffer.concat(parts);
}

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  const value = at < 0 ? undefined : process.argv[at + 1];
  return value ?? fallback;
}

function sessionLogs(root: string): string[] {
  const found: string[] = [];
  let workspaces: string[];
  try {
    workspaces = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => join(root, entry.name));
  } catch {
    return found;
  }
  for (const workspace of workspaces) {
    for (const entry of readdirSync(workspace, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = join(workspace, entry.name, SESSION_FILE);
      try {
        readFileSync(file);
        found.push(file);
      } catch {
        // A session directory without a persisted log is simply not counted here.
      }
    }
  }
  return found;
}

function eventsOf(file: string): UsageEventLike[] {
  const text = decompressFrames(readFileSync(file)).toString('utf8');
  const events: UsageEventLike[] = [];
  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    try {
      events.push(JSON.parse(line) as UsageEventLike);
    } catch {
      // A torn tail is not a reason to abandon the recount.
    }
  }
  return events;
}

function main(): void {
  const home = argument('home', join(homedir(), '.dsh'));
  const cachePath = argument('cache', join(home, 'profiles', 'desktop', '.cache', 'dsh-model-usage', 'usage-v1.json'));
  const logs = sessionLogs(join(home, 'sessions'));
  const buckets: BucketTotals = new Map();
  let unusable = 0;
  for (const file of logs) {
    const fold = foldSession(eventsOf(file));
    unusable += fold.unusable;
    mergeInto(buckets, fold.buckets);
  }

  const bySeries = new Map<string, { provider: string; model: string; tokens: number; requests: number }>();
  for (const series of buckets.values()) {
    for (const [id, totals] of series) {
      const row = bySeries.get(id) ?? { ...splitSeriesId(id), tokens: 0, requests: 0 };
      row.tokens += totalTokens(totals);
      row.requests += totals.requests;
      bySeries.set(id, row);
    }
  }
  const rows = [...bySeries.values()].sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model));
  const tokens = rows.reduce((sum, row) => sum + row.tokens, 0);
  const requests = rows.reduce((sum, row) => sum + row.requests, 0);

  console.log(`session logs      ${logs.length}`);
  console.log(`active buckets    ${buckets.size}`);
  console.log(`series            ${rows.length}`);
  console.log(`unattributed      ${unusable}`);
  console.log(`total tokens      ${tokens.toLocaleString('en-US')}`);
  console.log(`requests          ${requests.toLocaleString('en-US')}`);
  console.log('');
  console.log('provider'.padEnd(20) + 'model'.padEnd(34) + 'tokens'.padStart(16) + 'requests'.padStart(11));
  for (const row of rows) {
    console.log(row.provider.padEnd(20) + row.model.padEnd(34) + row.tokens.toLocaleString('en-US').padStart(16) + String(row.requests).padStart(11));
  }

  let cached: string | undefined;
  try {
    cached = readFileSync(cachePath, 'utf8');
  } catch {
    console.log(`\nno aggregate cache at ${cachePath}: nothing to compare yet.`);
    return;
  }
  const cache = parseCache(cached);
  if (cache === undefined) {
    console.log(`\nthe aggregate cache at ${cachePath} is unreadable or from another schema.`);
    process.exitCode = 1;
    return;
  }
  const fromCache = cacheTotals(cache);
  const tokenDelta = fromCache.tokens - tokens;
  const requestDelta = fromCache.requests - requests;
  console.log('');
  console.log(`cached tokens     ${fromCache.tokens.toLocaleString('en-US')} (delta ${tokenDelta >= 0 ? '+' : ''}${tokenDelta.toLocaleString('en-US')})`);
  console.log(`cached requests   ${fromCache.requests.toLocaleString('en-US')} (delta ${requestDelta >= 0 ? '+' : ''}${requestDelta.toLocaleString('en-US')})`);
  console.log(tokenDelta === 0 && requestDelta === 0
    ? 'the cached aggregate matches this recount exactly.'
    : 'A positive delta is a live session the cached aggregate counts and a file recount cannot see; a negative one is activity written after the last scan. Re-run both against an idle profile to compare them exactly.');
}

main();

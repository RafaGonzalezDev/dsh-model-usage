import type { UsageCorpusPort, UsagePersistencePort } from '../packages/plugin/src/aggregator.ts';
import type { UsageCacheStore } from '../packages/plugin/src/cache.ts';
import { bucketOf, seriesId, type UsageEventLike } from '../packages/plugin/src/fold.ts';

/** Cache store that keeps the file in memory and counts its traffic. */
export class MemoryCacheStore implements UsageCacheStore {
  text: string | undefined;
  reads = 0;
  writes = 0;

  async read(): Promise<string | undefined> {
    this.reads++;
    return this.text;
  }

  async write(text: string): Promise<void> {
    this.writes++;
    this.text = text;
  }
}

/** Corpus stub: every session is a fixed event list and every read is recorded. */
export class FakeCorpus implements UsageCorpusPort {
  readonly sessions = new Map<string, UsageEventLike[]>();
  readonly reads: string[] = [];
  failOn = new Set<string>();
  listCalls = 0;

  add(id: string, events: UsageEventLike[]): void {
    this.sessions.set(id, events);
  }

  async listSessions(): Promise<readonly { header: { id: string } }[]> {
    this.listCalls++;
    return [...this.sessions.keys()].map(id => ({ header: { id } }));
  }

  async readSession(sessionId: string): Promise<{ events: readonly UsageEventLike[] }> {
    this.reads.push(sessionId);
    if (this.failOn.has(sessionId)) throw new Error(`unreadable session ${sessionId}`);
    return { events: this.sessions.get(sessionId) ?? [] };
  }
}

/** Persistence stub: one revision per session, absent for a live-only session. */
export class FakePersistence implements UsagePersistencePort {
  private readonly entries = new Map<string, { revision: string; eventCount?: number; sizeBytes?: number }>();
  available = true;

  set(id: string, revision: string, counts: { eventCount?: number; sizeBytes?: number } = {}): void {
    this.entries.set(id, { revision, ...counts });
  }

  clear(id: string): void {
    this.entries.delete(id);
  }

  async list(): Promise<readonly { header: { id: string }; revision: string; eventCount?: number; sizeBytes?: number }[]> {
    if (!this.available) throw new Error('persistence unavailable');
    return [...this.entries].map(([id, entry]) => ({ header: { id }, ...entry }));
  }
}

const DEFAULT_USAGE = { inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadTokens: 40, reasoningTokens: 5 };

/** One model step at a given instant. */
export function step(time: number, provider = 'chatgpt-plan', model = 'gpt-6.1-sol', usage: Record<string, unknown> | null = DEFAULT_USAGE): UsageEventLike {
  return {
    type: 'assistant/message',
    time,
    data: {
      message: { role: 'assistant', source: { kind: 'model', provider, model } },
      ...(usage === null ? {} : { usage }),
    },
  };
}

/** One compaction summary at a given instant. */
export function compaction(time: number, provider = 'chatgpt-plan', model = 'gpt-6-astra'): UsageEventLike {
  return {
    type: 'compaction/summary',
    time,
    data: { provider, model, usage: { inputTokens: 1_000, outputTokens: 100, totalTokens: 1_100, cacheReadTokens: 0, reasoningTokens: 0 } },
  };
}

export { bucketOf, seriesId };

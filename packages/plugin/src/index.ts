import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-app-boot';
import type {} from '@deepseek-ai/dsh-session-persistence';
import type {} from '@deepseek-ai/dsh-session-query';
import { UsageAggregator } from './aggregator.ts';
import { createFileCacheStore } from './cache.ts';
import { ModelUsageService } from './service.ts';

export { ModelUsageService } from './service.ts';
export type { UsageQuery, UsageSnapshot, UsageSeries, UsageCell, UsageRangeDays } from './contracts.ts';

export const inject = ['profileContext', 'sessionQuery', 'sessionPersistence'];

/** Delay before the first pass, so boot never waits on a corpus scan. */
const FIRST_SCAN_DELAY_MS = 5_000;

/** Quiet period after a durability checkpoint before the corpus is re-checked. */
const RESCAN_DELAY_MS = 60_000;

export async function apply(ctx: Context): Promise<void> {
  const aggregator = new UsageAggregator({
    corpus: ctx.sessionQuery,
    persistence: ctx.sessionPersistence,
    listModels: async provider => ctx.get('llm')?.listModels(provider) ?? [],
    store: createFileCacheStore(join(ctx.profileContext.dir, '.cache', 'dsh-model-usage', 'usage-v1.json')),
  });
  const service = new ModelUsageService(ctx, aggregator);
  void service;
  const scan = (): void => { void aggregator.refresh().catch(() => {}); };
  ctx.effect(() => {
    const handle = setTimeout(scan, FIRST_SCAN_DELAY_MS);
    return () => clearTimeout(handle);
  }, 'model-usage: first scan');
  let pending: ReturnType<typeof setTimeout> | undefined;
  ctx.effect(() => {
    const off = ctx.on('session/flush', () => {
      if (pending !== undefined) clearTimeout(pending);
      pending = setTimeout(() => { pending = undefined; scan(); }, RESCAN_DELAY_MS);
    });
    return () => {
      off();
      if (pending !== undefined) clearTimeout(pending);
      pending = undefined;
    };
  }, 'model-usage: rescan after a checkpoint');
}

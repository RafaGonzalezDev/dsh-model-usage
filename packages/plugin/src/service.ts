import type { Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { UsageQuery, UsageSnapshot } from './contracts.ts';

/** The aggregate source the Remote serves; the dashboard never reads the corpus itself. */
export interface UsageSnapshotProvider {
  snapshot(query: UsageQuery, signal: AbortSignal): Promise<UsageSnapshot>;
}

declare module '@deepseek-ai/cordis' {
  interface Context { modelUsage: ModelUsageService }
}

/** Host service behind `ctx.remote.modelUsage`. */
export class ModelUsageService extends TypertRemoteService {
  constructor(ctx: Context, private readonly provider: UsageSnapshotProvider) { super(ctx, 'modelUsage'); }

  @Remote
  async snapshot(query: UsageQuery, signal: AbortSignal): Promise<UsageSnapshot> {
    return this.provider.snapshot(query, signal);
  }
}

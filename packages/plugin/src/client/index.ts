import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-remotes/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import { TYPERT_REMOTE } from 'dsh-model-usage/remote';
import type { UsageQuery, UsageSnapshot } from '../contracts.ts';
import { SidebarButton } from './SidebarButton.tsx';
import { UsagePanel } from './UsagePanel.tsx';
import { browserZone, createUsageHub } from './state.ts';
import { styles } from './styles.ts';

/** Main-panel key and sidebar entry id; both name the same view. */
const PANEL_ID = 'model-usage';

export const inject = ['slots', 'remote'];

export async function apply(ctx: Context): Promise<void> {
  const unmount = await ctx.remote.$mount(TYPERT_REMOTE);
  ctx.effect(() => () => unmount(), 'model-usage: RPC contribution');
  // The namespace is created by $mount; waiting for it in the entry's own inject
  // declaration would prevent that mount from ever running.
  ctx.inject(['slots', 'remote', 'remote.modelUsage'], applyPanel);
}

function applyPanel(ctx: Context): void {
  const selectPanel = (id: string | null): void => {
    (ctx.get('layout') as { selectPanel(panelId: string | null): void } | undefined)?.selectPanel(id);
  };
  const read = async (query: UsageQuery, signal: AbortSignal): Promise<UsageSnapshot | undefined> => {
    const result = await ctx.remote.modelUsage.snapshot(query, signal);
    return result.ok ? result.value : undefined;
  };
  const hub = createUsageHub({ read, zone: browserZone() });

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: PANEL_ID,
    inject: () => ({
      hooks: { usage: hub },
      load: (force?: boolean) => hub.load(force === true),
      setMetric: hub.setMetric,
      setQuery: hub.setQuery,
      back: () => selectPanel(null),
    }),
  }, UsagePanel));

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: PANEL_ID, order: 20,
    inject: () => ({ open: () => selectPanel(PANEL_ID) }),
  }, SidebarButton));

  ctx.effect(() => () => hub.dispose(), 'model-usage: hub');
  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.plugin = 'dsh-model-usage';
    style.textContent = styles;
    document.head.appendChild(style);
    return () => style.remove();
  }, 'model-usage: styles');
}

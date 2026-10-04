import { IconGaugeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import { copy } from './copy.ts';

export interface SidebarButtonInjected {
  open(): void;
}

type SidebarButtonProps = PropsRuntime<'sidebar.footer.action'> & InjectFace<SidebarButtonInjected>;

/** Footer entry point; it renders below the ChatGPT Plan notice registered on the same slot. */
export function SidebarButton(props: SidebarButtonProps) {
  return <button
    type="button"
    className="dsh-model-usage-sidebar"
    data-wide={props.wide}
    title={copy.title}
    aria-label={copy.sidebar}
    onClick={props.open}
  >
    <span className="dsh-model-usage-sidebar-glyph" aria-hidden="true">
      <IconGaugeOutlineRegular size={props.wide ? 16 : 18} />
    </span>
    {props.wide && <span className="dsh-model-usage-sidebar-label">{copy.sidebar}</span>}
  </button>;
}

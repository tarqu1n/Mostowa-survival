import type { ReactNode } from 'react';
import { cn } from '../lib/utils';
import { Button } from './button';

/**
 * Large, labelled panel toggle pinned to a far edge of the compact bottom bar — the phone-thumb entry
 * point to the Library (far left) and Inspector (far right) drawers. Shared by the `ContextBar` (where
 * it OPENS a drawer) and each drawer's own bottom bar (where the same-looking button, in the same
 * screen position, CLOSES it) so the control reads as one persistent toggle you can tap in place to
 * open and close. `active` marks the open state (the in-drawer copy), styled like the toolbar's
 * pressed controls.
 */
export function PanelBarButton({
  side,
  icon,
  label,
  active = false,
  onClick,
}: {
  side: 'left' | 'right';
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="secondary"
      size="lg"
      aria-label={`${active ? 'Close' : 'Open'} ${label}`}
      aria-pressed={active}
      title={`${active ? 'Close' : 'Open'} ${label}`}
      onClick={onClick}
      className={cn(
        'h-12 shrink-0 flex-col gap-0.5 px-3 text-[0.7rem] font-normal',
        side === 'left' ? 'mr-auto' : 'ml-auto',
        "[&_svg:not([class*='size-'])]:size-6",
        active && 'bg-active text-fg-bright hover:bg-active',
      )}
    >
      {icon}
      {label}
    </Button>
  );
}

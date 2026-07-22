import { useState } from 'react';
import { hudBridge } from '@/hud/hooks/useBridge';
import { useHudStore } from '@/hud/store';
import { Button } from '@/hud/ui/button';
import { cn } from '@/hud/lib/utils';

/**
 * Dev menu (plan 046 Step 8) — the DOM/React replacement for the Phaser `DevMenu`. A bottom-right DEV
 * toggle that opens a small panel of build-testing helpers: Spawn Enemy, Spawn NPC, a day/night flip,
 * and Force Wave. Each button emits the same `debug:*` bus event the legacy panel fired.
 *
 * The ENTIRE render is gated behind `import.meta.env.DEV` (returns null otherwise) so `vite build`
 * dead-code-eliminates it from the production bundle — matching the `if (!import.meta.env.DEV) return`
 * guard on GameScene's dev seam. The day/night button's label tracks the live phase from the store
 * (the twin of `DevMenu.setPhaseLabel`), reading as the action it performs ("GO NIGHT" while it is
 * day). Open state is component-local; the root opts back into pointer events over the click-through
 * HUD.
 */
export function DevMenu() {
  if (!import.meta.env.DEV) return null;
  return <DevMenuInner />;
}

function DevMenuInner() {
  const [open, setOpen] = useState(false);
  const dayPhase = useHudStore((s) => s.dayPhase);
  const timeLabel = dayPhase === 'day' ? 'GO NIGHT' : 'GO DAY';

  const emit = (
    type: 'debug:spawnEnemy' | 'debug:spawnNpc' | 'debug:toggleTime' | 'debug:forceWave',
  ) => hudBridge()?.emit({ type });

  return (
    <div className="pointer-events-auto absolute right-2 bottom-2 flex flex-col items-end gap-2">
      {open && (
        <div className="flex w-32 flex-col gap-2 rounded-md border border-border bg-card p-2 shadow-lg">
          <span className="px-1 text-xs font-medium tracking-wide text-muted-foreground">
            DEV MENU
          </span>
          <Button size="sm" variant="secondary" onClick={() => emit('debug:spawnEnemy')}>
            SPAWN ENEMY
          </Button>
          <Button size="sm" variant="secondary" onClick={() => emit('debug:spawnNpc')}>
            SPAWN NPC
          </Button>
          <Button size="sm" variant="secondary" onClick={() => emit('debug:toggleTime')}>
            {timeLabel}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => emit('debug:forceWave')}>
            FORCE WAVE
          </Button>
        </div>
      )}
      <Button
        size="sm"
        variant={open ? 'default' : 'secondary'}
        aria-pressed={open}
        className={cn('w-24')}
        onClick={() => setOpen((v) => !v)}
      >
        DEV
      </Button>
    </div>
  );
}

import { hudBridge } from '@/hud/hooks/useBridge';
import { useHudStore } from '@/hud/store';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/hud/ui/sheet';
import { cn } from '@/hud/lib/utils';

/**
 * Inspect card (plan 046 Step 8) — the DOM/React replacement for the Phaser `InspectPanel`. A bottom
 * sheet driven entirely by `store.inspectTarget`: visible only while it is non-null, showing the
 * entity name, an HP bar (when `currentHp`/`maxHp` are present), and the `extra` label/value rows.
 *
 * Closing — the sheet's X, an overlay/Escape dismiss, or `onOpenChange(false)` — emits `inspect:hide`
 * back onto the bus, the same signal the legacy dismissible Panel fired. GameScene clears its inspect
 * mode on that event, which zeroes `inspectTarget` through the bridge, so open state stays a pure
 * mirror of the store (no local open flag to drift). The `sheet` primitive owns its own
 * pointer-events, so the click-through HUD root does not gate it.
 */
export function InspectCard() {
  const target = useHudStore((s) => s.inspectTarget);

  const hpKnown = target?.currentHp !== undefined;
  const hpPct =
    target && hpKnown && target.maxHp > 0
      ? Math.max(0, Math.min(100, (target.currentHp! / target.maxHp) * 100))
      : 0;

  return (
    <Sheet
      open={target !== null}
      onOpenChange={(open) => {
        // `inspect:hide` is the bus event the legacy InspectPanel fired on dismiss; the bridge LISTENS
        // to it (bridge.ts) and clears `inspectTarget`, so emitting it closes this sheet — open state
        // stays a pure mirror of the store, no local flag to drift.
        if (!open) hudBridge()?.emit({ type: 'inspect:hide' });
      }}
    >
      <SheetContent side="bottom" className="gap-3 pb-6">
        {target && (
          <>
            <SheetHeader className="pb-0">
              <SheetTitle>{target.name}</SheetTitle>
              <SheetDescription className="sr-only">Entity details</SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-3 px-4">
              {hpKnown ? (
                <div className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-muted-foreground">HP</span>
                    <span className="text-foreground tabular-nums">
                      {target.currentHp}/{target.maxHp}
                    </span>
                  </div>
                  <div
                    className="h-2 w-full overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuenow={target.currentHp}
                    aria-valuemin={0}
                    aria-valuemax={target.maxHp}
                  >
                    <div
                      className={cn(
                        'h-full rounded-full transition-[width]',
                        hpPct <= 33 ? 'bg-destructive' : 'bg-primary',
                      )}
                      style={{ width: `${hpPct}%` }}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-muted-foreground">Max HP</span>
                  <span className="text-foreground tabular-nums">{target.maxHp}</span>
                </div>
              )}

              {(target.extra ?? []).map((row) => (
                <div key={row.label} className="flex items-baseline justify-between text-sm">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="text-foreground">{row.value}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

import { useRef } from 'react';
import { useHudStore } from '../store';
import type { HotbarSlot } from '../store';
import { hudBridge } from '../hooks/useBridge';
import { HUD_HOTBAR_SLOTS, LONGPRESS_MS } from '@/config';
import { ITEMS } from '@/data/items';
import { BUILDABLES } from '@/data/buildables';
import { cn } from '@/hud/lib/utils';

/**
 * Field Kit hotbar (plan 046 Step 6) — the always-visible quick-swap loadout row (`HUD_HOTBAR_SLOTS`
 * slots) that rides just above the command bar. Renders the store's `hotbar` loadout; empty slots are
 * dimmed. Tapping a filled slot uses/equips/selects its entry:
 *  - buildable → `build:select` (opens placement for that structure);
 *  - edible item (has `nutrition`, e.g. berries) → `needs:eat`;
 *  - weapon/other item → no-op placeholder (no equipment system yet — deferred, plan 046).
 *
 * Long-press is the "pin" affordance in the pitch, but the pin ACTION (`pinToHotbar`) is exercised
 * from the catalog/pack entries (Step 7), not from within the bar. Here long-press is a self-contained
 * placeholder gesture: it suppresses the tap so a held slot doesn't fire use/equip, leaving room for a
 * reassign/clear affordance at Step 11.
 */
export function Hotbar({ className }: { className?: string }) {
  const hotbar = useHudStore((s) => s.hotbar);
  const slots = Array.from({ length: HUD_HOTBAR_SLOTS }, (_, i) => hotbar[i] ?? null);

  return (
    <div
      data-testid="hud-hotbar"
      className={cn(
        'pointer-events-auto flex gap-[5px] rounded-xl border border-border bg-inset/60 px-1.5 py-1',
        className,
      )}
    >
      {slots.map((slot, i) => (
        <SlotButton key={i} slot={slot} />
      ))}
    </div>
  );
}

/** Fire the tap action for a filled slot (see the component doc for the per-kind mapping). */
function activate(slot: NonNullable<HotbarSlot>): void {
  const bridge = hudBridge();
  if (!bridge) return;
  if (slot.kind === 'buildable') {
    bridge.emit({ type: 'build:select', payload: { id: slot.id } });
    return;
  }
  const def = ITEMS[slot.id];
  if (def?.nutrition != null) {
    bridge.emit({ type: 'needs:eat', payload: { itemId: slot.id } });
    return;
  }
  // Weapon / other item: equipment system is deferred (plan 046), so "use" is a no-op placeholder.
}

/** Absolute URL of an item icon (mirrors PreloadScene's `assets/icons/<file>` load path). */
function iconUrl(file: string): string {
  return encodeURI(`${import.meta.env.BASE_URL}assets/icons/${file}`);
}

/** One hotbar slot. Empty → a dimmed, inert cell; filled → tap-to-use with a long-press guard. */
function SlotButton({ slot }: { slot: HotbarSlot }) {
  const timer = useRef<number | null>(null);
  const longPressed = useRef(false);

  const clearTimer = (): void => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const onPointerDown = (): void => {
    if (!slot) return;
    longPressed.current = false;
    clearTimer();
    timer.current = window.setTimeout(() => {
      longPressed.current = true;
      // Long-press within the bar: pin is driven from catalog/pack entries (Step 7), so this is a
      // placeholder — it only marks the gesture so the tap below is suppressed. TODO(Step 11):
      // reassign/clear affordance.
    }, LONGPRESS_MS);
  };

  const onPointerUp = (): void => {
    clearTimer();
    if (longPressed.current) return; // held long enough to be a long-press → don't fire the tap
    if (slot) activate(slot);
  };

  return (
    <button
      type="button"
      disabled={!slot}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={clearTimer}
      onPointerCancel={clearTimer}
      className={cn(
        'relative grid size-8 place-items-center overflow-hidden rounded-lg border border-border bg-surface-subtle/95',
        !slot && 'opacity-40',
      )}
      aria-label={slot ? slotLabel(slot) : 'empty slot'}
    >
      {slot && <SlotContent slot={slot} />}
    </button>
  );
}

/** Icon (item art) or a short text label (buildables ship no icon in data yet — TODO: buildable icons). */
function SlotContent({ slot }: { slot: NonNullable<HotbarSlot> }) {
  if (slot.kind === 'item') {
    const def = ITEMS[slot.id];
    if (def?.icon) {
      return (
        <img
          src={iconUrl(def.icon)}
          alt={def.name}
          className="size-5 [image-rendering:pixelated]"
          draggable={false}
        />
      );
    }
    return <SlotText>{def?.name ?? slot.id}</SlotText>;
  }
  // Buildable: no icon field on BuildableDef, so fall back to the short name (TODO: buildable icons).
  const def = BUILDABLES[slot.id];
  return <SlotText>{def?.name ?? slot.id}</SlotText>;
}

function SlotText({ children }: { children: string }) {
  return (
    <span className="px-0.5 text-center text-[7px] leading-tight text-fg-muted">{children}</span>
  );
}

/** Human-readable slot label for the button's accessible name. */
function slotLabel(slot: NonNullable<HotbarSlot>): string {
  const def = slot.kind === 'item' ? ITEMS[slot.id] : BUILDABLES[slot.id];
  return def?.name ?? slot.id;
}

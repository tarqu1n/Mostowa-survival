import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import type { TilePaletteSlot } from '../../systems/mapFormat';
import { useEditorStore } from '../store/editorStore';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { cn } from '../lib/utils';
import { useIsCompact } from '../hooks/useIsCompact';
import { useLongPress } from '../hooks/useLongPress';
import { toast } from 'sonner';
import {
  AssetSwatch,
  EMPTY_NODE_DEFS,
  resolveRecentSwatch,
  type RecentSwatch,
} from './assetSwatch';

/**
 * Tile-palette strip (plan 033) — a quick-access tray of curated tiles, mirroring `RecentStrip` (same
 * `assetSwatch` renderer, same swatch conventions) so palette and Library swatches can never drift.
 * Renders a palette switcher (a content-width `Select` over the GLOBAL named palettes + a "＋" add, a
 * ✎ inline-rename, and a 🗑 delete-with-confirm for the active palette), then its slots as one-tap
 * swatches that arm the brush via
 * `selectPaletteSlot`. Slots are removed by LONG-PRESS (mirrors the Library's long-press favourite);
 * there is no per-slot ✕ affordance any more (phone feedback — it wasted a whole row per tile).
 *
 * Plan 033 step 9: palettes are now the GLOBAL `tilePalettes` store slice (auto-saved to
 * `palettes.json`), so this selects `s.tilePalettes` directly — every structural mutation replaces the
 * array immutably, so a plain selector re-renders correctly (no `docRevision`/`getState().map` dance).
 */

/** Palette-strip swatch size (px). Compact is a touch bigger so the swatch (which doubles as the tap
 *  target) stays comfortably tappable even without inter-tile padding. */
const PALETTE_SWATCH_PX = 30;
const PALETTE_SWATCH_PX_COMPACT = 38;

/** Stable key + dedupe identity for a slot — matches the store's own `assetId`+`rotation` slot key. */
const slotKey = (slot: TilePaletteSlot): string => `${slot.assetId}#${slot.rotation ?? 0}`;

export function PaletteStrip() {
  const isCompact = useIsCompact();
  // Inline-rename state: while `renaming`, the switcher is swapped for a text input seeded with the
  // active palette's name (Enter/blur commits, Escape cancels). Local, non-persisted UI state.
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const catalog = useEditorStore((s) => s.catalog);
  const terrainCatalog = useEditorStore((s) => s.terrainCatalog);
  // Global palette slice — an immutable array replaced on every mutation, so a plain selector suffices.
  const palettes = useEditorStore((s) => s.tilePalettes);
  const activeTilePaletteId = useEditorStore((s) => s.activeTilePaletteId);
  // Brush state drives the active-slot highlight — a slot is highlighted when its asset+rotation match
  // the currently-armed brush (mirrors how the Library/Recent strip rings the active pick).
  const brushAsset = useEditorStore((s) => s.brushAsset);
  const brushRotation = useEditorStore((s) => s.brushRotation);
  // The slot last armed from this strip, kept sticky across `rotateBrush` (see the store field's doc).
  // When set, it — not the raw brush-angle match — decides the highlight, so rotating the armed tile
  // keeps THAT slot ringed and its swatch shows the live `brushRotation`.
  const selectedPaletteSlot = useEditorStore((s) => s.selectedPaletteSlot);

  const sizePx = isCompact ? PALETTE_SWATCH_PX_COMPACT : PALETTE_SWATCH_PX;

  // Resolve the active palette from the pointer, falling back to the first (the pointer can momentarily
  // lag a structural add before reconcile/`set` lands).
  const activePalette = palettes.find((p) => p.id === activeTilePaletteId) ?? palettes[0] ?? null;

  const addTilePalette = (): void => useEditorStore.getState().addTilePalette();

  const startRename = (): void => {
    if (!activePalette) return;
    setDraft(activePalette.name);
    setRenaming(true);
  };
  const commitRename = (): void => {
    if (activePalette) useEditorStore.getState().renameTilePalette(activePalette.id, draft);
    setRenaming(false);
  };
  const deleteActive = (): void => {
    if (!activePalette) return;
    // Destructive + not undoable → confirm (mirrors ReferencePanel's window.confirm pattern).
    if (!window.confirm(`Delete palette "${activePalette.name}"? This can't be undone.`)) return;
    useEditorStore.getState().deleteTilePalette(activePalette.id);
  };

  // No palettes yet: a single "New palette" affordance.
  if (palettes.length === 0) {
    return (
      <div className="mb-2.5 flex flex-col gap-1 border-b border-surface pb-2">
        <Button
          size="sm"
          variant="outline"
          className={cn('w-full', isCompact && 'h-11')}
          onClick={addTilePalette}
        >
          ＋ New palette
        </Button>
      </div>
    );
  }

  // Cap the slot tray at ~3 rows tall, scrolling beyond. A row is the swatch plus its button padding
  // (p-0.5 desktop / p-1 compact) and border — approximated so the third row's bottom edge is flush.
  const rowPx = sizePx + (isCompact ? 10 : 6);
  const maxSlotsHeight = rowPx * 3;

  return (
    <div className="mb-2.5 flex flex-col gap-1.5 border-b border-surface pb-2">
      {/* No heading of its own — the switcher below already names the active palette (with the
          Select's built-in down-arrow), so a "PALETTE" title would just be redundant height. */}
      <div className="flex items-center gap-1.5">
        {renaming ? (
          // Inline rename: Enter/blur commits, Escape cancels. Autofocused so the keyboard opens on
          // touch immediately.
          <Input
            autoFocus
            value={draft}
            aria-label="Palette name"
            className={cn('min-w-0 flex-1', isCompact && 'h-11 text-[0.95rem]')}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              else if (e.key === 'Escape') setRenaming(false);
            }}
          />
        ) : (
          <>
            <Select
              value={activePalette?.id ?? undefined}
              onValueChange={(id) => useEditorStore.getState().setActiveTilePalette(id)}
            >
              {/* Sized to CONTENT (not full width) — the name + chevron just fit; capped so a long name
                  can't crowd out the action buttons. */}
              <SelectTrigger
                size="sm"
                className={cn('w-auto max-w-[55%]', isCompact && 'h-11 text-[0.95rem]')}
              >
                <SelectValue placeholder="Palette" />
              </SelectTrigger>
              <SelectContent>
                {palettes.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size={isCompact ? 'icon-lg' : 'icon-sm'}
              variant="ghost"
              className="flex-none"
              title="Rename palette"
              aria-label="Rename palette"
              disabled={!activePalette}
              onClick={startRename}
            >
              <Pencil />
            </Button>
            <Button
              size={isCompact ? 'icon-lg' : 'icon-sm'}
              variant="ghost"
              className="flex-none text-fg-muted hover:text-danger"
              title="Delete palette"
              aria-label="Delete palette"
              disabled={!activePalette}
              onClick={deleteActive}
            >
              <Trash2 />
            </Button>
            <Button
              size={isCompact ? 'icon-lg' : 'icon-sm'}
              variant="outline"
              className="ml-auto flex-none"
              title="Add palette"
              aria-label="Add palette"
              onClick={addTilePalette}
            >
              ＋
            </Button>
          </>
        )}
      </div>

      {activePalette && activePalette.slots.length === 0 && (
        <p className="text-[0.8rem] text-muted-2">
          Add tiles from the Library. Long-press a tile to remove it.
        </p>
      )}

      {activePalette && activePalette.slots.length > 0 && (
        // No gap between tiles; wrap into up to ~3 rows, scrolling past that.
        <div className="flex flex-wrap overflow-y-auto" style={{ maxHeight: maxSlotsHeight }}>
          {activePalette.slots.map((slot, index) => {
            // Sticky selection wins when it points into this palette: highlight exactly the tapped slot
            // (regardless of the current brush angle) and preview the live `brushRotation` on it. Falls
            // back to the raw asset+angle match (eyedropper, Library pick) when nothing is sticky here.
            const stickyKey =
              selectedPaletteSlot && selectedPaletteSlot.paletteId === activePalette.id
                ? slotKey(selectedPaletteSlot)
                : null;
            const isActive = stickyKey
              ? slotKey(slot) === stickyKey
              : brushAsset === slot.assetId && brushRotation === (slot.rotation ?? 0);
            return (
              <PaletteSlotSwatch
                key={slotKey(slot)}
                slot={slot}
                index={index}
                paletteId={activePalette.id}
                sizePx={sizePx}
                isCompact={isCompact}
                isActive={isActive}
                // The active slot shows the live armed angle; every other slot shows its own stored one.
                displayRotation={isActive ? brushRotation : (slot.rotation ?? 0)}
                swatch={
                  catalog
                    ? resolveRecentSwatch(
                        { kind: 'tile', assetId: slot.assetId },
                        catalog,
                        EMPTY_NODE_DEFS,
                        terrainCatalog,
                      )
                    : null
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/** One palette slot: a tap-to-arm / long-press-to-remove swatch (plan 033 step 9). The swatch itself is
 *  the tap target (no separate ✕ row any more — phone feedback). `useLongPress` arbitrates: tap arms the
 *  brush, a long-press removes the slot with a toast. The active slot keeps its gold ring. `swatch` is
 *  `null` only when the catalog hasn't loaded or the tile id no longer resolves — the box still renders
 *  (empty) so a now-stale slot can still be long-pressed away. */
function PaletteSlotSwatch({
  slot,
  index,
  paletteId,
  sizePx,
  isCompact,
  isActive,
  displayRotation,
  swatch,
}: {
  slot: TilePaletteSlot;
  index: number;
  paletteId: string;
  sizePx: number;
  isCompact: boolean;
  isActive: boolean;
  /** Clockwise degrees to spin the swatch preview by — the live brush angle on the active slot, the
   *  slot's own stored rotation otherwise — so the tray shows the orientation each tile will paint at. */
  displayRotation: number;
  swatch: RecentSwatch | null;
}) {
  const title = displayRotation ? `${slot.assetId} (${displayRotation}°)` : slot.assetId;
  const arm = (): void => useEditorStore.getState().selectPaletteSlot(slot);
  const remove = (): void => {
    useEditorStore.getState().removeTilePaletteSlot(paletteId, index);
    toast('Removed from palette', { duration: 1200 });
  };
  // One gesture source (tap = arm, long-press = remove) — mirrors the Library's long-press favourite.
  // Wired on both desktop and compact since there's no ✕ fallback; the hook swallows the trailing
  // click, so no separate `onClick` is supplied.
  const longPress = useLongPress({ onTap: arm, onLongPress: remove });

  return (
    <button
      type="button"
      className={cn(
        'flex flex-none items-center justify-center rounded-[3px] border bg-inset p-0.5 hover:border-gold-light',
        isCompact && 'p-1',
        // Active slot gets the gold ring (mirrors `--color-active`/`--color-selection` picks in the
        // Library); inactive stays transparent-bordered.
        isActive ? 'border-gold-light bg-surface' : 'border-transparent',
      )}
      title={`${title} — long-press to remove`}
      {...longPress}
    >
      <span
        className="flex items-center justify-center"
        style={{
          width: sizePx,
          height: sizePx,
          // Spin the square swatch to preview the paint angle (CSS positive = clockwise, matching
          // `brushRotation`'s clockwise convention). 0° is a no-op so unrotated tiles are untouched.
          transform: displayRotation ? `rotate(${displayRotation}deg)` : undefined,
        }}
      >
        {swatch && <AssetSwatch swatch={swatch} sizePx={sizePx} />}
      </span>
    </button>
  );
}

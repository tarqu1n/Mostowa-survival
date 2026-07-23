import { hudBridge } from '@/hud/hooks/useBridge';
import { NPC_MENU_SECTIONS, isNpcMenuOptionActive, type NpcMenuOption } from '@/scenes/npcMenu';
import type { NpcDayRole, NpcNightPosture } from '@/entities/NpcCharacter';
import { Button } from '@/hud/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/hud/ui/sheet';

/**
 * Companion assignment menu (plan 046 Step 8) — the DOM/React replacement for the Phaser
 * `NpcAssignMenu`. A bottom sheet built from the pure {@link NPC_MENU_SECTIONS} model: a DAY section
 * (Gather / Repair) and a NIGHT section (Guard here / Follow / Refuel lights). Each option routes to
 * the SAME `npc:*` bus event the legacy popover fired, so GameScene's companion setters stay the one
 * path both the menu and the `__test` seams drive.
 *
 * Open state + the live `dayRole`/`nightPosture` are PROPS, not store fields: they arrive on the
 * `npc:menuOpen` game event, wired at integration (Step 12). This component never touches that event
 * — it just renders and emits. `isNpcMenuOptionActive` highlights the companion's current assignment.
 */
export interface CompanionMenuProps {
  /** Whether the menu is open (from the `npc:menuOpen` game event, wired at Step 12). */
  open: boolean;
  /** The companion's live day role — highlights the matching DAY option. */
  dayRole: NpcDayRole;
  /** The companion's live night posture — highlights the matching NIGHT option. */
  nightPosture: NpcNightPosture;
  /** Close the menu (clears the open state the parent owns). */
  onClose: () => void;
}

export function CompanionMenu({ open, dayRole, nightPosture, onClose }: CompanionMenuProps) {
  /** Route an option to the companion setter it maps to, then close — mirrors `NpcAssignMenu`:
   *  a day-role option assigns live, a night-posture option assigns live, and the single "Guard here"
   *  option arms the one-tap place-the-point mode (`npc:beginPlaceGuard`). */
  const onOption = (option: NpcMenuOption): void => {
    const bridge = hudBridge();
    if (option.kind === 'dayRole')
      bridge?.emit({ type: 'npc:assignDayRole', payload: option.value });
    else if (option.kind === 'nightPosture')
      bridge?.emit({ type: 'npc:assignNightPosture', payload: option.value });
    else bridge?.emit({ type: 'npc:beginPlaceGuard' });
    onClose();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent side="bottom" className="gap-3 pb-6">
        <SheetHeader className="pb-0">
          <SheetTitle>Assign companion</SheetTitle>
          <SheetDescription className="sr-only">
            Choose a day job and a night posture for your companion.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4">
          {NPC_MENU_SECTIONS.map((section) => (
            <div key={section.title} className="flex flex-col gap-2">
              <span className="text-xs font-medium tracking-wide text-muted-foreground">
                {section.title}
              </span>
              <div className="flex flex-col gap-2">
                {section.options.map((option) => {
                  const active = isNpcMenuOptionActive(option, { dayRole, nightPosture });
                  return (
                    <Button
                      key={option.label}
                      variant={active ? 'default' : 'outline'}
                      aria-pressed={active}
                      onClick={() => onOption(option)}
                    >
                      {option.label}
                    </Button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../editorStore';

/** Fresh 4x4 map for each test — mirrors `editorStore.test.ts`'s `reset` (the store is a module-level
 *  singleton, so every test needs a clean `activeTool`/`libraryRoleFilter` starting point). */
function reset(): void {
  useEditorStore.getState().newMap('scratch', 'Scratch', 4, 4);
}

describe('editorStore: Library role filter + tool sync (plan 032 step 3)', () => {
  beforeEach(() => reset());

  it('defaults to the tile filter, not overridden, with actors hidden', () => {
    const s = useEditorStore.getState();
    expect(s.libraryRoleFilter).toBe('tile');
    expect(s.libraryRoleFilterOverridden).toBe(false);
  });

  it('switching to a paint tool (brush/rect/fill/eraser/terrain) auto-sets the filter to tile', () => {
    for (const tool of ['brush', 'rect', 'fill', 'eraser', 'terrain'] as const) {
      useEditorStore.getState().setActiveTool('pan'); // clear any override left by a prior iteration
      useEditorStore.getState().setLibraryRoleFilter('object'); // perturb away from tile (sets override)
      // An intermediate unmapped-tool switch clears the override flag WITHOUT touching the filter
      // (select has no TOOL_LIBRARY_FILTER entry) — isolates "not overridden" from "just overridden".
      useEditorStore.getState().setActiveTool('select');
      expect(useEditorStore.getState().libraryRoleFilter).toBe('object'); // still perturbed
      expect(useEditorStore.getState().libraryRoleFilterOverridden).toBe(false); // override spent

      useEditorStore.getState().setActiveTool(tool);
      expect(useEditorStore.getState().libraryRoleFilter).toBe('tile');
    }
  });

  it('switching to place auto-sets the filter to object', () => {
    useEditorStore.getState().setActiveTool('pan');
    useEditorStore.getState().setActiveTool('place');
    expect(useEditorStore.getState().libraryRoleFilter).toBe('object');
  });

  it('a tool with no mapping (e.g. select/zone/portal/eyedropper) keeps the current filter', () => {
    useEditorStore.getState().setActiveTool('pan');
    useEditorStore.getState().setActiveTool('place'); // filter -> object
    expect(useEditorStore.getState().libraryRoleFilter).toBe('object');

    for (const tool of ['select', 'zone', 'shape', 'collision', 'portal', 'eyedropper'] as const) {
      useEditorStore.getState().setActiveTool(tool);
      expect(useEditorStore.getState().libraryRoleFilter).toBe('object');
    }
  });

  it(
    'a mapped tool never resolves the filter to actor when the switch is NOT overridden — even if ' +
      'the filter was already actor going in',
    () => {
      // Get the filter to 'actor' via a manual override, then let the override lapse through one
      // switch to an UNMAPPED tool ('select' isn't in TOOL_LIBRARY_FILTER, so it keeps 'actor' as-is
      // while still resetting the override flag per setActiveTool's unconditional reset).
      useEditorStore.getState().setActiveTool('pan');
      useEditorStore.getState().setLibraryRoleFilter('actor');
      useEditorStore.getState().setActiveTool('select');
      expect(useEditorStore.getState().libraryRoleFilter).toBe('actor');
      expect(useEditorStore.getState().libraryRoleFilterOverridden).toBe(false);

      // Now, with no override in effect, every MAPPED tool must resolve away from 'actor' — the six
      // mapped tools only ever produce 'tile'/'object', never 'actor' (critique #3's settled mapping).
      for (const tool of ['brush', 'rect', 'fill', 'eraser', 'terrain', 'place'] as const) {
        useEditorStore.getState().setActiveTool('select'); // back to the actor/not-overridden baseline
        useEditorStore.getState().setActiveTool(tool);
        expect(useEditorStore.getState().libraryRoleFilter).not.toBe('actor');
      }
    },
  );

  it('a manual chip pick (setLibraryRoleFilter) sets the override flag', () => {
    useEditorStore.getState().setLibraryRoleFilter('actor');
    expect(useEditorStore.getState().libraryRoleFilter).toBe('actor');
    expect(useEditorStore.getState().libraryRoleFilterOverridden).toBe(true);
  });

  it('a manually-overridden filter survives the NEXT tool switch, then auto-sync resumes', () => {
    useEditorStore.getState().setActiveTool('pan');
    useEditorStore.getState().setLibraryRoleFilter('actor'); // manual override
    expect(useEditorStore.getState().libraryRoleFilterOverridden).toBe(true);

    // Switching to brush would normally force 'tile', but the override wins this once.
    useEditorStore.getState().setActiveTool('brush');
    expect(useEditorStore.getState().libraryRoleFilter).toBe('actor');
    expect(useEditorStore.getState().libraryRoleFilterOverridden).toBe(false); // reset on tool change

    // The override is spent — the NEXT tool switch auto-syncs normally again.
    useEditorStore.getState().setActiveTool('place');
    expect(useEditorStore.getState().libraryRoleFilter).toBe('object');
  });

  it('reset the override flag on every tool change, even a no-op mapping', () => {
    useEditorStore.getState().setActiveTool('pan');
    useEditorStore.getState().setLibraryRoleFilter('actor');
    expect(useEditorStore.getState().libraryRoleFilterOverridden).toBe(true);

    // 'select' has no mapping, but the tool switch still resets the override flag.
    useEditorStore.getState().setActiveTool('select');
    expect(useEditorStore.getState().libraryRoleFilter).toBe('actor'); // unmapped tool ⇒ kept
    expect(useEditorStore.getState().libraryRoleFilterOverridden).toBe(false);

    // Override is gone, so the next mapped tool switch auto-syncs.
    useEditorStore.getState().setActiveTool('brush');
    expect(useEditorStore.getState().libraryRoleFilter).toBe('tile');
  });
});

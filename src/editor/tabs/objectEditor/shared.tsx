import type { ReactNode } from 'react';

/* Shared class strings + small presentational helpers for the object-editor tab, split out of
 * `ObjectEditorTab.tsx` (plan 43 step 10) so the tab shell, `ObjectEditorForm`, and `RegionsEditor`
 * all consume one copy. Behaviour-preserving extraction — the strings/markup are verbatim. */

export const objTabClass = 'h-full w-full overflow-auto p-4 px-[18px]';
export const objTitleClass = 'mb-3 text-base text-fg-bright';
export const objIdClass = 'break-all text-[0.78rem] text-muted-2';
export const objInputClass = 'rounded-md border border-border bg-inset px-2 py-1 text-fg';

/** A labelled control row (`.editor-object-field`): a small dim caption above the input/select. */
export function ObjField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[0.72rem] text-muted-2">{label}</span>
      {children}
    </label>
  );
}

/** The shared error/warnings blocks under either form (`.editor-object-error`/`.editor-object-warnings`). */
export function FormError({ message }: { message: string }) {
  return <p className="text-[0.8rem] text-danger">{message}</p>;
}
export function FormWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="flex max-h-24 flex-col gap-0.5 overflow-y-auto text-[0.72rem] text-muted-2">
      {warnings.slice(0, 6).map((w, i) => (
        <div key={i}>{w}</div>
      ))}
    </div>
  );
}

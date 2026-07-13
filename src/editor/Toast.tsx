import { useCallback, useState } from 'react';

/** Transient bottom-of-screen notice — success ('ok') or a validation/IO failure ('error'). */
export type ToastKind = 'ok' | 'error';
export interface ToastMessage {
  text: string;
  kind: ToastKind;
  id: number;
}
export type ToastFn = (text: string, kind: ToastKind) => void;

/** Single-slot toast: a new message replaces the current one and auto-dismisses (errors linger). */
export function useToast(): { toast: ToastMessage | null; showToast: ToastFn } {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const showToast = useCallback<ToastFn>((text, kind) => {
    const id = Date.now() + Math.random();
    setToast({ text, kind, id });
    window.setTimeout(
      () => setToast((current) => (current && current.id === id ? null : current)),
      kind === 'error' ? 5000 : 2500,
    );
  }, []);
  return { toast, showToast };
}

export function ToastHost({ toast }: { toast: ToastMessage | null }) {
  if (!toast) return null;
  return <div className={`editor-toast editor-toast--${toast.kind}`}>{toast.text}</div>;
}

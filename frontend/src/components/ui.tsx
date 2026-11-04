import { createContext, ReactNode, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Accessible modal: role=dialog, Escape to close, focus moved in, trapped, and restored on close. */
export function Dialog({ title, onClose, children, maxWidth = 560 }: { title: string; onClose: () => void; children: ReactNode; maxWidth?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>('[autofocus], textarea, input, select') ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current(); return; }
      if (e.key !== 'Tab' || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const a = items[0], z = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1} style={{ maxWidth }}>
        <h3 id={titleId} className="modal-title">{title}</h3>
        {children}
      </div>
    </div>
  );
}

type ToastKind = 'success' | 'error';
interface ToastItem { id: number; kind: ToastKind; text: string }
interface ConfirmOptions { title: string; message?: ReactNode; confirmLabel?: string; tone?: 'danger' | 'warning' | 'normal' }

interface UiApi {
  toast: (text: string, kind?: ToastKind) => void;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const UiContext = createContext<UiApi | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [pending, setPending] = useState<{ opts: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);
  const nextId = useRef(1);

  const toast = useCallback((text: string, kind: ToastKind = 'success') => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    // Errors stay longer so they can be read.
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 9000 : 4500);
  }, []);

  const confirm = useCallback((opts: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ opts, resolve })), []);
  const settle = (v: boolean) => { pending?.resolve(v); setPending(null); };

  const api = useMemo(() => ({ toast, confirm }), [toast, confirm]);

  return (
    <UiContext.Provider value={api}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <span>{t.text}</span>
            <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => setToasts((l) => l.filter((x) => x.id !== t.id))}>×</button>
          </div>
        ))}
      </div>
      {pending && (
        <Dialog title={pending.opts.title} onClose={() => settle(false)} maxWidth={440}>
          {pending.opts.message && <div className="modal-body">{pending.opts.message}</div>}
          <div className="modal-actions">
            <button type="button" className={`btn-sm ${pending.opts.tone === 'danger' ? 'btn-red' : pending.opts.tone === 'warning' ? 'btn-amber' : 'btn-blue'}`} onClick={() => settle(true)}>
              {pending.opts.confirmLabel ?? 'Confirm'}
            </button>
            <button type="button" className="btn-sm btn-slate" onClick={() => settle(false)}>Cancel</button>
          </div>
        </Dialog>
      )}
    </UiContext.Provider>
  );
}

export function useUi(): UiApi {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error('useUi must be used inside <UiProvider>');
  return ctx;
}

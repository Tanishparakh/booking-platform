import { ReactNode, useEffect, useState } from 'react';

export const money = (n: number | string | null | undefined) => '₹' + Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
export const fmtDate = (d?: string | null) => (d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');
export const fmtDateTime = (d?: string | null) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–');
export const hhmm = (t: string) => t?.slice(0, 5);
export const dateRange = (a: string, b: string) => (a === b ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(b)}`);
export const nice = (s?: string | null) => (s ? s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : '');

const TONES: Record<string, string> = {
  PENDING: 'amber', AUTHORIZED: 'amber', UNDER_REVIEW: 'amber', REVISION_REQUESTED: 'amber', PROCESSING: 'amber', OPEN: 'amber', NOT_SUBMITTED: 'gray',
  CONFIRMED: 'blue', HELD: 'blue', DELIVERED: 'blue', CAPTURED: 'blue',
  COMPLETED: 'green', APPROVED: 'green', RELEASED: 'green', PAID: 'green', ACTIVE: 'green', RESOLVED: 'green', AVAILABLE: 'green', ACTION_TAKEN: 'green',
  DECLINED: 'red', CANCELLED: 'red', EXPIRED: 'red', FAILED: 'red', REJECTED: 'red', SUSPENDED: 'red', DISPUTED: 'red', REFUNDED: 'purple', BLOCKED: 'gray', BOOKED: 'blue', DISMISSED: 'gray',
};
export const Badge = ({ value }: { value: string }) => <span className={'badge ' + (TONES[value] || 'gray')}>{nice(value)}</span>;

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'success' | 'info'; children: ReactNode }) {
  if (!children) return null;
  return <div className={'alert ' + kind} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export const Card = ({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) => (
  <section className={'card ' + className}>
    {(title || actions) && <div className="card-head"><h3>{title}</h3><div>{actions}</div></div>}
    {children}
  </section>
);

export const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
);

export const Empty = ({ children }: { children: ReactNode }) => <p className="empty">{children}</p>;

export function Stars({ value }: { value?: number | null }) {
  const v = Math.round(value ?? 0);
  return <span className="stars" aria-label={`${value ?? 0} out of 5`}>{'★'.repeat(v)}<span className="dim">{'★'.repeat(5 - v)}</span></span>;
}

/** Loads data on mount and whenever deps change. */
export function useLoad<T>(fn: () => Promise<T>, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    fn().then((d) => live && (setData(d), setError(''))).catch((e) => live && setError(e.message)).finally(() => live && setLoading(false));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}

/** Wraps an async action with busy/error/success state. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const run = async <T,>(fn: () => Promise<T>, success = ''): Promise<T | undefined> => {
    setBusy(true); setError(''); setOk('');
    try { const r = await fn(); setOk(success); return r; } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return { busy, error, ok, run, setError, setOk };
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="card-head"><h3>{title}</h3><button className="btn ghost" onClick={onClose} aria-label="Close">✕</button></div>
        {children}
      </div>
    </div>
  );
}

export const Tabs = ({ tabs, active, onChange }: { tabs: [string, string][]; active: string; onChange: (k: string) => void }) => (
  <div className="tabs" role="tablist">
    {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={active === k} className={active === k ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>)}
  </div>
);

import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, openProtected, post, put } from '../api';
import { Alert, Badge, Card, Empty, Field, fmtDate, fmtDateTime, Modal, money, nice, Tabs, useAction, useLoad } from '../components/ui';

export function AdminDashboard() {
  const { data, error } = useLoad(() => get('/admin/reports/summary'));
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Empty>Loading…</Empty>;
  const count = (rows: any[], key: string, val: string) => rows.find((r) => r[key] === val)?.n ?? 0;
  const totalBookings = data.bookings.reduce((s: number, r: any) => s + r.n, 0);
  return (
    <>
      <h1>Platform overview</h1>
      <div className="grid g4">
        <Card><div className="dim small">Verifications waiting</div><div className="stat"><Link to="/admin/verifications">{data.queues.pending_verifications}</Link></div></Card>
        <Card><div className="dim small">Open disputes</div><div className="stat"><Link to="/staff/disputes">{data.queues.open_disputes}</Link></div></Card>
        <Card><div className="dim small">Reported content</div><div className="stat"><Link to="/staff/reports">{data.queues.open_reports}</Link></div></Card>
        <Card><div className="dim small">Payouts to process</div><div className="stat"><Link to="/admin/payments">{data.queues.pending_payouts}</Link></div></Card>
      </div>
      <div className="grid g2">
        <Card title="Money">
          <table><tbody>
            <tr><th>Gross payments held or released</th><td>{money(data.money.gross)}</td></tr>
            <tr><th>Currently held in escrow</th><td>{money(data.money.held)}</td></tr>
            <tr><th>Refunded</th><td>{money(data.money.refunded)}</td></tr>
            <tr><th>Commission earned (completed bookings)</th><td className="bold">{money(data.money.commission)}</td></tr>
          </tbody></table>
        </Card>
        <Card title="Users & bookings">
          <table><tbody>
            <tr><th>Clients</th><td>{count(data.users, 'role', 'CLIENT')}</td><th>Professionals</th><td>{count(data.users, 'role', 'PROFESSIONAL')}</td></tr>
            <tr><th>Support staff</th><td>{count(data.users, 'role', 'SUPPORT')}</td><th>Admins</th><td>{count(data.users, 'role', 'ADMIN')}</td></tr>
            <tr><th>Total bookings</th><td>{totalBookings}</td><th>Completed</th><td>{count(data.bookings, 'status', 'COMPLETED')}</td></tr>
            <tr><th>Pending</th><td>{count(data.bookings, 'status', 'PENDING')}</td><th>Cancelled/declined</th><td>{count(data.bookings, 'status', 'CANCELLED') + count(data.bookings, 'status', 'DECLINED')}</td></tr>
          </tbody></table>
        </Card>
      </div>
    </>
  );
}

export function Verifications() {
  const [tab, setTab] = useState('PENDING');
  const { data, error, reload } = useLoad(() => get('/admin/verifications?status=' + tab), [tab]);
  const [rejecting, setRejecting] = useState<any>(null);
  const a = useAction();
  return (
    <Card title="Professional verification">
      <Tabs tabs={[['PENDING', 'Pending'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected']]} active={tab} onChange={setTab} />
      <Alert>{error || a.error}</Alert>
      {data?.length === 0 ? <Empty>Nothing in this list.</Empty> : (
        <div className="table-wrap"><table><thead><tr><th>Professional</th><th>Type / city</th><th>Document</th><th>Submitted</th><th></th></tr></thead>
          <tbody>{data?.map((v: any) => (
            <tr key={v.id}><td><b>{v.full_name}</b><div className="small dim">{v.email}</div></td><td>{nice(v.professional_type)} · {v.operating_city}</td>
              <td>{v.document_type} <button className="btn secondary sm" onClick={() => a.run(() => openProtected(`/admin/verifications/${v.id}/document`))}>View</button></td>
              <td>{fmtDateTime(v.submitted_at)}{v.remarks && <div className="small dim">{v.remarks}</div>}</td>
              <td>{v.status === 'PENDING' && <div className="row"><button className="btn sm" disabled={a.busy} onClick={async () => { await a.run(() => post(`/admin/verifications/${v.id}/approve`, {})); reload(); }}>Approve</button><button className="btn danger sm" onClick={() => setRejecting(v)}>Reject</button></div>}</td></tr>
          ))}</tbody></table></div>
      )}
      {rejecting && <RejectModal v={rejecting} onClose={() => setRejecting(null)} done={reload} />}
    </Card>
  );
}

function RejectModal({ v, onClose, done }: { v: any; onClose: () => void; done: () => void }) {
  const [remarks, setRemarks] = useState('');
  const a = useAction();
  const submit = async (e: FormEvent) => { e.preventDefault(); if (await a.run(() => post(`/admin/verifications/${v.id}/reject`, { remarks }))) { done(); onClose(); } };
  return <Modal title={`Reject ${v.full_name}`} onClose={onClose}><form onSubmit={submit}><Alert>{a.error}</Alert><Field label="Reason shown to the professional"><textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} required minLength={3} /></Field><button className="btn danger" disabled={a.busy}>Reject</button></form></Modal>;
}

export function Users() {
  const [role, setRole] = useState('');
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const { data, error, reload } = useLoad(() => get(`/admin/users?role=${role}&q=${encodeURIComponent(applied)}`), [role, applied]);
  const [staff, setStaff] = useState(false);
  const a = useAction();
  return (
    <>
      <Card title="Users" actions={<button className="btn sm" onClick={() => setStaff(true)}>Add staff account</button>}>
        <form className="row" onSubmit={(e) => { e.preventDefault(); setApplied(q); }}>
          <select style={{ width: 180 }} value={role} onChange={(e) => setRole(e.target.value)}><option value="">All roles</option>{['CLIENT', 'PROFESSIONAL', 'SUPPORT', 'ADMIN'].map((r) => <option key={r} value={r}>{nice(r)}</option>)}</select>
          <input style={{ width: 240 }} placeholder="Name or email" value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn secondary">Search</button>
        </form>
        <Alert>{error || a.error}</Alert>
        <div className="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Verification</th><th>Joined</th><th></th></tr></thead>
          <tbody>{data?.map((u: any) => (
            <tr key={u.id}><td><b>{u.full_name}</b><div className="small dim">{u.email}{!u.email_verified && ' (unverified)'}</div></td><td>{nice(u.role)}</td><td><Badge value={u.status} /></td><td>{u.verification_status && <Badge value={u.verification_status} />}</td><td>{fmtDate(u.created_at)}</td>
              <td>{u.role !== 'ADMIN' && (u.status === 'ACTIVE'
                ? <button className="btn danger sm" onClick={async () => { await a.run(() => post(`/admin/users/${u.id}/suspend`, {})); reload(); }}>Suspend</button>
                : <button className="btn secondary sm" onClick={async () => { await a.run(() => post(`/admin/users/${u.id}/reinstate`, {})); reload(); }}>Reinstate</button>)}</td></tr>
          ))}</tbody></table></div>
      </Card>
      {staff && <StaffModal onClose={() => setStaff(false)} done={reload} />}
    </>
  );
}

function StaffModal({ onClose, done }: { onClose: () => void; done: () => void }) {
  const [f, setF] = useState<any>({ role: 'SUPPORT' });
  const a = useAction();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => { e.preventDefault(); if (await a.run(() => post('/admin/staff', f))) { done(); onClose(); } };
  return (
    <Modal title="Add staff account" onClose={onClose}><form onSubmit={submit}><Alert>{a.error}</Alert>
      <Field label="Full name"><input value={f.fullName || ''} onChange={set('fullName')} required /></Field>
      <Field label="Email"><input type="email" value={f.email || ''} onChange={set('email')} required /></Field>
      <Field label="Temporary password" hint="8+ characters, with a letter and a digit"><input type="password" value={f.password || ''} onChange={set('password')} required /></Field>
      <Field label="Role"><select value={f.role} onChange={set('role')}><option value="SUPPORT">Support (no financial authority)</option><option value="ADMIN">Administrator (requires email MFA at login)</option></select></Field>
      <button className="btn" disabled={a.busy}>Create account</button></form></Modal>
  );
}

const LABELS: Record<string, string> = {
  commission_percent: 'Platform commission (%)', request_expiry_hours: 'Request expiry (hours)', download_link_minutes: 'Download link validity (minutes)',
  deliverable_retention_days: 'Deliverable retention (days)', auto_approve_days: 'Auto-approve after (days, 0 = off)', max_revisions: 'Max revisions per booking',
  full_refund_days: 'Full refund if cancelled ≥ N days before', late_cancel_refund_percent: 'Refund % for late client cancellation', message_retention_days: 'Message retention (days)',
};
export function SettingsPage() {
  const { data, error, reload } = useLoad(() => get('/admin/settings'));
  const [v, setV] = useState<Record<string, string>>({});
  const a = useAction();
  useEffect(() => { if (data) setV(Object.fromEntries(data.map((s: any) => [s.key, s.value]))); }, [data]);
  const save = async (e: FormEvent) => { e.preventDefault(); if (await a.run(() => put('/admin/settings', Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x)]))), 'Settings saved')) reload(); };
  return (
    <Card title="Platform settings">
      <Alert>{error || a.error}</Alert><Alert kind="success">{a.ok}</Alert>
      <p className="small dim">Commission changes apply to bookings accepted from now on; earlier bookings keep the rate they were accepted with.</p>
      <form onSubmit={save} className="grid g2">
        {data?.map((s: any) => <Field key={s.key} label={LABELS[s.key] || s.key} hint={s.description}><input type="number" step="any" value={v[s.key] ?? ''} onChange={(e) => setV({ ...v, [s.key]: e.target.value })} required /></Field>)}
        <div><button className="btn" disabled={a.busy}>Save settings</button></div>
      </form>
    </Card>
  );
}

export function Payments() {
  const { data, error, reload } = useLoad(() => get('/admin/payments'));
  const a = useAction();
  return (
    <Card title="Payments & payouts" actions={<button className="btn secondary sm" disabled={a.busy} onClick={async () => { await a.run(() => post('/admin/payouts/retry', {}), 'Pending payouts processed'); reload(); }}>Retry pending payouts</button>}>
      <Alert>{error || a.error}</Alert><Alert kind="success">{a.ok}</Alert>
      {data?.length === 0 ? <Empty>No payments yet.</Empty> : (
        <div className="table-wrap"><table><thead><tr><th>Booking</th><th>Amount</th><th>Payment</th><th>Refunded</th><th>Commission</th><th>Payout</th></tr></thead>
          <tbody>{data?.map((p: any) => (
            <tr key={p.id}><td><Link to={'/bookings/' + p.booking_id}>#{p.booking_id}</Link> <Badge value={p.booking_status} /></td><td>{money(p.amount)}</td><td><Badge value={p.status} /></td><td>{Number(p.refunded_amount) ? money(p.refunded_amount) : '–'}</td><td>{p.commission_amount != null ? money(p.commission_amount) : '–'}</td>
              <td>{p.payout_status ? <><Badge value={p.payout_status} /> {money(p.net_amount)}{p.failure_reason && <div className="small dim">{p.failure_reason}</div>}</> : '–'}</td></tr>
          ))}</tbody></table></div>
      )}
    </Card>
  );
}

export function AuditLog() {
  const { data, error } = useLoad(() => get('/admin/audit'));
  return (
    <Card title="Audit log"><Alert>{error}</Alert>
      <div className="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
        <tbody>{data?.map((r: any) => <tr key={r.id}><td>{fmtDateTime(r.created_at)}</td><td>{r.actor || 'system'}</td><td>{nice(r.action)}</td><td className="small dim">{r.entity} {r.entity_id ?? ''} {r.detail ?? ''}</td></tr>)}</tbody></table></div>
    </Card>
  );
}

import { FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, post } from '../api';
import { useAuth } from '../auth';
import { Alert, Badge, Card, Empty, Field, fmtDateTime, money, nice, Tabs, useAction, useLoad } from '../components/ui';

export function Disputes() {
  const [tab, setTab] = useState('OPEN');
  const { data, error } = useLoad(() => get('/staff/disputes' + (tab === 'ALL' ? '' : '?status=' + tab)), [tab]);
  return (
    <Card title="Disputes">
      <Tabs tabs={[['OPEN', 'Open'], ['UNDER_REVIEW', 'Under review'], ['RESOLVED', 'Resolved'], ['ALL', 'All']]} active={tab} onChange={setTab} />
      <Alert>{error}</Alert>
      {data?.length === 0 ? <Empty>No disputes here.</Empty> : (
        <div className="table-wrap"><table><thead><tr><th>#</th><th>Booking</th><th>Parties</th><th>Reason</th><th>Amount</th><th>Status</th><th>Raised</th></tr></thead>
          <tbody>{data?.map((d: any) => (
            <tr key={d.id}><td><Link to={'/staff/disputes/' + d.id}>#{d.id}</Link></td><td><Link to={'/bookings/' + d.booking_id}>#{d.booking_id}</Link></td><td>{d.client_name} ↔ {d.professional_name}</td><td>{d.reason}</td><td>{money(d.total_amount)}</td><td><Badge value={d.status} /></td><td>{fmtDateTime(d.created_at)}</td></tr>
          ))}</tbody></table></div>
      )}
    </Card>
  );
}

export function DisputeDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data: d, error, reload } = useLoad(() => get('/staff/disputes/' + id), [id]);
  const [note, setNote] = useState('');
  const [resNote, setResNote] = useState('');
  const [type, setType] = useState('REFUND_CLIENT');
  const a = useAction();
  if (error) return <Alert>{error}</Alert>;
  if (!d) return <Empty>Loading…</Empty>;
  const isAdmin = user?.role === 'ADMIN';
  const open = d.status !== 'RESOLVED';
  const addNote = async (e: FormEvent) => { e.preventDefault(); if (await a.run(() => post(`/staff/disputes/${d.id}/notes`, { note }), 'Note added')) { setNote(''); reload(); } };
  const close = async () => { if (await a.run(() => post(`/staff/disputes/${d.id}/close`, { note: resNote }), 'Dispute closed')) reload(); };
  const resolve = async (e: FormEvent) => { e.preventDefault(); if (await a.run(() => post(`/staff/disputes/${d.id}/resolve`, { type, note: resNote }), 'Dispute resolved')) reload(); };
  return (
    <>
      <div className="row between"><h1>Dispute #{d.id}</h1><Badge value={d.status} /></div>
      <Alert>{a.error}</Alert><Alert kind="success">{a.ok}</Alert>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div>
          <Card title="Case">
            <table><tbody>
              <tr><th>Booking</th><td><Link to={'/bookings/' + d.booking_id}>#{d.booking_id}</Link> ({nice(d.booking_status)}) · {money(d.total_amount)} · payment {nice(d.payment_status)}</td></tr>
              <tr><th>Client</th><td>{d.client_name}</td></tr><tr><th>Professional</th><td>{d.professional_name}</td></tr>
              <tr><th>Raised by</th><td>{d.raised_by_name} on {fmtDateTime(d.created_at)}</td></tr>
              <tr><th>Reason</th><td>{d.reason}</td></tr><tr><th>Description</th><td>{d.description}</td></tr>
              {d.resolution_type && <tr><th>Resolution</th><td>{nice(d.resolution_type)} – {d.resolution_note}</td></tr>}
            </tbody></table>
          </Card>
          <Card title="Booking timeline"><ul className="timeline">{d.events.map((e: any, i: number) => <li key={i}><b>{nice(e.type)}</b> · {e.actor || 'system'} <span className="small dim">{fmtDateTime(e.created_at)}</span>{e.note && <div className="small dim">{e.note}</div>}</li>)}</ul></Card>
        </div>
        <div>
          <Card title="Conversation between parties">{d.messages.length === 0 ? <Empty>No messages.</Empty> : <div className="chat">{d.messages.map((m: any) => <div key={m.id} className="msg"><small>{m.sender_name} · {fmtDateTime(m.sent_at)}</small>{m.content}</div>)}</div>}
            <p className="small dim">{d.deliverables.length} delivered file(s) on record.</p></Card>
          {open && (
            <>
              <Card title="Review notes"><form onSubmit={addNote}><Field label="Add internal note (marks dispute under review)"><textarea value={note} onChange={(e) => setNote(e.target.value)} required minLength={3} /></Field><button className="btn secondary" disabled={a.busy}>Add note</button></form></Card>
              <Card title="Resolve">
                {!isAdmin && <Alert kind="info">Support staff can review and close a dispute with no financial action. Refunds and payment releases are done by an administrator.</Alert>}
                <form onSubmit={resolve}>
                  {isAdmin && <Field label="Outcome"><select value={type} onChange={(e) => setType(e.target.value)}><option value="REFUND_CLIENT">Refund the client in full</option><option value="RELEASE_PAYOUT">Release payment to the professional</option><option value="NO_ACTION">No financial action (booking continues)</option></select></Field>}
                  <Field label="Resolution note (sent to both parties)"><textarea value={resNote} onChange={(e) => setResNote(e.target.value)} required minLength={3} /></Field>
                  {isAdmin ? <button className="btn" disabled={a.busy}>Apply resolution</button> : <button type="button" className="btn secondary" disabled={a.busy || resNote.length < 3} onClick={close}>Close with no action</button>}
                </form>
              </Card>
            </>
          )}
        </div>
      </div>
    </>
  );
}

export function ReportedContent() {
  const [tab, setTab] = useState('OPEN');
  const { data, error, reload } = useLoad(() => get('/staff/reports?status=' + tab), [tab]);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const a = useAction();
  const act = async (id: number, action: 'HIDE' | 'DISMISS') => { if (await a.run(() => post(`/staff/reports/${id}/resolve`, { action, note: notes[id] || '' }))) reload(); };
  return (
    <Card title="Reported content">
      <Tabs tabs={[['OPEN', 'Open'], ['ACTION_TAKEN', 'Action taken'], ['DISMISSED', 'Dismissed']]} active={tab} onChange={setTab} />
      <Alert>{error || a.error}</Alert>
      {data?.length === 0 ? <Empty>No reports here.</Empty> : data?.map((r: any) => (
        <div key={r.id} className="card">
          <div className="row between"><b>{nice(r.target_type)} #{r.target_id}</b><span className="small dim">Reported by {r.reporter_name} · {fmtDateTime(r.created_at)}</span></div>
          <p><i>“{r.reason}”</i></p>
          <div className="small" style={{ background: '#f4f5f9', padding: 8, borderRadius: 8 }}>
            {r.target_type === 'PORTFOLIO_ITEM' && r.target && <>{r.target.title} – {r.target.description} {r.target.hidden && <Badge value="BLOCKED" />}</>}
            {r.target_type === 'REVIEW' && r.target && <>{'★'.repeat(r.target.rating)} {r.target.comment} {r.target.hidden && <Badge value="BLOCKED" />}</>}
            {r.target_type === 'PROFILE' && r.target && <>{r.target.full_name} – {r.target.headline} · {r.target.bio}</>}
          </div>
          {r.status === 'OPEN' ? (
            <div style={{ marginTop: 10 }}>
              <Field label="Decision note"><input value={notes[r.id] || ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} /></Field>
              <div className="row"><button className="btn danger sm" disabled={a.busy || (notes[r.id] || '').length < 3} onClick={() => act(r.id, 'HIDE')}>Hide content{r.target_type === 'PROFILE' ? ' / pull profile' : ''}</button><button className="btn secondary sm" disabled={a.busy || (notes[r.id] || '').length < 3} onClick={() => act(r.id, 'DISMISS')}>Dismiss</button></div>
            </div>
          ) : <p className="small dim">Decision: {r.resolution_note}</p>}
        </div>
      ))}
    </Card>
  );
}

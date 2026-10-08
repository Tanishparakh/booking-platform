import { FormEvent, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, post } from '../api';
import { useAuth } from '../auth';
import { Alert, Badge, Card, dateRange, Empty, Field, fmtDate, fmtDateTime, hhmm, Modal, money, nice, Tabs, useAction, useLoad } from '../components/ui';

export function BookingList() {
  const { user } = useAuth();
  const [tab, setTab] = useState('ALL');
  const { data, error } = useLoad(() => get('/bookings'));
  const rows = (data || []).filter((b: any) => tab === 'ALL' || (tab === 'ACTIVE' ? ['PENDING', 'CONFIRMED', 'DELIVERED', 'REVISION_REQUESTED', 'DISPUTED'].includes(b.status) : ['COMPLETED', 'DECLINED', 'EXPIRED', 'CANCELLED'].includes(b.status)));
  return (
    <Card title={user?.role === 'CLIENT' ? 'My bookings' : 'Booking requests & jobs'}>
      <Tabs tabs={[['ALL', 'All'], ['ACTIVE', 'Active'], ['PAST', 'Past']]} active={tab} onChange={setTab} />
      <Alert>{error}</Alert>
      {data && rows.length === 0 ? <Empty>Nothing here yet.{user?.role === 'CLIENT' && <> <Link to="/">Find a professional</Link>.</>}</Empty> : (
        <div className="table-wrap"><table>
          <thead><tr><th>#</th><th>{user?.role === 'CLIENT' ? 'Professional' : 'Client'}</th><th>Event</th><th>Dates</th><th>Total</th><th>Status</th></tr></thead>
          <tbody>{rows.map((b: any) => (
            <tr key={b.id}><td><Link to={'/bookings/' + b.id}>#{b.id}</Link></td><td>{user?.role === 'CLIENT' ? b.professional_name : b.client_name}</td><td>{b.event_type}</td>
              <td>{dateRange(b.start_date, b.end_date)}</td><td>{money(b.total_amount)}</td><td><Badge value={b.status} /></td></tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
}

export function BookingDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data: b, error, reload } = useLoad(() => get('/bookings/' + id), [id]);
  const a = useAction();
  const [modal, setModal] = useState<'cancel' | 'revision' | 'dispute' | 'review' | 'decline' | 'invoice' | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!b) return <Empty>Loading…</Empty>;
  const role = user!.role;
  const isClient = role === 'CLIENT', isPro = role === 'PROFESSIONAL';
  const act = (path: string, body?: any, ok = '') => a.run(async () => { const r = await post(`/bookings/${b.id}/${path}`, body); reload(); return r; }, ok);
  const s = b.status;
  const round = b.revision_round;
  const currentFiles = b.deliverables.filter((d: any) => d.round === round && d.status === 'AVAILABLE');

  return (
    <>
      <div className="row between"><h1>Booking #{b.id}</h1><Badge value={s} /></div>
      <Alert>{a.error}</Alert><Alert kind="success">{a.ok}</Alert>
      {s === 'PENDING' && isClient && <Alert kind="info">Waiting for {b.professional_name} to respond (until {fmtDateTime(b.expires_at)}). Your card is authorized but not charged yet.</Alert>}
      {s === 'DISPUTED' && <Alert kind="info">This booking is under dispute. Our team is reviewing it; payment stays on hold.</Alert>}
      {b.status_reason && ['DECLINED', 'CANCELLED', 'EXPIRED', 'REVISION_REQUESTED'].includes(s) && <Alert kind="info">{nice(s)}: {b.status_reason}</Alert>}

      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div>
          <Card title="Details">
            <table><tbody>
              <tr><th>{isClient ? 'Professional' : 'Client'}</th><td>{isClient ? <Link to={'/professionals/' + b.professional_id}>{b.professional_name}</Link> : b.client_name}</td></tr>
              {!isClient && !isPro && <tr><th>Professional</th><td>{b.professional_name}</td></tr>}
              <tr><th>Package</th><td>{b.package_name}</td></tr>
              <tr><th>Event</th><td>{b.event_type}</td></tr>
              <tr><th>Dates</th><td>{dateRange(b.start_date, b.end_date)}, {hhmm(b.start_time)}–{hhmm(b.end_time)} daily</td></tr>
              <tr><th>Venue</th><td>{b.venue}</td></tr>
              {b.notes && <tr><th>Notes</th><td>{b.notes}</td></tr>}
              <tr><th>Total</th><td className="bold">{money(b.total_amount)}</td></tr>
              {(isPro || role === 'ADMIN') && b.commission_amount != null && <tr><th>Platform commission</th><td>{money(b.commission_amount)} ({b.commission_percent}%) → payout {money(b.payout_amount)}</td></tr>}
              <tr><th>Revisions used</th><td>{round}</td></tr>
            </tbody></table>
          </Card>

          <Card title="Payment">
            {b.payment ? (
              <>
                <table><tbody>
                  <tr><th>Status</th><td><Badge value={b.payment.status} /></td></tr>
                  {b.payment.card_last4 && <tr><th>Card</th><td>{b.payment.card_brand} •••• {b.payment.card_last4}</td></tr>}
                  {Number(b.payment.refunded_amount) > 0 && <tr><th>Refunded</th><td>{money(b.payment.refunded_amount)}</td></tr>}
                  {b.payout && <tr><th>Payout</th><td><Badge value={b.payout.status} /> {money(b.payout.net_amount)}{b.payout.failure_reason ? ` – ${b.payout.failure_reason}` : ''}</td></tr>}
                </tbody></table>
                <div style={{ marginTop: 12 }}>
                  <button className="btn secondary sm" onClick={() => setModal('invoice')}>
                    🧾 View & Print Receipt
                  </button>
                </div>
              </>
            ) : <Empty>No payment recorded.</Empty>}
            <p className="small dim">Funds are captured when the professional accepts, held by the platform, and released to the professional only after you approve the delivered work.</p>
          </Card>

          <Card title="Activity">
            <ul className="timeline">{b.events.map((e: any, i: number) => <li key={i}><b>{nice(e.type)}</b> {e.actor ? `· ${e.actor}` : '· system'} <span className="dim small">{fmtDateTime(e.created_at)}</span>{e.note && <div className="small dim">{e.note}</div>}</li>)}</ul>
          </Card>
        </div>

        <div>
          <Card title="Actions">
            <div className="row">
              {isPro && s === 'PENDING' && <><button className="btn" disabled={a.busy} onClick={() => act('accept', {}, 'Booking accepted')}>Accept</button><button className="btn danger" onClick={() => setModal('decline')}>Decline</button></>}
              {(isClient || isPro) && ['PENDING', 'CONFIRMED'].includes(s) && <button className="btn secondary" onClick={() => setModal('cancel')}>Cancel booking</button>}
              {isPro && s === 'CONFIRMED' && currentFiles.length > 0 && <button className="btn" disabled={a.busy} onClick={() => act('deliver', {}, 'Marked as delivered')}>Mark as delivered</button>}
              {isPro && s === 'REVISION_REQUESTED' && currentFiles.length > 0 && <button className="btn" disabled={a.busy} onClick={() => act('deliver', {}, 'Revision delivered')}>Deliver revision</button>}
              {isClient && s === 'DELIVERED' && <><button className="btn" disabled={a.busy} onClick={() => act('approve', {}, 'Approved. Thank you!')}>Approve & release payment</button><button className="btn secondary" onClick={() => setModal('revision')}>Request revision</button></>}
              {isClient && s === 'COMPLETED' && !b.review && <button className="btn" onClick={() => setModal('review')}>Leave a review</button>}
              {(isClient || isPro) && ['CONFIRMED', 'DELIVERED', 'REVISION_REQUESTED'].includes(s) && <button className="btn danger" onClick={() => setModal('dispute')}>Raise a dispute</button>}
            </div>
            {!(isClient || isPro) && <p className="dim small">Read-only view for staff.</p>}
            {b.review && <p>Review: {'★'.repeat(b.review.rating)} {b.review.comment}</p>}
            {b.dispute && <p className="small">Dispute: <Badge value={b.dispute.status} /> {b.dispute.reason}</p>}
          </Card>

          <Files b={b} canUpload={isPro && ['CONFIRMED', 'REVISION_REQUESTED'].includes(s)} reload={reload} role={role} />
          {(isClient || isPro) && <Messages bookingId={b.id} meId={user!.id} disabled={['DECLINED', 'EXPIRED', 'CANCELLED'].includes(s)} />}
        </div>
      </div>

      {modal === 'cancel' && <ReasonModal title="Cancel booking" label="Reason (optional)" required={false} cta="Cancel booking" danger onClose={() => setModal(null)}
        extra={isClient && s === 'CONFIRMED' ? 'Cancelling close to the event date may only qualify for a partial refund (see platform policy).' : ''}
        onSubmit={async (v) => { const r = await post(`/bookings/${b.id}/cancel`, { reason: v || undefined }); a.setOk(r.message || 'Cancelled'); reload(); }} />}
      {modal === 'decline' && <ReasonModal title="Decline request" label="Reason (optional)" required={false} cta="Decline" danger onClose={() => setModal(null)} onSubmit={async (v) => { await post(`/bookings/${b.id}/decline`, { reason: v || undefined }); reload(); }} />}
      {modal === 'revision' && <ReasonModal title="Request a revision" label="What should be changed?" required cta="Send request" onClose={() => setModal(null)} onSubmit={async (v) => { await post(`/bookings/${b.id}/revision`, { note: v }); reload(); }} />}
      {modal === 'dispute' && <DisputeModal id={b.id} onClose={() => setModal(null)} done={reload} />}
      {modal === 'review' && <ReviewModal id={b.id} onClose={() => setModal(null)} done={reload} />}
      {modal === 'invoice' && <InvoiceModal b={b} onClose={() => setModal(null)} />}
    </>
  );
}

function ReasonModal({ title, label, required, cta, danger, extra, onClose, onSubmit }: { title: string; label: string; required: boolean; cta: string; danger?: boolean; extra?: string; onClose: () => void; onSubmit: (v: string) => Promise<void> }) {
  const [v, setV] = useState('');
  const a = useAction();
  const submit = async (e: FormEvent) => { e.preventDefault(); const r = await a.run(() => onSubmit(v).then(() => true)); if (r) onClose(); };
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit}><Alert>{a.error}</Alert>{extra && <Alert kind="info">{extra}</Alert>}
        <Field label={label}><textarea value={v} onChange={(e) => setV(e.target.value)} required={required} minLength={required ? 5 : 0} /></Field>
        <button className={'btn ' + (danger ? 'danger' : '')} disabled={a.busy}>{cta}</button></form>
    </Modal>
  );
}

function DisputeModal({ id, onClose, done }: { id: number; onClose: () => void; done: () => void }) {
  const [reason, setReason] = useState('Quality of work');
  const [description, setDescription] = useState('');
  const a = useAction();
  const submit = async (e: FormEvent) => { e.preventDefault(); if (await a.run(() => post(`/bookings/${id}/dispute`, { reason, description }))) { done(); onClose(); } };
  return (
    <Modal title="Raise a dispute" onClose={onClose}>
      <form onSubmit={submit}><Alert>{a.error}</Alert>
        <Alert kind="info">Payment stays on hold while our team reviews. Only an administrator can refund or release funds.</Alert>
        <Field label="Reason"><select value={reason} onChange={(e) => setReason(e.target.value)}>{['Quality of work', 'No show / late', 'Files not delivered', 'Payment issue', 'Other'].map((r) => <option key={r}>{r}</option>)}</select></Field>
        <Field label="Describe the problem"><textarea value={description} onChange={(e) => setDescription(e.target.value)} required minLength={10} /></Field>
        <button className="btn danger" disabled={a.busy}>Submit dispute</button></form>
    </Modal>
  );
}

function ReviewModal({ id, onClose, done }: { id: number; onClose: () => void; done: () => void }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const a = useAction();
  const submit = async (e: FormEvent) => { e.preventDefault(); if (await a.run(() => post(`/bookings/${id}/review`, { rating, comment: comment || undefined }))) { done(); onClose(); } };
  return (
    <Modal title="Rate your experience" onClose={onClose}>
      <form onSubmit={submit}><Alert>{a.error}</Alert>
        <Field label="Rating"><select value={rating} onChange={(e) => setRating(Number(e.target.value))}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{'★'.repeat(n)} ({n})</option>)}</select></Field>
        <Field label="Comment (optional)"><textarea value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
        <button className="btn" disabled={a.busy}>Submit review</button></form>
    </Modal>
  );
}

function Files({ b, canUpload, reload, role }: { b: any; canUpload: boolean; reload: () => void; role: string }) {
  const input = useRef<HTMLInputElement>(null);
  const a = useAction();
  const upload = async () => {
    const files = input.current?.files;
    if (!files?.length) return;
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append('files', f));
    await a.run(async () => { await post(`/bookings/${b.id}/deliverables`, fd); if (input.current) input.current.value = ''; reload(); }, 'Files uploaded');
  };
  const download = async (d: any) => {
    const r = await a.run(() => post(`/bookings/${b.id}/deliverables/${d.id}/link`));
    if (r) window.location.href = r.url;
  };
  const canDownload = role !== 'CLIENT' || ['DELIVERED', 'REVISION_REQUESTED', 'COMPLETED', 'DISPUTED'].includes(b.status);
  return (
    <Card title="Delivered files">
      <Alert>{a.error}</Alert><Alert kind="success">{a.ok}</Alert>
      {b.deliverables.length === 0 ? <Empty>No files uploaded yet.</Empty> : (
        <table><tbody>{b.deliverables.map((d: any) => (
          <tr key={d.id}><td>{d.file_name}<div className="small dim">Round {d.round} · {(d.file_size / 1048576).toFixed(2)} MB</div></td>
            <td style={{ textAlign: 'right' }}>{d.status === 'EXPIRED' ? <span className="badge gray">Expired</span> : canDownload ? <button className="btn secondary sm" onClick={() => download(d)}>Download</button> : <span className="small dim">Available after delivery</span>}</td></tr>
        ))}</tbody></table>
      )}
      {canUpload && (
        <div style={{ marginTop: 10 }}>
          <input ref={input} type="file" multiple accept="image/*,video/*,.zip,.pdf" />
          <div className="row" style={{ marginTop: 8 }}><button className="btn secondary sm" disabled={a.busy} onClick={upload}>Upload files</button></div>
          <p className="small dim">Upload your final files, then use “Mark as delivered”. Links expire a few minutes after they are generated.</p>
        </div>
      )}
    </Card>
  );
}

function Messages({ bookingId, meId, disabled }: { bookingId: number; meId: number; disabled: boolean }) {
  const { data, reload } = useLoad(() => get(`/bookings/${bookingId}/messages`), [bookingId]);
  const [text, setText] = useState('');
  const a = useAction();
  const send = async (e: FormEvent) => { e.preventDefault(); if (await a.run(() => post(`/bookings/${bookingId}/messages`, { content: text }))) { setText(''); reload(); } };
  return (
    <Card title="Messages" actions={<button className="btn ghost sm" onClick={reload}>Refresh</button>}>
      <div className="chat">{data?.length ? data.map((m: any) => <div key={m.id} className={'msg' + (m.sender_id === meId ? ' me' : '')}><small>{m.sender_name} · {fmtDateTime(m.sent_at)}</small>{m.content}</div>) : <Empty>No messages yet.</Empty>}</div>
      <Alert>{a.error}</Alert>
      {disabled ? <p className="small dim">Messaging is closed for this booking.</p> : <form className="row" onSubmit={send}><input style={{ flex: 1 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message…" required maxLength={2000} /><button className="btn" disabled={a.busy}>Send</button></form>}
    </Card>
  );
}

function InvoiceModal({ b, onClose }: { b: any; onClose: () => void }) {
  const invoiceNum = `FB-INV-${String(b.id).padStart(5, '0')}`;
  const printReceipt = () => window.print();

  return (
    <Modal title="Booking Receipt & Invoice" onClose={onClose}>
      <div id="printable-receipt" style={{ padding: '4px' }}>
        <div className="row between" style={{ borderBottom: '2px solid var(--line)', paddingBottom: 12, marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, color: 'var(--brand)', fontSize: 22 }}>FrameBook</h2>
            <div className="small dim">Creative Freelancer Marketplace</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="bold">{invoiceNum}</div>
            <div className="small dim">Date: {fmtDate(b.created_at)}</div>
            <div style={{ marginTop: 4 }}><Badge value={b.payment?.status || b.status} /></div>
          </div>
        </div>

        <div className="grid g2" style={{ marginBottom: 16 }}>
          <div style={{ background: '#f8fafc', padding: 10, borderRadius: 8 }}>
            <div className="small dim bold" style={{ letterSpacing: '0.04em' }}>BILLED TO (CLIENT)</div>
            <b>{b.client_name}</b>
            <div className="small dim">Venue: {b.venue}</div>
          </div>
          <div style={{ background: '#f8fafc', padding: 10, borderRadius: 8 }}>
            <div className="small dim bold" style={{ letterSpacing: '0.04em' }}>CREATIVE PROFESSIONAL</div>
            <b>{b.professional_name}</b>
            <div className="small dim">Event: {b.event_type}</div>
          </div>
        </div>

        <table style={{ marginBottom: 16 }}>
          <thead>
            <tr>
              <th>Service description</th>
              <th>Shoot dates</th>
              <th style={{ textAlign: 'right' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <b>{b.package_name}</b>
                <div className="small dim">{b.event_type} ({hhmm(b.start_time)}–{hhmm(b.end_time)} daily)</div>
              </td>
              <td>{dateRange(b.start_date, b.end_date)}</td>
              <td style={{ textAlign: 'right' }}>{money(b.total_amount)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={2} style={{ textAlign: 'right', borderTop: '2px solid var(--line)' }}>Total Paid:</th>
              <th style={{ textAlign: 'right', borderTop: '2px solid var(--line)', fontSize: 16, color: 'var(--brand)' }}>{money(b.total_amount)}</th>
            </tr>
            {b.payment?.card_last4 && (
              <tr>
                <td colSpan={3} className="small dim" style={{ textAlign: 'right', borderTop: 'none' }}>
                  Payment Method: {b.payment.card_brand} •••• {b.payment.card_last4} (Escrow Protected)
                </td>
              </tr>
            )}
          </tfoot>
        </table>

        <div className="hint" style={{ fontSize: 12, marginBottom: 16 }}>
          🔒 <b>Escrow Protection:</b> Payment held securely by FrameBook until client approval of final deliverables.
        </div>

        <div className="row between no-print">
          <button className="btn secondary" onClick={onClose}>Close</button>
          <button className="btn" onClick={printReceipt}>🖨️ Print / Save PDF</button>
        </div>
      </div>
    </Modal>
  );
}

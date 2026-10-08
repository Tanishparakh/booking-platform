import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { get, post } from '../api';
import { useAuth } from '../auth';
import { Alert, Badge, Card, Empty, Field, hhmm, fmtDate, Modal, money, Stars, useAction, useLoad } from '../components/ui';

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;

export default function ProfessionalPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data: p, error } = useLoad(() => get('/public/professionals/' + id), [id]);
  const { data: avail } = useLoad(() => get(`/public/professionals/${id}/availability`), [id]);
  const [report, setReport] = useState<{ type: string; id: number } | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!p) return <Empty>Loading…</Empty>;
  const free = (avail || []).filter((a: any) => a.status === 'AVAILABLE');

  return (
    <>
      <Card>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          {p.has_image ? <img className="avatar" src={`/api/public/professionals/${p.id}/image`} alt="" /> : <div className="avatar">{p.full_name[0]}</div>}
          <div style={{ flex: 1 }}>
            <h1>{p.full_name}</h1>
            <div className="dim">{p.headline} · {p.operating_city} · {p.professional_type === 'PHOTOGRAPHER' ? 'Photographer' : 'Videographer'}</div>
            <div className="row"><Stars value={p.avg_rating} /> <span className="dim small">{p.review_count ? `${Number(p.avg_rating).toFixed(1)} from ${p.review_count} review(s)` : 'No reviews yet'}</span> <span className="badge green">Verified</span></div>
          </div>
          {user && (user.role === 'CLIENT' || user.role === 'PROFESSIONAL') && user.id !== p.id && <button className="btn ghost sm" onClick={() => setReport({ type: 'PROFILE', id: p.id })}>Report</button>}
        </div>
        {p.bio && <p>{p.bio}</p>}
        <div className="small dim">{p.experience_years ? `${p.experience_years} years experience · ` : ''}{p.specialization}{p.equipment ? ` · Equipment: ${p.equipment}` : ''}</div>
      </Card>

      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div>
          <Card title="Packages">
            {p.packages.length === 0 ? <Empty>No packages yet.</Empty> : (
              <table><tbody>{p.packages.map((k: any) => <tr key={k.id}><td><b>{k.name}</b><div className="small dim">{k.description}</div></td><td>{k.duration_hours} h / day</td><td className="bold">{money(k.price)}<div className="small dim">per day</div></td></tr>)}</tbody></table>
            )}
          </Card>
          <Card title="Portfolio">
            {p.portfolio.length === 0 ? <Empty>No portfolio items yet.</Empty> : (
              <div className="gallery">{p.portfolio.map((i: any) => (
                <figure key={i.id} style={{ margin: 0 }}>
                  {i.media_type === 'VIDEO' ? <video controls preload="metadata" src={`/api/public/portfolio/${i.id}/media`} /> : <img loading="lazy" src={`/api/public/portfolio/${i.id}/media`} alt={i.title} />}
                  <figcaption className="small">{i.title} {user && user.role !== 'ADMIN' && user.role !== 'SUPPORT' && <button className="btn ghost sm" onClick={() => setReport({ type: 'PORTFOLIO_ITEM', id: i.id })}>Report</button>}</figcaption>
                </figure>
              ))}</div>
            )}
          </Card>
          <Card title="Reviews">
            {p.reviews.length === 0 ? <Empty>No reviews yet.</Empty> : p.reviews.map((r: any) => (
              <div key={r.id} style={{ marginBottom: 12 }}>
                <div className="row between"><div><Stars value={r.rating} /> <b>{r.client_name}</b> <span className="dim small">{fmtDate(r.created_at)}</span></div>
                  {user && user.role === 'CLIENT' && <button className="btn ghost sm" onClick={() => setReport({ type: 'REVIEW', id: r.id })}>Report</button>}</div>
                <div>{r.comment}</div>
              </div>
            ))}
          </Card>
        </div>
        <div>
          <Card title="Availability (next 90 days)">
            {free.length === 0 ? <Empty>No open dates right now.</Empty> : (
              <div className="row small" style={{ gap: 6 }}>
                {free.slice(0, 30).map((a: any) => (
                  <span
                    key={a.slot_date}
                    className="badge green date-chip"
                    title={`Click to book ${fmtDate(a.slot_date)} (${hhmm(a.start_time)}–${hhmm(a.end_time)})`}
                  >
                    {fmtDate(a.slot_date)}
                  </span>
                ))}
                {free.length > 30 && <span className="dim">+{free.length - 30} more</span>}
              </div>
            )}
            <p className="small dim" style={{ marginTop: 8 }}>Click any open day below to select your shoot dates.</p>
          </Card>
          <BookingForm pro={p} availableSlots={free} />
        </div>
      </div>
      {report && <ReportModal target={report} onClose={() => setReport(null)} />}
    </>
  );
}

function ReportModal({ target, onClose }: { target: { type: string; id: number }; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const a = useAction();
  const submit = async (e: FormEvent) => { e.preventDefault(); await a.run(() => post('/account/reports', { targetType: target.type, targetId: target.id, reason }), 'Report sent. Thank you.'); };
  return (
    <Modal title="Report content" onClose={onClose}>
      <form onSubmit={submit}>
        <Alert>{a.error}</Alert><Alert kind="success">{a.ok}</Alert>
        <Field label="What is wrong?"><textarea value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} /></Field>
        <button className="btn" disabled={a.busy || !!a.ok}>Send report</button>
      </form>
    </Modal>
  );
}

function BookingForm({ pro, availableSlots = [] }: { pro: any; availableSlots?: any[] }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState<any>({
    packageId: pro.packages[0]?.id || '',
    startTime: '09:00',
    endTime: '17:00',
    card: '4242 4242 4242 4242',
    expiry: '12/28',
    cvv: '123'
  });
  const a = useAction();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  if (!user) return <Card title="Book this professional"><p>Please <Link to="/login" state={{ from: `/professionals/${pro.id}` }}>sign in</Link> or <Link to="/register">create a client account</Link> to book.</p></Card>;
  if (user.role !== 'CLIENT') return <Card title="Book this professional"><p className="dim">Only client accounts can make bookings.</p></Card>;
  if (!pro.packages.length) return <Card title="Book this professional"><Empty>This professional has not published any packages yet.</Empty></Card>;
  const pkg = pro.packages.find((k: any) => String(k.id) === String(f.packageId));
  const end = f.endDate || f.startDate;
  const days = f.startDate && end >= f.startDate ? daysBetween(f.startDate, end) : 0;
  const total = pkg ? Number(pkg.price) * days : 0;

  const selectDate = (dateStr: string, slot?: any) => {
    if (!f.startDate || (f.startDate && f.endDate)) {
      setF({
        ...f,
        startDate: dateStr,
        endDate: '',
        startTime: slot?.start_time ? hhmm(slot.start_time) : f.startTime,
        endTime: slot?.end_time ? hhmm(slot.end_time) : f.endTime,
      });
    } else if (f.startDate && !f.endDate) {
      if (dateStr >= f.startDate) {
        setF({ ...f, endDate: dateStr });
      } else {
        setF({ ...f, startDate: dateStr, endDate: f.startDate });
      }
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const b = await a.run(() => post('/bookings', {
      packageId: Number(f.packageId), eventType: f.eventType, startDate: f.startDate, endDate: end, startTime: f.startTime, endTime: f.endTime,
      venue: f.venue, notes: f.notes || undefined, card: { number: f.card, expiry: f.expiry, cvv: f.cvv },
    }));
    if (b) nav('/bookings/' + b.id);
  };
  return (
    <Card title="Request a booking">
      <form onSubmit={submit}>
        <Alert>{a.error}</Alert>
        <Field label="Package"><select value={f.packageId} onChange={set('packageId')}>{pro.packages.map((k: any) => <option key={k.id} value={k.id}>{k.name} – {money(k.price)}/day</option>)}</select></Field>

        {/* Quick Date Picker */}
        {availableSlots.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div className="small dim bold" style={{ marginBottom: 6 }}>📅 QUICK SELECT AVAILABLE DATES</div>
            <div className="row" style={{ gap: 6, maxHeight: 110, overflowY: 'auto', padding: 2 }}>
              {availableSlots.slice(0, 14).map((slot: any) => {
                const isSelected = f.startDate === slot.slot_date || f.endDate === slot.slot_date;
                const isInRange = f.startDate && f.endDate && slot.slot_date >= f.startDate && slot.slot_date <= f.endDate;
                return (
                  <button
                    type="button"
                    key={slot.slot_date}
                    className={`badge date-chip ${isSelected ? 'selected' : isInRange ? 'blue' : 'green'}`}
                    style={{ border: 'none', padding: '6px 10px', fontSize: 12 }}
                    onClick={() => selectDate(slot.slot_date, slot)}
                  >
                    {fmtDate(slot.slot_date)}
                  </button>
                );
              })}
            </div>
            <div className="small dim" style={{ marginTop: 4 }}>
              {f.startDate && !f.endDate && `Selected start: ${fmtDate(f.startDate)}. Click another date to make it multi-day, or proceed.`}
              {f.startDate && f.endDate && `Selected: ${fmtDate(f.startDate)} to ${fmtDate(f.endDate)} (${days} days)`}
            </div>
          </div>
        )}

        <Field label="Event type"><input value={f.eventType || ''} onChange={set('eventType')} placeholder="Wedding, corporate event, shoot…" required minLength={2} /></Field>
        <div className="grid g2">
          <Field label="Start date"><input type="date" value={f.startDate || ''} onChange={set('startDate')} required min={new Date().toISOString().slice(0, 10)} /></Field>
          <Field label="End date" hint="Leave empty for a single day"><input type="date" value={f.endDate || ''} onChange={set('endDate')} min={f.startDate} /></Field>
          <Field label="Start time"><input type="time" value={f.startTime} onChange={set('startTime')} required /></Field>
          <Field label="End time"><input type="time" value={f.endTime} onChange={set('endTime')} required /></Field>
        </div>
        <Field label="Venue"><input value={f.venue || ''} onChange={set('venue')} required minLength={2} /></Field>
        <Field label="Notes (optional)"><textarea value={f.notes || ''} onChange={set('notes')} /></Field>
        <h3 style={{ margin: '8px 0' }}>Payment (demo gateway)</h3>
        <div className="hint">Test card <b>4242 4242 4242 4242</b> is prefilled and approved. Funds are only <i>authorized</i> initially and held safely in platform escrow.</div>
        <Field label="Card number"><input inputMode="numeric" value={f.card} onChange={set('card')} placeholder="4242 4242 4242 4242" required autoComplete="off" /></Field>
        <div className="grid g2">
          <Field label="Expiry (MM/YY)"><input value={f.expiry} onChange={set('expiry')} placeholder="12/28" required autoComplete="off" /></Field>
          <Field label="Security code"><input value={f.cvv} onChange={set('cvv')} inputMode="numeric" maxLength={4} required autoComplete="off" /></Field>
        </div>
        <div className="row between" style={{ marginBottom: 12 }}><span>{days > 0 ? `${days} day(s)` : 'Choose dates'}</span><b>Total {money(total)}</b></div>
        <button className="btn" disabled={a.busy || days < 1}>{a.busy ? 'Processing…' : 'Send request & authorize payment'}</button>
      </form>
    </Card>
  );
}
void Badge;

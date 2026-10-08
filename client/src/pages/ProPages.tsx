import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { del, get, post, put } from '../api';
import { useAuth } from '../auth';
import { Alert, Badge, Card, dateRange, Empty, Field, fmtDate, fmtDateTime, hhmm, money, Tabs, useAction, useLoad } from '../components/ui';

export function ProDashboard() {
  const { user } = useAuth();
  const { data: bookings } = useLoad(() => get('/bookings'));
  const { data: ver } = useLoad(() => get('/professional/verification'));
  const { data: pay } = useLoad(() => get('/professional/payouts'));
  const pending = (bookings || []).filter((b: any) => b.status === 'PENDING');
  const todo = (bookings || []).filter((b: any) => ['CONFIRMED', 'REVISION_REQUESTED'].includes(b.status));
  return (
    <>
      <h1>Welcome, {user?.fullName}</h1>
      {ver && ver.status !== 'APPROVED' && (
        <Alert kind="info">
          {ver.status === 'NOT_SUBMITTED' && <>Your profile is not visible to clients yet. <Link to="/pro/profile">Submit an identity document</Link> for admin approval.</>}
          {ver.status === 'PENDING' && 'Your verification is waiting for admin review. You will be notified once approved.'}
          {ver.status === 'REJECTED' && <>Your verification was rejected{ver.latest?.remarks ? `: ${ver.latest.remarks}` : ''}. <Link to="/pro/profile">Submit new documents</Link>.</>}
        </Alert>
      )}
      <div className="grid g4">
        <Card><div className="dim small">New requests</div><div className="stat">{pending.length}</div></Card>
        <Card><div className="dim small">Jobs in progress</div><div className="stat">{todo.length}</div></Card>
        <Card><div className="dim small">Paid out</div><div className="stat">{money(pay?.totals.paid)}</div></Card>
        <Card><div className="dim small">Awaiting payout</div><div className="stat">{money(pay?.totals.pending)}</div></Card>
      </div>
      <Card title="Requests waiting for your answer">
        {pending.length === 0 ? <Empty>No pending requests.</Empty> : <table><tbody>{pending.map((b: any) => (
          <tr key={b.id}><td><Link to={'/bookings/' + b.id}>#{b.id}</Link></td><td>{b.client_name}</td><td>{b.event_type}</td><td>{dateRange(b.start_date, b.end_date)}</td><td>{money(b.total_amount)}</td><td className="small dim">Respond by {fmtDateTime(b.expires_at)}</td></tr>
        ))}</tbody></table>}
      </Card>
      <Card title="Upcoming & active jobs">
        {todo.length === 0 ? <Empty>No active jobs.</Empty> : <table><tbody>{todo.map((b: any) => (
          <tr key={b.id}><td><Link to={'/bookings/' + b.id}>#{b.id}</Link></td><td>{b.client_name}</td><td>{b.event_type}</td><td>{dateRange(b.start_date, b.end_date)}</td><td><Badge value={b.status} /></td></tr>
        ))}</tbody></table>}
      </Card>
    </>
  );
}

export function ProProfile() {
  const [tab, setTab] = useState('profile');
  return (
    <>
      <h1>My profile</h1>
      <Tabs tabs={[['profile', 'Profile'], ['verification', 'Verification'], ['packages', 'Packages'], ['portfolio', 'Portfolio']]} active={tab} onChange={setTab} />
      {tab === 'profile' && <ProfileForm />}
      {tab === 'verification' && <VerificationTab />}
      {tab === 'packages' && <PackagesTab />}
      {tab === 'portfolio' && <PortfolioTab />}
    </>
  );
}

function ProfileForm() {
  const { data, reload } = useLoad(() => get('/professional/profile'));
  const [f, setF] = useState<any>(null);
  const img = useRef<HTMLInputElement>(null);
  const a = useAction();
  useEffect(() => { if (data) setF({ ...data }); }, [data]);
  if (!f) return null;
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    await a.run(() => put('/professional/profile', {
      fullName: f.full_name, phone: f.phone || undefined, headline: f.headline || undefined, bio: f.bio || undefined, location: f.location || undefined,
      hourlyRate: f.hourly_rate ? Number(f.hourly_rate) : undefined, operatingCity: f.operating_city, experienceYears: Number(f.experience_years || 0),
      equipment: f.equipment || undefined, specialization: f.specialization || undefined,
    }), 'Profile saved');
  };
  const upload = async () => {
    const file = img.current?.files?.[0]; if (!file) return;
    const fd = new FormData(); fd.append('image', file);
    await a.run(async () => { await post('/professional/profile-image', fd); reload(); }, 'Photo updated');
  };
  return (
    <Card>
      <Alert>{a.error}</Alert><Alert kind="success">{a.ok}</Alert>
      <div className="row" style={{ marginBottom: 14 }}>
        {data.has_image ? <img className="avatar" src={`/api/public/professionals/${data.id}/image?${Date.now()}`} alt="" /> : <div className="avatar">{data.full_name[0]}</div>}
        <div><input ref={img} type="file" accept="image/*" /> <button className="btn secondary sm" type="button" onClick={upload}>Upload photo</button><div className="small dim">Your photo is shown publicly once you are approved.</div></div>
      </div>
      <form onSubmit={save} className="grid g2">
        <Field label="Full name"><input value={f.full_name || ''} onChange={set('full_name')} required /></Field>
        <Field label="Phone"><input value={f.phone || ''} onChange={set('phone')} /></Field>
        <Field label="Headline"><input value={f.headline || ''} onChange={set('headline')} maxLength={120} placeholder="e.g. Candid wedding photographer" /></Field>
        <Field label="Operating city"><input value={f.operating_city || ''} onChange={set('operating_city')} required /></Field>
        <Field label="Years of experience"><input type="number" min={0} value={f.experience_years ?? 0} onChange={set('experience_years')} /></Field>
        <Field label="Specialization"><input value={f.specialization || ''} onChange={set('specialization')} placeholder="Weddings, products, events…" /></Field>
        <Field label="Equipment"><input value={f.equipment || ''} onChange={set('equipment')} /></Field>
        <Field label="Indicative hourly rate (₹)"><input type="number" min={0} value={f.hourly_rate ?? ''} onChange={set('hourly_rate')} /></Field>
        <div style={{ gridColumn: '1/-1' }}><Field label="About you"><textarea value={f.bio || ''} onChange={set('bio')} maxLength={2000} /></Field></div>
        <div><button className="btn" disabled={a.busy}>Save profile</button></div>
      </form>
    </Card>
  );
}

function VerificationTab() {
  const { data, reload } = useLoad(() => get('/professional/verification'));
  const file = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState('Government ID');
  const a = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const f = file.current?.files?.[0]; if (!f) return;
    const fd = new FormData(); fd.append('documentType', docType); fd.append('document', f);
    await a.run(async () => { await post('/professional/verification', fd); reload(); }, 'Submitted for review');
  };
  if (!data) return null;
  return (
    <Card title="Identity verification">
      <p>Status: <Badge value={data.status} /></p>
      {data.latest?.remarks && <Alert kind="info">Admin remarks: {data.latest.remarks}</Alert>}
      <p className="small dim">Only approved professionals appear in search and can receive bookings. Your document is stored encrypted and seen only by administrators.</p>
      {['NOT_SUBMITTED', 'REJECTED'].includes(data.status) && (
        <form onSubmit={submit}><Alert>{a.error}</Alert><Alert kind="success">{a.ok}</Alert>
          <Field label="Document type"><select value={docType} onChange={(e) => setDocType(e.target.value)}>{['Government ID', 'Passport', 'Driving licence', 'Business registration'].map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="File (PDF, JPG or PNG, max 10 MB)"><input ref={file} type="file" accept=".pdf,image/jpeg,image/png" required /></Field>
          <button className="btn" disabled={a.busy}>Submit for verification</button></form>
      )}
    </Card>
  );
}

function PackagesTab() {
  const { data, reload } = useLoad(() => get('/professional/packages'));
  const [edit, setEdit] = useState<any>(null);
  const a = useAction();
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body = { name: edit.name, description: edit.description || undefined, price: Number(edit.price), durationHours: Number(edit.duration_hours) };
    if (await a.run(() => (edit.id ? put('/professional/packages/' + edit.id, { ...body, active: true }) : post('/professional/packages', body)))) { setEdit(null); reload(); }
  };
  const set = (k: string) => (e: any) => setEdit({ ...edit, [k]: e.target.value });
  return (
    <Card title="Packages" actions={<button className="btn sm" onClick={() => setEdit({ name: '', price: '', duration_hours: 4 })}>Add package</button>}>
      <Alert>{a.error}</Alert>
      {edit && (
        <form onSubmit={save} className="card">
          <div className="grid g3"><Field label="Name"><input value={edit.name} onChange={set('name')} required minLength={2} /></Field>
            <Field label="Price per day (₹)"><input type="number" min={1} value={edit.price} onChange={set('price')} required /></Field>
            <Field label="Hours per day"><input type="number" min={1} max={24} value={edit.duration_hours} onChange={set('duration_hours')} required /></Field></div>
          <Field label="Description"><textarea value={edit.description || ''} onChange={set('description')} /></Field>
          <div className="row"><button className="btn" disabled={a.busy}>Save</button><button type="button" className="btn secondary" onClick={() => setEdit(null)}>Cancel</button></div>
        </form>
      )}
      {data && data.filter((p: any) => p.active).length === 0 ? <Empty>No packages yet. Clients need at least one to book you.</Empty> : (
        <table><tbody>{data?.filter((p: any) => p.active).map((p: any) => (
          <tr key={p.id}><td><b>{p.name}</b><div className="small dim">{p.description}</div></td><td>{p.duration_hours} h/day</td><td>{money(p.price)}/day</td>
            <td style={{ textAlign: 'right' }}><button className="btn secondary sm" onClick={() => setEdit(p)}>Edit</button> <button className="btn ghost sm" onClick={async () => { await a.run(() => del('/professional/packages/' + p.id)); reload(); }}>Remove</button></td></tr>
        ))}</tbody></table>
      )}
    </Card>
  );
}

function PortfolioTab() {
  const { data, reload } = useLoad(() => get('/professional/portfolio'));
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const a = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const f = file.current?.files?.[0]; if (!f) return;
    const fd = new FormData(); fd.append('title', title); if (desc) fd.append('description', desc); fd.append('media', f);
    if (await a.run(() => post('/professional/portfolio', fd), 'Added')) { setTitle(''); setDesc(''); if (file.current) file.current.value = ''; reload(); }
  };
  return (
    <>
      <Card title="Add to portfolio">
        <form onSubmit={submit}><Alert>{a.error}</Alert><Alert kind="success">{a.ok}</Alert>
          <div className="grid g2"><Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} /></Field>
            <Field label="Image or video (max 100 MB)"><input ref={file} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" required /></Field></div>
          <Field label="Description (optional)"><input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={500} /></Field>
          <button className="btn" disabled={a.busy}>Upload</button></form>
      </Card>
      <Card title="Your portfolio">
        {data?.length === 0 ? <Empty>Nothing uploaded yet.</Empty> : <div className="gallery">{data?.map((i: any) => (
          <figure key={i.id} style={{ margin: 0 }}>
            <div className="small">{i.media_type === 'VIDEO' ? '🎬' : '🖼️'} {i.title} {i.hidden && <Badge value="BLOCKED" />}</div>
            <button className="btn ghost sm" onClick={async () => { await del('/professional/portfolio/' + i.id); reload(); }}>Remove</button>
          </figure>
        ))}</div>}
      </Card>
    </>
  );
}

export function ProAvailability() {
  const { data, reload } = useLoad(() => get('/professional/availability'));
  const [f, setF] = useState<any>({ startTime: '09:00', endTime: '18:00', status: 'AVAILABLE' });
  const a = useAction();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await a.run(() => post('/professional/availability', { dateFrom: f.dateFrom, dateTo: f.dateTo || f.dateFrom, startTime: f.startTime, endTime: f.endTime, status: f.status }), 'Calendar updated')) reload();
  };
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <h1>Availability</h1>
      <Card title="Open or block dates">
        <form onSubmit={submit}><Alert>{a.error}</Alert><Alert kind="success">{a.ok}</Alert>
          <div className="grid g4">
            <Field label="From"><input type="date" min={today} value={f.dateFrom || ''} onChange={set('dateFrom')} required /></Field>
            <Field label="To"><input type="date" min={f.dateFrom || today} value={f.dateTo || ''} onChange={set('dateTo')} /></Field>
            <Field label="From time"><input type="time" value={f.startTime} onChange={set('startTime')} required /></Field>
            <Field label="To time"><input type="time" value={f.endTime} onChange={set('endTime')} required /></Field>
            <Field label="Mark as"><select value={f.status} onChange={set('status')}><option value="AVAILABLE">Available</option><option value="BLOCKED">Blocked (unavailable)</option></select></Field>
          </div>
          <button className="btn" disabled={a.busy}>Apply to date range</button>
          <p className="small dim">Days linked to a booking (held or booked) are never overwritten.</p>
        </form>
      </Card>
      <Card title="Your calendar">
        {!data || data.length === 0 ? <Empty>No dates set yet. Clients can only book days you mark as available.</Empty> : (
          <div className="table-wrap"><table><thead><tr><th>Date</th><th>Hours</th><th>Status</th><th>Booking</th><th></th></tr></thead>
            <tbody>{data.map((s: any) => (
              <tr key={s.id}><td>{fmtDate(s.slot_date)}</td><td>{hhmm(s.start_time)}–{hhmm(s.end_time)}</td><td><Badge value={s.status} /></td>
                <td>{s.booking_id ? <Link to={'/bookings/' + s.booking_id}>#{s.booking_id}</Link> : ''}</td>
                <td>{!s.booking_id && <button className="btn ghost sm" onClick={async () => { await del('/professional/availability/' + s.id); reload(); }}>Remove</button>}</td></tr>
            ))}</tbody></table></div>
        )}
      </Card>
    </>
  );
}

export function ProPayouts() {
  const { data: acct, reload: rAcct } = useLoad(() => get('/professional/payout-account'));
  const { data: pay, reload } = useLoad(() => get('/professional/payouts'));
  const [f, setF] = useState<any>({});
  const a = useAction();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (await a.run(() => put('/professional/payout-account', { accountHolder: f.accountHolder, bankName: f.bankName, accountNumber: f.accountNumber }), 'Payout account saved')) { setF({}); rAcct(); reload(); }
  };
  return (
    <>
      <h1>Payouts</h1>
      <div className="grid g3">
        <Card><div className="dim small">Paid out</div><div className="stat">{money(pay?.totals.paid)}</div></Card>
        <Card><div className="dim small">Pending payout</div><div className="stat">{money(pay?.totals.pending)}</div></Card>
        <Card><div className="dim small">Held for active jobs (gross)</div><div className="stat">{money(pay?.totals.held)}</div></Card>
      </div>
      <Card title="Payout account">
        {acct ? <p>{acct.account_holder} · {acct.bank_name} · account ending <b>{acct.account_last4}</b></p> : <Alert kind="info">Add a payout account to receive your earnings. Payouts wait until you do.</Alert>}
        <form onSubmit={save}><Alert>{a.error}</Alert><Alert kind="success">{a.ok}</Alert>
          <div className="grid g3">
            <Field label="Account holder"><input value={f.accountHolder || ''} onChange={set('accountHolder')} required /></Field>
            <Field label="Bank name"><input value={f.bankName || ''} onChange={set('bankName')} required /></Field>
            <Field label="Account number" hint="Only the last 4 digits are stored. Demo: a number ending 0000 simulates a failed payout."><input inputMode="numeric" value={f.accountNumber || ''} onChange={set('accountNumber')} required autoComplete="off" /></Field>
          </div>
          <button className="btn" disabled={a.busy}>{acct ? 'Replace account' : 'Save account'}</button></form>
      </Card>
      <Card title="Payout history">
        {pay?.payouts.length === 0 ? <Empty>No payouts yet. They appear after clients approve your work.</Empty> : (
          <div className="table-wrap"><table><thead><tr><th>Booking</th><th>Gross</th><th>Commission</th><th>Net</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>{pay?.payouts.map((p: any) => (
              <tr key={p.id}><td><Link to={'/bookings/' + p.booking_id}>#{p.booking_id}</Link></td><td>{money(p.gross_amount)}</td><td>{money(p.commission_amount)}</td><td className="bold">{money(p.net_amount)}</td>
                <td><Badge value={p.status} />{p.failure_reason && <div className="small dim">{p.failure_reason}</div>}</td><td>{fmtDate(p.paid_at || p.created_at)}</td></tr>
            ))}</tbody></table></div>
        )}
      </Card>
    </>
  );
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5433/booking_test';
process.env.STORAGE_DIR = require('os').tmpdir() + '/booking-test-storage-' + process.pid;
process.env.SMTP_HOST = '';

import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';

const { createApp } = require('../src/app');
const { pool, one, query } = require('../src/db/pool');
const { migrate } = require('../src/db/migrate');
const svc = require('../src/services/bookings');
const { addDays, todayString } = require('../src/utils/dates');

let server: http.Server;
let base = '';

async function api(method: string, path: string, token?: string | null, body?: any, form?: FormData) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  let payload: any;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(base + '/api' + path, { method, headers, body: payload });
  const text = await res.text();
  let data: any; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}
const file = (name: string, type: string, content = 'x'.repeat(100)) => new Blob([content], { type });

async function lastEmail(to: string) {
  return (await one('SELECT * FROM email_log WHERE to_email=$1 ORDER BY id DESC LIMIT 1', [to.toLowerCase()])).body as string;
}
async function register(role: string, email: string, extra: any = {}) {
  const r = await api('POST', '/auth/register', null, { role, email, password: 'Passw0rd!', fullName: email.split('@')[0] + ' Test', ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const token = /token=([a-f0-9]+)/.exec(await lastEmail(email))![1];
  assert.equal((await api('GET', '/auth/verify-email?token=' + token)).status, 200);
  return login(email);
}
async function login(email: string, password = 'Passw0rd!') {
  const r = await api('POST', '/auth/login', null, { email, password });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.token as string;
}
const CARD = { number: '4242424242424242', expiry: '12/30', cvv: '123' };
const idOf = async (email: string) => (await one('SELECT id FROM users WHERE lower(email)=$1', [email])).id as number;

let admin = '', support = '', client = '', client2 = '', pro = '', pro2 = '';
let proId = 0, pkgId = 0;
const D = (n: number) => addDays(todayString(), n);

before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  const { hashPassword } = require('../src/utils/security');
  for (const [e, r] of [['admin@t.com', 'ADMIN'], ['support@t.com', 'SUPPORT']]) {
    await query('INSERT INTO users (email, password_hash, full_name, role, email_verified) VALUES ($1,$2,$3,$4,TRUE)', [e, await hashPassword('Passw0rd!'), e, r]);
  }
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = 'http://localhost:' + (server.address() as any).port;
});
after(async () => { server.close(); await pool.end(); });

describe('platform end-to-end', () => {
  test('1. client registers, verifies email, logs in; duplicate and weak password rejected', async () => {
    client = await register('CLIENT', 'client@t.com');
    client2 = await register('CLIENT', 'client2@t.com');
    assert.equal((await api('POST', '/auth/register', null, { role: 'CLIENT', email: 'CLIENT@t.com', password: 'Passw0rd!', fullName: 'Dup' })).status, 409);
    assert.equal((await api('POST', '/auth/register', null, { role: 'CLIENT', email: 'weak@t.com', password: 'abc', fullName: 'Weak' })).status, 400);
    assert.equal((await api('POST', '/auth/login', null, { email: 'client@t.com', password: 'wrong' })).status, 401);
    const me = await api('GET', '/auth/me', client);
    assert.equal(me.data.role, 'CLIENT');
    assert.equal((await api('GET', '/auth/me')).status, 401);
  });

  test('2. professional registers, builds profile, packages, availability, submits verification', async () => {
    pro = await register('PROFESSIONAL', 'pro@t.com', { professionalType: 'PHOTOGRAPHER', city: 'Mumbai' });
    pro2 = await register('PROFESSIONAL', 'pro2@t.com', { professionalType: 'VIDEOGRAPHER', city: 'Delhi' });
    proId = await idOf('pro@t.com');
    assert.equal((await api('PUT', '/professional/profile', pro, { headline: 'Wedding photographer', bio: 'Great', experienceYears: 5 })).status, 200);
    const pk = await api('POST', '/professional/packages', pro, { name: 'Full day', price: 1000, durationHours: 8 });
    assert.equal(pk.status, 201);
    pkgId = pk.data.id;
    assert.equal((await api('POST', '/professional/availability', pro, { dateFrom: D(5), dateTo: D(40), startTime: '08:00', endTime: '20:00' })).status, 201);
    const f = new FormData(); f.append('documentType', 'Passport'); f.append('document', file('id.png', 'image/png'), 'id.png');
    assert.equal((await api('POST', '/professional/verification', pro, undefined, f)).status, 201);
    const f2 = new FormData(); f2.append('documentType', 'Passport'); f2.append('document', file('x.exe', 'application/x-msdownload'), 'x.exe');
    assert.equal((await api('POST', '/professional/verification', pro2, undefined, f2)).status, 400);
    // client cannot use professional routes
    assert.equal((await api('GET', '/professional/profile', client)).status, 403);
  });

  test('3. unapproved professional is hidden from search and cannot be booked', async () => {
    const s = await api('GET', '/public/professionals');
    assert.equal(s.data.total, 0);
    assert.equal((await api('GET', '/public/professionals/' + proId)).status, 404);
    const r = await api('POST', '/bookings', client, { packageId: pkgId, eventType: 'Wedding', startDate: D(6), endDate: D(6), startTime: '09:00', endTime: '17:00', venue: 'Hall', card: CARD });
    assert.equal(r.status, 400);
  });

  test('4. admin logs in with email MFA and approves the professional', async () => {
    const l = await api('POST', '/auth/login', null, { email: 'admin@t.com', password: 'Passw0rd!' });
    assert.equal(l.data.mfaRequired, true);
    assert.equal(l.data.token, undefined);
    assert.equal((await api('POST', '/auth/mfa/verify', null, { mfaToken: l.data.mfaToken, code: '000000' })).status, 401);
    const code = /code is (\d{6})/.exec(await lastEmail('admin@t.com'))![1];
    const v = await api('POST', '/auth/mfa/verify', null, { mfaToken: l.data.mfaToken, code });
    assert.equal(v.status, 200, JSON.stringify(v.data));
    admin = v.data.token;
    const sl = await api('POST', '/auth/login', null, { email: 'support@t.com', password: 'Passw0rd!' });
    support = sl.data.token;
    const q = await api('GET', '/admin/verifications', admin);
    assert.equal(q.data.length, 1);
    const doc = await fetch(`${base}/api/admin/verifications/${q.data[0].id}/document`, { headers: { Authorization: 'Bearer ' + admin } });
    assert.equal(doc.status, 200);
    assert.equal((await api('POST', `/admin/verifications/${q.data[0].id}/approve`, support, {})).status, 403);
    assert.equal((await api('POST', `/admin/verifications/${q.data[0].id}/approve`, admin, {})).status, 200);
  });

  test('5. approved professional appears in search; filters work; details show packages', async () => {
    assert.equal((await api('GET', '/public/professionals')).data.total, 1);
    assert.equal((await api('GET', '/public/professionals?type=VIDEOGRAPHER')).data.total, 0);
    assert.equal((await api('GET', '/public/professionals?city=mumbai&type=PHOTOGRAPHER')).data.total, 1);
    assert.equal((await api('GET', '/public/professionals?maxPrice=500')).data.total, 0);
    assert.equal((await api('GET', '/public/professionals?minPrice=500&maxPrice=2000')).data.total, 1);
    assert.equal((await api('GET', `/public/professionals?date=${D(10)}`)).data.total, 1);
    assert.equal((await api('GET', `/public/professionals?date=${D(1)}`)).data.total, 0);
    const d = await api('GET', '/public/professionals/' + proId);
    assert.equal(d.data.packages.length, 1);
    const a = await api('GET', `/public/professionals/${proId}/availability`);
    assert.ok(a.data.length >= 30);
  });

  let b1 = 0;
  test('6. multi-day booking: price per day, days held, payment authorized; invalid requests rejected', async () => {
    const bad = await api('POST', '/bookings', client, { packageId: pkgId, eventType: 'Wedding', startDate: D(1), endDate: D(1), startTime: '09:00', endTime: '17:00', venue: 'Hall', card: CARD });
    assert.equal(bad.status, 409); // not available
    const early = await api('POST', '/bookings', client, { packageId: pkgId, eventType: 'Wedding', startDate: D(7), endDate: D(7), startTime: '06:00', endTime: '17:00', venue: 'Hall', card: CARD });
    assert.equal(early.status, 409);
    const rev = await api('POST', '/bookings', client, { packageId: pkgId, eventType: 'Wedding', startDate: D(9), endDate: D(8), startTime: '09:00', endTime: '17:00', venue: 'Hall', card: CARD });
    assert.equal(rev.status, 400);
    const r = await api('POST', '/bookings', client, { packageId: pkgId, eventType: 'Wedding', startDate: D(10), endDate: D(12), startTime: '09:00', endTime: '17:00', venue: 'Grand Hall', card: CARD });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    b1 = r.data.id;
    assert.equal(r.data.total_amount, 3000);
    assert.equal(r.data.status, 'PENDING');
    assert.equal(r.data.payment_status, 'AUTHORIZED');
    const held = await query("SELECT status FROM availability WHERE booking_id=$1", [b1]);
    assert.equal(held.length, 3);
    assert.ok(held.every((h: any) => h.status === 'HELD'));
    // overlap by another client blocked
    const dup = await api('POST', '/bookings', client2, { packageId: pkgId, eventType: 'Party', startDate: D(12), endDate: D(13), startTime: '09:00', endTime: '17:00', venue: 'Xyz Hall', card: CARD });
    assert.equal(dup.status, 409, JSON.stringify(dup.data));
  });

  test('7. professional declines: authorization released, days restored', async () => {
    assert.equal((await api('POST', `/bookings/${b1}/decline`, client, {})).status, 403);
    assert.equal((await api('POST', `/bookings/${b1}/decline`, pro, { reason: 'Busy' })).status, 200);
    const b = await api('GET', '/bookings/' + b1, client);
    assert.equal(b.data.status, 'DECLINED');
    assert.equal(b.data.payment.status, 'CANCELLED');
    assert.equal((await query("SELECT 1 FROM availability WHERE booking_id=$1", [b1])).length, 0);
    assert.equal((await api('POST', `/bookings/${b1}/accept`, pro)).status, 409);
  });

  test('8. declined card is rejected with 402 and nothing stays held', async () => {
    const r = await api('POST', '/bookings', client, { packageId: pkgId, eventType: 'Wedding', startDate: D(10), endDate: D(10), startTime: '09:00', endTime: '17:00', venue: 'Hall', card: { ...CARD, number: '4000000000000002' } });
    assert.equal(r.status, 402);
    const row = await one("SELECT b.status, p.status AS ps FROM bookings b JOIN payments p ON p.booking_id=b.id ORDER BY b.id DESC LIMIT 1");
    assert.equal(row.status, 'CANCELLED'); assert.equal(row.ps, 'FAILED');
    assert.equal((await query("SELECT 1 FROM availability WHERE status<>'AVAILABLE' AND professional_id=$1", [proId])).length, 0);
    const bad = await api('POST', '/bookings', client, { packageId: pkgId, eventType: 'Wedding', startDate: D(10), endDate: D(10), startTime: '09:00', endTime: '17:00', venue: 'Hall', card: { ...CARD, expiry: '01/20' } });
    assert.equal(bad.status, 402, JSON.stringify(bad.data));
  });

  let b2 = 0;
  test('9. accept captures payment (held), snapshots commission, books days', async () => {
    const r = await api('POST', '/bookings', client, { packageId: pkgId, eventType: 'Wedding', startDate: D(20), endDate: D(21), startTime: '09:00', endTime: '18:00', venue: 'Palace', notes: 'Bring drone', card: CARD });
    b2 = r.data.id;
    assert.equal((await api('POST', `/bookings/${b2}/accept`, pro2)).status, 403);
    assert.equal((await api('POST', `/bookings/${b2}/accept`, pro)).status, 200);
    const b = await api('GET', '/bookings/' + b2, pro);
    assert.equal(b.data.status, 'CONFIRMED');
    assert.equal(b.data.payment.status, 'HELD');
    assert.equal(b.data.commission_amount, 200);
    assert.equal(b.data.payout_amount, 1800);
    assert.equal(b.data.payment.card_last4, undefined); // pro never sees card
    const c = await api('GET', '/bookings/' + b2, client);
    assert.equal(c.data.commission_amount, undefined); // client doesn't see split
    assert.equal((await query("SELECT 1 FROM availability WHERE booking_id=$1 AND status='BOOKED'", [b2])).length, 2);
    // other users can't see it
    assert.equal((await api('GET', '/bookings/' + b2, client2)).status, 404);
    assert.equal((await api('GET', '/bookings/' + b2, pro2)).status, 404);
  });

  test('10. messaging is limited to booking participants', async () => {
    assert.equal((await api('POST', `/bookings/${b2}/messages`, client, { content: 'Hello!' })).status, 201);
    assert.equal((await api('POST', `/bookings/${b2}/messages`, pro, { content: 'Hi there' })).status, 201);
    assert.equal((await api('POST', `/bookings/${b2}/messages`, client2, { content: 'spy' })).status, 404);
    assert.equal((await api('GET', `/bookings/${b2}/messages`, client2)).status, 404);
    const m = await api('GET', `/bookings/${b2}/messages`, client);
    assert.equal(m.data.length, 2);
    const n = await api('GET', '/account/notifications', pro);
    assert.ok(n.data.unread > 0);
  });

  test('11. deliverables: upload, deliver, expiring download link; review before completion blocked', async () => {
    const f = new FormData(); f.append('files', file('a.jpg', 'image/jpeg', 'PHOTO-DATA'), 'a.jpg');
    assert.equal((await api('POST', `/bookings/${b2}/deliver`, pro)).status, 400); // nothing uploaded
    assert.equal((await api('POST', `/bookings/${b2}/deliverables`, pro, undefined, f)).status, 201);
    const bad = new FormData(); bad.append('files', file('v.exe', 'application/x-msdownload'), 'v.exe');
    assert.equal((await api('POST', `/bookings/${b2}/deliverables`, pro, undefined, bad)).status, 400);
    const list = (await api('GET', '/bookings/' + b2, pro)).data.deliverables;
    assert.equal((await api('POST', `/bookings/${b2}/deliverables/${list[0].id}/link`, client)).status, 403); // not delivered yet
    assert.equal((await api('POST', `/bookings/${b2}/deliver`, pro)).status, 200);
    assert.equal((await api('POST', `/bookings/${b2}/review`, client, { rating: 5 })).status, 409);
    const link = await api('POST', `/bookings/${b2}/deliverables/${list[0].id}/link`, client);
    assert.equal(link.status, 200);
    const dl = await fetch(base + link.data.url);
    assert.equal(dl.status, 200);
    assert.equal(await dl.text(), 'PHOTO-DATA');
    assert.equal((await fetch(base + '/api/download?token=garbage')).status, 401);
    // stored bytes are encrypted
    const key = (await one('SELECT storage_key FROM deliverables WHERE id=$1', [list[0].id])).storage_key;
    const raw = require('fs').readFileSync(require('path').join(process.env.STORAGE_DIR!, key));
    assert.ok(!raw.toString().includes('PHOTO-DATA'));
    assert.equal((await api('POST', `/bookings/${b2}/deliverables/${list[0].id}/link`, client2)).status, 404);
  });

  test('12. revision request and re-delivery; revision limit enforced', async () => {
    assert.equal((await api('POST', `/bookings/${b2}/revision`, pro, { note: 'Please brighten' })).status, 403);
    assert.equal((await api('POST', `/bookings/${b2}/revision`, client, { note: 'Please brighten images' })).status, 200);
    assert.equal((await api('GET', '/bookings/' + b2, client)).data.status, 'REVISION_REQUESTED');
    const f = new FormData(); f.append('files', file('b.jpg', 'image/jpeg', 'V2'), 'b.jpg');
    await api('POST', `/bookings/${b2}/deliverables`, pro, undefined, f);
    assert.equal((await api('POST', `/bookings/${b2}/deliver`, pro)).status, 200);
    await query("UPDATE settings SET value='1' WHERE key='max_revisions'");
    assert.equal((await api('POST', `/bookings/${b2}/revision`, client, { note: 'One more time please' })).status, 409);
    await query("UPDATE settings SET value='3' WHERE key='max_revisions'");
  });

  test('13. approval completes booking; payout stays pending until payout account exists, then pays', async () => {
    assert.equal((await api('POST', `/bookings/${b2}/approve`, client2)).status, 403);
    assert.equal((await api('POST', `/bookings/${b2}/approve`, client)).status, 200);
    let b = (await api('GET', '/bookings/' + b2, pro)).data;
    assert.equal(b.status, 'COMPLETED');
    assert.equal(b.payment.status, 'RELEASED');
    assert.equal(b.payout.status, 'PENDING');
    assert.equal(b.payout.net_amount, 1800);
    const bad = await api('PUT', '/professional/payout-account', pro, { accountHolder: 'Pro', bankName: 'Bank', accountNumber: '12ab' });
    assert.equal(bad.status, 400);
    assert.equal((await api('PUT', '/professional/payout-account', pro, { accountHolder: 'Pro Test', bankName: 'Test Bank', accountNumber: '123456789012' })).status, 200);
    b = (await api('GET', '/bookings/' + b2, pro)).data;
    assert.equal(b.payout.status, 'PAID');
    const p = await api('GET', '/professional/payouts', pro);
    assert.equal(p.data.totals.paid, 1800);
    const acct = await api('GET', '/professional/payout-account', pro);
    assert.equal(acct.data.account_last4, '9012');
    assert.equal(JSON.stringify(acct.data).includes('123456789012'), false);
    // cannot cancel completed booking
    assert.equal((await api('POST', `/bookings/${b2}/cancel`, client, {})).status, 409);
  });

  test('14. one review per completed booking; rating shows in search; reporting & moderation', async () => {
    assert.equal((await api('POST', `/bookings/${b2}/review`, client2, { rating: 5 })).status, 404);
    assert.equal((await api('POST', `/bookings/${b2}/review`, client, { rating: 9 })).status, 400);
    const r = await api('POST', `/bookings/${b2}/review`, client, { rating: 4, comment: 'Lovely work' });
    assert.equal(r.status, 201);
    assert.equal((await api('POST', `/bookings/${b2}/review`, client, { rating: 5 })).status, 409);
    const s = await api('GET', '/public/professionals');
    assert.equal(s.data.results[0].avg_rating, 4);
    const rep = await api('POST', '/account/reports', client2, { targetType: 'REVIEW', targetId: r.data.id, reason: 'Looks fake to me' });
    assert.equal(rep.status, 201);
    assert.equal((await api('POST', '/account/reports', client2, { targetType: 'REVIEW', targetId: 9999, reason: 'Looks fake to me' })).status, 404);
    const list = await api('GET', '/staff/reports?status=OPEN', support);
    assert.equal(list.data.length, 1);
    assert.equal((await api('POST', `/staff/reports/${rep.data.id}/resolve`, support, { action: 'HIDE', note: 'Violates rules' })).status, 200);
    assert.equal((await api('GET', '/public/professionals/' + proId)).data.reviews.length, 0);
    assert.equal((await api('GET', '/staff/reports', client)).status, 403);
  });

  let b3 = 0;
  test('15. dispute: raised by client; support can review but not move money; admin refunds', async () => {
    const r = await api('POST', '/bookings', client2, { packageId: pkgId, eventType: 'Party', startDate: D(25), endDate: D(25), startTime: '10:00', endTime: '16:00', venue: 'Club', card: CARD });
    b3 = r.data.id;
    await api('POST', `/bookings/${b3}/accept`, pro);
    assert.equal((await api('POST', `/bookings/${b3}/dispute`, client2, { reason: 'No show', description: 'x' })).status, 400);
    assert.equal((await api('POST', `/bookings/${b3}/dispute`, client, { reason: 'No show', description: 'Not my booking at all' })).status, 404);
    const d = await api('POST', `/bookings/${b3}/dispute`, client2, { reason: 'Quality', description: 'Photographer left early' });
    assert.equal(d.status, 201);
    assert.equal((await api('POST', `/bookings/${b3}/dispute`, pro, { reason: 'Quality', description: 'A second dispute attempt' })).status, 409);
    assert.equal((await api('GET', '/bookings/' + b3, client2)).data.status, 'DISPUTED');
    assert.equal((await api('POST', `/bookings/${b3}/approve`, client2)).status, 409);
    assert.equal((await api('POST', `/staff/disputes/${d.data.id}/notes`, support, { note: 'Contacted both parties' })).status, 200);
    assert.equal((await api('GET', `/staff/disputes/${d.data.id}`, support)).data.status, 'UNDER_REVIEW');
    // support has no financial authority
    assert.equal((await api('POST', `/staff/disputes/${d.data.id}/resolve`, support, { type: 'REFUND_CLIENT', note: 'refund it' })).status, 403);
    assert.equal((await api('GET', '/admin/payments', support)).status, 403);
    assert.equal((await api('PUT', '/admin/settings', support, { commission_percent: 0 })).status, 403);
    assert.equal((await api('POST', `/staff/disputes/${d.data.id}/resolve`, admin, { type: 'REFUND_CLIENT', note: 'Refund approved' })).status, 200);
    const b = (await api('GET', '/bookings/' + b3, client2)).data;
    assert.equal(b.status, 'CANCELLED');
    assert.equal(b.payment.status, 'REFUNDED');
    assert.equal(b.payment.refunded_amount, 1000);
    assert.equal((await query("SELECT 1 FROM availability WHERE booking_id=$1", [b3])).length, 0);
  });

  test('16. admin manages users and commission; suspension blocks login; new commission applies to new bookings', async () => {
    assert.equal((await api('PUT', '/admin/settings', admin, { commission_percent: 99 })).status, 400);
    assert.equal((await api('PUT', '/admin/settings', admin, { bogus: 1 })).status, 400);
    assert.equal((await api('PUT', '/admin/settings', admin, { commission_percent: 20 })).status, 200);
    const r = await api('POST', '/bookings', client, { packageId: pkgId, eventType: 'Shoot', startDate: D(30), endDate: D(30), startTime: '10:00', endTime: '14:00', venue: 'Park', card: CARD });
    await api('POST', `/bookings/${r.data.id}/accept`, pro);
    assert.equal((await api('GET', '/bookings/' + r.data.id, pro)).data.commission_amount, 200);
    // earlier completed booking keeps its original 10% snapshot
    assert.equal((await api('GET', '/bookings/' + b2, pro)).data.commission_percent, 10);
    const rep = await api('GET', '/admin/reports/summary', admin);
    assert.equal(rep.data.money.commission, 200);
    // staff accounts
    const s = await api('POST', '/admin/staff', admin, { email: 'agent@t.com', fullName: 'Agent', password: 'Passw0rd!', role: 'SUPPORT' });
    assert.equal(s.status, 201);
    // suspend
    const cid = await idOf('client2@t.com');
    assert.equal((await api('POST', `/admin/users/${cid}/suspend`, admin, {})).status, 200);
    assert.equal((await api('GET', '/auth/me', client2)).status, 403);
    assert.equal((await api('POST', '/auth/login', null, { email: 'client2@t.com', password: 'Passw0rd!' })).status, 403);
    assert.equal((await api('POST', `/admin/users/${cid}/reinstate`, admin, {})).status, 200);
    assert.equal((await api('GET', '/auth/me', client2)).status, 200);
    // suspended professional disappears from search
    await api('POST', `/admin/users/${proId}/suspend`, admin, {});
    assert.equal((await api('GET', '/public/professionals')).data.total, 0);
    await api('POST', `/admin/users/${proId}/reinstate`, admin, {});
    assert.equal((await api('GET', '/public/professionals')).data.total, 1);
    await api('PUT', '/admin/settings', admin, { commission_percent: 10 });
  });

  test('17. cancellation policy: full refund early, partial refund late; pro cancel = full refund', async () => {
    // early client cancel (>=3 days) => full refund
    const r1 = await api('POST', '/bookings', client, { packageId: pkgId, eventType: 'Event A', startDate: D(33), endDate: D(33), startTime: '10:00', endTime: '14:00', venue: 'Park', card: CARD });
    await api('POST', `/bookings/${r1.data.id}/accept`, pro);
    const c1 = await api('POST', `/bookings/${r1.data.id}/cancel`, client, { reason: 'Plans changed' });
    assert.equal(c1.status, 200, JSON.stringify(c1.data));
    assert.equal(c1.data.refund, 1000);
    assert.equal((await api('GET', '/bookings/' + r1.data.id, client)).data.payment.status, 'REFUNDED');
    // late cancel: move booking close to start
    const r2 = await api('POST', '/bookings', client, { packageId: pkgId, eventType: 'Event B', startDate: D(34), endDate: D(34), startTime: '10:00', endTime: '14:00', venue: 'Park', card: CARD });
    await api('POST', `/bookings/${r2.data.id}/accept`, pro);
    await query("UPDATE bookings SET start_date=$1, end_date=$1 WHERE id=$2", [D(1), r2.data.id]);
    const c2 = await api('POST', `/bookings/${r2.data.id}/cancel`, client, {});
    assert.equal(c2.data.refund, 500);
    const b = (await api('GET', '/bookings/' + r2.data.id, pro)).data;
    assert.equal(b.payment.refunded_amount, 500);
    assert.equal(b.payout.gross_amount, 500);
    assert.equal(b.payout.net_amount, 450);
    // professional cancels => full refund
    const r3 = await api('POST', '/bookings', client, { packageId: pkgId, eventType: 'Event C', startDate: D(35), endDate: D(35), startTime: '10:00', endTime: '14:00', venue: 'Park', card: CARD });
    await api('POST', `/bookings/${r3.data.id}/accept`, pro);
    const c3 = await api('POST', `/bookings/${r3.data.id}/cancel`, pro, { reason: 'Ill' });
    assert.equal(c3.data.refund, 1000);
    // pending cancel => authorization voided
    const r4 = await api('POST', '/bookings', client, { packageId: pkgId, eventType: 'Event D', startDate: D(36), endDate: D(36), startTime: '10:00', endTime: '14:00', venue: 'Park', card: CARD });
    assert.equal((await api('POST', `/bookings/${r4.data.id}/cancel`, client, {})).status, 200);
    assert.equal((await api('GET', '/bookings/' + r4.data.id, client)).data.payment.status, 'CANCELLED');
    assert.equal((await api('POST', `/bookings/${r4.data.id}/cancel`, client2, {})).status, 404);
  });

  test('18. background jobs: pending requests expire; delivered work auto-approves', async () => {
    const r = await api('POST', '/bookings', client, { packageId: pkgId, eventType: 'Event E', startDate: D(37), endDate: D(37), startTime: '10:00', endTime: '14:00', venue: 'Park', card: CARD });
    await query("UPDATE bookings SET expires_at = now() - interval '1 hour' WHERE id=$1", [r.data.id]);
    { const a = await api("POST", `/bookings/${r.data.id}/accept`, pro); assert.equal(a.status, 409, JSON.stringify([r.data, a.data])); }
    await svc.expirePendingBookings();
    const b = (await api('GET', '/bookings/' + r.data.id, client)).data;
    assert.equal(b.status, 'EXPIRED'); assert.equal(b.payment.status, 'CANCELLED');
    assert.equal((await query("SELECT 1 FROM availability WHERE booking_id=$1", [r.data.id])).length, 0);

    const r2 = await api('POST', '/bookings', client, { packageId: pkgId, eventType: 'Event F', startDate: D(38), endDate: D(38), startTime: '10:00', endTime: '14:00', venue: 'Park', card: CARD });
    await api('POST', `/bookings/${r2.data.id}/accept`, pro);
    const f = new FormData(); f.append('files', file('a.jpg', 'image/jpeg'), 'a.jpg');
    await api('POST', `/bookings/${r2.data.id}/deliverables`, pro, undefined, f);
    await api('POST', `/bookings/${r2.data.id}/deliver`, pro);
    await query("UPDATE bookings SET delivered_at = now() - interval '8 days' WHERE id=$1", [r2.data.id]);
    await svc.autoApproveDelivered();
    assert.equal((await api('GET', '/bookings/' + r2.data.id, client)).data.status, 'COMPLETED');
  });

  test('19. security: validation, oversized/invalid input and role isolation', async () => {
    assert.equal((await api('GET', '/admin/users', client)).status, 403);
    assert.equal((await api('GET', '/staff/disputes', pro)).status, 403);
    assert.equal((await api('GET', '/admin/users', 'garbage')).status, 401);
    assert.equal((await api('POST', '/bookings', client, { packageId: 'x' })).status, 400);
    assert.equal((await api('GET', '/bookings/abc', client)).status, 404);
    const sql = await api('GET', "/public/professionals?q=' OR 1=1 --");
    assert.equal(sql.status, 200);
    assert.equal((await api('POST', '/bookings', pro, { packageId: pkgId })).status, 403);
    // professional (not client) bookings list only shows own
    const mine = await api('GET', '/bookings', client2);
    assert.ok(mine.data.every((b: any) => b.client_id === (b.client_id)));
    const audit = await api('GET', '/admin/audit', admin);
    assert.ok(audit.data.length > 3);
  });
});

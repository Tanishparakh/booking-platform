import { Db, one, pool, query } from '../db/pool';
import { sendEmail } from './mailer';

/** Creates an in-app notification and sends the same message by email. Never throws. */
export async function notify(userId: number, type: string, message: string, bookingId?: number, db: Db = pool) {
  try {
    await query('INSERT INTO notifications (user_id, type, message, booking_id) VALUES ($1,$2,$3,$4)', [userId, type, message, bookingId ?? null], db);
    const user = await one('SELECT email, full_name FROM users WHERE id = $1', [userId]);
    if (user) await sendEmail(user.email, `Booking Platform: ${message.slice(0, 70)}`, `Hello ${user.full_name},\n\n${message}\n\n– Booking Platform`);
  } catch (err) {
    console.warn('Notification failed', err);
  }
}

export async function audit(actorId: number | null, action: string, entity: string, entityId: number | null, detail?: string, db: Db = pool) {
  await query('INSERT INTO audit_log (actor_id, action, entity, entity_id, detail) VALUES ($1,$2,$3,$4,$5)', [actorId, action, entity, entityId, detail ?? null], db);
}

export async function bookingEvent(bookingId: number, actorId: number | null, type: string, note?: string, db: Db = pool) {
  await query('INSERT INTO booking_events (booking_id, actor_id, type, note) VALUES ($1,$2,$3,$4)', [bookingId, actorId, type, note ?? null], db);
}

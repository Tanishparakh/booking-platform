import { migrate } from './migrate';
import { pool, one, query } from './pool';
import { hashPassword } from '../utils/security';
import { addDays, eachDay, todayString } from '../utils/dates';

/** Demo data. Safe to run repeatedly. */
export async function seed() {
  await migrate();
  if (await one("SELECT 1 FROM users WHERE email = 'admin@example.com'")) {
    console.log('Seed data already present.');
    return;
  }
  const mk = async (email: string, name: string, role: string, pw: string) =>
    (await one('INSERT INTO users (email, password_hash, full_name, role, email_verified) VALUES ($1,$2,$3,$4,TRUE) RETURNING id', [email, await hashPassword(pw), name, role])).id as number;

  await mk('admin@example.com', 'Alex Admin', 'ADMIN', 'Admin@123');
  await mk('support@example.com', 'Sam Support', 'SUPPORT', 'Support@123');
  for (const [email, name] of [['client@example.com', 'Chris Client'], ['client2@example.com', 'Dana Client']]) {
    const id = await mk(email, name, 'CLIENT', 'Client@123');
    await query('INSERT INTO clients (user_id) VALUES ($1)', [id]);
  }

  const pros = [
    ['maya@example.com', 'Maya Rao', 'PHOTOGRAPHER', 'Mumbai', 6, 'Weddings & portraits', 'Candid wedding photographer', 'Storytelling photographs for weddings and families, shot on Canon R5 mirrorless.', 'Canon R5, 24-70mm f/2.8, 85mm f/1.4', [['Wedding Day (8h)', 40000, 8], ['Engagement Shoot (3h)', 12000, 3]]],
    ['arjun@example.com', 'Arjun Mehta', 'VIDEOGRAPHER', 'Delhi', 8, 'Corporate & events', 'Cinematic event videographer', 'Highlight reels and full-length coverage for corporate events and weddings.', 'Sony FX3, DJI Ronin, drone', [['Event Highlights (6h)', 55000, 6], ['Corporate Interview (3h)', 20000, 3]]],
    ['isha@example.com', 'Isha Kapoor', 'PHOTOGRAPHER', 'Mumbai', 3, 'Products & fashion', 'Product and fashion photographer', 'Clean studio and lifestyle imagery for brands.', 'Nikon Z7 II, studio strobes', [['Product Shoot (4h)', 15000, 4]]],
    ['rohan@example.com', 'Rohan Das', 'VIDEOGRAPHER', 'Bengaluru', 5, 'Music videos & shorts', 'Music video & short-film maker', 'Narrative and music video production with a fast turnaround.', 'Blackmagic Pocket 6K, gimbal', [['Music Video Day (10h)', 70000, 10]]],
    ['neha@example.com', 'Neha Iyer', 'PHOTOGRAPHER', 'Bengaluru', 10, 'Events & portraits', 'Portrait & event photographer', 'Natural-light portraits and birthday/baby-shower events.', 'Canon R6 II, 35mm f/1.4', [['Portrait Session (2h)', 8000, 2], ['Event Coverage (5h)', 25000, 5]]],
  ] as const;

  for (const [email, name, type, city, yrs, spec, headline, bio, equipment, pkgs] of pros) {
    const id = await mk(email, name, 'PROFESSIONAL', 'Pro@12345');
    await query('INSERT INTO professionals (user_id, professional_type, operating_city, experience_years, equipment, specialization, verification_status) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, type, city, yrs, equipment, spec, 'APPROVED']);
    await query('INSERT INTO profiles (professional_id, headline, bio, location) VALUES ($1,$2,$3,$4)', [id, headline, bio, city]);
    for (const [pn, price, hrs] of pkgs) await query('INSERT INTO packages (professional_id, name, description, price, duration_hours) VALUES ($1,$2,$3,$4,$5)', [id, pn, `${pn} – edited files delivered online`, price, hrs]);
    for (const d of eachDay(addDays(todayString(), 1), addDays(todayString(), 60))) {
      await query("INSERT INTO availability (professional_id, slot_date, start_time, end_time) VALUES ($1,$2,'08:00','22:00')", [id, d]);
    }
  }
  // One professional awaiting approval so the admin queue is not empty
  const pending = await mk('pending@example.com', 'Vikram Sethi', 'PROFESSIONAL', 'Pro@12345');
  await query("INSERT INTO professionals (user_id, professional_type, operating_city) VALUES ($1,'PHOTOGRAPHER','Pune')", [pending]);
  await query('INSERT INTO profiles (professional_id, location) VALUES ($1,$2)', [pending, 'Pune']);
  console.log('Seeded: admin@example.com / Admin@123, support@example.com / Support@123, client@example.com / Client@123, maya@example.com / Pro@12345 (and others)');
}

if (require.main === module) {
  seed().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}

import { query } from '../src/db/pool';

async function inspect() {
  console.log('=====================================================');
  console.log('       FRAMEBOOK DATABASE STORAGE INSPECTOR          ');
  console.log('=====================================================\n');

  // List all tables
  const tables = await query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name"
  );

  console.log(`Found ${tables.length} tables in PostgreSQL schema:\n`);

  for (const t of tables) {
    const res = await query<{ count: number }>(`SELECT count(*)::int as count FROM "${t.table_name}"`);
    console.log(`  📁 ${t.table_name.padEnd(22)} : ${res[0].count} rows`);
  }

  console.log('\n--- SAMPLE USERS (from users table) ---');
  const sampleUsers = await query("SELECT id, email, full_name, role, status FROM users ORDER BY id ASC LIMIT 8");
  console.table(sampleUsers);

  console.log('--- SAMPLE CREATORS (from professionals table) ---');
  const samplePros = await query(
    `SELECT u.full_name, p.professional_type, p.operating_city, p.experience_years, pr.headline, pr.hourly_rate
     FROM professionals p
     JOIN users u ON u.id = p.user_id
     JOIN profiles pr ON pr.professional_id = p.user_id
     LIMIT 5`
  );
  console.table(samplePros);

  console.log('--- SAMPLE BOOKINGS (from bookings table) ---');
  const sampleBookings = await query(
    `SELECT b.id, u.full_name as client, pro.full_name as professional, b.event_type, b.total_amount, b.status
     FROM bookings b
     JOIN users u ON u.id = b.client_id
     JOIN users pro ON pro.id = b.professional_id
     ORDER BY b.id ASC LIMIT 6`
  );
  console.table(sampleBookings);
}

inspect().catch(console.error);

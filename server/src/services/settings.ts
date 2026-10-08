import { one, query, Db, pool } from '../db/pool';

export async function getSetting(key: string, db: Db = pool): Promise<string> {
  const row = await one('SELECT value FROM settings WHERE key = $1', [key], db);
  if (!row) throw new Error(`Missing setting ${key}`);
  return row.value;
}

export async function getNumber(key: string, db: Db = pool): Promise<number> {
  return Number(await getSetting(key, db));
}

export async function allSettings() {
  return query('SELECT key, value, description, updated_at FROM settings ORDER BY key');
}

/** Validation rules for admin-editable settings. */
export const SETTING_RULES: Record<string, { min: number; max: number }> = {
  commission_percent: { min: 0, max: 50 },
  request_expiry_hours: { min: 1, max: 336 },
  download_link_minutes: { min: 1, max: 1440 },
  deliverable_retention_days: { min: 1, max: 3650 },
  auto_approve_days: { min: 0, max: 90 },
  max_revisions: { min: 0, max: 10 },
  full_refund_days: { min: 0, max: 60 },
  late_cancel_refund_percent: { min: 0, max: 100 },
  message_retention_days: { min: 1, max: 3650 },
};

-- Freelance Photographer & Videographer Booking Platform – PostgreSQL schema

CREATE TABLE users (
  id                   SERIAL PRIMARY KEY,
  email                TEXT NOT NULL,
  password_hash        TEXT NOT NULL,
  full_name            TEXT NOT NULL,
  phone                TEXT,
  role                 TEXT NOT NULL CHECK (role IN ('CLIENT','PROFESSIONAL','ADMIN','SUPPORT')),
  status               TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  email_verified       BOOLEAN NOT NULL DEFAULT FALSE,
  verify_token_hash    TEXT,
  verify_token_expires TIMESTAMPTZ,
  mfa_code_hash        TEXT,
  mfa_expires          TIMESTAMPTZ,
  mfa_attempts         INT NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

CREATE TABLE clients (
  user_id     INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  preferences TEXT,
  address     TEXT
);

CREATE TABLE professionals (
  user_id             INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  professional_type   TEXT NOT NULL CHECK (professional_type IN ('PHOTOGRAPHER','VIDEOGRAPHER')),
  operating_city      TEXT NOT NULL,
  experience_years    INT NOT NULL DEFAULT 0,
  equipment           TEXT,
  specialization      TEXT,
  verification_status TEXT NOT NULL DEFAULT 'NOT_SUBMITTED'
                      CHECK (verification_status IN ('NOT_SUBMITTED','PENDING','APPROVED','REJECTED'))
);

CREATE TABLE profiles (
  professional_id   INT PRIMARY KEY REFERENCES professionals(user_id) ON DELETE CASCADE,
  headline          TEXT,
  bio               TEXT,
  location          TEXT,
  hourly_rate       NUMERIC(10,2),
  profile_image_key TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE portfolio_items (
  id              SERIAL PRIMARY KEY,
  professional_id INT NOT NULL REFERENCES professionals(user_id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT,
  media_key       TEXT NOT NULL,
  media_type      TEXT NOT NULL CHECK (media_type IN ('IMAGE','VIDEO')),
  content_type    TEXT NOT NULL,
  hidden          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE packages (
  id              SERIAL PRIMARY KEY,
  professional_id INT NOT NULL REFERENCES professionals(user_id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  price           NUMERIC(10,2) NOT NULL CHECK (price > 0),
  duration_hours  INT NOT NULL DEFAULT 4 CHECK (duration_hours > 0),
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per professional per day. HELD = pending booking, BOOKED = confirmed booking.
CREATE TABLE availability (
  id              SERIAL PRIMARY KEY,
  professional_id INT NOT NULL REFERENCES professionals(user_id) ON DELETE CASCADE,
  slot_date       DATE NOT NULL,
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  status          TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','HELD','BOOKED','BLOCKED')),
  booking_id      INT,
  UNIQUE (professional_id, slot_date),
  CHECK (end_time > start_time)
);

CREATE TABLE verifications (
  id              SERIAL PRIMARY KEY,
  professional_id INT NOT NULL REFERENCES professionals(user_id) ON DELETE CASCADE,
  document_type   TEXT NOT NULL,
  document_key    TEXT NOT NULL,
  content_type    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  remarks         TEXT,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by     INT REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ
);

CREATE TABLE bookings (
  id                 SERIAL PRIMARY KEY,
  client_id          INT NOT NULL REFERENCES users(id),
  professional_id    INT NOT NULL REFERENCES professionals(user_id),
  package_id         INT NOT NULL REFERENCES packages(id),
  event_type         TEXT NOT NULL,
  start_date         DATE NOT NULL,
  end_date           DATE NOT NULL,
  start_time         TIME NOT NULL,
  end_time           TIME NOT NULL,
  venue              TEXT NOT NULL,
  notes              TEXT,
  total_amount       NUMERIC(10,2) NOT NULL,
  commission_percent NUMERIC(5,2),
  commission_amount  NUMERIC(10,2),
  payout_amount      NUMERIC(10,2),
  status             TEXT NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING','CONFIRMED','DECLINED','EXPIRED','CANCELLED',
                                       'DELIVERED','REVISION_REQUESTED','COMPLETED','DISPUTED')),
  prior_status       TEXT,
  status_reason      TEXT,
  revision_round     INT NOT NULL DEFAULT 0,
  expires_at         TIMESTAMPTZ,
  delivered_at       TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX bookings_client_idx ON bookings (client_id);
CREATE INDEX bookings_professional_idx ON bookings (professional_id);
CREATE INDEX bookings_status_idx ON bookings (status);

CREATE TABLE payments (
  id              SERIAL PRIMARY KEY,
  booking_id      INT NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  amount          NUMERIC(10,2) NOT NULL,
  card_brand      TEXT,
  card_last4      TEXT,
  status          TEXT NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','AUTHORIZED','CAPTURED','HELD','RELEASED','REFUNDED','FAILED','CANCELLED')),
  gateway_txn_id  TEXT,
  refunded_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  failure_reason  TEXT,
  authorized_at   TIMESTAMPTZ,
  captured_at     TIMESTAMPTZ,
  held_at         TIMESTAMPTZ,
  released_at     TIMESTAMPTZ,
  refunded_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payout_accounts (
  professional_id INT PRIMARY KEY REFERENCES professionals(user_id) ON DELETE CASCADE,
  account_holder  TEXT NOT NULL,
  bank_name       TEXT NOT NULL,
  account_last4   TEXT NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payouts (
  id                SERIAL PRIMARY KEY,
  booking_id        INT NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  professional_id   INT NOT NULL REFERENCES professionals(user_id),
  gross_amount      NUMERIC(10,2) NOT NULL,
  commission_amount NUMERIC(10,2) NOT NULL,
  net_amount        NUMERIC(10,2) NOT NULL,
  status            TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','PAID','FAILED')),
  gateway_ref       TEXT,
  failure_reason    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at           TIMESTAMPTZ
);

CREATE TABLE deliverables (
  id           SERIAL PRIMARY KEY,
  booking_id   INT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  file_name    TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_size    BIGINT NOT NULL,
  storage_key  TEXT NOT NULL,
  round        INT NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','EXPIRED')),
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE booking_events (
  id         SERIAL PRIMARY KEY,
  booking_id INT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  actor_id   INT REFERENCES users(id),
  type       TEXT NOT NULL,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reviews (
  id              SERIAL PRIMARY KEY,
  booking_id      INT NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  client_id       INT NOT NULL REFERENCES users(id),
  professional_id INT NOT NULL REFERENCES professionals(user_id),
  rating          INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment         TEXT,
  hidden          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE disputes (
  id              SERIAL PRIMARY KEY,
  booking_id      INT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  raised_by       INT NOT NULL REFERENCES users(id),
  reason          TEXT NOT NULL,
  description     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','UNDER_REVIEW','RESOLVED')),
  resolution_type TEXT CHECK (resolution_type IN ('REFUND_CLIENT','RELEASE_PAYOUT','NO_ACTION')),
  resolution_note TEXT,
  handled_by      INT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX one_open_dispute_per_booking ON disputes (booking_id) WHERE status <> 'RESOLVED';

CREATE TABLE messages (
  id          SERIAL PRIMARY KEY,
  booking_id  INT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  sender_id   INT NOT NULL REFERENCES users(id),
  receiver_id INT NOT NULL REFERENCES users(id),
  content     TEXT NOT NULL,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at     TIMESTAMPTZ
);
CREATE INDEX messages_booking_idx ON messages (booking_id, sent_at);

CREATE TABLE notifications (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  message    TEXT NOT NULL,
  booking_id INT REFERENCES bookings(id) ON DELETE CASCADE,
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE content_reports (
  id              SERIAL PRIMARY KEY,
  reporter_id     INT NOT NULL REFERENCES users(id),
  target_type     TEXT NOT NULL CHECK (target_type IN ('PROFILE','PORTFOLIO_ITEM','REVIEW')),
  target_id       INT NOT NULL,
  reason          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACTION_TAKEN','DISMISSED')),
  resolution_note TEXT,
  handled_by      INT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ
);

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  description TEXT,
  updated_by  INT REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id         SERIAL PRIMARY KEY,
  actor_id   INT REFERENCES users(id),
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  INT,
  detail     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE email_log (
  id         SERIAL PRIMARY KEY,
  to_email   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  delivered  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO settings (key, value, description) VALUES
  ('commission_percent',       '10',  'Platform commission (% of booking value) deducted at payout'),
  ('request_expiry_hours',     '48',  'Hours a professional has to accept or decline a booking request'),
  ('download_link_minutes',    '15',  'Validity of a deliverable download link'),
  ('deliverable_retention_days','90', 'Days deliverables stay downloadable after approval'),
  ('auto_approve_days',        '7',   'Days of client inaction after delivery before auto-approval (0 = never)'),
  ('max_revisions',            '3',   'Maximum revision requests per booking'),
  ('full_refund_days',         '3',   'Client cancellation at least this many days before start = full refund'),
  ('late_cancel_refund_percent','50', 'Refund % when a client cancels later than the full-refund window'),
  ('message_retention_days',   '180', 'Days booking messages are kept after completion (no open dispute)');

# FrameBook – Freelance Photographer & Videographer Booking Platform

A complete, free, local-first marketplace where clients find, book and pay freelance photographers and videographers.
Stack: **React + TypeScript (Vite)**, **Node + Express + TypeScript** REST API, **PostgreSQL**, **MinIO** (file storage), **MailHog** (email), Docker Compose, and a **mock payment gateway**. No paid services.

## Quick start

Requirements: Node 20+, Docker (for Postgres/MinIO/MailHog).

```bash
docker compose up -d                 # Postgres :5432, MinIO :9000/:9001, MailHog :8025
cd server
cp .env.example .env                 # set STORAGE_DRIVER=s3 to use MinIO (default: local disk, both are AES-256 encrypted)
npm install
npm run seed                         # creates the schema and demo accounts
npm run dev                          # API on http://localhost:4000
# new terminal
cd client && npm install && npm run dev   # web app on http://localhost:5173
```
Emails (verification links, admin login codes, notifications) arrive in MailHog: http://localhost:8025. They are also stored in the `email_log` table.

### Demo accounts (after `npm run seed`)
| Role | Email | Password |
|---|---|---|
| Admin (email MFA code from MailHog) | admin@example.com | Admin@123 |
| Support | support@example.com | Support@123 |
| Client | client@example.com / client2@example.com | Client@123 |
| Professional (approved) | maya@example.com, arjun@example.com, isha@example.com, rohan@example.com, neha@example.com | Pro@12345 |
| Professional (awaiting approval) | pending@example.com | Pro@12345 (log in, verify, then submit a document) |

Demo professionals are open every day for the next 60 days, 08:00–22:00.

### Mock payments
- Card `4242 4242 4242 4242` (any future expiry, any 3-digit code) is approved. Card `4000 0000 0000 0002` is declined.
- Only the card brand and last 4 digits are stored. Payout account numbers ending in `0000` simulate a failed payout.

## Run the tests
```bash
cd server
# needs a Postgres database called booking_test
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/booking_test npm test
cd ../client && npm run build        # type-check + production build
```
`server/test/e2e.test.ts` runs 19 end-to-end scenarios against the real API and database (registration and email verification, admin approval, search filters, multi-day booking, payment authorize/capture/void/refund, deliverables and revisions, payout, reviews, disputes, support restrictions, admin settings, cancellation policy, background jobs, security checks). The suite resets the test database each run.

## How it works
- **Roles:** Client, Professional, Admin, Support. Role checks run on the server for every route.
- **Verification:** professionals appear in search and can be booked only after an admin approves their identity document. Admin sign-in requires an emailed one-time code.
- **Booking flow:** the client requests dates (multi-day supported; package price is per day) → card is *authorized* and the days are held → professional accepts (payment *captured*, held by the platform, commission snapshotted) or declines/ignores (authorization released, days freed; requests expire after 48 h) → professional uploads files and marks delivered → client downloads via short-lived signed links, requests revisions (max 3) or approves → payment *released*, payout created (waits until a payout account exists) → client can review once.
- **Cancellation:** professional cancels → full refund. Client cancels ≥ 3 days before start → full refund; later → 50% refund, the rest is paid out less commission. All thresholds are admin settings.
- **Disputes:** client or professional can raise one on a confirmed/delivered booking. Support can review, add notes and close with no action. Only an admin can refund the client or release the payout.
- **Messaging** is scoped to a booking and visible to its two participants (staff can read it inside a dispute). **Notifications** are in-app and by email.
- **Moderation:** users can report profiles, portfolio items and reviews; support/admin hide or dismiss.
- **Admin:** verification queue, user suspension, staff accounts, platform settings (commission and policies), payments overview, reports, audit log.
- **Security:** bcrypt passwords, JWT sessions, validated inputs (zod), rate limiting, helmet headers, upload type/size limits, AES-256-GCM encryption of every stored file, optional HTTPS with TLS 1.3 (`TLS_KEY_FILE` / `TLS_CERT_FILE`), audit log of admin actions.
- **Background jobs** (every minute): expire unanswered requests, auto-approve delivered work after 7 days (setting), delete expired deliverables and old messages.

## Layout
```
client/            React + TypeScript web app
server/            Express API (src/routes, src/services, src/db), tests in server/test
database/schema/   PostgreSQL schema (applied automatically)
docs/DESIGN.md     Architecture, decisions and mapping to the project documents
docker-compose.yml Postgres, MinIO, MailHog
```

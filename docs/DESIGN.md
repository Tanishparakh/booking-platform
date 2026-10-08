# Design – Freelance Photographer & Videographer Booking Platform

Everything runs free and locally: React + Node.js (TypeScript) + PostgreSQL, with MinIO (files) and MailHog (email) in Docker, and a mock payment gateway.

## 1. Architecture

```
React (Vite) ──HTTP/JSON──> Node.js REST API (Express, one process) ──> PostgreSQL
                                   ├── Storage adapter ──> MinIO (S3 API)  | local disk fallback
                                   ├── Mailer ───────────> MailHog (SMTP)  | email_log table fallback
                                   └── Payment gateway ──> Mock/sandbox implementation
```

- One backend, no microservices. Background work (expiry, auto-approve, retention) is a timer inside the same process.
- All uploaded files are AES-256-GCM encrypted by the storage layer before they reach MinIO/disk (AES-256 at rest).
- TLS 1.3: the server serves HTTPS with `minVersion: TLSv1.3` when `TLS_KEY_FILE`/`TLS_CERT_FILE` are set; otherwise run behind any TLS-terminating proxy.
- Auth: bcrypt password hashes, JWT bearer tokens, role-based access control on every protected route. Admin login needs an emailed one-time code (MFA).

## 2. Modules (map to WBS epics)

| Module | WBS | Server files |
|---|---|---|
| Foundation, config, DB, errors | E10 | `config.ts`, `db/*`, `middleware/*` |
| Registration, login, RBAC, MFA, staff provisioning | E1 | `routes/auth.ts`, `routes/admin.ts` |
| Profile, portfolio, packages, availability, verification | E1.5, E2 | `routes/professional.ts`, `services/availability.ts` |
| Search and public profile | E3 | `routes/public.ts`, `services/search.ts` |
| Booking lifecycle | E4 | `services/bookings.ts`, `routes/bookings.ts` |
| Messaging, notifications | E5 | `routes/messages.ts`, `services/notify.ts` |
| Payments, commission, payouts, refunds | E6 | `services/payments.ts`, `services/gateway.ts` |
| Deliverables | E7 | `routes/deliverables.ts`, `services/storage.ts` |
| Reviews | E8 | `routes/reviews.ts` |
| Disputes, moderation, reports, settings | E9 | `routes/disputes.ts`, `routes/staff.ts`, `routes/admin.ts` |
| Tests | E12 | `test/e2e.test.ts` |

## 3. Database entities

`users` (role: CLIENT / PROFESSIONAL / ADMIN / SUPPORT) with `clients` and `professionals` (type PHOTOGRAPHER or VIDEOGRAPHER) as specialisations; `profiles`, `portfolio_items`, `packages`, `availability` (one row per professional per day), `verifications`, `bookings`, `payments`, `payouts`, `payout_accounts`, `deliverables`, `booking_events` (audit trail incl. revision comments), `reviews`, `disputes`, `messages`, `notifications`, `content_reports`, `settings` (admin-editable), `audit_log`, `email_log`.

Key relationships: Professional 1–1 Profile, 1–* Package, 1–* Availability, 0..1 pending/approved Verification. Client 1–* Booking *–1 Professional; Booking *–1 Package, 1–0..1 Payment, 1–0..1 Payout, 1–* Deliverable, 1–* Message, 1–0..1 Review, 1–* Dispute.

## 4. API structure (all under `/api`)

- `auth`: register, verify-email, login, mfa/verify, me
- `pro`: profile, verification, portfolio, packages, availability, payout-account, payouts
- `professionals` (public): search, profile, availability
- `bookings`: create, list, get, accept, decline, cancel, deliverables (upload/list), approve, revision, messages, review, dispute
- `deliverables`: link (time-limited), download
- `notifications`, `reports` (content reports), `disputes`
- `staff` (ADMIN + SUPPORT): disputes, content reports, booking information
- `admin` (ADMIN only): verifications, users, staff accounts, settings, payments, reports summary

## 5. Booking and payment state flow

Booking status and payment status are separate.

```
Client submits request → booking PENDING (days HELD) → payment AUTHORIZED
  Professional accepts → booking CONFIRMED, payment CAPTURED→HELD, days BOOKED, chat opens
  Professional declines → DECLINED, authorization voided (payment CANCELLED), days free
  No answer in 48 h → EXPIRED, authorization voided, days free
  Cancel (client, pending) → CANCELLED, authorization voided
  Cancel (confirmed) → CANCELLED, refund per policy
Professional uploads → DELIVERED → client approves → COMPLETED, payment RELEASED, commission deducted, payout created (PENDING→PROCESSING→PAID)
                                 → client asks for revision → REVISION_REQUESTED → professional re-uploads → DELIVERED
Dispute (confirmed/delivered/revision) → DISPUTED (funds stay held) → staff resolves:
  support: add notes, mark under review, close with NO_ACTION
  admin only: REFUND_CLIENT (payment REFUNDED, booking CANCELLED) or RELEASE_PAYOUT (booking COMPLETED, payout)
```

Payment status values: PENDING, AUTHORIZED, CAPTURED, HELD, RELEASED, REFUNDED, FAILED, CANCELLED. Payout status: PENDING, PROCESSING, PAID, FAILED.

## 6. Decisions where the documents disagreed

1. **Payment order** – SRS/WBS read as approve-then-pay; the activity diagram and master prompt authorise first. Used: authorise at request, capture on acceptance.
2. **Revision requests** – in Experiment 2 and the activity diagram, not in the SRS/WBS. Included (limit is an admin setting, default 3).
3. **Multi-day bookings** – one booking with start/end date; the package price applies per booked day.
4. **Availability** – professional publishes AVAILABLE days with a time window; every day of a booking must be available and inside the booking times. Pending and confirmed bookings block the days.
5. **SRS "to be determined" items** – commission %, retention days and database are settings/decisions: commission default 10 % (admin-editable), deliverable retention 90 days (editable), PostgreSQL chosen.
6. **Open WBS items** – [C2] client inaction: auto-approve after 7 days (editable, 0 disables). [C5] staff provisioning: admins create staff accounts. [C6] flagged reviews: reports flow to staff who can hide a review. [C8] retention: scheduled clean-up.
7. **Cancellation policy (E6.6)** – professional cancels: full refund. Client cancels confirmed booking at least 3 days before start: full refund; later: 50 % refund and the rest is paid out less commission. Both are settings.
8. **Support restrictions** – support cannot change settings, refund, release payouts or resolve money outcomes; enforced server-side.
9. **Card data** – the mock gateway receives a test card number only to decide the outcome; only brand and last 4 digits are stored. Card `4000000000000002` is declined; any other 16-digit number is approved.
10. **Early delivery** – deliverables can be uploaded any time after confirmation so the flow can be demonstrated without waiting for the event date.

## 7. Roadmap

1. Foundation → 2. Auth/RBAC/MFA → 3. Professional onboarding and profile → 4. Search → 5. Booking → 6. Payments → 7. Deliverables → 8. Reviews and disputes → 9. Admin and reports → 10. Frontend → 11. Integration tests, docker-compose, README.

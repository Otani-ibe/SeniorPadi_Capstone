# SeniorPadi

A free web platform that connects people aged 60+ in Ibadan to community events: exercise groups, church programmes, skills classes and more. Seniors can register to attend or volunteer. NGO staff list the events on behalf of partner organizations.

Built for low-bandwidth phones. Every page is server-rendered and works without JavaScript.

## Stack

Node.js + Express 5, PostgreSQL, Sequelize, EJS, Tailwind CSS v4, express-session (stored in Postgres), Multer + Cloudinary for uploads, Brevo for email and SMS, node-cron for reminders.

## What's in this version (all three phases)

**Seniors**
- Sign up with name, phone, password and a "60 or older" checkbox. Email is optional.
- Log in with phone number. Reset password by email link, or staff reset it (temporary password sent by SMS).
- Browse events in two tabs: "This week" and "Later". Filter by type.
- Register to attend, volunteer, or both. Attendee and volunteer spots are counted separately.
- Tags: "Almost full" (5 or fewer spots left), "Capacity reached", "Registration closes in X days" (5 or fewer days), "Hosted by a senior", "Volunteers needed". Registration counts are never shown to seniors.
- When an event is full: "Tell me when a similar event is listed" opt-in.
- Confirmation by SMS and email. Reminder SMS 1, 2 or 3 days before (senior chooses).
- Cancel a place from "My places". The seat frees up straight away.
- Past events, settings (language, reminder day, email, area, bio, profile picture).
- English and Yorùbá. All texts and emails follow the senior's language.

**Admins (NGO staff)**
- Dashboard: events in the next 14 days with numbers, events that still need attendance entered, seniors with no-shows (for a follow-up call, no penalty).
- Add and edit organizations.
- Add, edit and cancel events, with an optional picture. Cancelling texts everyone registered.
- Printable attendance list, then mark each person as came / didn't come after the event.
- Search seniors and reset their password.

**Social layer (Phase 2)**
- Seniors upload an ID (JPG, PNG or PDF) from Find Seniors. It's stored in Cloudinary as a private file. Rejection comes with a reason and never touches event access.
- Once verified: Find Seniors shows one senior at a time with Message, Skip and Report. Skipped people don't come back. When there's no one left: "You've seen everyone for now."
- Messages: plain server-rendered conversations (form POST, works without JavaScript), inbox with "New" markers, older messages paged 50 at a time.
- Report: hides the reported senior from the reporter straight away and pauses messages both ways. The reported senior isn't told and isn't affected until staff decide.
- Block: both ways, permanent, from inside a conversation. Anyone blocked or reported just sees "This conversation isn't available."
- In-app notifications for new messages and ID results.
- Delete my account (asks for the password).

**Admin additions**
- ID checks: "View ID" makes a signed Cloudinary link that expires in 5 minutes. Every view is written to the audit log. Approve, or send back with a reason.
- Reports: see the conversation snapshot, then warn, remove from social, or dismiss. Dismissing doesn't undo the reporter's hide.
- Per senior: remove from social (events untouched) or delete account (upcoming places freed, past attendance kept, row soft-deleted).
- Dashboard alerts: new IDs, new reports, and spots freed by a deleted account on events starting within 2 days.

**Phase 3**
- **Live chat (Socket.IO):** on a conversation page, a small script tries to connect for 3 seconds. If it works, messages appear without reloading and Send goes over the socket. If it doesn't (old phone, bad network, JS off), nothing changes and the normal form is used. No typing indicators, read receipts or online status. The server checks the session, a CSRF token, the page's origin, verification, blocks and reports on connect and again on every message. Both the form and the socket go through the same `sendMessage` function. A message sent by form still appears live for the other person, and no "new message" notification is created if they're already reading the conversation.
- **Welcome guide:** shown once after sign-up (or at first login if a relative signed them up), in the senior's language. The video loads only when they press play (480p, low quality), and the full transcript is always on the page. If there's no video, they just see the written guide. Skip is always there, and Settings has "Watch the welcome guide again". Admins upload one video and transcript per language under Welcome video. The default transcript doubles as a script for recording it.
- **QR check-in (optional):** each registration has a code, tucked behind "Show my check-in code" on the confirmation page and in My places, with a note that it isn't needed. Staff scan it with their phone camera, log in if asked, and tap "Mark as came". It updates the same record as the manual list. Cancelled places show a note instead of a button.

## Running it

**Everything is automatic.** `npm start` checks the settings, waits for the database (Neon can take a few seconds to wake), applies any migrations that haven't run yet, adds the default welcome guide text, creates the first admin from `ADMIN_NAME` / `ADMIN_PHONE` / `ADMIN_PASSWORD` if there are no staff, builds the CSS if it's missing, then starts the site. Anything already done is skipped. Problems are printed in plain words, and settings warnings start with `!`.

**On Windows:** double-click `start-windows.bat`. The first time, it creates `.env` and opens it in Notepad. Fill it in, save, and double-click again. It installs everything the first time.

**From a terminal:**

```bash
npm install
cp .env.example .env   # fill it in (Windows: copy .env.example .env)
npm start              # or: npm run dev (restarts when files change)
```

**Demo data (optional, local only):** `npm run seed:local` wipes the local database and fills it with sample seniors and events.

**Demo logins** after seeding (password for all: `password123`)

| Who | Phone |
|---|---|
| Admin | 08000000001 |
| Senior (English, verified) | 08030000011 |
| Senior (Yorùbá, verified) | 08030000010 |
| Senior (ID waiting for check) | 08030000016 |
| Senior (not verified yet) | 08030000018 |
| Senior who hasn't seen the welcome guide | 08030000019 |

The two verified seniors already have a short conversation.

More staff can be added from the admin area (**Staff** page). There's also `npm run create-admin -- "Full Name" 08031234567 a-strong-password`.

## Local Postgres or Neon

One setting decides which database everything uses (the app, migrations, the session store and the seed script):

| Command | Uses |
|---|---|
| `npm run dev` | whatever `DB_TARGET` says in `.env` |
| `npm run dev:local` / `npm run dev:neon` | local / Neon, whatever `.env` says |
| `npm run db:check`, `db:check:local`, `db:check:neon` | shows the host, SSL, DNS lookup and whether it connects |
| `npm run db:migrate`, `db:migrate:local`, `db:migrate:neon` | runs migrations by hand (not needed, starting the app does it) |
| `npm run seed:local` / `npm run seed:neon` | wipes and fills that database with demo data |

`npm run seed` refuses to wipe anything that isn't on localhost unless you use `seed:neon`. Each database gets its migrations the first time the app starts against it.

If `db:check:neon` says **DNS: FAILED**, your network can't find Neon. Switch to local until it's fixed.

## Environment variables

| Name | What it's for |
|---|---|
| `DB_TARGET` | `local` or `neon`. Leave empty on Render |
| `LOCAL_DATABASE_URL` | Postgres on your computer |
| `NEON_DATABASE_URL` | Neon connection string. SSL is turned on automatically |
| `DATABASE_URL` | Used when `DB_TARGET` is empty (Render) |
| `TEST_DATABASE_URL` | Separate database for tests (it gets wiped) |
| `DB_SSL` | `true` for non-Neon hosts that need SSL (`DB_SSL_STRICT=false` for self-signed certificates) |
| `SESSION_SECRET` | Long random string |
| `APP_URL` | Used for links in emails and SMS. On Render it's filled in automatically |
| `ADMIN_NAME`, `ADMIN_PHONE`, `ADMIN_PASSWORD` | First staff account, created on start only if there are no staff yet |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Picture uploads. Without them the app still runs, uploads are just switched off |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `BREVO_SMS_SENDER` | Email and SMS |
| `NOTIFY_DRY_RUN` | `true` prints emails and SMS in the terminal instead of sending them |
| `SUPPORT_PHONE` | Shown to seniors who forget their password and have no email |

## Tests

```bash
npm test
```

Uses `TEST_DATABASE_URL`. Covers (35 tests): migrations running once on an empty database and being skipped after, the first admin and default content being created only once, no overbooking when many people register at once, attendee and volunteer seats counted separately, cancelled and no-show not taking seats, tag thresholds, deadline closing registration, plain-form signup and registration without JavaScript, 60+ checkbox, CSRF protection, admin-only pages, manual attendance, the verification gate on messages, report hiding the reported senior from the reporter only, blocks, skips, social removal leaving registrations alone, account deletion cancelling only upcoming places, admin-only signed ID links, rejected IDs keeping event access, the socket refusing unverified seniors and bad tokens, live delivery, blocks and social removal checked on every socket message, QR and the manual list updating the same record, and the welcome guide showing once.

## Project structure

```
HANDOVER.md        plain-language guide for whoever runs the app
render.yaml        one-click Render setup
start-windows.bat  double-click to run on Windows
src/
  app.js, server.js  (server.js does all the start-up setup)
  config/          database config (used by sequelize-cli too)
  models/          Sequelize models
  migrations/      one per table
  routes/          public (auth), events, account, social, onboarding, admin
  sockets/         Socket.IO setup (live chat)
  middleware/      auth, csrf, rate limits, uploads, locals
  services/        capacity, notify (Brevo), cloudinary, social, messaging, removal, qr, cron, i18n, dates, phone, audit
  scripts/         seed, create-admin
  styles/input.css Tailwind source
views/             EJS pages, partials and the email layout
locales/           en.json, yo.json
public/            built CSS, optional JS (upload button text, live chat)
tests/
```

## How a few things work

- **No overbooking:** registering runs in a transaction that locks the event row (`SELECT ... FOR UPDATE`) before counting seats. Only `registered` and `attended` take a seat.
- **Uploads:** Multer keeps the file in memory and streams it to Cloudinary. Nothing is saved on the server. Upload forms send the CSRF token in the URL because the body isn't read until Multer runs.
- **Notifications:** `src/services/notify.js` is the only file that talks to Brevo, so the provider can be swapped. A failed SMS never blocks a registration. It retries once after 30 seconds on a server error, then writes to the audit log.
- **Reminders:** a cron job runs at 8am Lagos time and texts everyone whose reminder day is today. Another job marks finished events as completed every hour.
- **Times:** stored in UTC, shown in Lagos time. Admin date inputs are treated as Lagos time.

## Deployment (Render + Neon)

`render.yaml` is a Render Blueprint. In Render, go to **New**, then **Blueprint**, and pick the repo. Then fill in the values it asks for: the Neon `DATABASE_URL`, the first admin, and the Brevo and Cloudinary keys. `SESSION_SECRET` is generated for you, `APP_URL` is taken from Render, and the health check uses `/health`. The start command runs migrations on its own, so there's no build-time migration step.

The free plan sleeps when idle, so use a free uptime monitor on `/health` every 5 minutes (see `HANDOVER.md`). Render supports WebSockets on web services, so live chat works with no extra setup.

**`HANDOVER.md` is the plain-language guide for whoever runs the app day to day.** It covers setup, everyday admin tasks, and a troubleshooting table.

## Before going live

- **Yorùbá text:** the strings in `locales/yo.json` need checking by a native speaker. The Yorùbá long date format on event pages also comes straight from the browser's built-in formatter and may read oddly.
- **SMS in Nigeria:** check that Brevo delivers to Nigerian numbers with the `SeniorPadi` sender name, including numbers on DND. Test with a real phone early.
- **Brevo endpoints:** the app calls `/v3/smtp/email` and `/v3/transactionalSMS/sms`. Check these against Brevo's current API docs.

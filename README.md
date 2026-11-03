# SeniorPadi

SeniorPadi is a website for people aged 50 and over in Ibadan, Nigeria. It helps them find community events, sign up to attend or volunteer, and meet other seniors safely. Churches, NGOs and community groups run the events, and their staff manage everything from an admin area. The site is built for phones first, uses large text and plain words, and works in English and Yorùbá.

## Links

- Repository: https://github.com/Otani-ibe/SeniorPadi_Capstone.git
- Walkthrough video: https://drive.google.com/file/d/1_LISSND8AedGtK5BaS0iIM7cdfP2ksv0/view?usp=sharing
- Technical report (PDF, 5 pages maximum): https://github.com/Otani-ibe/SeniorPadi_Capstone/blob/main/docs/technical-report.pdf
- Project write-up: [docs/MVP.md](docs/MVP.md)
- Designs in Figma: https://www.figma.com/design/sqFCpB8uT98d3noTAO0D8J/UI-SeniorPadi?node-id=16-2&t=rFjVQdjne0RzcCx4-1
- [HANDOVER.md](HANDOVER.md) is a plain guide for whoever runs the site day to day.

## Project overview

Many older people in Ibadan do not hear about events near them, find most websites hard to read, and have few safe ways to meet new people. Many use cheap phones with slow data, and relatives often help them online. I wanted to build something simple enough for that situation.

What a senior can do:

- Sign up with a phone number. There is no password: the site texts a login code each time.
- Browse events one card at a time and register, or skip. Events near them and events picked for them come first, with a small note saying why.
- Register to attend, volunteer, or both, and get a confirmation and a reminder by SMS. A place can be cancelled at any time so someone else can take it.
- Get a text and a notice if an event they registered for changes its date, time, place or price.
- Verify with their NIN to unlock Find Seniors, where they can look through other verified seniors, chat, see who is online, swap phone numbers and make voice calls. Missed and answered calls show in the chat, with how long they lasted.
- Report or block anyone who makes them uncomfortable.
- Use the whole site in English or Yorùbá. A son or daughter can also sign a parent up and book events for them.

What staff can do:

- Add organisations and events, with a flyer, a number of places, volunteers needed, and an option to show an event first.
- When they edit an event, choose whether to tell the seniors who are registered.
- Print an attendance list, check people in with a QR code or ticket number, and share a check-in link with the host organisation.
- Handle reports and manage other staff accounts.
- See a dashboard with live numbers, charts, and what needs attention.

One staff account is the superadmin. It is the only one that can see the NINs seniors send.

### Some decisions I made

- NIN checks are done by hand. I first planned to use an outside identity-check service, but those need a registered business, which I do not have yet. So a senior types their NIN, it is saved encrypted, the superadmin checks it on the official NIMC website, and the NIN is deleted as soon as a decision is made.
- Locations are plain latitude and longitude columns, not PostGIS. PostGIS is not on a normal local PostgreSQL install, and I wanted the same code to run on my computer, in the tests and on the hosted database.
- Recommendations use a simple score out of 100, not machine learning. It adds up interest in the event type, distance, past attendance, how soon the event is and some variety. The weights are in `src/config/recommendation.js`, so they are easy to change.
- Texts and emails are only printed in the terminal while `NOTIFY_DRY_RUN=true`. That lets me develop without paying for SMS.

## Technical requirements

Software I used and tested with:

| Software | Required | What I used |
|---|---|---|
| Node.js | 20 or newer | 22.19.0 |
| npm | any recent version | 10.9.3 |
| PostgreSQL | 14 or newer should work | 18.6 on my computer, and Neon (hosted PostgreSQL) for the live site |
| Operating system | Windows, macOS or Linux | Windows 11. The host, Render, runs it on Linux |
| Browser | any current browser with WebSocket and WebRTC | desktop Chrome and iPhone Safari |

Main frameworks and libraries. The exact versions are in `package-lock.json`.

| Library | Version | Used for |
|---|---|---|
| Express | 5.2.1 | the web server |
| Sequelize and pg | 6.37.8 and 8.23.0 | talking to PostgreSQL |
| EJS | 6.0.1 | the pages |
| Tailwind CSS | 4.3.3 | styling |
| Socket.IO | 4.8.4 | chat, online status and setting up calls |
| express-session and connect-pg-simple | 1.19.0 and 10.0.0 | login sessions kept in the database |
| csrf-sync, express-rate-limit, bcrypt | 4.2.1, 8.7.0 and 6.0.0 | form protection, limits on repeated requests, password hashing |
| multer and Cloudinary | 2.4.0 and 2.11.0 | picture uploads |
| node-cron | 4.6.0 | daily event reminders |
| qrcode | 1.5.4 | QR codes for check-in |
| Jest, Supertest, socket.io-client | 30.5.2, 7.3.0 and 4.8.4 | the tests |
| nodemon, cross-env | 3.1.14 and 10.1.0 | development tools |

The browser also loads the Lucide icon font (0.460.0) and the Nunito Sans font from the internet. Voice calls use WebRTC in the browser with a Cloudflare TURN server to get through mobile networks.

Outside services. Only PostgreSQL is needed to run the project on your own computer. The others have a fallback:

- Cloudinary stores profile photos and flyers. Without it, files are saved on your computer.
- Brevo sends SMS and email. Without it, messages are printed in the terminal.
- Cloudflare provides the TURN server for calls. Without it, calls still work on a good connection.
- OpenStreetMap Nominatim finds the latitude and longitude of addresses. Without it, the middle of the area is used.
- Google Translate is optional and is only for translating event text into Yorùbá.
- Render hosts the site and Neon hosts the database, but only for the live version.

Hardware: any 64-bit computer that can run Node.js and PostgreSQL. 4 GB of memory is the minimum. I would suggest 8 GB, because the full test suite runs the app, the database and a browser together. Users only need a phone or computer with a browser and an internet connection, plus a microphone for voice calls.

## Installation

1. Install Node.js 20 or newer and PostgreSQL. Check that `node -v` and `psql --version` both work.
2. Get the code:

   ```bash
   git clone https://github.com/Otani-ibe/SeniorPadi_Capstone.git
   cd SeniorPadi_Capstone
   ```

3. Create two empty databases, one for the app and one for the tests. The tests wipe theirs every time.

   ```bash
   createdb seniorpadi
   createdb seniorpadi_test
   ```

4. Install the packages:

   ```bash
   npm install
   ```

5. Create a file called `.env` in the main folder. This is enough to start:

   ```
   DB_TARGET=local
   LOCAL_DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/seniorpadi
   TEST_DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/seniorpadi_test
   SESSION_SECRET=any-long-random-text
   NIN_ENCRYPTION_KEY=any-random-text-of-32-or-more-characters
   ADMIN_NAME=Your Name
   ADMIN_PHONE=08012345678
   ADMIN_PASSWORD=at-least-8-characters
   NOTIFY_DRY_RUN=true
   ```

6. Start the site:

   ```bash
   npm start
   ```

   On the first start it connects to the database, creates the tables, adds the starter events, builds the stylesheet if it is missing, and creates the first staff account. Then open http://localhost:3000. On Windows you can also double-click `start-windows.bat`. While developing, `npm run dev:local` restarts the site whenever a file changes.

7. Log in. Type a phone number and the site "sends" a code. Because `NOTIFY_DRY_RUN=true`, nothing is really sent: the code is printed in the terminal where the site is running. Staff log in with their phone number and password.

### Demo data

```bash
npm run seed:local
```

This clears the local database and fills it with sample organisations, events, verified demo seniors with pictures, and a staff account. Every demo account has the password `password123`.

- Staff: 08000000001
- Senior, English, verified: 08030000011
- Senior, Yorùbá, verified: 08030000010
- Senior, phone not confirmed yet: 08030000017

To make a staff account the superadmin, run `npm run superadmin -- --phone 08000000001 --name "Your Name"`.

### Using a hosted database

Set `DB_TARGET=neon` and add `NEON_DATABASE_URL` to use Neon instead of the local database. `npm run db:check` tests the connection. Database changes are applied automatically every time the site starts.

## Settings

The settings go in `.env`. That file must never be committed, and it is already in `.gitignore`.

| Setting | What it is for |
|---|---|
| `DB_TARGET` | `local` or `neon` |
| `LOCAL_DATABASE_URL`, `NEON_DATABASE_URL`, `DATABASE_URL` | the database for each case (`DATABASE_URL` is the one Render sets) |
| `TEST_DATABASE_URL` | a separate database for the tests |
| `SESSION_SECRET` | any long random text |
| `NIN_ENCRYPTION_KEY` | 32 or more random characters, used to lock NINs while they wait for the superadmin. Without it no NIN is accepted |
| `ADMIN_NAME`, `ADMIN_PHONE`, `ADMIN_PASSWORD` | the first staff account |
| `APP_URL`, `PORT` | the site address, and the port (3000 if not set) |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | picture uploads |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `BREVO_SMS_SENDER` | SMS and email |
| `NOTIFY_DRY_RUN` | `true` prints messages in the terminal instead of sending them |
| `CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_API_TOKEN` | voice calls on mobile networks |

A few more are optional: `SUPPORT_PHONE` and `SUPPORT_WHATSAPP_URL` (the numbers behind the Call and WhatsApp buttons), `GEOCODING=off` (to switch off address lookups), `RECOMMEND_WEIGHTS` (to change the recommendation weights) and `GOOGLE_TRANSLATE_API_KEY`.

## Commands

```bash
npm start                  # run the site
npm run dev:local          # run it and restart on changes
npm run build:css          # build the stylesheet
npm test                   # run all the tests
npm run seed:local         # reset the local database with demo data
npm run events:add         # add the sample events (add :neon for the live database)
npm run superadmin         # make a staff account the superadmin
npm run services:check     # check that Cloudinary and Brevo keys work
npm run db:check           # test the database connection
```

The rest of the scripts are listed in `package.json`.

## Repository structure

```
.
├── README.md
├── HANDOVER.md          guide for whoever runs the site
├── package.json         packages, npm commands, Node version
├── render.yaml          the hosting setup for Render
├── start-windows.bat    double-click start for Windows
├── docs/                project write-up and design screenshots, notes on NIN checks and flyers
├── locales/             en.json and yo.json, all the text shown on the site
├── public/
│   ├── css/             the built stylesheet
│   ├── js/              small browser scripts (swipe cards, chat, calls, dashboard)
│   └── images/          logo, demo seniors and event flyers
├── views/               the EJS pages
│   ├── partials/        header, menus, event card, pop-ups
│   ├── admin/           the staff area
│   └── auth/, account/, events/, social/, identity/ ...
├── src/
│   ├── server.js        start-up: database, updates, jobs, then listen
│   ├── app.js           Express setup
│   ├── config/          database choice, sessions, recommendation weights
│   ├── middleware/      login and role checks, CSRF, rate limits, uploads
│   ├── routes/          the pages and form handlers
│   ├── services/        the main logic: registration, messaging, calls, NIN checks,
│   │                    nearby events, recommendations, SMS and email
│   ├── sockets/         Socket.IO: chat, online status and call set-up
│   ├── models/          the database tables
│   ├── migrations/      one file for each database change, run automatically
│   ├── scripts/         command-line tools (seed, add events, superadmin, service check)
│   └── styles/          the Tailwind source file
└── tests/               the automated tests
```

## Testing

I run the tests with `npm test`. They use their own database, which is rebuilt before every test, so it must be a different one from the one I develop in. The last full run had 31 test suites and 354 tests, and all of them passed.

Most of the tests are integration tests. They load the real pages and submit the real forms with Supertest, for example signing up, registering for an event, using the staff screens, messaging and the NIN check. The chat, online status and call tests use a real Socket.IO server with real clients. The recommendation scoring, the distance calculation and the NIN encryption are plain functions, so they have ordinary unit tests.

I also tested the rules that matter most, and the failures. An event cannot be overbooked even when many people register at once. A NIN can only verify one account. Unverified seniors cannot reach Find Seniors, chat or calls, even by typing the address. The NIN does not appear in any page, log or database row once it has been decided. People without a saved location, bad form input and outside services that are down are all covered too.

Separately from the test suite, I opened the site in headless Chrome at phone, tablet and desktop widths to check the layout, and that each event flyer shows whole.

On a small computer, running everything in one go can run out of memory. A single file can be run on its own, for example `npx jest --runInBand tests/identity.test.js`.

## Code quality

I tried to keep the routes short and put the real work in `src/services`, so the rules are in one place and easy to test. The score for recommended events and the check for what changed in an event are functions that take plain values and return plain values, with no database inside.

Checks that must always hold are also in the database, so a bug in the app cannot save wrong data. Examples are the allowed statuses, valid coordinates, one verified account per NIN, and a NIN that cannot be kept after a decision.

Every restricted page is checked on the server, and so is every chat and call connection. Forms have CSRF protection, repeated requests are limited, passwords are hashed, and the NIN is encrypted and never written to a log. Secrets are only ever in the settings, never in the code.

Slow outside work, such as address lookups and SMS, happens in the background. If it fails, the failure is logged but the page still works.

For accessibility, text and buttons are large, icons have labels, event flyers have a written description for screen readers, and the pages work without JavaScript. All the text is in English and Yorùbá. Each feature came with tests, and the comments in the code explain why something is done, not only what it does.

## What is not finished

- NIN checks depend on the superadmin looking each one up by hand. This is fine for a small start but will not scale.
- Texts only work with Brevo credit, and the SMS sender name may need to be registered with Nigerian networks. Login codes are sent by text, so this matters before launch.
- Page views are not recorded, so recommendations use registrations and chosen interests only.
- Event text is only translated into Yorùbá when a Google Translate key is set.


## Deployment

I host the site on Render and keep the database on Neon.

1. Push the code to GitHub.
2. In Render choose New, then Blueprint, and pick this repository. `render.yaml` sets up the service.
3. Fill in the settings Render asks for: the database link, the first staff account, `SESSION_SECRET`, `NIN_ENCRYPTION_KEY`, and the Cloudinary, Brevo and Cloudflare keys.
4. After the first deploy the site updates its own database. Then run the live commands, for example `npm run superadmin:neon -- --phone 08012345678 --name "Your Name"` and `npm run events:add:neon`.

After that, every push to GitHub updates the live site automatically.

## Licence

MIT

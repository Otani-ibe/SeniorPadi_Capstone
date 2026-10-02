# SeniorPadi

SeniorPadi is a free website that helps people aged 60 and over in Ibadan find community events, like exercise groups, church programmes and skills classes. They can sign up to attend or volunteer, and once their ID is checked, they can meet and chat with other seniors.

NGO staff manage the events for partner organisations (churches, clubs, community centres).

**GitHub repo:** https://github.com/Otani-ibe/SeniorPadi_Capstone.git
**Demo video:** https://drive.google.com/file/d/1_LISSND8AedGtK5BaS0iIM7cdfP2ksv0/view?usp=sharing
**Project write-up:** [docs/MVP.md](docs/MVP.md)

## What it does

**For seniors**
- Sign up with a phone number. Email is optional.
- Browse events, then register to attend, volunteer, or both.
- Get a confirmation and a reminder by SMS (and email if they have one).
- Cancel a place at any time, so someone else can take it.
- Use the site in English or Yorùbá.
- Upload an ID to unlock Find Seniors, then message other verified seniors.
- Report or block anyone who makes them uncomfortable.

**For staff**
- Add organisations and events.
- Print an attendance list and mark who came.
- Check IDs and handle reports.
- Reset passwords and manage staff accounts.
- See a System page that shows whether the database, SMS and uploads are working.

## Designs

**Figma:** https://www.figma.com/design/sqFCpB8uT98d3noTAO0D8J/UI-SeniorPadi?node-id=16-2&t=rFjVQdjne0RzcCx4-1

This is the initial version of the app. The Figma file shows a simpler redesign that will be added in the next phase. Design screenshots are in [docs/MVP.md](docs/MVP.md).


## Built with

Node.js, Express, PostgreSQL, Sequelize, EJS, Tailwind CSS, Socket.IO (live chat), Cloudinary (pictures and IDs) and Brevo (SMS and email).

## Running it on your computer

You need Node.js 20+ and PostgreSQL.

1. Download the project and open the folder.
2. Create a file called `.env` in the main folder and add the settings from the **Settings** table below (at least the database link and the first admin).
3. Run:

```bash
npm install
npm start
```

`npm start` sets everything up by itself: it connects to the database, creates the tables and makes the first admin account. Then open http://localhost:3000.

On Windows you can also just double-click `start-windows.bat`.

### Demo data

```bash
npm run seed:local
```

This clears your local database and adds sample events and users. Every demo account uses the password `password123`.

| Account | Phone |
|---|---|
| Admin | 08000000001 |
| Senior (verified) | 08030000011 |
| Senior (Yorùbá, verified) | 08030000010 |
| Senior (ID waiting for check) | 08030000016 |
| Senior (not verified) | 08030000018 |

### Local database or Neon

In `.env`, set `DB_TARGET=local` to use PostgreSQL on your computer, or `DB_TARGET=neon` to use Neon. Run `npm run db:check` to test the connection.

## Settings (.env)

| Setting | What it's for |
|---|---|
| `DB_TARGET` | `local` or `neon` |
| `LOCAL_DATABASE_URL` | PostgreSQL on your computer, e.g. `postgresql://postgres:yourpassword@localhost:5432/seniorpadi` |
| `NEON_DATABASE_URL` | Neon connection link |
| `DATABASE_URL` | Database on Render |
| `TEST_DATABASE_URL` | A separate database for tests (it gets wiped) |
| `SESSION_SECRET` | Any long random text |
| `ADMIN_NAME`, `ADMIN_PHONE`, `ADMIN_PASSWORD` | The first staff account |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Picture and ID uploads |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` | SMS and email |
| `NOTIFY_DRY_RUN` | Set to `true` to print messages in the terminal instead of sending them |
| `SUPPORT_PHONE` | The number seniors can call for help |

Never commit `.env`. It's already in `.gitignore`.

## Tests

```bash
npm test
```

The tests check the important parts:
- An event can never be overbooked, even when lots of people register at once.
- Forms work without JavaScript.
- Seniors can't open staff pages.
- Only verified seniors can send messages.
- Blocking and reporting work as expected.

## Deployment plan

The plan is to host the site on **Render**, with the database on **Neon**:

1. Push the code to GitHub.
2. In Render, choose **New**, then **Blueprint**, and pick this repo. `render.yaml` sets everything up.
3. Fill in the settings Render asks for: the database link, the first admin, and the Brevo and Cloudinary keys.

After that, every new push to GitHub updates the live site automatically.

`HANDOVER.md` is a plain guide for the person who'll run the site day to day.

## Folders

```
src/
  routes/       pages and form handlers
  services/     main logic (registration, messages, SMS, uploads)
  models/       database tables
  migrations/   creates the tables
views/          the HTML pages (EJS)
public/         CSS and small scripts
locales/        English and Yorùbá text
tests/          automated tests
docs/           project write-up and design screenshots
```
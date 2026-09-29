# Running SeniorPadi: handover guide

This guide is for the person looking after SeniorPadi day to day. You don't need to know how to code.

The app sets itself up every time it starts. It connects to the database, applies any updates, adds the first staff account and checks its settings. There are no commands to run.

---

## 1. What SeniorPadi is made of

SeniorPadi uses four online services. Keep the logins for all four somewhere safe, because you'll need them if anything goes wrong.

| Service | What it does | Website |
|---|---|---|
| **Render** | Runs the website | render.com |
| **Neon** | Stores all the data (seniors, events, registrations) | neon.tech |
| **Brevo** | Sends the text messages and emails | brevo.com |
| **Cloudinary** | Stores pictures, ID photos and the welcome video | cloudinary.com |

The code lives on **GitHub**. Render takes it from there.

---

## 2. Putting it online (one time only)

1. Create free accounts on Render, Neon, Brevo and Cloudinary.
2. **Neon:** create a project and pick the region **US East (Ohio)**. Click **Connect** and copy the connection string. It starts with `postgres://`.
3. **Render:** click **New**, then **Blueprint**, and choose the SeniorPadi GitHub repository. Render reads the settings file in the project and asks you to fill in these values:

| Setting | What to put |
|---|---|
| `DATABASE_URL` | The Neon connection string from step 2 |
| `ADMIN_NAME` | Your full name |
| `ADMIN_PHONE` | Your phone number. You'll log in with this |
| `ADMIN_PASSWORD` | A password of 8 or more characters |
| `SUPPORT_PHONE` | The number seniors should call for help |
| `BREVO_API_KEY` | In Brevo: SMTP & API, then API Keys, then Generate |
| `BREVO_SENDER_EMAIL` | An email address you've verified in Brevo |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Shown on the Cloudinary dashboard |

4. Click **Apply** and wait about 5 minutes.
5. Open the web address Render gives you (for example `https://seniorpadi.onrender.com`), then add `/login` to the end.
6. Log in with the admin phone and password you chose.
7. Go to **System** in the menu. Everything should be green.

You can leave Brevo and Cloudinary empty at first. The site still works, but texts and uploads stay off until you add them. The System page shows what's missing.

---

## 3. Keeping it awake

On Render's free plan, the site goes to sleep after about 15 minutes with no visitors. The next visitor then waits about a minute for it to wake up, and the 8am reminder texts can be missed while it's asleep.

You can fix this for free:

1. Create a free account on **uptimerobot.com**.
2. Add a new monitor with type **HTTP(s)**.
3. For the URL, use your Render web address with `/health` on the end, for example `https://seniorpadi.onrender.com/health`.
4. Set the interval to **5 minutes**.

UptimeRobot also emails you if the site goes down. If the NGO can pay, Render's cheapest paid plan never sleeps, and then you don't need UptimeRobot.

---

## 4. Everyday use

Log in at your web address with `/login` on the end. The menu at the top has:

- **Dashboard:** what's coming up in the next two weeks, attendance still to enter, IDs to check, new reports, and alerts.
- **Events:** add, change or cancel events. Cancelling one texts everyone who registered.
- **Organizations:** the churches, clubs and centres that host events. Add one before adding its first event.
- **Seniors:**
  - Find someone by name or phone.
  - Reset their password, and they'll get a text with a temporary one.
  - Remove them from Find Seniors, or delete their account.
- **ID checks:**
  - Look at each ID, then approve it or send it back with a short reason.
  - Their events are never affected either way.
- **Reports:** read the conversation, then warn the person, remove them from Find Seniors, or dismiss the report.
- **Welcome video:** upload the welcome video for English and Yorùbá, and edit the written version.
- **Staff:** add or remove people who can use this admin area.
- **System:** check that everything is working.

**Attendance on the day:**
1. Open the event's **Attendance** page and print it.
2. Tick people off on paper at the event.
3. Afterwards, enter who came.

If you have a phone with a camera, you can also scan a senior's check-in code instead. Seniors never need the code, because their name is always on the list.

---

## 5. Changing a setting

1. In Render, open the **seniorpadi** service and go to **Environment**.
2. Change the value and click **Save Changes**.
3. Render restarts the site by itself, which takes about 2 minutes.

---

## 6. Updates from the developer

When the developer changes the code on GitHub, Render updates the site automatically. The database updates itself when the site restarts, so you don't need to do anything.

---

## 7. Fixing problems

| What you see | What to do |
|---|---|
| The site takes a long time to open | It was asleep. Wait a minute. Set up section 3 so it stays awake |
| "Could not connect to the database" in the Render logs | In Neon, check the project still exists. Copy the connection string again into `DATABASE_URL` on Render |
| "The database password is wrong" | The Neon password changed. Copy the connection string again from Neon |
| System says **Texts and emails: Not set up** or **Test mode** | Add `BREVO_API_KEY` in Render. Remove `NOTIFY_DRY_RUN` if it's there |
| Texts stopped arriving | Log in to Brevo and check you still have SMS credits |
| Pictures won't upload | Check the three Cloudinary settings on Render |
| Everyone got logged out | Normal after an update. If it happens a lot, check `SESSION_SECRET` is set on Render |
| You're locked out of the admin area | Ask another staff member to use **Staff** and then **Reset password**. If there's no one, in Render change `ADMIN_PHONE` to a new number, set `ADMIN_PASSWORD`, and save. A new admin is only created when no staff accounts exist, so if others exist, ask them |
| An error that says `relation "..." does not exist` | Restart the site (Render: **Manual Deploy** → **Restart**). On start it recreates any missing tables. Existing data isn't touched |
| Anything else | In Render, open **Logs** and look for lines starting with `!` or "could not start". The message says what's wrong in plain words |

To see what the site is doing, open **Logs** in Render. Every start prints a short checklist, and any warnings start with `!`.

---

## 8. Please never

- Delete the Neon project. It deletes every senior, event and registration.
- Share admin passwords. Give each staff member their own account from the **Staff** page.
- Paste the Neon connection string or Brevo key anywhere public.
- Put the Neon connection string into someone's laptop to "try things". Test copies should use their own database.

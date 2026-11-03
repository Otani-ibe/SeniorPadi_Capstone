# Showing the login code on screen (for a live presentation)

For a demo where texts cannot be sent (no phone network, no SMS credit), the "type your code" page can show the code:
**"Your code is 482915"**. The person types it in as usual. The login itself is unchanged.

It is **off** unless you switch it on, and it is limited on the live site.

## On your computer

In `.env`:

```
DEMO_SHOW_CODES=true
```

Restart the app. Remove the line (or set it to `false`) when you are done. No end time is needed on your own computer.

## On the live site (Render)

In Render, open your service, **Environment**, and add:

| Setting | Example | Meaning |
|---|---|---|
| `DEMO_SHOW_CODES` | `true` | the switch |
| `DEMO_SHOW_CODES_UNTIL` | `2026-11-10 18:00` | when it switches itself off. **Required** on the live site: without it, nothing is shown |
| `DEMO_ACCOUNTS` | `08030000001,08030000002` | optional: only these accounts show their code (leave it out for any senior account) |

- A time with no zone, like `2026-11-10 18:00`, is **Lagos time**. To say the zone yourself: `2026-11-10T18:00:00+02:00` (Kigali is +02:00, Lagos +01:00).
- Only year-month-day times are accepted. Something like `10/11/2026` is refused (it could mean two different days), and the codes stay hidden.
- After the end time the codes stop being shown, even if you forget to remove the settings. **Remove them after the presentation anyway.**
- Render restarts the service when you change settings, so make the change a few minutes before you start.

## What it never does

- Staff (admin and superadmin) accounts never show a code.
- It shows only a code the app just made, only to the person on that page, and only for the ten minutes the code works.
- It does not skip the code: logging in still needs the code to be typed.
- Real texts and emails are unaffected.

## Risk to remember

While it is on, anyone who knows a phone number can log in as that person. That is fine for a presentation with demo accounts, and it is why it has an end time and why `DEMO_ACCOUNTS` can limit it to the accounts you are showing.

The server prints a warning at start-up, and shows it on the admin dashboard, whenever it is switched on.

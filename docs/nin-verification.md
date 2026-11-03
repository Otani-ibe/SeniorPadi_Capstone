# NIN identity verification

Find Seniors, senior profiles, messages and calls are only for seniors whose identity has been verified with their
**NIN** (National Identification Number). Public events, signing up, logging in and the basic profile do not need it.
The NIN is **never** asked for at signup: only when someone tries to use Find Seniors.

No outside company is involved. The NIN is saved encrypted, and the **superadmin** checks it by hand on the official
NIMC website.

## The flow

1. A signed-in senior who is not verified opens Find Seniors (or types any restricted address) and is sent to `/identity`.
2. The page explains why, asks for the 11-digit NIN, explains what happens to it, and requires them to tick the consent box.
3. The NIN is encrypted and saved. The senior's status becomes `pending` ("a member of our team will check your NIN"),
   they are texted that it was received, and the superadmin gets a notification.
4. The superadmin opens `/admin/ids`, presses **Show NIN**, types it into the NIMC verification page, and compares the
   name, phone number and date of birth with the account. Then one of:

| Decision | Result | Stored as |
|---|---|---|
| Verified, 50 or older | can use Find Seniors | `approved` |
| Matches, but under 50 | not eligible (events still work) | `not_eligible` |
| Decline, with a reason the senior sees | can send a corrected NIN (3 declines, then they are asked to call) | `rejected` |

5. **The moment a decision is made, the encrypted NIN is erased.** The senior is told by SMS (and email if they gave one)
   and in their Notifications, and `/identity/status` always shows where things stand.

Age is judged from the date of birth shown by NIMC, never from what the user typed. A valid NIN is treated as proof of
Nigerian citizenship (SeniorPadi's decision); citizenship is not checked separately.

## Who can see a NIN

Only the superadmin: the staff account with `isSuperAdmin` set. Other admins cannot see the NIN, the queue, the count on
the dashboard, or the menu entry; they get "not allowed" if they type the address. The NIN is hidden until the superadmin
presses **Show NIN** (a button, so the number is never in an address or in the browser history). Every time one is opened
the audit log records who opened whose NIN (never the number itself).

Make the superadmin (the account must already be an admin; its phone number and password are not touched):

```
npm run superadmin -- --phone 08012345678 --name "Otani Ibe"
npm run superadmin:neon -- --phone 08012345678 --name "Otani Ibe"     # the live database
npm run superadmin -- --phone 08012345678 --off                      # take the role away
```

## What is stored, and why

| Stored | Why | Kept |
|---|---|---|
| The NIN, **encrypted** (AES-256-GCM, a fresh random IV every time, tied to the account id) | so the superadmin can check it | **only until the decision**; erased then (the database refuses to keep it longer) |
| A keyed hash of the NIN (HMAC-SHA256) | so one NIN cannot be verified on two accounts | only for verified accounts |
| The outcome, who decided, when, and the reason for a decline | accountability, and to tell the senior | while the account exists |
| When the senior consented and submitted | proof of consent | while the account exists |

The key is `NIN_ENCRYPTION_KEY` (a long random secret in the environment, never in the database or the code). With
no key, no NIN is accepted and nothing is saved. If the key is ever lost or changed, only NINs still waiting are
affected: they cannot be read, and the superadmin declines them with "please send your NIN again".

The NIN is never written to logs, flash messages, redirects, notifications or the audit log, and pages that mention
verification are sent with `Cache-Control: no-store`.

**What this design cannot do:** it cannot catch someone who knows another person's NIN, name and phone number. The
check is only as strong as the superadmin's comparison on the NIMC page.

## Safety

- Submissions are limited to 6 an hour per person/address, and a senior gets 3 declines before they are asked to call
  SeniorPadi.
- A submission cannot start twice at once (two taps or two tabs make one).
- The database refuses an unknown status, a NIN kept after a decision, and the same NIN hash verified on two accounts.


# Huvudräkning

An offline-first mental math trainer PWA for the whole family, built around
deliberate practice: short timed drills, adaptive difficulty, technique tips
generated from the actual numbers you missed, and weakness-targeted
resampling of past mistakes.

No accounts, no build step, no dependencies. Vanilla HTML/CSS/JS served as
static files. UI is Swedish by default with an English toggle. Training data
stays on the device. An optional one-file Cloudflare Worker can share a
tiny presence chip (name, emoji, last practice, day streak) when a family
shares a secret code — nothing else.

## Features

- **Local profiles** (name + avatar emoji), multiple kids on one device.
  The profile picker — and a compact family row on the home screen when
  more than one *visible* person exists — shows each person's last practice
  (today / yesterday / a date / never) and their day streak, so a parent
  can see who trained. Profiles are never ranked against each other.
- **Family code** (optional): a short shared secret, created or joined from
  the profile screen. Kids on their own iPads and a parent phone see the
  same chips for who last practiced — no accounts, no friend list, no feed.
  Only a presence chip is published (stable id, name, emoji, last-practice
  time, day streak). Problems, answers, accuracy and session logs never
  leave the device. Tapping a remote chip does not open a profile; they
  train on their own device. Leave family = stop publishing and drop the
  remote chips. Without a sync URL the row stays local-only.
- **Placement test** for new profiles, Duolingo-style: a skippable 2–3
  minute adaptive test (staircase for +/−, rising probes for the tables)
  that sets the starting levels — rounding down on uncertainty, leaving no
  trace in stats, and phrased so it can't be failed. Retakable later from
  the profile screen; a retake resets levels but never touches history,
  streak, heatmap or weights.
- **Skills**: addition, subtraction, multiplication, division, mixed, and an
  **investor mode** — the mental math investors actually use: percentages of
  amounts, percent up/down moves, the rule of 72, dividend yield, P/E ratios,
  two-year compounding, and break-even after a drawdown, with adaptive
  levels 1–5 and technique tips (e.g. "the climb back is measured on what's
  left")
- **The path**: the multiplication ladder drawn as a Duolingo-style winding
  trail of nodes — stars for each component's level, a pulsing ring on the
  current focus, padlocks ahead, gold nodes behind. Purely a presentation of
  real mastery state; there is nothing to buy or grind.
- **Mästarprov (gold)**: a component at its top level can be challenged —
  10 problems in a row, all correct, each under 3 s — to turn its node gold.
  Failing costs nothing and leaves no trace; gold is revoked if the accuracy
  band later lowers the component, so gold is a live claim, not a trophy.
- **Daily quests**: up to three mastery-framed goals per day generated from
  the player's actual weaknesses ("5 fast correct in the 8s table", "settle
  3 old misses", "do a session"). The reward is a checkmark and confetti —
  never XP, currency, shortcuts or play-time credit.
- **Habit ramp**: for the first 7 training days the only quest is "do one
  session" — consistency before volume, per the habit-formation and
  spaced-practice literature — with the remaining quests teased as locked.
  After the day's first real session the home screen says "done for today —
  anything more is a bonus" instead of asking for more (the opposite of a
  countdown owl), and the day streak shows as a 🔥 line.
- **Celebrations**: confetti and banner pops for mastery moments only —
  level ups, unlocks, personal bests, completed quests and gold runs.
  Respects `prefers-reduced-motion`.
- **Per-component multiplication ladder**: 15 components ("deltal") — each
  times table 1–12, two-digit × one-digit, squares 11–25², two-digit ×
  two-digit — each with its own level 1–3 and rolling accuracy. The band
  keeps every component at ~80–85 %: above 85 % the component levels up,
  below 75 % it levels down; a component mastered at the top level unlocks
  the next one. No single global level, no play-time rewards, no dark
  patterns.
- **Active session composition**: ~70 % of problems come from the two
  weakest components (the session's "fokus"), 30 % is a maintenance mix
  over everything unlocked. Missed facts recur (~25 % injection) until
  solved fast (≤3 s) twice in a row.
- **Weighted practice**: every fact carries a weight (wrong ×3, slow ×2,
  fast correct ×0.7, floor 0.3) that drives both problem sampling and the
  "worth extra practice" list
- **Error insights**: every miss is classified (magnitude, carry,
  near-miss) with its direction, and Tabellkoll surfaces tendencies like
  "tenderar att svara för lågt på 8:ans tabell"
- **Mastery heatmap**: per-table grid where each fact is green
  (fast + correct), yellow (correct but slow), red (missed), gray
  (untrained) — plus a squares strip once that level is unlocked
- **Instant feedback** on every answer (right/wrong + time) and a session
  summary compared against the player's own average, never against other
  profiles
- **Scope per session**: individual tables 1–12 (or "upp till 10:an"-style
  shortcuts) for ÷; difficulty levels 1–5 for +/− controlling number ranges
- **Timed drills on pure solve time**: 60/90/120 s (default 90) where the
  clock only runs while a problem is on screen. A miss opens a self-paced
  review (problem, answer key, your answer, technique tip) that stays until
  "Nästa tal" is pressed — the clock pauses, so understanding a mistake is
  never punished. The missed problem is guaranteed to return within 2–4
  problems while the memory trace is fresh. On-screen keypad, hardware
  keyboard also works. Personal bests and "then vs now" compare pure-time
  sessions only; older wall-clock records stay archived.
- **Adaptive levels** for +/−/investing: after a session with ≥5 attempts,
  >85 % accuracy levels up, <70 % levels down (targets an ~75–85 % success
  band)
- **Technique tips on misses**, computed from the actual numbers:
  left-to-right addition, make-a-ten, subtract-by-rounding, the 9s and 5s
  tricks, distributive splits, think-backwards division
- **Weakness targeting**: every miss is logged per profile; ~30 % of new
  problems resample outstanding misses in the current skill. A miss clears
  once answered correctly.
- **Clickable session log**: every recent session opens a detail view with
  the full problem list in order — answer key, ✓/✗, the player's answer on
  misses, per-problem time, ⚠️ on correct-but-slow (>5 s) — with a
  "show all / only misses & slow" toggle. Each attempt is stored with
  problem, answer, given answer, time in ms and timestamp.
- **Append-only session history** with accuracy + speed charts per skill,
  personal bests, day streak, a per-table mastery grid, and a
  "then vs now" comparison
- **JSON export/import** to move a profile between devices, plus two
  sharing exports: a pseudonymized **analysis file** (full stats and
  per-problem logs, but no name/avatar — safe to hand a coach or an AI,
  and deliberately not importable as a profile) and a **CSV** with one
  row per attempt (semicolon-delimited, opens directly in Excel/Sheets)
- **Installable PWA** that runs fully offline after the first load

## Run locally

Any static file server works (ES modules need `http://`, not `file://`):

```bash
cd huvudrakning
python3 -m http.server 8080     # or: npx serve .
# open http://localhost:8080
```

## Tests

Pure logic (problem generation, adaptive levels, streaks/stats,
export/import validation, family-code / presence merge) is unit-tested
with Node's built-in runner — no dev dependencies. Requires Node 18+.

```bash
npm test
```

## Deploy

The repo root **is** the deployable artifact — every path is relative, so it
works from a domain root or a subpath.

**GitHub Pages**: push the repo, then Settings → Pages → deploy from the
main branch, root folder. Done.

**Netlify**: drag the folder into the Netlify dashboard, or connect the repo
with no build command and publish directory `.`.

After deploying a change, bump `VERSION` in `sw.js` so installed clients
pick up the new files.

## Install on a kid's iPad/iPhone

1. Open the deployed URL in **Safari** (must be Safari on iOS).
2. Tap the **Share** button (square with the arrow).
3. Tap **Add to Home Screen** ("Lägg till på hemskärmen") and confirm.
4. The app now launches full-screen from its own icon and works without
   internet. Each child picks or creates their own profile inside the app.

On Android, Chrome shows an "Install app" prompt (or ⋮ menu → *Add to Home
screen*).

## Family presence (optional)

A family is a **shared secret code** (6 characters, no 0/O/1/I so a parent
can read it out). Create one on the first device, read it to the others,
join from **Profil**. Offline the app keeps the last snapshot and stays
fully usable; sync is best-effort.

The client does nothing until you set a sync URL. Empty
`FAMILY_SYNC_URL` in `js/config.js` = the family row stays local-only,
exactly as before.

### One-time Cloudflare deploy

You cannot skip this if you want cross-device chips. A free Cloudflare
account is enough (Workers + KV). Durable Objects are not required.

1. Create a free account at [cloudflare.com](https://www.cloudflare.com)
   and install Node 18+.
2. From the repo:

   ```bash
   cd worker
   npx wrangler login
   npx wrangler kv namespace create ROOMS
   ```

   Paste the printed `id` into `worker/wrangler.toml` (`kv_namespaces.id`).
   If the Pages site is not `https://tystgodhet.github.io`, set
   `PAGES_ORIGIN` to your origin (no path). `localhost` / `127.0.0.1`
   any port are already allowed.

3. Deploy once:

   ```bash
   npx wrangler deploy
   ```

4. Copy the worker URL (e.g. `https://huvudrakning-family.<you>.workers.dev`)
   into `js/config.js`:

   ```js
   export const FAMILY_SYNC_URL = "https://huvudrakning-family.<you>.workers.dev";
   ```

   No trailing slash.

5. Bump `VERSION` in `sw.js` and deploy the static app as usual, so
   installed iPads pick up the new files.

The worker stores one room per code. A member not seen for 30 days is
dropped. Request bodies are not logged. CORS is the Pages origin plus
localhost only. The payload is validated server-side to the same
allowlist the client uses.

## Moving a profile between devices

Profile → **Exportera profil** downloads a JSON file with the profile, its
levels/misses, and full session history. On the other device: Profile →
**Importera profil** and pick the file.

## Data & storage

Everything lives in `localStorage` under versioned `hr:v1:*` keys:
`profiles`, optional `familyCode` + `familySnapshot` (last fetched
presence chips), and per profile `state:<id>` (levels, outstanding misses
capped at 60, session config) and `sessions:<id>` (append-only history).
A heavy year of daily practice stays well under 100 kB per profile, which
is why localStorage was chosen over IndexedDB — synchronous, simple, and
export/import covers device migration. The family worker never receives
session logs.

## Structure

```
index.html            markup
css/style.css         styles (mobile-first, safe-area aware)
js/app.js             DOM controller: screens, drill loop, rendering
js/config.js          FAMILY_SYNC_URL (empty = family row stays local-only)
js/family.js          pure: family code, presence allowlist, local+remote merge
js/family-sync.js     best-effort presence GET/PUT (no-op without a sync URL)
js/problems.js        pure: problem generation, miss resampling, tip selection
js/adaptive.js        pure: level up/down rules
js/quests.js          pure: daily quest generation + progress
js/stats.js           pure: streak, last-practice, personal bests, mastery, then-vs-now
js/i18n.js            sv/en copy incl. tip templates
js/storage.js         localStorage wrapper + export/import
js/charts.js          SVG chart rendering
worker/               Cloudflare Worker + KV (one room per family code)
sw.js                 service worker (precache + runtime cache)
manifest.webmanifest  PWA manifest
tools/gen-icons.mjs   dependency-free icon generator (npm run icons)
tests/                node --test unit tests
```

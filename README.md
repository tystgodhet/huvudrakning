# Huvudräkning

An offline-first mental math trainer PWA for the whole family, built around
deliberate practice: short timed drills, adaptive difficulty, technique tips
generated from the actual numbers you missed, and weakness-targeted
resampling of past mistakes.

No backend, no accounts, no build step, no dependencies. Vanilla HTML/CSS/JS
served as static files. UI is Swedish by default with an English toggle.

## Features

- **Local profiles** (name + avatar emoji), multiple kids on one device
- **Skills**: addition, subtraction, multiplication, division, mixed, and an
  **investor mode** — the mental math investors actually use: percentages of
  amounts, percent up/down moves, the rule of 72, dividend yield, P/E ratios,
  two-year compounding, and break-even after a drawdown, with adaptive
  levels 1–5 and technique tips (e.g. "the climb back is measured on what's
  left")
- **Multiplication mastery ladder**: six named levels (tables to 5/10/12,
  two-digit × one-digit, squares to 25², two-digit × two-digit), next level
  shown locked. Promotion rewards mastery — ≥95 % accuracy AND median
  ≤3 s/problem over the last 3 sessions — with live progress toward both
  bars ("96 % ✓ · 3,4 s av 3,0 s"). Two sessions in a row below 80 %
  quietly mixes in 30 % problems from the level below; the visible level
  never moves down. No play-time rewards, no dark patterns.
- **Weighted practice**: every fact carries a weight (wrong ×3, slow ×2,
  fast correct ×0.7, floor 0.3) that drives both problem sampling and the
  "worth extra practice" list
- **Mastery heatmap**: per-table grid where each fact is green
  (fast + correct), yellow (correct but slow), red (missed), gray
  (untrained) — plus a squares strip once that level is unlocked
- **Instant feedback** on every answer (right/wrong + time) and a session
  summary compared against the player's own average, never against other
  profiles
- **Scope per session**: individual tables 1–12 (or "upp till 10:an"-style
  shortcuts) for ÷; difficulty levels 1–5 for +/− controlling number ranges
- **Timed drills**: 60/90/120 s (default 90), on-screen keypad, hardware
  keyboard also works
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
- **JSON export/import** to move a profile between devices
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
export/import validation) is unit-tested with Node's built-in runner —
no dev dependencies. Requires Node 18+.

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

## Moving a profile between devices

Profile → **Exportera profil** downloads a JSON file with the profile, its
levels/misses, and full session history. On the other device: Profile →
**Importera profil** and pick the file.

## Data & storage

Everything lives in `localStorage` under versioned `hr:v1:*` keys:
`profiles`, and per profile `state:<id>` (levels, outstanding misses capped
at 60, session config) and `sessions:<id>` (append-only history). A heavy
year of daily practice stays well under 100 kB per profile, which is why
localStorage was chosen over IndexedDB — synchronous, simple, and
export/import covers device migration.

## Structure

```
index.html            markup
css/style.css         styles (mobile-first, safe-area aware)
js/app.js             DOM controller: screens, drill loop, rendering
js/problems.js        pure: problem generation, miss resampling, tip selection
js/adaptive.js        pure: level up/down rules
js/stats.js           pure: streak, personal bests, mastery, then-vs-now
js/i18n.js            sv/en copy incl. tip templates
js/storage.js         localStorage wrapper + export/import
js/charts.js          SVG chart rendering
sw.js                 service worker (precache + runtime cache)
manifest.webmanifest  PWA manifest
tools/gen-icons.mjs   dependency-free icon generator (npm run icons)
tests/                node --test unit tests
```

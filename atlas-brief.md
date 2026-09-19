# Atlas — Build Brief

A game for learning every country, capital and flag in the world — continent by
continent, until the map is yours.

**Stack:** React + TypeScript, Canvas or SVG for map rendering, IndexedDB for local
progress. No backend in v1. Static build, deployable anywhere. Local development
first.

---

## 1. What this is and why it is different

There are many "guess the country" games. Almost all of them are ugly, most are
buried in advertising, and nearly none of them actually *teach* — they test you on
random countries forever and never notice that you have failed Slovenia eleven
times.

Atlas is built on the opposite premise: **it is a learning tool that happens to be
a game.** Two consequences follow, and they should govern every decision:

1. **It tracks what you personally do not know** and spends your time there.
2. **It is beautiful and calm.** No timers screaming at you, no confetti, no
   streak-loss anxiety. Restraint is the aesthetic.

---

## 2. Scope of v1

**In scope:**
- Three skills, practised separately: country → capital, country → flag, and
  country → location on the map
- Continent selection: Europe, Africa, Asia, Americas, Oceania (and a "whole world"
  mode once a continent is passed)
- Spaced repetition over the items the player gets wrong
- Local progress persistence, no account required
- Full keyboard operation
- Works offline after first load

**Out of scope for v1:**
- No accounts, no login, no server
- No multiplayer, no leaderboards
- No street-view or photo-based guessing — that is a different game and requires
  licensed imagery
- No ads, ever
- No sound effects beyond, at most, a single subtle confirmation tone

---

## 3. Data

All of it is small, static, and bundled with the app — no API calls at runtime.

| Data | Source | Notes |
|---|---|---|
| Country names, capitals, ISO codes, region | build a single `countries.json` | ~195 UN member states plus a decision on observers and territories |
| Flags | inline SVG per country | do not use emoji flags — inconsistent across platforms and unreadable at size |
| Country borders | a simplified world GeoJSON at low resolution | full-resolution borders are tens of megabytes; simplify aggressively |

**Two judgement calls to make explicitly and document in the README:**

1. **Which entities count as countries.** Taiwan, Kosovo, Palestine, Western
   Sahara, Northern Cyprus. There is no neutral answer. Pick a stated basis (UN
   member states plus observer states is the cleanest defensible line), say so
   plainly in the app, and move on.
2. **Disputed borders.** Kashmir, Crimea, the Golan. Use a neutral cartographic
   convention (dashed lines for disputed boundaries), state the source, and do not
   pretend the ambiguity is not there.

Getting these wrong quietly is worse than getting them wrong loudly.

---

## 4. The learning engine

This is what separates Atlas from a quiz. Implement a simplified spaced repetition
scheduler — SM-2 style is more than sufficient:

Per (country, skill) pair, store:
- `ease` — how easily the player recalls it, adjusted up on success and down on
  failure
- `interval` — how many sessions until it is due again
- `dueAt` — when it should next appear
- `lapses` — how many times it has been forgotten after being learned

Session composition:
- ~60% items that are **due** for review
- ~30% **new** items not yet seen
- ~10% items with high `lapses` — the player's personal problem cases

Rules that matter:
- A wrong answer resets the interval to 1 and lowers ease. The item comes back
  soon, not at the end of the deck.
- Never show the same item twice in one session unless it was answered wrong.
- After a wrong answer, show the correct answer with enough context to attach a
  memory — the flag, the capital and the location together, not just the right
  word. The moment after a mistake is when learning actually happens.

---

## 5. Game modes

**Capitals** — a country is named; choose its capital from four options, or type it
with fuzzy matching (accept "Reykjavik" for "Reykjavík").

**Flags** — a flag is shown; choose or type the country. Reverse mode too.

**Map** — a country is named; click it on the map. Give partial credit for a
neighbouring country and say so ("close — that's Slovakia, Slovenia is further
south"). This is where real geographic intuition is built.

**Review** — a no-scoring mode that simply shows the continent with everything
labelled, for study before practice. People need to see the material before being
tested on it, and most of these games skip this.

---

## 6. Design direction

Match the visual language of the VakOps portfolio: cool blue-greys with a single
warm amber accent, generous whitespace, one strong typeface.

- **Map:** flat fills, no drop shadows, no gradients on landmasses. The selected
  country gets the amber accent; neighbours get a subtle lift so the player can
  orient.
- **Motion:** meaningful only. A country filling with colour on a correct answer;
  a brief settle on a wrong one. No bouncing, no particles, no celebration
  animations.
- **Typography:** one sans for UI, tabular figures for any numbers. Country names
  should be set at a size that respects them, not squeezed into a badge.
- **Feedback tone:** factual and kind. "Not quite — that's Zambia" rather than
  "WRONG!". The whole point is that the player comes back tomorrow.

**Anti-goals:** no dark patterns, no artificial difficulty, no "you lost your
streak" guilt, no interstitials.

---

## 7. Technical notes

- **Map rendering:** SVG is the simpler choice and gives free hit-testing for
  clicks, which the map mode needs. Use Canvas only if profiling shows SVG is too
  slow at world scale. Do not reach for a 3D globe in v1 — it is a large cost for
  a small gain, and it makes labelling harder.
- **Projection:** a simple equirectangular or Robinson projection is fine per
  continent. Avoid Mercator at world scale — it distorts Africa badly enough to
  teach the wrong thing, which matters in a learning tool.
- **Persistence:** IndexedDB, wrapped so all writes go through one module. Wrap
  every read and write in try/catch and render correctly when storage is empty or
  blocked — private browsing modes will refuse it.
- **Offline:** bundle all data; add a service worker so the app works with no
  network after first visit.
- **Accessibility:** full keyboard play (arrow keys and number keys to select),
  visible focus rings, ARIA labels on map regions, and a non-colour indicator for
  correct/incorrect since colour-blind players cannot rely on green versus red.
- **Performance target:** first meaningful paint under 1.5s; simplified GeoJSON
  should be a few hundred KB, not megabytes.

---

## 8. Build order

| Phase | Deliverable | Done when |
|---|---|---|
| 1 | `countries.json` assembled, entity decisions documented | data loads, count verified |
| 2 | Static map renders one continent, countries are clickable | clicking Portugal logs Portugal |
| 3 | Capitals mode, multiple choice, no persistence | playable end to end |
| 4 | IndexedDB persistence layer | progress survives a refresh |
| 5 | Spaced repetition scheduler | wrong answers demonstrably return sooner |
| 6 | Flags mode | flags render crisply at all sizes |
| 7 | Map-click mode with neighbour partial credit | "close" feedback works |
| 8 | Review mode | labelled study view per continent |
| 9 | Progress view — per continent, per skill, per item | player can see their weak spots |
| 10 | Service worker, offline, polish pass | works on a plane |

---

## 9. Repository layout

```
atlas/
  public/
    data/
      countries.json
      world-simplified.geojson
      flags/            # one SVG per ISO code
  src/
    data/               # loaders, entity decisions in one place
    engine/
      srs.ts            # scheduling — pure functions, unit tested
      session.ts        # session composition
    storage/
      progress.ts       # the only module touching IndexedDB
    modes/
      capitals/ flags/ map/ review/
    ui/
    styles/tokens.css   # palette shared with the portfolio site
  docs/
    entity-decisions.md # which places count, and why
```

---

## 10. The part that is easy to underestimate

`srs.ts` should be pure functions over a state object with no side effects, and it
should have real unit tests. It is the only component where a subtle bug is
invisible — the app will keep working perfectly while quietly teaching badly, and
you will not notice for weeks.

Test at minimum:
- a wrong answer shortens the interval
- repeated successes lengthen it monotonically
- a lapsed item is prioritised over a new one
- session composition holds its ratios when the due pool is empty or oversized

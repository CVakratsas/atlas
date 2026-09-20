# Atlas

Learn every country, capital and flag in the world — continent by continent.

Spin the globe, pick a region, and find the countries before the clock runs up.

Three modes, all played by clicking the country on a photoreal Earth:

| Mode | You see | You do |
|---|---|---|
| Countries | a country name | click that country |
| Capitals | a capital name | click the country it belongs to |
| Flags | a flag | click the country it belongs to |

Score for each one you find, with a speed bonus and a streak multiplier; lose points for
a wrong click. The timer counts up, so there is no way to lose - only to be slow. A wrong
click never skips the prompt: you still have to find it.

Countries you miss are remembered, and come up earlier next time.

## Run it

```
npm install
npm run dev        # http://localhost:5174
npm test           # the engine and data suites
npm run build
```

The data in `public/data/` is committed, so a clean checkout runs offline. To regenerate
it from upstream: `bash scripts/fetch-data.sh && npm run data`.

## Deploying

Live at [atlas.c-vakratsas.workers.dev](https://atlas.c-vakratsas.workers.dev), on a
Cloudflare Worker that serves static assets and runs no server code of its own.

Pushing to `main` builds and deploys it. Cloudflare Workers Builds watches the repo and
runs `npm run build`, then `npx wrangler deploy`; there is no GitHub Actions workflow and
no API token held in GitHub. `wrangler.jsonc` is what the deploy step reads, and it is
authoritative — Wrangler will overwrite settings changed in the Cloudflare dashboard, so
change them here instead.

To deploy by hand: `npm run build && npm run deploy`, or `npm run deploy:dry` to check the
packaging without uploading.

## Where things are

```
public/data/     generated, committed: countries, borders, flags, the neighbour graph
public/textures/ NASA Blue Marble imagery for the globe (public domain)
scripts/         the data pipeline; every judgement call lives in overrides.mjs
src/data/        typed loaders — the only place `quizzable` is interpreted
src/globe/       the three.js globe: scene, shaders, picking, orientation, overlay
src/game/        rounds, scoring, scopes, storage — pure, no renderer, unit tested
src/ui/          styles and the 2D map (kept for the results view)
src/styles/      tokens.css — the palette
docs/            entity decisions and data provenance
```

The globe is ported from the author's `station-portfolio`: the same NASA textures and the
same surface/atmosphere shaders, decoupled from that project's scene singleton. Atlas adds
one uniform to the surface shader - an equirectangular overlay carrying the country
colours, which maps 1:1 onto the sphere's UVs.

## Two things worth knowing before you read the code

**What counts as a country.** 193 UN members + 2 UN observers + Kosovo and Taiwan = **197**.
Northern Cyprus is drawn as part of Cyprus and Somaliland as part of Somalia, which is the
position almost every country takes. Western Sahara is drawn in neutral grey and never
asked about. There is no neutral answer here, so the basis is stated rather than hidden:
[`docs/entity-decisions.md`](docs/entity-decisions.md).

**Picking is the load-bearing code.** Turning a click into a country means raycasting the
sphere, transforming the hit into the globe's local space (which is what removes the
current rotation - skip it and every click is wrong by however far the planet has spun),
converting to lon/lat and testing polygons. A sign error there produces a globe that looks
flawless and returns the wrong country every time, so `src/globe/picking.test.ts` and
`orientation.test.ts` pin it against real coordinates rather than reasoning.

**Borders are geometry, not texture.** They used to be painted into the overlay canvas,
which capped how sharp they could ever be — at continent zoom that canvas was magnified
several times over and dense regions like the Balkans turned to mush. They are now fat
lines on the sphere (`src/globe/borders.ts`), crisp at any zoom, split into international
boundaries and coastline so the political borders can be drawn stronger than the shoreline.
The whole network is one uniform colour on purpose: every shared border is drawn twice,
once from each side's polygon, and two different colours at the same position z-fight into
shimmer.

**Borders appear only for the region you are playing.** The home and selection screens
show the planet with no borders at all; a round lights up its own region and leaves the
rest as scenery.

**Markers are a constant size on screen, and a country only gets one while its own shape
would draw smaller than the marker would.** That is computed from the country's real area
every time the camera moves, rather than from a hand-kept list — so Vatican City always
has one, Luxembourg has one from the world view and loses it in Europe, and Russia never
does. The hit area is derived from the same number the marker is drawn at, so what you see
is exactly what you can press.

## Corrections made to upstream data

The build cross-checks its two sources and fails rather than guessing. Two upstream errors
are corrected automatically, and every remaining disagreement is printed:

- Vatican City is marked a UN member by `world-countries`. It is an observer state.
- Sri Lanka is listed as bordering India. The Palk Strait separates them; the geometry
  agrees. It becomes a maritime neighbour at 38 km.

See [`docs/data-sources.md`](docs/data-sources.md).

See [`THIRD-PARTY.md`](THIRD-PARTY.md) for the licences of the bundled data and imagery.

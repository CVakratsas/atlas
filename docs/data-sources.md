# Data sources and licences

All data is static and bundled. The app makes no network calls at runtime.

Run `bash scripts/fetch-data.sh` to download sources into `scripts/.cache/` (gitignored),
then `npm run data` to regenerate. The **generated outputs in `public/data/` are committed**,
so a clean checkout builds and runs offline.

| Output | Source | Licence |
|---|---|---|
| `countries.json` | [world-countries](https://github.com/mledoze/countries) v5 — names, ISO codes, capitals, regions, land borders, alt spellings | ODbL 1.0 |
| | [Natural Earth](https://www.naturalearthdata.com/) 110m admin-0 — population estimates | Public domain |
| `world-simplified.geojson` | Natural Earth **50m** admin-0 countries | Public domain |
| `borders.json` | Derived: per-segment land-border / coastline classification | — |
| `tiny-countries.json` | Derived: the 29 countries small enough to need a zoom marker | — |
| `textures/earth/*.jpg` | NASA Blue Marble / Black Marble, downscaled locally | Public domain |
| `adjacency.json` | Derived from world-countries `borders` + Natural Earth **50m** geometry | ODbL 1.0 / Public domain |
| `flags/*.svg` | [flag-icons](https://github.com/lipis/flag-icons) v7.5 4x3 set | **MIT** |

## Notes

**flag-icons is MIT, not public domain.** The licence must travel with any redistribution;
a copy belongs in the repository root alongside this file.

**Natural Earth 50m is used throughout** — for the neighbour graph and, since the render
quality pass, for the geometry the globe draws. 110m omits 29 of our 195 countries
outright (Malta, Singapore, Monaco, San Marino, Vatican City, Bahrain, and most Caribbean
and Pacific microstates) and is visibly coarse once the camera is zoomed to a continent.
At 50m every country we quiz has real geometry, which also removed the dot-marker
substitute those 29 previously needed.

Cost: 551 KB gzipped, against 63 KB for 110m.

**Earth imagery is downscaled locally from NASA's 21600×10800 master.** The master is
26 MB and stays in the gitignored cache; `scripts/fetch-earth.sh` emits an 8192×4096 map
for desktop and a 4096×2048 map for phones. The 8K map is what makes a zoomed-in continent
sharp — at that zoom the 4K map is magnified nearly twice over.

**The ISO join needs care.** Natural Earth's `ISO_A3` is `-99` for France, Norway, Kosovo,
Northern Cyprus and Somaliland. The build joins on `ISO_A3_EH`, falls back to `ADM0_A3`,
and **fails** on anything unresolved. A silent `-99` bucket is how France quietly loses all
eight of its neighbours.

## Known upstream corrections

The build cross-checks the two sources against each other and reports every disagreement
rather than absorbing it. Two are corrected automatically:

- **Vatican City is marked as a UN member** by world-countries. It is an observer state.
- **Sri Lanka is listed as bordering India.** It does not — the Palk Strait separates them,
  and the 50m geometry confirms no shared boundary. The edge is dropped and Sri Lanka
  becomes a *maritime* neighbour of India at 38 km.

Remaining reported disagreements are all explainable and intentionally left alone:
Botswana–Zambia (a near-quadripoint at Kazungula), Spain–Morocco (the Ceuta and Melilla
enclaves), Italy–San Marino and Italy–Vatican City (microstate enclaves whose 50m rings do
not share vertices), and Djibouti–Somalia (which touches Somaliland in the geometry).

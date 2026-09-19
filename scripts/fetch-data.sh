#!/usr/bin/env bash
# Downloads the upstream sources into scripts/.cache/ (gitignored).
# The generated outputs in public/data/ ARE committed, so a clean checkout builds offline.
# Re-run this only to refresh from upstream. Licences: docs/data-sources.md
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p .cache
NE=https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson

fetch () { # url dest
  if [ -s ".cache/$2" ]; then echo "  cached   $2"; else
    echo "  fetching $2"; curl -sSLf --max-time 120 -o ".cache/$2" "$1"
  fi
}

echo "Sources:"
fetch "https://cdn.jsdelivr.net/npm/world-countries@5/countries.json" world-countries.json
fetch "$NE/ne_110m_admin_0_countries.geojson"      ne_110m_admin_0_countries.geojson
fetch "$NE/ne_50m_admin_0_countries.geojson"       ne_50m_admin_0_countries.geojson
fetch "$NE/ne_110m_admin_0_boundary_lines_land.geojson" ne_110m_boundary_lines.geojson

echo "Flags (one SVG per ISO, from flag-icons, MIT):"
node build-flags.mjs

echo "Done. Now run: npm run data"

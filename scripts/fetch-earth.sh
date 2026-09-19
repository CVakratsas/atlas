#!/usr/bin/env bash
# Downloads the public-domain NASA Earth textures used by src/globe/earth.ts and resizes
# them with macOS `sips` (use ImageMagick's `magick` elsewhere). Run once; the outputs are
# committed, the multi-megabyte masters are not.
#
#   colour : NASA Blue Marble Next Generation, August 2004, topography and bathymetry
#            https://visibleearth.nasa.gov/images/73776
#            Fetched at 21600x10800 and downscaled to 8K and 4K. The 8K map is what makes
#            a zoomed-in continent look sharp; the 4K is the phone fallback.
#   night  : NASA Black Marble 2016 (0.1 deg grid)
#            https://visibleearth.nasa.gov/images/144898
#   clouds : NASA Blue Marble cloud cover, combined
#            https://visibleearth.nasa.gov/images/57747
#
# All NASA imagery is public domain (https://www.nasa.gov/nasa-brand-center/images-and-media/).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p .cache ../public/textures/earth
BASE=https://eoimages.gsfc.nasa.gov/images/imagerecords
OUT=../public/textures/earth

get () { # url dest-in-cache
  if [ -s ".cache/$2" ]; then echo "  cached   $2"; else
    echo "  fetching $2"; curl -sSLf --max-time 900 -o ".cache/$2" "$1"
  fi
}

echo "Earth textures:"
get "$BASE/73000/73776/world.topo.bathy.200408.3x21600x10800.jpg" earth-master.jpg
get "$BASE/144000/144898/BlackMarble_2016_01deg.jpg"              earth-night.jpg
get "$BASE/57000/57747/cloud_combined_2048.jpg"                   earth-clouds.jpg

echo "Resizing:"
sips -s format jpeg -s formatOptions 86 -z 4096 8192 .cache/earth-master.jpg --out "$OUT/color_8k.jpg" >/dev/null
sips -s format jpeg -s formatOptions 82 -z 2048 4096 .cache/earth-master.jpg --out "$OUT/color_4k.jpg" >/dev/null
sips -s format jpeg -s formatOptions 80 -z 1024 2048 .cache/earth-night.jpg  --out "$OUT/night_2k.jpg"  >/dev/null
sips -s format jpeg -s formatOptions 80 -z 1024 2048 .cache/earth-clouds.jpg --out "$OUT/clouds_2k.jpg" >/dev/null
ls -la "$OUT"

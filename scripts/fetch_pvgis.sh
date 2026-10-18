#!/usr/bin/env bash
# PVGIS 5.3 hourly series, 1 kWp, 30° tilt, south, 14 % losses, year 2023 (latest SARAH3 year),
# one call per province capital. PVGIS © European Communities 2001-2026, free reuse with attribution.
set -euo pipefail
mkdir -p data/raw/pvgis
tail -n +2 data/provinces.csv | while IFS=, read -r c n cap lat lon tz; do
  f=data/raw/pvgis/$c.json
  [ -s "$f" ] || curl -s --retry 3 -o "$f" "https://re.jrc.ec.europa.eu/api/v5_3/seriescalc?lat=$lat&lon=$lon&peakpower=1&loss=14&pvcalculation=1&angle=30&aspect=0&startyear=2023&endyear=2023&outputformat=json"
  sleep 0.2
done

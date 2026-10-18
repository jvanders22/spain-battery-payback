#!/usr/bin/env bash
# REE/ESIOS archive 70 (PVPC 2.0TD, public, no token), every day of 2025.
mkdir -p data/raw/pvpc
d=2025-01-01
while [ "$d" != 2026-01-01 ]; do
  f=data/raw/pvpc/$d.json; [ -s $f ] || curl -s --retry 3 -o $f "https://api.esios.ree.es/archives/70/download_json?locale=es&date=$d"; sleep 0.3
  d=$(date -I -d "$d + 1 day")
done; echo pvpc done

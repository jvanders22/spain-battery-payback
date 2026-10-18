"""Build the precomputed browser data from the sourced inputs.

Inputs (see README "Data"):
  data/omie_2025_hourly.csv      OMIE day-ahead, Spain, hourly mean of the published periods, 2025 (UTC)
  data/raw/pvpc/YYYY-MM-DD.json  REE/ESIOS archive 70 (PVPC 2.0TD), 2025   -> scripts/fetch_pvpc.sh
  data/raw/pvgis/NN.json         PVGIS 5.3 hourly PV output per province  -> scripts/fetch_pvgis.sh
  data/raw/perfiles2026.xlsx     REE "perfiles iniciales de consumo 2026" (2.0TD and 3.0TD)
Outputs:
  public/data/year.json          8760 UTC hours of 2025: local calendar, OMIE, PVPC, load shapes
  public/data/solar/NN.json      8760 hourly kWh per kWp for province NN (UTC hours of 2025)
  public/data/provinces.json     province list with annual yield (kWh/kWp)
  data/pvpc_2025_hourly.csv      PVPC PCB per UTC hour (EUR/MWh, before taxes)

The simulated year is 2025 in UTC hours (2025-01-01T00Z .. 2025-12-31T23Z).
* Solar: PVGIS 2023 is the newest SARAH3 year; hour i of 2023 is used for hour i of 2025 (both
  non-leap years start on 1 Jan 00:00 UTC), so the sun is where it should be on each date.
* Load: REE publishes the 2026 initial profiles (one coefficient per local hour, summing to 1). The
  2026 calendar is the 2025 calendar shifted by 364 days (same weekdays, same DST Sundays), so local
  hour j of 2025 uses row j-24 of the 2026 file (the first 24 hours wrap to 31 Dec).
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
TZ = "Europe/Madrid"
HOURS = pd.date_range("2025-01-01T00:00Z", periods=8760, freq="h")


def num(s: str) -> float:
    return float(s.replace(".", "").replace(",", "."))


def pvpc() -> pd.Series:
    vals = {}
    for day in pd.date_range("2025-01-01", "2025-12-31", freq="D"):
        rows = json.loads((ROOT / f"data/raw/pvpc/{day:%Y-%m-%d}.json").read_text())["PVPC"]
        start = pd.Timestamp(day).tz_localize(TZ).tz_convert("UTC")
        end = (pd.Timestamp(day) + pd.Timedelta(days=1)).tz_localize(TZ).tz_convert("UTC")
        ts = pd.date_range(start, end, freq="h", inclusive="left")
        assert len(ts) == len(rows), day  # 23/25 rows on DST days, matched by position
        for t, r in zip(ts, rows, strict=True):
            vals[t] = num(r["PCB"])
    s = pd.Series(vals).reindex(HOURS).ffill()  # 2025-12-31T23Z is 1 Jan 2026 local: carry last hour
    return s


def load_shapes() -> dict[str, list[float]]:
    x = pd.read_excel(ROOT / "data/raw/perfiles2026.xlsx", sheet_name=0, header=None, skiprows=2)
    x = x.iloc[:, :5]
    x.columns = ["m", "d", "h", "p20", "p30"]
    x = x.dropna(subset=["p20"])
    assert len(x) == 8760, len(x)
    out = {}
    local_index = [(i + 1) % 8760 for i in range(8760)]  # UTC hour i = local hour i+1 of 2025 (CET in Jan)
    # verify: hour 0 UTC on 1 Jan is 01:00 local
    assert HOURS[0].tz_convert(TZ).hour == 1
    for col in ("p20", "p30"):
        arr = x[col].astype(float).to_numpy()
        vals = [float(arr[(j - 24) % 8760]) for j in local_index]
        tot = sum(vals)
        out[col] = [round(v / tot, 9) for v in vals]
    return out


def solar(code: str) -> list[float]:
    doc = json.loads((ROOT / f"data/raw/pvgis/{code}.json").read_text())
    p = [h["P"] / 1000 for h in doc["outputs"]["hourly"]]  # W per kWp -> kWh per kWp in the hour
    assert len(p) == 8760, (code, len(p))
    first = doc["outputs"]["hourly"][0]["time"]
    assert first.startswith("20230101:00"), first
    return [round(v, 4) for v in p]


def main() -> None:
    omie = pd.read_csv(ROOT / "data/omie_2025_hourly.csv", parse_dates=["ts_utc"]).set_index("ts_utc")["price_es"]
    omie = omie.reindex(HOURS)
    assert omie.notna().all()
    pv = pvpc()
    pd.DataFrame({"ts_utc": HOURS, "pvpc_pcb_eur_mwh": pv.values}).to_csv(
        ROOT / "data/pvpc_2025_hourly.csv", index=False
    )
    local = HOURS.tz_convert(TZ)
    shapes = load_shapes()
    year = {
        "source": {
            "omie": "OMIE day-ahead market, Spain zone, 2025 (hourly mean of published periods)",
            "pvpc": "REE/ESIOS archive 70, PVPC 2.0TD field PCB, EUR/MWh before taxes, 2025",
            "load": "REE perfiles iniciales de consumo 2026 (P2.0TD, P3.0TD), weekday-aligned to 2025",
        },
        "start_utc": "2025-01-01T00:00:00Z",
        "month": [int(t.month) for t in local],
        "day": [int(t.day) for t in local],
        "hour": [int(t.hour) for t in local],
        "dow": [int(t.dayofweek) for t in local],  # Monday = 0
        "yday": [int(t.dayofyear) - 1 if t.year == 2025 else 364 for t in local],
        "omie": [round(float(v), 2) for v in omie],
        "pvpc": [round(float(v), 2) for v in pv],
        "load20": shapes["p20"],
        "load30": shapes["p30"],
    }
    out = ROOT / "public/data"
    (out / "solar").mkdir(parents=True, exist_ok=True)
    (out / "year.json").write_text(json.dumps(year, separators=(",", ":")))
    provs = []
    with open(ROOT / "data/provinces.csv", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            s = solar(r["code"])
            (out / "solar" / f"{r['code']}.json").write_text(json.dumps(s, separators=(",", ":")))
            provs.append({**r, "lat": float(r["lat"]), "lon": float(r["lon"]), "yield_kwh_kwp": round(sum(s))})
    provs.sort(key=lambda p: p["name"])
    (out / "provinces.json").write_text(json.dumps(provs, ensure_ascii=False, indent=0))
    print("hours", len(HOURS), "provinces", len(provs))
    print("yields", {p["name"]: p["yield_kwh_kwp"] for p in provs if p["code"] in ("28", "41", "15", "08")})


if __name__ == "__main__":
    main()

"""Cross-check fixture: periods and indexed price stack from the Python calculator in
jvanders22/spain-negative-price-alert (pip install -e that repo first). Writes tests/fixtures/xcheck.json."""

import json
import random
from pathlib import Path

import pandas as pd
from negprice import retail, tariffs

random.seed(7)
cases = []
hours = pd.date_range("2026-01-01", "2026-12-31 23:00", freq="h", tz="Europe/Madrid")
picks = sorted(random.sample(range(len(hours)), 300)) + [
    hours.get_loc(pd.Timestamp(s, tz="Europe/Madrid"))
    for s in ("2026-01-06 12:00", "2026-07-15 10:00", "2026-07-15 13:00", "2026-03-02 09:00", "2026-10-12 19:00")
]
a = retail.Assumptions()
for i in picks:
    t = hours[i]
    omie = round(random.uniform(-5, 180), 2)
    row = {"month": t.month, "day": t.day, "dow": t.dayofweek, "hour": t.hour, "omie": omie}
    for tariff in ("2.0TD", "3.0TD"):
        p = tariffs.period(tariff, t)
        n = int(p[1:])
        peaje, cargo, cap = tariffs.energy_terms(tariff, p)
        s = retail.price_stack(omie, peaje, cargo, cap, a)
        row[tariff] = {"period": n, "pre_tax": s["pre_tax_eur_kwh"], "estimate": s["estimate_eur_kwh"]}
    cases.append(row)
out = Path(__file__).resolve().parents[1] / "tests/fixtures/xcheck.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps({"assumptions": {k: v["value"] for k, v in a.describe().items()}, "cases": cases}, indent=0))
print(len(cases), "cases")

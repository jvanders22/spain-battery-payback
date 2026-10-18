# Spain battery payback checker

"I have (or plan) solar. Will a battery pay for itself?" A static page that replays every hour of 2025 for a
Spanish home or small business and compares the energy bill with and without a 5, 10 or 15 kWh battery.

Live: https://jvanders22.github.io/spain-battery-payback/

## What it does
- Inputs: annual kWh or a monthly bill, solar kWp (or none), province, tariff (fixed, PVPC, indexed, 2.0TD
  three periods, 3.0TD six periods), surplus compensation €/kWh, battery size and price, IRPF deduction.
- Output: € saved in year 1, simple payback, 10-year net, a typical July and January day (load, solar, battery
  state of charge, price) and a plain-language verdict. Every assumption is on the page and editable.
- Runs entirely in the browser (TypeScript); the data is precomputed JSON (`public/data`, ~3 MB, one solar file
  per province loaded on demand).

## Model (src/dispatch.ts, src/model.ts)
1. Solar serves the load first; surplus charges the battery (power-limited, √η per direction); the rest is exported.
2. When load > solar the battery discharges, then the grid supplies the rest.
3. Optional cheap-hour charging (not for fixed prices): at local midnight, if today's 08:00–24:00 deficit
   (net of the solar surplus that will refill the battery) costs more than night power ÷ round-trip efficiency,
   buy it in the cheapest 00:00–08:00 hours and do not discharge in those night hours. Day-ahead prices are known
   the afternoon before, but the day's load and solar are taken as known (perfect foresight, optimistic). If the
   rule does not lower the annual bill versus self-consumption only, it is switched off.
4. Bill: simplified net billing (RD 244/2019 art. 14): monthly credit = exports × €/kWh, capped at the month's
   energy cost; IEE (5.11269632 %) and IVA (21 %, not for businesses) on the remainder. Power term excluded.
5. Years 2–10 are re-simulated with capacity reduced by the degradation rate. No discounting or inflation.

## Data (all in the repo or fetched by a script)
| Data | Source | File |
| --- | --- | --- |
| OMIE day-ahead Spain, 2025 hourly | OMIE, via jvanders22/spain-power-prices | `data/omie_2025_hourly.csv` |
| PVPC 2.0TD (PCB), 2025 | REE/ESIOS archive 70 (public) | `scripts/fetch_pvpc.sh` → `data/raw/pvpc`, `data/pvpc_2025_hourly.csv` |
| Hourly PV per province | PVGIS 5.3 seriescalc, 2023, 1 kWp 30° south 14 % losses | `scripts/fetch_pvgis.sh` (raw not committed) |
| Load profiles | REE perfiles iniciales 2026 (P2.0TD, P3.0TD) | `data/raw/perfiles2026.xlsx` |
| Peajes, cargos 2026, periods | BOE-A-2025-26348, BOE-A-2025-26705, Circular 3/2020 | `src/tariffs.ts` |
| Battery prices 2026 | SolarPlan (4 Oct 2026), Solar Daurada, GuíaSolares/Yosol (Sep 2026) | `src/defaults.ts` |
| IRPF 10 % deduction | Ley 35/2006 DA 62 (RDL 7/2026), BOE consolidated text | `src/defaults.ts` |

Rebuild the data: `scripts/fetch_pvpc.sh && scripts/fetch_pvgis.sh && python scripts/build_data.py` (pandas, openpyxl).
PVGIS: free, no restrictions; acknowledge "PVGIS © European Communities, 2001–2026". Its API blocks browser
(AJAX) calls, which is why solar is precomputed.

## Tests
`npm test`: dispatch energy balance, SOC bounds, efficiency, power limits, the grid-charge rule, net billing cap,
and 305 hours of tariff periods and indexed prices checked against the Python calculator in
jvanders22/spain-negative-price-alert (`scripts/make_xcheck.py` → `tests/fixtures/xcheck.json`). Worked examples
in `tests/examples.test.ts`. `npm run axe` runs axe-core on the built page (CI too).

## Analytics
`src/config.ts` → `GOATCOUNTER_CODE` (empty = off), same switch as the other power sites.

## Caveats
2025 prices and 2023 weather are one year each, not a forecast. The load is the average Spanish profile, not your
meter: households with big evening use benefit more. Islands, Ceuta and Melilla use peninsular tariff periods. PVPC uses 2025 published prices (2025 peajes and
cargos inside); time-of-use and indexed tariffs use the 2026 tables. The tariff cross-check compares with our own
Python calculator, whose 2026 values were transcribed from the BOE (verified 10 Oct 2026), not with the BOE directly.
Not financial advice.

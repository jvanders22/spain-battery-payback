// Hourly battery dispatch. Plain rules, no optimiser, so the result can be explained in one paragraph:
//  1. Solar first serves the load.
//  2. Solar surplus charges the battery; whatever does not fit is exported.
//  3. When load exceeds solar, the battery discharges to cover the gap; the rest is imported.
//  4. Optional "cheap-hour charging" (time-of-use, PVPC, indexed tariffs): at local midnight the
//     battery looks at today's prices (known the day before) and at today's expected load and solar.
//     If the energy it will be short of between 08:00 and 24:00 costs more than night power after
//     losses, it buys that amount from the grid in the cheapest hours between 00:00 and 08:00, and it
//     does not discharge during those night hours.

export interface Battery {
  capacityKwh: number; // usable capacity
  powerKw: number; // max charge/discharge power
  roundTrip: number; // e.g. 0.9 (charge and discharge each sqrt of it)
  gridCharge: boolean;
}

export interface Hourly {
  load: Float64Array; // kWh per hour
  solar: Float64Array; // kWh per hour
  price: Float64Array; // import price before taxes, EUR/kWh (used only by the grid-charge rule)
  hour: Uint8Array; // local hour 0..23
}

export interface Flows {
  imp: Float64Array; // grid import, kWh
  exp: Float64Array; // export, kWh
  soc: Float64Array; // state of charge at end of hour, kWh
  gridCharged: number; // kWh bought from the grid into the battery over the year
  discharged: number; // kWh delivered by the battery
}

const NIGHT_END = 8;

/** Plan grid charging for the day starting at index `start` (local 00:00). Returns kWh to buy per index. */
export function planDay(h: Hourly, start: number, soc0: number, b: Battery): Map<number, number> {
  const plan = new Map<number, number>();
  const n = h.load.length;
  const day: number[] = [];
  for (let i = start; i < n && day.length < 25; i++) {
    if (i > start && h.hour[i] === 0) break;
    day.push(i);
  }
  const night = day.filter((i) => h.hour[i] < NIGHT_END);
  const rest = day.filter((i) => h.hour[i] >= NIGHT_END);
  const eta = Math.sqrt(b.roundTrip);
  let deficit = 0;
  let surplus = 0;
  let valueSum = 0;
  for (const i of rest) {
    const net = h.load[i] - h.solar[i];
    if (net > 0) {
      deficit += net;
      valueSum += net * h.price[i];
    } else surplus -= net;
  }
  if (deficit <= 0 || night.length === 0) return plan;
  const avgValue = valueSum / deficit;
  // energy that must be in the battery at 08:00 (in stored kWh), net of solar surplus that will refill it
  const needStored = Math.min(b.capacityKwh, Math.max(0, deficit / eta - surplus * eta));
  let toBuyStored = needStored - soc0;
  if (toBuyStored <= 1e-9) return plan;
  const sorted = [...night].sort((x, y) => h.price[x] - h.price[y]);
  for (const i of sorted) {
    if (toBuyStored <= 1e-9) break;
    // buy only if a stored kWh, after the round trip, is cheaper than the hours it will replace
    if (h.price[i] / b.roundTrip >= avgValue) break;
    const stored = Math.min(b.powerKw * eta, toBuyStored);
    plan.set(i, stored / eta); // grid kWh
    toBuyStored -= stored;
  }
  return plan;
}

export function simulate(h: Hourly, b: Battery | null): Flows {
  const n = h.load.length;
  const imp = new Float64Array(n);
  const exp = new Float64Array(n);
  const soc = new Float64Array(n);
  let s = 0;
  let gridCharged = 0;
  let discharged = 0;
  const eta = b ? Math.sqrt(b.roundTrip) : 1;
  let plan = new Map<number, number>();
  let planned = false;
  for (let i = 0; i < n; i++) {
    const net = h.solar[i] - h.load[i];
    if (!b || b.capacityKwh <= 0) {
      imp[i] = Math.max(0, -net);
      exp[i] = Math.max(0, net);
      continue;
    }
    if (b.gridCharge && (h.hour[i] === 0 || i === 0)) {
      plan = planDay(h, i, s, b);
      planned = plan.size > 0;
    }
    if (h.hour[i] >= NIGHT_END) planned = false;
    let charge = 0; // stored kWh added this hour
    if (net >= 0) {
      const c = Math.min(net * eta, b.powerKw * eta, b.capacityKwh - s);
      charge += c;
      imp[i] = 0;
      exp[i] = net - c / eta;
    } else {
      const need = -net;
      const canDischarge = !(b.gridCharge && planned && h.hour[i] < NIGHT_END);
      const d = canDischarge ? Math.min(need, b.powerKw, s * eta) : 0;
      s -= d / eta;
      discharged += d;
      imp[i] = need - d;
      exp[i] = 0;
    }
    const buy = plan.get(i);
    if (buy) {
      const room = b.capacityKwh - s - charge;
      const powerLeft = b.powerKw * eta - charge;
      const stored = Math.max(0, Math.min(buy * eta, room, powerLeft));
      charge += stored;
      imp[i] += stored / eta;
      gridCharged += stored / eta;
    }
    s = Math.min(b.capacityKwh, s + charge);
    soc[i] = s;
  }
  return { imp, exp, soc, gridCharged, discharged };
}

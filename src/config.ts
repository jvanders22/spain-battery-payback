// GoatCounter site code (the "xyz" in xyz.goatcounter.com, from https://www.goatcounter.com/signup).
// Empty = no analytics script is loaded. Same switch as the other power sites.
export const GOATCOUNTER_CODE = "";

export function loadGoatCounter(code = GOATCOUNTER_CODE): void {
  if (!code) return;
  const s = document.createElement("script");
  s.async = true;
  s.src = "//gc.zgo.at/count.js";
  s.dataset.goatcounter = `https://${code}.goatcounter.com/count`;
  document.head.appendChild(s);
}

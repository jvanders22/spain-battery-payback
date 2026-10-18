// Accessibility check: loads the built page in headless Chrome and runs axe-core (WCAG 2.1 AA rules).
// Usage: npm run build && npx vite preview --port 4173 & node scripts/axe.mjs [url]
import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";

const url = process.argv[2] ?? "http://localhost:4173/";
const chrome = process.env.CHROME ?? "/usr/bin/google-chrome";
const axeSource = readFileSync(new URL("../node_modules/axe-core/axe.min.js", import.meta.url), "utf8");
const browser = await puppeteer.launch({ executablePath: chrome, args: ["--no-sandbox"] });
let failed = 0;
for (const [name, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844, isMobile: true }]]) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.getElementById("result")?.getAttribute("aria-busy") === "false");
  await page.evaluate(axeSource);
  const res = await page.evaluate(() => window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] }));
  console.log(`${name}: ${res.violations.length} violations, ${res.passes.length} passed rules`);
  for (const v of res.violations) {
    failed++;
    console.log(`  ${v.id} (${v.impact}): ${v.help}`);
    for (const n of v.nodes.slice(0, 3)) console.log(`    ${n.target.join(" ")}`);
  }
}
await browser.close();
process.exit(failed ? 1 : 0);

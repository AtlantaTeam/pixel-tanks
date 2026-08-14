import { chromium } from '@playwright/test';
const widths = [1200, 1216, 1232, 1248, 1264, 1280, 1440];
const browser = await chromium.launch();
for (const w of widths) {
  const page = await browser.newPage({ viewport: { width: w, height: 900 } });
  await page.goto('http://localhost:3050/game?seed=42', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="top-hud-desktop"]');
  const r = await page.evaluate(() => {
    const strip = document.querySelector('[data-testid="top-hud-desktop"]');
    const row = document.querySelector('[data-testid="top-hud-telemetry-desktop"]');
    const cells = [...document.querySelectorAll('[data-testid="top-hud-telemetry-numbers"] > *, [data-testid="top-hud-telemetry-resources"] > *')].filter(c => c.getBoundingClientRect().width > 0);
    const withPad = { over: strip.scrollWidth - strip.clientWidth, rowRight: Math.round(row.getBoundingClientRect().right) };
    cells.forEach(c => { c.style.paddingLeft = '0px'; c.style.paddingRight = '0px'; });
    const noPad = { over: strip.scrollWidth - strip.clientWidth, rowRight: Math.round(row.getBoundingClientRect().right) };
    return { cells: cells.length, withPad, noPad, client: strip.clientWidth };
  });
  console.log(w, JSON.stringify(r));
  await page.close();
}
await browser.close();

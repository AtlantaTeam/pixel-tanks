import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
await page.goto('http://localhost:3050/game?seed=42', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="top-hud-desktop"]');
const r = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('[data-testid="top-hud-telemetry-numbers"] > *, [data-testid="top-hud-telemetry-resources"] > *')];
  cells.forEach(c => { c.style.paddingLeft='0px'; c.style.paddingRight='0px'; });
  const strip = document.querySelector('[data-testid="top-hud-desktop"]');
  const kids = [...strip.children].map(k => ({ id: k.dataset.testid || k.className.slice(0,30), w: Math.round(k.getBoundingClientRect().width), scroll: k.scrollWidth, client: k.clientWidth }));
  const statusRow = document.querySelector('[data-testid="top-hud-status-row"]');
  const statusKids = [...statusRow.children].map(k => ({ id: k.dataset.testid || k.className.slice(0,40), w: Math.round(k.getBoundingClientRect().width), scroll: k.scrollWidth, client: k.clientWidth, right: Math.round(k.getBoundingClientRect().right) }));
  return { over: strip.scrollWidth - strip.clientWidth, client: strip.clientWidth, kids, statusRow: { scroll: statusRow.scrollWidth, client: statusRow.clientWidth, w: Math.round(statusRow.getBoundingClientRect().width) }, statusKids };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();

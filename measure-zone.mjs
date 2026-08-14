import { chromium } from '@playwright/test';
const browser = await chromium.launch();
for (const w of [390, 768, 1024, 1200, 1280, 1920]) {
  const page = await browser.newPage({ viewport: { width: w, height: 900 } });
  await page.goto('http://localhost:3050/game?seed=42', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="gesture-zone"]');
  const r = await page.evaluate(() => {
    const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) }; };
    const visible = (sel) => [...document.querySelectorAll(sel)].find(el => el.getBoundingClientRect().height > 0) || null;
    return {
      hud: box(document.querySelector('[data-testid="top-hud"]')),
      zone: box(document.querySelector('[data-testid="gesture-zone"]')),
      deck: box(visible('[data-testid^="game-deck"]')),
      deckId: visible('[data-testid^="game-deck"]')?.dataset.testid,
      vh: window.innerHeight,
    };
  });
  console.log(w, JSON.stringify(r));
  await page.close();
}
await browser.close();

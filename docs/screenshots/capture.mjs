// Captures d'écran du mode démo finance-tracker (données synthétiques).
// Usage: node capture.mjs <PIN> <outDir>
import { chromium } from 'playwright-core';

const [pin, outDir] = process.argv.slice(2);
if (!pin || !outDir) { console.error('usage: node capture.mjs <PIN> <outDir>'); process.exit(1); }

const EXE = process.env.HOME + '/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
const BASE = 'http://localhost:3000';

const PAGES = [
  { path: '/', name: 'dashboard', wait: 2500 },
  { path: '/health', name: 'health', wait: 3000 },
  { path: '/expenses', name: 'expenses', wait: 2500, click: true },
  { path: '/history/2026-03', name: 'statement-detail', wait: 2500 },
  { path: '/loans', name: 'loans', wait: 2000 },
  { path: '/savings', name: 'savings', wait: 2000 },
  { path: '/subscriptions', name: 'subscriptions', wait: 2000 },
  { path: '/history', name: 'history', wait: 2000 },
];

const browser = await chromium.launch({ executablePath: EXE });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.25 });
await ctx.addInitScript(([p]) => {
  sessionStorage.setItem('ft_pin', p);
  sessionStorage.setItem('demoMode', 'true');
}, [pin]);
const page = await ctx.newPage();

for (const p of PAGES) {
  await page.goto(BASE + p.path, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(p.wait);
  if (p.click) {
    // Page Dépenses : clique la 1ère part de légende pour montrer le drill-down
    const legend = page.locator('li button').first();
    if (await legend.count()) { await legend.click().catch(() => {}); await page.waitForTimeout(600); }
  }
  await page.screenshot({ path: `${outDir}/${p.name}.png` });
  console.log('shot', p.name);
}

// Login (sans PIN pré-rempli) pour la capture du guard
const ctx2 = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.25 });
const page2 = await ctx2.newPage();
await page2.goto(BASE + '/login', { waitUntil: 'networkidle' }).catch(() => {});
await page2.waitForTimeout(1200);
await page2.screenshot({ path: `${outDir}/login.png` });
console.log('shot login');

await browser.close();

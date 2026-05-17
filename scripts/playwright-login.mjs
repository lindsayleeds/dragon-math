import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const playwrightPath = process.env.PLAYWRIGHT_PATH
  || '/home/azureuser/.npm/_npx/e41f203b7505f1fb/node_modules/playwright';
const { chromium } = require(playwrightPath);

const USERNAME = process.argv[2] || 'ailey';
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const HEADLESS = process.env.HEADLESS !== 'false';

const browser = await chromium.launch({ headless: HEADLESS });
const context = await browser.newContext();
const page = await context.newPage();

page.on('console', msg => {
  if (msg.type() === 'error') console.log('[page error]', msg.text());
});

console.log(`Opening ${BASE_URL} ...`);
await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

await page.waitForSelector('input[autocomplete="username"]', { timeout: 10000 });
await page.fill('input[autocomplete="username"]', USERNAME);
await page.click('button[type="submit"]');

await page.waitForURL(url => !url.pathname.startsWith('/auth') && !url.pathname.startsWith('/login'), { timeout: 10000 });

const token = await page.evaluate(() => localStorage.getItem('dm_token'));

console.log('Logged in as:', USERNAME);
console.log('Landed on:', page.url());
console.log('Token present:', Boolean(token));

await browser.close();

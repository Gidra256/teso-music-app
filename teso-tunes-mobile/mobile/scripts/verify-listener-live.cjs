// Read-only checks against the live catalog. Block every production mutation, including play counts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.VERIFY_BASE_URL || 'https://tesohub-music-pwa.onrender.com';
const artifacts = path.join(require('node:os').tmpdir(), 'tesohub-listener-review');
fs.mkdirSync(artifacts, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-quic'] });
  const results = [];
  try {
    for (const width of [320, 360, 390, 768, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
      const writes = [], failures = [], responses = [], errors = [];
      await context.addInitScript(() => {
        localStorage.setItem('tesohub_music_onboarding_v1', 'completed');
        window.audios = [];
        const NativeAudio = window.Audio;
        window.Audio = function (...args) { const audio = new NativeAudio(...args); window.audios.push(audio); return audio; };
      });
      await context.route('**/api/**', route => {
        if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
        writes.push(new URL(route.request().url()).pathname);
        return route.fulfill({ contentType: 'application/json', body: '{}' });
      });
      const page = await context.newPage();
      page.on('response', response => {
        if (response.url().includes('/api/')) responses.push({ path: new URL(response.url()).pathname + new URL(response.url()).search, status: response.status() });
      });
      page.on('requestfailed', request => {
        if (request.url().includes('/api/')) failures.push({ path: new URL(request.url()).pathname + new URL(request.url()).search, error: request.failure()?.errorText });
      });
      page.on('pageerror', error => errors.push(error.message));
      let retried = false;
      try {
        await page.goto(base, { timeout: 60000 });
        for (const id of ['new', 'popular', 'artists', 'genres', 'featured', 'more']) {
          try { await page.getByTestId(`home-${id}`).waitFor({ timeout: 20000 }); }
          catch (error) {
            if (retried || !await page.getByLabel('Retry unavailable sections').isVisible()) throw error;
            retried = true;
            console.log('LIVE section retry', { width, section: id, failures, responses: responses.filter(response => response.status >= 400) });
            await page.getByLabel('Retry unavailable sections').click();
            await page.getByTestId(`home-${id}`).waitFor({ timeout: 20000 });
          }
        }
        assert.equal(await page.getByTestId('home-recent').count(), 0);
        assert.equal(await page.getByTestId('home-followed').count(), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        if (width === 390) {
          await page.getByTestId('home-new').locator('img').first().click();
          await page.waitForFunction(() => window.audios.some(audio => audio.currentTime > 0.5 && !audio.paused), null, { timeout: 45000 });
          await page.getByTestId('home-recent').waitFor();
          await page.reload();
          await page.getByTestId('home-recent').waitFor();
          assert.ok(writes.every(path => /^\/api\/songs\/\d+\/play\/$/.test(path)));
        }
        assert.deepEqual(errors, []);
        results.push({ width, status: 'PASS', retried, failures, responses, blockedWrites: writes });
        await page.screenshot({ path: path.join(artifacts, `live-home-${width}.png`), fullPage: true });
        console.log('PASS live catalog Home', { width, retried, blockedWrites: writes.length });
      } catch (error) {
        console.error('LIVE CHECK FAILED', { width, retried, failures, responses, errors });
        throw error;
      } finally { await context.close(); }
    }
  } finally {
    fs.writeFileSync(path.join(artifacts, 'live-results.json'), JSON.stringify({ base, at: new Date().toISOString(), results }, null, 2));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

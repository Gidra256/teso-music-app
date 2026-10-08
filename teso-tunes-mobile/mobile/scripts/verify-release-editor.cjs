// Exported PWA acceptance check. All API traffic is intercepted; no production access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(process.argv[2]);
const artifacts = path.join(require('node:os').tmpdir(), 'tesohub-release-editor-review');
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png', '.ttf': 'font/ttf' };
const server = http.createServer((req, res) => {
  let file = path.resolve(root, `.${decodeURIComponent(new URL(req.url, 'http://localhost').pathname)}`);
  if (file !== root && !file.startsWith(root + path.sep)) return res.writeHead(403).end();
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

async function verify(browser, width) {
  const account = { id: 701, name: 'Fixture artist account', role: 'artist', artist: 11, liked_song_ids: [], followed_artist_ids: [] };
  const reason = 'Please correct the song title and songwriter credit.';
  const release = { id: 901, title: 'Fixture rejected release', status: 'rejected', review_reason: reason, artist: 11, genre: 'Gospel', language: 'Ateso', release_date: '2099-01-01', release_type: 'Single', rights_confirmed: true, updated_at: '2026-10-08T10:00:00.000Z', audio_file: '/api/releases/901/audio/', cover_image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=' };
  const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
  const errors = []; let puts = 0, posts = 0;
  await context.addInitScript(account => {
    localStorage.setItem('teso_tunes_auth_token', 'fixture-browser-token');
    localStorage.setItem('teso_tunes_auth_listener', JSON.stringify(account));
    localStorage.setItem('tesohub_music_onboarding_v1', 'completed');
  }, account);
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (!url.pathname.includes('/api/')) {
      if (url.hostname === '127.0.0.1' || url.protocol === 'data:') return route.continue();
      return route.abort();
    }
    const endpoint = url.pathname.replace(/^.*\/api/, '');
    const send = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (endpoint === '/auth/me/') return send({ listener: account });
    if (endpoint === '/platform-status/') return send({ maintenance_mode: false });
    if (endpoint === '/artist-studio/dashboard/') return send({ artist: { id: 11, name: 'Fixture artist' }, total_releases: 1, latest_release: release });
    if (endpoint === '/artist-studio/releases/') {
      if (request.method() === 'POST') { posts++; return send({ detail: 'Unexpected create' }, 400); }
      return send([release]);
    }
    if (endpoint === '/artist-studio/releases/901/' && request.method() === 'PUT') {
      puts++;
      const body = request.postData();
      assert.match(body, /name="title"\r\n\r\nCorrected release/);
      assert.match(body, /name="submit_for_review"\r\n\r\ntrue/);
      assert.match(body, /name="expected_updated_at"\r\n\r\n2026-10-08T10:00:00.000Z/);
      assert.doesNotMatch(body, /name="(?:audio_upload|cover_upload)"/);
      await new Promise(resolve => setTimeout(resolve, 300));
      Object.assign(release, { title: 'Corrected release', status: 'under_review', review_reason: '', last_review_reason: reason });
      return send(release);
    }
    return send([]);
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  const text = name => page.getByText(name, { exact: true }).filter({ visible: true });
  async function shot(name) {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} overflow at ${width}`);
    await page.screenshot({ path: path.join(artifacts, `${name}-${width}.png`), fullPage: true });
  }
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/artist-studio`);
    await text(reason).first().waitFor();
    await text('Edit & Resubmit').first().click();
    await page.getByPlaceholder('Song title', { exact: true }).waitFor();
    assert.equal(await page.getByPlaceholder('Song title', { exact: true }).inputValue(), release.title);
    await text(reason).waitFor();
    await text('Existing audio retained').waitFor();
    await page.getByPlaceholder('Song title', { exact: true }).fill('Corrected release');
    await shot('editor');
    await page.setViewportSize({ width, height: 330 });
    for (const control of [page.getByPlaceholder('Song title', { exact: true }), text('Resubmit for Review')]) {
      await control.scrollIntoViewIfNeeded();
      const box = await control.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 330, 'Input and action reachable in shortened viewport');
    }
    await text('Resubmit for Review').evaluate(el => { el.click(); el.click(); });
    await page.waitForURL('**/artist-studio');
    await text('Under Review').first().waitFor();
    await text(`Previous review: ${reason}`).first().waitFor();
    assert.equal(puts, 1); assert.equal(posts, 0); assert.equal(release.id, 901);
    assert.equal(await text('Edit & Resubmit').count(), 0);
    await page.setViewportSize({ width, height: 900 }); await shot('resubmitted');
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: reason, prefill, same-ID PUT, duplicate guard, no create/media replacement, return to review, previous reason, scroll reachability`);
  } finally { await context.close(); }
}

(async () => {
  fs.mkdirSync(artifacts, { recursive: true });
  const { chromium } = await import(pathToFileURL(process.env.TESO_PLAYWRIGHT_MODULE).href);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try { for (const width of [320, 360, 390, 768, 1440]) await verify(browser, width); }
  finally { await browser.close(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });

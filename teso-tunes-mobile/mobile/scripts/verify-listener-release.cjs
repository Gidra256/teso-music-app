// Real production reads/audio. Catalog/account mutations are blocked in the browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.VERIFY_BASE_URL || 'https://tesohub-music-pwa.onrender.com';
const api = 'https://teso-music-app.onrender.com';
const artifacts = path.join(require('node:os').tmpdir(), 'tesohub-listener-release');
fs.mkdirSync(artifacts, { recursive: true });
const report = { at: new Date().toISOString(), base, checks: {}, errors: [], blockedWrites: [] };
const timeout = () => AbortSignal.timeout(60000);
async function json(url, options) {
  const response = await fetch(url, { signal: timeout(), ...options });
  assert.ok(response.ok, `${new URL(url).pathname}: ${response.status}`);
  return response.json();
}

(async () => {
  let browser, authToken;
  try {
    const health = await json(api + '/healthz');
    assert.equal(health.persistence_backend, 'supabase');
    report.checks.health = 'PASS Supabase';
    const songs = await json(api + '/api/songs/');
    const song = songs.find(item => Number(item.id) === 37 && item.audio_file) || songs.find(item => item.audio_file);
    assert.ok(song);
    const mediaUrl = new URL(song.audio_file);
    assert.equal(mediaUrl.origin, api);
    assert.ok(mediaUrl.pathname.startsWith('/api/storage/music-audio/'));
    for (const range of ['bytes=0-1023', 'bytes=4096-5119']) {
      const response = await fetch(mediaUrl, { headers: { Range: range }, signal: timeout() });
      assert.equal(response.status, 206);
      assert.equal((await response.arrayBuffer()).byteLength, 1024);
      assert.ok(response.headers.get('content-range').startsWith(range.replace('=', ' ') + '/'));
    }
    report.checks.privateAudioRange = 'PASS 206, first and nonzero byte ranges';
    for (const route of ['/profile', '/profile/edit', '/settings', `/song/${song.id}`, '/support', '/library']) {
      const response = await fetch(base + route, { signal: timeout() });
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.ok(html.includes('AppEntry-'));
      report.checks[route] = 'PASS SPA document';
    }
    const share = await fetch(`${api}/song/${song.id}`, { signal: timeout(), redirect: 'manual' });
    assert.ok([200, 301, 302, 307, 308].includes(share.status));
    report.checks.share = `PASS backend share URL HTTP ${share.status}`;
    browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-quic'] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await context.addInitScript(() => {
      window.audios = [];
      const NativeAudio = window.Audio;
      window.Audio = function (...args) { const audio = new NativeAudio(...args); window.audios.push(audio); return audio; };
    });
    await context.route('**/api/**', route => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
      report.blockedWrites.push(new URL(route.request().url()).pathname);
      return route.fulfill({ contentType: 'application/json', body: '{}' });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', error => report.errors.push(error.message));
    const visible = page.locator(':not([aria-hidden="true"], [aria-hidden="true"] *)');
    const label = name => page.getByLabel(name, { exact: true }).and(visible).filter({ visible: true });
    const text = name => page.getByText(name, { exact: true }).and(visible).filter({ visible: true });
    await page.goto(`${base}/song/${song.id}`, { timeout: 60000 });
    await label('Play shared song').waitFor();
    assert.equal(await text('Welcome to TesoHub Music').count(), 0);
    await label('Play shared song').click();
    await page.waitForFunction(() => window.audios.some(audio => audio.currentTime > 0.5 && !audio.paused), null, { timeout: 60000 });
    const slider = label('Song progress');
    await slider.waitFor();
    const current = () => page.evaluate(() => { const a = window.audios.at(-1); return { time: a.currentTime, paused: a.paused, duration: a.duration }; });
    const before = (await current()).time;
    await page.waitForFunction(time => window.audios.at(-1).currentTime > time + 0.3, before);
    const progress = Number(await slider.getAttribute('aria-valuenow'));
    assert.ok(Math.abs(progress - (await current()).time) < 1);
    await label('Pause song').click();
    await page.waitForFunction(() => window.audios.at(-1).paused);
    const box = await slider.boundingBox();
    const duration = (await current()).duration;
    await slider.click({ position: { x: box.width * 0.3, y: box.height / 2 } });
    await page.waitForFunction(target => Math.abs(window.audios.at(-1).currentTime - target) < 2, duration * 0.3);
    assert.equal((await current()).paused, true);
    await label('Play song').click();
    await page.waitForFunction(() => !window.audios.at(-1).paused);
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction(target => Math.abs(window.audios.at(-1).currentTime - target) < 3, duration * 0.45);
    await label('Pause song').click();
    report.checks.realGuestPlayer = 'PASS real audio clock/progress, pause/resume, paused tap seek and playing drag seek';
    await label('Open Up Next').click();
    await page.getByTestId('up-next-list').getByText('Now Playing', { exact: true }).waitFor();
    const queued = page.locator('[data-testid^="queue-entry-"]').filter({ visible: true });
    assert.equal(await queued.count(), 0);
    await label('Close Up Next').click();
    await text('More').click();
    await label('Add to Queue').click();
    await text('Added to queue.').waitFor();
    await label('Close song actions').click();
    await label('Close song actions').waitFor({ state: 'hidden' });
    await label('Open Up Next').click();
    assert.equal(await queued.count(), 1);
    await label(`Remove from queue: ${song.title}`).click();
    assert.equal(await queued.count(), 0);
    await label('Close Up Next').click();
    report.checks.realGuestQueue = 'PASS current song, empty upcoming, add intentional duplicate, remove; guest access without account writes';
    await page.goto(base, { timeout: 60000 });
    for (const section of ['new', 'popular', 'genres', 'featured', 'artists', 'recent']) await page.getByTestId(`home-${section}`).waitFor();
    await page.reload();
    await page.getByTestId('home-recent').waitFor();
    report.checks.home = 'PASS New releases, Popular, Genres, Featured songs/artists; genuine Continue listening survives reload';
    await page.goto(base + '/songs', { timeout: 90000, waitUntil: 'domcontentloaded' });
    for (const item of ['Home', 'Search', 'Your Library', 'Create']) await text(item).first().waitFor();
    await label('Open song menu').first().click();
    for (const action of ['Add to Queue', 'Play Next', 'Add to Playlist', 'Share']) await label(action).waitFor();
    await label('Close song actions').click();
    report.checks.realBrowse = 'PASS real catalog rows, listener navigation shell and working song-action menu';
    await page.goto(base + '/profile');
    await text('Make TesoHub yours').waitFor();
    await text('Create Account').waitFor(); await text('Log In').waitFor();
    assert.equal(await text('USER ' + song.id).count(), 0);
    await label('Open Help and Support').click(); await text('Get Help').waitFor();
    report.checks.guestProfileSupport = 'PASS guest Profile and real Help Center';
    await page.screenshot({ path: path.join(artifacts, 'live-support.png'), fullPage: true });
    await context.close();

    if (process.env.TESO_TEST_EMAIL && process.env.TESO_TEST_PASSWORD) {
      const auth = await json(api + '/api/auth/login/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: process.env.TESO_TEST_EMAIL, password: process.env.TESO_TEST_PASSWORD, device_name: 'Listener release verification' }) });
      authToken = auth.token;
      const headers = { Authorization: `Bearer ${authToken}` };
      const before = await json(api + '/api/auth/me/', { headers });
      const signed = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      await signed.addInitScript(({ token, listener }) => {
        if (localStorage.getItem('release_seed')) return;
        localStorage.setItem('release_seed', '1');
        localStorage.setItem('teso_tunes_auth_token', token);
        localStorage.setItem('teso_tunes_auth_listener', JSON.stringify(listener));
      }, { token: authToken, listener: before.listener });
      await signed.route('**/api/**', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.abort());
      const p = await signed.newPage();
      p.on('pageerror', error => report.errors.push(error.message));
      await p.goto(base + '/profile');
      await p.getByLabel('Edit Profile', { exact: true }).click();
      await p.getByLabel('Save Changes', { exact: true }).waitFor();
      await p.getByLabel('Back', { exact: true }).filter({ visible: true }).click();
      await p.getByLabel('Settings', { exact: true }).click();
      await p.getByText('Version 1.0.6', { exact: true }).waitFor();
      await p.goto(base + '/library');
      for (const filter of ['Liked Songs', 'Following Artists', 'Playlists', 'Recently Played', 'Downloads']) await p.getByRole('tab', { name: filter, exact: true }).click();
      await p.getByText('Offline downloads are not enabled yet.', { exact: true }).waitFor();
      await p.goto(base + '/support/tickets');
      await p.getByText('My Support Requests', { exact: true }).waitFor();
      await signed.close();
      const after = await json(api + '/api/auth/me/', { headers });
      for (const key of ['id', 'name', 'email', 'phone', 'liked_song_ids', 'followed_artist_ids']) assert.deepEqual(after.listener[key], before.listener[key]);
      report.checks.authenticated = 'PASS login/auth-me, Profile/Edit/Settings, Library, Support reads; identity/engagement unchanged';
    } else report.checks.authenticated = 'NOT RUN: no local test-listener credentials; deployed-asset fixture tests reported separately';
    assert.deepEqual(report.errors, []);
    report.status = 'PASS public production checks';
  } catch (error) {
    report.status = 'FAIL';
    report.failure = error.message;
    throw error;
  } finally {
    if (authToken) {
      const response = await fetch(api + '/api/auth/logout/', { method: 'POST', headers: { Authorization: `Bearer ${authToken}` }, signal: timeout() }).catch(() => null);
      report.testSessionLogout = response?.status || 'failed';
    }
    await browser?.close();
    fs.writeFileSync(path.join(artifacts, 'production-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });

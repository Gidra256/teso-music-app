// Isolated production-export acceptance: all API traffic/audio is intercepted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(process.argv[2] || 'dist-discovery-review');
const artifacts = path.join(require('node:os').tmpdir(), 'tesohub-discovery-review');
fs.mkdirSync(artifacts, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png', '.ttf': 'font/ttf' };
const server = http.createServer((req, res) => {
  let file = path.resolve(root, `.${decodeURIComponent(new URL(req.url, 'http://localhost').pathname)}`);
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
const songs = Array.from({ length: 24 }, (_, index) => ({
  id: index + 1, title: `Discovery Song ${index + 1}`, artist: 11, artist_name: 'Discovery Artist',
  status: 'published', release_date: index < 8 ? `2026-09-${String(28-index).padStart(2, '0')}` : '2025-01-01',
  play_count: index >= 8 && index < 16 ? 1000-index : index + 1, is_featured: index >= 16 && index < 20,
  genre: index % 2 ? 'Akogo' : 'Afrobeat', cover_image: '', audio_file: 'https://audio.example.test/test.wav', like_count: 2,
}));
const artists = [{ id: 11, name: 'Discovery Artist', is_featured: true, follower_count: 10, status: 'active', photo: '', songs }, { id: 12, name: 'Followed Artist', is_featured: false, status: 'active', follower_count: 3, photo: '', songs: [] }];
let discoveryOptions, selectDiscovery;

async function fixture(browser, width, height, mode = 'guest') {
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
  const account = { id: 123, name: 'Discovery Listener', email: 'discovery@example.test', role: 'listener', liked_song_ids: mode === 'returning' ? [9] : [], followed_artist_ids: mode === 'returning' ? [12] : [] };
  const seed = { tesohub_music_onboarding_v1: 'completed' };
  if (['new-account', 'returning'].includes(mode)) {
    seed.teso_tunes_auth_token = 'test-only-token'; seed.teso_tunes_auth_listener = JSON.stringify(account);
    delete seed.tesohub_music_onboarding_v1;
  }
  if (mode === 'returning') seed.teso_tunes_recently_played = JSON.stringify([songs[1], { id: 99, title: 'Now private' }, songs[19]]);
  await context.addInitScript(seed => {
    if (!localStorage.getItem('discovery_seeded')) { for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value); localStorage.setItem('discovery_seeded', '1'); }
    window.audioPlays = [];
    HTMLMediaElement.prototype.play = function () {
      window.audioPlays.push(this.src);
      Object.defineProperties(this, { paused: { configurable: true, value: false }, readyState: { configurable: true, value: 4 }, currentTime: { configurable: true, value: 1 }, duration: { configurable: true, value: 120 } });
      this.dispatchEvent(new Event('timeupdate'));
      return Promise.resolve();
    };
  }, seed);
  const calls = [], errors = [];
  let failed = mode === 'failure';
  await context.route('**/api/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    const endpoint = url.pathname.replace(/^.*\/api/, '');
    calls.push(`${req.method()} ${endpoint}${url.search}`);
    const send = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) }).catch(() => {});
    if (endpoint === '/platform-status/') return send({ maintenance_mode: false });
    if (endpoint === '/auth/me/') return send({ listener: account });
    if (endpoint === '/songs/' || endpoint === '/artists/') {
      const options = discoveryOptions(Object.fromEntries(url.searchParams));
      if (mode === 'slow' && options.discovery === 'new') await new Promise(resolve => setTimeout(resolve, 6500));
      if (mode === 'timeout' && options.discovery === 'new') await new Promise(resolve => setTimeout(resolve, 13500));
      if (failed && options.discovery === 'popular') return send({ detail: 'Test unavailable section' }, 503);
      const items = selectDiscovery(endpoint === '/songs/' ? songs : artists, options, endpoint === '/songs/' ? 'song' : 'artist');
      return send(mode === 'empty' ? [] : mode === 'artwork-error' ? items.map(item => ({ ...item, photo: 'https://art.example.test/missing.png', cover_image: 'https://art.example.test/missing.png' })) : items);
    }
    if (endpoint === '/genres/') return send(mode === 'empty' ? [] : ['Akogo', 'Afrobeat', 'A very long genre name to check wrapping']);
    if (endpoint === '/artists/11/') return send(artists[0]);
    if (endpoint === '/songs/1/' || endpoint === '/songs/2/') return send(songs[Number(endpoint.split('/')[2])-1]);
    if (/\/songs\/\d+\/play\//.test(endpoint)) return send({ play_count: 3 });
    if (/\/songs\/9\/(unlike|like)\//.test(endpoint)) {
      const liked = endpoint.endsWith('/like/'); account.liked_song_ids = liked ? [9] : [];
      return send({ liked, like_count: liked ? 2 : 1 });
    }
    if (/\/artists\/12\/(unfollow|follow)\//.test(endpoint)) {
      const followed = endpoint.endsWith('/follow/'); account.followed_artist_ids = followed ? [12] : [];
      return send({ followed, follower_count: followed ? 3 : 2 });
    }
    if (endpoint === '/support/help-center/') return send({ categories: { listener: [], artist: [] }, articles: [] });
    return send([]);
  });
  await context.route('https://audio.example.test/**', route => route.fulfill({ body: '' }));
  await context.route('https://art.example.test/**', route => route.fulfill({ status: 404, body: '' }));
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const base = process.env.VERIFY_BASE_URL || `http://127.0.0.1:${server.address().port}`;
  const text = name => page.getByText(name, { exact: true }).filter({ visible: true });
  return { context, page, base, text, calls, errors, recover: () => { failed = false; } };
}

async function verify(browser, width, height, mode = 'guest') {
  const f = await fixture(browser, width, height, mode);
  const { context, page, base, text, calls, errors } = f;
  try {
    page.setDefaultNavigationTimeout(60000);
    await page.goto(base);
    if (mode === 'empty') {
      await text('No music available yet').waitFor();
      assert.equal(await page.getByTestId('home-recent').count(), 0);
      assert.equal(await page.getByTestId('home-new').count(), 0);
      console.log('PASS genuine empty catalog, no fake sections'); return;
    }
    if (mode === 'slow' || mode === 'timeout') {
      await page.getByTestId('home-popular').waitFor();
      await page.getByLabel('Loading new releases').waitFor();
      await text('Still loading more music...').waitFor();
      assert.ok(calls.some(call => call.includes('discovery=popular')));
      if (mode === 'timeout') { await page.getByLabel('Retry unavailable sections').waitFor({ timeout: 16000 }); assert.equal(await page.getByLabel('Loading new releases').count(), 0); }
      else await page.getByTestId('home-new').waitFor();
      console.log(`PASS ${mode}: independent section rendering and bounded wait`); return;
    }
    await page.getByTestId('home-new').waitFor();
    if (mode === 'failure') {
      await page.getByLabel('Retry unavailable sections').waitFor();
      assert.equal(await page.getByTestId('home-popular').count(), 0);
      const before = calls.filter(call => call.includes('/songs/?')).length;
      f.recover(); await page.getByLabel('Retry unavailable sections').click();
      await page.getByTestId('home-popular').waitFor();
      assert.equal(calls.filter(call => call.includes('/songs/?')).length, before + 1);
      console.log('PASS one failed section does not block Home; retry only refetches failure'); return;
    }
    await page.getByTestId('home-artists').waitFor();
    await page.getByTestId('home-genres').waitFor();
    await page.getByTestId('home-featured').waitFor();
    await page.getByTestId('home-more').waitFor();
    assert.equal(await text('Welcome to TesoHub Music').count(), 0);
    assert.equal(await text('Trending now').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const primarySong = page.getByTestId('home-new').getByText(songs[0].title, { exact: true });
    const box = await primarySong.locator('..').locator('img').first().locator('..').boundingBox();
    assert.ok(Math.abs(box.width-box.height) < 1 && box.width <= 168);
    const artistBox = await page.getByTestId('home-artists').locator('img').first().locator('..').boundingBox();
    assert.ok(Math.abs(artistBox.width-artistBox.height) < 1 && artistBox.width <= 168);
    if (mode === 'artwork-error') {
      await page.waitForFunction(() => {
        const images = ['home-new', 'home-artists'].map(id => document.querySelector(`[data-testid="${id}"] img`));
        return images.every(image => image?.naturalWidth > 0 && image.src.includes('tesohub-music'));
      });
    }
    assert.equal(calls.filter(call => /^GET \/(songs|artists)\/$/.test(call)).length, 0, 'No full catalog requested by Home');
    for (const mode of ['new', 'popular', 'featured', 'more']) assert.equal(calls.filter(call => call.startsWith(`GET /songs/?discovery=${mode}&`) && !call.includes('&ids=')).length, 1);
    const count = calls.length; await text('All').click(); assert.equal(calls.length, count, 'Active tab does not refetch catalog');
    if (mode === 'returning') {
      await page.getByTestId('home-recent').waitFor();
      await page.getByTestId('home-followed').waitFor();
      assert.equal(await text('Now private').count(), 0);
      await page.getByLabel('Unlike Discovery Song 9', { exact: true }).first().click();
      await page.getByLabel('Like Discovery Song 9', { exact: true }).first().waitFor();
      await page.getByTestId('home-followed').getByText('Following', { exact: true }).click();
      await page.getByTestId('home-followed').waitFor({ state: 'hidden' });
      await page.getByTestId('home-recent').getByText(songs[1].title, { exact: true }).click();
      await page.waitForURL('**/player');
      await page.waitForFunction(() => window.audioPlays.length > 0);
    } else {
      assert.equal(await page.getByTestId('home-recent').count(), 0);
      assert.equal(await page.getByTestId('home-followed').count(), 0);
      await page.screenshot({ path: path.join(artifacts, `home-${mode}-${width}.png`), fullPage: true });
      await page.getByTestId('home-artists').getByText('Discovery Artist', { exact: true }).click();
      await page.waitForURL('**/artist/11');
      await page.goBack();
      await page.getByLabel('Browse Akogo', { exact: true }).click();
      await page.waitForURL('**/search?genre=Akogo');
      const search = page.getByTestId('search-screen');
      await search.getByText('Discovery Song 2', { exact: true }).waitFor();
      assert.equal(await search.getByText('Discovery Song 1', { exact: true }).count(), 0, 'Genre is exact, not artist category');
      await page.reload(); await search.getByText('Discovery Song 2', { exact: true }).waitFor();
      await page.getByLabel('Clear genre filter').click();
      await search.getByText('Discovery Song 1', { exact: true }).waitFor();
      await page.goto(base);
      await page.getByTestId('home-new').getByText(songs[0].title, { exact: true }).click();
      await page.waitForFunction(() => window.audioPlays.length > 0);
      await page.getByTestId('home-recent').waitFor();
    }
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}x${height} ${mode}: discovery order/content, public history, bounded requests, artwork, playback, navigation, engagement`);
  } catch (error) {
    console.error('Discovery verification failure', mode, width, error.message);
    console.log(await page.getByTestId('home-artists').evaluate(el => [...el.querySelectorAll('*')].filter(node => node.textContent === 'Discovery Artist' || node.tagName === 'IMG').map(node => ({ tag: node.tagName, rect: JSON.stringify(node.getBoundingClientRect()), parent: JSON.stringify(node.parentElement.getBoundingClientRect()), style: getComputedStyle(node).cssText, height: getComputedStyle(node).height, flex: getComputedStyle(node.parentElement).flex }))).catch(() => []));
    await page.screenshot({ path: path.join(artifacts, `failure-${mode}-${width}.png`), timeout: 3000 }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}

(async () => {
  ({ discoveryOptions, selectDiscovery } = await import(pathToFileURL(path.resolve('../backend-js/discovery.js')).href));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  if (process.argv.includes('--preview')) { console.log(`Local preview: http://127.0.0.1:${server.address().port}`); return; }
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-quic'] });
  try {
    for (const [width, height] of [[320,568], [360,800], [390,844], [768,1024], [1280,900]]) await verify(browser, width, height);
    for (const mode of ['new-account', 'returning', 'empty', 'slow', 'failure', 'timeout', 'artwork-error']) await verify(browser, 390, 844, mode);
    console.log('Screenshots:', artifacts);
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });

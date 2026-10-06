// Local production export, isolated API fixtures and browser-decoded audio. No production writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(process.argv[2] || 'dist-browse-review');
const artifacts = path.join(require('node:os').tmpdir(), 'tesohub-browse-review');
fs.mkdirSync(artifacts, { recursive: true });
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!file.startsWith(root + path.sep) && file !== root) return res.writeHead(403).end();
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
  res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png', '.ttf': 'font/ttf' }[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
const wav = Buffer.alloc(44 + 8000 * 120 * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
const songs = Array.from({ length: 40 }, (_, n) => ({ id: n + 1, title: `Browse Song ${String(n + 1).padStart(2, '0')}`, artist: 11,
  artist_name: 'Browse Artist', artist_category: n % 2 ? 'Gospel Artists' : 'Rappers', genre: 'Akogo',
  status: 'published', play_count: 10, like_count: 3, release_date: '2026-01-01', is_featured: true,
  cover_image: '', audio_file: `https://audio.example.test/${n + 1}.wav` }));

async function verify(browser, width, height, signedIn = false) {
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
  const errors = [], calls = [], likes = new Set();
  let failLike = false;
  const account = () => ({ id: 101, name: 'Browse Tester', email: 'browse@example.test', role: 'listener', liked_song_ids: [...likes], followed_artist_ids: [] });
  const artist = { id: 11, name: 'Browse Artist', follower_count: 8, songs, category: 'Rappers' };
  await context.addInitScript(({ signedIn, listener }) => {
    localStorage.setItem('tesohub_music_onboarding_v1', 'completed');
    if (signedIn) {
      localStorage.setItem('teso_tunes_auth_token', 'browse-test-only');
      localStorage.setItem('teso_tunes_auth_listener', JSON.stringify(listener));
    }
    window.audios = [];
    const Audio = window.Audio;
    window.Audio = function (...args) { const audio = new Audio(...args); window.audios.push(audio); return audio; };
    Object.defineProperty(navigator, 'share', { value: async data => { window.shared = data; } });
  }, { signedIn, listener: account() });
  await context.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), endpoint = url.pathname.replace(/^.*\/api/, '');
    calls.push(`${req.method()} ${endpoint}`);
    const send = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (endpoint === '/platform-status/') return send({ maintenance_mode: false });
    if (endpoint === '/auth/me/') return send({ listener: account() });
    if (endpoint === '/songs/') return send(songs);
    if (/^\/songs\/\d+\/$/.test(endpoint)) return send(songs[Number(endpoint.split('/')[2]) - 1]);
    const like = endpoint.match(/^\/songs\/(\d+)\/(like|unlike)\/$/);
    if (like) {
      await new Promise(resolve => setTimeout(resolve, 200));
      if (failLike) { failLike = false; return send({ detail: 'Test unavailable' }, 503); }
      if (like[2] === 'like') likes.add(Number(like[1])); else likes.delete(Number(like[1]));
      return send({ liked: likes.has(Number(like[1])), like_count: likes.has(Number(like[1])) ? 4 : 3 });
    }
    if (endpoint === '/artists/') return send([artist]);
    if (endpoint === '/artists/11/') return send(artist);
    if (endpoint === '/genres/') return send(['Akogo']);
    if (endpoint === '/playlists/') return send([{ id: 21, name: 'Browse Mix', song_count: 0, songs: [] }]);
    if (endpoint === '/playlists/21/songs/') return send({ playlist: { id: 21, name: 'Browse Mix', song_count: 1, songs: [songs[0]] } });
    if (endpoint === '/support/help-center/') return send({ articles: [], categories: { listener: ['Playback'], artist: [] } });
    if (endpoint.endsWith('/play/')) return send({});
    throw new Error(`Unexpected API request: ${req.method()} ${endpoint}`);
  });
  await context.route('https://audio.example.test/**', route => route.fulfill({ contentType: 'audio/wav', body: wav }));
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', dialog => dialog.dismiss());
  page.on('console', msg => { if (msg.text().includes('was not handled by any navigator')) errors.push(msg.text()); });
  const base = process.env.VERIFY_BASE_URL || `http://127.0.0.1:${server.address().port}`;
  const accessible = page.locator(':not([aria-hidden="true"], [aria-hidden="true"] *)');
  const label = name => page.getByLabel(name, { exact: true }).and(accessible).filter({ visible: true });
  const text = name => page.getByText(name, { exact: true }).and(accessible).filter({ visible: true });
  const list = () => page.getByTestId('browse-songs-list').filter({ visible: true });
  const search = () => page.getByPlaceholder('Search songs or artists').filter({ visible: true });
  const nav = name => width < 900 ? page.getByRole('tab', { name: new RegExp(`${name}$`) }) : text(name).first();
  async function shell() {
    await search().waitFor();
    for (const name of ['Home', 'Search', 'Your Library', 'Create']) await nav(name).waitFor();
    assert.equal(await label('Open profile').count(), 1);
    if (width < 900) assert.equal(await page.getByRole('tab').count(), 4, 'No extra Songs tab');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  async function menu() { await label('Open song menu').first().click(); await label('Close song actions').waitFor(); }
  async function prompt() {
    for (const name of ['Create Account', 'Log In', 'Keep Listening']) await text(name).waitFor();
    await text('Keep Listening').click(); await shell();
  }
  async function finalRowVisible(miniTop) {
    // Virtualized rows can refine their measured offsets after reattachment.
    // Preserve the visible song, rather than an intermediate pixel estimate.
    await page.waitForFunction(miniTop => {
      const list = document.querySelector('[data-testid="browse-songs-list"]');
      const last = [...list.querySelectorAll('*')].find(el => el.textContent === 'Browse Song 40');
      const box = last?.getBoundingClientRect();
      return box && box.height > 0 && box.top >= list.getBoundingClientRect().top && box.bottom < miniTop;
    }, miniTop);
  }
  try {
    await page.goto(base + '/songs'); await shell();
    await page.reload(); await shell();
    await label('Go back').click(); await page.getByTestId('home-new').waitFor();
    await page.getByRole('button', { name: 'Music', exact: true }).click(); await shell();
    await label('Go back').click(); await page.getByTestId('home-new').waitFor();
    await page.getByRole('button', { name: 'Music', exact: true }).click(); await shell();
    await search().fill('Browse Song');
    await text('Gospel Artists').scrollIntoViewIfNeeded();
    await text('Gospel Artists').click();
    await text('Browse Song 02').waitFor();
    assert.equal(await text('Browse Song 01').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await text('Rappers').click();
    await text('Browse Song 01').waitFor();
    await menu();
    for (const name of ['Play', 'Like', 'Add to Playlist', 'Share', 'Go to Artist']) await label(name).waitFor();
    await label('Go to Artist').click(); await page.waitForURL('**/artist/11');
    await page.goBack(); await shell();
    assert.equal(await search().inputValue(), 'Browse Song');
    assert.equal(await text('Browse Song 02').count(), 0, 'Category survives artist return');
    await menu(); await label('Share').click(); await label('Share song link').click();
    assert.ok((await page.evaluate(() => window.shared.url)).endsWith('/song/1'));
    await shell();
    if (!signedIn) {
      await menu(); await label('Like').click(); await prompt();
      await menu(); await label('Add to Playlist').click(); await prompt();
      await nav('Create').click(); await prompt();
      await label('Open profile').click(); await prompt();
      assert.equal(calls.filter(call => call.startsWith('POST ')).length, 0, 'Guest account actions must not write');
    } else {
      await menu();
      await label('Like').evaluate(el => { el.click(); el.click(); });
      await page.waitForResponse(r => r.url().endsWith('/songs/1/like/'));
      await label('Unlike').waitFor();
      assert.equal(calls.filter(call => call === 'POST /songs/1/like/').length, 1);
      await label('Unlike').click(); await page.waitForResponse(r => r.url().endsWith('/songs/1/unlike/'));
      await label('Like').waitFor();
      failLike = true;
      await label('Like').click(); await page.waitForResponse(r => r.status() === 503);
      await label('Like').waitFor(); assert.equal(likes.size, 0);
      await label('Add to Playlist').click(); await text('Browse Mix').click(); await text('Added to Browse Mix.').waitFor();
      await label('Close add to playlist').click();
      await nav('Create').click(); await page.getByPlaceholder('My Teso Mix').waitFor();
      await label('Close create playlist').click(); await shell();
      await label('Open profile').click(); await label('Edit Profile').waitFor();
      await label('Back').click(); await shell();
    }
    await menu(); await label('Play').click();
    await page.waitForFunction(() => window.audios.at(-1)?.currentTime > 0.1);
    await label('Pause song').click();
    assert.equal(await page.evaluate(() => window.audios.at(-1).paused), true);
    const mini = await label('Open player').boundingBox();
    if (width < 900) {
      const bottom = await nav('Home').boundingBox();
      assert.ok(mini.y + mini.height <= bottom.y, 'Mini-player is above bottom navigation');
    }
    const head = await search().boundingBox();
    assert.ok(head.y + head.height < mini.y);
    await text('All').click(); await search().fill('');
    await list().evaluate(el => { el.scrollTop = el.scrollHeight; });
    await finalRowVisible(mini.y);
    await label('Open player').click(); await label('Song progress').waitFor();
    await page.goBack(); await shell();
    await finalRowVisible(mini.y);
    await nav('Home').click(); await page.getByRole('button', { name: 'Music', exact: true }).click(); await shell();
    await finalRowVisible(mini.y);
    await nav('Search').click(); await page.waitForURL('**/search');
    await nav('Your Library').click(); await page.waitForURL('**/library');
    await nav('Home').click(); await page.getByRole('button', { name: 'Music', exact: true }).click(); await shell();
    await page.screenshot({ path: path.join(artifacts, `browse-${width}-${signedIn ? 'listener' : 'guest'}.png`) });
    await list().evaluate(el => { el.scrollTop = 0; });
    await menu();
    const actionBox = await label('Add to Playlist').boundingBox(); assert.ok(actionBox.height >= 44);
    await page.screenshot({ path: path.join(artifacts, `menu-${width}-${signedIn ? 'listener' : 'guest'}.png`) });
    await label('Close song actions').click();
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}x${height} ${signedIn ? 'listener' : 'guest'}: shell, direct/refresh/back, filters/scroll, menu/share/auth, real audio, mini/nav/last-row layout`);
  } catch (error) {
    await page.screenshot({ path: path.join(artifacts, `FAIL-${width}.png`) }).catch(() => {});
    console.error({ width, signedIn, errors, url: page.url(), scroll: await list().evaluate(el => ({ top: el.scrollTop, height: el.scrollHeight, viewport: el.clientHeight,
      rows: [...el.querySelectorAll('*')].filter(e => /^Browse Song \d+$/.test(e.textContent)).map(e => ({ text: e.textContent, top: e.getBoundingClientRect().top, bottom: e.getBoundingClientRect().bottom })) })).catch(() => null) });
    throw error;
  } finally { await context.close(); }
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    for (const [width, height] of [[320,568], [360,800], [390,844], [768,1024], [1280,900]]) await verify(browser, width, height);
    await verify(browser, 390, 844, true);
    await verify(browser, 1280, 900, true);
  } finally { await browser?.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

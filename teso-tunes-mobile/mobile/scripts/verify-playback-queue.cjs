// Local export only. API/account fixtures and browser-decoded audio; no production writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(process.argv[2] || 'dist-queue-review');
const artifacts = path.join(require('node:os').tmpdir(), 'tesohub-queue-review');
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
const songs = [1, 2, 3, 4].map(id => ({ id, title: id === 2 ? 'Queue Song 2 with a very long title that must remain readable' : `Queue Song ${id}`, artist: 11,
  artist_name: 'Queue Artist', genre: 'Akogo', artist_category: 'Rappers', status: 'published', is_featured: true,
  release_date: '2026-01-01', play_count: 20, like_count: 5, audio_file: `https://audio.example.test/${id}.wav` }));

async function run(browser, width, height) {
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
  const errors = [], writes = [], details = [];
  const listener = { id: 101, name: 'Queue Tester', role: 'listener', email: 'queue@example.test', liked_song_ids: [1, 3], followed_artist_ids: [11] };
  await context.addInitScript(() => {
    localStorage.setItem('tesohub_music_onboarding_v1', 'completed');
    window.audios = [];
    const Audio = window.Audio;
    window.Audio = function (...args) { const audio = new Audio(...args); window.audios.push(audio); return audio; };
    Object.defineProperty(navigator, 'share', { value: async data => { window.shared = data; } });
  });
  await context.route('**/api/**', route => {
    const req = route.request(), p = new URL(req.url()).pathname.replace(/^.*\/api/, '');
    const send = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() === 'POST') writes.push(p);
    if (p === '/songs/') return send(songs);
    if (p === '/auth/me/') return send({ listener });
    if (p === '/playlists/') return send([{ id: 9, name: 'Ordered Mix', songs: [songs[2], songs[0], songs[3]], song_count: 3 }]);
    if (p === '/playlists/9/') return send({ id: 9, name: 'Ordered Mix', songs: [songs[2], songs[0], songs[3]], song_count: 3 });
    if (/^\/songs\/\d+\/$/.test(p)) { details.push(p); return send({ ...songs[Number(p.split('/')[2]) - 1], lyrics: 'Existing public lyrics, hydrated safely.' }); }
    if (p === '/artists/') return send([{ id: 11, name: 'Queue Artist', songs, follower_count: 3 }]);
    if (p === '/artists/11/') return send({ id: 11, name: 'Queue Artist', songs, follower_count: 3 });
    if (p === '/genres/') return send(['Akogo']);
    if (p === '/platform-status/') return send({ maintenance_mode: false });
    if (p.endsWith('/play/')) return send({});
    throw Error(`Unexpected API request: ${req.method()} ${p}`);
  });
  await context.route('https://audio.example.test/**', route => {
    const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: 'audio/wav', headers: {
      'accept-ranges': 'bytes', ...(range ? { 'content-range': `bytes ${start}-${end}/${wav.length}` } : {}),
    }, body: wav.subarray(start, end + 1) }).catch(() => {});
  });
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.text().includes('was not handled by any navigator')) errors.push(m.text()); });
  const visible = page.locator(':not([aria-hidden="true"], [aria-hidden="true"] *)');
  const label = name => page.getByLabel(name, { exact: true }).and(visible).filter({ visible: true });
  const text = name => page.getByText(name, { exact: true }).and(visible).filter({ visible: true });
  const rows = () => page.locator('[data-testid^="queue-entry-"]').and(visible);
  const titles = () => rows().locator('[aria-label^="Play queued "]').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label').replace('Play queued ', '')));
  const base = process.env.VERIFY_BASE_URL || `http://127.0.0.1:${server.address().port}`;
  const currentId = () => page.evaluate(() => new URL(window.audios.at(-1).src).pathname.split('/')[1].split('.')[0]);
  async function openQueue() {
    await label('Close song actions').waitFor({ state: 'hidden' });
    await label('Open Up Next').click(); await label('Close Up Next').waitFor();
  }
  async function closeQueue() { await label('Close Up Next').click(); }
  async function endSong() {
    await page.evaluate(async () => { const a = window.audios.at(-1); a.currentTime = a.duration - 0.15; await a.play(); });
  }
  async function playing(id) { await page.waitForFunction(id => window.audios.at(-1)?.src.endsWith(`/${id}.wav`) && window.audios.at(-1).currentTime > 0.02 && !window.audios.at(-1).paused, id); }
  try {
    await page.goto(base + '/songs'); await label('Open song menu').first().click();
    await label('Add to Queue').click(); await label('Open Up Next').click();
    assert.deepEqual(await titles(), [songs[0].title]);
    assert.equal(await page.evaluate(() => window.audios.length), 0, 'Adding before playback does not autoplay');
    await label(`Play queued ${songs[0].title}`).click(); await playing(1);
    await closeQueue();
    await page.goto(base + '/songs'); await text(songs[0].title).click(); await playing(1);
    await label('Open player').click(); await label('Open Up Next').waitFor();
    await text('Existing public lyrics, hydrated safely.').waitFor(); assert.ok(details.includes('/songs/1/'));
    await label('Pause song').click(); await openQueue();
    assert.deepEqual(await titles(), songs.slice(1).map(s => s.title));
    assert.equal(await label(`Remove from queue: ${songs[0].title}`).count(), 0, 'Current entry cannot be removed');
    await label(`Move up: ${songs[2].title}`).click();
    assert.deepEqual(await titles(), [songs[2].title, songs[1].title, songs[3].title]);
    await label(`Play next: ${songs[3].title}`).click();
    assert.deepEqual(await titles(), [songs[3].title, songs[2].title, songs[1].title]);
    await label(`Remove from queue: ${songs[2].title}`).click();
    assert.deepEqual(await titles(), [songs[3].title, songs[1].title]);
    assert.equal(await currentId(), '1');
    assert.equal(await page.evaluate(() => window.audios.length), 1, 'Queue edits do not restart audio');
    await closeQueue(); await text('More').click();
    await label('Add to Queue').evaluate(el => { el.click(); el.click(); }); await text('Added to queue.').waitFor();
    await page.waitForTimeout(400); await label('Add to Queue').click();
    await label('Play Next').click(); await text('Playing next.').waitFor();
    await label('Close song actions').click(); await openQueue();
    assert.equal(await rows().count(), 5, 'Rapid add guarded; intentional duplicate retained');
    const entryIds = await rows().evaluateAll(nodes => nodes.map(n => n.dataset.testid));
    assert.equal(new Set(entryIds).size, 5);
    const expected = await titles(); assert.deepEqual(expected, [songs[0].title, songs[3].title, songs[1].title, songs[0].title, songs[0].title]);
    await rows().first().getByLabel(`Play queued ${songs[0].title}`, { exact: true }).click(); await playing(1);
    assert.equal(await page.evaluate(() => window.audios.length), 2, 'Selecting duplicate restarts its own entry');
    await endSong(); await playing(4);
    assert.deepEqual(await titles(), [songs[1].title, songs[0].title, songs[0].title], 'Natural completion follows visible order while queue open');
    await label('Pause current song').click();
    const lastRemove = rows().last().getByLabel(`Remove from queue: ${songs[0].title}`, { exact: true });
    await lastRemove.scrollIntoViewIfNeeded();
    const remove = await lastRemove.boundingBox();
    assert.ok(remove.height >= 44 && remove.y + remove.height <= height, 'Last row actions remain reachable');
    await page.getByTestId('up-next-list').evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: path.join(artifacts, `queue-${width}.png`) });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await closeQueue(); await label('Shuffle').click(); await openQueue();
    const shuffled = await titles(); assert.equal(shuffled.length, 3);
    const first = shuffled[0], selectedId = first === songs[1].title ? 2 : 1;
    await closeQueue(); await label('Next').evaluate(el => { el.click(); el.click(); }); await playing(selectedId);
    await openQueue(); assert.deepEqual(await titles(), shuffled.slice(1)); await closeQueue();
    await label('Previous').click(); await playing(4);
    await label('Shuffle').click();
    await label('Repeat Off').click(); await label('Repeat All').click();
    await endSong(); await page.waitForTimeout(500); await playing(4);
    assert.ok(await page.evaluate(() => window.audios.at(-1).currentTime < 2));
    await label('Repeat One').click(); await openQueue();
    await rows().last().getByLabel(`Play queued ${songs[0].title}`, { exact: true }).click(); await playing(1);
    await endSong(); await page.waitForFunction(() => window.audios.at(-1).ended && window.audios.at(-1).paused);
    assert.equal(await rows().count(), 0);
    await label('Play current song').click(); await playing(1);
    await closeQueue(); await label('Repeat Off').click();
    const beforeAll = await page.evaluate(() => window.audios.length);
    await endSong(); await page.waitForFunction(count => window.audios.length > count, beforeAll); await playing(1);
    await label('Pause song').click();
    await text('More').click(); await label('Like').click();
    for (const s of ['Create Account', 'Log In', 'Keep Listening']) await text(s).waitFor();
    await text('Keep Listening').click();
    await text('More').click(); await label('Add to Playlist').click(); await text('Keep Listening').click();
    await text('More').click(); await label('Share').click(); await label('Share song link').click();
    assert.ok((await page.evaluate(() => window.shared.url)).endsWith('/song/1'));
    await text('More').click(); await label('Go to Artist').click(); await page.waitForURL('**/artist/11');
    assert.deepEqual(writes.filter(p => !p.endsWith('/play/')), []);
    // Direct shared song starts a single-item queue, not the catalog.
    await page.goto(base + '/song/3'); await label('Play shared song').click(); await playing(3);
    await openQueue(); assert.equal(await rows().count(), 0); await closeQueue();
    await endSong(); await page.waitForFunction(() => window.audios.at(-1).ended);
    // Recently Played contains compact data; public hydration restores lyrics.
    await page.goto(base + '/library'); await page.getByRole('tab', { name: 'Recently Played', exact: true }).click();
    await text(songs[2].title).first().click(); await label('Open player').click();
    await text('Existing public lyrics, hydrated safely.').waitFor();
    if (width === 390) {
      await page.evaluate(listener => {
        localStorage.setItem('teso_tunes_auth_token', 'queue-test-only');
        localStorage.setItem('teso_tunes_auth_listener', JSON.stringify(listener));
      }, listener);
      async function source(route, choose, expected) {
        await page.goto(base + route); await choose();
        if (await label('Open player').count()) await label('Open player').click();
        await label('Pause song').click();
        await openQueue(); assert.deepEqual(await titles(), expected.map(id => songs[id - 1].title), route); await closeQueue();
      }
      await source('/songs', async () => {
        await page.getByPlaceholder('Search songs or artists').fill('Queue Song 3');
        await text(songs[2].title).click();
      }, []);
      await source('/search', async () => {
        await page.getByPlaceholder('Find songs, artists, genres').fill('Queue Song 2');
        await text(songs[1].title).click();
      }, []);
      await source('/artist/11', async () => { await text(songs[1].title).click(); }, [3, 4]);
      await source('/playlist/9', async () => { await text(songs[2].title).click(); }, [1, 4]);
      await source('/library', async () => {
        await page.getByRole('tab', { name: 'Liked Songs', exact: true }).click();
        await text(songs[0].title).click();
      }, [3]);
      await source('/', async () => { await page.getByTestId('home-new').getByText(songs[3].title, { exact: true }).click(); }, [3, 2, 1]);
      const recent = [songs[1], songs[0]].map(({ id, title, artist, artist_name, audio_file }) => ({ id, title, artist, artist_name, audio_file }));
      await page.evaluate(recent => localStorage.setItem('teso_tunes_recently_played', JSON.stringify(recent)), recent);
      await source('/library', async () => {
        await page.getByRole('tab', { name: 'Recently Played', exact: true }).click(); await text(songs[1].title).click();
      }, [1]);
      await text('Existing public lyrics, hydrated safely.').waitFor();
      await page.evaluate(recent => localStorage.setItem('teso_tunes_recently_played', JSON.stringify(recent)), recent);
      await source('/', async () => { await page.getByTestId('home-recent').getByText(songs[1].title, { exact: true }).click(); }, [1]);
      console.log('PASS actual source entry points: Home section, Continue Listening, Search, filtered Browse, Artist, Playlist order, liked collection, compact Recently Played');
    }
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}x${height}: guest queue, duplicates/rapid guards, reorder/remove/select, natural end/stop, repeat all/one, visible shuffle/history, menus/prompts/share/artist, single shared song, recent lyrics, layout`);
  } catch (e) {
    await page.screenshot({ path: path.join(artifacts, `FAIL-${width}.png`), fullPage: true }).catch(() => {});
    console.error({ width, errors, url: page.url(), audio: await page.evaluate(() => window.audios?.map(a => ({ src: a.src, time: a.currentTime, duration: a.duration, paused: a.paused, ended: a.ended, seeking: a.seeking }))) }); throw e;
  } finally { await context.close(); }
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try { for (const [w,h] of [[320,568],[360,800],[390,844],[768,1024],[1280,900]]) await run(browser,w,h); }
  finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

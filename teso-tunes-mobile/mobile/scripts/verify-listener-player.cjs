// Production web export, isolated catalog, real browser-decoded WAV audio. No production writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(process.argv[2] || 'dist-listener-review');
const artifacts = path.join(os.tmpdir(), 'tesohub-listener-review');
fs.mkdirSync(artifacts, { recursive: true });
const server = http.createServer((req, res) => {
  let file = path.resolve(root, `.${decodeURIComponent(new URL(req.url, 'http://localhost').pathname)}`);
  if (!file.startsWith(root + path.sep)) file = path.join(root, 'index.html');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
  res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png', '.ttf': 'font/ttf' }[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
const wav = Buffer.alloc(44 + 8000 * 20 * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
for (let i = 0; i < 160000; i++) wav.writeInt16LE(Math.round(Math.sin(i / 8000 * Math.PI * 440) * 100), 44 + i * 2);
const songs = [1, 2, 3].map(id => ({ id, title: `Player Test ${id}`, artist: 11, artist_name: 'Test Artist', status: 'published', release_date: '2026-01-01', play_count: 10, like_count: 5, cover_image: '', audio_file: `https://audio.example.test/${id}.wav` }));

async function run(browser, width, height) {
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
  const calls = [], errors = [];
  let slow = false, fail = false;
  await context.addInitScript(() => {
    localStorage.setItem('tesohub_music_onboarding_v1', 'completed');
    window.audios = [];
    const NativeAudio = window.Audio;
    window.Audio = function (...args) { const audio = new NativeAudio(...args); window.audios.push(audio); return audio; };
  });
  await context.route('**/api/**', route => {
    const url = new URL(route.request().url()), endpoint = url.pathname.replace(/^.*\/api/, '');
    calls.push(`${route.request().method()} ${endpoint}${url.search}`);
    const send = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (endpoint === '/platform-status/') return send({ maintenance_mode: false });
    if (endpoint === '/songs/') return send(songs);
    if (/^\/songs\/\d+\/$/.test(endpoint)) return send(songs[Number(endpoint.split('/')[2]) - 1]);
    if (endpoint === '/artists/') return send([]);
    if (endpoint === '/genres/') return send(['Akogo']);
    return send({});
  });
  await context.route('https://audio.example.test/**', async route => {
    if (slow) await new Promise(resolve => setTimeout(resolve, 1800));
    if (fail) return route.fulfill({ status: 503, body: '' }).catch(() => {});
    const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: 'audio/wav', headers: { 'accept-ranges': 'bytes', ...(range ? { 'content-range': `bytes ${start}-${end}/${wav.length}` } : {}) }, body: wav.subarray(start, end + 1) }).catch(() => {});
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const base = `http://127.0.0.1:${server.address().port}`;
  const active = () => page.evaluate(() => { const a = window.audios.at(-1); return { time: a.currentTime, paused: a.paused, ended: a.ended }; });
  const slider = page.getByLabel('Song progress', { exact: true });
  async function tap(ratio) {
    await slider.scrollIntoViewIfNeeded(); const b = await slider.boundingBox();
    await page.mouse.click(b.x + b.width * ratio, b.y + b.height / 2);
  }
  try {
    await page.goto(base + '/player?id=1');
    await slider.waitFor();
    // Browser autoplay may require one explicit gesture on a direct link.
    await page.waitForFunction(() => window.audios.length > 0);
    if ((await active()).paused) await page.getByLabel('Play song', { exact: true }).click();
    await page.waitForFunction(() => window.audios.at(-1).currentTime > 0.4);
    await page.getByLabel('Pause song', { exact: true }).click();
    assert.equal((await active()).paused, true);
    await tap(0.4); assert.ok(Math.abs((await active()).time - 8) < 0.5);
    await page.waitForTimeout(400); assert.ok(Math.abs((await active()).time - 8) < 0.5, 'Paused seek must stay at target');
    const b = await slider.boundingBox();
    await page.mouse.move(b.x + b.width * 0.4, b.y + b.height / 2); await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.7, b.y + b.height / 2, { steps: 10 });
    assert.ok(Number(await slider.getAttribute('aria-valuenow')) > 13, 'Scrub previews before release');
    assert.ok((await active()).time < 9, 'Preview does not repeatedly seek the engine');
    await page.mouse.up(); assert.ok(Math.abs((await active()).time - 14) < 0.5);
    await slider.press('Home'); assert.ok((await active()).time < 0.1);
    await slider.press('ArrowRight'); assert.ok(Math.abs((await active()).time - 5) < 0.2);
    await page.getByLabel('Play song', { exact: true }).click();
    await tap(0.05); await page.waitForTimeout(300); assert.ok((await active()).time >= 1 && (await active()).time < 2);
    await page.getByLabel('Pause song', { exact: true }).click();
    for (let i = 0; i < 6; i++) await page.getByLabel(i % 2 ? 'Pause song' : 'Play song', { exact: true }).click();
    assert.equal((await active()).paused, true, 'Rapid toggles leave audio paused');
    await page.screenshot({ path: path.join(artifacts, `player-${width}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByLabel('Next', { exact: true }).click();
    await page.getByText('Player Test 2', { exact: true }).waitFor();
    await page.waitForFunction(() => window.audios.at(-1).currentTime > 0.1);
    assert.equal(await page.evaluate(() => window.audios.filter(a => !a.paused).length), 1);
    await page.getByLabel('Previous', { exact: true }).click();
    await page.getByText('Player Test 1', { exact: true }).waitFor();
    await page.waitForFunction(() => window.audios.at(-1).duration === 20);
    await tap(0.99);
    await page.waitForFunction(() => window.audios.at(-1).ended);
    await page.getByLabel('Play song', { exact: true }).click();
    await page.waitForFunction(() => !window.audios.at(-1).paused && window.audios.at(-1).currentTime < 2);
    if (width === 390) {
      await page.getByLabel('Repeat', { exact: true }).click();
      await tap(0.99); await page.waitForTimeout(800);
      assert.ok((await active()).time < 2 && !(await active()).paused, 'Repeat restarts actual audio');
      await page.getByLabel('Repeat', { exact: true }).click();
      await page.getByLabel('Shuffle', { exact: true }).click();
      await page.getByLabel('Next', { exact: true }).click();
      assert.ok(await page.getByText(/Player Test [23]/, { exact: true }).count());
      await page.getByLabel('Shuffle', { exact: true }).click();
      slow = true;
      await page.getByLabel('Next', { exact: true }).click();
      await page.getByLabel('Pause song', { exact: true }).click();
      await page.waitForTimeout(2300); assert.equal((await active()).paused, true, 'Pause during loading must stick');
      slow = false; fail = true;
      await page.getByLabel('Next', { exact: true }).click();
      await page.getByText('Could not play this song. Please try again.', { exact: true }).waitFor();
      fail = false;
      await page.getByText('Retry', { exact: true }).click();
      await page.waitForFunction(() => window.audios.at(-1).currentTime > 0.2);
    }
    await page.goto(base);
    await page.getByTestId('home-recent').waitFor();
    await page.reload(); await page.getByTestId('home-recent').waitFor();
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}x${height}: actual audio, pause/resume, tap/drag/keyboard seek, rapid taps, next/previous, end/replay, history/reload, layout${width === 390 ? ', repeat/shuffle, loading pause, error/retry' : ''}`);
  } catch (error) {
    await page.screenshot({ path: path.join(artifacts, `failure-${width}.png`), fullPage: true }).catch(() => {});
    console.error({ width, errors, url: page.url() }); throw error;
  } finally { await context.close(); }
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-quic'] });
  try { for (const [w, h] of [[320,568],[360,800],[390,844],[768,1024],[1280,900]]) await run(browser, w, h); }
  finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });

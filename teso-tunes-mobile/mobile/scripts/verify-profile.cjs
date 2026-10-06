// Isolated acceptance checks: every API request is intercepted; no production writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const root = path.resolve(process.argv[2] || 'dist-profile-review');
const artifacts = path.join(require('node:os').tmpdir(), 'tesohub-profile-review');
fs.mkdirSync(artifacts, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png', '.ttf': 'font/ttf' };
const server = http.createServer((req, res) => {
  let file = path.resolve(root, `.${decodeURIComponent(new URL(req.url, 'http://localhost').pathname)}`);
  if (file !== root && !file.startsWith(root + path.sep)) return res.writeHead(403).end();
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

async function verify(browser, width, height) {
  const account = { id: 701, name: 'Profile Listener', email: 'profile@example.test', phone: '+256700000001', role: 'listener', liked_song_ids: [1], followed_artist_ids: [11] };
  const calls = [], errors = [];
  let failSave = false;
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
  await context.addInitScript(account => {
    if (localStorage.getItem('profile_seeded')) return;
    localStorage.setItem('profile_seeded', '1');
    localStorage.setItem('teso_tunes_auth_token', 'test-only-token');
    localStorage.setItem('teso_tunes_auth_listener', JSON.stringify(account));
    localStorage.setItem('tesohub_music_onboarding_v1', 'completed');
  }, account);
  await context.route('**/api/**', async route => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname.replace(/^.*\/api/, '');
    calls.push(`${request.method()} ${endpoint}`);
    const send = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (endpoint === '/auth/me/') {
      if (request.method() === 'PUT') {
        await new Promise(resolve => setTimeout(resolve, 400));
        if (failSave) return send({ detail: 'Those login details are already used.' }, 409);
        Object.assign(account, request.postDataJSON());
      }
      return send({ listener: account });
    }
    if (endpoint === '/auth/logout/') {
      await new Promise(resolve => setTimeout(resolve, 400));
      return send({ logged_out: true });
    }
    if (endpoint === '/platform-status/') return send({ maintenance_mode: false });
    if (endpoint === '/support/help-center/') return send({ categories: { listener: ['Account / Login', 'Other'], artist: ['Artist Profile', 'Other'] }, articles: [] });
    if (endpoint === '/artist-applications/me/') return send({ application: account.artist_application || null });
    if (endpoint === '/artist-studio/dashboard/') return send({ artist: { id: 11, name: 'Profile Artist' }, follower_count: 10 });
    return send([]);
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(10000);
  const base = process.env.VERIFY_BASE_URL || `http://127.0.0.1:${server.address().port}`;
  const label = name => page.getByLabel(name, { exact: true }).filter({ visible: true });
  const text = name => page.getByText(name, { exact: true }).filter({ visible: true });
  async function shot(name) {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: no horizontal overflow`);
    await page.screenshot({ path: path.join(artifacts, `${name}-${width}.png`), fullPage: true });
  }
  try {
    await page.goto(`${base}/profile`);
    await text('Profile Listener').waitFor();
    for (const name of ['Edit Profile', 'Settings', 'Log out']) await label(name).waitFor();
    assert.equal(await page.getByPlaceholder('Profile name').count(), 0);
    assert.equal(await text('USER 701').count(), 0);
    for (const name of ['Liked Songs', 'Following Artists', 'Taste', 'Downloads', 'Recently Played']) assert.equal(await text(name).count(), 0);
    await shot('profile');
    await label('Edit Profile').evaluate(el => { el.click(); el.click(); });
    await page.waitForURL('**/profile/edit');
    await label('Profile name').fill('P');
    await label('Save Changes').click();
    await text('Enter your profile name.').waitFor();
    assert.equal(calls.filter(call => call === 'PUT /auth/me/').length, 0);
    await label('Profile name').fill('Edited Listener');
    await label('Email').fill(''); await label('Phone').fill('');
    await label('Save Changes').click();
    await text('Enter an email or phone number.').waitFor();
    await label('Email').fill('edited@example.test'); await label('Phone').fill('+256700000002');
    // A short browser viewport checks scroll reachability, not a native keyboard.
    await page.setViewportSize({ width, height: 330 });
    await label('Phone').scrollIntoViewIfNeeded();
    let bounds = await label('Phone').boundingBox();
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 330);
    await label('Save Changes').scrollIntoViewIfNeeded();
    bounds = await label('Save Changes').boundingBox();
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 330);
    await shot('edit-short-viewport');
    await page.setViewportSize({ width, height });
    page.once('dialog', dialog => dialog.dismiss());
    await label('Back').click();
    assert.ok(page.url().endsWith('/profile/edit'));
    assert.equal(await label('Profile name').inputValue(), 'Edited Listener');
    failSave = true;
    await label('Save Changes').click();
    await text('Those login details are already used.').waitFor();
    assert.equal(account.name, 'Profile Listener');
    failSave = false;
    await label('Save Changes').evaluate(el => { el.click(); el.click(); });
    await text('Saving...').waitFor();
    await text('Profile saved.').waitFor();
    assert.equal(calls.filter(call => call === 'PUT /auth/me/').length, 2, 'One failed request and one successful request, no double submit');
    assert.equal(account.name, 'Edited Listener');
    assert.equal(account.email, 'edited@example.test');
    assert.equal(account.phone, '+256700000002');
    await shot('edit-profile');
    await label('Back').click();
    await text('Edited Listener').waitFor();
    await label('Edit Profile').click();
    await label('Profile name').fill('Unsaved Listener');
    page.once('dialog', dialog => dialog.accept());
    await label('Back').click();
    await page.waitForURL('**/profile');
    await text('Edited Listener').waitFor();
    await label('Settings').click();
    await page.waitForURL('**/settings');
    await text('Version 1.0.6').waitFor();
    await text('Background playback is managed by your browser and device.').waitFor();
    assert.equal(await page.getByRole('switch').count(), 0);
    await shot('settings');
    await label('Account information').click();
    await label('Profile name').waitFor();
    assert.equal(await label('Profile name').inputValue(), 'Edited Listener');
    await label('Back').click();
    await label('Request account deletion').click();
    await page.waitForURL('**/support/new*');
    assert.equal(await page.getByPlaceholder('Subject').inputValue(), 'Account deletion request');
    await text('Account / Login').waitFor();
    assert.equal(calls.filter(call => call === 'POST /support/tickets/').length, 0, 'Deletion entry must not submit automatically');
    for (const [role, status, expected] of [['artist_pending', 'pending', 'Under Review'], ['listener', 'pending', 'Under Review'], ['listener', 'rejected', 'Application Rejected'], ['listener', 'changes_requested', 'Application Needs Changes'], ['artist', 'approved', 'Artist Studio']]) {
      account.role = role; account.artist_application = { status, review_reason: 'Please correct the artist name.' };
      await page.goto(`${base}/profile`);
      await text(expected).last().waitFor();
      if (['rejected', 'changes_requested'].includes(status)) {
        await text('Please correct the artist name.').waitFor();
        await label('Edit or reapply').click();
        await page.waitForURL('**/artist-application');
      }
      if (role === 'artist') {
        await label('Open Artist Studio').click();
        await text('Profile Artist').waitFor();
        await page.goto(`${base}/settings`);
        await label('Request account deletion').click();
        await text('Other').waitFor();
      }
    }
    account.role = 'listener'; account.artist_application = null;
    await page.goto(`${base}/profile`);
    await label('Open Artist Application').click();
    await page.waitForURL('**/artist-application');
    await page.goto(`${base}/profile`);
    await label('Open Help and Support').click(); await text('Get Help').waitFor();
    await page.goto(`${base}/profile`);
    await label('Log out').evaluate(el => { el.click(); el.click(); });
    await text('Make TesoHub yours').waitFor();
    assert.equal(calls.filter(call => call === 'POST /auth/logout/').length, 1);
    assert.equal(await page.evaluate(() => localStorage.getItem('teso_tunes_auth_token')), null);
    for (const name of ['Settings', 'Edit Profile', 'Log out', 'Become an Artist']) assert.equal(await text(name).count(), 0);
    assert.equal(await page.getByPlaceholder('Profile name').count(), 0);
    await shot('guest-profile');
    await text('Create Account').click(); await page.getByPlaceholder('Profile name').waitFor();
    await text('Log In').click(); await page.getByPlaceholder('Email or phone').waitFor();
    await label('Open Help and Support').click(); await text('Get Help').waitFor();
    await text('My Support Requests').click(); await text('Make TesoHub yours').waitFor();
    for (const destination of ['/profile/edit', '/settings']) {
      await page.goto(base + destination);
      await text('Make TesoHub yours').or(text('No music available yet')).waitFor();
      assert.equal(await label('Save Changes').count(), 0, 'Guest cannot open account controls directly');
    }
    assert.deepEqual(account.liked_song_ids, [1]); assert.deepEqual(account.followed_artist_ids, [11]);
    assert.deepEqual(errors, []);
    console.log(`PASS Profile/Edit/Settings ${width}x${height}: validation, failed save, duplicate guards, discard/cancel, identity sync, all artist states, support/deletion handoff, guest gates, logout, no overflow`);
  } catch (error) {
    await page.screenshot({ path: path.join(artifacts, `failure-${width}.png`), fullPage: true });
    console.error((await page.locator('body').innerText()).slice(-3000));
    throw error;
  } finally { await context.close(); }
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await require(process.env.PLAYWRIGHT_MODULE || 'playwright').chromium.launch({ channel: 'msedge', headless: true });
    for (const [width, height] of [[320, 568], [360, 800], [390, 844], [768, 1024], [1280, 900]]) await verify(browser, width, height);
    console.log(`Screenshots: ${artifacts}`);
  } finally { await browser?.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

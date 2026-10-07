const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const root = 'https://api.github.com/repos/Gidra256/teso-music-app';
const workflow = '/actions/workflows/assemble-existing-apk.yml';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

(async () => {
  assert.ok(process.argv.includes('--dispatch'), 'Explicit --dispatch required');
  const credential = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  const token = credential.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9);
  assert.ok(token);
  async function api(path, method = 'GET', body) {
    const r = await fetch(root + path, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) });
    assert.ok(r.ok, `GitHub ${method} ${path}: HTTP ${r.status}`);
    return r.status === 204 ? null : r.json();
  }
  const assets = await api('/releases/405581379/assets?per_page=100');
  const apk = fs.readFileSync('C:/Users/HP/Downloads/application-7d0ae182-fb29-47a0-8297-c548f30f7276.apk');
  assert.equal(hash(apk), '26c5a12153a6e761a62063832b1334df948a0a832e20ae327bf3eb7903a9b0b0');
  for (let index = 0; index < Math.ceil(apk.length / 1048576); index++) {
    const asset = assets.find(item => item.name === `tesohub-v1.0.6-transfer-part-${String(index).padStart(3, '0')}.bin`);
    const bytes = apk.subarray(index * 1048576, Math.min(apk.length, (index + 1) * 1048576));
    assert.equal(asset?.state, 'uploaded', `Missing part ${index}`);
    assert.equal(asset.size, bytes.length); assert.equal(asset.digest, `sha256:${hash(bytes)}`);
  }
  let run = (await api(workflow + '/runs?event=workflow_dispatch&branch=master&per_page=5')).workflow_runs.find(item => ['queued', 'in_progress', 'waiting', 'pending'].includes(item.status));
  const since = Date.now() - 5000;
  if (!run) {
    await api(workflow + '/dispatches', 'POST', { ref: 'master' });
    console.log('All 77 parts verified; dispatched GitHub-side assembly (not an APK build).');
  }
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 15000));
    if (!run) run = (await api(workflow + '/runs?event=workflow_dispatch&branch=master&per_page=5')).workflow_runs.find(item => Date.parse(item.created_at) >= since);
    if (!run) continue;
    run = await api(`/actions/runs/${run.id}`);
    if (attempt % 4 === 0) console.log(`Assembly: ${run.status}; ${run.html_url}`);
    if (run.status === 'completed') {
      assert.equal(run.conclusion, 'success', `Assembly failed: ${run.html_url}`);
      const final = (await api('/releases/405581379/assets?per_page=100')).find(item => item.name === 'TesoHub-Music-Android-v1.0.6.apk');
      assert.equal(final?.digest, `sha256:${hash(apk)}`);
      assert.equal(final.size, apk.length);
      console.log(JSON.stringify({ run: run.html_url, conclusion: run.conclusion, sha256: hash(apk), size: final.size, draftRetained: true }));
      return;
    }
  }
  throw new Error('Assembly still pending; inspect workflow status before dispatching again');
})().catch(error => { console.error(error.message); process.exitCode = 1; });

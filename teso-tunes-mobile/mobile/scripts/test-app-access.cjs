const assert = require("node:assert/strict");
const { test } = require("node:test");
const { appActions, androidIntent, createInstallController, manualInstallHelp, openAndroidDownload, safeDownloadUrl, DISMISS_KEY, DISMISS_MS, INSTALLED_KEY } = require("../src/utils/appAccess");

test("APK download is explicitly confirmed, cancel is safe, and future Play links have accurate wording", () => {
  const messages = [], opened = [];
  let accept = false;
  const win = { confirm: message => { messages.push(message); return accept; }, location: { assign: url => opened.push(url) } };
  const apk = "https://github.com/Gidra256/teso-music-app/releases/download/test/app.apk";
  assert.equal(openAndroidDownload(win, apk), false);
  assert.deepEqual(opened, []);
  assert.match(messages[0], /Android Early Access APK.*not Google Play/);
  accept = true;
  assert.equal(openAndroidDownload(win, apk), true);
  assert.deepEqual(opened, [apk]);
  openAndroidDownload(win, "https://play.google.com/store/apps/details?id=com.tesotunes.app");
  assert.equal(messages.at(-1), "Open TesoHub Music on Google Play?");
  assert.equal(openAndroidDownload(win, "javascript:bad"), false);
  assert.equal(opened.length, 2);
});

test("separate Android download/open from web installation without guessing native installation", () => {
  const base = { navigator: { userAgent: "Android" }, state: { installed: false, dismissed: false, installable: true } };
  const labels = options => appActions({ ...base, ...options }).actions.map(a => a.label);
  assert.deepEqual(labels({}), ["Open App", "Install Web App"]);
  const apk = "https://github.com/Gidra256/teso-music-app/releases/download/test/app.apk";
  assert.deepEqual(labels({ downloadUrl: apk }), ["Get Android App", "Open App", "Install Web App"]);
  assert.deepEqual(labels({ downloadUrl: "javascript:bad" }), ["Open App", "Install Web App"]);
  assert.deepEqual(labels({ navigator: { userAgent: "iPhone" }, state: {}, downloadUrl: apk }), ["Add to Home Screen"]);
  assert.deepEqual(labels({ navigator: { userAgent: "desktop" }, downloadUrl: apk }), ["Install Web App"]);
  assert.deepEqual(labels({ state: { installed: true } }), []);
  assert.deepEqual(labels({ state: { installed: true }, path: "/song/37" }), ["Open App"]);
  assert.deepEqual(labels({ state: { dismissed: true } }), []);
  assert.deepEqual(labels({ state: { dismissed: true }, path: "/song/37" }), ["Open App"]);
  assert.deepEqual(labels({ compact: true, state: {}, downloadUrl: apk }), ["Get Android App"]);
  assert.deepEqual(labels({ compact: true, state: {} }), ["Open App"]);
  const play = "https://play.google.com/store/apps/details?id=com.tesotunes.app";
  assert.deepEqual(labels({ downloadUrl: play }), ["Get Android App", "Open App", "Install Web App"]);
});

function browser(seed = {}, standalone = false) {
  const handlers = {};
  const storage = new Map(Object.entries(seed));
  const media = { matches: standalone, addEventListener: (name, fn) => { handlers.media = fn; }, removeEventListener() {} };
  const win = {
    navigator: {}, localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    matchMedia: () => media, addEventListener: (name, fn) => { handlers[name] = fn; }, removeEventListener: name => delete handlers[name],
  };
  return { controller: createInstallController(win), handlers, media, storage };
}
test("exact Android content and HTTPS fallback; no arbitrary routes", () => {
  for (const kind of ["song", "artist", "playlist", "release"]) {
    const link = androidIntent(`/${kind}/37`, "https://tesohub-music-pwa.onrender.com");
    assert.ok(link.startsWith(`intent://${kind}/37#Intent;scheme=tesohubmusic;package=com.tesotunes.app;`));
    assert.ok(link.includes(encodeURIComponent(`https://tesohub-music-pwa.onrender.com/${kind}/37?app_fallback=1`)));
  }
  assert.ok(!androidIntent("/song/1;evil", "https://example.test").includes("evil"));
});
test("no fake download URL and no unsafe schemes or embedded credentials", () => {
  for (const url of ["", "javascript:alert(1)", "http://example.test", "https://user:secret@example.test"]) assert.equal(safeDownloadUrl(url), "");
  assert.equal(safeDownloadUrl("https://example.test/app.apk"), "https://example.test/app.apk");
});
test("deferred browser event, one prompt per event, acceptance hides install", async () => {
  const b = browser(); let calls = 0; let prevented = false;
  b.handlers.beforeinstallprompt({ preventDefault: () => { prevented = true; }, prompt: async () => { calls++; }, userChoice: Promise.resolve({ outcome: "accepted" }) });
  assert.equal(b.controller.getSnapshot().installable, true);
  const first = b.controller.install(); await b.controller.install(); await first;
  assert.equal(prevented, true); assert.equal(calls, 1); assert.equal(b.controller.getSnapshot().installed, true);
});
test("dismissal lasts seven days across reloads, expired dismissal allows prompt", async () => {
  const b = browser();
  b.handlers.beforeinstallprompt({ preventDefault() {}, prompt: async () => {}, userChoice: Promise.resolve({ outcome: "dismissed" }) });
  await b.controller.install();
  const deadline = Number(b.storage.get(DISMISS_KEY));
  assert.ok(deadline > Date.now() + DISMISS_MS - 1000);
  assert.equal(browser({ [DISMISS_KEY]: String(deadline) }).controller.getSnapshot().dismissed, true);
  assert.equal(browser({ [DISMISS_KEY]: String(Date.now() - 1) }).controller.getSnapshot().dismissed, false);
});
test("standalone, appinstalled, cross-tab state, reinstallation and prompt failure", async () => {
  assert.equal(browser({}, true).controller.getSnapshot().installed, true);
  const b = browser(); b.handlers.appinstalled(); assert.equal(b.controller.getSnapshot().installed, true);
  b.handlers.beforeinstallprompt({ preventDefault() {}, prompt: async () => { throw new Error("denied"); } });
  assert.equal(b.controller.getSnapshot().installed, false);
  await b.controller.install(); assert.ok(b.controller.getSnapshot().error); assert.equal(b.controller.getSnapshot().pending, false);
  b.storage.set(INSTALLED_KEY, "yes"); b.handlers.storage(); assert.equal(b.controller.getSnapshot().installed, true);
  b.controller.dispose(); assert.equal(b.handlers.beforeinstallprompt, undefined);
});
test("manual installation guidance covers iOS, Android and desktop", () => {
  assert.match(manualInstallHelp({ userAgent: "iPhone" }), /Share.*Add to Home Screen/);
  assert.match(manualInstallHelp({ userAgent: "Android" }), /browser menu/);
  assert.match(manualInstallHelp({ userAgent: "desktop" }), /Add to Dock/);
});

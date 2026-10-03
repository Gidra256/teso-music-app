const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");
const { transformSync } = require("@babel/core");
const source = fs.readFileSync(require.resolve("../src/utils/shareLinks.js"), "utf8");
const code = transformSync(source, { configFile: false, babelrc: false, plugins: ["@babel/plugin-transform-modules-commonjs"] }).code;
const song = { id: 37, status: "published", title: "Test Song", artist_name: "Test Artist", audio_file: "PRIVATE-AUDIO" };
const url = "https://teso-music-app.onrender.com/song/37";
function load(os, options = {}) {
  const calls = [], events = [], exports = {};
  vm.runInNewContext(code, {
    exports, navigator: options.navigator || {}, document: options.document,
    console: { log: (_label, data) => events.push(data) },
    require: id => id === "react-native" ? {
      Platform: { OS: os }, Share: { sharedAction: "sharedAction", share: async data => { calls.push(data); return { action: options.action || "sharedAction" }; } },
    } : { SHARE_BASE_URL: "https://teso-music-app.onrender.com" },
  });
  return { ...exports, calls, events };
}
test("Android and iOS use native share without sharing private audio", async () => {
  for (const os of ["android", "ios"]) {
    const helper = load(os);
    await helper.shareSongLink(song);
    const payload = helper.calls[0];
    assert.ok(JSON.stringify(payload).includes(url));
    assert.ok(payload.message.includes("Listen to Test Song by Test Artist on TesoHub Music"));
    assert.ok(!JSON.stringify(payload).includes("PRIVATE-AUDIO"));
    assert.equal(helper.events[0].name, "song_shared");
    assert.equal(helper.events[0].platform, os);
    assert.ok(helper.events[0].timestamp);
  }
});
test("native dismissal is not logged as a successful share", async () => {
  const helper = load("ios", { action: "dismissedAction" });
  assert.equal((await helper.shareSongLink(song)).dismissed, true);
  assert.equal(helper.events.length, 0);
});
test("web share receives title, text and canonical URL", async () => {
  let payload;
  const helper = load("web", { navigator: { share: async data => { payload = data; } } });
  await helper.shareSongLink(song);
  assert.equal(payload.url, url);
  assert.equal(helper.events[0].method, "web_share");
});
test("web cancellation and failures never emit successful analytics", async () => {
  for (const name of ["AbortError", "NotAllowedError"]) {
    const helper = load("web", { navigator: { share: async () => { throw Object.assign(new Error("cancelled"), { name }); } } });
    if (name === "AbortError") assert.equal((await helper.shareSongLink(song)).dismissed, true);
    else await assert.rejects(helper.shareSongLink(song));
    assert.equal(helper.events.length, 0);
  }
});
test("unsupported Web Share copies only the canonical URL", async () => {
  let copied;
  const helper = load("web", { navigator: { canShare: () => false, clipboard: { writeText: async value => { copied = value; } } } });
  assert.equal((await helper.shareSongLink(song)).method, "copy_link");
  assert.equal(copied, url);
  assert.equal(helper.events.length, 1);
});
test("failed copying does not claim success", async () => {
  const helper = load("web", { navigator: { clipboard: { writeText: async () => { throw new Error("denied"); } } } });
  await assert.rejects(helper.copySongLink(song));
  assert.equal(helper.events.length, 0);
});
test("unpublished songs and invalid identifiers cannot be shared", async () => {
  const helper = load("android");
  for (const status of ["hidden", "draft", "under_review", "removed", undefined]) await assert.rejects(helper.shareSongLink({ ...song, status }));
  for (const id of [null, 0, "../secret", "9007199254740993"]) assert.throws(() => helper.songShareUrl(id));
  assert.equal(helper.calls.length, 0);
});

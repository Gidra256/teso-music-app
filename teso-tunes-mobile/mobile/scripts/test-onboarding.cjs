const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");
const { transformSync } = require("@babel/core");
const exportsUnderTest = {};
const source = fs.readFileSync(require.resolve("../src/utils/onboarding.js"), "utf8");
const code = transformSync(source, { configFile: false, babelrc: false, plugins: ["@babel/plugin-transform-modules-commonjs"] }).code;
vm.runInNewContext(code, { exports: exportsUnderTest });
const { shouldOfferOnboarding, hasPreviousListeningAccount, ONBOARDING_HISTORY_KEYS } = exportsUnderTest;
const fresh = { routeName: "Home", completed: false, existingUser: false, dismissed: false, hasSong: false };

test("fresh local state offers onboarding on Home only", () => {
  assert.equal(shouldOfferOnboarding(fresh), true);
  for (const routeName of [null, "Song", "ArtistDetail", "Player", "Release", "Profile", "Support", "Search", "Library"]) {
    assert.equal(shouldOfferOnboarding({ ...fresh, routeName }), false);
  }
});
test("completed, skipped, existing-account and playing sessions do not block listening", () => {
  for (const completed of ["completed", "skipped", "existing-user"]) assert.equal(shouldOfferOnboarding({ ...fresh, completed }), false);
  for (const key of ["existingUser", "dismissed", "hasSong"]) assert.equal(shouldOfferOnboarding({ ...fresh, [key]: true }), false);
});
test("previous accounts and genuine listening history are recognized without device-id races", () => {
  assert.equal(hasPreviousListeningAccount([["teso_tunes_auth_listener", '{"id":12}']]), true);
  for (const key of ONBOARDING_HISTORY_KEYS.slice(1)) assert.equal(hasPreviousListeningAccount([[key, "[37]"]]), true);
  assert.equal(hasPreviousListeningAccount(ONBOARDING_HISTORY_KEYS.map(key => [key, null])), false);
  assert.equal(hasPreviousListeningAccount([["teso_tunes_recently_played", "[]"]]), false);
  assert.equal(hasPreviousListeningAccount([["teso_tunes_auth_listener", "corrupt"]]), false);
});

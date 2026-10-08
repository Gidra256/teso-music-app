// Outside the mobile deployment root: test changes must not trigger a PWA release.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const mobileRequire = createRequire(path.resolve(__dirname, '../mobile/package.json'));
const babel = mobileRequire('@babel/core');
const testModules = process.env.LISTENER_TEST_MODULES || path.join(require('node:os').tmpdir(), 'tesohub-listener-test-tools/node_modules');
const React = require(path.join(testModules, 'react'));
const renderer = require(path.join(testModules, 'react-test-renderer'));
global.IS_REACT_ACT_ENVIRONMENT = true;
const { act } = renderer;
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness() {
  const storage = new Map(), api = {}, modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const source = fs.readFileSync(file, 'utf8');
    const result = babel.transformSync(source, {filename:file, configFile:false, babelrc:false,
      plugins:[[mobileRequire.resolve('@babel/plugin-transform-react-jsx'), {runtime:'automatic'}], mobileRequire.resolve('@babel/plugin-transform-modules-commonjs')]});
    const module = {exports:{}}; modules.set(file, module);
    const mockRequire = id => {
      if (id === 'react') return React;
      if (id === 'react/jsx-runtime') return require(path.join(testModules, 'react/jsx-runtime'));
      if (id === 'react-native') return {View:'View', Text:'Text', TouchableOpacity:'TouchableOpacity', StyleSheet:{create:styles=>styles}};
      if (id === 'react-native-safe-area-context') return {useSafeAreaInsets:()=>({top:0,bottom:0})};
      if (id === '@react-native-async-storage/async-storage') return {getItem:async key=>storage.get(key)??null, setItem:async (key,value)=>{storage.set(key,value);}};
      if (id.endsWith('/musicApi')) return api;
      return load(path.resolve(path.dirname(file), `${id}.js`));
    };
    vm.runInThisContext(`(function(require,module,exports){${result.code}\n})`, {filename:file})(mockRequire,module,module.exports);
    return module.exports;
  }
  return {api, module:load(path.resolve(__dirname,'../mobile/src/context/EngagementContext.js'))};
}

for (const spec of [
  {field:'follower_count', add:'followArtistAction', remove:'unfollowArtistAction', apiAdd:'followArtist', apiRemove:'unfollowArtist', get:'getArtistFollowerCount', active:'isArtistFollowed', state:'followed'},
  {field:'like_count', add:'toggleSongLike', remove:'toggleSongLike', apiAdd:'likeSong', apiRemove:'unlikeSong', get:'getSongLikeCount', active:'isSongLiked', state:'liked'},
]) for (const initial of [0,7]) test(`${spec.field}, initial ${initial}: optimistic/server/rollback/reload`, async () => {
  const {api,module} = harness();
  let current,tree,resolve,pending,calls=0;
  const entity = {id:91,[spec.field]:initial};
  api[spec.apiAdd] = () => {calls++;return new Promise(done=>{resolve=done;});};
  api[spec.apiRemove] = async () => ({[spec.state]:false,[spec.field]:initial});
  function Reader() {current=module.useEngagement();return null;}
  async function mount() {
    await act(async()=>{tree=renderer.create(React.createElement(module.EngagementProvider,null,React.createElement(Reader)));await flush();});
  }
  await mount();
  try {
    await act(async()=>{pending=current[spec.add](entity);await flush();});
    assert.equal(current[spec.get](entity),initial+1);
    assert.equal(current[spec.active](91),true);
    await act(async()=>{await current[spec.add](entity);});
    assert.equal(calls,1,'No duplicate request while pending');
    await act(async()=>{resolve({[spec.state]:true,[spec.field]:initial+1});await pending;});
    assert.equal(current[spec.get]({...entity,[spec.field]:0}),initial+1,'Stale object cannot reset acknowledged count');
    await act(async()=>{await current[spec.remove](entity);});
    assert.equal(current[spec.get](entity),initial,'Removal restores N, including actual zero');
    assert.equal(current[spec.active](91),false);
    api[spec.apiAdd]=async()=>{throw Error('Synthetic request failure');};
    await act(async()=>{try{await current[spec.add](entity);}catch{}});
    assert.equal(current[spec.get](entity),initial,'Count rollback');
    assert.equal(current[spec.active](91),false,'Membership rollback');
    api[spec.apiAdd]=async()=>({[spec.state]:true,[spec.field]:23});
    await act(async()=>{await current[spec.add](entity);});
    assert.equal(current[spec.get](entity),23,'Authoritative server count wins');
    await act(async()=>tree.unmount());
    await mount();
    assert.equal(current[spec.get]({...entity,[spec.field]:23}),23,'Reload uses fresh catalog count');
    assert.equal(current[spec.active](91),true,'Membership cache survives remount');
  } finally {await act(async()=>tree.unmount());}
});

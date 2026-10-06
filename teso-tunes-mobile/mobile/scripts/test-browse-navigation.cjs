const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const app = fs.readFileSync(require.resolve('../App.js'), 'utf8');

test('Songs is inside the existing tabs, not a standalone root screen', () => {
  const tabs = app.slice(app.indexOf('function MainTabs()'), app.indexOf('function CreateScreenPlaceholder'));
  const root = app.slice(app.indexOf('function RootStack'), app.indexOf('function AppNavigator'));
  assert.match(tabs, /name="Songs"[\s\S]*?tabBarButton: \(\) => null/);
  assert.doesNotMatch(root, /name="Songs"/);
  assert.match(app, /initialRouteName: "Home",[\s\S]*?Songs: "songs"/);
});

test('native tab Back returns to Home and preserves the mounted Browse route', async () => {
  const { TabRouter, CommonActions } = await import('@react-navigation/routers');
  const router = TabRouter({ backBehavior: app.match(/backBehavior="([^"]+)"/)[1], initialRouteName: 'Home' });
  const options = { routeNames: ['Home', 'Search', 'Library', 'Create', 'Songs'], routeParamList: {}, routeGetIdList: {} };
  let state = router.getInitialState(options);
  const browseKey = state.routes.find(route => route.name === 'Songs').key;
  const navigate = name => { state = router.getStateForAction(state, CommonActions.navigate(name), options); };
  navigate('Songs');
  state = router.getStateForAction(state, CommonActions.goBack(), options);
  assert.equal(state.routes[state.index].name, 'Home');
  navigate('Songs'); navigate('Library');
  state = router.getStateForAction(state, CommonActions.goBack(), options);
  assert.equal(state.routes[state.index].name, 'Songs');
  assert.equal(state.routes[state.index].key, browseKey, 'Stable route retains screen-local filters and list');
  const linked = router.getRehydratedState({ stale: true, index: 1, routes: [{ name: 'Home' }, { name: 'Songs' }] }, options);
  // A cold Android deep link has no tab history; Songs supplies its Home fallback.
  const back = router.getStateForAction(linked, CommonActions.goBack(), options)
    || router.getStateForAction(linked, CommonActions.navigate('Home'), options);
  assert.equal(back.routes[back.index].name, 'Home', 'Direct link has a safe Home destination');
});

test('Android hardware Back only intercepts a history-free Browse screen and cleans up', async () => {
  const path = require('node:path');
  const modules = path.join(require('node:os').tmpdir(), 'tesohub-listener-test-tools/node_modules');
  const React = require(path.join(modules, 'react'));
  const { act, create } = require(path.join(modules, 'react-test-renderer'));
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const filename = require.resolve('../src/screens/SongsScreen.js');
  const code = require('@babel/core').transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, configFile: false, babelrc: false,
    plugins: [[require.resolve('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }], require.resolve('@babel/plugin-transform-modules-commonjs')],
  }).code;
  let handler, removed = false, canGoBack = false, tree;
  const calls = [];
  const navigation = { canGoBack: () => canGoBack, navigate: name => calls.push(name), goBack: () => calls.push('back') };
  const exports = {};
  const requireMock = id => {
    if (id === 'react') return React;
    if (id === 'react/jsx-runtime') return require(path.join(modules, 'react/jsx-runtime'));
    if (id === '@react-navigation/native') return { useFocusEffect: callback => React.useEffect(callback, [callback]) };
    if (id === 'react-native') return {
      ActivityIndicator: 'ActivityIndicator', FlatList: 'FlatList', Text: 'Text', TouchableOpacity: 'TouchableOpacity', View: 'View',
      Platform: { OS: 'android' }, StyleSheet: { create: value => value }, useWindowDimensions: () => ({ width: 390 }),
      BackHandler: { addEventListener: (_name, callback) => { handler = callback; return { remove: () => { removed = true; } }; } },
    };
    if (id === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
    if (id === '@expo/vector-icons') return { Ionicons: 'Ionicons' };
    if (id.endsWith('/musicApi')) return { getSongs: async () => [] };
    if (id.endsWith('/theme')) return { colors: {}, spacing: { page: 18 } };
    return { __esModule: true, default: () => null };
  };
  require('node:vm').runInThisContext(`(function(require,exports){${code}\n})`)(requireMock, exports);
  await act(async () => { tree = create(React.createElement(exports.default, { navigation })); });
  try {
    assert.equal(handler(), true); assert.deepEqual(calls, ['Home']);
    canGoBack = true;
    assert.equal(handler(), false); assert.deepEqual(calls, ['Home']);
    tree.root.findByProps({ accessibilityLabel: 'Go back' }).props.onPress();
    assert.deepEqual(calls, ['Home', 'back']);
  } finally { await act(async () => tree.unmount()); }
  assert.equal(removed, true);
});

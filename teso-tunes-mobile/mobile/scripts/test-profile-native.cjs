// Native component logic with isolated adapters, not an emulator/keyboard test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
const modulesPath = process.env.LISTENER_TEST_MODULES || path.join(require('node:os').tmpdir(), 'tesohub-listener-test-tools/node_modules');
const React = require(path.join(modulesPath, 'react'));
const { act, create } = require(path.join(modulesPath, 'react-test-renderer'));
global.IS_REACT_ACT_ENVIRONMENT = true;

async function verify(os) {
  let enabled = true, calls = 0, release, navigationGuard;
  const account = { id: 1, name: 'Native Listener', email: 'native@example.test', phone: '' };
  const savedPayloads = [];
  const cache = new Map();
  const navigation = { canGoBack: () => true, goBack() {}, navigate() {}, dispatch() {} };
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const source = fs.readFileSync(file, 'utf8');
    const { code } = babel.transformSync(source, { filename: file, babelrc: false, configFile: false, plugins: [[require.resolve('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }], require.resolve('@babel/plugin-transform-modules-commonjs')] });
    const module = { exports: {} }; cache.set(file, module);
    function mockRequire(id) {
      if (id === 'react') return React;
      if (id === 'react/jsx-runtime') return require(path.join(modulesPath, 'react/jsx-runtime'));
      if (id === 'react-native') return { ...Object.fromEntries(['ActivityIndicator', 'Image', 'KeyboardAvoidingView', 'ScrollView', 'Switch', 'Text', 'TextInput', 'TouchableOpacity', 'View'].map(name => [name, name])), Platform: { OS: os }, StyleSheet: { create: value => value }, Keyboard: { dismiss() {} }, Alert: { alert() {} } };
      if (id === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
      if (id === '@expo/vector-icons') return { Ionicons: 'Icon' };
      if (id === '@react-navigation/native') return { CommonActions: { reset: value => value }, usePreventRemove: (prevent, callback) => { navigationGuard = { prevent, callback }; } };
      if (id.endsWith('/AuthContext')) return { useAuth: () => ({ listener: account, updateAccount: async payload => { savedPayloads.push(payload); await new Promise(resolve => { release = resolve; }); Object.assign(account, payload); return account; } }) };
      if (id.endsWith('/PlayerContext')) return { usePlayer: () => ({ backgroundPlaybackEnabled: enabled, setBackgroundPlaybackEnabled: async value => { calls++; await new Promise(resolve => { release = resolve; }); enabled = value; } }) };
      if (id.endsWith('.json')) return require(path.resolve(path.dirname(file), id));
      if (id.endsWith('.png')) return 1;
      return load(path.resolve(path.dirname(file), id + '.js'));
    }
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(mockRequire, module, module.exports);
    return module.exports;
  }
  const Settings = load(path.resolve('src/screens/SettingsScreen.js')).default;
  let tree;
  await act(async () => { tree = create(React.createElement(Settings, { navigation })); });
  const switchNode = tree.root.findByType('Switch');
  await act(async () => { switchNode.props.onValueChange(false); switchNode.props.onValueChange(false); });
  assert.equal(calls, 1);
  assert.equal(tree.root.findByType('Switch').props.disabled, true);
  await act(async () => release());
  assert.equal(enabled, false);
  await act(async () => tree.unmount());
  const Edit = load(path.resolve('src/screens/EditProfileScreen.js')).default;
  await act(async () => { tree = create(React.createElement(Edit, { navigation })); });
  assert.equal(tree.root.findByType('KeyboardAvoidingView').props.behavior, os === 'ios' ? 'padding' : 'height');
  assert.equal(tree.root.findByType('KeyboardAvoidingView').props.enabled, true);
  assert.equal(tree.root.findByType('ScrollView').props.keyboardShouldPersistTaps, 'handled');
  assert.equal(tree.root.findAllByType('SafeAreaView').length, 1);
  const field = label => tree.root.findAllByType('TextInput').find(node => node.props.accessibilityLabel === label);
  await act(async () => field('Profile name').props.onChangeText('Updated Native'));
  assert.equal(navigationGuard.prevent, true);
  const button = () => tree.root.findAllByType('TouchableOpacity').find(node => node.props.accessibilityLabel === 'Save Changes');
  await act(async () => { field('Phone').props.onSubmitEditing(); button().props.onPress(); });
  assert.equal(savedPayloads.length, 1);
  assert.equal(button().props.disabled, true);
  assert.equal(field('Profile name').props.editable, false);
  await act(async () => release());
  assert.equal(account.name, 'Updated Native');
  assert.equal(navigationGuard.prevent, false);
  await act(async () => tree.unmount());
  console.log(`PASS ${os}: background preference + duplicate guard, keyboard-aware scrolling/safe area, Done submits once, fields locked while saving, unsaved guard clears after save`);
}
(async () => { await verify('android'); await verify('ios'); })().catch(error => { console.error(error); process.exitCode = 1; });

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const babel = require('@babel/core');

const modulesPath = process.env.LISTENER_TEST_MODULES || path.join(os.tmpdir(), 'tesohub-listener-test-tools/node_modules');
const React = require(path.join(modulesPath, 'react'));
const {act, create} = require(path.join(modulesPath, 'react-test-renderer'));
global.IS_REACT_ACT_ENVIRONMENT = true;

const agreementState = {
  agreement: {id: 7, version: '2026-v1', title: 'Artist Agreement', content: '# Agreement\n\nSynthetic content.', content_sha256: 'a'.repeat(64), required: true},
  acceptance: null,
  enforcement_mode: 'all_artists',
  required: true,
};

function transpile(file) {
  return babel.transformSync(fs.readFileSync(file, 'utf8'), {
    filename: file,
    babelrc: false,
    configFile: false,
    plugins: [[require.resolve('@babel/plugin-transform-react-jsx'), {runtime: 'automatic'}], require.resolve('@babel/plugin-transform-modules-commonjs')],
  }).code;
}

function nativeMock(platform) {
  return {
    ...Object.fromEntries(['ActivityIndicator','Image','KeyboardAvoidingView','Modal','RefreshControl','ScrollView','Switch','Text','TextInput','TouchableOpacity','View'].map(key=>[key,key])),
    Alert: {alert() {}},
    Platform: {OS: platform},
    StyleSheet: {create:value=>value},
  };
}

function load(file, mocks) {
  const code = transpile(file);
  const mockRequire = (id) => {
    if (id === 'react') return React;
    if (id === 'react/jsx-runtime') return require(path.join(modulesPath, 'react/jsx-runtime'));
    if (id in mocks) return mocks[id];
    for (const [suffix, value] of Object.entries(mocks)) if (id.endsWith(suffix)) return value;
    throw new Error(`Unexpected import: ${id}`);
  };
  const context = vm.createContext({require:mockRequire,module:{exports:{}},exports:{},FormData,Blob,File,window:{alert(){}},console,fetch});
  context.exports = context.module.exports;
  vm.runInContext(code, context);
  return context.module.exports.default;
}

for (const platform of ['android','web']) test(`${platform}: agreement panel exposes reading and explicit acceptance`, async () => {
  const file = path.resolve(__dirname, '../src/components/ArtistAgreementPanel.js');
  const changes=[];
  const Panel=load(file, {
    'react-native': nativeMock(platform),
    'react-native-safe-area-context': {SafeAreaView:'SafeAreaView'},
    '@expo/vector-icons': {Ionicons:'Icon'},
    '/theme': {colors:{background:'#000',surface:'#111',border:'#222',primary:'#0ff',text:'#fff',softText:'#ccc',elevated:'#222',success:'#0f0'},spacing:{page:18}},
  });
  let tree;
  await act(async()=>{tree=create(React.createElement(Panel,{state:agreementState,accepted:false,onAcceptedChange:value=>changes.push(value),onOpenAgreement(){},onCloseAgreement(){},visible:true}));});
  assert.ok(tree.root.findByProps({accessibilityLabel:'Read Artist Agreement'}));
  const checkbox=tree.root.findByProps({accessibilityLabel:'Accept Artist Agreement'});
  assert.equal(checkbox.props.accessibilityState.checked,false);
  await act(async()=>checkbox.props.onPress());assert.deepEqual(changes,[true]);
  assert.equal(tree.root.findByType('Modal').props.visible,true);
  assert.ok(tree.root.findAllByType('Text').some(node=>String(node.props.children).includes('SHA-256')));
  await act(async()=>tree.unmount());
});

test('artist application loads the current agreement and keeps consent separate from genuine confirmation', async () => {
  const file=path.resolve(__dirname,'../src/screens/ArtistApplicationScreen.js');
  let captured;
  const AgreementPanel=props=>{captured=props;return React.createElement('AgreementPanel',props);};
  const Screen=load(file,{
    'react-native':nativeMock('android'),
    'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},
    '@expo/vector-icons':{Ionicons:'Icon'},
    'expo-image-picker':{launchImageLibraryAsync:async()=>({canceled:true})},
    '/musicApi':{getCurrentArtistAgreement:async()=>agreementState,submitArtistApplication:async()=>{}},
    '/ArtistAgreementPanel':AgreementPanel,
    '/GenreSelector':'GenreSelector',
    '/AuthContext':{useAuth:()=>({listener:{name:'Fixture',email:'fixture@example.invalid',phone:'0700'},refreshAccount:async()=>{}})},
    '/theme':{colors:{},spacing:{page:18}},
  });
  let tree;await act(async()=>{tree=create(React.createElement(Screen,{navigation:{goBack(){}}}));});
  assert.equal(captured.state.agreement.version,'2026-v1');assert.equal(captured.accepted,false);
  await act(async()=>captured.onAcceptedChange(true));assert.equal(captured.accepted,true);
  const source=fs.readFileSync(file,'utf8');
  assert.match(source,/body\.append\("agreement_accepted", "true"\)/);
  assert.match(source,/body\.append\("agreement_version", agreementState\.agreement\.version\)/);
  assert.match(source,/genuine_confirmed/);
  assert.doesNotMatch(source,/body\.append\("(?:listener_id|accepted_at|content_sha256)"/);
  await act(async()=>tree.unmount());
});

test('legacy artist remains in Studio but upload is gated until the current agreement is accepted', async () => {
  const file=path.resolve(__dirname,'../src/screens/ArtistStudioScreen.js');
  const navigations=[];let acceptedVersion='';let captured;
  const acceptedState={...agreementState,acceptance:{id:9,agreement_version:'2026-v1',accepted_at:'2026-10-12T10:00:00.000Z'}};
  const AgreementPanel=props=>{captured=props;return React.createElement('AgreementPanel',props);};
  const Screen=load(file,{
    'react-native':nativeMock('android'),
    'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},
    '@react-navigation/native':{useFocusEffect:callback=>React.useEffect(callback,[callback])},
    '@expo/vector-icons':{Ionicons:'Icon'},
    '/musicApi':{BACKEND_CONNECTION_ERROR:'Offline',getArtistStudioDashboard:async()=>({artist:{id:1,name:'Legacy Artist'},artist_agreement:agreementState}),getArtistStudioReleases:async()=>[],acceptCurrentArtistAgreement:async version=>{acceptedVersion=version;return acceptedState;}},
    '/ArtistAgreementPanel':AgreementPanel,
    '/MiniPlayer':()=>null,
    '/SongShareModal':()=>null,
    '/theme':{colors:{},spacing:{page:18}},
    '/format':{formatFollowers:String,formatPlays:String},
  });
  let tree;await act(async()=>{tree=create(React.createElement(Screen,{navigation:{navigate:(...args)=>navigations.push(args),goBack(){}}}));});
  const upload=tree.root.findAllByType('TouchableOpacity').find(node=>node.findAllByType('Text').some(text=>text.props.children==='Upload Music'));
  await act(async()=>upload.props.onPress());assert.equal(navigations.length,0);assert.equal(captured.visible,true);
  await act(async()=>captured.onAccept());assert.equal(acceptedVersion,'2026-v1');assert.ok(captured.state.acceptance);
  const activeUpload=tree.root.findAllByType('TouchableOpacity').find(node=>node.findAllByType('Text').some(text=>text.props.children==='Upload Music'));
  await act(async()=>activeUpload.props.onPress());assert.equal(navigations[0][0],'ReleaseUpload');
  await act(async()=>tree.unmount());
});

test('Android and PWA profiles show safe artist verification status without Admin evidence', () => {
  const source=fs.readFileSync(path.resolve(__dirname,'../src/screens/ProfileScreen.js'),'utf8');
  for(const label of [
    'Identity verification not completed',
    'Identity verification pending',
    'Identity verified',
    'Identity verification needs more information',
  ]) assert.ok(source.includes(label));
  assert.doesNotMatch(source,/verification_notes|social_challenge_code_hash|verification_reviewed_by/);
});

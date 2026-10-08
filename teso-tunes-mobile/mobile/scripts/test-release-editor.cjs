// Actual screen components with isolated native/network adapters; no production requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const babel = require('@babel/core');
const modulesPath = process.env.LISTENER_TEST_MODULES || path.join(require('node:os').tmpdir(), 'tesohub-listener-test-tools/node_modules');
const React = require(path.join(modulesPath, 'react'));
const {act, create} = require(path.join(modulesPath, 'react-test-renderer'));
global.IS_REACT_ACT_ENVIRONMENT = true;
const fixture = {id:71,title:'Needs correction',artist:1,status:'rejected',genre:'Gospel',language:'Ateso',release_date:'2099-01-01',rights_confirmed:true,review_reason:'Correct credits and cover',audio_file:'/api/releases/71/audio/',cover_image:'https://fixture.invalid/art.png',updated_at:'2026-10-08T10:00:00.000Z'};

function harness(os, records=[{...fixture}]) {
  const puts=[],posts=[],nav=[];let complete,fail=false,pickAudio=null,pickCover=null;
  class FormData {constructor(){this.values=new Map();}append(k,v){this.values.set(k,v);}get(k){return this.values.get(k);}}
  const navigation={navigate:(...args)=>nav.push(args),goBack:()=>nav.push(['back'])};
  const api={getArtistStudioDashboard:async()=>({artist:{id:1,name:'Fixture Artist'},latest_release:records[0]}),getArtistStudioReleases:async()=>records,
    createArtistStudioRelease:async body=>{posts.push(body);},updateArtistStudioRelease:async(id,body)=>{puts.push({id,body});if(fail)throw Error('Synthetic save failure');await new Promise(resolve=>{complete=resolve;});}};
  function load(name){
    const file=path.resolve(__dirname,`../src/screens/${name}.js`);
    const {code}=babel.transformSync(fs.readFileSync(file,'utf8'),{filename:file,babelrc:false,configFile:false,plugins:[[require.resolve('@babel/plugin-transform-react-jsx'),{runtime:'automatic'}],require.resolve('@babel/plugin-transform-modules-commonjs')]});
    const mockRequire=id=>{
      if(id==='react')return React;
      if(id==='react/jsx-runtime')return require(path.join(modulesPath,'react/jsx-runtime'));
      if(id==='react-native')return {...Object.fromEntries(['ActivityIndicator','Image','KeyboardAvoidingView','RefreshControl','ScrollView','Switch','Text','TextInput','TouchableOpacity','View'].map(key=>[key,key])),Platform:{OS:os},StyleSheet:{create:v=>v},Alert:{alert(){}}};
      if(id==='react-native-safe-area-context')return {SafeAreaView:'SafeAreaView'};
      if(id==='@react-navigation/native')return {useFocusEffect:fn=>React.useEffect(fn,[fn])};
      if(id==='@expo/vector-icons')return {Ionicons:'Icon'};
      if(id==='expo-document-picker')return {getDocumentAsync:async()=>({assets:pickAudio?[pickAudio]:[],canceled:!pickAudio})};
      if(id==='expo-image-picker')return {launchImageLibraryAsync:async()=>({assets:pickCover?[pickCover]:[],canceled:!pickCover})};
      if(id.endsWith('/musicApi'))return api;
      if(id.endsWith('/theme'))return {colors:{},spacing:{page:16}};
      if(id.endsWith('/format'))return {formatFollowers:String,formatPlays:String};
      if(id.endsWith('/GenreSelector'))return 'GenreSelector';
      if(id.endsWith('/MiniPlayer')||id.endsWith('/SongShareModal'))return ()=>null;
      throw Error(`Unexpected import: ${id}`);
    };
    const ctx=vm.createContext({require:mockRequire,module:{exports:{}},FormData,Blob,File,window:{alert(){}},console});ctx.exports=ctx.module.exports;vm.runInContext(code,ctx);return ctx.module.exports.default;
  }
  return {load,navigation,puts,posts,nav,done:()=>complete(),fail:value=>{fail=value;},pick:(audio,cover)=>{pickAudio=audio;pickCover=cover;}};
}
const button=(tree,label)=>tree.root.findAllByType('TouchableOpacity').find(node=>node.findAllByType('Text').some(t=>t.props.children===label));

for(const os of ['android','ios','web'])test(`${os}: rejected Studio reason -> editor -> one same-ID PUT, retained media, review submission`,async()=>{
  const h=harness(os),Studio=h.load('ArtistStudioScreen'),Editor=h.load('ReleaseUploadScreen');let tree;
  await act(async()=>{tree=create(React.createElement(Studio,{navigation:h.navigation}));});
  assert.ok(tree.root.findAllByType('Text').some(node=>node.props.children===fixture.review_reason));
  await act(async()=>button(tree,'Edit & Resubmit').props.onPress());assert.equal(h.nav[0][0],'ReleaseUpload');assert.equal(h.nav[0][1].releaseId,71);
  await act(async()=>tree.unmount());
  await act(async()=>{tree=create(React.createElement(Editor,{navigation:h.navigation,route:{params:{releaseId:71}}}));});
  assert.equal(tree.root.findByProps({placeholder:'Song title'}).props.value,fixture.title);
  assert.ok(tree.root.findAllByType('Text').some(node=>node.props.children==='Existing audio retained'));
  assert.equal(tree.root.findByType('KeyboardAvoidingView').props.enabled,os!=='web');
  assert.equal(tree.root.findByType('ScrollView').props.keyboardShouldPersistTaps,'handled');
  await act(async()=>tree.root.findByProps({placeholder:'Song title'}).props.onChangeText('Corrected title'));
  let saving;await act(async()=>{const submit=button(tree,'Resubmit for Review');saving=submit.props.onPress();submit.props.onPress();});
  assert.equal(h.puts.length,1);assert.equal(h.posts.length,0);assert.equal(h.puts[0].id,71);
  assert.equal(h.puts[0].body.get('title'),'Corrected title');assert.equal(h.puts[0].body.get('submit_for_review'),'true');assert.equal(h.puts[0].body.get('expected_updated_at'),fixture.updated_at);
  assert.equal(h.puts[0].body.get('audio_upload'),undefined);assert.equal(h.puts[0].body.get('cover_upload'),undefined);
  await act(async()=>{h.done();await saving;});assert.equal(h.nav.at(-1)[0],'back');await act(async()=>tree.unmount());
});

test('unavailable/other artist or newly submitted releases cannot open an editable form',async()=>{
  for(const records of [[],[{...fixture,status:'under_review'}]]){
    const h=harness('web',records),Editor=h.load('ReleaseUploadScreen');let tree;
    await act(async()=>{tree=create(React.createElement(Editor,{navigation:h.navigation,route:{params:{releaseId:71}}}));});
    assert.equal(tree.root.findAllByType('TextInput').length,0);assert.ok(button(tree,'Retry'));assert.equal(h.puts.length,0);await act(async()=>tree.unmount());
  }
});

for(const os of ['android','web'])test(`${os}: optional replacement uploads, Save Changes and retry after error`,async()=>{
  const h=harness(os),Editor=h.load('ReleaseUploadScreen');let tree;
  await act(async()=>{tree=create(React.createElement(Editor,{navigation:h.navigation,route:{params:{releaseId:71}}}));});
  const audio={name:'replacement.mp3',uri:'file:///synthetic-audio',mimeType:'audio/mpeg',file:new File(['synthetic'],'replacement.mp3',{type:'audio/mpeg'})};
  const cover={name:'replacement.png',uri:'file:///synthetic-cover',mimeType:'image/png',file:new File(['synthetic'],'replacement.png',{type:'image/png'})};h.pick(audio,cover);
  await act(async()=>tree.root.findByProps({accessibilityLabel:'Replace audio file'}).props.onPress());await act(async()=>tree.root.findByProps({accessibilityLabel:'Replace cover artwork'}).props.onPress());
  h.fail(true);await act(async()=>button(tree,'Save Changes').props.onPress());assert.ok(tree.root.findAllByType('Text').some(node=>node.props.children==='Synthetic save failure'));
  h.fail(false);let pending;await act(async()=>{pending=button(tree,'Save Changes').props.onPress();});
  assert.equal(h.puts[1].body.get('submit_for_review'),'false');assert.ok(h.puts[1].body.get('audio_upload'));assert.ok(h.puts[1].body.get('cover_upload'));assert.equal(h.posts.length,0);
  await act(async()=>{h.done();await pending;});await act(async()=>tree.unmount());
});

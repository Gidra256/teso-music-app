import test from 'node:test';
import assert from 'node:assert/strict';
import {applyScopedChanges} from '../scopedChanges.js';

function fixture() {
  const db={};
  for(const name of ['listeners','artists','genres','artistApplications','artistAgreementAcceptances','songs','releases','authTokens','songLikes','artistFollows','playlists','playlistSongs','reports','adminAuditLogs']) db[name]=[];
  db.platformSettings={feature_flags:{}};
  db.songs.push({id:2,artist:1,title:'Example Song',status:'published',removal_reason:'',removed_at:null,
    updated_at:'2026-10-01T00:00:00.000Z',audio_file:'',cover_image:''});
  return db;
}
test('legacy DTO persistence writes song removal reason, date and status together',async()=>{
  const before=fixture(),after=structuredClone(before),calls=[];
  const now='2026-10-14T12:00:00.000Z';
  Object.assign(after.songs[0],{status:'removed',removal_reason:'Copyright complaint',removed_at:now,updated_at:now});
  const client={query:async(sql,values)=>{calls.push({sql,values});return {rowCount:1,rows:[{id:2}]}}};
  const mediaColumns=()=>({objectPath:null,legacyValue:''});
  const reflect=await applyScopedChanges(client,before,after,{mediaColumns,buckets:{audio:'audio',artwork:'artwork'}});
  reflect();
  const updates=calls.filter(call=>call.sql.startsWith('update tesohub_music.songs'));
  assert.equal(updates.length,1);
  assert.match(updates[0].sql,/removal_reason/);
  assert.match(updates[0].sql,/removed_at/);
  assert.match(updates[0].sql,/status/);
  assert.ok(updates[0].values.includes('Copyright complaint'));
  assert.ok(updates[0].values.includes(now));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createSongRemovalStore} from '../songRemovalStore.js';

function fakePool(handler) {
  const calls=[];
  const client={query:async (sql,params=[])=>{
    calls.push({sql:String(sql).trim(),params});
    return handler(String(sql).trim(),params,calls) || {rows:[],rowCount:0};
  },release(){calls.push({sql:'release'})}};
  return {calls,pool:{connect:async()=>client,query:client.query}};
}
function noticeRow(status='scheduled') {
  return {id:4,song_id:12,artist_id:2,song_title:'Example Song',reason:'I no longer wish to distribute this recording',status,
    requested_at:new Date('2026-10-01T00:00:00Z'),due_at:new Date('2026-10-31T00:00:00Z'),
    history:[{event_type:'requested',actor_type:'artist',at:'2026-10-01T00:00:00Z'}]};
}

test('request locks the owned song, inserts a single scheduled notice and event',async()=>{
  const f=fakePool(sql=>{
    if(sql.includes('select s.id,s.title,s.status from tesohub_music.songs s'))return {rows:[{id:12,title:'Example Song',status:'published'}]};
    if(sql.startsWith('insert into tesohub_music.song_removal_requests'))return {rows:[{id:4}]};
    if(sql.includes('as current_song_title'))return {rows:[noticeRow()]};
  });
  const store=createSongRemovalStore(()=>f.pool);
  const result=await store.request({artistId:2,listenerId:7,songId:12,reason:'I no longer wish to distribute this recording'});
  assert.equal(result.request.id,4);
  assert.equal(result.request.title,'Example Song');
  assert.ok(f.calls.some(x=>x.sql.includes('for update') && x.params[1]===2));
  assert.ok(f.calls.some(x=>x.sql.includes('song_removal_events') && x.sql.includes("'requested'")));
  assert.ok(f.calls.some(x=>x.sql==='commit'));
});

test('request rejects an unpublished or already removed song before inserting',async()=>{
  const f=fakePool(sql=>sql.includes('select s.id,s.title,s.status from tesohub_music.songs s')?{rows:[{id:12,title:'X',status:'removed'}]}:undefined);
  const result=await createSongRemovalStore(()=>f.pool).request({artistId:2,listenerId:7,songId:12,reason:'I no longer wish to distribute this recording'});
  assert.equal(result.error,'not_eligible');
  assert.equal(f.calls.some(x=>x.sql.startsWith('insert into')),false);
  assert.ok(f.calls.some(x=>x.sql==='rollback'));
});

test('request refuses duplicate pending notices',async()=>{
  const f=fakePool(sql=>{
    if(sql.includes('select s.id,s.title,s.status from tesohub_music.songs s'))return {rows:[{id:12,title:'X',status:'published'}]};
    if(sql.startsWith('select id from tesohub_music.song_removal_requests'))return {rows:[{id:4}]};
  });
  const result=await createSongRemovalStore(()=>f.pool).request({artistId:2,listenerId:7,songId:12,reason:'I no longer wish to distribute this recording'});
  assert.equal(result.error,'already_scheduled');
  assert.equal(f.calls.some(x=>x.sql.startsWith('insert into')),false);
});

test('cancellation requires the owned scheduled notice and a future deadline',async()=>{
  const f=fakePool(sql=>{
    if(sql.startsWith('select r.* from tesohub_music.song_removal_requests r'))return {rows:[noticeRow()]};
    if(sql.startsWith('update tesohub_music.song_removal_requests'))return {rowCount:1,rows:[{id:4}]};
    if(sql.includes('as current_song_title'))return {rows:[noticeRow('cancelled')]};
  });
  const result=await createSongRemovalStore(()=>f.pool).cancel({artistId:2,requestId:4,listenerId:7});
  assert.equal(result.request.status,'cancelled');
  assert.ok(f.calls.some(x=>x.sql.includes('due_at>now()')));
  assert.ok(f.calls.some(x=>x.sql.includes('song_removal_events') && x.sql.includes("'cancelled'")));
});

test('due/expired notice cannot be cancelled, does not write history',async()=>{
  const f=fakePool(sql=>{
    if(sql.startsWith('select r.* from tesohub_music.song_removal_requests r'))return {rows:[noticeRow()]};
    if(sql.startsWith('update tesohub_music.song_removal_requests'))return {rowCount:0,rows:[]};
  });
  const result=await createSongRemovalStore(()=>f.pool).cancel({artistId:2,requestId:4,listenerId:7});
  assert.equal(result.error,'too_late');
  assert.equal(f.calls.some(x=>x.sql.includes('song_removal_events')),false);
});

test('worker batch marks songs removed and records both event and audit',async()=>{
  const f=fakePool(sql=>{
    if(sql.startsWith('select r.id,r.song_id,r.reason'))return {rows:[{id:4,song_id:12,reason:'Artist requested removal'}]};
  });
  const count=await createSongRemovalStore(()=>f.pool).runDueBatch();
  assert.equal(count,1);
  assert.ok(f.calls.some(x=>x.sql.startsWith('update tesohub_music.songs') && x.params[0]===12));
  assert.ok(f.calls.some(x=>x.sql.includes('for update of r skip locked')));
  assert.ok(f.calls.some(x=>x.sql.includes('song_removal_events') && x.sql.includes("'completed'")));
  assert.ok(f.calls.some(x=>x.sql.includes('admin_audit_logs') && x.sql.includes('scheduled_remove_song')));
  assert.ok(f.calls.some(x=>x.sql==='commit'));
});

test('administrative immediate takedown closes any pending artist notice',async()=>{
  const f=fakePool(sql=>{
    if(sql.startsWith('select r.id from tesohub_music.song_removal_requests'))return {rows:[{id:4}]};
  });
  await createSongRemovalStore(()=>f.pool).completeAfterAdminRemoval(12,'content-moderator');
  assert.ok(f.calls.some(x=>x.sql.includes('song_removal_events') && x.sql.includes("'admin'")));
  assert.ok(f.calls.some(x=>x.sql==='commit'));
});

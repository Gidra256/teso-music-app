// Supabase-backed 30-day artist song-removal requests.
// SQL transactions keep cancellation, due processing and audit history durable.
const queryHead = `
  select r.*, coalesce(s.title, r.song_title) as current_song_title,
         a.name as artist_name,
         coalesce((select jsonb_agg(jsonb_build_object(
           'event_type',e.event_type,'actor_type',e.actor_type,
           'actor_label',e.actor_label,'details',e.details,'at',e.created_at)
           order by e.id)
           from tesohub_music.song_removal_events e where e.request_id=r.id), '[]'::jsonb) as history
  from tesohub_music.song_removal_requests r
  left join tesohub_music.songs s on s.id=r.song_id
  left join tesohub_music.artists a on a.id=r.artist_id`;

function serialize(row) {
  return {
    id: Number(row.id),
    song: row.song_id == null ? null : Number(row.song_id),
    artist: row.artist_id == null ? null : Number(row.artist_id),
    title: row.current_song_title || row.song_title || '',
    artist_name: row.artist_name || '',
    reason: row.reason,
    status: row.status,
    requested_at: row.requested_at?.toISOString?.() || row.requested_at,
    due_at: row.due_at?.toISOString?.() || row.due_at,
    cancelled_at: row.cancelled_at?.toISOString?.() || row.cancelled_at || null,
    completed_at: row.completed_at?.toISOString?.() || row.completed_at || null,
    history: (row.history || []).map(e => ({ ...e, at: e.at?.toISOString?.() || e.at })),
  };
}

export function createSongRemovalStore(getPool) {
  const pool = () => getPool();
  async function getOne(id, client = pool()) {
    const result = await client.query(`${queryHead} where r.id=$1`, [id]);
    return result.rows[0] ? serialize(result.rows[0]) : null;
  }
  async function listForArtist(artistId) {
    const result = await pool().query(`${queryHead} where r.artist_id=$1 order by r.requested_at desc, r.id desc limit 250`, [artistId]);
    return result.rows.map(serialize);
  }
  async function listForAdmin() {
    const result = await pool().query(`${queryHead} order by (r.status='scheduled') desc, r.due_at, r.id desc limit 250`);
    return result.rows.map(serialize);
  }
  async function request({artistId, listenerId, songId, reason}) {
    if (typeof reason !== 'string' || reason.trim().length < 10 || reason.trim().length > 1000)
      return {error:'invalid_reason'};
    const client = await pool().connect();
    try {
      await client.query('begin');
      const songResult = await client.query(
        `select s.id,s.title,s.status from tesohub_music.songs s
          join tesohub_music.artists a on a.id=s.artist_id and a.status='active'
          join tesohub_music.listeners l on l.id=$3 and l.artist_id=a.id and l.role='artist' and l.status='active'
          where s.id=$1 and s.artist_id=$2 for update of s for share of a,l`,
        [songId, artistId, listenerId]);
      const song = songResult.rows[0];
      if (!song) { await client.query('rollback'); return { error:'not_found' }; }
      if (!['published','hidden'].includes(song.status)) {
        await client.query('rollback'); return { error:'not_eligible' };
      }
      const active = await client.query(`select id from tesohub_music.song_removal_requests where song_id=$1 and status='scheduled'`, [songId]);
      if (active.rows.length) { await client.query('rollback'); return { error:'already_scheduled' }; }
      const created = await client.query(
        `insert into tesohub_music.song_removal_requests
          (song_id,artist_id,requested_by_listener_id,song_title,reason)
         values ($1,$2,$3,$4,$5) returning id`,
        [songId,artistId,listenerId,song.title,reason]);
      const id = created.rows[0].id;
      await client.query(`insert into tesohub_music.song_removal_events
        (request_id,event_type,actor_type,actor_label) values ($1,'requested','artist',$2)`, [id,String(listenerId)]);
      await client.query('commit');
      return { request: await getOne(id) };
    } catch (e) {
      await client.query('rollback').catch(() => {});
      if (e.code === '23505') return { error:'already_scheduled' };
      throw e;
    } finally { client.release(); }
  }
  async function cancel({artistId,requestId,listenerId}) {
    const client = await pool().connect();
    try {
      await client.query('begin');
      const result = await client.query(`select r.* from tesohub_music.song_removal_requests r
        join tesohub_music.artists a on a.id=r.artist_id and a.status='active'
        join tesohub_music.listeners l on l.id=$3 and l.artist_id=a.id and l.role='artist' and l.status='active'
        where r.id=$1 and r.artist_id=$2 for update of r`, [requestId,artistId,listenerId]);
      const row = result.rows[0];
      if (!row) { await client.query('rollback'); return { error:'not_found' }; }
      if (row.status !== 'scheduled') { await client.query('rollback'); return {error:'not_pending'}; }
      const changed = await client.query(`update tesohub_music.song_removal_requests
        set status='cancelled',cancelled_at=now(),updated_at=now()
        where id=$1 and status='scheduled' and due_at>now() returning id`, [requestId]);
      if (!changed.rowCount) { await client.query('rollback'); return {error:'too_late'}; }
      await client.query(`insert into tesohub_music.song_removal_events
        (request_id,event_type,actor_type,actor_label) values ($1,'cancelled','artist',$2)`, [requestId,String(listenerId)]);
      await client.query('commit');
      return { request:await getOne(requestId) };
    } catch(e) { await client.query('rollback').catch(() => {}); throw e; }
    finally { client.release(); }
  }
  // Reconcile an Admin's immediate takedown with a scheduled artist notice.
  async function completeAfterAdminRemoval(songId, adminName) {
    const client = await pool().connect();
    try {
      await client.query('begin');
      const result = await client.query(`select r.id from tesohub_music.song_removal_requests r
        join tesohub_music.songs s on s.id=r.song_id
        where r.song_id=$1 and r.status='scheduled' and s.status='removed'
        for update of r`, [songId]);
      for (const row of result.rows) {
        await client.query(`update tesohub_music.song_removal_requests set status='completed',completed_at=now(),updated_at=now() where id=$1`, [row.id]);
        await client.query(`insert into tesohub_music.song_removal_events
          (request_id,event_type,actor_type,actor_label,details)
          values ($1,'completed','admin',$2,'{"early":true}'::jsonb)`, [row.id,adminName || 'admin']);
      }
      await client.query('commit');
    } catch(e) { await client.query('rollback').catch(() => {}); throw e; }
    finally { client.release(); }
  }
  // A dedicated, opt-in worker. SKIP LOCKED avoids duplicate processing across instances.
  async function runDueBatch() {
    const client = await pool().connect();
    try {
      await client.query('begin');
      const result = await client.query(`select r.id,r.song_id,r.reason
        from tesohub_music.song_removal_requests r
        where r.status='scheduled' and r.due_at<=now()
        order by r.due_at,r.id limit 50 for update of r skip locked`);
      for (const row of result.rows) {
        if (row.song_id != null) {
          await client.query(`update tesohub_music.songs
            set status='removed',removal_reason=$2,removed_at=coalesce(removed_at,now()),
                updated_at=now(),is_featured=false
            where id=$1 and status<>'removed'`, [row.song_id,row.reason]);
        }
        await client.query(`update tesohub_music.song_removal_requests
          set status='completed',completed_at=now(),updated_at=now() where id=$1`, [row.id]);
        await client.query(`insert into tesohub_music.song_removal_events
          (request_id,event_type,actor_type,actor_label) values ($1,'completed','system','song-removal-worker')`, [row.id]);
        await client.query(`insert into tesohub_music.admin_audit_logs
          (admin_user,admin_role,action,target_type,target_id,details,reason,created_at)
          values ('song-removal-worker','system','scheduled_remove_song','song',$1,$2::jsonb,$3,now())`,
          [row.song_id,JSON.stringify({request_id:Number(row.id)}),row.reason]);
      }
      await client.query('commit');
      return result.rows.length;
    } catch(e) { await client.query('rollback').catch(() => {}); throw e; }
    finally { client.release(); }
  }
  return {listForArtist,listForAdmin,request,cancel,completeAfterAdminRemoval,runDueBatch};
}

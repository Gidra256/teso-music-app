-- Align identity sequences after importing rows with explicit ids.
-- This changes only sequence counters, not table data.

select setval(
  pg_get_serial_sequence('tesohub_music.listeners', 'id'),
  greatest(coalesce((select max(id) from tesohub_music.listeners), 0), 1),
  coalesce((select max(id) from tesohub_music.listeners), 0) > 0
);

select setval(
  pg_get_serial_sequence('tesohub_music.artists', 'id'),
  greatest(coalesce((select max(id) from tesohub_music.artists), 0), 1),
  coalesce((select max(id) from tesohub_music.artists), 0) > 0
);

select setval(
  pg_get_serial_sequence('tesohub_music.genres', 'id'),
  greatest(coalesce((select max(id) from tesohub_music.genres), 0), 1),
  coalesce((select max(id) from tesohub_music.genres), 0) > 0
);

select setval(
  pg_get_serial_sequence('tesohub_music.artist_applications', 'id'),
  greatest(coalesce((select max(id) from tesohub_music.artist_applications), 0), 1),
  coalesce((select max(id) from tesohub_music.artist_applications), 0) > 0
);

select setval(
  pg_get_serial_sequence('tesohub_music.songs', 'id'),
  greatest(coalesce((select max(id) from tesohub_music.songs), 0), 1),
  coalesce((select max(id) from tesohub_music.songs), 0) > 0
);

select setval(
  pg_get_serial_sequence('tesohub_music.releases', 'id'),
  greatest(coalesce((select max(id) from tesohub_music.releases), 0), 1),
  coalesce((select max(id) from tesohub_music.releases), 0) > 0
);

select setval(
  pg_get_serial_sequence('tesohub_music.song_likes', 'id'),
  greatest(coalesce((select max(id) from tesohub_music.song_likes), 0), 1),
  coalesce((select max(id) from tesohub_music.song_likes), 0) > 0
);

select setval(
  pg_get_serial_sequence('tesohub_music.artist_follows', 'id'),
  greatest(coalesce((select max(id) from tesohub_music.artist_follows), 0), 1),
  coalesce((select max(id) from tesohub_music.artist_follows), 0) > 0
);

select setval(
  pg_get_serial_sequence('tesohub_music.playlists', 'id'),
  greatest(coalesce((select max(id) from tesohub_music.playlists), 0), 1),
  coalesce((select max(id) from tesohub_music.playlists), 0) > 0
);

select setval(
  pg_get_serial_sequence('tesohub_music.playlist_songs', 'id'),
  greatest(coalesce((select max(id) from tesohub_music.playlist_songs), 0), 1),
  coalesce((select max(id) from tesohub_music.playlist_songs), 0) > 0
);

select setval(
  pg_get_serial_sequence('tesohub_music.reports', 'id'),
  greatest(coalesce((select max(id) from tesohub_music.reports), 0), 1),
  coalesce((select max(id) from tesohub_music.reports), 0) > 0
);

select setval(
  pg_get_serial_sequence('tesohub_music.listening_history', 'id'),
  greatest(coalesce((select max(id) from tesohub_music.listening_history), 0), 1),
  coalesce((select max(id) from tesohub_music.listening_history), 0) > 0
);

select setval(
  pg_get_serial_sequence('tesohub_music.admin_audit_logs', 'id'),
  greatest(coalesce((select max(id) from tesohub_music.admin_audit_logs), 0), 1),
  coalesce((select max(id) from tesohub_music.admin_audit_logs), 0) > 0
);

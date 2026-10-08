-- Targeted performance indexes for Supabase-backed API reads and engagement writes.
-- Safe to rerun; does not change application data.

create index if not exists artist_follows_listener_idx
  on tesohub_music.artist_follows (listener_id)
  where listener_id is not null;

create index if not exists artist_follows_artist_idx
  on tesohub_music.artist_follows (artist_id);

create index if not exists artist_follows_device_idx
  on tesohub_music.artist_follows (device_id)
  where nullif(device_id, '') is not null;

create index if not exists song_likes_listener_idx
  on tesohub_music.song_likes (listener_id)
  where listener_id is not null;

create index if not exists song_likes_song_idx
  on tesohub_music.song_likes (song_id);

create index if not exists song_likes_device_idx
  on tesohub_music.song_likes (device_id)
  where nullif(device_id, '') is not null;

create index if not exists playlists_owner_updated_idx
  on tesohub_music.playlists (owner_id, coalesce(updated_at, created_at) desc);

create index if not exists playlist_songs_playlist_position_idx
  on tesohub_music.playlist_songs (playlist_id, position, added_at, id);

create index if not exists playlist_songs_song_idx
  on tesohub_music.playlist_songs (song_id);

create index if not exists songs_artist_status_idx
  on tesohub_music.songs (artist_id, status);

create index if not exists songs_public_sort_idx
  on tesohub_music.songs (status, is_featured desc, play_count desc, title);

create index if not exists artists_status_category_name_idx
  on tesohub_music.artists (status, lower(category), lower(name));

create index if not exists releases_schedule_idx
  on tesohub_music.releases (status, release_date)
  where status = 'scheduled';

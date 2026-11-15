ALTER TABLE tesohub_music.listeners
ADD COLUMN IF NOT EXISTS avatar_url TEXT NOT NULL DEFAULT '';
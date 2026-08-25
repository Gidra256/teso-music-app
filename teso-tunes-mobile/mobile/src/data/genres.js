export const MUSIC_GENRES = [
  "Ateso Traditional",
  "Teso Gospel",
  "Gospel",
  "Afrobeats",
  "Amapiano",
  "Dancehall",
  "Reggae",
  "Hip hop / Rap",
  "R&B",
  "Kadongo Kamu",
  "Cultural / Folk",
  "Instrumental",
  "Other",
  "Not sure",
];

export const GENRES_WITH_OPTIONAL_NOTE = new Set(["Other", "Not sure"]);

export function needsGenreNote(genre) {
  return GENRES_WITH_OPTIONAL_NOTE.has(genre);
}

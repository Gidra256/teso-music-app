import { CATEGORIES } from "./categories";

const names = [
  "Sparo UG",
  "Mr. Tablet UG",
  "Pana Boy",
  "Candy Man",
  "Simple Bullet",
  "Josh Rash",
  "Rody Gavana",
  "Richard Ranking",
  "Yang Maro",
  "Tyra Nana",
  "Lucky Jo",
  "Dan Pro",
  "Angorit Veronica",
  "Amoding Faith",
  "Big Head Man",
];

export const fallbackArtists = names.map((name, index) => ({
  id: index + 1,
  name,
  category: CATEGORIES[index % CATEGORIES.length],
  bio: `${name} carries the Teso sound forward with songs rooted in community, rhythm, faith, and everyday life.`,
  photo: `https://picsum.photos/seed/fallback-artist-${index + 1}/600/600`,
  location: ["Soroti", "Kumi", "Ngora", "Katakwi", "Bukedea"][index % 5],
  is_featured: index < 6,
  follower_count: 230 + index * 41,
  song_count: 3,
}));

export const fallbackSongs = fallbackArtists.flatMap((artist, artistIndex) =>
  ["Akogo Fire", "Teso Love", "Eastern Lights"].map((title, songIndex) => ({
    id: artistIndex * 3 + songIndex + 1,
    artist: artist.id,
    artist_name: artist.name,
    artist_category: artist.category,
    title: `${title}`,
    audio_file: "",
    cover_image: `https://picsum.photos/seed/fallback-song-${artistIndex + 1}-${songIndex + 1}/800/800`,
    genre: ["Teso Fusion", "Afrobeat", "Gospel", "Rap"][songIndex % 4],
    lyrics: `${title}

Verse 1
Teso voices in the morning light
Songs of home carrying through the night
Every drum, every chord, every line
Keeps the rhythm of the people alive

Chorus
Teso tunes, let the music rise
Eastern stories under open skies
Teso tunes, we keep moving strong
This is our home, this is our song`,
    like_count: 18 + artistIndex * 7 + songIndex * 5,
    play_count: 12400 + artistIndex * 2700 + songIndex * 880,
    release_date: `202${4 + (artistIndex % 3)}-0${songIndex + 2}-12`,
    is_featured: artist.is_featured && songIndex === 0,
  }))
);

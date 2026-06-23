from datetime import date

from django.core.management.base import BaseCommand

from music.models import Artist, Song


ARTISTS = [
    ("Sparo UG", Artist.RAPPERS, "Soroti", True),
    ("Mr. Tablet UG", Artist.RAPPERS, "Kumi", True),
    ("Pana Boy", Artist.OTHER_SECULAR, "Ngora", True),
    ("Candy Man", Artist.OTHER_SECULAR, "Soroti", False),
    ("Simple Bullet", Artist.RAPPERS, "Katakwi", False),
    ("Josh Rash", Artist.GOSPEL, "Bukedea", True),
    ("Rody Gavana", Artist.OTHER_SECULAR, "Pallisa", False),
    ("Richard Ranking", Artist.OTHER_SECULAR, "Kaberamaido", True),
    ("Yang Maro", Artist.OTHER_SECULAR, "Soroti", True),
    ("Tyra Nana", Artist.GOSPEL, "Kumi", False),
    ("Lucky Jo", Artist.RAPPERS, "Amuria", False),
    ("Dan Pro", Artist.OTHER_SECULAR, "Ngora", False),
    ("Angorit Veronica", Artist.GOSPEL, "Serere", True),
    ("Amoding Faith", Artist.GOSPEL, "Soroti", False),
    ("Big Head Man", Artist.RAPPERS, "Katakwi", False),
]

SONG_TITLES = [
    ("Aija Teso", "Afrobeat"),
    ("Soroti Nights", "Dancehall"),
    ("Akogo Rhythm", "Teso Fusion"),
]

LYRIC_TEMPLATE = """{title}

Verse 1
From Soroti roads to the village lights
We carry Teso stories through the night
Akogo rings and the people sing
Every home remembers where we begin

Chorus
Teso tunes, let the rhythm rise
Eastern voices under open skies
Teso tunes, we are moving strong
This is our home, this is our song

Verse 2
For the dancers, dreamers, mothers, friends
The music starts and the feeling never ends
Faith and love in a steady sound
Teso hearts keep lifting from the ground"""


class Command(BaseCommand):
    help = "Seed Teso Tunes with official artists and placeholder songs."

    def handle(self, *args, **options):
        for index, (name, category, location, featured) in enumerate(ARTISTS, start=1):
            artist, _ = Artist.objects.update_or_create(
                name=name,
                defaults={
                    "category": category,
                    "location": location,
                    "is_featured": featured,
                    "photo": f"https://picsum.photos/seed/teso-artist-{index}/600/600",
                    "bio": (
                        f"{name} represents the sound and spirit of the Teso region, "
                        "blending local stories with modern Ugandan music energy."
                    ),
                },
            )

            for song_index, (base_title, genre) in enumerate(SONG_TITLES, start=1):
                title = f"{base_title} - {name}"
                Song.objects.update_or_create(
                    artist=artist,
                    title=title,
                    defaults={
                        "audio_file": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
                        "cover_image": f"https://picsum.photos/seed/teso-song-{index}-{song_index}/800/800",
                        "genre": genre,
                        "lyrics": LYRIC_TEMPLATE.format(title=title),
                        "play_count": (index * 7350) + (song_index * 1420),
                        "release_date": date(2024 + ((index + song_index) % 3), song_index + 1, 10 + (index % 15)),
                        "is_featured": featured and song_index == 1,
                    },
                )

        self.stdout.write(self.style.SUCCESS("Seeded artists and songs for Teso Tunes."))

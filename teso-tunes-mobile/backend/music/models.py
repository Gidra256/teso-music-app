from django.db import models


class Artist(models.Model):
    RAPPERS = "Rappers"
    OTHER_SECULAR = "Other Secular Artists"
    GOSPEL = "Gospel Artists"

    CATEGORY_CHOICES = [
        (RAPPERS, "Rappers"),
        (OTHER_SECULAR, "Other Secular Artists"),
        (GOSPEL, "Gospel Artists"),
    ]

    name = models.CharField(max_length=120)
    category = models.CharField(max_length=40, choices=CATEGORY_CHOICES)
    bio = models.TextField(blank=True)
    photo = models.URLField(blank=True)
    photo_file = models.ImageField(upload_to="artists/photos/", blank=True, null=True)
    location = models.CharField(max_length=120, blank=True)
    is_featured = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Song(models.Model):
    artist = models.ForeignKey(Artist, related_name="songs", on_delete=models.CASCADE)
    title = models.CharField(max_length=160)
    audio_file = models.URLField(blank=True)
    audio_upload = models.FileField(upload_to="songs/audio/", blank=True, null=True)
    cover_image = models.URLField(blank=True)
    cover_upload = models.ImageField(upload_to="songs/covers/", blank=True, null=True)
    genre = models.CharField(max_length=80, blank=True)
    lyrics = models.TextField(blank=True)
    play_count = models.PositiveIntegerField(default=0)
    release_date = models.DateField(null=True, blank=True)
    is_featured = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-is_featured", "-play_count", "title"]

    def __str__(self):
        return f"{self.title} - {self.artist.name}"


class SongLike(models.Model):
    song = models.ForeignKey(Song, related_name="likes", on_delete=models.CASCADE)
    device_id = models.CharField(max_length=120)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["song", "device_id"], name="unique_song_like_per_device"),
        ]
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.song.title} liked by {self.device_id}"


class ArtistFollow(models.Model):
    artist = models.ForeignKey(Artist, related_name="follows", on_delete=models.CASCADE)
    device_id = models.CharField(max_length=120)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["artist", "device_id"], name="unique_artist_follow_per_device"),
        ]
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.artist.name} followed by {self.device_id}"

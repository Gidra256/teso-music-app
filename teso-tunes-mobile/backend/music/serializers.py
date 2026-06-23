from rest_framework import serializers

from .models import Artist, Song


class SongSerializer(serializers.ModelSerializer):
    artist_name = serializers.CharField(source="artist.name", read_only=True)
    artist_category = serializers.CharField(source="artist.category", read_only=True)
    audio_file = serializers.SerializerMethodField()
    cover_image = serializers.SerializerMethodField()
    like_count = serializers.SerializerMethodField()

    def get_audio_file(self, obj):
        return build_media_url(self.context.get("request"), obj.audio_upload, obj.audio_file)

    def get_cover_image(self, obj):
        return build_media_url(self.context.get("request"), obj.cover_upload, obj.cover_image)

    def get_like_count(self, obj):
        return getattr(obj, "like_count", obj.likes.count())

    class Meta:
        model = Song
        fields = [
            "id",
            "artist",
            "artist_name",
            "artist_category",
            "title",
            "audio_file",
            "cover_image",
            "genre",
            "lyrics",
            "like_count",
            "play_count",
            "release_date",
            "is_featured",
            "created_at",
        ]


class ArtistSerializer(serializers.ModelSerializer):
    song_count = serializers.IntegerField(source="songs.count", read_only=True)
    photo = serializers.SerializerMethodField()
    follower_count = serializers.SerializerMethodField()

    def get_photo(self, obj):
        return build_media_url(self.context.get("request"), obj.photo_file, obj.photo)

    def get_follower_count(self, obj):
        return getattr(obj, "follower_count", obj.follows.count())

    class Meta:
        model = Artist
        fields = [
            "id",
            "name",
            "category",
            "bio",
            "photo",
            "location",
            "is_featured",
            "follower_count",
            "song_count",
            "created_at",
        ]


class ArtistDetailSerializer(ArtistSerializer):
    songs = SongSerializer(many=True, read_only=True)

    class Meta(ArtistSerializer.Meta):
        fields = ArtistSerializer.Meta.fields + ["songs"]


def build_media_url(request, uploaded_file, fallback_url):
    if uploaded_file:
        url = uploaded_file.url
        return request.build_absolute_uri(url) if request else url
    return fallback_url

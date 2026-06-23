from django.contrib import admin

from .models import Artist, ArtistFollow, Song, SongLike


@admin.register(Artist)
class ArtistAdmin(admin.ModelAdmin):
    list_display = ("name", "category", "location", "has_uploaded_photo", "is_featured", "created_at")
    list_filter = ("category", "is_featured", "created_at")
    search_fields = ("name", "location", "bio")
    list_editable = ("is_featured",)
    fieldsets = (
        ("Artist", {"fields": ("name", "category", "bio", "location", "is_featured")}),
        ("Image", {"fields": ("photo_file", "photo")}),
    )

    @admin.display(boolean=True, description="Photo uploaded")
    def has_uploaded_photo(self, obj):
        return bool(obj.photo_file)


@admin.register(Song)
class SongAdmin(admin.ModelAdmin):
    list_display = (
        "title",
        "artist",
        "genre",
        "play_count",
        "release_date",
        "has_uploaded_cover",
        "has_uploaded_audio",
        "is_featured",
    )
    list_filter = ("genre", "is_featured", "release_date", "artist__category")
    search_fields = ("title", "artist__name", "genre")
    list_editable = ("is_featured",)
    autocomplete_fields = ("artist",)
    fieldsets = (
        ("Song", {"fields": ("artist", "title", "genre", "lyrics", "play_count", "release_date", "is_featured")}),
        ("Audio", {"fields": ("audio_upload", "audio_file")}),
        ("Cover image", {"fields": ("cover_upload", "cover_image")}),
    )

    @admin.display(boolean=True, description="Cover uploaded")
    def has_uploaded_cover(self, obj):
        return bool(obj.cover_upload)

    @admin.display(boolean=True, description="Audio uploaded")
    def has_uploaded_audio(self, obj):
        return bool(obj.audio_upload)


@admin.register(SongLike)
class SongLikeAdmin(admin.ModelAdmin):
    list_display = ("song", "device_id", "created_at")
    list_filter = ("created_at",)
    search_fields = ("song__title", "device_id")
    readonly_fields = ("created_at",)


@admin.register(ArtistFollow)
class ArtistFollowAdmin(admin.ModelAdmin):
    list_display = ("artist", "device_id", "created_at")
    list_filter = ("created_at",)
    search_fields = ("artist__name", "device_id")
    readonly_fields = ("created_at",)

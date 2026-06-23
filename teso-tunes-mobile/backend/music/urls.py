from django.urls import path

from .views import (
    ArtistDetailView,
    ArtistFollowView,
    ArtistListView,
    ArtistUnfollowView,
    FeaturedArtistsView,
    FeaturedSongsView,
    SongDetailView,
    SongLikeView,
    SongListView,
    SongUnlikeView,
)

urlpatterns = [
    path("artists/", ArtistListView.as_view(), name="artist-list"),
    path("artists/<int:pk>/", ArtistDetailView.as_view(), name="artist-detail"),
    path("artists/<int:pk>/follow/", ArtistFollowView.as_view(), name="artist-follow"),
    path("artists/<int:pk>/unfollow/", ArtistUnfollowView.as_view(), name="artist-unfollow"),
    path("songs/", SongListView.as_view(), name="song-list"),
    path("songs/<int:pk>/", SongDetailView.as_view(), name="song-detail"),
    path("songs/<int:pk>/like/", SongLikeView.as_view(), name="song-like"),
    path("songs/<int:pk>/unlike/", SongUnlikeView.as_view(), name="song-unlike"),
    path("featured-artists/", FeaturedArtistsView.as_view(), name="featured-artists"),
    path("featured-songs/", FeaturedSongsView.as_view(), name="featured-songs"),
]

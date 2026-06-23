from django.db.models import Count
from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Artist, ArtistFollow, Song, SongLike
from .serializers import ArtistDetailSerializer, ArtistSerializer, SongSerializer


def with_artist_counts(queryset):
    return queryset.annotate(follower_count=Count("follows", distinct=True))


def with_song_counts(queryset):
    return queryset.annotate(like_count=Count("likes", distinct=True))


def get_device_id(request):
    device_id = request.data.get("device_id") or request.query_params.get("device_id")
    return str(device_id).strip() if device_id else ""


class ArtistListView(generics.ListAPIView):
    serializer_class = ArtistSerializer

    def get_queryset(self):
        queryset = with_artist_counts(Artist.objects.all())
        category = self.request.query_params.get("category")
        search = self.request.query_params.get("search")
        if category:
            queryset = queryset.filter(category__iexact=category)
        if search:
            queryset = queryset.filter(name__icontains=search)
        return queryset


class ArtistDetailView(generics.RetrieveAPIView):
    serializer_class = ArtistDetailSerializer

    def get_queryset(self):
        return with_artist_counts(Artist.objects.prefetch_related("songs"))


class SongListView(generics.ListAPIView):
    serializer_class = SongSerializer

    def get_queryset(self):
        queryset = with_song_counts(Song.objects.select_related("artist"))
        category = self.request.query_params.get("category")
        search = self.request.query_params.get("search")
        if category:
            queryset = queryset.filter(artist__category__iexact=category)
        if search:
            queryset = queryset.filter(title__icontains=search) | queryset.filter(
                artist__name__icontains=search
            )
        return queryset.distinct()


class SongDetailView(generics.RetrieveAPIView):
    serializer_class = SongSerializer

    def get_queryset(self):
        return with_song_counts(Song.objects.select_related("artist"))


class FeaturedArtistsView(generics.ListAPIView):
    serializer_class = ArtistSerializer

    def get_queryset(self):
        return with_artist_counts(Artist.objects.filter(is_featured=True))


class FeaturedSongsView(generics.ListAPIView):
    serializer_class = SongSerializer

    def get_queryset(self):
        return with_song_counts(Song.objects.filter(is_featured=True).select_related("artist"))


class SongLikeView(APIView):
    def post(self, request, pk):
        device_id = get_device_id(request)
        if not device_id:
            return Response({"detail": "device_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        song = generics.get_object_or_404(Song, pk=pk)
        SongLike.objects.get_or_create(song=song, device_id=device_id)
        return Response({"liked": True, "like_count": song.likes.count()})


class SongUnlikeView(APIView):
    def post(self, request, pk):
        device_id = get_device_id(request)
        if not device_id:
            return Response({"detail": "device_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        song = generics.get_object_or_404(Song, pk=pk)
        SongLike.objects.filter(song=song, device_id=device_id).delete()
        return Response({"liked": False, "like_count": song.likes.count()})


class ArtistFollowView(APIView):
    def post(self, request, pk):
        device_id = get_device_id(request)
        if not device_id:
            return Response({"detail": "device_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        artist = generics.get_object_or_404(Artist, pk=pk)
        ArtistFollow.objects.get_or_create(artist=artist, device_id=device_id)
        return Response({"followed": True, "follower_count": artist.follows.count()})


class ArtistUnfollowView(APIView):
    def post(self, request, pk):
        device_id = get_device_id(request)
        if not device_id:
            return Response({"detail": "device_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        artist = generics.get_object_or_404(Artist, pk=pk)
        ArtistFollow.objects.filter(artist=artist, device_id=device_id).delete()
        return Response({"followed": False, "follower_count": artist.follows.count()})

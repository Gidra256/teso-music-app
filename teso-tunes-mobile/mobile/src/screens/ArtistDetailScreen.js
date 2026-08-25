import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { BACKEND_CONNECTION_ERROR, getArtist } from "../api/musicApi";
import MiniPlayer from "../components/MiniPlayer";
import SongCard from "../components/SongCard";
import { useAuth } from "../context/AuthContext";
import { useEngagement } from "../context/EngagementContext";
import { usePlayer } from "../context/PlayerContext";
import { colors, spacing } from "../theme";
import { formatFollowers } from "../utils/format";

export default function ArtistDetailScreen({ route }) {
  const {
    followArtistAction,
    getArtistFollowerCount,
    isArtistFollowed,
    isArtistFollowPending,
    syncFollowedArtistIds,
    unfollowArtistAction,
  } = useEngagement();
  const { isAuthenticated, refreshAccount } = useAuth();
  const { playSong } = usePlayer();
  const [artist, setArtist] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [followError, setFollowError] = useState("");
  const [snackbar, setSnackbar] = useState(null);
  const snackbarTimerRef = useRef(null);
  const artistId = route?.params?.id;

  useEffect(() => {
    let mounted = true;
    setLoading(true);

    Promise.all([
      getArtist(artistId),
      isAuthenticated ? refreshAccount().catch(() => null) : Promise.resolve(null),
    ])
      .then(([item, account]) => {
        if (!mounted) return;
        setError("");
        setArtist(item);
        if (account?.followed_artist_ids) {
          syncFollowedArtistIds(account.followed_artist_ids).catch(() => {});
        }
      })
      .catch((loadError) => {
        if (!mounted) return;
        setError(loadError?.message || BACKEND_CONNECTION_ERROR);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [artistId]);

  useEffect(() => {
    return () => {
      if (snackbarTimerRef.current) {
        clearTimeout(snackbarTimerRef.current);
      }
    };
  }, []);

  if (loading) {
    return <ActivityIndicator color={colors.primary} style={styles.loader} />;
  }

  if (error) {
    return (
      <View style={styles.safe}>
        <Text style={styles.empty}>{error}</Text>
      </View>
    );
  }

  if (!artist) {
    return (
      <View style={styles.safe}>
        <Text style={styles.empty}>Artist could not be found.</Text>
      </View>
    );
  }

  const followed = isArtistFollowed(artist.id);
  const followPending = isArtistFollowPending(artist.id);
  const followerCount = getArtistFollowerCount(artist);
  const hasSongs = (artist.songs || []).length > 0;

  function updateArtistFollowerCount(nextCount) {
    if (!Number.isFinite(Number(nextCount))) return;
    setArtist((current) =>
      current ? { ...current, follower_count: Math.max(0, Number(nextCount)) } : current,
    );
  }

  function showUndoSnackbar() {
    if (snackbarTimerRef.current) {
      clearTimeout(snackbarTimerRef.current);
    }
    setSnackbar({ artistId: artist.id, artistName: artist.name });
    snackbarTimerRef.current = setTimeout(() => {
      setSnackbar(null);
      snackbarTimerRef.current = null;
    }, 6500);
  }

  async function handleFollowPress() {
    if (followPending) return;
    setFollowError("");

    try {
      if (followed) {
        const result = await unfollowArtistAction(artist);
        if (!result || result.skipped) return;
        updateArtistFollowerCount(result?.follower_count);
        showUndoSnackbar();
      } else {
        const result = await followArtistAction(artist);
        if (!result || result.skipped) return;
        updateArtistFollowerCount(result?.follower_count);
        setSnackbar(null);
      }
    } catch (actionError) {
      setFollowError(
        followed
          ? "Could not unfollow. Check your connection and try again."
          : "Could not follow. Check your connection and try again.",
      );
    }
  }

  async function undoUnfollow() {
    if (!snackbar || followPending) return;
    setFollowError("");
    setSnackbar(null);

    try {
      const result = await followArtistAction(artist);
      if (!result || result.skipped) return;
      updateArtistFollowerCount(result?.follower_count);
    } catch (actionError) {
      setFollowError("Could not restore follow. Check your connection and try again.");
    }
  }

  function playArtist() {
    const firstSong = artist.songs?.[0];
    if (!firstSong) return;
    playSong(firstSong, artist.songs || []);
  }

  return (
    <View style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Image source={{ uri: artist.photo }} style={styles.heroImage} />
        <View style={styles.titleRow}>
          <Text style={styles.name}>{artist.name}</Text>
          {artist.is_featured && <Ionicons name="star" color={colors.accent} size={22} />}
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.meta}>{artist.category}</Text>
          <Text style={styles.dot}>.</Text>
          <Text style={styles.meta}>{artist.location}</Text>
        </View>
        <Text style={styles.followerCount}>{formatFollowers(followerCount)}</Text>
        <View style={styles.artistActions}>
          <TouchableOpacity
            activeOpacity={0.84}
            disabled={followPending}
            style={[
              styles.followButton,
              followed ? styles.followedButton : styles.notFollowedButton,
              followPending && styles.pendingButton,
            ]}
            onPress={handleFollowPress}
          >
            {followPending ? (
              <ActivityIndicator color={followed ? colors.softText : colors.primary} size="small" />
            ) : (
              <Ionicons
                name={followed ? "checkmark" : "person-add"}
                color={followed ? colors.softText : colors.primary}
                size={16}
              />
            )}
            <Text style={[styles.followText, followed && styles.followedText]}>
              {followed ? "Following" : "Follow"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.82}
            accessibilityLabel="Artist options"
            style={styles.moreButton}
          >
            <Ionicons name="ellipsis-horizontal" color={colors.softText} size={21} />
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.86}
            disabled={!hasSongs}
            style={[styles.playButton, !hasSongs && styles.disabledPlayButton]}
            onPress={playArtist}
          >
            <Ionicons name="play" color={colors.background} size={18} />
            <Text style={styles.playButtonText}>Play</Text>
          </TouchableOpacity>
        </View>
        {followError ? <Text style={styles.followError}>{followError}</Text> : null}
        <Text style={styles.bio}>{artist.bio}</Text>
        <Text style={styles.sectionTitle}>Songs by {artist.name}</Text>
        <View style={styles.list}>
          {(artist.songs || []).map((song) => (
            <SongCard key={song.id} song={song} queue={artist.songs || []} />
          ))}
        </View>
      </ScrollView>
      {snackbar ? (
        <View style={styles.snackbar}>
          <Text style={styles.snackbarText} numberOfLines={1}>
            Unfollowed {snackbar.artistName}
          </Text>
          <TouchableOpacity
            activeOpacity={0.82}
            disabled={followPending}
            style={styles.undoButton}
            onPress={undoUnfollow}
          >
            <Text style={styles.undoText}>UNDO</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <MiniPlayer />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    gap: 14,
    padding: spacing.page,
    paddingBottom: 110,
  },
  heroImage: {
    backgroundColor: colors.elevated,
    borderRadius: 8,
    height: 290,
    width: "100%",
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  name: {
    color: colors.text,
    flex: 1,
    fontSize: 30,
    fontWeight: "900",
  },
  metaRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  meta: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: "800",
  },
  dot: {
    color: colors.muted,
  },
  bio: {
    color: colors.softText,
    fontSize: 15,
    lineHeight: 22,
  },
  artistActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  followButton: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 14,
  },
  notFollowedButton: {
    backgroundColor: "rgba(32, 230, 243, 0.1)",
    borderColor: colors.primary,
  },
  followedButton: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: colors.border,
  },
  pendingButton: {
    opacity: 0.72,
  },
  followText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "900",
  },
  followedText: {
    color: colors.softText,
  },
  followerCount: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800",
    marginTop: -4,
  },
  moreButton: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  playButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 23,
    flexDirection: "row",
    gap: 7,
    justifyContent: "center",
    marginLeft: "auto",
    minHeight: 46,
    paddingHorizontal: 18,
  },
  disabledPlayButton: {
    opacity: 0.5,
  },
  playButtonText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: "950",
  },
  followError: {
    color: colors.softText,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 18,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
    marginTop: 6,
  },
  list: {
    gap: 12,
  },
  loader: {
    backgroundColor: colors.background,
    flex: 1,
    paddingTop: 80,
  },
  empty: {
    color: colors.softText,
    fontSize: 16,
    padding: spacing.page,
    textAlign: "center",
  },
  snackbar: {
    alignItems: "center",
    backgroundColor: colors.elevated,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    bottom: 82,
    flexDirection: "row",
    gap: 12,
    left: spacing.page,
    minHeight: 52,
    paddingHorizontal: 14,
    position: "absolute",
    right: spacing.page,
  },
  snackbarText: {
    color: colors.softText,
    flex: 1,
    fontSize: 13,
    fontWeight: "800",
  },
  undoButton: {
    alignItems: "center",
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  undoText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "950",
  },
});

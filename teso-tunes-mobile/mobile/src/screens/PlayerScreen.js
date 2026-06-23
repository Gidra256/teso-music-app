import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useState } from "react";
import {
  Image,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { getSongs } from "../api/musicApi";
import SeekBar from "../components/SeekBar";
import { useEngagement } from "../context/EngagementContext";
import { usePlayer } from "../context/PlayerContext";
import { colors, spacing } from "../theme";
import { formatPlays, formatTime } from "../utils/format";

const FALLBACK_COVER =
  "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=900&q=80";

export default function PlayerScreen({ route, navigation }) {
  const {
    currentSong,
    currentTime,
    duration,
    isPlaying,
    playNextSong,
    playPreviousSong,
    playSong,
    isRepeatOn,
    isShuffleOn,
    seekBy,
    seekTo,
    togglePlay,
    toggleRepeat,
    toggleShuffle,
  } = usePlayer();
  const { getSongLikeCount, isSongLiked, toggleSongLike } = useEngagement();
  const { height, width } = useWindowDimensions();
  const [previewTime, setPreviewTime] = useState(null);
  const [deepLinkLoading, setDeepLinkLoading] = useState(false);

  const deepLinkedSongId = route?.params?.id;
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeCurrentTime = Number.isFinite(currentTime)
    ? Math.max(0, Math.min(currentTime, safeDuration || currentTime))
    : 0;
  const displayTime = previewTime === null ? safeCurrentTime : previewTime;
  const coverSize = Math.min(width - spacing.page * 2, height * 0.4, 350);

  useEffect(() => {
    setPreviewTime(null);
  }, [currentSong?.id]);

  const clampSeekTime = useCallback((value) => {
    if (!Number.isFinite(value) || safeDuration <= 0) return 0;
    return Math.max(0, Math.min(value, safeDuration));
  }, [safeDuration]);

  const handlePreviewChange = useCallback((nextTime, isDragging) => {
    if (safeDuration <= 0 || !Number.isFinite(nextTime)) {
      setPreviewTime(null);
      return;
    }
    setPreviewTime(isDragging ? clampSeekTime(nextTime) : null);
  }, [clampSeekTime, safeDuration]);

  const handleSeek = useCallback((nextTime) => {
    const nextPosition = clampSeekTime(nextTime);
    setPreviewTime(nextPosition);
    Promise.resolve(seekTo(nextPosition)).finally(() => {
      setTimeout(() => setPreviewTime(null), 250);
    });
  }, [clampSeekTime, seekTo]);

  useEffect(() => {
    const songId = deepLinkedSongId;

    if (!songId) return;
    if (String(currentSong?.id) === String(songId)) return;

    let mounted = true;
    setDeepLinkLoading(true);

    getSongs()
      .then((songs) => {
        if (!mounted) return;

        const song = songs.find((item) => String(item.id) === String(songId));

        if (song) {
          playSong(song, songs);
        }
      })
      .finally(() => {
        if (mounted) setDeepLinkLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [deepLinkedSongId, currentSong?.id, playSong]);

  async function shareSong() {
    if (!currentSong) return;

    const artistName = currentSong.artist_name || "a Teso artist";
    try {
      await Share.share({
        message: `Listen to ${currentSong.title} by ${artistName} on TesoHub Music.`,
        title: currentSong.title,
      });
    } catch (error) {}
  }

  function openArtist() {
    const artistId = currentSong?.artist || currentSong?.artist_id;
    if (!artistId) return;
    navigation?.navigate("ArtistDetail", { id: artistId });
  }

  function openSongs() {
    navigation?.navigate("TesoTabs", { screen: "Songs" });
  }

  function goBackOrSongs() {
    if (navigation?.canGoBack?.()) {
      navigation.goBack();
      return;
    }

    openSongs();
  }

  if (!currentSong) {
    return (
      <SafeAreaView style={styles.safe}>
        <LinearGradient
          colors={["rgba(249, 115, 22, 0.2)", colors.background, colors.background]}
          style={styles.emptyGradient}
        >
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <Ionicons name="musical-notes" color={colors.accent} size={34} />
            </View>
            <Text style={styles.emptyTitle}>No song selected</Text>
            <Text style={styles.emptyText}>
              Choose a song from TesoHub Music to start listening.
            </Text>
            <TouchableOpacity
              activeOpacity={0.86}
              style={styles.browseButton}
              onPress={() => navigation?.navigate("TesoTabs", { screen: "Songs" })}
            >
              <Ionicons name="albums" color={colors.text} size={18} />
              <Text style={styles.browseButtonText}>Browse Songs</Text>
            </TouchableOpacity>
            {deepLinkLoading ? (
              <Text style={styles.loadingText}>Loading linked song...</Text>
            ) : null}
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  const coverUri = currentSong.cover_image || FALLBACK_COVER;
  const artistName = currentSong.artist_name || "Teso artist";
  const playCount = currentSong.play_count || 0;
  const liked = isSongLiked(currentSong.id);
  const likeCount = getSongLikeCount(currentSong);
  const hasArtistRoute = Boolean(currentSong.artist || currentSong.artist_id);
  const dateLabel = currentSong.release_date || currentSong.created_at;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.backdrop}>
        <Image source={{ uri: coverUri }} style={styles.backdropImage} blurRadius={40} />
        <LinearGradient
          colors={[
            "rgba(8, 10, 19, 0.28)",
            "rgba(9, 9, 11, 0.82)",
            colors.background,
          ]}
          style={StyleSheet.absoluteFill}
        />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <TouchableOpacity
            activeOpacity={0.82}
            style={styles.roundIconButton}
            onPress={goBackOrSongs}
          >
            <Ionicons name="arrow-back" color={colors.softText} size={21} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Now Playing</Text>
          <TouchableOpacity activeOpacity={0.82} style={styles.playlistButton} onPress={openSongs}>
            <Ionicons name="list" color={colors.accent} size={17} />
            <Text style={styles.playlistButtonText}>Playlist</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.coverShell, { height: coverSize, width: coverSize }]}>
          <Image source={{ uri: coverUri }} style={styles.cover} />
        </View>

        <View style={styles.trackHeader}>
          <View style={styles.genrePill}>
            <Ionicons name="radio" color={colors.accent} size={14} />
            <Text style={styles.genrePillText}>{currentSong.genre || "Teso music"}</Text>
          </View>
          <Text style={styles.title} numberOfLines={2}>
            {currentSong.title}
          </Text>
          <TouchableOpacity
            activeOpacity={hasArtistRoute ? 0.82 : 1}
            style={styles.artistButton}
            onPress={hasArtistRoute ? openArtist : undefined}
          >
            <Text style={styles.artist} numberOfLines={1}>
              {artistName}
            </Text>
            {hasArtistRoute ? (
              <Ionicons name="chevron-forward" color={colors.muted} size={16} />
            ) : null}
          </TouchableOpacity>
        </View>

        <View style={styles.progressBlock}>
          <SeekBar
            currentTime={displayTime}
            duration={safeDuration}
            onPreviewChange={handlePreviewChange}
            onSeek={handleSeek}
            disabled={safeDuration <= 0}
          />
          <View style={styles.timeRow}>
            <Text style={styles.time}>{formatTime(displayTime)}</Text>
            <Text style={styles.time}>{safeDuration > 0 ? formatTime(safeDuration) : "0:00"}</Text>
          </View>
        </View>

        <View style={styles.controls}>
          <PlayerIconButton
            active={isShuffleOn}
            icon="shuffle"
            label="Shuffle"
            onPress={toggleShuffle}
          />
          <PlayerIconButton icon="play-skip-back" label="Previous" onPress={playPreviousSong} />
          <TouchableOpacity
            activeOpacity={0.88}
            accessibilityLabel={isPlaying ? "Pause song" : "Play song"}
            style={styles.playButton}
            onPress={togglePlay}
          >
            <Ionicons
              name={isPlaying ? "pause" : "play"}
              color={colors.text}
              size={42}
              style={!isPlaying && styles.playIcon}
            />
          </TouchableOpacity>
          <PlayerIconButton icon="play-skip-forward" label="Next" onPress={playNextSong} />
          <PlayerIconButton
            active={isRepeatOn}
            icon="repeat"
            label="Repeat"
            onPress={toggleRepeat}
          />
        </View>

        <View style={styles.actionRow}>
          <TrackAction icon="play-back-outline" label="Back 10" onPress={() => seekBy(-10)} />
          <TrackAction icon="play-forward-outline" label="Forward 10" onPress={() => seekBy(10)} />
          <TrackAction
            active={liked}
            icon={liked ? "heart" : "heart-outline"}
            label={liked ? `${formatPlays(likeCount)} likes` : "Favorite"}
            onPress={() => toggleSongLike(currentSong)}
          />
          <TrackAction icon="share-social-outline" label="Share" onPress={shareSong} />
          {hasArtistRoute ? (
            <TrackAction icon="person-circle-outline" label="View Artist" onPress={openArtist} />
          ) : (
            <TrackAction icon="person-circle-outline" label="Artist" />
          )}
          <TrackAction icon="ellipsis-horizontal-circle-outline" label="More" />
        </View>

        <View style={styles.infoCard}>
          <View style={styles.sectionHeader}>
            <Ionicons name="information-circle" color={colors.accent} size={20} />
            <Text style={styles.sectionTitle}>About this track</Text>
          </View>
          <InfoRow label="Artist" value={artistName} />
          <InfoRow label="Genre" value={currentSong.genre} />
          <InfoRow label="District" value={currentSong.artist_location || currentSong.location} />
          <InfoRow label="Plays" value={`${formatPlays(playCount)} plays`} />
          <InfoRow label="Released" value={dateLabel} />
        </View>

        <View style={styles.lyricsSection}>
          <View style={styles.sectionHeader}>
            <Ionicons name="document-text" color={colors.accent} size={19} />
            <Text style={styles.sectionTitle}>Lyrics</Text>
          </View>
          <Text style={styles.lyricsText}>
            {currentSong.lyrics?.trim() || "Lyrics have not been added yet."}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function PlayerIconButton({ active = false, icon, label, onPress }) {
  return (
    <TouchableOpacity
      activeOpacity={0.82}
      accessibilityLabel={label}
      style={[styles.controlButton, active && styles.controlButtonActive]}
      onPress={onPress}
    >
      <Ionicons name={icon} color={active ? colors.accent : colors.softText} size={23} />
    </TouchableOpacity>
  );
}

function TrackAction({ active = false, icon, label, onPress }) {
  return (
    <TouchableOpacity
      activeOpacity={0.82}
      style={[styles.trackAction, active && styles.trackActionActive]}
      onPress={onPress}
    >
      <Ionicons name={icon} color={active ? colors.primary : colors.softText} size={20} />
      <Text style={[styles.trackActionText, active && styles.trackActionTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function InfoRow({ label, value }) {
  if (!value) return null;

  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: colors.background,
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background,
    overflow: "hidden",
  },
  backdropImage: {
    height: "56%",
    opacity: 0.4,
    position: "absolute",
    top: 0,
    transform: [{ scale: 1.2 }],
    width: "100%",
  },
  content: {
    alignItems: "center",
    padding: spacing.page,
    paddingBottom: 44,
  },
  topBar: {
    alignItems: "center",
    alignSelf: "stretch",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 18,
    minHeight: 42,
  },
  roundIconButton: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 20,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  headerTitle: {
    color: colors.text,
    flex: 1,
    fontSize: 14,
    fontWeight: "950",
    textAlign: "center",
    textTransform: "uppercase",
  },
  playlistButton: {
    alignItems: "center",
    backgroundColor: "rgba(249, 115, 22, 0.13)",
    borderColor: "rgba(249, 115, 22, 0.26)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: 10,
  },
  playlistButtonText: {
    color: colors.softText,
    fontSize: 12,
    fontWeight: "900",
  },
  nowPlayingPill: {
    alignItems: "center",
    backgroundColor: "rgba(249, 115, 22, 0.14)",
    borderColor: "rgba(249, 115, 22, 0.28)",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 36,
    paddingHorizontal: 13,
  },
  liveDot: {
    backgroundColor: colors.accent,
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  nowPlayingText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  coverShell: {
    backgroundColor: "rgba(255, 255, 255, 0.07)",
    borderColor: "rgba(255, 255, 255, 0.16)",
    borderRadius: 8,
    borderWidth: 1,
    elevation: 18,
    padding: 9,
    shadowColor: colors.primary,
    shadowOffset: { height: 20, width: 0 },
    shadowOpacity: 0.36,
    shadowRadius: 28,
  },
  cover: {
    backgroundColor: colors.elevated,
    borderRadius: 8,
    height: "100%",
    width: "100%",
  },
  trackHeader: {
    alignItems: "center",
    alignSelf: "stretch",
    marginTop: 24,
  },
  genrePill: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "rgba(250, 204, 21, 0.11)",
    borderColor: "rgba(250, 204, 21, 0.2)",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    marginBottom: 12,
    minHeight: 31,
    paddingHorizontal: 11,
  },
  genrePillText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "900",
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "950",
    lineHeight: 36,
    textAlign: "center",
  },
  artistButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    justifyContent: "center",
    marginTop: 8,
    maxWidth: "90%",
    minHeight: 32,
    paddingHorizontal: 8,
  },
  artist: {
    color: colors.softText,
    flexShrink: 1,
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
  },
  progressBlock: {
    alignSelf: "stretch",
    marginTop: 24,
  },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
  },
  time: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
  },
  controls: {
    alignItems: "center",
    alignSelf: "stretch",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 22,
  },
  controlButton: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.07)",
    borderColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 24,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  controlButtonActive: {
    backgroundColor: "rgba(250, 204, 21, 0.14)",
    borderColor: "rgba(250, 204, 21, 0.24)",
  },
  playButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderColor: "rgba(250, 204, 21, 0.36)",
    borderRadius: 40,
    borderWidth: 1,
    elevation: 12,
    height: 80,
    justifyContent: "center",
    shadowColor: colors.primary,
    shadowOffset: { height: 10, width: 0 },
    shadowOpacity: 0.44,
    shadowRadius: 18,
    width: 80,
  },
  playIcon: {
    marginLeft: 4,
  },
  actionRow: {
    alignSelf: "stretch",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "center",
    marginTop: 22,
  },
  trackAction: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.07)",
    borderColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    minHeight: 40,
    paddingHorizontal: 12,
  },
  trackActionActive: {
    backgroundColor: "rgba(249, 115, 22, 0.13)",
    borderColor: "rgba(249, 115, 22, 0.24)",
  },
  trackActionText: {
    color: colors.softText,
    fontSize: 12,
    fontWeight: "900",
  },
  trackActionTextActive: {
    color: colors.primary,
  },
  infoCard: {
    alignSelf: "stretch",
    backgroundColor: "rgba(24, 24, 27, 0.84)",
    borderColor: "rgba(255, 255, 255, 0.09)",
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    marginTop: 24,
    padding: 16,
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "950",
  },
  infoRow: {
    borderTopColor: "rgba(255, 255, 255, 0.08)",
    borderTopWidth: 1,
    gap: 4,
    paddingTop: 10,
  },
  infoLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  infoValue: {
    color: colors.softText,
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 20,
  },
  lyricsSection: {
    alignSelf: "stretch",
    borderTopColor: "rgba(249, 115, 22, 0.2)",
    borderTopWidth: 1,
    gap: 12,
    marginTop: 24,
    paddingTop: 18,
  },
  lyricsText: {
    color: colors.softText,
    fontSize: 15,
    lineHeight: 23,
  },
  emptyGradient: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: spacing.page,
  },
  emptyCard: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 22,
    width: "100%",
  },
  emptyIcon: {
    alignItems: "center",
    backgroundColor: "rgba(250, 204, 21, 0.12)",
    borderRadius: 30,
    height: 60,
    justifyContent: "center",
    width: 60,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "950",
    textAlign: "center",
  },
  emptyText: {
    color: colors.softText,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  browseButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 8,
    flexDirection: "row",
    gap: 8,
    minHeight: 46,
    paddingHorizontal: 16,
  },
  browseButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  loadingText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800",
  },
});

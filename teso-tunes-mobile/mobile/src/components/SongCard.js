import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useState } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from "react-native";

import SongActionsModal from "./SongActionsModal";
import { useAuth } from "../context/AuthContext";
import { useEngagement } from "../context/EngagementContext";
import { usePlayer } from "../context/PlayerContext";
import { colors, spacing } from "../theme";
import { artworkSource, TESOHUB_ARTWORK_PLACEHOLDER } from "../utils/artwork";
import { formatPlays } from "../utils/format";

export default function SongCard({ song, compact = false, queue = [], onPress, onMenuPress }) {
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const { isAuthenticated } = useAuth();
  const { currentSong, isPlaying, playSong, togglePlay } = usePlayer();
  const { getSongLikeCount, isSongLiked, isSongLikePending, toggleSongLike } = useEngagement();
  const [actionsVisible, setActionsVisible] = useState(false);
  const active = String(currentSong?.id) === String(song.id);
  const liked = isSongLiked(song.id);
  const likePending = isSongLikePending(song.id);
  const likeCount = getSongLikeCount(song);
  const compactTileSize = Math.min(
    168,
    Math.max(146, Math.round((width - spacing.page * 2 - 18) / 2.2))
  );
  const handlePress = onPress || (() => (active ? togglePlay() : playSong(song, queue)));

  function openProfile() {
    const parentNavigation = navigation.getParent?.();
    if (parentNavigation?.navigate) {
      parentNavigation.navigate("Profile", { loginRequired: true });
      return;
    }

    navigation.navigate("Profile", { loginRequired: true });
  }

  function handleLikePress() {
    if (!isAuthenticated) {
      openProfile();
      return;
    }

    toggleSongLike(song);
  }

  if (compact) {
    return (
      <TouchableOpacity style={[styles.tile, { width: compactTileSize }]} onPress={handlePress}>
        <Image defaultSource={TESOHUB_ARTWORK_PLACEHOLDER} source={artworkSource(song.cover_image)} style={[styles.tileCover, { width: compactTileSize, height: compactTileSize }]} />
        <Text style={styles.tileTitle} numberOfLines={2}>{song.title}</Text>
        <Text style={styles.tileMeta} numberOfLines={2}>{song.artist_name}</Text>
        <TouchableOpacity
          accessibilityLabel={`${liked ? "Unlike" : "Like"} ${song.title}`}
          disabled={likePending}
          style={[styles.tileLikeButton, likePending && styles.pendingLikeButton]}
          onPress={(event) => {
            event.stopPropagation?.();
            handleLikePress();
          }}
        >
          {likePending ? (
            <ActivityIndicator color={liked ? colors.primary : colors.muted} size="small" />
          ) : (
            <Ionicons name={liked ? "heart" : "heart-outline"} color={liked ? colors.primary : colors.muted} size={15} />
          )}
          <Text style={[styles.likes, liked && styles.likedText]}>{formatPlays(likeCount)}</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  }

  return (
    <>
      <TouchableOpacity style={styles.card} onPress={handlePress}>
        <Image defaultSource={TESOHUB_ARTWORK_PLACEHOLDER} source={artworkSource(song.cover_image)} style={styles.cover} />
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={1}>{song.title}</Text>
          <Text style={styles.meta} numberOfLines={1}>{song.artist_name}</Text>
          <TouchableOpacity
            accessibilityLabel={`${liked ? "Unlike" : "Like"} ${song.title}`}
            disabled={likePending}
            style={[styles.likeButton, likePending && styles.pendingLikeButton]}
            onPress={(event) => {
              event.stopPropagation?.();
              handleLikePress();
            }}
          >
            {likePending ? (
              <ActivityIndicator color={liked ? colors.primary : colors.muted} size="small" />
            ) : (
              <Ionicons name={liked ? "heart" : "heart-outline"} color={liked ? colors.primary : colors.muted} size={16} />
            )}
            <Text style={[styles.likes, liked && styles.likedText]}>{formatPlays(likeCount)}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          activeOpacity={0.82}
          accessibilityLabel="Open song menu"
          style={styles.menuButton}
          onPress={(event) => {
            event.stopPropagation?.();
            if (onMenuPress) onMenuPress(song);
            else setActionsVisible(true);
          }}
        >
          <Ionicons name="ellipsis-horizontal" color={colors.softText} size={20} />
        </TouchableOpacity>
        <View style={[styles.playButton, active && styles.activeButton]}>
          <Ionicons name={active && isPlaying ? "pause" : "play"} color={colors.text} size={18} />
        </View>
      </TouchableOpacity>
      <SongActionsModal
        song={actionsVisible ? song : null}
        queue={queue}
        onClose={() => setActionsVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderRadius: 8,
    flexDirection: "row",
    gap: 12,
    minHeight: 64,
    paddingVertical: 6,
  },
  cover: {
    backgroundColor: colors.elevated,
    borderRadius: 5,
    height: 58,
    width: 58,
  },
  body: {
    flex: 1,
    gap: 3,
  },
  title: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "850",
  },
  meta: {
    color: colors.muted,
    fontSize: 13,
  },
  likeButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 5,
    minHeight: 26,
    paddingRight: 8,
    paddingVertical: 2,
  },
  pendingLikeButton: {
    opacity: 0.72,
  },
  likes: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
  },
  likedText: {
    color: colors.primary,
  },
  playButton: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderRadius: 22,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  menuButton: {
    alignItems: "center",
    borderRadius: 20,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  activeButton: {
    backgroundColor: colors.primary,
  },
  tile: {
    backgroundColor: "transparent",
    gap: 6,
  },
  tileCover: {
    aspectRatio: 1,
    backgroundColor: colors.elevated,
    borderRadius: 5,
    width: "100%",
  },
  tileTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "850",
    lineHeight: 18,
  },
  tileMeta: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 17,
  },
  tileLikeButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    minHeight: 44,
  },
});

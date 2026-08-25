import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import AddToPlaylistModal from "./AddToPlaylistModal";
import { useEngagement } from "../context/EngagementContext";
import { usePlayer } from "../context/PlayerContext";
import { colors } from "../theme";
import { artworkSource } from "../utils/artwork";
import { formatPlays } from "../utils/format";

export default function SongCard({ song, compact = false, queue = [] }) {
  const { currentSong, isPlaying, playSong, togglePlay } = usePlayer();
  const { getSongLikeCount, isSongLiked, toggleSongLike } = useEngagement();
  const [playlistModalVisible, setPlaylistModalVisible] = useState(false);
  const active = currentSong?.id === song.id;
  const liked = isSongLiked(song.id);
  const likeCount = getSongLikeCount(song);
  const handlePress = () => (active ? togglePlay() : playSong(song, queue));

  if (compact) {
    return (
      <TouchableOpacity style={styles.tile} onPress={handlePress}>
        <Image source={artworkSource(song.cover_image)} style={styles.tileCover} />
        <Text style={styles.tileTitle} numberOfLines={2}>{song.title}</Text>
        <Text style={styles.tileMeta} numberOfLines={2}>{song.artist_name}</Text>
        <TouchableOpacity
          style={styles.tileLikeButton}
          onPress={(event) => {
            event.stopPropagation?.();
            toggleSongLike(song);
          }}
        >
          <Ionicons name={liked ? "heart" : "heart-outline"} color={liked ? colors.primary : colors.muted} size={15} />
          <Text style={[styles.likes, liked && styles.likedText]}>{formatPlays(likeCount)}</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  }

  return (
    <>
      <TouchableOpacity style={styles.card} onPress={handlePress}>
        <Image source={artworkSource(song.cover_image)} style={styles.cover} />
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={1}>{song.title}</Text>
          <Text style={styles.meta} numberOfLines={1}>{song.artist_name}</Text>
          <TouchableOpacity
            style={styles.likeButton}
            onPress={(event) => {
              event.stopPropagation?.();
              toggleSongLike(song);
            }}
          >
            <Ionicons name={liked ? "heart" : "heart-outline"} color={liked ? colors.primary : colors.muted} size={16} />
            <Text style={[styles.likes, liked && styles.likedText]}>{formatPlays(likeCount)}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          activeOpacity={0.82}
          accessibilityLabel="Open song menu"
          style={styles.menuButton}
          onPress={(event) => {
            event.stopPropagation?.();
            setPlaylistModalVisible(true);
          }}
        >
          <Ionicons name="ellipsis-horizontal" color={colors.softText} size={20} />
        </TouchableOpacity>
        <View style={[styles.playButton, active && styles.activeButton]}>
          <Ionicons name={active && isPlaying ? "pause" : "play"} color={colors.text} size={18} />
        </View>
      </TouchableOpacity>
      <AddToPlaylistModal
        visible={playlistModalVisible}
        song={song}
        onClose={() => setPlaylistModalVisible(false)}
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
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  activeButton: {
    backgroundColor: colors.primary,
  },
  tile: {
    backgroundColor: "transparent",
    gap: 6,
    width: 154,
  },
  tileCover: {
    backgroundColor: colors.elevated,
    borderRadius: 5,
    height: 154,
    width: 154,
  },
  tileTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "850",
    lineHeight: 18,
  },
  tileMeta: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  tileLikeButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    minHeight: 24,
  },
});

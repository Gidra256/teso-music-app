import { Ionicons } from "@expo/vector-icons";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { useEngagement } from "../context/EngagementContext";
import { usePlayer } from "../context/PlayerContext";
import { colors } from "../theme";
import { formatPlays } from "../utils/format";

export default function SongCard({ song, compact = false, queue = [] }) {
  const { currentSong, isPlaying, playSong, togglePlay } = usePlayer();
  const { getSongLikeCount, isSongLiked, toggleSongLike } = useEngagement();
  const active = currentSong?.id === song.id;
  const liked = isSongLiked(song.id);
  const likeCount = getSongLikeCount(song);
  const handlePress = () => (active ? togglePlay() : playSong(song, queue));

  return (
    <TouchableOpacity style={[styles.card, compact && styles.compactCard]} onPress={handlePress}>
      <Image source={{ uri: song.cover_image }} style={[styles.cover, compact && styles.compactCover]} />
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>{song.title}</Text>
        <Text style={styles.meta} numberOfLines={1}>{song.artist_name}</Text>
        <View style={styles.footer}>
          <Text style={styles.genre}>{song.genre || "Teso music"}</Text>
          <Text style={styles.plays}>{formatPlays(song.play_count)} plays</Text>
        </View>
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
      <View style={[styles.playButton, active && styles.activeButton]}>
        <Ionicons name={active && isPlaying ? "pause" : "play"} color={colors.text} size={18} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 10,
  },
  compactCard: {
    width: 250,
  },
  cover: {
    backgroundColor: colors.elevated,
    borderRadius: 8,
    height: 68,
    width: 68,
  },
  compactCover: {
    height: 76,
    width: 76,
  },
  body: {
    flex: 1,
    gap: 5,
  },
  title: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
  },
  meta: {
    color: colors.softText,
    fontSize: 13,
  },
  footer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
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
  genre: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "700",
  },
  plays: {
    color: colors.muted,
    fontSize: 12,
  },
  playButton: {
    alignItems: "center",
    backgroundColor: colors.elevated,
    borderRadius: 22,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  activeButton: {
    backgroundColor: colors.primary,
  },
});

import { Ionicons } from "@expo/vector-icons";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";

import { usePlayer } from "../context/PlayerContext";
import { colors } from "../theme";
import { artworkSource } from "../utils/artwork";

export default function MiniPlayer() {
  const navigation = useNavigation();
  const { currentSong, isPlaying, progress, togglePlay } = usePlayer();

  if (!currentSong) return null;

  return (
    <TouchableOpacity activeOpacity={0.86} style={styles.wrapper} onPress={() => navigation.navigate("Player")}>
      <Image source={artworkSource(currentSong.cover_image)} style={styles.cover} />
      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={1}>{currentSong.title}</Text>
        <Text style={styles.artist} numberOfLines={1}>{currentSong.artist_name}</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
      </View>
      <TouchableOpacity
        style={styles.iconButton}
        onPress={(event) => {
          event.stopPropagation?.();
          togglePlay();
        }}
      >
        <Ionicons name={isPlaying ? "pause" : "play"} color={colors.text} size={20} />
      </TouchableOpacity>
      <Ionicons name="chevron-up" color={colors.muted} size={16} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "center",
    backgroundColor: "#26202A",
    borderRadius: 8,
    bottom: 10,
    flexDirection: "row",
    gap: 10,
    left: 18,
    padding: 9,
    position: "absolute",
    right: 18,
  },
  cover: {
    borderRadius: 8,
    height: 48,
    width: 48,
  },
  copy: {
    flex: 1,
    gap: 4,
  },
  title: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  artist: {
    color: colors.muted,
    fontSize: 12,
  },
  progressTrack: {
    backgroundColor: colors.border,
    borderRadius: 4,
    height: 4,
    overflow: "hidden",
  },
  progressFill: {
    backgroundColor: colors.primary,
    height: "100%",
    width: "38%",
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderRadius: 21,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
});

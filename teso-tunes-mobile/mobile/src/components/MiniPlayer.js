import { Ionicons } from "@expo/vector-icons";
import {
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePlayer } from "../context/PlayerContext";
import { usePlayerProgress } from "../context/PlayerProgressContext";
import { colors, spacing } from "../theme";
import { artworkSource } from "../utils/artwork";

export default function MiniPlayer() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { currentSong, isPlaying, togglePlay } = usePlayer();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;

  if (!currentSong) return null;

  return (
    <TouchableOpacity
      accessibilityLabel="Open player"
      activeOpacity={0.86}
      style={[
        styles.wrapper,
        isDesktopWeb
          ? styles.desktopWrapper
          : { bottom: Math.max(10, Math.min(insets.bottom + 10, 34)) },
      ]}
      onPress={() => navigation.navigate("Player")}
    >
      <Image
        source={artworkSource(currentSong.cover_image)}
        style={[styles.cover, isDesktopWeb && styles.desktopCover]}
      />
      <View style={[styles.copy, isDesktopWeb && styles.desktopCopy]}>
        <Text style={styles.title} numberOfLines={1}>{currentSong.title}</Text>
        <Text style={styles.artist} numberOfLines={1}>{currentSong.artist_name}</Text>
        <MiniProgress />
      </View>
      <TouchableOpacity
        accessibilityLabel={isPlaying ? "Pause song" : "Play song"}
        style={[styles.iconButton, isDesktopWeb && styles.desktopIconButton]}
        onPress={(event) => {
          event.stopPropagation?.();
          togglePlay();
        }}
      >
        <Ionicons name={isPlaying ? "pause" : "play"} color={colors.text} size={20} />
      </TouchableOpacity>
      <Ionicons name="chevron-up" color={colors.muted} size={isDesktopWeb ? 18 : 16} />
    </TouchableOpacity>
  );
}

function MiniProgress() {
  const { progress } = usePlayerProgress();
  return <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress * 100}%` }]} /></View>;
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "center",
    backgroundColor: "#26202A",
    borderRadius: 8,
    flexDirection: "row",
    gap: 10,
    left: spacing.page,
    maxWidth: 620,
    padding: 9,
    position: "absolute",
    right: spacing.page,
  },
  desktopWrapper: {
    borderRadius: 0,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    bottom: 0,
    left: 0,
    maxWidth: "100%",
    minHeight: 84,
    paddingHorizontal: 18,
    right: 0,
  },
  cover: {
    borderRadius: 8,
    height: 48,
    width: 48,
  },
  desktopCover: {
    height: 56,
    width: 56,
  },
  copy: {
    flex: 1,
    gap: 4,
  },
  desktopCopy: {
    maxWidth: 580,
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
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  desktopIconButton: {
    backgroundColor: colors.primary,
  },
});

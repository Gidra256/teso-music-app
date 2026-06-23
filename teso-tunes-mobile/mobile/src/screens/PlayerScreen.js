import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useState } from "react";
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import SeekBar from "../components/SeekBar";
import { usePlayer } from "../context/PlayerContext";
import { colors, spacing } from "../theme";
import { formatTime } from "../utils/format";

export default function PlayerScreen() {
  const {
    currentSong,
    currentTime,
    duration,
    isPlaying,
    isRepeatOn,
    isShuffleOn,
    seekBy,
    seekTo,
    togglePlay,
    toggleRepeat,
    toggleShuffle,
  } = usePlayer();
  const { width } = useWindowDimensions();
  const [isSliding, setIsSliding] = useState(false);
  const [sliderValue, setSliderValue] = useState(0);
  const displayTime = isSliding ? sliderValue : currentTime;
  const seekProgress = duration > 0 ? Math.min(Math.max(displayTime / duration, 0), 1) : 0;
  const coverSize = Math.min(width - spacing.page * 2, 360);

  if (!currentSong) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.empty}>Choose a song to start listening.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <LinearGradient colors={["#2A1608", colors.background, "#050505"]} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={[styles.coverShell, { height: coverSize, width: coverSize }]}>
            <Image source={{ uri: currentSong.cover_image }} style={styles.cover} />
          </View>

          <View style={styles.songInfo}>
            <View style={styles.nowRow}>
              <View style={styles.liveDot} />
              <Text style={styles.nowText}>Now playing</Text>
            </View>
            <Text style={styles.title} numberOfLines={2}>{currentSong.title}</Text>
            <Text style={styles.artist} numberOfLines={1}>{currentSong.artist_name}</Text>
          </View>

          <View style={styles.sliderPanel}>
            <SeekBar
              progress={seekProgress}
              height={10}
              thumbSize={24}
              onSeekStart={() => {
                setIsSliding(true);
                setSliderValue(currentTime);
              }}
              onSeekPreview={(nextProgress) => {
                setSliderValue(duration * nextProgress);
              }}
              onSeekComplete={(nextProgress) => {
                setIsSliding(false);
                seekTo(duration * nextProgress);
              }}
            />
          </View>
          <View style={styles.timeRow}>
            <Text style={styles.time}>{formatTime(displayTime)}</Text>
            <Text style={styles.time}>{formatTime(duration)}</Text>
          </View>

          <View style={styles.controls}>
            <TouchableOpacity
              style={[styles.sideIconButton, isShuffleOn && styles.activeSideIconButton]}
              onPress={toggleShuffle}
            >
              <Ionicons name="shuffle" color={isShuffleOn ? colors.accent : colors.muted} size={22} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => seekBy(-10)}>
              <Ionicons name="play-back" color={colors.text} size={28} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.playButton} onPress={togglePlay}>
              <Ionicons name={isPlaying ? "pause" : "play"} color={colors.text} size={38} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => seekBy(10)}>
              <Ionicons name="play-forward" color={colors.text} size={28} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sideIconButton, isRepeatOn && styles.activeSideIconButton]}
              onPress={toggleRepeat}
            >
              <Ionicons name="repeat" color={isRepeatOn ? colors.accent : colors.muted} size={22} />
            </TouchableOpacity>
          </View>

        <View style={styles.lyricsPanel}>
          <Text style={styles.lyricsTitle}>Lyrics</Text>
          <Text style={styles.lyricsText}>
            {currentSong.lyrics?.trim() || "Lyrics have not been added yet."}
          </Text>
        </View>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: colors.background,
    flex: 1,
  },
  gradient: {
    flex: 1,
  },
  content: {
    alignItems: "center",
    padding: spacing.page,
    paddingBottom: 40,
  },
  coverShell: {
    backgroundColor: colors.elevated,
    borderColor: "rgba(250, 204, 21, 0.28)",
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 8,
    padding: 8,
    shadowColor: colors.primary,
    shadowOffset: { height: 16, width: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 28,
  },
  cover: {
    backgroundColor: colors.elevated,
    borderRadius: 8,
    height: "100%",
    width: "100%",
  },
  songInfo: {
    alignItems: "flex-start",
    alignSelf: "stretch",
    marginTop: 28,
  },
  nowRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  liveDot: {
    backgroundColor: colors.accent,
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  nowText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  title: {
    color: colors.text,
    fontSize: 31,
    fontWeight: "900",
    textAlign: "left",
  },
  artist: {
    color: colors.softText,
    fontSize: 16,
    marginTop: 8,
  },
  sliderPanel: {
    marginTop: 34,
    width: "100%",
  },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
    width: "100%",
  },
  time: {
    color: colors.muted,
    fontSize: 12,
  },
  controls: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 30,
    width: "100%",
  },
  lyricsPanel: {
    alignSelf: "stretch",
    backgroundColor: "rgba(24, 24, 27, 0.82)",
    borderColor: "rgba(250, 204, 21, 0.16)",
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    marginTop: 34,
    padding: 16,
  },
  lyricsTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  lyricsText: {
    color: colors.softText,
    fontSize: 15,
    lineHeight: 23,
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.elevated,
    borderRadius: 29,
    height: 58,
    justifyContent: "center",
    width: 58,
  },
  playButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 38,
    height: 76,
    justifyContent: "center",
    shadowColor: colors.primary,
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.38,
    shadowRadius: 14,
    width: 76,
  },
  sideIconButton: {
    alignItems: "center",
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  activeSideIconButton: {
    backgroundColor: "rgba(250, 204, 21, 0.16)",
  },
  empty: {
    color: colors.softText,
    fontSize: 16,
    padding: spacing.page,
    textAlign: "center",
  },
});

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useState } from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { getShareableSong } from "../api/musicApi";
import SongShareModal from "../components/SongShareModal";
import AppAccess from "../components/AppAccess";
import { useAuth } from "../context/AuthContext";
import { useEngagement } from "../context/EngagementContext";
import { usePlayer } from "../context/PlayerContext";
import { colors, spacing } from "../theme";
import { artworkSource } from "../utils/artwork";

export default function SongScreen({ navigation, route }) {
  const id = route?.params?.id;
  const [song, setSong] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [shareVisible, setShareVisible] = useState(false);
  const { isAuthenticated } = useAuth();
  const { currentSong, playSong, isPlaying, togglePlay } = usePlayer();
  const { isSongLiked, isSongLikePending, toggleSongLike } = useEngagement();
  useFocusEffect(useCallback(() => {
    let active = true;
    setSong(null);
    setLoading(true);
    setError("");
    getShareableSong(id)
      .then(item => { if (active) setSong(item); })
      .catch(() => { if (active) setError("This song is unavailable or could not be loaded. Please try again later."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]));

  function play() {
    if (!song) return;
    if (String(currentSong?.id) !== String(song.id)) playSong(song, [song]);
    else if (!isPlaying) togglePlay();
    navigation.navigate("Player");
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity accessibilityLabel="Discover TesoHub Music" onPress={() => navigation.navigate("TesoTabs", { screen: "Home" })}>
          <Text style={styles.brand}>TesoHub Music</Text>
        </TouchableOpacity>
        {loading ? <ActivityIndicator color={colors.primary} /> : error ? <>
          <Text style={styles.title}>Song unavailable</Text>
          <Text style={styles.text}>{error}</Text>
        </> : song ? <>
          <View style={styles.artwork}><Image accessibilityLabel={`${song.title} artwork`} source={artworkSource(song.cover_image)} style={styles.image} /></View>
          <Text style={styles.title}>{song.title}</Text>
          <TouchableOpacity accessibilityLabel="View artist profile" onPress={() => navigation.navigate("ArtistDetail", { id: song.artist })}>
            <Text style={styles.artist}>{song.artist_name}</Text>
          </TouchableOpacity>
          <View style={styles.actions}>
            <TouchableOpacity accessibilityLabel="Play shared song" style={styles.play} onPress={play}>
              <Ionicons name="play" color={colors.background} size={22} /><Text style={styles.playText}>Play</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityLabel={isSongLiked(song.id) ? "Unlike song" : "Like song"}
              disabled={isSongLikePending(song.id)}
              style={styles.icon}
              onPress={() => isAuthenticated ? toggleSongLike(song) : navigation.navigate("Profile", { loginRequired: true })}
            >
              <Ionicons name={isSongLiked(song.id) ? "heart" : "heart-outline"} color={colors.primary} size={26} />
            </TouchableOpacity>
            <TouchableOpacity accessibilityLabel="Share song" style={styles.icon} onPress={() => setShareVisible(true)}>
              <Ionicons name="share-social-outline" color={colors.text} size={25} />
            </TouchableOpacity>
          </View>
        </> : null}
        <AppAccess path={`/song/${id}`} />
        <TouchableOpacity style={styles.discover} onPress={() => navigation.navigate("TesoTabs", { screen: "Home" })}>
          <Text style={styles.discoveryText}>Discover more music</Text><Ionicons name="arrow-forward" size={20} color={colors.primary} />
        </TouchableOpacity>
      </ScrollView>
      <SongShareModal visible={shareVisible} song={song} onClose={() => setShareVisible(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.page, paddingBottom: 40, alignItems: "center", gap: 18 },
  brand: { color: colors.primary, fontSize: 20, fontWeight: "900", marginVertical: 12 },
  artwork: { width: "100%", maxWidth: 350, aspectRatio: 1 },
  image: { width: "100%", height: "100%", borderRadius: 8 },
  title: { color: colors.text, fontSize: 28, fontWeight: "900", textAlign: "center", maxWidth: "100%" },
  artist: { color: colors.softText, fontSize: 18, textAlign: "center" },
  text: { color: colors.muted, fontSize: 15, lineHeight: 22, textAlign: "center" },
  actions: { flexDirection: "row", alignItems: "center", gap: 16, flexWrap: "wrap", justifyContent: "center" },
  play: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 28, minHeight: 48, borderRadius: 8, backgroundColor: colors.primary },
  playText: { color: colors.background, fontSize: 16, fontWeight: "900" },
  icon: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  discover: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12, minHeight: 48 },
  discoveryText: { color: colors.primary, fontSize: 15, fontWeight: "800" },
});

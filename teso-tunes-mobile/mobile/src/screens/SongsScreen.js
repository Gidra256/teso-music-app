import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, BackHandler, FlatList, Platform, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BACKEND_CONNECTION_ERROR, getSongs } from "../api/musicApi";
import CategoryFilter from "../components/CategoryFilter";
import MiniPlayer from "../components/MiniPlayer";
import ProfileAvatarButton from "../components/ProfileAvatarButton";
import SearchBar from "../components/SearchBar";
import SongCard from "../components/SongCard";
import SongActionsModal from "../components/SongActionsModal";
import { colors, spacing } from "../theme";

export default function SongsScreen({ navigation }) {
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 900;
  const [menuSong, setMenuSong] = useState(null);
  const [songs, setSongs] = useState([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useFocusEffect(useCallback(() => {
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (navigation.canGoBack()) return false;
      navigation.navigate("Home");
      return true;
    });
    return () => subscription.remove();
  }, [navigation]));

  const loadSongs = useCallback(() => {
    setLoading(true);
    getSongs()
      .then((items) => {
        setError("");
        setSongs(items);
      })
      .catch((loadError) => {
        setError(loadError?.message || BACKEND_CONNECTION_ERROR);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadSongs();
  }, [loadSongs]);

  const filteredSongs = useMemo(() => {
    return songs.filter((song) => {
      const matchesQuery =
        song.title.toLowerCase().includes(query.toLowerCase()) ||
        song.artist_name.toLowerCase().includes(query.toLowerCase());
      const matchesCategory = category === "All" || song.artist_category === category;
      return matchesQuery && matchesCategory;
    });
  }, [songs, query, category]);

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.safe}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <TouchableOpacity
            activeOpacity={0.82}
            accessibilityLabel="Go back"
            style={styles.navButton}
            onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Home")}
          >
            <Ionicons name="arrow-back" color={colors.softText} size={21} />
          </TouchableOpacity>
          <Text style={styles.title}>Songs</Text>
          <View style={styles.titleSpacer} />
          {!isDesktopWeb ? <ProfileAvatarButton /> : null}
        </View>
        <SearchBar value={query} onChangeText={setQuery} placeholder="Search songs or artists" />
        <CategoryFilter selected={category} onSelect={setCategory} />
      </View>
      {loading ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : error ? (
        <View style={styles.stateBlock}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity activeOpacity={0.84} style={styles.retryButton} onPress={loadSongs}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          testID="browse-songs-list"
          data={filteredSongs}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <SongCard song={item} queue={filteredSongs} onMenuPress={setMenuSong} />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>No music available yet.</Text>}
          showsVerticalScrollIndicator={false}
        />
      )}
      <MiniPlayer />
      <SongActionsModal song={menuSong} queue={filteredSongs} onClose={() => setMenuSong(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: colors.background,
    flex: 1,
  },
  header: {
    gap: 12,
    padding: spacing.page,
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  titleSpacer: {
    flex: 1,
  },
  navButton: {
    alignItems: "center",
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "900",
  },
  list: {
    gap: 4,
    padding: spacing.page,
    paddingBottom: 110,
    paddingTop: 0,
  },
  loader: {
    marginTop: 30,
  },
  errorText: {
    color: colors.softText,
    fontSize: 15,
    lineHeight: 22,
    padding: spacing.page,
    textAlign: "center",
  },
  stateBlock: {
    alignItems: "center",
    gap: 12,
    padding: spacing.page,
  },
  empty: {
    color: colors.muted,
    marginTop: 24,
    textAlign: "center",
  },
  retryButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 18,
  },
  retryText: {
    color: colors.background,
    fontSize: 13,
    fontWeight: "900",
  },
});

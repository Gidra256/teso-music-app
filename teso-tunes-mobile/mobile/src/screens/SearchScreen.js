import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BACKEND_CONNECTION_ERROR, getSongs } from "../api/musicApi";
import MiniPlayer from "../components/MiniPlayer";
import ProfileAvatarButton from "../components/ProfileAvatarButton";
import SearchBar from "../components/SearchBar";
import SongCard from "../components/SongCard";
import { colors, spacing } from "../theme";

export default function SearchScreen() {
  const [query, setQuery] = useState("");
  const [songs, setSongs] = useState([]);
  const [error, setError] = useState("");

  const loadSongs = useCallback(() => {
    getSongs()
      .then((items) => {
        setError("");
        setSongs(items);
      })
      .catch((loadError) => {
        setError(loadError?.message || BACKEND_CONNECTION_ERROR);
      });
  }, []);

  useEffect(() => {
    loadSongs();
  }, [loadSongs]);

  const results = useMemo(() => {
    if (!query.trim()) return songs.slice(0, 12);
    return songs.filter((song) => {
      const needle = query.toLowerCase();
      return (
        song.title.toLowerCase().includes(needle) ||
        song.artist_name.toLowerCase().includes(needle) ||
        (song.genre || "").toLowerCase().includes(needle)
      );
    });
  }, [songs, query]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <ProfileAvatarButton />
          <Text style={styles.title}>Search</Text>
          <View style={styles.titleSpacer} />
        </View>
        <SearchBar value={query} onChangeText={setQuery} placeholder="Find songs, artists, genres" />
      </View>
      {error ? (
        <View style={styles.stateBlock}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity activeOpacity={0.84} style={styles.retryButton} onPress={loadSongs}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <SongCard song={item} queue={results} />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>No songs found.</Text>}
          showsVerticalScrollIndicator={false}
        />
      )}
      <MiniPlayer />
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
  empty: {
    color: colors.muted,
    marginTop: 24,
    textAlign: "center",
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

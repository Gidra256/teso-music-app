import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BACKEND_CONNECTION_ERROR, getSongs } from "../api/musicApi";
import CategoryFilter from "../components/CategoryFilter";
import MiniPlayer from "../components/MiniPlayer";
import SearchBar from "../components/SearchBar";
import SongCard from "../components/SongCard";
import { colors, spacing } from "../theme";

export default function SongsScreen() {
  const [songs, setSongs] = useState([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
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
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Songs</Text>
        <SearchBar value={query} onChangeText={setQuery} placeholder="Search songs or artists" />
        <CategoryFilter selected={category} onSelect={setCategory} />
      </View>
      {loading ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : (
        <FlatList
          data={filteredSongs}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <SongCard song={item} queue={filteredSongs} />}
          contentContainerStyle={styles.list}
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
    gap: 14,
    padding: spacing.page,
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "900",
  },
  list: {
    gap: 12,
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
});

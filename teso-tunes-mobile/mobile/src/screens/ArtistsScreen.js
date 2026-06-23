import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BACKEND_CONNECTION_ERROR, getArtists } from "../api/musicApi";
import ArtistCard from "../components/ArtistCard";
import CategoryFilter from "../components/CategoryFilter";
import MiniPlayer from "../components/MiniPlayer";
import SearchBar from "../components/SearchBar";
import { colors, spacing } from "../theme";

export default function ArtistsScreen({ navigation }) {
  const [artists, setArtists] = useState([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getArtists()
      .then((items) => {
        setError("");
        setArtists(items);
      })
      .catch((loadError) => {
        setError(loadError?.message || BACKEND_CONNECTION_ERROR);
      })
      .finally(() => setLoading(false));
  }, []);

  const filteredArtists = useMemo(() => {
    return artists.filter((artist) => {
      const matchesQuery = artist.name.toLowerCase().includes(query.toLowerCase());
      const matchesCategory = category === "All" || artist.category === category;
      return matchesQuery && matchesCategory;
    });
  }, [artists, query, category]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Artists</Text>
        <SearchBar value={query} onChangeText={setQuery} placeholder="Search artists" />
        <CategoryFilter selected={category} onSelect={setCategory} />
      </View>
      {loading ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : (
        <FlatList
          data={filteredArtists}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <ArtistCard artist={item} onPress={() => navigation.navigate("ArtistDetail", { id: item.id })} />
          )}
          contentContainerStyle={styles.grid}
          numColumns={2}
          columnWrapperStyle={styles.row}
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
  grid: {
    gap: 12,
    padding: spacing.page,
    paddingBottom: 110,
    paddingTop: 0,
  },
  row: {
    gap: 12,
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

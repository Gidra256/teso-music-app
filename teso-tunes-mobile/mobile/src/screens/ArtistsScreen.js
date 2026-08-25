import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BACKEND_CONNECTION_ERROR, getArtists } from "../api/musicApi";
import ArtistCard from "../components/ArtistCard";
import CategoryFilter from "../components/CategoryFilter";
import MiniPlayer from "../components/MiniPlayer";
import ProfileAvatarButton from "../components/ProfileAvatarButton";
import SearchBar from "../components/SearchBar";
import { colors, spacing } from "../theme";

export default function ArtistsScreen({ navigation }) {
  const [artists, setArtists] = useState([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadArtists = useCallback(() => {
    setLoading(true);
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

  useEffect(() => {
    loadArtists();
  }, [loadArtists]);

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
        <View style={styles.titleRow}>
          {navigation?.canGoBack?.() ? (
            <TouchableOpacity
              activeOpacity={0.82}
              accessibilityLabel="Go back"
              style={styles.navButton}
              onPress={() => navigation.goBack()}
            >
              <Ionicons name="arrow-back" color={colors.softText} size={21} />
            </TouchableOpacity>
          ) : (
            <ProfileAvatarButton />
          )}
          <Text style={styles.title}>Artists</Text>
          <View style={styles.titleSpacer} />
        </View>
        <SearchBar value={query} onChangeText={setQuery} placeholder="Search artists" />
        <CategoryFilter selected={category} onSelect={setCategory} />
      </View>
      {loading ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : error ? (
        <View style={styles.stateBlock}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity activeOpacity={0.84} style={styles.retryButton} onPress={loadArtists}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filteredArtists}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <ArtistCard artist={item} onPress={() => navigation.navigate("ArtistDetail", { id: item.id })} />
          )}
          contentContainerStyle={styles.grid}
          ListEmptyComponent={<Text style={styles.empty}>No artists available yet.</Text>}
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
  grid: {
    gap: 18,
    padding: spacing.page,
    paddingBottom: 110,
    paddingTop: 0,
  },
  row: {
    gap: 18,
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

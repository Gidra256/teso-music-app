import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BACKEND_CONNECTION_ERROR, getArtists, getSongs } from "../api/musicApi";
import ArtistCard from "../components/ArtistCard";
import MiniPlayer from "../components/MiniPlayer";
import ProfileAvatarButton from "../components/ProfileAvatarButton";
import SearchBar from "../components/SearchBar";
import SongCard from "../components/SongCard";
import { colors, spacing } from "../theme";

export default function SearchScreen({ navigation }) {
  const [query, setQuery] = useState("");
  const [songs, setSongs] = useState([]);
  const [artists, setArtists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadSongs = useCallback(() => {
    setLoading(true);
    Promise.all([getSongs(), getArtists()])
      .then(([songItems, artistItems]) => {
        setError("");
        setSongs(Array.isArray(songItems) ? songItems : []);
        setArtists(Array.isArray(artistItems) ? artistItems : []);
      })
      .catch((loadError) => {
        setError(loadError?.message || BACKEND_CONNECTION_ERROR);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadSongs();
  }, [loadSongs]);

  const songResults = useMemo(() => {
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

  const artistResults = useMemo(() => {
    if (!query.trim()) return artists.slice(0, 8);
    return artists.filter((artist) => {
      const needle = query.toLowerCase();
      return (
        artist.name.toLowerCase().includes(needle) ||
        (artist.category || "").toLowerCase().includes(needle) ||
        (artist.location || "").toLowerCase().includes(needle)
      );
    });
  }, [artists, query]);

  const hasResults = songResults.length > 0 || artistResults.length > 0;

  function openArtist(artist) {
    const parentNavigation = navigation.getParent?.();
    if (parentNavigation?.navigate) {
      parentNavigation.navigate("ArtistDetail", { id: artist.id });
      return;
    }

    navigation.navigate("ArtistDetail", { id: artist.id });
  }

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
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {artistResults.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Artists</Text>
              <View style={styles.artistGrid}>
                {artistResults.map((artist) => (
                  <View key={artist.id} style={styles.artistCell}>
                    <ArtistCard
                      artist={artist}
                      onPress={() => openArtist(artist)}
                    />
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {songResults.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Songs</Text>
              <View style={styles.songList}>
                {songResults.map((song) => (
                  <SongCard key={song.id} song={song} queue={songResults} />
                ))}
              </View>
            </View>
          ) : null}

          {!hasResults ? <Text style={styles.empty}>No songs or artists found.</Text> : null}
        </ScrollView>
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
  section: {
    gap: 12,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: "950",
  },
  songList: {
    gap: 4,
  },
  artistGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 18,
  },
  artistCell: {
    width: "47%",
  },
  loader: {
    marginTop: 30,
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

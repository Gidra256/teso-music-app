import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  BACKEND_CONNECTION_ERROR,
  getArtists,
  getFeaturedArtists,
  getFeaturedSongs,
  getSongs,
} from "../api/musicApi";
import ArtistCard from "../components/ArtistCard";
import MiniPlayer from "../components/MiniPlayer";
import ProfileAvatarButton from "../components/ProfileAvatarButton";
import SongCard from "../components/SongCard";
import { useEngagement } from "../context/EngagementContext";
import { colors, spacing } from "../theme";

export default function HomeScreen({ navigation }) {
  const { getArtistFollowerCount, getSongLikeCount } = useEngagement();
  const [search, setSearch] = useState("");
  const [songs, setSongs] = useState([]);
  const [artists, setArtists] = useState([]);
  const [featuredSongs, setFeaturedSongs] = useState([]);
  const [featuredArtists, setFeaturedArtists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadHome() {
      try {
        setError("");
        const [allSongs, allArtists, heroSongs, heroArtists] = await Promise.all([
          getSongs(),
          getArtists(),
          getFeaturedSongs(),
          getFeaturedArtists(),
        ]);
        setSongs(allSongs);
        setArtists(allArtists);
        setFeaturedSongs(heroSongs);
        setFeaturedArtists(heroArtists);
      } catch (loadError) {
        setError(loadError?.message || BACKEND_CONNECTION_ERROR);
      } finally {
        setLoading(false);
      }
    }
    loadHome();
  }, []);

  const trendingSongs = useMemo(
    () => songs.filter((song) => song.title.toLowerCase().includes(search.toLowerCase())).slice(0, 10),
    [songs, search]
  );

  const mostLikedSongs = useMemo(
    () => [...songs].sort((first, second) => getSongLikeCount(second) - getSongLikeCount(first)).slice(0, 8),
    [songs, getSongLikeCount]
  );

  const mostFollowedArtists = useMemo(
    () =>
      [...artists]
        .sort((first, second) => getArtistFollowerCount(second) - getArtistFollowerCount(first))
        .slice(0, 8),
    [artists, getArtistFollowerCount]
  );

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topRow}>
          <ProfileAvatarButton />
          <TouchableOpacity style={styles.activeChip} onPress={() => setSearch("")}>
            <Text style={styles.activeChipText}>All</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.chip} onPress={() => setSearch("")}>
            <Text style={styles.chipText}>Music</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : (
          <>
            <SectionTitle title="Featured songs" />
            <FlatList
              horizontal
              data={featuredSongs}
              keyExtractor={(item) => String(item.id)}
              renderItem={({ item }) => <SongCard song={item} compact queue={featuredSongs} />}
              showsHorizontalScrollIndicator={false}
              ItemSeparatorComponent={() => <View style={{ width: 12 }} />}
            />

            <SectionTitle title="Featured artists" />
            <FlatList
              horizontal
              data={featuredArtists}
              keyExtractor={(item) => String(item.id)}
              renderItem={({ item }) => (
                <ArtistCard artist={item} compact onPress={() => navigation.navigate("ArtistDetail", { id: item.id })} />
              )}
              showsHorizontalScrollIndicator={false}
              ItemSeparatorComponent={() => <View style={{ width: 12 }} />}
            />

            <SectionTitle title="Most liked songs" />
            <FlatList
              horizontal
              data={mostLikedSongs}
              keyExtractor={(item) => String(item.id)}
              renderItem={({ item }) => <SongCard song={item} compact queue={mostLikedSongs} />}
              showsHorizontalScrollIndicator={false}
              ItemSeparatorComponent={() => <View style={{ width: 12 }} />}
            />

            <SectionTitle title="Most followed artists" />
            <FlatList
              horizontal
              data={mostFollowedArtists}
              keyExtractor={(item) => String(item.id)}
              renderItem={({ item }) => (
                <ArtistCard artist={item} compact onPress={() => navigation.navigate("ArtistDetail", { id: item.id })} />
              )}
              showsHorizontalScrollIndicator={false}
              ItemSeparatorComponent={() => <View style={{ width: 12 }} />}
            />

            <SectionTitle title="Trending now" />
            <View style={styles.list}>
              {trendingSongs.map((song) => (
                <SongCard key={song.id} song={song} queue={trendingSongs} />
              ))}
            </View>
          </>
        )}
      </ScrollView>
      <MiniPlayer />
    </SafeAreaView>
  );
}

function SectionTitle({ title }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    gap: 16,
    padding: spacing.page,
    paddingBottom: 100,
  },
  topRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    marginBottom: 18,
  },
  activeChip: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 22,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 18,
  },
  activeChipText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: "900",
  },
  chip: {
    alignItems: "center",
    backgroundColor: colors.elevated,
    borderRadius: 22,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 18,
  },
  chipText: {
    color: colors.softText,
    fontSize: 14,
    fontWeight: "800",
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
    marginTop: 4,
  },
  list: {
    gap: 12,
  },
  loader: {
    marginTop: 30,
  },
  errorText: {
    color: colors.softText,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 20,
    textAlign: "center",
  },
});

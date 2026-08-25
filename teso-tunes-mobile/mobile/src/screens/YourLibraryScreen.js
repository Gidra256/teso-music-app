import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  BACKEND_CONNECTION_ERROR,
  getArtists,
  getPlaylists,
  getSongs,
} from "../api/musicApi";
import ArtistCard from "../components/ArtistCard";
import CreatePlaylistModal from "../components/CreatePlaylistModal";
import MiniPlayer from "../components/MiniPlayer";
import ProfileAvatarButton from "../components/ProfileAvatarButton";
import SongCard from "../components/SongCard";
import { useAuth } from "../context/AuthContext";
import { useEngagement } from "../context/EngagementContext";
import { usePlayer } from "../context/PlayerContext";
import { colors, spacing } from "../theme";

const FILTERS = ["Playlists", "Liked", "Downloads", "Artists"];

function idSet(...groups) {
  return new Set(
    groups
      .flat()
      .filter((value) => value !== null && value !== undefined)
      .map((value) => Number(value))
  );
}

export default function YourLibraryScreen({ navigation, route }) {
  const { isAuthenticated, listener, refreshAccount } = useAuth();
  const { followedArtistIds, likedSongIds } = useEngagement();
  const { recentlyPlayed } = usePlayer();
  const [activeFilter, setActiveFilter] = useState("Playlists");
  const [songs, setSongs] = useState([]);
  const [artists, setArtists] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createVisible, setCreateVisible] = useState(false);

  const loadLibrary = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const [songItems, artistItems, playlistItems] = await Promise.all([
        getSongs(),
        getArtists(),
        isAuthenticated ? getPlaylists() : Promise.resolve([]),
      ]);

      if (isAuthenticated) {
        refreshAccount().catch(() => {});
      }

      setSongs(Array.isArray(songItems) ? songItems : []);
      setArtists(Array.isArray(artistItems) ? artistItems : []);
      setPlaylists(Array.isArray(playlistItems) ? playlistItems : []);
    } catch (loadError) {
      setError(loadError?.message || BACKEND_CONNECTION_ERROR);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, route?.params?.refreshKey]);

  useFocusEffect(
    useCallback(() => {
      loadLibrary();
    }, [loadLibrary])
  );

  const likedIds = useMemo(
    () => idSet(likedSongIds, listener?.liked_song_ids),
    [likedSongIds, listener?.liked_song_ids]
  );

  const followedIds = useMemo(
    () => idSet(followedArtistIds, listener?.followed_artist_ids),
    [followedArtistIds, listener?.followed_artist_ids]
  );

  const likedSongs = useMemo(
    () => songs.filter((song) => likedIds.has(Number(song.id))),
    [likedIds, songs]
  );

  const followedArtists = useMemo(
    () => artists.filter((artist) => followedIds.has(Number(artist.id))),
    [artists, followedIds]
  );

  function navigateStack(name, params) {
    const parentNavigation = navigation.getParent?.();
    if (parentNavigation?.navigate) {
      parentNavigation.navigate(name, params);
      return;
    }

    navigation.navigate(name, params);
  }

  function openCreate() {
    if (!isAuthenticated) {
      navigateStack("Profile", { loginRequired: true });
      return;
    }
    setCreateVisible(true);
  }

  function openPlaylist(playlist) {
    navigateStack("PlaylistDetail", { id: playlist.id });
  }

  function handleCreated(playlist) {
    setPlaylists((items) => [playlist, ...items]);
    navigateStack("PlaylistDetail", { id: playlist.id });
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <ProfileAvatarButton />
          <Text style={styles.title}>Your Library</Text>
          <TouchableOpacity
            activeOpacity={0.84}
            accessibilityLabel="Create playlist"
            style={styles.createIcon}
            onPress={openCreate}
          >
            <Ionicons name="add" color={colors.text} size={25} />
          </TouchableOpacity>
        </View>

        <ScrollView
          horizontal
          contentContainerStyle={styles.chips}
          showsHorizontalScrollIndicator={false}
        >
          {FILTERS.map((filter) => {
            const active = filter === activeFilter;
            return (
              <TouchableOpacity
                key={filter}
                activeOpacity={0.84}
                style={[styles.chip, active && styles.activeChip]}
                onPress={() => setActiveFilter(filter)}
              >
                <Text style={[styles.chipText, active && styles.activeChipText]}>{filter}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {recentlyPlayed.length > 0 ? (
          <View style={styles.section}>
            <SectionHeader title="Recently played" />
            <FlatList
              horizontal
              data={recentlyPlayed}
              keyExtractor={(item) => String(item.id)}
              renderItem={({ item }) => <SongCard song={item} compact queue={recentlyPlayed} />}
              showsHorizontalScrollIndicator={false}
              ItemSeparatorComponent={() => <View style={{ width: 12 }} />}
            />
          </View>
        ) : null}

        {loading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : error ? (
          <View style={styles.stateBlock}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity activeOpacity={0.84} style={styles.primaryButton} onPress={loadLibrary}>
              <Text style={styles.primaryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.section}>
            {activeFilter === "Playlists" ? (
              <PlaylistList
                isAuthenticated={isAuthenticated}
                playlists={playlists}
                onCreate={openCreate}
                onOpen={openPlaylist}
                onSignIn={() => navigateStack("Profile", { loginRequired: true })}
              />
            ) : null}

            {activeFilter === "Liked" ? (
              <SongList
                emptyText="Liked songs will appear here."
                songs={likedSongs}
              />
            ) : null}

            {activeFilter === "Downloads" ? (
              <View style={styles.emptyBlock}>
                <Ionicons name="download-outline" color={colors.accent} size={34} />
                <Text style={styles.emptyTitle}>Downloads</Text>
                <Text style={styles.emptyText}>Offline downloads are not enabled yet.</Text>
              </View>
            ) : null}

            {activeFilter === "Artists" ? (
              <ArtistList
                artists={followedArtists}
                onOpen={(artist) => navigateStack("ArtistDetail", { id: artist.id })}
              />
            ) : null}
          </View>
        )}
      </ScrollView>

      <CreatePlaylistModal
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        onCreated={handleCreated}
      />
      <MiniPlayer />
    </SafeAreaView>
  );
}

function SectionHeader({ title }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

function PlaylistList({ isAuthenticated, playlists, onCreate, onOpen, onSignIn }) {
  if (!isAuthenticated) {
    return (
      <View style={styles.emptyBlock}>
        <Ionicons name="library-outline" color={colors.accent} size={34} />
        <Text style={styles.emptyTitle}>Sign in for playlists</Text>
        <Text style={styles.emptyText}>Create and manage playlists from your account.</Text>
        <TouchableOpacity activeOpacity={0.86} style={styles.primaryButton} onPress={onSignIn}>
          <Text style={styles.primaryText}>Sign In</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (playlists.length === 0) {
    return (
      <View style={styles.emptyBlock}>
        <Ionicons name="list" color={colors.accent} size={34} />
        <Text style={styles.emptyTitle}>No playlists yet</Text>
        <Text style={styles.emptyText}>Start with a playlist for your favorite TesoHub songs.</Text>
        <TouchableOpacity activeOpacity={0.86} style={styles.primaryButton} onPress={onCreate}>
          <Ionicons name="add" color={colors.background} size={18} />
          <Text style={styles.primaryText}>Create Playlist</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.verticalList}>
      {playlists.map((playlist) => (
        <TouchableOpacity
          key={playlist.id}
          activeOpacity={0.84}
          style={styles.playlistRow}
          onPress={() => onOpen(playlist)}
        >
          <View style={styles.playlistCover}>
            <Ionicons name="list" color={colors.primary} size={22} />
          </View>
          <View style={styles.rowCopy}>
            <Text style={styles.rowTitle} numberOfLines={1}>{playlist.name}</Text>
            <Text style={styles.rowMeta}>
              Playlist - {playlist.song_count || 0} {(playlist.song_count || 0) === 1 ? "song" : "songs"}
            </Text>
          </View>
          <Ionicons name="chevron-forward" color={colors.muted} size={19} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

function SongList({ songs, emptyText }) {
  if (songs.length === 0) {
    return (
      <View style={styles.emptyBlock}>
        <Ionicons name="heart-outline" color={colors.accent} size={34} />
        <Text style={styles.emptyTitle}>Nothing here yet</Text>
        <Text style={styles.emptyText}>{emptyText}</Text>
      </View>
    );
  }

  return (
    <View style={styles.verticalList}>
      {songs.map((song) => (
        <SongCard key={song.id} song={song} queue={songs} />
      ))}
    </View>
  );
}

function ArtistList({ artists, onOpen }) {
  if (artists.length === 0) {
    return (
      <View style={styles.emptyBlock}>
        <Ionicons name="people-outline" color={colors.accent} size={34} />
        <Text style={styles.emptyTitle}>No followed artists yet</Text>
        <Text style={styles.emptyText}>Artists you follow will appear here.</Text>
      </View>
    );
  }

  return (
    <View style={styles.artistGrid}>
      {artists.map((artist) => (
        <View key={artist.id} style={styles.artistCell}>
          <ArtistCard
            artist={artist}
            onPress={() => onOpen(artist)}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    gap: 18,
    padding: spacing.page,
    paddingBottom: 110,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  title: {
    color: colors.text,
    flex: 1,
    fontSize: 28,
    fontWeight: "950",
  },
  createIcon: {
    alignItems: "center",
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  chips: {
    gap: 10,
  },
  chip: {
    alignItems: "center",
    backgroundColor: colors.elevated,
    borderRadius: 22,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 16,
  },
  activeChip: {
    backgroundColor: colors.primary,
  },
  chipText: {
    color: colors.softText,
    fontSize: 13,
    fontWeight: "850",
  },
  activeChipText: {
    color: colors.background,
    fontWeight: "950",
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "950",
  },
  verticalList: {
    gap: 8,
  },
  playlistRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 64,
  },
  playlistCover: {
    alignItems: "center",
    backgroundColor: colors.elevated,
    borderRadius: 5,
    height: 58,
    justifyContent: "center",
    width: 58,
  },
  rowCopy: {
    flex: 1,
  },
  rowTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  rowMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 4,
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
  stateBlock: {
    alignItems: "center",
    gap: 12,
    marginTop: 34,
  },
  errorText: {
    color: colors.softText,
    fontSize: 15,
    textAlign: "center",
  },
  emptyBlock: {
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 34,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "950",
    textAlign: "center",
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 8,
    flexDirection: "row",
    gap: 7,
    justifyContent: "center",
    marginTop: 4,
    minHeight: 46,
    paddingHorizontal: 18,
  },
  primaryText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: "950",
  },
});

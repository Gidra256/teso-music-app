import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BACKEND_CONNECTION_ERROR, getArtists, getSongs } from "../api/musicApi";
import ArtistCard from "../components/ArtistCard";
import MiniPlayer from "../components/MiniPlayer";
import SongCard from "../components/SongCard";
import { useEngagement } from "../context/EngagementContext";
import { colors, spacing } from "../theme";

const PROFILE_NAME_KEY = "teso_tunes_profile_name";
const DEFAULT_NAME = "Teso Listener";

export default function ProfileScreen({ navigation }) {
  const { deviceId, followedArtistIds, likedSongIds } = useEngagement();
  const [profileName, setProfileName] = useState(DEFAULT_NAME);
  const [draftName, setDraftName] = useState(DEFAULT_NAME);
  const [songs, setSongs] = useState([]);
  const [artists, setArtists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadProfile = useCallback(async ({ refresh = false } = {}) => {
    try {
      if (refresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError("");

      const [savedName, nextSongs, nextArtists] = await Promise.all([
        AsyncStorage.getItem(PROFILE_NAME_KEY),
        getSongs(),
        getArtists(),
      ]);

      const safeName = savedName || DEFAULT_NAME;
      setProfileName(safeName);
      setDraftName(safeName);
      setSongs(nextSongs);
      setArtists(nextArtists);
    } catch (loadError) {
      setError(loadError?.message || BACKEND_CONNECTION_ERROR);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const likedSongSet = useMemo(() => new Set(likedSongIds), [likedSongIds]);
  const followedArtistSet = useMemo(
    () => new Set(followedArtistIds),
    [followedArtistIds]
  );

  const likedSongs = useMemo(
    () => songs.filter((song) => likedSongSet.has(Number(song.id))),
    [songs, likedSongSet]
  );

  const followedArtists = useMemo(
    () => artists.filter((artist) => followedArtistSet.has(Number(artist.id))),
    [artists, followedArtistSet]
  );

  const topGenre = useMemo(() => {
    const counts = likedSongs.reduce((items, song) => {
      const genre = song.genre || "Teso music";
      items[genre] = (items[genre] || 0) + 1;
      return items;
    }, {});
    const [genre] =
      Object.entries(counts).sort((first, second) => second[1] - first[1])[0] ||
      [];
    return genre || "Teso music";
  }, [likedSongs]);

  const initials = useMemo(() => {
    return profileName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "TT";
  }, [profileName]);

  const listenerCode = deviceId ? deviceId.slice(-8).toUpperCase() : "SYNCING";
  const hasNameChange = draftName.trim() && draftName.trim() !== profileName;

  async function saveProfileName() {
    const nextName = draftName.trim() || DEFAULT_NAME;
    await AsyncStorage.setItem(PROFILE_NAME_KEY, nextName);
    setProfileName(nextName);
    setDraftName(nextName);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.primary}
            onRefresh={() => loadProfile({ refresh: true })}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient colors={["#321A08", "#14100C"]} style={styles.hero}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.identity}>
            <Text style={styles.kicker}>Profile</Text>
            <Text style={styles.name} numberOfLines={1}>
              {profileName}
            </Text>
            <View style={styles.deviceRow}>
              <Ionicons name="phone-portrait" color={colors.accent} size={14} />
              <Text style={styles.deviceText}>ID {listenerCode}</Text>
            </View>
          </View>
        </LinearGradient>

        <View style={styles.editRow}>
          <TextInput
            value={draftName}
            onChangeText={setDraftName}
            placeholder="Profile name"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <TouchableOpacity
            accessibilityLabel="Save profile name"
            disabled={!hasNameChange}
            style={[styles.iconButton, !hasNameChange && styles.disabledButton]}
            onPress={saveProfileName}
          >
            <Ionicons
              name="checkmark"
              color={hasNameChange ? colors.text : colors.muted}
              size={22}
            />
          </TouchableOpacity>
        </View>

        <View style={styles.statsRow}>
          <StatTile label="Liked" value={String(likedSongs.length)} icon="heart" />
          <StatTile
            label="Following"
            value={String(followedArtists.length)}
            icon="people"
          />
          <StatTile label="Taste" value={topGenre} icon="radio" />
        </View>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : (
          <>
            <SectionHeader
              title="Liked songs"
              actionIcon="musical-notes"
              onPress={() => navigation.navigate("Songs")}
            />
            {likedSongs.length > 0 ? (
              <View style={styles.songList}>
                {likedSongs.map((song) => (
                  <SongCard key={song.id} song={song} queue={likedSongs} />
                ))}
              </View>
            ) : (
              <EmptyState
                icon="heart-outline"
                title="No liked songs yet"
                actionIcon="musical-notes"
                onPress={() => navigation.navigate("Songs")}
              />
            )}

            <SectionHeader
              title="Following artists"
              actionIcon="people"
              onPress={() => navigation.navigate("Artists")}
            />
            {followedArtists.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.artistRail}>
                  {followedArtists.map((artist) => (
                    <ArtistCard
                      key={artist.id}
                      artist={artist}
                      compact
                      onPress={() =>
                        navigation.navigate("ArtistDetail", { id: artist.id })
                      }
                    />
                  ))}
                </View>
              </ScrollView>
            ) : (
              <EmptyState
                icon="person-add-outline"
                title="No followed artists yet"
                actionIcon="people"
                onPress={() => navigation.navigate("Artists")}
              />
            )}
          </>
        )}
      </ScrollView>
      <MiniPlayer />
    </SafeAreaView>
  );
}

function StatTile({ icon, label, value }) {
  return (
    <View style={styles.statTile}>
      <Ionicons name={icon} color={colors.primary} size={18} />
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function SectionHeader({ actionIcon, onPress, title }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <TouchableOpacity
        accessibilityLabel={title}
        style={styles.smallIconButton}
        onPress={onPress}
      >
        <Ionicons name={actionIcon} color={colors.accent} size={18} />
      </TouchableOpacity>
    </View>
  );
}

function EmptyState({ actionIcon, icon, onPress, title }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} color={colors.primary} size={28} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <TouchableOpacity
        accessibilityLabel={title}
        style={styles.emptyButton}
        onPress={onPress}
      >
        <Ionicons name={actionIcon} color={colors.text} size={18} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    gap: 16,
    padding: spacing.page,
    paddingBottom: 112,
  },
  hero: {
    alignItems: "center",
    borderColor: "rgba(249, 115, 22, 0.36)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 14,
    padding: 16,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 32,
    height: 64,
    justifyContent: "center",
    width: 64,
  },
  avatarText: {
    color: colors.text,
    fontSize: 23,
    fontWeight: "900",
  },
  identity: {
    flex: 1,
    gap: 5,
  },
  kicker: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  name: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "900",
  },
  deviceRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  deviceText: {
    color: colors.softText,
    fontSize: 12,
    fontWeight: "700",
  },
  editRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  input: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.text,
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    minHeight: 48,
    paddingHorizontal: 12,
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 8,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  disabledButton: {
    backgroundColor: colors.elevated,
  },
  statsRow: {
    flexDirection: "row",
    gap: 10,
  },
  statTile: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    gap: 5,
    minHeight: 86,
    padding: 11,
  },
  statValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  statLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 2,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  smallIconButton: {
    alignItems: "center",
    backgroundColor: colors.elevated,
    borderRadius: 8,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  songList: {
    gap: 12,
  },
  artistRail: {
    flexDirection: "row",
    gap: 12,
    paddingRight: 2,
  },
  empty: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    justifyContent: "center",
    minHeight: 136,
    padding: 18,
  },
  emptyTitle: {
    color: colors.softText,
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
  },
  emptyButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 8,
    height: 38,
    justifyContent: "center",
    width: 46,
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

import { Ionicons } from "@expo/vector-icons";
import AppAccess from "../components/AppAccess";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { getDiscoveryItems } from "../api/musicApi";
import ArtistCard from "../components/ArtistCard";
import MiniPlayer from "../components/MiniPlayer";
import ProfileAvatarButton from "../components/ProfileAvatarButton";
import SongCard from "../components/SongCard";
import { useAuth } from "../context/AuthContext";
import { useEngagement } from "../context/EngagementContext";
import { usePlayer } from "../context/PlayerContext";
import { colors, spacing } from "../theme";
import { buildHomeSections } from "../utils/discovery";

const SOURCES = {
  newSongs: ["songs", { discovery: "new" }],
  popular: ["songs", { discovery: "popular" }],
  featured: ["songs", { discovery: "featured", limit: 12 }],
  more: ["songs", { discovery: "more" }],
  artists: ["artists", { discovery: "featured", limit: 8 }],
  genres: ["genres", {}],
};
const INITIAL = Object.fromEntries(Object.keys(SOURCES).map(key => [key, { loading: true, items: [], error: false }]));

export default function HomeScreen({ navigation }) {
  const { isAuthenticated } = useAuth();
  const { followedArtistIds } = useEngagement();
  const { recentlyPlayed, currentSong, playSong } = usePlayer();
  const [sources, setSources] = useState(INITIAL);
  const [slow, setSlow] = useState(false);
  const mounted = useRef(false);
  const scroll = useRef(null);
  const revisions = useRef({});
  const recentKey = recentlyPlayed.slice(0, 6).map(song => song.id).join(",");
  const followedKey = isAuthenticated ? followedArtistIds.slice(0, 8).sort((a, b) => a - b).join(",") : "";

  const load = useCallback(async (key, kind, options) => {
    const revision = (revisions.current[key] || 0) + 1;
    revisions.current[key] = revision;
    setSources(previous => ({ ...previous, [key]: { ...previous[key], loading: true, error: false } }));
    try {
      const items = await getDiscoveryItems(kind, options);
      if (mounted.current && revisions.current[key] === revision) {
        setSources(previous => ({ ...previous, [key]: { items, loading: false, error: false } }));
      }
    } catch {
      if (mounted.current && revisions.current[key] === revision) {
        setSources(previous => ({ ...previous, [key]: { items: [], loading: false, error: true } }));
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    Object.entries(SOURCES).forEach(([key, [kind, options]]) => load(key, kind, options));
    const timer = setTimeout(() => setSlow(true), 5000);
    return () => { mounted.current = false; clearTimeout(timer); };
  }, [load]);

  useEffect(() => {
    if (recentKey) load("recent", "songs", { ids: recentKey.split(","), limit: 6 });
    else {
      revisions.current.recent = (revisions.current.recent || 0) + 1;
      setSources(previous => ({ ...previous, recent: { items: [] } }));
    }
  }, [recentKey, load]);

  useEffect(() => {
    if (followedKey) load("followed", "artists", { ids: followedKey.split(","), limit: 8 });
    else {
      revisions.current.followed = (revisions.current.followed || 0) + 1;
      setSources(previous => ({ ...previous, followed: { items: [] } }));
    }
  }, [followedKey, load]);

  const sections = useMemo(() => buildHomeSections(
    Object.fromEntries(Object.entries(sources).map(([key, state]) => [key, state.items || []])),
    recentKey ? recentKey.split(",") : [],
  ), [sources, recentKey]);
  const artists = useMemo(() => (sources.artists?.items || []).filter(artist => artist.is_featured), [sources.artists]);
  const followed = useMemo(() => (sources.followed?.items || []).filter(artist => followedKey.split(",").includes(String(artist.id))), [sources.followed, followedKey]);
  const genres = useMemo(() => [...new Set((sources.genres?.items || []).filter(item => typeof item === "string" && item.trim()))], [sources.genres]);
  const loading = Object.values(sources).some(state => state.loading);
  const failures = Object.keys(sources).filter(key => sources[key].error);
  const hasMusic = Object.values(sections).some(items => items.length) || artists.length || followed.length;

  const openStack = useCallback((name, params) => {
    if (name === "Songs") return navigation.navigate("Songs", params);
    (navigation.getParent?.() || navigation).navigate(name, params);
  }, [navigation]);
  const openArtist = useCallback(artist => openStack("ArtistDetail", { id: artist.id }), [openStack]);
  function reload(failedOnly = false) {
    Object.entries(SOURCES).forEach(([key, [kind, options]]) => {
      if (!failedOnly || sources[key]?.error) load(key, kind, options);
    });
    if (recentKey && (!failedOnly || sources.recent?.error)) load("recent", "songs", { ids: recentKey.split(","), limit: 6 });
    if (followedKey && (!failedOnly || sources.followed?.error)) load("followed", "artists", { ids: followedKey.split(","), limit: 8 });
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView ref={scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading && Boolean(hasMusic)} onRefresh={() => reload()} tintColor={colors.primary} />}>
        <View style={styles.topRow}>
          <ProfileAvatarButton />
          <TouchableOpacity accessibilityRole="button" style={styles.activeChip} onPress={() => scroll.current?.scrollTo({ y: 0, animated: true })}><Text style={styles.activeChipText}>All</Text></TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" style={styles.chip} onPress={() => openStack("Songs")}><Text style={styles.chipText}>Music</Text></TouchableOpacity>
          <View style={styles.spacer} />
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Refresh discovery" disabled={loading} style={styles.iconButton} onPress={() => reload()}>
            <Ionicons name="refresh-outline" size={21} color={loading ? colors.muted : colors.softText} />
          </TouchableOpacity>
        </View>
        {failures.length > 0 && <View accessibilityLiveRegion="polite" style={styles.notice}>
          <Text style={styles.noticeText}>Some music couldn't load.</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry unavailable sections" style={styles.retry} onPress={() => reload(true)}><Text style={styles.link}>Retry</Text></TouchableOpacity>
        </View>}
        {slow && loading && <Text accessibilityLiveRegion="polite" style={styles.noticeText}>Still loading more music...</Text>}
        <AppAccess compact />
        {sections.recent.length > 0 && <View style={styles.section} testID="home-recent">
          <Heading title="Continue listening" />
          <View style={styles.recentList}>{sections.recent.slice(0, 3).map(song => <SongCard key={song.id} song={song} queue={sections.recent}
            onPress={() => { if (String(currentSong?.id) !== String(song.id)) playSong(song, sections.recent); openStack("Player"); }} />)}</View>
        </View>}
        <SongSection title="New releases" id="new" items={sections.newest} loading={sources.newSongs.loading} />
        <SongSection title="Popular songs" id="popular" items={sections.popular} loading={sources.popular.loading} />
        <ArtistSection title="Featured artists" id="artists" items={artists} loading={sources.artists.loading} onArtist={openArtist} />
        {genres.length > 0 && <View style={styles.section} testID="home-genres">
          <Heading title="Genres" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.genres}>{genres.map((genre, index) => <TouchableOpacity key={genre} accessibilityRole="button" accessibilityLabel={`Browse ${genre}`} style={styles.genre}
            onPress={() => navigation.navigate("Search", { genre })}>
            <Ionicons name="musical-notes-outline" size={18} color={index % 2 ? colors.accent : colors.primary} />
            <Text style={styles.genreText}>{genre}</Text><Ionicons name="chevron-forward" size={16} color={colors.muted} />
          </TouchableOpacity>)}</ScrollView>
        </View>}
        <ArtistSection title="Artists you follow" id="followed" items={followed} onArtist={openArtist} />
        <SongSection title="Featured songs" id="featured" items={sections.featured} loading={sources.featured.loading} />
        <SongSection title="More to discover" id="more" items={sections.more} loading={sources.more.loading} onSeeAll={() => openStack("Songs")} />
        {!loading && !hasMusic && !failures.length && <View style={styles.empty}>
          <Ionicons name="musical-notes-outline" color={colors.primary} size={32} />
          <Text style={styles.emptyTitle}>No music available yet</Text><Text style={styles.noticeText}>New music will appear here.</Text>
        </View>}
      </ScrollView>
      <MiniPlayer />
    </SafeAreaView>
  );
}

function Heading({ title, onSeeAll }) {
  return <View style={styles.heading}><Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
    {onSeeAll && <TouchableOpacity accessibilityRole="button" accessibilityLabel={`See all ${title.toLowerCase()}`} style={styles.seeAll} onPress={onSeeAll}><Text style={styles.link}>See all</Text><Ionicons name="chevron-forward" size={16} color={colors.softText} /></TouchableOpacity>}
  </View>;
}

function Skeleton({ title }) {
  return <View accessibilityLabel={`Loading ${title.toLowerCase()}`} accessibilityRole="progressbar" style={styles.section}>
    <Heading title={title} /><View style={styles.skeletonRow}>{[0, 1, 2].map(key => <View key={key} style={styles.skeletonTile}>
      <View style={styles.skeletonArt} /><View style={styles.skeletonLine} /><View style={[styles.skeletonLine, { width: "65%" }]} />
    </View>)}</View>
  </View>;
}

const separator = () => <View style={styles.separator} />;
const SongSection = memo(function SongSection({ title, id, items, loading, onSeeAll }) {
  if (!items.length) return loading ? <Skeleton title={title} /> : null;
  return <View style={styles.section} testID={`home-${id}`}><Heading title={title} onSeeAll={onSeeAll} />
    <FlatList horizontal data={items} keyExtractor={item => String(item.id)} showsHorizontalScrollIndicator={false}
      ItemSeparatorComponent={separator} renderItem={({ item }) => <SongCard song={item} compact queue={items} />} />
  </View>;
});

const ArtistSection = memo(function ArtistSection({ title, id, items, loading, onArtist }) {
  if (!items.length) return loading ? <Skeleton title={title} /> : null;
  return <View style={styles.section} testID={`home-${id}`}><Heading title={title} />
    <FlatList horizontal data={items} keyExtractor={item => String(item.id)} showsHorizontalScrollIndicator={false}
      ItemSeparatorComponent={separator} renderItem={({ item }) => <ArtistCard artist={item} compact onPress={() => onArtist(item)} />} />
  </View>;
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.page, paddingBottom: 110, gap: 28 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  spacer: { flex: 1 },
  activeChip: { minHeight: 44, paddingHorizontal: 18, borderRadius: 22, backgroundColor: colors.primary, justifyContent: "center" },
  activeChipText: { color: colors.background, fontWeight: "900", fontSize: 14 },
  chip: { minHeight: 44, paddingHorizontal: 18, borderRadius: 22, backgroundColor: colors.elevated, justifyContent: "center" },
  chipText: { color: colors.softText, fontWeight: "800", fontSize: 14 },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  section: { gap: 12, minWidth: 0 },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 30 },
  sectionTitle: { color: colors.text, fontSize: 20, fontWeight: "900", flexShrink: 1 },
  seeAll: { flexDirection: "row", gap: 3, alignItems: "center", minHeight: 44 },
  link: { fontSize: 14, fontWeight: "700", color: colors.softText },
  separator: { width: 12 },
  recentList: { gap: 4, maxWidth: 680 },
  genres: { flexDirection: "row", gap: 10 },
  genre: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, minHeight: 48, maxWidth: 280, borderRadius: 8, backgroundColor: colors.elevated },
  genreText: { color: colors.text, fontSize: 15, fontWeight: "600", flexShrink: 1 },
  notice: { flexDirection: "row", gap: 12, alignItems: "center", justifyContent: "space-between" },
  noticeText: { color: colors.softText, fontSize: 14, lineHeight: 21, flexShrink: 1 },
  retry: { minHeight: 44, paddingHorizontal: 12, justifyContent: "center" },
  skeletonRow: { flexDirection: "row", gap: 12, overflow: "hidden" },
  skeletonTile: { width: 146, gap: 10 },
  skeletonArt: { width: 146, height: 146, backgroundColor: colors.elevated, borderRadius: 5 },
  skeletonLine: { width: "90%", height: 12, backgroundColor: colors.elevated, borderRadius: 3 },
  empty: { alignItems: "center", gap: 12, paddingVertical: 36 },
  emptyTitle: { color: colors.text, fontWeight: "800", fontSize: 20, textAlign: "center" },
});

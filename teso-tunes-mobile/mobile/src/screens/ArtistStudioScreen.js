import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  BACKEND_CONNECTION_ERROR,
  getArtistStudioDashboard,
  getArtistStudioReleases,
} from "../api/musicApi";
import MiniPlayer from "../components/MiniPlayer";
import { colors, spacing } from "../theme";
import { formatFollowers, formatPlays } from "../utils/format";

const FILTERS = [
  { label: "All", value: "" },
  { label: "Drafts", value: "draft" },
  { label: "Review", value: "under_review" },
  { label: "Live", value: "published" },
  { label: "Scheduled", value: "scheduled" },
  { label: "Rejected", value: "rejected" },
];

function statusCopy(status) {
  const labels = {
    draft: "Draft",
    under_review: "Under Review",
    approved: "Approved",
    rejected: "Rejected",
    scheduled: "Scheduled",
    published: "Published",
  };
  return labels[status] || "Draft";
}

function statusColor(status) {
  if (status === "published") return colors.success;
  if (status === "rejected") return colors.accent;
  if (status === "under_review") return colors.primary;
  return colors.softText;
}

export default function ArtistStudioScreen({ navigation }) {
  const [dashboard, setDashboard] = useState(null);
  const [releases, setReleases] = useState([]);
  const [activeFilter, setActiveFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadStudio = useCallback(
    async ({ refresh = false } = {}) => {
      try {
        if (refresh) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }
        setError("");
        const [nextDashboard, nextReleases] = await Promise.all([
          getArtistStudioDashboard(),
          getArtistStudioReleases(activeFilter),
        ]);
        setDashboard(nextDashboard);
        setReleases(nextReleases);
      } catch (loadError) {
        setError(loadError?.detail || loadError?.message || BACKEND_CONNECTION_ERROR);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [activeFilter]
  );

  useFocusEffect(
    useCallback(() => {
      loadStudio();
    }, [loadStudio])
  );

  const artist = dashboard?.artist;
  const latestRelease = dashboard?.latest_release;
  const visibleReleases = useMemo(() => releases || [], [releases]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.primary}
            onRefresh={() => loadStudio({ refresh: true })}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topbar}>
          <TouchableOpacity style={styles.iconButton} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" color={colors.softText} size={22} />
          </TouchableOpacity>
          <Text style={styles.title}>Artist Studio</Text>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => navigation.navigate("ReleaseUpload")}
          >
            <Ionicons name="add" color={colors.primary} size={24} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : (
          <>
            <View style={styles.hero}>
              {artist?.photo ? (
                <Image source={{ uri: artist.photo }} style={styles.artistImage} />
              ) : (
                <View style={styles.artistImagePlaceholder}>
                  <Ionicons name="person" color={colors.primary} size={28} />
                </View>
              )}
              <View style={styles.heroCopy}>
                <Text style={styles.kicker}>Approved artist</Text>
                <Text style={styles.artistName} numberOfLines={1}>
                  {artist?.name || "Artist"}
                </Text>
                <Text style={styles.metaText}>{artist?.category || "Teso music"}</Text>
              </View>
            </View>

            <View style={styles.statsRow}>
              <StatTile
                icon="people"
                label="Followers"
                value={formatFollowers(dashboard?.follower_count || 0)}
              />
              <StatTile
                icon="albums"
                label="Releases"
                value={String(dashboard?.total_releases || 0)}
              />
              <StatTile
                icon="pulse"
                label="Streams"
                value={formatPlays(dashboard?.total_plays || 0)}
              />
            </View>

            <TouchableOpacity
              style={styles.uploadButton}
              onPress={() => navigation.navigate("ReleaseUpload")}
            >
              <Ionicons name="cloud-upload" color={colors.background} size={20} />
              <Text style={styles.uploadText}>Upload Music</Text>
            </TouchableOpacity>

            {latestRelease ? (
              <View style={styles.latestPanel}>
                <Text style={styles.sectionTitle}>Latest release</Text>
                <ReleaseCard release={latestRelease} />
              </View>
            ) : null}

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>My Releases</Text>
              <TouchableOpacity
                style={styles.smallButton}
                onPress={() => loadStudio({ refresh: true })}
              >
                <Ionicons name="refresh" color={colors.accent} size={18} />
              </TouchableOpacity>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.filterRow}>
                {FILTERS.map((filter) => (
                  <TouchableOpacity
                    key={filter.value || "all"}
                    style={[
                      styles.filterButton,
                      activeFilter === filter.value && styles.activeFilterButton,
                    ]}
                    onPress={() => setActiveFilter(filter.value)}
                  >
                    <Text
                      style={[
                        styles.filterText,
                        activeFilter === filter.value && styles.activeFilterText,
                      ]}
                    >
                      {filter.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <View style={styles.releaseList}>
              {visibleReleases.length > 0 ? (
                visibleReleases.map((release) => (
                  <ReleaseCard key={release.id} release={release} />
                ))
              ) : (
                <View style={styles.empty}>
                  <Ionicons name="disc" color={colors.primary} size={28} />
                  <Text style={styles.emptyText}>No releases in this view.</Text>
                </View>
              )}
            </View>
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

function ReleaseCard({ release }) {
  return (
    <View style={styles.releaseCard}>
      {release.cover_image ? (
        <Image source={{ uri: release.cover_image }} style={styles.releaseCover} />
      ) : (
        <View style={styles.releaseCoverPlaceholder}>
          <Ionicons name="disc" color={colors.primary} size={22} />
        </View>
      )}
      <View style={styles.releaseCopy}>
        <View style={styles.releaseTitleRow}>
          <Text style={styles.releaseTitle} numberOfLines={1}>
            {release.title || "Untitled release"}
          </Text>
          <Text style={[styles.statusText, { color: statusColor(release.status) }]}>
            {statusCopy(release.status)}
          </Text>
        </View>
        <Text style={styles.releaseMeta} numberOfLines={1}>
          {release.release_type || "Single"} - {release.genre || "Genre"}
        </Text>
        <Text style={styles.releaseMeta} numberOfLines={1}>
          {release.release_date || "No release date"}
        </Text>
        {release.rejection_reason ? (
          <Text style={styles.reasonText}>{release.rejection_reason}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    gap: 14,
    padding: spacing.page,
    paddingBottom: 112,
  },
  topbar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: colors.elevated,
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "950",
    textTransform: "uppercase",
  },
  hero: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: "rgba(32, 230, 243, 0.28)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 14,
    padding: 14,
  },
  artistImage: {
    backgroundColor: colors.elevated,
    borderRadius: 8,
    height: 76,
    width: 76,
  },
  artistImagePlaceholder: {
    alignItems: "center",
    backgroundColor: colors.elevated,
    borderRadius: 8,
    height: 76,
    justifyContent: "center",
    width: 76,
  },
  heroCopy: {
    flex: 1,
    gap: 4,
  },
  kicker: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  artistName: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "950",
  },
  metaText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800",
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
    fontSize: 17,
    fontWeight: "900",
  },
  statLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
  },
  uploadButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 8,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 50,
  },
  uploadText: {
    color: colors.background,
    fontSize: 15,
    fontWeight: "950",
  },
  latestPanel: {
    gap: 10,
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  smallButton: {
    alignItems: "center",
    backgroundColor: colors.elevated,
    borderRadius: 8,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  filterRow: {
    flexDirection: "row",
    gap: 8,
    paddingRight: 2,
  },
  filterButton: {
    alignItems: "center",
    backgroundColor: colors.elevated,
    borderRadius: 20,
    minHeight: 38,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  activeFilterButton: {
    backgroundColor: colors.primary,
  },
  filterText: {
    color: colors.softText,
    fontSize: 13,
    fontWeight: "900",
  },
  activeFilterText: {
    color: colors.background,
  },
  releaseList: {
    gap: 10,
  },
  releaseCard: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 10,
  },
  releaseCover: {
    backgroundColor: colors.elevated,
    borderRadius: 6,
    height: 64,
    width: 64,
  },
  releaseCoverPlaceholder: {
    alignItems: "center",
    backgroundColor: colors.elevated,
    borderRadius: 6,
    height: 64,
    justifyContent: "center",
    width: 64,
  },
  releaseCopy: {
    flex: 1,
    gap: 4,
  },
  releaseTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  releaseTitle: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    fontWeight: "900",
  },
  releaseMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
  },
  statusText: {
    fontSize: 11,
    fontWeight: "950",
    textTransform: "uppercase",
  },
  reasonText: {
    color: colors.softText,
    fontSize: 12,
    lineHeight: 17,
  },
  empty: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    justifyContent: "center",
    minHeight: 120,
  },
  emptyText: {
    color: colors.softText,
    fontSize: 13,
    fontWeight: "800",
  },
  loader: {
    marginTop: 30,
  },
  errorText: {
    color: colors.softText,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 30,
    textAlign: "center",
  },
});

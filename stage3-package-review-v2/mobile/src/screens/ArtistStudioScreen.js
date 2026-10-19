import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  acceptCurrentArtistAgreement,
  BACKEND_CONNECTION_ERROR,
  getArtistStudioDashboard,
  getArtistStudioReleases,
  getArtistStudioSongs,
  getArtistSongRemovalRequests,
  requestArtistSongRemoval,
  cancelArtistSongRemoval,
} from "../api/musicApi";
import ArtistAgreementPanel from "../components/ArtistAgreementPanel";
import MiniPlayer from "../components/MiniPlayer";
import SongShareModal from "../components/SongShareModal";
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
  const [agreementVisible, setAgreementVisible] = useState(false);
  const [acceptingAgreement, setAcceptingAgreement] = useState(false);
  const loadRequest = useRef(0);
  const removalLoadRequest = useRef(0);
  const [artistSongs, setArtistSongs] = useState([]);
  const [removalRequests, setRemovalRequests] = useState([]);
  const [removalLoading, setRemovalLoading] = useState(true);
  const [removalError, setRemovalError] = useState("");
  const [removalSong, setRemovalSong] = useState(null);
  const [removalReason, setRemovalReason] = useState("");
  const [removalFormError, setRemovalFormError] = useState("");
  const [removalActionBusy, setRemovalActionBusy] = useState(false);
  const [removalHistoryVisible, setRemovalHistoryVisible] = useState(false);

  const loadRemovalData = useCallback(async () => {
    const request = ++removalLoadRequest.current;
    setRemovalLoading(true);
    setRemovalError("");
    try {
      const [songs, requests] = await Promise.all([
        getArtistStudioSongs(),
        getArtistSongRemovalRequests(),
      ]);
      if (request !== removalLoadRequest.current) return;
      setArtistSongs(Array.isArray(songs) ? songs : []);
      setRemovalRequests(Array.isArray(requests) ? requests : []);
    } catch (requestError) {
      if (request !== removalLoadRequest.current) return;
      setRemovalError(requestError?.detail || requestError?.message || BACKEND_CONNECTION_ERROR);
    } finally {
      if (request === removalLoadRequest.current) setRemovalLoading(false);
    }
  }, []);

  const loadStudio = useCallback(
    async ({ refresh = false } = {}) => {
      const request = ++loadRequest.current;
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
        if (request !== loadRequest.current) return;
        setDashboard(nextDashboard);
        setReleases(nextReleases);
      } catch (loadError) {
        if (request !== loadRequest.current) return;
        setError(loadError?.detail || loadError?.message || BACKEND_CONNECTION_ERROR);
      } finally {
        if (request === loadRequest.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [activeFilter]
  );

  useFocusEffect(
    useCallback(() => {
      loadStudio();
      loadRemovalData();
      return () => {
        loadRequest.current += 1;
        removalLoadRequest.current += 1;
      };
    }, [loadStudio, loadRemovalData])
  );

  const refreshStudio = useCallback(() => {
    loadStudio({ refresh: true });
    loadRemovalData();
  }, [loadStudio, loadRemovalData]);

  const activeRemovals = useMemo(() => {
    const rows = new Map();
    for (const request of removalRequests) {
      if (request.status === "scheduled" && request.song != null) {
        rows.set(String(request.song), request);
      }
    }
    return rows;
  }, [removalRequests]);

  const startRemovalRequest = useCallback((song) => {
    if (removalActionBusy) return;
    setRemovalSong(song);
    setRemovalReason("");
    setRemovalFormError("");
  }, [removalActionBusy]);

  const submitRemovalRequest = useCallback(async () => {
    if (!removalSong || removalActionBusy) return;
    const reason = removalReason.trim();
    if (reason.length < 10 || reason.length > 1000) {
      setRemovalFormError("Enter a reason between 10 and 1000 characters.");
      return;
    }
    setRemovalActionBusy(true);
    setRemovalFormError("");
    try {
      const request = await requestArtistSongRemoval(removalSong.id, reason);
      setRemovalSong(null);
      setRemovalReason("");
      await loadRemovalData();
      Alert.alert("Removal requested", `Your song remains available until ${formatRemovalDate(request?.due_at)}. You can cancel before the deadline.`);
    } catch (requestError) {
      setRemovalFormError(requestError?.detail || requestError?.message || BACKEND_CONNECTION_ERROR);
    } finally {
      setRemovalActionBusy(false);
    }
  }, [removalActionBusy, removalReason, removalSong, loadRemovalData]);

  const cancelRemovalRequest = useCallback((request) => {
    if (removalActionBusy) return;
    Alert.alert(
      "Cancel song removal?",
      `Keep “${request.title || "this song"}” on TesoHub Music?`,
      [
        { text: "Keep request", style: "cancel" },
        { text: "Cancel removal", style: "destructive", onPress: async () => {
          setRemovalActionBusy(true);
          setRemovalError("");
          try {
            await cancelArtistSongRemoval(request.id);
            await loadRemovalData();
            Alert.alert("Request cancelled", "The scheduled removal has been cancelled.");
          } catch (cancelError) {
            setRemovalError(cancelError?.detail || cancelError?.message || BACKEND_CONNECTION_ERROR);
          } finally {
            setRemovalActionBusy(false);
          }
        }},
      ],
    );
  }, [removalActionBusy, loadRemovalData]);

  const artist = dashboard?.artist;
  const latestRelease = dashboard?.latest_release;
  const visibleReleases = useMemo(() => releases || [], [releases]);
  const agreementState = dashboard?.artist_agreement || null;
  const agreementBlocksUploads = Boolean(agreementState?.required && !agreementState?.acceptance);

  const openUpload = useCallback(() => {
    if (agreementBlocksUploads) {
      setAgreementVisible(true);
      return;
    }
    navigation.navigate("ReleaseUpload");
  }, [agreementBlocksUploads, navigation]);

  const acceptAgreement = useCallback(async () => {
    const version = agreementState?.agreement?.version;
    if (!version || acceptingAgreement) return;
    setAcceptingAgreement(true);
    setError("");
    try {
      const result = await acceptCurrentArtistAgreement(version);
      setDashboard((current) => ({ ...current, artist_agreement: result }));
    } catch (acceptError) {
      setError(acceptError?.detail || acceptError?.message || BACKEND_CONNECTION_ERROR);
    } finally {
      setAcceptingAgreement(false);
    }
  }, [acceptingAgreement, agreementState?.agreement?.version]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.primary}
            onRefresh={refreshStudio}
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
            onPress={openUpload}
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

            <ArtistAgreementPanel
              accepting={acceptingAgreement}
              onAccept={agreementState?.agreement ? acceptAgreement : undefined}
              onCloseAgreement={() => setAgreementVisible(false)}
              onOpenAgreement={() => setAgreementVisible(true)}
              state={agreementState}
              visible={agreementVisible}
            />

            <TouchableOpacity
              style={[styles.uploadButton, agreementBlocksUploads && styles.disabledButton]}
              onPress={openUpload}
            >
              <Ionicons name="cloud-upload" color={colors.background} size={20} />
              <Text style={styles.uploadText}>Upload Music</Text>
            </TouchableOpacity>

            {latestRelease ? (
              <View style={styles.latestPanel}>
                <Text style={styles.sectionTitle}>Latest release</Text>
                <ReleaseCard release={latestRelease} navigation={navigation} />
              </View>
            ) : null}

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>My Releases</Text>
              <TouchableOpacity
                style={styles.smallButton}
                onPress={refreshStudio}
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
                  <ReleaseCard key={release.id} release={release} navigation={navigation} />
                ))
              ) : (
                <View style={styles.empty}>
                  <Ionicons name="disc" color={colors.primary} size={28} />
                  <Text style={styles.emptyText}>No releases in this view.</Text>
                </View>
              )}
            </View>

            <View style={styles.removalSection}>
              <View style={styles.removalHeading}>
                <View style={styles.removalTitleBlock}>
                  <Text style={styles.sectionTitle}>Song Removal</Text>
                  <Text style={styles.removalSubtext}>Request removal of your published songs with 30 days' notice.</Text>
                </View>
                <TouchableOpacity
                  accessibilityLabel="Refresh song removal requests"
                  style={styles.smallButton}
                  onPress={loadRemovalData}
                  disabled={removalLoading}
                >
                  <Ionicons name="refresh" color={colors.primary} size={18} />
                </TouchableOpacity>
              </View>
              {removalError ? (
                <View style={styles.removalErrorBox}>
                  <Text style={styles.reasonText}>{removalError}</Text>
                  <TouchableOpacity style={styles.removalLinkButton} onPress={loadRemovalData}>
                    <Text style={styles.removalLinkText}>Retry</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              {removalLoading && !artistSongs.length ? (
                <ActivityIndicator color={colors.primary} style={styles.loader} />
              ) : artistSongs.length ? (
                artistSongs.map((song) => {
                  const pending = activeRemovals.get(String(song.id));
                  const eligible = ["published", "hidden"].includes(song.status);
                  const cancellable = pending && Date.parse(pending.due_at) > Date.now();
                  return (
                    <View key={song.id} style={styles.removalSongRow}>
                      <View style={styles.removalSongCopy}>
                        <Text style={styles.removalSongTitle}>{song.title || "Untitled song"}</Text>
                        <Text style={styles.releaseMeta}>Status: {song.status || "Unknown"}</Text>
                        {pending ? <Text style={styles.removalNotice}>Removal scheduled for {formatRemovalDate(pending.due_at)}</Text> : null}
                      </View>
                      {pending ? (
                        <TouchableOpacity
                          accessibilityLabel={`Cancel removal of ${song.title || "song"}`}
                          style={[styles.removalLinkButton, (!cancellable || removalActionBusy) && styles.disabledButton]}
                          onPress={() => cancelRemovalRequest(pending)}
                          disabled={!cancellable || removalActionBusy}
                        >
                          <Text style={styles.removalLinkText}>{cancellable ? "Cancel request" : "Pending"}</Text>
                        </TouchableOpacity>
                      ) : eligible ? (
                        <TouchableOpacity
                          accessibilityLabel={`Request removal of ${song.title || "song"}`}
                          style={[styles.removalLinkButton, removalActionBusy && styles.disabledButton]}
                          onPress={() => startRemovalRequest(song)}
                          disabled={removalActionBusy}
                        >
                          <Text style={styles.removalLinkText}>Request removal</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  );
                })
              ) : !removalError ? (
                <Text style={styles.removalSubtext}>No songs available for removal.</Text>
              ) : null}

              {removalRequests.length ? (
                <>
                  <TouchableOpacity
                    style={styles.removalHistoryToggle}
                    onPress={() => setRemovalHistoryVisible((value) => !value)}
                    accessibilityRole="button"
                    accessibilityLabel={removalHistoryVisible ? "Hide song removal history" : "View song removal history"}
                  >
                    <Text style={styles.removalLinkText}>{removalHistoryVisible ? "Hide" : "View"} removal history ({removalRequests.length})</Text>
                    <Ionicons name={removalHistoryVisible ? "chevron-up" : "chevron-down"} color={colors.primary} size={18} />
                  </TouchableOpacity>
                  {removalHistoryVisible ? removalRequests.map((request) => (
                    <View key={request.id} style={styles.removalHistoryRow}>
                      <Text style={styles.removalSongTitle}>{request.title || "Song"} · {removalStatusCopy(request.status)}</Text>
                      <Text style={styles.releaseMeta}>Requested: {formatRemovalDate(request.requested_at)}</Text>
                      <Text style={styles.releaseMeta}>Scheduled deadline: {formatRemovalDate(request.due_at)}</Text>
                      <Text style={styles.reasonText}>Reason: {request.reason}</Text>
                      {Array.isArray(request.history) ? request.history.map((event, index) => (
                        <Text key={`${request.id}-event-${index}`} style={styles.releaseMeta}>
                          {removalStatusCopy(event.event_type)} · {formatRemovalDate(event.at)}
                        </Text>
                      )) : null}
                    </View>
                  )) : null}
                </>
              ) : null}
            </View>
          </>
        )}
      </ScrollView>
      <Modal
        visible={Boolean(removalSong)}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!removalActionBusy) setRemovalSong(null); }}
      >
        <KeyboardAvoidingView style={styles.removalModalBackdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.removalModalCard}>
            <Text style={styles.sectionTitle}>Request Song Removal</Text>
            <Text style={styles.removalSubtext}>
              {removalSong?.title || "This song"} will stay available for 30 days. You can cancel your request before the deadline.
            </Text>
            <TextInput
              style={styles.removalReasonInput}
              accessibilityLabel="Song removal reason"
              multiline
              value={removalReason}
              onChangeText={(value) => { setRemovalReason(value); setRemovalFormError(""); }}
              placeholder="Explain why you want to remove this song (10–1000 characters)"
              placeholderTextColor={colors.muted}
              maxLength={1000}
              editable={!removalActionBusy}
              textAlignVertical="top"
            />
            <Text style={styles.releaseMeta}>{removalReason.trim().length}/1000 characters</Text>
            {removalFormError ? <Text style={styles.removalValidation}>{removalFormError}</Text> : null}
            <View style={styles.removalModalActions}>
              <TouchableOpacity
                style={styles.removalSecondaryButton}
                disabled={removalActionBusy}
                onPress={() => setRemovalSong(null)}
              >
                <Text style={styles.removalLinkText}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.removalPrimaryButton, removalActionBusy && styles.disabledButton]}
                disabled={removalActionBusy}
                onPress={submitRemovalRequest}
              >
                {removalActionBusy ? <ActivityIndicator color={colors.background} size="small" /> : <Text style={styles.removalPrimaryText}>Submit request</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <MiniPlayer />
    </SafeAreaView>
  );
}

function formatRemovalDate(value) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleDateString();
}

function removalStatusCopy(value) {
  return ({scheduled: "Scheduled", cancelled: "Cancelled", completed: "Completed", requested: "Requested"})[value] || value || "Unknown";
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

function ReleaseCard({ release, navigation }) {
  const [shareVisible, setShareVisible] = useState(false);
  const canShare = release.status === "published" && release.public_song?.status === "published";
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
        {release.review_reason || release.rejection_reason ? (
          <Text style={styles.reasonText}>{release.review_reason || release.rejection_reason}</Text>
        ) : release.last_review_reason ? <Text style={styles.releaseMeta}>Previous review: {release.last_review_reason}</Text> : null}
        {release.status === "rejected" ? <TouchableOpacity
          style={styles.editReleaseButton}
          onPress={() => navigation.navigate("ReleaseUpload", { releaseId: release.id })}
        >
          <Ionicons name="create-outline" color={colors.primary} size={18} />
          <Text style={styles.editReleaseText}>Edit & Resubmit</Text>
        </TouchableOpacity> : null}
      </View>
      {canShare ? <TouchableOpacity accessibilityLabel={`Share ${release.title}`} style={styles.shareButton} onPress={() => setShareVisible(true)}>
        <Ionicons name="share-social-outline" color={colors.primary} size={22} />
      </TouchableOpacity> : null}
      <SongShareModal visible={shareVisible && canShare} song={release.public_song} onClose={() => setShareVisible(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  removalSection: { gap: 10, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.border },
  removalHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  removalTitleBlock: { flex: 1, gap: 4 },
  removalSubtext: { color: colors.softText, fontSize: 13, lineHeight: 19 },
  removalSongRow: { borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 12, gap: 10, backgroundColor: colors.card },
  removalSongCopy: { gap: 4 },
  removalSongTitle: { color: colors.text, fontSize: 14, fontWeight: "800" },
  removalNotice: { color: colors.primary, fontSize: 12, lineHeight: 18, fontWeight: "700" },
  removalLinkButton: { paddingVertical: 10, paddingHorizontal: 12, minHeight: 44, alignItems: "center", justifyContent: "center", backgroundColor: colors.elevated, borderRadius: 7, alignSelf: "flex-start" },
  removalLinkText: { color: colors.primary, fontSize: 13, fontWeight: "800" },
  removalErrorBox: { gap: 8, backgroundColor: colors.card, padding: 10, borderRadius: 8 },
  removalHistoryToggle: { minHeight: 44, flexDirection: "row", gap: 8, alignItems: "center" },
  removalHistoryRow: { gap: 4, padding: 12, borderColor: colors.border, borderWidth: 1, borderRadius: 8 },
  removalModalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.82)", justifyContent: "center", padding: 18 },
  removalModalCard: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 18, gap: 12, maxHeight: "90%" },
  removalReasonInput: { minHeight: 116, maxHeight: 190, color: colors.text, backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1, borderRadius: 7, padding: 12, fontSize: 15 },
  removalValidation: { color: colors.accent, fontSize: 13, lineHeight: 18 },
  removalModalActions: { flexDirection: "row", gap: 12, justifyContent: "flex-end", alignItems: "center" },
  removalSecondaryButton: { minHeight: 44, paddingHorizontal: 14, justifyContent: "center" },
  removalPrimaryButton: { minHeight: 44, paddingHorizontal: 14, backgroundColor: colors.primary, borderRadius: 7, justifyContent: "center", alignItems: "center" },
  removalPrimaryText: { color: colors.background, fontSize: 13, fontWeight: "800" },
  editReleaseButton: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  editReleaseText: { color: colors.primary, fontSize: 13, fontWeight: "700", flexShrink: 1 },
  shareButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
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
  disabledButton: {
    opacity: 0.55,
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

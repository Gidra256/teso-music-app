import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
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
import { useAuth } from "../context/AuthContext";
import { useEngagement } from "../context/EngagementContext";
import { usePlayer } from "../context/PlayerContext";
import { colors, spacing } from "../theme";

export default function ProfileScreen({ navigation }) {
  const {
    isAuthenticated,
    listener,
    loading: authLoading,
    loginAccount,
    logout,
    refreshAccount,
    registerAccount,
    updateAccount,
  } = useAuth();
  const { deviceId, followedArtistIds, likedSongIds } = useEngagement();
  const { backgroundPlaybackEnabled, setBackgroundPlaybackEnabled } = usePlayer();
  const [songs, setSongs] = useState([]);
  const [artists, setArtists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [authMode, setAuthMode] = useState("register");
  const [authForm, setAuthForm] = useState({
    email: "",
    identifier: "",
    name: "",
    password: "",
    phone: "",
  });
  const [profileForm, setProfileForm] = useState({
    email: "",
    name: "",
    phone: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const loadProfile = useCallback(
    async ({ refresh = false } = {}) => {
      try {
        if (refresh) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }
        setError("");

        const requests = [getSongs(), getArtists()];
        if (isAuthenticated) {
          requests.push(refreshAccount());
        }

        const [nextSongs, nextArtists] = await Promise.all(requests);
        setSongs(nextSongs);
        setArtists(nextArtists);
      } catch (loadError) {
        setError(loadError?.detail || loadError?.message || BACKEND_CONNECTION_ERROR);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [isAuthenticated]
  );

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (!listener) return;
    setProfileForm({
      email: listener.email || "",
      name: listener.name || "",
      phone: listener.phone || "",
    });
  }, [listener]);

  const accountLikedIds = useMemo(
    () => new Set([...(listener?.liked_song_ids || []), ...likedSongIds]),
    [listener, likedSongIds]
  );
  const accountFollowedIds = useMemo(
    () => new Set([...(listener?.followed_artist_ids || []), ...followedArtistIds]),
    [listener, followedArtistIds]
  );

  const likedSongs = useMemo(
    () => songs.filter((song) => accountLikedIds.has(Number(song.id))),
    [songs, accountLikedIds]
  );

  const followedArtists = useMemo(
    () => artists.filter((artist) => accountFollowedIds.has(Number(artist.id))),
    [artists, accountFollowedIds]
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

  const profileName = listener?.name || "Teso Listener";
  const initials = useMemo(() => {
    return profileName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "TT";
  }, [profileName]);

  const listenerCode = listener?.id
    ? `USER ${listener.id}`
    : deviceId
      ? `ID ${deviceId.slice(-8).toUpperCase()}`
      : "SYNCING";

  const hasProfileChanges =
    listener &&
    (profileForm.name.trim() !== listener.name ||
      profileForm.email.trim() !== (listener.email || "") ||
      profileForm.phone.trim() !== (listener.phone || ""));

  function updateAuthField(field, value) {
    setAuthForm((current) => ({ ...current, [field]: value }));
  }

  function messageFromError(actionError) {
    return (
      actionError?.detail ||
      actionError?.cause?.message ||
      actionError?.message ||
      "Something went wrong."
    );
  }

  async function submitAuth() {
    setSubmitting(true);
    setError("");
    try {
      if (authMode === "login") {
        await loginAccount({
          identifier: authForm.identifier,
          password: authForm.password,
        });
      } else {
        await registerAccount({
          email: authForm.email,
          name: authForm.name,
          password: authForm.password,
          phone: authForm.phone,
        });
      }
      setAuthForm({ email: "", identifier: "", name: "", password: "", phone: "" });
      await loadProfile({ refresh: true });
    } catch (actionError) {
      setError(messageFromError(actionError));
    } finally {
      setSubmitting(false);
    }
  }

  async function saveProfile() {
    if (!hasProfileChanges) return;
    setSubmitting(true);
    setError("");
    try {
      await updateAccount({
        email: profileForm.email,
        name: profileForm.name,
        phone: profileForm.phone,
      });
    } catch (actionError) {
      setError(messageFromError(actionError));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    setSubmitting(true);
    try {
      await logout();
    } finally {
      setSubmitting(false);
    }
  }

  function goBackOrHome() {
    if (navigation?.canGoBack?.()) {
      navigation.goBack();
      return;
    }

    navigation.navigate("TesoTabs", { screen: "Home" });
  }

  function openTab(screen) {
    navigation.navigate("TesoTabs", { screen });
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
        <View style={styles.pageTopBar}>
          <TouchableOpacity
            activeOpacity={0.82}
            accessibilityLabel="Back"
            style={styles.backButton}
            onPress={goBackOrHome}
          >
            <Ionicons name="chevron-back" color={colors.softText} size={22} />
          </TouchableOpacity>
          <Text style={styles.pageTitle}>Profile</Text>
          <View style={styles.topBarSpacer} />
        </View>

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
              <Ionicons
                name={isAuthenticated ? "person-circle" : "phone-portrait"}
                color={colors.accent}
                size={14}
              />
              <Text style={styles.deviceText}>{listenerCode}</Text>
            </View>
          </View>
          {isAuthenticated && (
            <TouchableOpacity
              accessibilityLabel="Logout"
              disabled={submitting}
              style={styles.logoutButton}
              onPress={handleLogout}
            >
              <Ionicons name="log-out-outline" color={colors.text} size={21} />
            </TouchableOpacity>
          )}
        </LinearGradient>

        <PlaybackSettings
          enabled={backgroundPlaybackEnabled}
          onValueChange={setBackgroundPlaybackEnabled}
        />

        {authLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : !isAuthenticated ? (
          <AuthCard
            authForm={authForm}
            authMode={authMode}
            error={error}
            setAuthMode={setAuthMode}
            submitting={submitting}
            submitAuth={submitAuth}
            updateAuthField={updateAuthField}
          />
        ) : (
          <>
            <View style={styles.accountPanel}>
              <ProfileInput
                icon="person"
                placeholder="Profile name"
                value={profileForm.name}
                onChangeText={(value) =>
                  setProfileForm((current) => ({ ...current, name: value }))
                }
              />
              <ProfileInput
                icon="mail"
                placeholder="Email"
                value={profileForm.email}
                autoCapitalize="none"
                keyboardType="email-address"
                onChangeText={(value) =>
                  setProfileForm((current) => ({ ...current, email: value }))
                }
              />
              <ProfileInput
                icon="call"
                placeholder="Phone"
                value={profileForm.phone}
                keyboardType="phone-pad"
                onChangeText={(value) =>
                  setProfileForm((current) => ({ ...current, phone: value }))
                }
              />
              <TouchableOpacity
                accessibilityLabel="Save profile"
                disabled={!hasProfileChanges || submitting}
                style={[
                  styles.saveButton,
                  (!hasProfileChanges || submitting) && styles.disabledButton,
                ]}
                onPress={saveProfile}
              >
                <Ionicons
                  name="checkmark"
                  color={hasProfileChanges ? colors.text : colors.muted}
                  size={20}
                />
                <Text
                  style={[
                    styles.saveText,
                    !hasProfileChanges && styles.disabledText,
                  ]}
                >
                  Save profile
                </Text>
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

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            {loading ? (
              <ActivityIndicator color={colors.primary} style={styles.loader} />
            ) : (
              <>
                <SectionHeader
                  title="Liked songs"
                  actionIcon="musical-notes"
                  onPress={() => openTab("Songs")}
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
                    onPress={() => openTab("Songs")}
                  />
                )}

                <SectionHeader
                  title="Following artists"
                  actionIcon="people"
                  onPress={() => openTab("Artists")}
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
                    onPress={() => openTab("Artists")}
                  />
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
      <MiniPlayer />
    </SafeAreaView>
  );
}

function PlaybackSettings({ enabled, onValueChange }) {
  return (
    <View style={styles.settingsPanel}>
      <View style={styles.settingIcon}>
        <Ionicons name="headset" color={colors.accent} size={22} />
      </View>
      <View style={styles.settingCopy}>
        <Text style={styles.settingTitle}>Play in background</Text>
        <Text style={styles.settingStatus}>{enabled ? "On" : "Off"}</Text>
      </View>
      <Switch
        accessibilityLabel="Play in background"
        ios_backgroundColor={colors.elevated}
        thumbColor={enabled ? colors.accent : colors.softText}
        trackColor={{
          false: colors.elevated,
          true: "rgba(249, 115, 22, 0.58)",
        }}
        value={enabled}
        onValueChange={onValueChange}
      />
    </View>
  );
}

function AuthCard({
  authForm,
  authMode,
  error,
  setAuthMode,
  submitting,
  submitAuth,
  updateAuthField,
}) {
  const isLogin = authMode === "login";
  const canSubmit = isLogin
    ? authForm.identifier.trim() && authForm.password.length >= 6
    : authForm.name.trim() &&
      authForm.password.length >= 6 &&
      (authForm.email.trim() || authForm.phone.trim());

  return (
    <View style={styles.authPanel}>
      <View style={styles.segment}>
        <ModeButton
          active={!isLogin}
          label="Create"
          onPress={() => setAuthMode("register")}
        />
        <ModeButton active={isLogin} label="Login" onPress={() => setAuthMode("login")} />
      </View>

      {!isLogin && (
        <ProfileInput
          icon="person"
          placeholder="Profile name"
          value={authForm.name}
          onChangeText={(value) => updateAuthField("name", value)}
        />
      )}

      {isLogin ? (
        <ProfileInput
          autoCapitalize="none"
          icon="person-circle"
          placeholder="Email or phone"
          value={authForm.identifier}
          onChangeText={(value) => updateAuthField("identifier", value)}
        />
      ) : (
        <>
          <ProfileInput
            autoCapitalize="none"
            icon="mail"
            keyboardType="email-address"
            placeholder="Email"
            value={authForm.email}
            onChangeText={(value) => updateAuthField("email", value)}
          />
          <ProfileInput
            icon="call"
            keyboardType="phone-pad"
            placeholder="Phone"
            value={authForm.phone}
            onChangeText={(value) => updateAuthField("phone", value)}
          />
        </>
      )}

      <ProfileInput
        icon="lock-closed"
        placeholder="Password"
        secureTextEntry
        value={authForm.password}
        onChangeText={(value) => updateAuthField("password", value)}
      />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <TouchableOpacity
        accessibilityLabel={isLogin ? "Login" : "Create account"}
        disabled={!canSubmit || submitting}
        style={[styles.primaryButton, (!canSubmit || submitting) && styles.disabledButton]}
        onPress={submitAuth}
      >
        {submitting ? (
          <ActivityIndicator color={colors.text} />
        ) : (
          <>
            <Ionicons
              name={isLogin ? "log-in" : "person-add"}
              color={colors.text}
              size={19}
            />
            <Text style={styles.primaryButtonText}>
              {isLogin ? "Login" : "Create account"}
            </Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

function ModeButton({ active, label, onPress }) {
  return (
    <TouchableOpacity
      style={[styles.modeButton, active && styles.activeModeButton]}
      onPress={onPress}
    >
      <Text style={[styles.modeText, active && styles.activeModeText]}>{label}</Text>
    </TouchableOpacity>
  );
}

function ProfileInput({ icon, ...props }) {
  return (
    <View style={styles.inputShell}>
      <Ionicons name={icon} color={colors.muted} size={18} />
      <TextInput
        placeholderTextColor={colors.muted}
        style={styles.input}
        {...props}
      />
    </View>
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
  pageTopBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  backButton: {
    alignItems: "center",
    backgroundColor: colors.elevated,
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  pageTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "950",
    textTransform: "uppercase",
  },
  topBarSpacer: {
    width: 40,
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
  logoutButton: {
    alignItems: "center",
    backgroundColor: colors.elevated,
    borderRadius: 8,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  settingsPanel: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 72,
    padding: 14,
  },
  settingIcon: {
    alignItems: "center",
    backgroundColor: "rgba(250, 204, 21, 0.12)",
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  settingCopy: {
    flex: 1,
    gap: 4,
  },
  settingTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  settingStatus: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
  },
  authPanel: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  accountPanel: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  segment: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    flexDirection: "row",
    gap: 6,
    padding: 4,
  },
  modeButton: {
    alignItems: "center",
    borderRadius: 8,
    flex: 1,
    minHeight: 38,
    justifyContent: "center",
  },
  activeModeButton: {
    backgroundColor: colors.primary,
  },
  modeText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "900",
  },
  activeModeText: {
    color: colors.text,
  },
  inputShell: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  input: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    minHeight: 44,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 8,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 48,
  },
  primaryButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  saveButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 8,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 44,
  },
  saveText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  disabledButton: {
    backgroundColor: colors.elevated,
  },
  disabledText: {
    color: colors.muted,
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
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
});

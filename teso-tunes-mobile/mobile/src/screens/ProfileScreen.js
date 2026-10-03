import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
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

import { BACKEND_CONNECTION_ERROR } from "../api/musicApi";
import MiniPlayer from "../components/MiniPlayer";
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
  const { deviceId } = useEngagement();
  const { backgroundPlaybackEnabled, setBackgroundPlaybackEnabled } = usePlayer();
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
        }
        setError("");

        if (!isAuthenticated) {
          return;
        }

        await refreshAccount();
      } catch (loadError) {
        setError(loadError?.detail || loadError?.message || BACKEND_CONNECTION_ERROR);
      } finally {
        setRefreshing(false);
      }
    },
    [isAuthenticated, refreshAccount]
  );

  useFocusEffect(
    useCallback(() => {
      if (isAuthenticated) {
        loadProfile({ refresh: true });
      }
    }, [isAuthenticated, loadProfile])
  );

  useEffect(() => {
    if (!listener) return;
    setProfileForm({
      email: listener.email || "",
      name: listener.name || "",
      phone: listener.phone || "",
    });
  }, [listener]);

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
    if (submitting) return;
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
      navigation.navigate("TesoTabs", { screen: "Home" });
    } catch (actionError) {
      setError(messageFromError(actionError));
    } finally {
      setSubmitting(false);
    }
  }

  async function saveProfile() {
    if (!hasProfileChanges || submitting) return;
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

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      enabled={Platform.OS !== "web"}
      style={styles.keyboardAvoider}
    >
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
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
              <Ionicons
                name="chevron-back"
                color={colors.softText}
                size={22}
              />
            </TouchableOpacity>
          <Text style={styles.pageTitle}>Profile</Text>
          <View style={styles.topBarSpacer} />
        </View>

        <LinearGradient colors={["#081F24", "#160919"]} style={styles.hero}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.identity}>
            <Text style={styles.kicker}>{isAuthenticated ? "Profile" : "Your music, saved"}</Text>
            <Text style={styles.name} numberOfLines={1}>
              {isAuthenticated ? profileName : "Make it yours"}
            </Text>
            <View style={styles.deviceRow}>
              <Ionicons
                name={isAuthenticated ? "person-circle" : "phone-portrait"}
                color={colors.accent}
                size={14}
              />
              <Text style={styles.deviceText}>
                {isAuthenticated ? listenerCode : "Sign in or create an account"}
              </Text>
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

        {!isAuthenticated ? (
          <View style={styles.authInvitation}>
            <Text style={styles.invitationText}>Sign in or create an account to save likes, follow artists and keep your playlists across devices. You can listen to public songs without an account.</Text>
            <TouchableOpacity accessibilityRole="button" style={styles.keepListening} onPress={goBackOrHome}>
              <Ionicons name="play-outline" color={colors.primary} size={20} />
              <Text style={styles.keepListeningText}>Keep listening</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {isAuthenticated ? (
          <>
            <Text style={styles.sectionTitle}>Settings</Text>
            <PlaybackSettings
              enabled={backgroundPlaybackEnabled}
              onValueChange={setBackgroundPlaybackEnabled}
            />
          </>
        ) : null}

        <SupportSettingsPanel onPress={() => navigation.navigate("Support")} />

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
              <Text style={styles.settingTitle}>Edit Profile</Text>
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
                returnKeyType="done"
                onChangeText={(value) =>
                  setProfileForm((current) => ({ ...current, phone: value }))
                }
                onSubmitEditing={saveProfile}
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

            <ArtistAccessPanel
              application={listener?.artist_application}
              navigation={navigation}
              role={listener?.role || "listener"}
            />

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </>
        )}
      </ScrollView>
      {isAuthenticated ? <MiniPlayer /> : null}
    </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

function ArtistAccessPanel({ application, navigation, role }) {
  const status = application?.status || "";
  const reason = application?.rejection_reason || application?.review_reason || "";

  if (role === "artist") {
    return (
      <View style={styles.artistPanel}>
        <View style={styles.artistIcon}>
          <Ionicons name="stats-chart" color={colors.primary} size={22} />
        </View>
        <View style={styles.artistCopy}>
          <Text style={styles.artistTitle}>Artist Studio</Text>
          <Text style={styles.artistText}>Manage your releases and upload music.</Text>
        </View>
        <TouchableOpacity
          style={styles.artistAction}
          onPress={() => navigation.navigate("ArtistStudio")}
        >
          <Ionicons name="arrow-forward" color={colors.background} size={20} />
        </TouchableOpacity>
      </View>
    );
  }

  if (role === "artist_pending" || status === "pending") {
    return (
      <View style={styles.artistPanel}>
        <View style={styles.artistIcon}>
          <Ionicons name="time" color={colors.primary} size={22} />
        </View>
        <View style={styles.artistCopy}>
          <Text style={styles.artistTitle}>Artist Application - Under Review</Text>
          <Text style={styles.artistText}>Uploads unlock after admin approval.</Text>
        </View>
      </View>
    );
  }

  if (status === "rejected" || status === "changes_requested") {
    return (
      <View style={styles.artistPanel}>
        <View style={styles.artistIcon}>
          <Ionicons name="alert-circle" color={colors.accent} size={22} />
        </View>
        <View style={styles.artistCopy}>
          <Text style={styles.artistTitle}>
            {status === "changes_requested" ? "Application Needs Changes" : "Application Rejected"}
          </Text>
          <Text style={styles.artistText}>{reason || "You can update and apply again."}</Text>
        </View>
        <TouchableOpacity
          style={styles.artistAction}
          onPress={() => navigation.navigate("ArtistApplication")}
        >
          <Ionicons name="create" color={colors.background} size={19} />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.artistPanel}>
      <View style={styles.artistIcon}>
        <Ionicons name="mic" color={colors.primary} size={22} />
      </View>
      <View style={styles.artistCopy}>
        <Text style={styles.artistTitle}>Become an Artist</Text>
        <Text style={styles.artistText}>Apply for approval before uploading music.</Text>
      </View>
      <TouchableOpacity
        style={styles.artistAction}
        onPress={() => navigation.navigate("ArtistApplication")}
      >
        <Ionicons name="add" color={colors.background} size={22} />
      </TouchableOpacity>
    </View>
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
          true: "rgba(32, 230, 243, 0.58)",
        }}
        value={enabled}
        onValueChange={onValueChange}
      />
    </View>
  );
}

function SupportSettingsPanel({ onPress }) {
  return (
    <TouchableOpacity
      activeOpacity={0.84}
      accessibilityLabel="Open Help and Support"
      style={styles.settingsPanel}
      onPress={onPress}
    >
      <View style={styles.settingIcon}>
        <Ionicons name="help-buoy" color={colors.primary} size={22} />
      </View>
      <View style={styles.settingCopy}>
        <Text style={styles.settingTitle}>Help & Support</Text>
        <Text style={styles.settingStatus}>Support requests, replies, and help articles</Text>
      </View>
      <Ionicons name="chevron-forward" color={colors.muted} size={20} />
    </TouchableOpacity>
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
  const [showValidation, setShowValidation] = useState(false);
  const validationMessage = getAuthValidationMessage(authForm, isLogin);
  const canSubmit = !validationMessage;

  useEffect(() => {
    setShowValidation(false);
  }, [authMode]);

  function handleSubmitPress() {
    if (submitting) return;
    if (validationMessage) {
      setShowValidation(true);
      return;
    }

    submitAuth();
  }

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
        returnKeyType="done"
        secureTextEntry
        value={authForm.password}
        onChangeText={(value) => updateAuthField("password", value)}
        onSubmitEditing={handleSubmitPress}
      />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {showValidation && validationMessage ? (
        <Text style={styles.validationText}>{validationMessage}</Text>
      ) : null}

      <TouchableOpacity
        accessibilityLabel={isLogin ? "Login" : "Create account"}
        disabled={submitting}
        style={[styles.primaryButton, submitting && styles.disabledButton]}
        onPress={handleSubmitPress}
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

function getAuthValidationMessage(authForm, isLogin) {
  if (isLogin) {
    if (!authForm.identifier.trim()) {
      return "Enter your email or phone number.";
    }
    if (authForm.password.length < 6) {
      return "Password must be at least 6 characters.";
    }
    return "";
  }

  if (authForm.name.trim().length < 2) {
    return "Enter your profile name.";
  }
  if (!authForm.email.trim() && !authForm.phone.trim()) {
    return "Enter an email or phone number.";
  }
  if (authForm.password.length < 6) {
    return "Password must be at least 6 characters.";
  }
  return "";
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

const styles = StyleSheet.create({
  authInvitation: { gap: 8, marginBottom: 16 },
  invitationText: { color: colors.softText, fontSize: 15, lineHeight: 23 },
  keepListening: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10 },
  keepListeningText: { color: colors.primary, fontSize: 16, fontWeight: "800" },
  safe: {
    backgroundColor: colors.background,
    flex: 1,
  },
  keyboardAvoider: {
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
    borderColor: "rgba(32, 230, 243, 0.34)",
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
    color: colors.muted,
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
    backgroundColor: "rgba(244, 39, 200, 0.12)",
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
  artistPanel: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: "rgba(32, 230, 243, 0.26)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 74,
    padding: 12,
  },
  artistIcon: {
    alignItems: "center",
    backgroundColor: "rgba(32, 230, 243, 0.1)",
    borderRadius: 8,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  artistCopy: {
    flex: 1,
    gap: 4,
  },
  artistTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  artistText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
  },
  artistAction: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 8,
    height: 40,
    justifyContent: "center",
    width: 40,
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
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
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
  validationText: {
    color: colors.softText,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 19,
    textAlign: "center",
  },
});

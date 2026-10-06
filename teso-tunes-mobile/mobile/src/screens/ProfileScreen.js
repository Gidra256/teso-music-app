import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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

import { BACKEND_CONNECTION_ERROR } from "../api/musicApi";
import MiniPlayer from "../components/MiniPlayer";
import { AccountRow, accountStyles } from "../components/AccountPage";
import { useAuth } from "../context/AuthContext";
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
  } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [authMode, setAuthMode] = useState("");
  const [authForm, setAuthForm] = useState({
    email: "",
    identifier: "",
    name: "",
    password: "",
    phone: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

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

  const profileName = listener?.name || "Teso Listener";
  const initials = useMemo(() => {
    return profileName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "TT";
  }, [profileName]);

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
    if (submittingRef.current) return;
    submittingRef.current = true;
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
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await logout();
      setAuthMode("");
      setAuthForm({ email: "", identifier: "", name: "", password: "", phone: "" });
    } finally {
      submittingRef.current = false;
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

        <View style={styles.hero}>
          <View style={styles.avatar}>
            {isAuthenticated ? <Text style={styles.avatarText}>{initials}</Text> : <Ionicons name="person-outline" color={colors.background} size={30} />}
          </View>
          <View style={styles.identity}>
            {isAuthenticated ? <Text style={styles.kicker}>{listener?.role === "artist" ? "Artist" : "Listener"}</Text> : null}
            <Text style={styles.name}>
              {isAuthenticated ? profileName : "Make TesoHub yours"}
            </Text>
          </View>
          {isAuthenticated ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Edit Profile" activeOpacity={0.65} style={styles.editButton} onPress={() => navigation.navigate("EditProfile")}>
            <Ionicons name="create-outline" color={colors.text} size={18} />
            <Text style={styles.editText}>Edit Profile</Text>
          </TouchableOpacity> : null}
        </View>

        {!isAuthenticated ? (
          <View style={styles.authInvitation}>
            <Text style={styles.invitationText}>Create an account to like songs, follow artists and build playlists. You can listen to public songs without an account.</Text>
          </View>
        ) : null}

        {authLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : !isAuthenticated ? (
          <>
          <AuthCard
            authForm={authForm}
            authMode={authMode}
            error={error}
            setAuthMode={setAuthMode}
            submitting={submitting}
            submitAuth={submitAuth}
            updateAuthField={updateAuthField}
          />
          <TouchableOpacity accessibilityRole="button" style={styles.keepListening} onPress={goBackOrHome}>
            <Ionicons name="play-outline" color={colors.primary} size={20} />
            <Text style={styles.keepListeningText}>Keep Listening</Text>
          </TouchableOpacity>
          <AccountRow title="Help & Support" accessibilityLabel="Open Help and Support" icon="help-buoy-outline" onPress={() => navigation.navigate("Support")} />
          </>
        ) : (
          <>
            <Text style={accountStyles.section}>Artist</Text>
            <ArtistAccessPanel
              application={listener?.artist_application}
              navigation={navigation}
              role={listener?.role || "listener"}
            />
            <Text style={accountStyles.section}>Account</Text>
            <AccountRow title="Settings" icon="settings-outline" onPress={() => navigation.navigate("Settings")} />
            <AccountRow title="Help & Support" accessibilityLabel="Open Help and Support" icon="help-buoy-outline" onPress={() => navigation.navigate("Support")} />
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Log out" disabled={submitting} activeOpacity={0.65} style={styles.logoutButton} onPress={handleLogout}>
              {submitting ? <ActivityIndicator color={colors.text} /> : <Ionicons name="log-out-outline" color={colors.text} size={22} />}
              <Text style={styles.editText}>{submitting ? "Logging out..." : "Log out"}</Text>
            </TouchableOpacity>
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
          <Text style={styles.artistText}>Manage releases and upload music.</Text>
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Open Artist Studio"
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
          <Text style={styles.artistTitle}>Artist Application</Text>
          <Text style={styles.artistText}>Under Review</Text>
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
          accessibilityRole="button"
          accessibilityLabel="Edit or reapply"
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
        accessibilityRole="button"
        accessibilityLabel="Open Artist Application"
        style={styles.artistAction}
        onPress={() => navigation.navigate("ArtistApplication")}
      >
        <Ionicons name="add" color={colors.background} size={22} />
      </TouchableOpacity>
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
          active={authMode === "register"}
          label="Create Account"
          disabled={submitting}
          onPress={() => setAuthMode("register")}
        />
        <ModeButton active={isLogin} label="Log In" disabled={submitting} onPress={() => setAuthMode("login")} />
      </View>
      {authMode ? <>
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
      </> : null}
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

function ModeButton({ active, label, onPress, disabled }) {
  return (
    <TouchableOpacity
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      disabled={disabled}
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
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
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
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  pageTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "950",
    textTransform: "uppercase",
  },
  topBarSpacer: {
    width: 44,
  },
  hero: {
    alignItems: "center",
    gap: 14,
    paddingVertical: 16,
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
    color: colors.background,
    fontSize: 23,
    fontWeight: "900",
  },
  identity: {
    width: "100%",
    alignItems: "center",
    gap: 5,
  },
  kicker: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  name: {
    textAlign: "center",
    ...(Platform.OS === "web" ? { overflowWrap: "anywhere" } : {}),
    color: colors.text,
    fontSize: 24,
    fontWeight: "900",
  },
  logoutButton: {
    alignItems: "center",
    backgroundColor: colors.elevated,
    borderRadius: 8,
    minHeight: 48,
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
    marginTop: 20,
  },
  editButton: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", minHeight: 48, paddingHorizontal: 18, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  editText: { color: colors.text, fontSize: 15, fontWeight: "800" },
  authPanel: {
    gap: 12,
  },
  artistPanel: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 74,
    paddingVertical: 12,
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
    height: 48,
    justifyContent: "center",
    width: 48,
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
    minHeight: 44,
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
    minWidth: 0,
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
  disabledButton: {
    backgroundColor: colors.elevated,
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

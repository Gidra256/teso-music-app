import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Image,
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

import { BACKEND_CONNECTION_ERROR, getGoogleLinkStatus, resolveAccountAvatarUrl } from "../api/musicApi";
import MiniPlayer from "../components/MiniPlayer";
import GoogleSignInButton from "../components/GoogleSignInButton";
import { AccountRow, accountStyles } from "../components/AccountPage";
import { useAuth } from "../context/AuthContext";
import { colors, spacing } from "../theme";

export default function ProfileScreen({ navigation }) {
  const {
    isAuthenticated,
    listener,
    loading: authLoading,
    loginAccount,
    loginWithGoogle,
    linkGoogle,
    logout,
    refreshAccount,
    registerAccount,
  } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [googleLinked, setGoogleLinked] = useState(false);
  const [googleMessage, setGoogleMessage] = useState("");
  const [error, setError] = useState("");
  const [authMode, setAuthMode] = useState("register");
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

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (isAuthenticated && Platform.OS === "web") {
        getGoogleLinkStatus()
          .then((result) => { if (active) setGoogleLinked(Boolean(result.linked)); })
          .catch(() => { /* Login and account pages stay usable if Google is unavailable. */ });
      } else {
        setGoogleLinked(false);
      }
      return () => { active = false; };
    }, [isAuthenticated, listener?.id])
  );

  const profileName = listener?.name || "Teso Listener";
  const avatarUri = resolveAccountAvatarUrl(listener?.avatar_url);
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

  async function submitGoogleAuth(credential) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      await loginWithGoogle(credential);
      setAuthForm({ email: "", identifier: "", name: "", password: "", phone: "" });
      navigation.navigate("TesoTabs", { screen: "Home" });
    } catch (actionError) {
      setError(messageFromError(actionError));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function submitGoogleLink(credential) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    setGoogleMessage("");
    try {
      const result = await linkGoogle(credential);
      setGoogleLinked(true);
      setGoogleMessage(result.already_linked
        ? "This Google account is already connected."
        : "Google connected! You can now sign in with Google.");
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
      setGoogleLinked(false);
      setGoogleMessage("");
      setAuthMode("register");
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
            {isAuthenticated && avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImage} accessibilityLabel="Your profile picture" />
            ) : isAuthenticated ? (
              <Text style={styles.avatarText}>{initials}</Text>
            ) : (
              <Ionicons name="person-outline" color={colors.background} size={30} />
            )}
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
            onGoogleCredential={submitGoogleAuth}
            updateAuthField={updateAuthField}
          />
          <TouchableOpacity accessibilityRole="button" style={styles.keepListening} onPress={goBackOrHome}>
            <Ionicons name="play-outline" color={colors.primary} size={20} />
            <Text style={styles.keepListeningText}>Keep Listening</Text>
          </TouchableOpacity>
          <AccountRow title="Help & Support" accessibilityLabel="Open Help and Support" icon="help-buoy-outline" onPress={() => navigation.navigate("Support")} />
          <AccountRow title="About TesoHub Music" icon="information-circle-outline" onPress={() => navigation.navigate("About")} />
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
            <AccountRow title="About TesoHub Music" icon="information-circle-outline" onPress={() => navigation.navigate("About")} />
            {Platform.OS === "web" ? (
              <View style={styles.googleLinkPanel}>
                <Text style={styles.googleLinkHeading}>Google sign-in</Text>
                <Text style={styles.googleLinkDescription}>
                  {googleLinked ? "Your Google account is connected." : "Connect Google to this account before using Google to sign in."}
                </Text>
                {!googleLinked ? (
                  <GoogleSignInButton onCredential={submitGoogleLink} disabled={submitting} linkedMode />
                ) : null}
                {googleMessage ? <Text style={styles.googleLinkMessage}>{googleMessage}</Text> : null}
              </View>
            ) : null}
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
  const verificationStatus = application?.verification_status || "unverified";
  const reason = application?.rejection_reason || application?.review_reason || "";
  const verificationLabels = {
    unverified: "Identity verification not completed",
    verification_pending: "Identity verification pending",
    verified: "Identity verified",
    additional_information_required: "Identity verification needs more information",
  };

  if (role === "artist") {
    return (
      <View style={styles.artistPanel}>
        <View style={styles.artistIcon}>
          <Ionicons name="stats-chart" color={colors.primary} size={22} />
        </View>
        <View style={styles.artistCopy}>
          <Text style={styles.artistTitle}>Artist Studio</Text>
          <Text style={styles.artistText}>Manage releases and upload music.</Text>
          <Text style={styles.artistText}>{verificationLabels[verificationStatus]}</Text>
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
          <Text style={styles.artistText}>{verificationLabels[verificationStatus]}</Text>
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

function AuthCard({ authForm, authMode, error, setAuthMode, submitting, submitAuth, onGoogleCredential, updateAuthField }) {
  const isLogin = authMode === "login";
  const [showPassword, setShowPassword] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const validationMessage = getAuthValidationMessage(authForm, isLogin);

  useEffect(() => {
    setAttempted(false);
    setShowPassword(false);
  }, [authMode]);

  function handleSubmit() {
    if (submitting) return;
    if (validationMessage) {
      setAttempted(true);
      return;
    }
    submitAuth();
  }

  return (
    <View style={styles.modernRegistrationPanel}>
      <View style={styles.modernBrandRow}>
        <View style={styles.modernBrandIcon}>
          <Ionicons name="musical-notes" size={22} color={colors.background} />
        </View>
        <Text style={styles.modernBrandText}>TESOHUB MUSIC</Text>
      </View>

      <Text style={styles.modernTitle}>
        {isLogin ? "Welcome back." : "Your music. Your world."}
      </Text>

      <Text style={styles.modernSubtitle}>
        {isLogin
          ? "Log in to pick up where the music left off."
          : "Create a free account to discover artists, save favorites and make playlists."}
      </Text>

      <View style={styles.modernTabs}>
        <ModeButton
          active={!isLogin}
          label="Sign up"
          disabled={submitting}
          onPress={() => setAuthMode("register")}
        />
        <ModeButton
          active={isLogin}
          label="Log in"
          disabled={submitting}
          onPress={() => setAuthMode("login")}
        />
      </View>

      <GoogleSignInButton onCredential={onGoogleCredential} disabled={submitting} />
      {Platform.OS === "web" ? (
        <Text style={styles.googleDivider}>OR CONTINUE WITH EMAIL</Text>
      ) : null}

      {!isLogin ? (
        <>
          <ProfileInput
            label="Display name"
            icon="person-outline"
            placeholder="What should we call you?"
            autoComplete="name"
            value={authForm.name}
            onChangeText={value => updateAuthField("name", value)}
          />
          <ProfileInput
            label="Email address"
            icon="mail-outline"
            placeholder="you@example.com"
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            value={authForm.email}
            onChangeText={value => updateAuthField("email", value)}
          />
          <ProfileInput
            label="Phone number"
            icon="call-outline"
            placeholder="Your phone number"
            keyboardType="phone-pad"
            autoComplete="tel"
            value={authForm.phone}
            onChangeText={value => updateAuthField("phone", value)}
          />
          <Text style={styles.modernHint}>
            Add an email or phone number ? at least one is required.
          </Text>
        </>
      ) : (
        <ProfileInput
          label="Email or phone"
          icon="person-circle-outline"
          placeholder="Enter your email or phone"
          autoCapitalize="none"
          autoComplete="username"
          value={authForm.identifier}
          onChangeText={value => updateAuthField("identifier", value)}
        />
      )}

      <View style={styles.modernField}>
        <Text style={styles.modernLabel}>Password</Text>
        <View style={styles.modernPasswordBox}>
          <Ionicons name="lock-closed-outline" color={colors.softText} size={20} />

          <TextInput
            accessibilityLabel="Password"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete={isLogin ? "current-password" : "new-password"}
            placeholder="At least 6 characters"
            placeholderTextColor={colors.muted}
            secureTextEntry={!showPassword}
            value={authForm.password}
            onChangeText={value => updateAuthField("password", value)}
            onSubmitEditing={handleSubmit}
            returnKeyType="done"
            style={styles.modernTextInput}
          />

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={showPassword ? "Hide password" : "Show password"}
            onPress={() => setShowPassword(value => !value)}
            style={styles.modernEye}
          >
            <Ionicons
              name={showPassword ? "eye-off-outline" : "eye-outline"}
              color={colors.softText}
              size={20}
            />
          </TouchableOpacity>
        </View>
      </View>

      {!isLogin && authForm.password.length > 0 ? (
        <View style={styles.modernMeterRow}>
          {[6, 8, 12].map(n => (
            <View
              key={n}
              style={[
                styles.modernMeter,
                authForm.password.length >= n && styles.modernMeterOn
              ]}
            />
          ))}
          <Text style={styles.modernMeterLabel}>
            {authForm.password.length < 6
              ? "Too short"
              : authForm.password.length < 8
              ? "Minimum length met"
              : authForm.password.length < 12
              ? "Longer is better"
              : "Good length"}
          </Text>
        </View>
      ) : null}

      {error ? (
        <Text accessibilityRole="alert" style={styles.modernError}>{error}</Text>
      ) : null}

      {attempted && validationMessage ? (
        <Text accessibilityRole="alert" style={styles.modernError}>
          {validationMessage}
        </Text>
      ) : null}

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={isLogin ? "Log in" : "Create account"}
        disabled={submitting}
        activeOpacity={0.8}
        style={[styles.modernSubmit, submitting && { opacity: 0.65 }]}
        onPress={handleSubmit}
      >
        {submitting ? (
          <ActivityIndicator color={colors.background} />
        ) : (
          <>
            <Text style={styles.modernSubmitText}>
              {isLogin ? "Log in" : "Create my account"}
            </Text>
            <Ionicons name="arrow-forward" size={20} color={colors.background} />
          </>
        )}
      </TouchableOpacity>

      <Text style={styles.modernFooter}>
        Free to join  ?  Discover, listen, connect
      </Text>
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

function ProfileInput({ label, icon, ...props }) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.modernField}>
      <Text style={styles.modernLabel}>{label}</Text>
      <View style={[
        styles.modernInputBox,
        focused && { borderColor: colors.primary }
      ]}>
        <Ionicons
          name={icon}
          color={focused ? colors.primary : colors.softText}
          size={20}
        />
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={colors.muted}
          style={styles.modernTextInput}
          {...props}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  googleDivider: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.softText,
    letterSpacing: 1.1,
    textAlign: "center",
    marginVertical: 2,
  },
  googleLinkPanel: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 18,
    padding: 18,
    gap: 12,
    marginTop: 12,
  },
  googleLinkHeading: { color: colors.text, fontSize: 16, fontWeight: "800" },
  googleLinkDescription: { color: colors.softText, fontSize: 13, lineHeight: 20 },
  googleLinkMessage: { color: colors.primary, fontSize: 13 },

  modernRegistrationPanel: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
    padding: 22,
    gap: 16,
    maxWidth: 560,
    width: "100%",
    alignSelf: "center"
  },
  modernBrandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 4
  },
  modernBrandIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center"
  },
  modernBrandText: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2
  },
  modernTitle: {
    color: colors.text,
    fontSize: 27,
    lineHeight: 32,
    fontWeight: "900",
    letterSpacing: -0.7
  },
  modernSubtitle: {
    color: colors.softText,
    lineHeight: 22,
    fontSize: 14,
    marginBottom: 2
  },
  modernTabs: {
    flexDirection: "row",
    backgroundColor: colors.elevated,
    padding: 5,
    borderRadius: 16,
    gap: 6
  },
  modernField: { gap: 7 },
  modernLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800"
  },
  modernInputBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    minHeight: 54,
    paddingHorizontal: 14,
    backgroundColor: colors.surface
  },
  modernPasswordBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    minHeight: 54,
    paddingHorizontal: 14,
    backgroundColor: colors.surface
  },
  modernTextInput: {
    color: colors.text,
    fontSize: 15,
    minWidth: 0,
    flex: 1,
    minHeight: 52
  },
  modernEye: {
    padding: 8,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center"
  },
  modernHint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: -7
  },
  modernMeterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5
  },
  modernMeter: {
    flex: 1,
    height: 4,
    borderRadius: 8,
    backgroundColor: colors.border
  },
  modernMeterOn: { backgroundColor: colors.primary },
  modernMeterLabel: {
    color: colors.muted,
    fontSize: 10,
    marginLeft: 7
  },
  modernError: {
    color: "#FF8D94",
    lineHeight: 20,
    fontSize: 13
  },
  modernSubmit: {
    minHeight: 54,
    borderRadius: 15,
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 3
  },
  modernSubmitText: {
    color: colors.background,
    fontSize: 16,
    fontWeight: "900"
  },
  modernFooter: {
    textAlign: "center",
    color: colors.softText,
    fontSize: 12,
    marginTop: 2
  },

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
    overflow: "hidden",
    width: 64,
  },
  avatarImage: { width: 64, height: 64, borderRadius: 32 },
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

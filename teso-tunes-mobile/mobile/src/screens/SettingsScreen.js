import { useRef, useState } from "react";
import { Image, Platform, StyleSheet, Switch, Text, View } from "react-native";

import appConfig from "../../app.json";
import AppAccess from "../components/AppAccess";
import AccountPage, { AccountRow, accountStyles } from "../components/AccountPage";
import { useAuth } from "../context/AuthContext";
import { usePlayer } from "../context/PlayerContext";
import { colors } from "../theme";

export default function SettingsScreen({ navigation }) {
  const { listener } = useAuth();
  const { backgroundPlaybackEnabled, setBackgroundPlaybackEnabled } = usePlayer();
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function changeBackground(enabled) {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError("");
    try { await setBackgroundPlaybackEnabled(enabled); }
    catch { setError("Could not apply your playback preference. Please try again."); }
    finally { pending.current = false; setSaving(false); }
  }
  const artist = ["artist", "artist_pending"].includes(listener?.role);
  return (
    <AccountPage title="Settings" navigation={navigation}>
      <Text style={accountStyles.section}>Playback</Text>
      <View style={styles.playback}>
        <View style={styles.copy}>
          <Text style={accountStyles.heading}>Play in background</Text>
          <Text style={accountStyles.text}>{Platform.OS === "web" ? "Background playback is managed by your browser and device." : saving ? "Updating..." : backgroundPlaybackEnabled ? "On" : "Off"}</Text>
        </View>
        {Platform.OS !== "web" ? <Switch accessibilityLabel="Play in background" disabled={saving} value={backgroundPlaybackEnabled} onValueChange={changeBackground} trackColor={{ false: colors.border, true: colors.primary }} thumbColor={colors.text} /> : null}
      </View>
      {error ? <Text accessibilityRole="alert" style={accountStyles.text}>{error}</Text> : null}
      <Text style={accountStyles.section}>Account</Text>
      <AccountRow title="Account information" icon="person-outline" onPress={() => navigation.navigate("EditProfile")} />
      <Text style={accountStyles.section}>Privacy & Data</Text>
      <AccountRow title="Request account deletion" subtitle="Send a request to Support. Your account is not deleted immediately." icon="trash-outline" onPress={() => navigation.navigate("SupportTicketForm", { category: artist ? "Other" : "Account / Login", subject: "Account deletion request" })} />
      <AppAccess persistent />
      <Text style={accountStyles.section}>About</Text>
      <View style={styles.about}>
        <Image source={require("../../assets/images/tesohub-music.png")} style={styles.logo} accessibilityLabel="TesoHub Music logo" />
        <View style={styles.copy}>
          <Text style={accountStyles.heading}>About TesoHub Music</Text>
          <Text style={accountStyles.text}>Discover Teso music and the artists behind it.</Text>
          <Text style={accountStyles.text}>Version {appConfig.expo.version}</Text>
        </View>
      </View>
    </AccountPage>
  );
}

const styles = StyleSheet.create({
  playback: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56 },
  copy: { flex: 1, minWidth: 0, gap: 6 },
  about: { flexDirection: "row", gap: 14, alignItems: "center" },
  logo: { width: 56, height: 56, borderRadius: 8 },
});

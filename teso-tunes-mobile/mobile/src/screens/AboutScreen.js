import { Ionicons } from "@expo/vector-icons";
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import MiniPlayer from "../components/MiniPlayer";
import { SUPPORT_EMAIL, supportEmailUrl } from "../config/contact";
import { useAuth } from "../context/AuthContext";
import { colors, spacing } from "../theme";

export default function AboutScreen({ navigation }) {
  const { isAuthenticated, listener } = useAuth();
  const canApply = isAuthenticated && !["artist", "artist_pending"].includes(listener?.role);

  function openArtistAccess() {
    if (!isAuthenticated) {
      navigation.navigate("Profile", { loginRequired: true });
      return;
    }
    navigation.navigate(listener?.role === "artist" ? "ArtistStudio" : "ArtistApplication");
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topbar}>
          <TouchableOpacity accessibilityLabel="Go back" style={styles.iconButton} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" color={colors.softText} size={22} />
          </TouchableOpacity>
          <Text style={styles.title}>About TesoHub Music</Text>
          <View style={styles.spacer} />
        </View>

        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Our Music. Our Artists. Our Home.</Text>
          <Text style={styles.heading}>TesoHub Music</Text>
          <Text style={styles.body}>
            TesoHub Music is a platform dedicated to discovering, celebrating, preserving, and sharing Teso music while creating opportunities for Teso artists.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>For artists</Text>
          <Text style={styles.body}>Artist applications, agreements, identity review, music uploads, and release review use the existing protected artist workflow.</Text>
          <ActionRow
            icon="mic-outline"
            label={listener?.role === "artist" ? "Open Artist Studio" : canApply ? "Apply as an Artist" : "Artist access"}
            onPress={openArtistAccess}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Help and information</Text>
          <ActionRow icon="help-buoy-outline" label="Help & Support" onPress={() => navigation.navigate("Support")} />
          <ActionRow icon="mail-outline" label={SUPPORT_EMAIL} onPress={() => Linking.openURL(supportEmailUrl())} />
          {isAuthenticated ? (
            <ActionRow icon="shield-checkmark-outline" label="Privacy & account data" onPress={() => navigation.navigate("Settings")} />
          ) : (
            <ActionRow icon="person-outline" label="Create account or log in" onPress={() => navigation.navigate("Profile", { loginRequired: true })} />
          )}
          <Text style={styles.note}>The applicable Artist Agreement is shown in the artist application and Artist Studio before acceptance is recorded.</Text>
        </View>
      </ScrollView>
      {isAuthenticated ? <MiniPlayer /> : null}
    </SafeAreaView>
  );
}

function ActionRow({ icon, label, onPress }) {
  return (
    <TouchableOpacity accessibilityRole="button" style={styles.action} onPress={onPress}>
      <Ionicons name={icon} color={colors.primary} size={21} />
      <Text style={styles.actionText}>{label}</Text>
      <Ionicons name="chevron-forward" color={colors.muted} size={19} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.background, flex: 1 },
  content: { gap: 18, padding: spacing.page, paddingBottom: 120 },
  topbar: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  iconButton: { alignItems: "center", backgroundColor: colors.elevated, borderColor: colors.border, borderRadius: 8, borderWidth: 1, height: 44, justifyContent: "center", width: 44 },
  spacer: { width: 44 },
  title: { color: colors.text, fontSize: 20, fontWeight: "900" },
  hero: { borderBottomColor: colors.border, borderBottomWidth: 1, gap: 10, paddingBottom: 20, paddingTop: 12 },
  eyebrow: { color: colors.primary, fontSize: 14, fontWeight: "800" },
  heading: { color: colors.text, fontSize: 32, fontWeight: "900" },
  body: { color: colors.softText, fontSize: 15, lineHeight: 23 },
  section: { gap: 12 },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "900" },
  action: { alignItems: "center", borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: "row", gap: 12, minHeight: 52, paddingVertical: 8 },
  actionText: { color: colors.text, flex: 1, fontSize: 15, fontWeight: "700" },
  note: { color: colors.muted, fontSize: 13, lineHeight: 20 },
});

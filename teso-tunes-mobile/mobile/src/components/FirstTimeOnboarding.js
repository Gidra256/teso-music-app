import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../context/AuthContext";
import { usePlayer } from "../context/PlayerContext";
import { colors, spacing } from "../theme";
import { hasPreviousListeningAccount, ONBOARDING_HISTORY_KEYS, ONBOARDING_KEY, shouldOfferOnboarding } from "../utils/onboarding";

const FEATURES = [
  { icon: "musical-notes-outline", title: "Discover Music", text: "Find songs, new releases and artists from Teso." },
  { icon: "library-outline", title: "Build Your Library", text: "Like songs, follow artists and create playlists." },
  { icon: "heart-outline", title: "Support Teso Artists", text: "Listen, share and follow the artists you love." },
];

export default function FirstTimeOnboarding({ routeName, onStartListening }) {
  const { isAuthenticated } = useAuth();
  const { currentSong } = usePlayer();
  const [eligible, setEligible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const finished = useRef(false);

  useEffect(() => {
    let active = true;
    async function loadPreference() {
      try {
        const saved = await AsyncStorage.multiGet([ONBOARDING_KEY, ...ONBOARDING_HISTORY_KEYS]);
        const completed = Boolean(saved[0][1]);
        const existingUser = isAuthenticated || hasPreviousListeningAccount(saved.slice(1));
        if (active) setEligible(!completed && !existingUser);
        if (existingUser && !completed) await AsyncStorage.setItem(ONBOARDING_KEY, "existing-user");
      } catch {
        // A local storage failure must never hold up public listening.
        if (active) setEligible(false);
      }
    }
    loadPreference();
    return () => { active = false; };
  }, [isAuthenticated]);

  useEffect(() => {
    // A direct/warm link or playback always wins, even if storage resolves later.
    if ((routeName && routeName !== "Home") || currentSong) setDismissed(true);
  }, [routeName, currentSong]);

  function finish(result) {
    if (finished.current) return;
    finished.current = true;
    setDismissed(true);
    AsyncStorage.setItem(ONBOARDING_KEY, result).catch(() => {
      console.warn("Onboarding preference could not be saved on this device.");
    });
    onStartListening();
  }

  const visible = eligible && shouldOfferOnboarding({
    routeName, completed: false, existingUser: isAuthenticated, dismissed, hasSong: Boolean(currentSong),
  });

  return (
    <Modal visible={visible} animationType="none" onRequestClose={() => finish("skipped")}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.container}>
          <View style={styles.topbar}>
            <Text style={styles.brand}>TesoHub Music</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Skip onboarding" style={styles.skip} onPress={() => finish("skipped")}>
              <Text style={styles.skipText}>Skip</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.content}>
            <Image source={require("../../assets/images/tesohub-music.png")} style={styles.logo} accessible={false} />
            <Text accessibilityRole="header" style={styles.title}>Welcome to TesoHub Music</Text>
            <Text style={styles.subtitle}>Discover Teso music and the artists behind it.</Text>
            <View style={styles.features}>
              {FEATURES.map((feature, index) => (
                <View key={feature.title} style={styles.feature}>
                  <Ionicons name={feature.icon} size={25} color={index === 1 ? colors.accent : colors.primary} accessible={false} />
                  <View style={styles.copy}>
                    <Text style={styles.featureTitle}>{feature.title}</Text>
                    <Text style={styles.description}>{feature.text}</Text>
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
          <View style={styles.footer}>
            <TouchableOpacity accessibilityRole="button" style={styles.start} onPress={() => finish("completed")}>
              <Ionicons name="play" size={21} color={colors.background} accessible={false} />
              <Text style={styles.startText}>Start Listening</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, width: "100%", maxWidth: 560, alignSelf: "center" },
  topbar: { paddingHorizontal: spacing.page, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  brand: { color: colors.primary, fontWeight: "800", fontSize: 16, flexShrink: 1 },
  skip: { minWidth: 56, minHeight: 48, alignItems: "center", justifyContent: "center" },
  skipText: { color: colors.softText, fontSize: 16, fontWeight: "700" },
  content: { padding: spacing.page, paddingTop: 8, flexGrow: 1, justifyContent: "center" },
  logo: { width: 88, height: 88, alignSelf: "center", marginBottom: 12 },
  title: { color: colors.text, fontWeight: "900", fontSize: 28, lineHeight: 35, textAlign: "center" },
  subtitle: { color: colors.softText, fontSize: 16, lineHeight: 24, textAlign: "center", marginTop: 10 },
  features: { gap: 22, marginTop: 30 },
  feature: { flexDirection: "row", gap: 16, alignItems: "flex-start" },
  copy: { flex: 1, minWidth: 0 },
  featureTitle: { color: colors.text, fontSize: 17, fontWeight: "800", marginBottom: 5 },
  description: { color: colors.softText, fontSize: 15, lineHeight: 22 },
  footer: { padding: spacing.page },
  start: { minHeight: 52, backgroundColor: colors.primary, borderRadius: 8, flexDirection: "row", gap: 10, padding: 12, alignItems: "center", justifyContent: "center" },
  startText: { color: colors.background, fontSize: 17, fontWeight: "800", flexShrink: 1 },
});

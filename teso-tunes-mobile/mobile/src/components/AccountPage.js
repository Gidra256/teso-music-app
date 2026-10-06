import { Ionicons } from "@expo/vector-icons";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, spacing } from "../theme";

export default function AccountPage({ title, navigation, children, onBack, busy = false }) {
  return (
    <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === "ios" ? "padding" : "height"} enabled={Platform.OS !== "web"}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
          <View style={styles.topbar}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" disabled={busy} style={styles.back} onPress={onBack || (() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Profile"))}>
              <Ionicons name="chevron-back" size={22} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.title}>{title}</Text>
            <View style={styles.spacer} />
          </View>
          {children}
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

export function AccountRow({ title, subtitle, icon, onPress, accessibilityLabel, disabled = false }) {
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={accessibilityLabel || title} disabled={disabled} activeOpacity={0.65} style={styles.row} onPress={onPress}>
      <Ionicons name={icon} size={22} color={colors.primary} />
      <View style={styles.copy}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.muted} />
    </TouchableOpacity>
  );
}

export const accountStyles = StyleSheet.create({
  section: { color: colors.muted, fontSize: 12, fontWeight: "800", marginTop: 16, textTransform: "uppercase" },
  text: { color: colors.softText, fontSize: 14, lineHeight: 21 },
  heading: { color: colors.text, fontSize: 17, fontWeight: "800" },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { width: "100%", maxWidth: 640, alignSelf: "center", padding: spacing.page, paddingBottom: 32, gap: 16 },
  topbar: { flexDirection: "row", alignItems: "center", gap: 12 },
  back: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: colors.elevated },
  spacer: { width: 48 },
  title: { flex: 1, color: colors.text, fontSize: 20, fontWeight: "900", textAlign: "center" },
  row: { flexDirection: "row", gap: 14, alignItems: "center", minHeight: 56, paddingVertical: 12, borderBottomColor: colors.border, borderBottomWidth: 1 },
  copy: { flex: 1, minWidth: 0, gap: 5 },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  subtitle: { color: colors.muted, fontSize: 13, lineHeight: 19 },
});

import { Ionicons } from "@expo/vector-icons";
import { useState, useSyncExternalStore } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { ANDROID_DOWNLOAD_URL, MUSIC_WEB_BASE_URL } from "../config/api";
import { colors } from "../theme";
import { appActions, androidIntent, createInstallController, manualInstallHelp, openAndroidDownload, safeDownloadUrl } from "../utils/appAccess";

const controller = typeof window !== "undefined" ? createInstallController(window) : null;
const empty = { installed: true };
const subscribe = listener => controller?.subscribe(listener) || (() => {});
const snapshot = () => controller?.getSnapshot() || empty;
const downloadUrl = safeDownloadUrl(ANDROID_DOWNLOAD_URL);

export default function AppAccess({ path = "/", persistent = false, compact = false }) {
  const state = useSyncExternalStore(subscribe, snapshot, () => empty);
  const [help, setHelp] = useState(false);
  const { actions, promoteInstall } = appActions({ navigator: typeof navigator !== "undefined" ? navigator : {}, state, downloadUrl, persistent, compact, path });
  if (!actions.length) return null;
  const open = () => {
    // Browser cannot reliably detect native installation. Intent fallback preserves this content.
    window.location.assign(androidIntent(path, MUSIC_WEB_BASE_URL));
  };
  const handlers = { open, download: () => openAndroidDownload(window, downloadUrl), install: () => controller.install(), help: () => setHelp(!help) };
  return <View style={styles.section} testID="app-access">
    {promoteInstall && !compact && <View style={styles.heading}>
      <Text style={styles.title}>Take TesoHub Music with you</Text>
      {!persistent && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Dismiss install suggestion" style={styles.icon} onPress={() => controller.dismiss()}><Ionicons name="close" color={colors.muted} size={20} /></TouchableOpacity>}
    </View>}
    <View style={styles.actions}>
      {actions.map(action => <Action key={action.id} {...action} disabled={action.id === "install" && state.pending} onPress={handlers[action.id]} />)}
      {promoteInstall && !persistent && !compact && <Action icon="globe-outline" label="Continue on Web" onPress={() => controller.dismiss()} />}
      {compact && promoteInstall && !persistent && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Dismiss install suggestion" style={styles.icon} onPress={() => controller.dismiss()}><Ionicons name="close" color={colors.muted} size={20} /></TouchableOpacity>}
    </View>
    {promoteInstall && help && <Text style={styles.help}>{manualInstallHelp(navigator)}</Text>}
    {promoteInstall && state.error ? <Text accessibilityRole="alert" style={styles.help}>{state.error}</Text> : null}
  </View>;
}

function Action({ icon, label, onPress, disabled }) {
  return <TouchableOpacity accessibilityRole="button" disabled={disabled} style={[styles.action, disabled && { opacity: 0.5 }]} onPress={onPress}>
    <Ionicons name={icon} size={19} color={colors.primary} /><Text style={styles.label}>{label}</Text>
  </TouchableOpacity>;
}

const styles = StyleSheet.create({
  section: { alignSelf: "stretch", gap: 8, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border },
  heading: { flexDirection: "row", gap: 8, alignItems: "center" },
  title: { color: colors.text, fontSize: 15, fontWeight: "700", flex: 1 },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  action: { minHeight: 44, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8 },
  label: { color: colors.primary, fontSize: 14, fontWeight: "600", flexShrink: 1 },
  help: { color: colors.softText, fontSize: 14, lineHeight: 21 },
});

import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getShareableSong } from "../api/musicApi";
import { colors, spacing } from "../theme";
import { copySongLink, shareSongLink, songShareUrl } from "../utils/shareLinks";

export default function SongShareModal({ song, visible, onClose }) {
  const insets = useSafeAreaInsets();
  const [verified, setVerified] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!visible) return;
    let active = true;
    setVerified(null);
    setError("");
    setMessage("");
    setLoading(true);
    getShareableSong(song?.id)
      .then(item => { if (active) setVerified(item); })
      .catch(() => { if (active) setError("This song is unavailable or could not be verified. Please try again."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [visible, song?.id]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  async function share(copy = false) {
    if (!verified || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      // Verification happened when the sheet opened, preserving this tap's Web Share activation.
      const result = await (copy ? copySongLink(verified) : shareSongLink(verified));
      if (result?.method === "copy_link") setMessage("Link copied");
      else if (!result?.dismissed) onClose();
    } catch (shareError) {
      setError(shareError?.message || "Could not share this song. Please try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity accessible={false} style={styles.dismiss} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(24, insets.bottom + 16) }]}>
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.header}>
              <Text style={styles.title}>Share song</Text>
              <TouchableOpacity accessibilityLabel="Close sharing" style={styles.icon} onPress={onClose}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            {loading ? <ActivityIndicator color={colors.primary} /> : null}
            {verified ? <>
              <Text style={styles.songTitle}>{verified.title}</Text>
              <Text style={styles.text}>{verified.artist_name}</Text>
              <Text selectable style={styles.link}>{songShareUrl(verified)}</Text>
              <TouchableOpacity accessibilityLabel="Share song link" disabled={busy} style={styles.action} onPress={() => share()}>
                <Ionicons name="share-social-outline" size={21} color={colors.primary} />
                <Text style={styles.actionText}>Share</Text>
              </TouchableOpacity>
              {Platform.OS === "web" ? <TouchableOpacity accessibilityLabel="Copy song link" disabled={busy} style={styles.action} onPress={() => share(true)}>
                <Ionicons name="copy-outline" size={21} color={colors.primary} />
                <Text style={styles.actionText}>Copy Link</Text>
              </TouchableOpacity> : null}
            </> : null}
            {message ? <Text accessibilityLiveRegion="polite" style={styles.feedback}>{message}</Text> : null}
            {error ? <Text accessibilityLiveRegion="polite" style={styles.text}>{error}</Text> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-end" },
  dismiss: { flex: 1 },
  sheet: { backgroundColor: colors.surface, padding: spacing.page, borderTopLeftRadius: 8, borderTopRightRadius: 8, maxHeight: "85%" },
  content: { gap: 12 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: colors.text, fontSize: 20, fontWeight: "900", flex: 1 },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  songTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  text: { color: colors.softText, fontSize: 14, lineHeight: 21 },
  link: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  action: { flexDirection: "row", gap: 12, alignItems: "center", minHeight: 48 },
  actionText: { color: colors.text, fontSize: 16, fontWeight: "800" },
  feedback: { color: colors.primary, fontSize: 14 },
});

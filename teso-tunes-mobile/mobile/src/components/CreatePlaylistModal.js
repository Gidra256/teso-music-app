import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { createPlaylist } from "../api/musicApi";
import { colors, spacing } from "../theme";

export default function CreatePlaylistModal({ visible, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!visible) return;
    setName("");
    setDescription("");
    setSaving(false);
    setError("");
  }, [visible]);

  async function handleCreate() {
    const cleanName = name.trim();
    if (!cleanName || saving) {
      setError("Enter a playlist name.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      const playlist = await createPlaylist({
        description: description.trim(),
        name: cleanName,
      });
      onCreated?.(playlist);
      onClose?.();
    } catch (createError) {
      setError(createError?.detail || "Could not create playlist.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.backdrop}
      >
        <TouchableOpacity activeOpacity={1} style={styles.dismissArea} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View>
              <Text style={styles.eyebrow}>Create</Text>
              <Text style={styles.title}>New playlist</Text>
            </View>
            <TouchableOpacity
              accessibilityLabel="Close create playlist"
              activeOpacity={0.82}
              style={styles.iconButton}
              onPress={onClose}
            >
              <Ionicons name="close" color={colors.softText} size={22} />
            </TouchableOpacity>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Playlist name</Text>
            <TextInput
              autoCapitalize="words"
              placeholder="My Teso Mix"
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={name}
              onChangeText={setName}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Description</Text>
            <TextInput
              multiline
              placeholder="Optional"
              placeholderTextColor={colors.muted}
              style={[styles.input, styles.textArea]}
              value={description}
              onChangeText={setDescription}
            />
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            activeOpacity={0.86}
            disabled={saving}
            style={[styles.primaryButton, saving && styles.disabledButton]}
            onPress={handleCreate}
          >
            {saving ? (
              <ActivityIndicator color={colors.background} size="small" />
            ) : (
              <Ionicons name="add" color={colors.background} size={20} />
            )}
            <Text style={styles.primaryText}>Create Playlist</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: "rgba(0, 0, 0, 0.58)",
    flex: 1,
    justifyContent: "flex-end",
  },
  dismissArea: {
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderWidth: 1,
    gap: 16,
    padding: spacing.page,
    paddingBottom: 28,
  },
  handle: {
    alignSelf: "center",
    backgroundColor: colors.border,
    borderRadius: 2,
    height: 4,
    width: 42,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "950",
    marginTop: 2,
  },
  iconButton: {
    alignItems: "center",
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  fieldGroup: {
    gap: 8,
  },
  label: {
    color: colors.softText,
    fontSize: 13,
    fontWeight: "850",
  },
  input: {
    backgroundColor: colors.elevated,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.text,
    fontSize: 15,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  textArea: {
    minHeight: 82,
    paddingTop: 12,
    textAlignVertical: "top",
  },
  error: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: "800",
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
  disabledButton: {
    opacity: 0.62,
  },
  primaryText: {
    color: colors.background,
    fontSize: 15,
    fontWeight: "950",
  },
});

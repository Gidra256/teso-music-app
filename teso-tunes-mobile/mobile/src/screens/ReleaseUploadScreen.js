import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { createArtistStudioRelease, getArtistStudioReleases, updateArtistStudioRelease } from "../api/musicApi";
import GenreSelector from "../components/GenreSelector";
import { colors, spacing } from "../theme";

const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function fileFromAsset(asset, fallbackName, fallbackType) {
  const name = asset.fileName || asset.name || asset.file?.name || fallbackName;
  const type = asset.mimeType || asset.type || asset.file?.type || fallbackType;

  if (Platform.OS === "web") {
    if (asset.file) {
      return asset.file;
    }

    if (asset.uri) {
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      if (typeof File !== "undefined") {
        return new File([blob], name, { type: blob.type || type });
      }
      return blob;
    }
  }

  return {
    name,
    type,
    uri: asset.uri,
  };
}

function appendPickedFile(body, fieldName, file, fallbackName) {
  if (Platform.OS === "web" && typeof Blob !== "undefined" && file instanceof Blob) {
    body.append(fieldName, file, file.name || fallbackName);
    return;
  }

  body.append(fieldName, file);
}

function isTooLarge(asset) {
  const size = asset?.size || asset?.fileSize || 0;
  return size > MAX_UPLOAD_BYTES;
}

function errorMessage(error) {
  return (
    error?.detail ||
    error?.cause?.message ||
    error?.message ||
    "Could not save release."
  );
}

export default function ReleaseUploadScreen({ navigation, route }) {
  const editingId = route?.params?.releaseId;
  const isEditing = editingId != null;
  const [existing, setExisting] = useState(null);
  const [loading, setLoading] = useState(isEditing);
  const [reloadKey, setReloadKey] = useState(0);
  const saveLock = useRef(false);
  const [form, setForm] = useState({
    description: "",
    explicit: false,
    featured_artist: "",
    genre: "",
    genre_note: "",
    language: "Ateso",
    producer: "",
    release_date: todayKey(),
    rights_confirmed: false,
    songwriter: "",
    title: "",
  });
  const [audio, setAudio] = useState(null);
  const [cover, setCover] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isEditing) return;
    let active = true;
    setLoading(true); setError(""); setExisting(null); setAudio(null); setCover(null);
    getArtistStudioReleases().then((rows) => {
      if (!active) return;
      const release = rows.find((row) => String(row.id) === String(editingId));
      if (!release) throw new Error("This release is not available in your Artist Studio.");
      if (!["draft", "rejected"].includes(release.status)) throw new Error("This release is no longer editable. Return to Artist Studio and refresh.");
      setExisting(release);
      setForm((current) => Object.fromEntries(Object.keys(current).map((key) =>
        [key, typeof current[key] === "boolean" ? Boolean(release[key]) : String(release[key] ?? "")])));
    }).catch((loadError) => {if (active) setError(errorMessage(loadError));})
      .finally(() => {if (active) setLoading(false);});
    return () => {active = false;};
  }, [editingId, isEditing, reloadKey]);

  const submitValidation = useMemo(() => {
    if (!form.title.trim()) return "Enter the song title.";
    if (!audio && !existing?.audio_file) return "Choose an audio file.";
    if (!cover && !existing?.cover_image) return "Choose cover artwork.";
    if (!form.genre.trim()) return "Choose the genre.";
    if (!form.language.trim()) return "Enter the language.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.release_date.trim())) {
      return "Use release date format YYYY-MM-DD.";
    }
    if (!form.rights_confirmed) return "Confirm the music rights.";
    return "";
  }, [audio, cover, existing, form]);

  function updateField(field, value) {
    if (saveLock.current) return;
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function chooseAudio() {
    if (saveLock.current) return;
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: "audio/*",
    });

    if (saveLock.current || result.canceled || !result.assets?.[0]) return;
    if (isTooLarge(result.assets[0])) {
      setError("Audio file is too large. Maximum size is 80 MB.");
      return;
    }
    setError("");
    setAudio(result.assets[0]);
  }

  async function chooseCover() {
    if (saveLock.current) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      mediaTypes: ["images"],
      quality: 0.9,
    });

    if (saveLock.current || result.canceled || !result.assets?.[0]) return;
    if (isTooLarge(result.assets[0])) {
      setError("Cover image is too large. Maximum size is 80 MB.");
      return;
    }
    setError("");
    setCover(result.assets[0]);
  }

  async function buildFormData(submitForReview) {
    const body = new FormData();
    Object.entries(form).forEach(([key, value]) => {
      body.append(key, typeof value === "boolean" ? String(value) : value);
    });
    body.append("release_type", "Single");
    body.append("submit_for_review", String(submitForReview));
    if (isEditing && existing?.updated_at) body.append("expected_updated_at", existing.updated_at);
    if (audio) {
      appendPickedFile(
        body,
        "audio_upload",
        await fileFromAsset(audio, "release-audio.mp3", "audio/mpeg"),
        "release-audio.mp3",
      );
    }
    if (cover) {
      appendPickedFile(
        body,
        "cover_upload",
        await fileFromAsset(cover, "cover-art.jpg", "image/jpeg"),
        "cover-art.jpg",
      );
    }
    return body;
  }

  async function saveRelease(submitForReview) {
    if (saveLock.current || loading || (isEditing && !existing)) return;
    if (submitForReview && submitValidation) {
      setError(submitValidation);
      return;
    }

    saveLock.current = true;
    setSaving(true);
    setError("");
    try {
      const body = await buildFormData(submitForReview);
      if (isEditing) await updateArtistStudioRelease(existing.id, body);
      else await createArtistStudioRelease(body);
      const successTitle = submitForReview ? "Release submitted" : isEditing ? "Changes saved" : "Draft saved";
      const successMessage = submitForReview
        ? "Your song is now under admin review."
        : isEditing ? "Your release changes have been saved." : "Your release draft has been saved.";
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.alert(`${successTitle}\n${successMessage}`);
      } else {
        Alert.alert(successTitle, successMessage);
      }
      navigation.goBack();
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  if (isEditing && (loading || !existing)) return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity accessibilityLabel="Back to Artist Studio" style={styles.iconButton} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" color={colors.softText} size={22} />
        </TouchableOpacity>
        <Text style={styles.title}>Edit & Resubmit</Text>
        {loading ? <ActivityIndicator color={colors.primary} /> : <>
          <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => setReloadKey((value) => value + 1)}>
            <Text style={styles.secondaryText}>Retry</Text>
          </TouchableOpacity>
        </>}
      </ScrollView>
    </SafeAreaView>
  );

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
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topbar}>
          <TouchableOpacity disabled={saving} accessibilityLabel="Back to Artist Studio" style={styles.iconButton} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" color={colors.softText} size={22} />
          </TouchableOpacity>
          <Text style={styles.title}>{isEditing ? "Edit & Resubmit" : "Upload Single"}</Text>
          <View style={styles.iconSpacer} />
        </View>

        {existing ? <View style={styles.reviewReason}>
          <Text style={styles.rightsTitle}>{existing.status === "rejected" ? "Rejected / Changes requested" : "Draft"}</Text>
          {existing.review_reason || existing.rejection_reason ? <Text style={styles.rightsText}>{existing.review_reason || existing.rejection_reason}</Text> : null}
        </View> : null}

        <View style={styles.uploadGrid}>
          <TouchableOpacity disabled={saving} accessibilityLabel={isEditing ? "Replace cover artwork" : "Choose cover artwork"} style={styles.coverPicker} onPress={chooseCover}>
            {cover || existing?.cover_image ? (
              <Image source={{ uri: cover?.uri || existing.cover_image }} style={styles.coverImage} />
            ) : (
              <View style={styles.coverPlaceholder}>
                <Ionicons name="image" color={colors.primary} size={34} />
                <Text style={styles.pickText}>Cover artwork</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity disabled={saving} accessibilityLabel={isEditing ? "Replace audio file" : "Choose audio file"} style={styles.audioPicker} onPress={chooseAudio}>
            <View style={styles.audioIcon}>
              <Ionicons name="musical-note" color={colors.accent} size={24} />
            </View>
            <View style={styles.audioCopy}>
              <Text style={styles.audioTitle}>Audio file</Text>
              <Text style={styles.audioMeta} numberOfLines={2}>
                {audio?.name || (existing?.audio_file ? "Existing audio retained" : "Choose MP3, M4A, WAV, AAC, OGG, or FLAC")}
              </Text>
            </View>
            <Ionicons name="folder-open" color={colors.primary} size={22} />
          </TouchableOpacity>
        </View>

        <View style={styles.form}>
          <ReleaseInput
            icon="text"
            placeholder="Song title"
            value={form.title}
            onChangeText={(value) => updateField("title", value)}
          />
          <ReleaseInput
            icon="people"
            placeholder="Featured artist (optional)"
            value={form.featured_artist}
            onChangeText={(value) => updateField("featured_artist", value)}
          />
          <View style={styles.row}>
            <GenreSelector
              label="Genre"
              note={form.genre_note}
              value={form.genre}
              onChange={(value) => updateField("genre", value)}
              onChangeNote={(value) => updateField("genre_note", value)}
            />
            <ReleaseInput
              icon="language"
              placeholder="Language"
              value={form.language}
              onChangeText={(value) => updateField("language", value)}
            />
          </View>
          <ReleaseInput
            icon="calendar"
            placeholder="Release date YYYY-MM-DD"
            value={form.release_date}
            autoCapitalize="none"
            onChangeText={(value) => updateField("release_date", value)}
          />
          <ReleaseInput
            icon="construct"
            placeholder="Producer (optional)"
            value={form.producer}
            onChangeText={(value) => updateField("producer", value)}
          />
          <ReleaseInput
            icon="create"
            placeholder="Songwriter/composer (optional)"
            value={form.songwriter}
            onChangeText={(value) => updateField("songwriter", value)}
          />
          <ReleaseInput
            icon="reader"
            multiline
            placeholder="Description (optional)"
            style={styles.textArea}
            value={form.description}
            onChangeText={(value) => updateField("description", value)}
          />
        </View>

        <View style={styles.switchPanel}>
          <View style={styles.switchCopy}>
            <Text style={styles.switchTitle}>Explicit content</Text>
            <Text style={styles.switchText}>{form.explicit ? "Yes" : "No"}</Text>
          </View>
          <Switch
            thumbColor={form.explicit ? colors.accent : colors.softText}
            trackColor={{ false: colors.elevated, true: "rgba(244, 39, 200, 0.5)" }}
            value={form.explicit}
            onValueChange={(value) => updateField("explicit", value)}
          />
        </View>

        <View style={styles.rightsPanel}>
          <View style={styles.rightsCopy}>
            <Text style={styles.rightsTitle}>Rights confirmation</Text>
            <Text style={styles.rightsText}>
              I confirm that I own or control the necessary rights to upload and distribute this content.
            </Text>
          </View>
          <Switch
            thumbColor={form.rights_confirmed ? colors.primary : colors.softText}
            trackColor={{ false: colors.elevated, true: "rgba(32, 230, 243, 0.55)" }}
            value={form.rights_confirmed}
            onValueChange={(value) => updateField("rights_confirmed", value)}
          />
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <View style={[styles.actions, isEditing && styles.editActions]}>
          <TouchableOpacity
            disabled={saving}
            style={[styles.secondaryButton, saving && styles.disabledButton]}
            onPress={() => saveRelease(false)}
          >
            <Ionicons name="save" color={colors.primary} size={18} />
            <Text style={styles.secondaryText}>{isEditing ? "Save Changes" : "Save Draft"}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            disabled={saving}
            style={[styles.primaryButton, saving && styles.disabledButton]}
            onPress={() => saveRelease(true)}
          >
            {saving ? (
              <ActivityIndicator color={colors.background} />
            ) : (
              <>
                <Ionicons name="send" color={colors.background} size={18} />
                <Text style={styles.primaryText}>{isEditing ? "Resubmit for Review" : "Submit"}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

function ReleaseInput({ icon, style, ...props }) {
  return (
    <View style={[styles.inputShell, props.multiline && styles.multiShell]}>
      <Ionicons name={icon} color={colors.muted} size={18} />
      <TextInput
        placeholderTextColor={colors.muted}
        style={[styles.input, style]}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  editActions: { flexDirection: "column" },
  reviewReason: { gap: 6 },
  safe: {
    backgroundColor: colors.background,
    flex: 1,
  },
  keyboardAvoider: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    gap: 14,
    padding: spacing.page,
    paddingBottom: 34,
  },
  topbar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: colors.elevated,
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  iconSpacer: {
    width: 40,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "950",
    textTransform: "uppercase",
  },
  uploadGrid: {
    gap: 12,
  },
  coverPicker: {
    backgroundColor: colors.card,
    borderColor: "rgba(32, 230, 243, 0.28)",
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  coverImage: {
    aspectRatio: 1,
    width: "100%",
  },
  coverPlaceholder: {
    alignItems: "center",
    aspectRatio: 1,
    backgroundColor: colors.surface,
    gap: 10,
    justifyContent: "center",
    width: "100%",
  },
  pickText: {
    color: colors.softText,
    fontSize: 14,
    fontWeight: "900",
  },
  audioPicker: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 76,
    padding: 12,
  },
  audioIcon: {
    alignItems: "center",
    backgroundColor: "rgba(244, 39, 200, 0.12)",
    borderRadius: 8,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  audioCopy: {
    flex: 1,
    gap: 4,
  },
  audioTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  audioMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
  },
  form: {
    gap: 10,
  },
  row: {
    gap: 10,
  },
  inputShell: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    minHeight: 50,
    paddingHorizontal: 12,
  },
  multiShell: {
    alignItems: "flex-start",
    paddingTop: 13,
  },
  input: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    minHeight: 44,
  },
  textArea: {
    minHeight: 104,
    textAlignVertical: "top",
  },
  switchPanel: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 14,
  },
  switchCopy: {
    flex: 1,
    gap: 4,
  },
  switchTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  switchText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
  },
  rightsPanel: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: "rgba(32, 230, 243, 0.28)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 14,
  },
  rightsCopy: {
    flex: 1,
    gap: 5,
  },
  rightsTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  rightsText: {
    color: colors.softText,
    fontSize: 13,
    lineHeight: 19,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.elevated,
    borderRadius: 8,
    flex: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 50,
  },
  secondaryText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "950",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 8,
    flex: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 50,
  },
  primaryText: {
    flexShrink: 1,
    textAlign: "center",
    color: colors.background,
    fontSize: 14,
    fontWeight: "950",
  },
  disabledButton: {
    opacity: 0.65,
  },
  errorText: {
    color: colors.softText,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
});

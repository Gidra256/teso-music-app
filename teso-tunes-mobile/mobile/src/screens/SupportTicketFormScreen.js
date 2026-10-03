import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import {
  BACKEND_CONNECTION_ERROR,
  createSupportTicket,
  getSupportHelpCenter,
} from "../api/musicApi";
import { useAuth } from "../context/AuthContext";
import { colors, spacing } from "../theme";
import {
  appendPickedFile,
  fileFromPickedAsset,
  isSupportAttachmentTooLarge,
  pickedAssetName,
} from "../utils/supportUpload";

const PRIORITIES = ["normal", "high", "urgent", "low"];

function errorMessage(error) {
  return (
    error?.detail ||
    error?.cause?.message ||
    error?.message ||
    "Could not create support ticket."
  );
}

export default function SupportTicketFormScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { listener } = useAuth();
  const [helpCenter, setHelpCenter] = useState(null);
  const [form, setForm] = useState({
    category: route?.params?.category || "",
    message: "",
    priority: "normal",
    subject: "",
  });
  const [attachment, setAttachment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const roleKey = ["artist", "artist_pending"].includes(listener?.role) ? "artist" : "listener";
  const categories = helpCenter?.categories?.[roleKey] || [];

  const validationMessage = useMemo(() => {
    if (!form.category) return "Choose a support category.";
    if (form.subject.trim().length < 3) return "Enter a subject.";
    if (form.message.trim().length < 8) return "Describe the issue.";
    return "";
  }, [form]);

  useEffect(() => {
    let mounted = true;
    getSupportHelpCenter()
      .then((data) => {
        if (!mounted) return;
        setHelpCenter(data);
        const nextCategories = data?.categories?.[roleKey] || [];
        if (nextCategories[0]) {
          setForm((current) =>
            current.category ? current : { ...current, category: nextCategories[0] },
          );
        }
      })
      .catch((loadError) => {
        if (mounted) {
          setError(loadError?.detail || loadError?.message || BACKEND_CONNECTION_ERROR);
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [roleKey]);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function chooseScreenshot() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.86,
    });
    if (result.canceled || !result.assets?.[0]) return;
    if (isSupportAttachmentTooLarge(result.assets[0])) {
      setError("Support attachments must be 8 MB or smaller.");
      return;
    }
    setError("");
    setAttachment(result.assets[0]);
  }

  async function chooseFile() {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: ["image/*", "application/pdf", "text/plain"],
    });
    if (result.canceled || !result.assets?.[0]) return;
    if (isSupportAttachmentTooLarge(result.assets[0])) {
      setError("Support attachments must be 8 MB or smaller.");
      return;
    }
    setError("");
    setAttachment(result.assets[0]);
  }

  async function submitTicket() {
    if (saving) return;
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    setSaving(true);
    setError("");
    try {
      const body = new FormData();
      body.append("category", form.category);
      body.append("subject", form.subject.trim());
      body.append("message", form.message.trim());
      body.append("priority", form.priority);
      if (attachment) {
        appendPickedFile(
          body,
          "support_attachment",
          await fileFromPickedAsset(attachment, "support-attachment.jpg", "image/jpeg"),
          "support-attachment.jpg",
        );
      }
      const ticket = await createSupportTicket(body);
      navigation.replace("SupportTicketDetail", { id: ticket.id });
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      enabled={Platform.OS !== "web"}
      keyboardVerticalOffset={insets.top}
      style={styles.keyboardAvoider}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <SafeAreaView style={styles.safe}>
          <ScrollView
            contentContainerStyle={[styles.content, { paddingBottom: 40 + insets.bottom }]}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.topbar}>
              <TouchableOpacity style={styles.iconButton} onPress={() => navigation.goBack()}>
                <Ionicons name="chevron-back" color={colors.softText} size={22} />
              </TouchableOpacity>
              <Text style={styles.title}>Submit Ticket</Text>
              <View style={styles.iconSpacer} />
            </View>

            {loading ? (
              <ActivityIndicator color={colors.primary} style={styles.loader} />
            ) : (
              <>
                <View style={styles.panel}>
                  <Text style={styles.label}>Category</Text>
                  <View style={styles.chips}>
                    {categories.map((category) => (
                      <TouchableOpacity
                        key={category}
                        activeOpacity={0.84}
                        style={[
                          styles.chip,
                          form.category === category && styles.activeChip,
                        ]}
                        onPress={() => updateField("category", category)}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            form.category === category && styles.activeChipText,
                          ]}
                        >
                          {category}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <SupportInput
                    icon="text"
                    placeholder="Subject"
                    returnKeyType="next"
                    value={form.subject}
                    onChangeText={(value) => updateField("subject", value)}
                  />
                  <SupportInput
                    icon="chatbox"
                    multiline
                    placeholder="Tell us what happened"
                    style={styles.messageInput}
                    value={form.message}
                    onChangeText={(value) => updateField("message", value)}
                  />

                  <Text style={styles.label}>Priority</Text>
                  <View style={styles.chips}>
                    {PRIORITIES.map((priority) => (
                      <TouchableOpacity
                        key={priority}
                        activeOpacity={0.84}
                        style={[
                          styles.priorityChip,
                          form.priority === priority && styles.activePriorityChip,
                        ]}
                        onPress={() => updateField("priority", priority)}
                      >
                        <Text
                          style={[
                            styles.priorityText,
                            form.priority === priority && styles.activePriorityText,
                          ]}
                        >
                          {priority.replace("_", " ")}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <View style={styles.attachmentRow}>
                    <TouchableOpacity style={styles.secondaryButton} onPress={chooseScreenshot}>
                      <Ionicons name="image" color={colors.primary} size={18} />
                      <Text style={styles.secondaryText}>Screenshot</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.secondaryButton} onPress={chooseFile}>
                      <Ionicons name="attach" color={colors.primary} size={18} />
                      <Text style={styles.secondaryText}>File</Text>
                    </TouchableOpacity>
                  </View>
                  {attachment ? (
                    <View style={styles.attachmentPreview}>
                      <Ionicons name="document-attach" color={colors.accent} size={18} />
                      <Text style={styles.attachmentText} numberOfLines={1}>
                        {pickedAssetName(attachment)}
                      </Text>
                      <TouchableOpacity onPress={() => setAttachment(null)}>
                        <Ionicons name="close-circle" color={colors.muted} size={20} />
                      </TouchableOpacity>
                    </View>
                  ) : null}

                  {error ? <Text style={styles.errorText}>{error}</Text> : null}

                  <TouchableOpacity
                    activeOpacity={0.88}
                    disabled={saving}
                    style={[styles.primaryButton, saving && styles.disabledButton]}
                    onPress={submitTicket}
                  >
                    {saving ? (
                      <ActivityIndicator color={colors.background} />
                    ) : (
                      <>
                        <Ionicons name="send" color={colors.background} size={18} />
                        <Text style={styles.primaryText}>Create Ticket</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

function SupportInput({ icon, style, ...props }) {
  return (
    <View style={[styles.inputWrap, style]}>
      <Ionicons name={icon} color={colors.accent} size={18} />
      <TextInput
        placeholderTextColor={colors.muted}
        style={styles.input}
        textAlignVertical={props.multiline ? "top" : "center"}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  keyboardAvoider: {
    backgroundColor: colors.background,
    flex: 1,
  },
  safe: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    gap: 18,
    padding: spacing.page,
  },
  topbar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: colors.elevated,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  iconSpacer: {
    width: 42,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "950",
  },
  loader: {
    marginTop: 30,
  },
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: spacing.radius,
    borderWidth: 1,
    gap: 13,
    padding: 14,
  },
  label: {
    color: colors.softText,
    fontSize: 13,
    fontWeight: "900",
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    backgroundColor: colors.elevated,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  activeChip: {
    backgroundColor: "rgba(32, 230, 243, 0.16)",
    borderColor: colors.primary,
  },
  chipText: {
    color: colors.softText,
    fontSize: 12,
    fontWeight: "800",
  },
  activeChipText: {
    color: colors.text,
  },
  inputWrap: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  input: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    minHeight: 46,
    paddingVertical: 10,
  },
  messageInput: {
    alignItems: "flex-start",
    minHeight: 142,
    paddingTop: 2,
  },
  priorityChip: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 38,
    justifyContent: "center",
    paddingHorizontal: 11,
  },
  activePriorityChip: {
    borderColor: colors.accent,
  },
  priorityText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "capitalize",
  },
  activePriorityText: {
    color: colors.text,
  },
  attachmentRow: {
    flexDirection: "row",
    gap: 10,
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: 7,
    justifyContent: "center",
    minHeight: 44,
  },
  secondaryText: {
    color: colors.softText,
    fontSize: 13,
    fontWeight: "900",
  },
  attachmentPreview: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 42,
    paddingHorizontal: 11,
  },
  attachmentText: {
    color: colors.softText,
    flex: 1,
    fontSize: 12,
    fontWeight: "800",
  },
  errorText: {
    color: colors.accent,
    fontSize: 13,
    lineHeight: 18,
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
    opacity: 0.6,
  },
  primaryText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: "950",
  },
});

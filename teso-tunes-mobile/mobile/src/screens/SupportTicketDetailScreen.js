import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
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
  getSupportTicket,
  replySupportTicket,
} from "../api/musicApi";
import MiniPlayer from "../components/MiniPlayer";
import { colors, spacing } from "../theme";
import {
  appendPickedFile,
  fileFromPickedAsset,
  isSupportAttachmentTooLarge,
  pickedAssetName,
} from "../utils/supportUpload";

function statusLabel(status) {
  return String(status || "open").replaceAll("_", " ");
}

function formatDate(value) {
  if (!value) return "";
  return String(value).slice(0, 16).replace("T", " ");
}

function errorMessage(error) {
  return error?.detail || error?.cause?.message || error?.message || "Could not send reply.";
}

export default function SupportTicketDetailScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const ticketId = route?.params?.id;
  const [ticket, setTicket] = useState(null);
  const [reply, setReply] = useState("");
  const [attachment, setAttachment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const canReply = useMemo(
    () => ticket && !["resolved", "closed"].includes(ticket.status),
    [ticket],
  );

  const loadTicket = useCallback(async ({ refresh = false } = {}) => {
    if (!ticketId) return;
    try {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError("");
      setTicket(await getSupportTicket(ticketId));
    } catch (loadError) {
      setError(loadError?.detail || loadError?.message || BACKEND_CONNECTION_ERROR);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [ticketId]);

  useFocusEffect(
    useCallback(() => {
      loadTicket();
    }, [loadTicket])
  );

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

  async function sendReply() {
    if (sending || !ticket?.id) return;
    if (reply.trim().length < 2) {
      setError("Enter a reply message.");
      return;
    }

    setSending(true);
    setError("");
    try {
      const body = new FormData();
      body.append("message", reply.trim());
      if (attachment) {
        appendPickedFile(
          body,
          "support_attachment",
          await fileFromPickedAsset(attachment, "support-attachment.jpg", "image/jpeg"),
          "support-attachment.jpg",
        );
      }
      const nextTicket = await replySupportTicket(ticket.id, body);
      setTicket(nextTicket);
      setReply("");
      setAttachment(null);
      Keyboard.dismiss();
    } catch (sendError) {
      setError(errorMessage(sendError));
    } finally {
      setSending(false);
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
            contentContainerStyle={[styles.content, { paddingBottom: 128 + insets.bottom }]}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                tintColor={colors.primary}
                onRefresh={() => loadTicket({ refresh: true })}
              />
            }
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.topbar}>
              <TouchableOpacity style={styles.iconButton} onPress={() => navigation.goBack()}>
                <Ionicons name="chevron-back" color={colors.softText} size={22} />
              </TouchableOpacity>
              <Text style={styles.title}>Support Ticket</Text>
              <View style={styles.iconSpacer} />
            </View>

            {loading ? (
              <ActivityIndicator color={colors.primary} style={styles.loader} />
            ) : error && !ticket ? (
              <View style={styles.stateBlock}>
                <Text style={styles.errorText}>{error}</Text>
                <TouchableOpacity style={styles.primaryButton} onPress={loadTicket}>
                  <Text style={styles.primaryText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : ticket ? (
              <>
                <View style={styles.summary}>
                  <View style={styles.summaryTop}>
                    <Text style={styles.reference}>{ticket.reference}</Text>
                    <Text style={styles.badge}>{statusLabel(ticket.status)}</Text>
                  </View>
                  <Text style={styles.subject}>{ticket.subject}</Text>
                  <Text style={styles.meta}>
                    {ticket.category} - Priority {ticket.priority}
                  </Text>
                </View>

                <View style={styles.thread}>
                  {(ticket.messages || []).map((message) => (
                    <MessageBubble key={message.id} message={message} />
                  ))}
                </View>

                {error ? <Text style={styles.errorText}>{error}</Text> : null}

                {canReply ? (
                  <View style={styles.replyPanel}>
                    <Text style={styles.replyTitle}>Reply</Text>
                    <View style={styles.replyBox}>
                      <TextInput
                        multiline
                        placeholder="Write your reply"
                        placeholderTextColor={colors.muted}
                        style={styles.replyInput}
                        textAlignVertical="top"
                        value={reply}
                        onChangeText={setReply}
                      />
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
                    <TouchableOpacity
                      activeOpacity={0.88}
                      disabled={sending}
                      style={[styles.primaryButton, sending && styles.disabledButton]}
                      onPress={sendReply}
                    >
                      {sending ? (
                        <ActivityIndicator color={colors.background} />
                      ) : (
                        <>
                          <Ionicons name="send" color={colors.background} size={18} />
                          <Text style={styles.primaryText}>Send Reply</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.closedBlock}>
                    <Ionicons name="checkmark-circle" color={colors.success} size={22} />
                    <Text style={styles.closedText}>This ticket is {statusLabel(ticket.status)}.</Text>
                  </View>
                )}
              </>
            ) : null}
          </ScrollView>
          <MiniPlayer />
        </SafeAreaView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

function MessageBubble({ message }) {
  const isAdmin = message.author_type === "admin";
  return (
    <View style={[styles.messageBubble, isAdmin && styles.adminBubble]}>
      <View style={styles.messageHeader}>
        <Text style={styles.messageAuthor}>
          {isAdmin ? message.admin_username || "Support" : "You"}
        </Text>
        <Text style={styles.messageDate}>{formatDate(message.created_at)}</Text>
      </View>
      <Text style={styles.messageText}>{message.message}</Text>
      {message.attachment ? (
        <View style={styles.savedAttachment}>
          <Ionicons name="document-attach" color={colors.primary} size={16} />
          <Text style={styles.savedAttachmentText} numberOfLines={1}>
            {message.attachment.name || "Attachment"}
          </Text>
        </View>
      ) : null}
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
    gap: 16,
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
  stateBlock: {
    alignItems: "center",
    gap: 12,
    paddingVertical: 42,
  },
  summary: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: spacing.radius,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  summaryTop: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  reference: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "950",
  },
  badge: {
    backgroundColor: "rgba(32, 230, 243, 0.13)",
    borderRadius: 8,
    color: colors.primary,
    fontSize: 11,
    fontWeight: "950",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    textTransform: "uppercase",
  },
  subject: {
    color: colors.text,
    fontSize: 19,
    fontWeight: "950",
  },
  meta: {
    color: colors.muted,
    fontSize: 12,
  },
  thread: {
    gap: 10,
  },
  messageBubble: {
    alignSelf: "flex-end",
    backgroundColor: "rgba(32, 230, 243, 0.12)",
    borderColor: "rgba(32, 230, 243, 0.24)",
    borderRadius: 8,
    borderWidth: 1,
    gap: 7,
    maxWidth: "92%",
    padding: 12,
  },
  adminBubble: {
    alignSelf: "flex-start",
    backgroundColor: colors.card,
    borderColor: colors.border,
  },
  messageHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  messageAuthor: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "950",
  },
  messageDate: {
    color: colors.muted,
    fontSize: 11,
  },
  messageText: {
    color: colors.softText,
    fontSize: 14,
    lineHeight: 20,
  },
  savedAttachment: {
    alignItems: "center",
    backgroundColor: colors.elevated,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    minHeight: 34,
    paddingHorizontal: 9,
  },
  savedAttachmentText: {
    color: colors.softText,
    flex: 1,
    fontSize: 12,
    fontWeight: "800",
  },
  replyPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: spacing.radius,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  replyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "950",
  },
  replyBox: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 118,
    paddingHorizontal: 12,
  },
  replyInput: {
    color: colors.text,
    fontSize: 15,
    minHeight: 116,
    paddingVertical: 10,
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
    paddingHorizontal: 16,
  },
  disabledButton: {
    opacity: 0.6,
  },
  primaryText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: "950",
  },
  closedBlock: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: spacing.radius,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    padding: 13,
  },
  closedText: {
    color: colors.softText,
    fontSize: 13,
    fontWeight: "800",
  },
});

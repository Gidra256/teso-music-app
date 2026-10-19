import { Ionicons } from "@expo/vector-icons";
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, spacing } from "../theme";

export default function ArtistAgreementPanel({
  accepted = false,
  accepting = false,
  onAccept,
  onAcceptedChange,
  onCloseAgreement,
  onOpenAgreement,
  state,
  visible = false,
}) {
  const agreement = state?.agreement || null;
  const acceptance = state?.acceptance || null;
  const required = Boolean(state?.required || agreement?.required);

  return (
    <View style={styles.panel}>
      <View style={styles.headingRow}>
        <View style={styles.icon}>
          <Ionicons name="document-text-outline" color={colors.primary} size={22} />
        </View>
        <View style={styles.headingCopy}>
          <Text style={styles.title}>Artist Agreement</Text>
          <Text style={styles.subtitle}>
            {agreement
              ? `${agreement.title} - version ${agreement.version}`
              : "The agreement is awaiting final legal review."}
          </Text>
        </View>
      </View>

      {agreement ? (
        <TouchableOpacity
          accessibilityLabel="Read Artist Agreement"
          style={styles.readButton}
          onPress={onOpenAgreement}
        >
          <Ionicons name="book-outline" color={colors.primary} size={18} />
          <Text style={styles.readText}>Read Agreement</Text>
        </TouchableOpacity>
      ) : (
        <Text style={styles.note}>
          Acceptance is not required while agreement enforcement is off.
        </Text>
      )}

      {acceptance ? (
        <View style={styles.acceptedRow}>
          <Ionicons name="checkmark-circle" color={colors.success} size={20} />
          <View style={styles.acceptedCopy}>
            <Text style={styles.acceptedTitle}>Agreement accepted</Text>
            <Text style={styles.note}>
              Version {acceptance.agreement_version} on {formatAcceptedAt(acceptance.accepted_at)}
            </Text>
          </View>
        </View>
      ) : agreement && onAcceptedChange ? (
        <TouchableOpacity
          accessibilityRole="checkbox"
          accessibilityState={{ checked: accepted }}
          accessibilityLabel="Accept Artist Agreement"
          style={styles.checkRow}
          onPress={() => onAcceptedChange(!accepted)}
        >
          <Ionicons
            name={accepted ? "checkbox" : "square-outline"}
            color={accepted ? colors.primary : colors.softText}
            size={24}
          />
          <Text style={styles.checkText}>
            I have read and accept this Artist Agreement{required ? " (required)" : ""}.
          </Text>
        </TouchableOpacity>
      ) : null}

      {!acceptance && agreement && onAccept ? (
        <TouchableOpacity
          disabled={accepting}
          style={[styles.acceptButton, accepting && styles.disabled]}
          onPress={onAccept}
        >
          <Text style={styles.acceptButtonText}>
            {accepting ? "Saving acceptance..." : "Accept Agreement"}
          </Text>
        </TouchableOpacity>
      ) : null}

      <Modal
        animationType="slide"
        onRequestClose={onCloseAgreement}
        transparent={false}
        visible={Boolean(visible && agreement)}
      >
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <View style={styles.modalHeading}>
              <Text style={styles.modalTitle}>{agreement?.title || "Artist Agreement"}</Text>
              <Text style={styles.note}>Version {agreement?.version || ""}</Text>
            </View>
            <TouchableOpacity
              accessibilityLabel="Close Artist Agreement"
              style={styles.closeButton}
              onPress={onCloseAgreement}
            >
              <Ionicons name="close" color={colors.text} size={24} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.agreementContent}>
            <Text selectable style={styles.agreementText}>{agreement?.content || ""}</Text>
            <Text selectable style={styles.hashText}>SHA-256: {agreement?.content_sha256 || ""}</Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

function formatAcceptedAt(value) {
  if (!value) return "an unknown date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 8, borderWidth: 1, gap: 14, padding: 16 },
  headingRow: { alignItems: "center", flexDirection: "row", gap: 12 },
  icon: { alignItems: "center", backgroundColor: colors.elevated, borderRadius: 8, height: 42, justifyContent: "center", width: 42 },
  headingCopy: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 17, fontWeight: "800" },
  subtitle: { color: colors.softText, fontSize: 13, lineHeight: 19, marginTop: 2 },
  readButton: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 8, minHeight: 44 },
  readText: { color: colors.primary, fontSize: 15, fontWeight: "800" },
  note: { color: colors.softText, fontSize: 12, lineHeight: 18 },
  acceptedRow: { alignItems: "flex-start", flexDirection: "row", gap: 8 },
  acceptedCopy: { flex: 1 },
  acceptedTitle: { color: colors.success, fontSize: 14, fontWeight: "800" },
  checkRow: { alignItems: "flex-start", flexDirection: "row", gap: 8, minHeight: 48, paddingVertical: 8 },
  checkText: { color: colors.text, flex: 1, fontSize: 14, lineHeight: 21 },
  acceptButton: { alignItems: "center", backgroundColor: colors.primary, borderRadius: 8, justifyContent: "center", minHeight: 48, paddingHorizontal: 16 },
  acceptButtonText: { color: colors.background, fontSize: 14, fontWeight: "900" },
  disabled: { opacity: 0.55 },
  modalSafe: { backgroundColor: colors.background, flex: 1 },
  modalHeader: { alignItems: "center", borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: "row", gap: 12, padding: 16 },
  modalHeading: { flex: 1 },
  modalTitle: { color: colors.text, fontSize: 19, fontWeight: "900" },
  closeButton: { alignItems: "center", height: 44, justifyContent: "center", width: 44 },
  agreementContent: { padding: 20, paddingBottom: 56 },
  agreementText: { color: colors.text, fontSize: 15, lineHeight: 24 },
  hashText: { color: colors.softText, fontSize: 11, lineHeight: 17, marginTop: 20 },
});

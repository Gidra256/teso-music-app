import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BACKEND_CONNECTION_ERROR, getSupportTickets } from "../api/musicApi";
import MiniPlayer from "../components/MiniPlayer";
import { colors, spacing } from "../theme";
import { statusLabel, supportCopy, supportReferenceLabel } from "../utils/supportLabels";

function statusTone(status) {
  if (["resolved", "closed"].includes(status)) return styles.badgeOk;
  if (status === "waiting_on_user") return styles.badgeWarn;
  return styles.badgeActive;
}

function formatDate(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

export default function SupportTicketsScreen({ navigation }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadTickets = useCallback(async ({ refresh = false } = {}) => {
    try {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError("");
      const data = await getSupportTickets();
      setTickets(Array.isArray(data) ? data : []);
    } catch (loadError) {
      setError(loadError?.detail || loadError?.message || BACKEND_CONNECTION_ERROR);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadTickets();
    }, [loadTickets])
  );

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.primary}
            onRefresh={() => loadTickets({ refresh: true })}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topbar}>
          <TouchableOpacity style={styles.iconButton} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" color={colors.softText} size={22} />
          </TouchableOpacity>
          <Text style={styles.title}>My Support Requests</Text>
          <TouchableOpacity
            activeOpacity={0.84}
            style={styles.iconButton}
            onPress={() => navigation.navigate("SupportTicketForm")}
          >
            <Ionicons name="add" color={colors.softText} size={22} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : error ? (
          <View style={styles.stateBlock}>
            <Text style={styles.errorText}>{supportCopy(error)}</Text>
            <TouchableOpacity activeOpacity={0.84} style={styles.primaryButton} onPress={loadTickets}>
              <Text style={styles.primaryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : tickets.length === 0 ? (
          <View style={styles.stateBlock}>
            <Ionicons name="file-tray-outline" color={colors.accent} size={38} />
            <Text style={styles.emptyTitle}>No support requests yet</Text>
            <Text style={styles.emptyText}>Send a support request when you need help.</Text>
            <TouchableOpacity
              activeOpacity={0.84}
              style={styles.primaryButton}
              onPress={() => navigation.navigate("SupportTicketForm")}
            >
              <Ionicons name="create" color={colors.background} size={18} />
              <Text style={styles.primaryText}>Submit a Support Request</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.list}>
            {tickets.map((ticket) => (
              <TouchableOpacity
                key={ticket.id}
                activeOpacity={0.84}
                style={styles.ticket}
                onPress={() => navigation.navigate("SupportTicketDetail", { id: ticket.id })}
              >
                <View style={styles.ticketIcon}>
                  <Ionicons name="help-buoy" color={colors.primary} size={20} />
                </View>
                <View style={styles.ticketCopy}>
                  <View style={styles.ticketTitleRow}>
                    <Text style={styles.ticketTitle} numberOfLines={1}>
                      {ticket.subject}
                    </Text>
                    <Text style={[styles.badge, statusTone(ticket.status)]}>
                      {statusLabel(ticket.status)}
                    </Text>
                  </View>
                  <Text style={styles.meta} numberOfLines={1}>
                    {supportReferenceLabel(ticket.reference)} - {ticket.category}
                  </Text>
                  <Text style={styles.preview} numberOfLines={2}>
                    {ticket.message}
                  </Text>
                  <Text style={styles.meta}>
                    Updated {formatDate(ticket.updated_at)} - {ticket.message_count || 0} messages
                  </Text>
                </View>
                <Ionicons name="chevron-forward" color={colors.muted} size={19} />
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
      <MiniPlayer />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    gap: 16,
    padding: spacing.page,
    paddingBottom: 120,
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
  title: {
    flex: 1,
    textAlign: "center",
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
  errorText: {
    color: colors.accent,
    fontSize: 13,
    textAlign: "center",
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "950",
  },
  emptyText: {
    color: colors.muted,
    fontSize: 13,
    textAlign: "center",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 8,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 16,
  },
  primaryText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: "950",
  },
  list: {
    gap: 10,
  },
  ticket: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: spacing.radius,
    borderWidth: 1,
    flexDirection: "row",
    gap: 11,
    padding: 12,
  },
  ticketIcon: {
    alignItems: "center",
    backgroundColor: "rgba(32, 230, 243, 0.12)",
    borderRadius: 8,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  ticketCopy: {
    flex: 1,
    gap: 4,
  },
  ticketTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  ticketTitle: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    fontWeight: "950",
  },
  badge: {
    borderRadius: 8,
    fontSize: 10,
    fontWeight: "950",
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  badgeActive: {
    backgroundColor: "rgba(32, 230, 243, 0.14)",
    color: colors.primary,
  },
  badgeOk: {
    backgroundColor: "rgba(54, 242, 165, 0.13)",
    color: colors.success,
  },
  badgeWarn: {
    backgroundColor: "rgba(244, 39, 200, 0.13)",
    color: colors.accent,
  },
  meta: {
    color: colors.muted,
    fontSize: 12,
  },
  preview: {
    color: colors.softText,
    fontSize: 13,
    lineHeight: 18,
  },
});

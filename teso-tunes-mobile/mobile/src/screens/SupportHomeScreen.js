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

import { BACKEND_CONNECTION_ERROR, getSupportHelpCenter } from "../api/musicApi";
import MiniPlayer from "../components/MiniPlayer";
import { useAuth } from "../context/AuthContext";
import { colors, spacing } from "../theme";

export default function SupportHomeScreen({ navigation }) {
  const { isAuthenticated, listener } = useAuth();
  const [helpCenter, setHelpCenter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadHelp = useCallback(async ({ refresh = false } = {}) => {
    try {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError("");
      setHelpCenter(await getSupportHelpCenter());
    } catch (loadError) {
      setError(loadError?.detail || loadError?.message || BACKEND_CONNECTION_ERROR);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadHelp();
    }, [loadHelp])
  );

  function openProtected(screen, params) {
    if (!isAuthenticated) {
      navigation.navigate("Profile", { loginRequired: true });
      return;
    }
    navigation.navigate(screen, params);
  }

  const roleKey = ["artist", "artist_pending"].includes(listener?.role) ? "artist" : "listener";
  const categories = helpCenter?.categories?.[roleKey] || [];

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.primary}
            onRefresh={() => loadHelp({ refresh: true })}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topbar}>
          <TouchableOpacity
            activeOpacity={0.82}
            accessibilityLabel="Go back"
            style={styles.iconButton}
            onPress={() => navigation.goBack()}
          >
            <Ionicons name="chevron-back" color={colors.softText} size={22} />
          </TouchableOpacity>
          <Text style={styles.title}>Help & Support</Text>
          <View style={styles.iconSpacer} />
        </View>

        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="help-buoy" color={colors.primary} size={27} />
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>We are here to help</Text>
            <Text style={styles.heroText}>
              Send support requests from your account and track replies in the app.
            </Text>
          </View>
        </View>

        <View style={styles.actionGrid}>
          <SupportTile
            icon="create"
            title="Submit Ticket"
            text="Account, playback, uploads, content reports"
            onPress={() => openProtected("SupportTicketForm")}
          />
          <SupportTile
            icon="file-tray-full"
            title="My Tickets"
            text="View status and support replies"
            onPress={() => openProtected("SupportTickets")}
          />
          <SupportTile
            icon="chatbubble-ellipses"
            title="Contact Support"
            text="Start a new conversation with the team"
            onPress={() => openProtected("SupportTicketForm")}
          />
        </View>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : error ? (
          <View style={styles.stateBlock}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity activeOpacity={0.84} style={styles.primaryButton} onPress={loadHelp}>
              <Text style={styles.primaryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Help Center</Text>
              {(helpCenter?.articles || []).map((article) => (
                <View key={article.id} style={styles.article}>
                  <View style={styles.articleIcon}>
                    <Ionicons name="reader" color={colors.accent} size={18} />
                  </View>
                  <View style={styles.articleCopy}>
                    <Text style={styles.articleTitle}>{article.title}</Text>
                    <Text style={styles.articleText}>{article.summary}</Text>
                  </View>
                </View>
              ))}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                {roleKey === "artist" ? "Artist support categories" : "Listener support categories"}
              </Text>
              <View style={styles.chips}>
                {categories.map((category) => (
                  <TouchableOpacity
                    key={category}
                    activeOpacity={0.84}
                    style={styles.chip}
                    onPress={() =>
                      openProtected("SupportTicketForm", { category })
                    }
                  >
                    <Text style={styles.chipText}>{category}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </>
        )}
      </ScrollView>
      {isAuthenticated ? <MiniPlayer /> : null}
    </SafeAreaView>
  );
}

function SupportTile({ icon, onPress, text, title }) {
  return (
    <TouchableOpacity activeOpacity={0.84} style={styles.tile} onPress={onPress}>
      <View style={styles.tileIcon}>
        <Ionicons name={icon} color={colors.background} size={21} />
      </View>
      <Text style={styles.tileTitle}>{title}</Text>
      <Text style={styles.tileText}>{text}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    gap: 18,
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
  iconSpacer: {
    width: 42,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "950",
  },
  hero: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: spacing.radius,
    borderWidth: 1,
    flexDirection: "row",
    gap: 14,
    padding: 16,
  },
  heroIcon: {
    alignItems: "center",
    backgroundColor: "rgba(32, 230, 243, 0.14)",
    borderRadius: 8,
    height: 52,
    justifyContent: "center",
    width: 52,
  },
  heroCopy: {
    flex: 1,
    gap: 5,
  },
  heroTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "950",
  },
  heroText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  actionGrid: {
    gap: 10,
  },
  tile: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: spacing.radius,
    borderWidth: 1,
    gap: 7,
    padding: 14,
  },
  tileIcon: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 8,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  tileTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "950",
  },
  tileText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  loader: {
    marginTop: 20,
  },
  stateBlock: {
    alignItems: "center",
    gap: 12,
    paddingVertical: 30,
  },
  errorText: {
    color: colors.accent,
    fontSize: 13,
    textAlign: "center",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 8,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  primaryText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: "950",
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "950",
  },
  article: {
    alignItems: "flex-start",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: spacing.radius,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 13,
  },
  articleIcon: {
    alignItems: "center",
    backgroundColor: "rgba(244, 39, 200, 0.13)",
    borderRadius: 8,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  articleCopy: {
    flex: 1,
    gap: 4,
  },
  articleTitle: {
    color: colors.softText,
    fontSize: 14,
    fontWeight: "900",
  },
  articleText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
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
  chipText: {
    color: colors.softText,
    fontSize: 12,
    fontWeight: "800",
  },
});

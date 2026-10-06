import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { ActivityIndicator, Image, Platform, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from "react-native";

import { useAuth } from "../context/AuthContext";
import { useEngagement } from "../context/EngagementContext";
import { colors, spacing } from "../theme";
import { artworkSource, TESOHUB_ARTWORK_PLACEHOLDER } from "../utils/artwork";
import { formatFollowers } from "../utils/format";

export default function ArtistCard({ artist, onPress, compact = false }) {
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const { isAuthenticated } = useAuth();
  const {
    getArtistFollowerCount,
    isArtistFollowed,
    isArtistFollowPending,
    toggleArtistFollow,
  } = useEngagement();
  const followed = isArtistFollowed(artist.id);
  const pending = isArtistFollowPending(artist.id);
  const followerCount = getArtistFollowerCount(artist);
  const compactTileSize = Math.min(
    168,
    Math.max(146, Math.round((width - spacing.page * 2 - 18) / 2.2))
  );

  function openProfile() {
    const parentNavigation = navigation.getParent?.();
    if (parentNavigation?.navigate) {
      parentNavigation.navigate("Profile", { loginRequired: true });
      return;
    }

    navigation.navigate("Profile", { loginRequired: true });
  }

  function handleFollowPress() {
    if (!isAuthenticated) {
      openProfile();
      return;
    }

    toggleArtistFollow(artist);
  }

  return (
    <TouchableOpacity
      style={[styles.card, compact ? styles.compact : styles.flexCard, compact && { width: compactTileSize }]}
      onPress={onPress}
    >
      <Image defaultSource={TESOHUB_ARTWORK_PLACEHOLDER} source={artworkSource(artist.photo)} style={[styles.photo, compact && { width: compactTileSize, height: compactTileSize }]} />
      <View style={styles.copy}>
        <Text style={styles.name} numberOfLines={1}>{artist.name}</Text>
        <Text style={styles.meta} numberOfLines={1}>{formatFollowers(followerCount)}</Text>
        <TouchableOpacity
          disabled={pending}
          style={[styles.followButton, followed && styles.followedButton]}
          onPress={(event) => {
            event.stopPropagation?.();
            handleFollowPress();
          }}
        >
          {pending ? (
            <ActivityIndicator color={followed ? colors.softText : colors.primary} size="small" />
          ) : (
            <Ionicons name={followed ? "checkmark" : "person-add"} color={followed ? colors.softText : colors.primary} size={14} />
          )}
          <Text style={[styles.followText, followed && styles.followedText]}>
            {followed ? "Following" : "Follow"}
          </Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "transparent",
    borderRadius: 8,
    overflow: "hidden",
  },
  flexCard: { flex: 1 },
  compact: { flexGrow: 0, flexShrink: 0 },
  photo: {
    aspectRatio: 1,
    height: Platform.OS === "web" ? "auto" : undefined,
    backgroundColor: colors.elevated,
    borderRadius: 5,
    width: "100%",
  },
  copy: {
    gap: 6,
    paddingTop: 8,
  },
  name: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "850",
  },
  meta: {
    color: colors.muted,
    fontSize: 13,
  },
  followButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderColor: colors.softText,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    marginTop: 2,
    minHeight: 44,
    paddingHorizontal: 10,
  },
  followedButton: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderColor: colors.border,
  },
  followText: {
    color: colors.softText,
    fontSize: 12,
    fontWeight: "900",
  },
  followedText: {
    color: colors.softText,
  },
});

import { Ionicons } from "@expo/vector-icons";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { useEngagement } from "../context/EngagementContext";
import { colors } from "../theme";
import { formatFollowers } from "../utils/format";

export default function ArtistCard({ artist, onPress, compact = false }) {
  const { getArtistFollowerCount, isArtistFollowed, toggleArtistFollow } = useEngagement();
  const followed = isArtistFollowed(artist.id);
  const followerCount = getArtistFollowerCount(artist);

  return (
    <TouchableOpacity style={[styles.card, compact && styles.compact]} onPress={onPress}>
      <Image source={{ uri: artist.photo }} style={styles.photo} />
      <View style={styles.copy}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{artist.name}</Text>
          {artist.is_featured && <Text style={styles.badge}>Featured</Text>}
        </View>
        <Text style={styles.category} numberOfLines={1}>{artist.category}</Text>
        <Text style={styles.location} numberOfLines={1}>{artist.location}</Text>
        <TouchableOpacity
          style={[styles.followButton, followed && styles.followedButton]}
          onPress={(event) => {
            event.stopPropagation?.();
            toggleArtistFollow(artist);
          }}
        >
          <Ionicons name={followed ? "checkmark" : "person-add"} color={followed ? colors.text : colors.primary} size={14} />
          <Text style={[styles.followText, followed && styles.followedText]}>
            {followed ? "Following" : "Follow"}
          </Text>
        </TouchableOpacity>
        <Text style={styles.followerCount}>{formatFollowers(followerCount)}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    overflow: "hidden",
  },
  compact: {
    flex: 0,
    width: 168,
  },
  photo: {
    backgroundColor: colors.elevated,
    height: 138,
    width: "100%",
  },
  copy: {
    gap: 5,
    padding: 10,
  },
  nameRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  name: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    fontWeight: "800",
  },
  badge: {
    backgroundColor: colors.primary,
    borderRadius: 6,
    color: colors.text,
    fontSize: 10,
    fontWeight: "800",
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  category: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "700",
  },
  location: {
    color: colors.muted,
    fontSize: 12,
  },
  followButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderColor: colors.primary,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    marginTop: 4,
    minHeight: 28,
    paddingHorizontal: 8,
  },
  followedButton: {
    backgroundColor: colors.primary,
  },
  followText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "900",
  },
  followedText: {
    color: colors.text,
  },
  followerCount: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
  },
});

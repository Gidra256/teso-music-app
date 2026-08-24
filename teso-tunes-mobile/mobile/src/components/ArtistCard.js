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
        <Text style={styles.name} numberOfLines={1}>{artist.name}</Text>
        <Text style={styles.meta} numberOfLines={1}>{formatFollowers(followerCount)}</Text>
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
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "transparent",
    borderRadius: 8,
    flex: 1,
    overflow: "hidden",
  },
  compact: {
    flex: 0,
    width: 154,
  },
  photo: {
    backgroundColor: colors.elevated,
    borderRadius: 5,
    height: 154,
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
    fontSize: 12,
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
    minHeight: 30,
    paddingHorizontal: 10,
  },
  followedButton: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  followText: {
    color: colors.softText,
    fontSize: 11,
    fontWeight: "900",
  },
  followedText: {
    color: colors.background,
  },
});

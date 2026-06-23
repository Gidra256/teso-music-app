import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { getArtist } from "../api/musicApi";
import MiniPlayer from "../components/MiniPlayer";
import SongCard from "../components/SongCard";
import { useEngagement } from "../context/EngagementContext";
import { colors, spacing } from "../theme";
import { formatFollowers } from "../utils/format";

export default function ArtistDetailScreen({ route }) {
  const { getArtistFollowerCount, isArtistFollowed, toggleArtistFollow } = useEngagement();
  const [artist, setArtist] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getArtist(route.params.id).then((item) => {
      setArtist(item);
      setLoading(false);
    });
  }, [route.params.id]);

  if (loading) {
    return <ActivityIndicator color={colors.primary} style={styles.loader} />;
  }

  const followed = isArtistFollowed(artist.id);
  const followerCount = getArtistFollowerCount(artist);

  return (
    <View style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Image source={{ uri: artist.photo }} style={styles.heroImage} />
        <View style={styles.titleRow}>
          <Text style={styles.name}>{artist.name}</Text>
          {artist.is_featured && <Ionicons name="star" color={colors.accent} size={22} />}
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.meta}>{artist.category}</Text>
          <Text style={styles.dot}>.</Text>
          <Text style={styles.meta}>{artist.location}</Text>
        </View>
        <TouchableOpacity style={[styles.followButton, followed && styles.followedButton]} onPress={() => toggleArtistFollow(artist)}>
          <Ionicons name={followed ? "checkmark" : "person-add"} color={followed ? colors.text : colors.primary} size={16} />
          <Text style={[styles.followText, followed && styles.followedText]}>
            {followed ? "Following" : "Follow"}
          </Text>
        </TouchableOpacity>
        <Text style={styles.followerCount}>{formatFollowers(followerCount)}</Text>
        <Text style={styles.bio}>{artist.bio}</Text>
        <Text style={styles.sectionTitle}>Songs by {artist.name}</Text>
        <View style={styles.list}>
          {(artist.songs || []).map((song) => (
            <SongCard key={song.id} song={song} queue={artist.songs || []} />
          ))}
        </View>
      </ScrollView>
      <MiniPlayer />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    gap: 14,
    padding: spacing.page,
    paddingBottom: 110,
  },
  heroImage: {
    backgroundColor: colors.elevated,
    borderRadius: 8,
    height: 290,
    width: "100%",
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  name: {
    color: colors.text,
    flex: 1,
    fontSize: 30,
    fontWeight: "900",
  },
  metaRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  meta: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: "800",
  },
  dot: {
    color: colors.muted,
  },
  bio: {
    color: colors.softText,
    fontSize: 15,
    lineHeight: 22,
  },
  followButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderColor: colors.primary,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    minHeight: 38,
    paddingHorizontal: 12,
  },
  followedButton: {
    backgroundColor: colors.primary,
  },
  followText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "900",
  },
  followedText: {
    color: colors.text,
  },
  followerCount: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800",
    marginTop: -8,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
    marginTop: 6,
  },
  list: {
    gap: 12,
  },
  loader: {
    backgroundColor: colors.background,
    flex: 1,
    paddingTop: 80,
  },
});

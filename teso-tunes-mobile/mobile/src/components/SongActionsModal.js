import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../context/AuthContext";
import { useEngagement } from "../context/EngagementContext";
import { usePlayer } from "../context/PlayerContext";
import { colors, spacing } from "../theme";
import AddToPlaylistModal from "./AddToPlaylistModal";
import SongShareModal from "./SongShareModal";

export default function SongActionsModal({ song, queue, onClose }) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { isAuthenticated } = useAuth();
  const { isSongLiked, isSongLikePending, toggleSongLike } = useEngagement();
  const { currentSong, isPlaying, playSong, togglePlay } = usePlayer();
  const [playlistSong, setPlaylistSong] = useState(null);
  const [sharedSong, setSharedSong] = useState(null);
  const liked = song ? isSongLiked(song.id) : false;
  const pending = song ? isSongLikePending(song.id) : false;
  const active = song && String(currentSong?.id) === String(song.id);
  const artistId = song?.artist || song?.artist_id;

  function accountAction(action) {
    if (isAuthenticated) return action();
    onClose();
    navigation.navigate("Profile", { loginRequired: true });
  }

  return (
    <>
      <Modal visible={Boolean(song)} transparent animationType="slide" onRequestClose={onClose}>
        <View style={styles.backdrop}>
          <TouchableOpacity accessible={false} style={styles.dismiss} onPress={onClose} />
          <View style={[styles.sheet, { paddingBottom: Math.max(16, insets.bottom + 12) }]}>
            <View style={styles.header}>
              <View style={styles.copy}>
                <Text style={styles.title} numberOfLines={2}>{song?.title}</Text>
                <Text style={styles.artist} numberOfLines={1}>{song?.artist_name}</Text>
              </View>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close song actions" style={styles.close} onPress={onClose}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Action icon={active && isPlaying ? "pause" : "play"} label={active && isPlaying ? "Pause" : "Play"} onPress={() => {
                if (active) togglePlay();
                else playSong(song, queue);
                onClose();
              }} />
              <Action icon={liked ? "heart" : "heart-outline"} label={liked ? "Unlike" : "Like"} disabled={pending}
                onPress={() => accountAction(() => toggleSongLike(song))} />
              <Action icon="add-circle-outline" label="Add to Playlist" onPress={() => accountAction(() => {
                setPlaylistSong(song);
                onClose();
              })} />
              <Action icon="share-social-outline" label="Share" onPress={() => { setSharedSong(song); onClose(); }} />
              {artistId ? <Action icon="person-circle-outline" label="Go to Artist" onPress={() => {
                onClose();
                navigation.navigate("ArtistDetail", { id: artistId });
              }} /> : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
      <AddToPlaylistModal visible={Boolean(playlistSong)} song={playlistSong} onClose={() => setPlaylistSong(null)} />
      <SongShareModal visible={Boolean(sharedSong)} song={sharedSong} onClose={() => setSharedSong(null)} />
    </>
  );
}

function Action({ icon, label, disabled, onPress }) {
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
    onPress={onPress} style={[styles.action, disabled && styles.disabled]}>
    <Ionicons name={icon} size={22} color={colors.primary} />
    <Text style={styles.label}>{label}</Text>
  </TouchableOpacity>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-end" },
  dismiss: { flex: 1 },
  sheet: { backgroundColor: colors.card, paddingHorizontal: spacing.page, paddingTop: 16, maxHeight: "90%", width: "100%", maxWidth: 560, alignSelf: "center", borderTopLeftRadius: 8, borderTopRightRadius: 8 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 12 },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  title: { color: colors.text, fontSize: 18, fontWeight: "800" },
  artist: { color: colors.muted, fontSize: 14 },
  close: { width: 48, height: 48, justifyContent: "center", alignItems: "center" },
  action: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 48, paddingVertical: 12 },
  label: { color: colors.text, fontSize: 16, flexShrink: 1 },
  disabled: { opacity: 0.5 },
});

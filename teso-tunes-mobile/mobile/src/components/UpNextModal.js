import { Ionicons } from "@expo/vector-icons";
import { memo } from "react";
import { FlatList, Image, Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePlaybackQueue } from "../context/PlaybackQueueContext";
import { usePlayer } from "../context/PlayerContext";
import { colors, spacing } from "../theme";
import { artworkSource } from "../utils/artwork";

export default function UpNextModal({ visible, onClose }) {
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    {visible ? <QueueContents onClose={onClose} /> : null}
  </Modal>;
}

function QueueContents({ onClose }) {
  const insets = useSafeAreaInsets();
  const { currentEntry, upcoming, removeEntry, moveEntry, repeatMode } = usePlaybackQueue();
  const { playQueueEntry, isPlaying, togglePlay } = usePlayer();
  return <View style={[styles.backdrop, { paddingTop: insets.top + 12 }]}>
    <TouchableOpacity accessible={false} style={styles.dismiss} onPress={onClose} />
    <View style={[styles.sheet, { paddingBottom: Math.max(12, insets.bottom) }]}>
      <View style={styles.header}>
        <Text style={styles.heading}>Up Next</Text>
        <IconButton label="Close Up Next" icon="close" onPress={onClose} />
      </View>
      <FlatList
        testID="up-next-list"
        data={upcoming}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={<>
          {currentEntry ? <>
            <Text style={styles.section}>Now Playing</Text>
            <View style={styles.current}>
              <Track song={currentEntry.song} />
              <IconButton label={isPlaying ? "Pause current song" : "Play current song"} icon={isPlaying ? "pause" : "play"} onPress={togglePlay} />
            </View>
          </> : null}
          <Text style={styles.section}>Up Next{upcoming.length ? ` (${upcoming.length})` : ""}</Text>
        </>}
        ListEmptyComponent={<Text style={styles.empty}>{repeatMode === "one" && currentEntry ? "This song will repeat." : repeatMode === "all" && currentEntry ? "The queue will repeat." : "No more songs in the queue."}</Text>}
        renderItem={({ item, index }) => <QueueRow item={item} index={index} count={upcoming.length}
          onPlay={playQueueEntry} onRemove={removeEntry} onMove={moveEntry} />}
      />
    </View>
  </View>;
}

const QueueRow = memo(function QueueRow({ item, index, count, onPlay, onRemove, onMove }) {
  return <View style={styles.row} testID={`queue-entry-${item.id}`}>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Play queued ${item.song.title}`} style={styles.track} onPress={() => onPlay(item.id)}>
      <Track song={item.song} />
      <Ionicons name="play" size={20} color={colors.text} />
    </TouchableOpacity>
    <View style={styles.actions}>
      <IconButton label={`Play next: ${item.song.title}`} icon="return-up-forward-outline" disabled={index === 0} onPress={() => onMove(item.id, -index)} />
      <IconButton label={`Move up: ${item.song.title}`} icon="arrow-up" disabled={index === 0} onPress={() => onMove(item.id, -1)} />
      <IconButton label={`Move down: ${item.song.title}`} icon="arrow-down" disabled={index === count - 1} onPress={() => onMove(item.id, 1)} />
      <IconButton label={`Remove from queue: ${item.song.title}`} icon="close" onPress={() => onRemove(item.id)} />
    </View>
  </View>;
});

function Track({ song }) {
  return <>
    <Image source={artworkSource(song.cover_image)} style={styles.artwork} />
    <View style={styles.copy}>
      <Text style={styles.title} numberOfLines={2}>{song.title}</Text>
      <Text style={styles.artist} numberOfLines={1}>{song.artist_name}</Text>
    </View>
  </>;
}

function IconButton({ label, icon, onPress, disabled }) {
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: Boolean(disabled) }}
    title={label} disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.disabled]}>
    <Ionicons name={icon} size={22} color={colors.softText} />
  </TouchableOpacity>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-end" },
  dismiss: { flex: 1, minHeight: 12 },
  sheet: { height: "85%", width: "100%", maxWidth: 640, alignSelf: "center", backgroundColor: colors.card, borderTopLeftRadius: 8, borderTopRightRadius: 8 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.page, minHeight: 60, borderBottomWidth: 1, borderBottomColor: colors.border },
  heading: { flex: 1, color: colors.text, fontSize: 20, fontWeight: "800" },
  list: { paddingHorizontal: spacing.page, paddingBottom: 16 },
  section: { color: colors.softText, fontSize: 14, fontWeight: "800", marginTop: 20, marginBottom: 12 },
  current: { flexDirection: "row", alignItems: "center", gap: 12, borderLeftWidth: 3, borderLeftColor: colors.accent, paddingLeft: 10, minHeight: 64 },
  row: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 8 },
  track: { flexDirection: "row", gap: 12, alignItems: "center", minHeight: 56 },
  artwork: { width: 48, height: 48, borderRadius: 4 },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  title: { color: colors.text, fontSize: 15, fontWeight: "700" },
  artist: { color: colors.muted, fontSize: 13 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 4 },
  button: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.3 },
  empty: { color: colors.muted, fontSize: 14, lineHeight: 22 },
});

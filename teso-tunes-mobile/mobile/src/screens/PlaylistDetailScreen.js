import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  addSongToPlaylist,
  deletePlaylist,
  getPlaylist,
  getSongs,
  removeSongFromPlaylist,
  updatePlaylist,
} from "../api/musicApi";
import MiniPlayer from "../components/MiniPlayer";
import { usePlayer } from "../context/PlayerContext";
import { colors, spacing } from "../theme";
import { artworkSource } from "../utils/artwork";

export default function PlaylistDetailScreen({ navigation, route }) {
  const playlistId = route?.params?.id;
  const { playSong } = usePlayer();
  const [playlist, setPlaylist] = useState(null);
  const [allSongs, setAllSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [renameVisible, setRenameVisible] = useState(false);
  const [songPickerVisible, setSongPickerVisible] = useState(false);
  const [newName, setNewName] = useState("");
  const [addingSongId, setAddingSongId] = useState(null);
  const [removingSongId, setRemovingSongId] = useState(null);

  const playlistSongs = Array.isArray(playlist?.songs) ? playlist.songs : [];

  const availableSongs = useMemo(() => {
    const playlistSongIds = new Set(playlistSongs.map((song) => Number(song.id)));
    return allSongs.filter((song) => !playlistSongIds.has(Number(song.id)));
  }, [allSongs, playlistSongs]);

  const loadDetail = useCallback(async () => {
    if (!playlistId) return;

    try {
      setLoading(true);
      setError("");
      const [playlistItem, songs] = await Promise.all([
        getPlaylist(playlistId),
        getSongs(),
      ]);
      setPlaylist(playlistItem);
      setNewName(playlistItem?.name || "");
      setAllSongs(Array.isArray(songs) ? songs : []);
    } catch (loadError) {
      setError(loadError?.detail || loadError?.message || "Could not load playlist.");
    } finally {
      setLoading(false);
    }
  }, [playlistId]);

  useFocusEffect(
    useCallback(() => {
      loadDetail();
    }, [loadDetail])
  );

  function playFromStart() {
    if (playlistSongs.length === 0) return;
    playSong(playlistSongs[0], playlistSongs);
  }

  function shuffleAndPlay() {
    if (playlistSongs.length === 0) return;
    const nextSong = playlistSongs[Math.floor(Math.random() * playlistSongs.length)];
    playSong(nextSong, playlistSongs);
  }

  async function handleRename() {
    const cleanName = newName.trim();
    if (!cleanName || saving || !playlist?.id) return;

    try {
      setSaving(true);
      setError("");
      const updated = await updatePlaylist(playlist.id, { name: cleanName });
      setPlaylist(updated);
      setRenameVisible(false);
    } catch (renameError) {
      setError(renameError?.detail || "Could not rename playlist.");
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    if (!playlist?.id) return;

    Alert.alert(
      "Delete playlist",
      `Delete ${playlist.name}?`,
      [
        { style: "cancel", text: "Cancel" },
        {
          style: "destructive",
          text: "Delete",
          onPress: handleDelete,
        },
      ]
    );
  }

  async function handleDelete() {
    if (!playlist?.id || saving) return;

    try {
      setSaving(true);
      await deletePlaylist(playlist.id);
      if (navigation.canGoBack?.()) {
        navigation.goBack();
        return;
      }
      navigation.navigate("TesoTabs", { screen: "Library" });
    } catch (deleteError) {
      setError(deleteError?.detail || "Could not delete playlist.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAdd(song) {
    if (!playlist?.id || !song?.id || addingSongId) return;

    try {
      setAddingSongId(song.id);
      setError("");
      const result = await addSongToPlaylist(playlist.id, song.id);
      setPlaylist(result?.playlist || playlist);
    } catch (addError) {
      setError(addError?.detail || "Could not add song.");
    } finally {
      setAddingSongId(null);
    }
  }

  async function handleRemove(song) {
    if (!playlist?.id || !song?.id || removingSongId) return;

    try {
      setRemovingSongId(song.id);
      setError("");
      const result = await removeSongFromPlaylist(playlist.id, song.id);
      setPlaylist(result?.playlist || playlist);
    } catch (removeError) {
      setError(removeError?.detail || "Could not remove song.");
    } finally {
      setRemovingSongId(null);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <TouchableOpacity
            activeOpacity={0.82}
            accessibilityLabel="Go back"
            style={styles.roundIconButton}
            onPress={() => navigation.goBack()}
          >
            <Ionicons name="arrow-back" color={colors.softText} size={21} />
          </TouchableOpacity>
          <Text style={styles.topTitle}>Playlist</Text>
          <TouchableOpacity
            activeOpacity={0.82}
            accessibilityLabel="Rename playlist"
            style={styles.roundIconButton}
            disabled={!playlist}
            onPress={() => setRenameVisible(true)}
          >
            <Ionicons name="ellipsis-horizontal" color={colors.softText} size={21} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : error && !playlist ? (
          <View style={styles.stateBlock}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity activeOpacity={0.84} style={styles.primaryButton} onPress={loadDetail}>
              <Text style={styles.primaryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : playlist ? (
          <>
            <View style={styles.header}>
              <View style={styles.cover}>
                <Ionicons name="list" color={colors.primary} size={40} />
              </View>
              <View style={styles.headerCopy}>
                <Text style={styles.name} numberOfLines={2}>{playlist.name}</Text>
                <Text style={styles.meta}>
                  {playlist.song_count || playlistSongs.length} {(playlist.song_count || playlistSongs.length) === 1 ? "song" : "songs"}
                </Text>
                {playlist.description ? (
                  <Text style={styles.description} numberOfLines={2}>{playlist.description}</Text>
                ) : null}
              </View>
            </View>

            <View style={styles.actions}>
              <TouchableOpacity
                activeOpacity={0.88}
                disabled={playlistSongs.length === 0}
                style={[styles.playButton, playlistSongs.length === 0 && styles.disabledButton]}
                onPress={playFromStart}
              >
                <Ionicons name="play" color={colors.background} size={23} />
                <Text style={styles.playButtonText}>Play</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.84}
                disabled={playlistSongs.length === 0}
                style={[styles.secondaryButton, playlistSongs.length === 0 && styles.disabledButton]}
                onPress={shuffleAndPlay}
              >
                <Ionicons name="shuffle" color={colors.softText} size={20} />
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.84}
                style={styles.secondaryButton}
                onPress={() => setSongPickerVisible(true)}
              >
                <Ionicons name="add" color={colors.softText} size={21} />
              </TouchableOpacity>
            </View>

            {error ? <Text style={styles.inlineError}>{error}</Text> : null}

            {playlistSongs.length === 0 ? (
              <View style={styles.emptyBlock}>
                <Ionicons name="musical-notes-outline" color={colors.accent} size={34} />
                <Text style={styles.emptyTitle}>No songs yet</Text>
                <Text style={styles.emptyText}>Add songs from the playlist or any song menu.</Text>
              </View>
            ) : (
              <View style={styles.songList}>
                {playlistSongs.map((song) => (
                  <PlaylistSongRow
                    key={song.id}
                    disabled={Boolean(removingSongId)}
                    removing={Number(removingSongId) === Number(song.id)}
                    song={song}
                    onPlay={() => playSong(song, playlistSongs)}
                    onRemove={() => handleRemove(song)}
                  />
                ))}
              </View>
            )}
          </>
        ) : null}
      </ScrollView>

      <RenameModal
        error={error}
        name={newName}
        saving={saving}
        visible={renameVisible}
        onChangeName={setNewName}
        onClose={() => setRenameVisible(false)}
        onDelete={confirmDelete}
        onSave={handleRename}
      />
      <SongPickerModal
        addingSongId={addingSongId}
        songs={availableSongs}
        visible={songPickerVisible}
        onAdd={handleAdd}
        onClose={() => setSongPickerVisible(false)}
      />
      <MiniPlayer />
    </SafeAreaView>
  );
}

function PlaylistSongRow({ disabled, onPlay, onRemove, removing, song }) {
  return (
    <TouchableOpacity activeOpacity={0.84} style={styles.songRow} onPress={onPlay}>
      <Image source={artworkSource(song.cover_image)} style={styles.songCover} />
      <View style={styles.songCopy}>
        <Text style={styles.songTitle} numberOfLines={1}>{song.title}</Text>
        <Text style={styles.songMeta} numberOfLines={1}>{song.artist_name}</Text>
      </View>
      <TouchableOpacity
        activeOpacity={0.82}
        accessibilityLabel="Remove song from playlist"
        disabled={disabled}
        style={styles.removeButton}
        onPress={(event) => {
          event.stopPropagation?.();
          onRemove();
        }}
      >
        {removing ? (
          <ActivityIndicator color={colors.accent} size="small" />
        ) : (
          <Ionicons name="remove-circle-outline" color={colors.softText} size={23} />
        )}
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function RenameModal({
  error,
  name,
  onChangeName,
  onClose,
  onDelete,
  onSave,
  saving,
  visible,
}) {
  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.modalBackdrop}
      >
        <TouchableOpacity activeOpacity={1} style={styles.dismissArea} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>Edit playlist</Text>
          <TextInput
            autoCapitalize="words"
            placeholder="Playlist name"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={name}
            onChangeText={onChangeName}
          />
          {error ? <Text style={styles.inlineError}>{error}</Text> : null}
          <View style={styles.sheetActions}>
            <TouchableOpacity activeOpacity={0.82} style={styles.outlineButton} onPress={onDelete}>
              <Ionicons name="trash-outline" color={colors.accent} size={18} />
              <Text style={styles.outlineText}>Delete</Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.86}
              disabled={saving}
              style={[styles.primaryButton, saving && styles.disabledButton]}
              onPress={onSave}
            >
              {saving ? (
                <ActivityIndicator color={colors.background} size="small" />
              ) : null}
              <Text style={styles.primaryText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SongPickerModal({ addingSongId, songs, visible, onAdd, onClose }) {
  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <TouchableOpacity activeOpacity={1} style={styles.dismissArea} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.pickerHeader}>
            <Text style={styles.sheetTitle}>Add songs</Text>
            <TouchableOpacity
              activeOpacity={0.82}
              accessibilityLabel="Close song picker"
              style={styles.roundIconButton}
              onPress={onClose}
            >
              <Ionicons name="close" color={colors.softText} size={21} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={songs}
            keyExtractor={(item) => String(item.id)}
            renderItem={({ item }) => (
              <TouchableOpacity
                activeOpacity={0.84}
                disabled={Boolean(addingSongId)}
                style={styles.songRow}
                onPress={() => onAdd(item)}
              >
                <Image source={artworkSource(item.cover_image)} style={styles.songCover} />
                <View style={styles.songCopy}>
                  <Text style={styles.songTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.songMeta} numberOfLines={1}>{item.artist_name}</Text>
                </View>
                {Number(addingSongId) === Number(item.id) ? (
                  <ActivityIndicator color={colors.primary} size="small" />
                ) : (
                  <Ionicons name="add-circle-outline" color={colors.softText} size={24} />
                )}
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text style={styles.emptyText}>All songs are already in this playlist.</Text>}
            style={styles.pickerList}
          />
        </View>
      </View>
    </Modal>
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
    paddingBottom: 110,
  },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 44,
  },
  topTitle: {
    color: colors.softText,
    fontSize: 13,
    fontWeight: "950",
    textTransform: "uppercase",
  },
  roundIconButton: {
    alignItems: "center",
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  loader: {
    marginTop: 34,
  },
  stateBlock: {
    alignItems: "center",
    gap: 12,
    marginTop: 34,
  },
  errorText: {
    color: colors.softText,
    fontSize: 15,
    textAlign: "center",
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 16,
  },
  cover: {
    alignItems: "center",
    backgroundColor: colors.elevated,
    borderRadius: 8,
    height: 118,
    justifyContent: "center",
    width: 118,
  },
  headerCopy: {
    flex: 1,
    gap: 6,
  },
  name: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "950",
  },
  meta: {
    color: colors.softText,
    fontSize: 13,
    fontWeight: "800",
  },
  description: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  actions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  playButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 8,
    flex: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 48,
  },
  playButtonText: {
    color: colors.background,
    fontSize: 15,
    fontWeight: "950",
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    width: 50,
  },
  disabledButton: {
    opacity: 0.5,
  },
  inlineError: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: "850",
  },
  emptyBlock: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 36,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "950",
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  songList: {
    gap: 8,
  },
  songRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 64,
  },
  songCover: {
    backgroundColor: colors.elevated,
    borderRadius: 5,
    height: 58,
    width: 58,
  },
  songCopy: {
    flex: 1,
  },
  songTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  songMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 4,
  },
  removeButton: {
    alignItems: "center",
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  modalBackdrop: {
    backgroundColor: "rgba(0, 0, 0, 0.58)",
    flex: 1,
    justifyContent: "flex-end",
  },
  dismissArea: {
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderWidth: 1,
    gap: 14,
    maxHeight: "84%",
    padding: spacing.page,
    paddingBottom: 28,
  },
  handle: {
    alignSelf: "center",
    backgroundColor: colors.border,
    borderRadius: 2,
    height: 4,
    width: 42,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "950",
  },
  input: {
    backgroundColor: colors.elevated,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.text,
    fontSize: 15,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  sheetActions: {
    flexDirection: "row",
    gap: 10,
  },
  outlineButton: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: 7,
    justifyContent: "center",
    minHeight: 46,
  },
  outlineText: {
    color: colors.softText,
    fontSize: 14,
    fontWeight: "900",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 8,
    flex: 1,
    flexDirection: "row",
    gap: 7,
    justifyContent: "center",
    minHeight: 46,
  },
  primaryText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: "950",
  },
  pickerHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  pickerList: {
    maxHeight: 430,
  },
});

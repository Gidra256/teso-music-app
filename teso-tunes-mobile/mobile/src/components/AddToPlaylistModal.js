import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import {
  addSongToPlaylist,
  createPlaylist,
  getPlaylists,
} from "../api/musicApi";
import { useAuth } from "../context/AuthContext";
import { colors, spacing } from "../theme";

export default function AddToPlaylistModal({ visible, song, onClose }) {
  const navigation = useNavigation();
  const { isAuthenticated } = useAuth();
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(false);
  const [addingId, setAddingId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!visible) {
      setCreating(false);
      setNewName("");
      setMessage("");
      setError("");
      setAddingId(null);
      return;
    }

    if (isAuthenticated) {
      loadPlaylists();
    }
  }, [visible, isAuthenticated]);

  async function loadPlaylists() {
    try {
      setLoading(true);
      setError("");
      const items = await getPlaylists();
      setPlaylists(Array.isArray(items) ? items : []);
    } catch (loadError) {
      setError(loadError?.detail || "Could not load playlists.");
    } finally {
      setLoading(false);
    }
  }

  function openProfile() {
    onClose?.();
    const parentNavigation = navigation.getParent?.();
    if (parentNavigation?.navigate) {
      parentNavigation.navigate("Profile", { loginRequired: true });
      return;
    }
    navigation.navigate("Profile", { loginRequired: true });
  }

  async function handleAdd(playlist) {
    if (!playlist?.id || !song?.id || addingId) return;

    try {
      setAddingId(playlist.id);
      setError("");
      const result = await addSongToPlaylist(playlist.id, song.id);
      const nextPlaylist = result?.playlist || playlist;
      setPlaylists((items) =>
        items.map((item) => (Number(item.id) === Number(nextPlaylist.id) ? nextPlaylist : item))
      );
      setMessage(
        result?.duplicate
          ? "Already in this playlist."
          : `Added to ${nextPlaylist.name}.`
      );
    } catch (addError) {
      setError(addError?.detail || "Could not add this song.");
    } finally {
      setAddingId(null);
    }
  }

  async function handleCreateAndAdd() {
    const cleanName = newName.trim();
    if (!cleanName || addingId || !song?.id) {
      setError("Enter a playlist name.");
      return;
    }

    try {
      setAddingId("new");
      setError("");
      const playlist = await createPlaylist({ name: cleanName });
      const result = await addSongToPlaylist(playlist.id, song.id);
      const nextPlaylist = result?.playlist || playlist;
      setPlaylists((items) => [nextPlaylist, ...items]);
      setCreating(false);
      setNewName("");
      setMessage(`Added to ${nextPlaylist.name}.`);
    } catch (createError) {
      setError(createError?.detail || "Could not create playlist.");
    } finally {
      setAddingId(null);
    }
  }

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.backdrop}
      >
        <TouchableOpacity activeOpacity={1} style={styles.dismissArea} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>Playlist</Text>
              <Text style={styles.title} numberOfLines={1}>
                Add to playlist
              </Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {song?.title || "Selected song"}
              </Text>
            </View>
            <TouchableOpacity
              accessibilityLabel="Close add to playlist"
              activeOpacity={0.82}
              style={styles.iconButton}
              onPress={onClose}
            >
              <Ionicons name="close" color={colors.softText} size={22} />
            </TouchableOpacity>
          </View>

          {!isAuthenticated ? (
            <View style={styles.centerState}>
              <Ionicons name="person-circle" color={colors.accent} size={36} />
              <Text style={styles.stateTitle}>Sign in to use playlists</Text>
              <Text style={styles.stateText}>Your playlists are saved to your account.</Text>
              <TouchableOpacity activeOpacity={0.86} style={styles.primaryButton} onPress={openProfile}>
                <Text style={styles.primaryText}>Sign In</Text>
              </TouchableOpacity>
            </View>
          ) : creating ? (
            <View style={styles.createBox}>
              <TextInput
                autoCapitalize="words"
                placeholder="Playlist name"
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={newName}
                onChangeText={setNewName}
              />
              <View style={styles.createActions}>
                <TouchableOpacity
                  activeOpacity={0.82}
                  style={styles.secondaryButton}
                  onPress={() => {
                    setCreating(false);
                    setNewName("");
                  }}
                >
                  <Text style={styles.secondaryText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.86}
                  disabled={addingId === "new"}
                  style={[styles.primaryButton, addingId === "new" && styles.disabledButton]}
                  onPress={handleCreateAndAdd}
                >
                  {addingId === "new" ? (
                    <ActivityIndicator color={colors.background} size="small" />
                  ) : (
                    <Ionicons name="add" color={colors.background} size={18} />
                  )}
                  <Text style={styles.primaryText}>Create</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <>
              <TouchableOpacity
                activeOpacity={0.84}
                style={styles.newPlaylistRow}
                onPress={() => setCreating(true)}
              >
                <View style={styles.rowIcon}>
                  <Ionicons name="add" color={colors.primary} size={20} />
                </View>
                <Text style={styles.newPlaylistText}>Create new playlist</Text>
              </TouchableOpacity>

              {loading ? (
                <ActivityIndicator color={colors.primary} style={styles.loader} />
              ) : (
                <FlatList
                  data={playlists}
                  keyExtractor={(item) => String(item.id)}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      activeOpacity={0.84}
                      disabled={Boolean(addingId)}
                      style={styles.playlistRow}
                      onPress={() => handleAdd(item)}
                    >
                      <View style={styles.rowIcon}>
                        <Ionicons name="list" color={colors.accent} size={18} />
                      </View>
                      <View style={styles.rowCopy}>
                        <Text style={styles.playlistName} numberOfLines={1}>
                          {item.name}
                        </Text>
                        <Text style={styles.playlistMeta}>
                          {item.song_count || 0} {(item.song_count || 0) === 1 ? "song" : "songs"}
                        </Text>
                      </View>
                      {Number(addingId) === Number(item.id) ? (
                        <ActivityIndicator color={colors.primary} size="small" />
                      ) : (
                        <Ionicons name="add-circle-outline" color={colors.softText} size={24} />
                      )}
                    </TouchableOpacity>
                  )}
                  ListEmptyComponent={
                    <Text style={styles.emptyText}>Create a playlist to save this song.</Text>
                  }
                  style={styles.list}
                />
              )}
            </>
          )}

          {message ? <Text style={styles.success}>{message}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
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
    maxHeight: "82%",
    padding: spacing.page,
    paddingBottom: 28,
  },
  handle: {
    alignSelf: "center",
    backgroundColor: colors.border,
    borderRadius: 2,
    height: 4,
    marginBottom: 14,
    width: 42,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 14,
    justifyContent: "space-between",
    marginBottom: 16,
  },
  headerCopy: {
    flex: 1,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "950",
    marginTop: 2,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 4,
  },
  iconButton: {
    alignItems: "center",
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  centerState: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 18,
  },
  stateTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "950",
  },
  stateText: {
    color: colors.muted,
    fontSize: 13,
    textAlign: "center",
  },
  newPlaylistRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 54,
  },
  rowIcon: {
    alignItems: "center",
    backgroundColor: colors.elevated,
    borderRadius: 8,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  newPlaylistText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  playlistRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 58,
  },
  rowCopy: {
    flex: 1,
  },
  playlistName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "850",
  },
  playlistMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 3,
  },
  list: {
    maxHeight: 330,
  },
  loader: {
    marginVertical: 22,
  },
  emptyText: {
    color: colors.muted,
    paddingVertical: 24,
    textAlign: "center",
  },
  createBox: {
    gap: 12,
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
  createActions: {
    flexDirection: "row",
    gap: 10,
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
    paddingHorizontal: 12,
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
  },
  disabledButton: {
    opacity: 0.62,
  },
  primaryText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: "950",
  },
  secondaryText: {
    color: colors.softText,
    fontSize: 14,
    fontWeight: "900",
  },
  success: {
    color: colors.success,
    fontSize: 13,
    fontWeight: "850",
    marginTop: 12,
  },
  error: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: "850",
    marginTop: 12,
  },
});

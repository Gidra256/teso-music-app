import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { MUSIC_GENRES, needsGenreNote } from "../data/genres";
import { colors, spacing } from "../theme";

export default function GenreSelector({
  label = "Genre",
  note,
  onChange,
  onChangeNote,
  value,
}) {
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState("");
  const filteredGenres = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return MUSIC_GENRES;
    return MUSIC_GENRES.filter((genre) => genre.toLowerCase().includes(needle));
  }, [query]);

  function selectGenre(genre) {
    onChange?.(genre);
    setQuery("");
    setVisible(false);
  }

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.84}
        style={styles.selector}
        onPress={() => setVisible(true)}
      >
        <Ionicons name="radio" color={colors.muted} size={18} />
        <View style={styles.selectorCopy}>
          <Text style={styles.label}>{label}</Text>
          <Text style={[styles.value, !value && styles.placeholder]} numberOfLines={1}>
            {value || "Choose from list"}
          </Text>
        </View>
        <Ionicons name="chevron-down" color={colors.softText} size={18} />
      </TouchableOpacity>

      {needsGenreNote(value) ? (
        <View style={styles.noteShell}>
          <Ionicons name="create" color={colors.muted} size={18} />
          <TextInput
            placeholder="Optional description"
            placeholderTextColor={colors.muted}
            style={styles.noteInput}
            value={note}
            onChangeText={onChangeNote}
          />
        </View>
      ) : null}

      <Modal animationType="slide" transparent visible={visible} onRequestClose={() => setVisible(false)}>
        <View style={styles.backdrop}>
          <TouchableOpacity activeOpacity={1} style={styles.dismissArea} onPress={() => setVisible(false)} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <View>
                <Text style={styles.eyebrow}>Select</Text>
                <Text style={styles.title}>{label}</Text>
              </View>
              <TouchableOpacity
                activeOpacity={0.82}
                accessibilityLabel="Close genre selector"
                style={styles.closeButton}
                onPress={() => setVisible(false)}
              >
                <Ionicons name="close" color={colors.softText} size={22} />
              </TouchableOpacity>
            </View>
            <View style={styles.searchShell}>
              <Ionicons name="search" color={colors.muted} size={18} />
              <TextInput
                autoCapitalize="none"
                placeholder="Search genres"
                placeholderTextColor={colors.muted}
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
              />
            </View>
            <FlatList
              data={filteredGenres}
              keyExtractor={(item) => item}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const active = item === value;
                return (
                  <TouchableOpacity
                    activeOpacity={0.84}
                    style={styles.genreRow}
                    onPress={() => selectGenre(item)}
                  >
                    <Text style={[styles.genreText, active && styles.genreTextActive]}>
                      {item}
                    </Text>
                    {active ? <Ionicons name="checkmark" color={colors.primary} size={21} /> : null}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={<Text style={styles.emptyText}>No matching genres.</Text>}
              style={styles.list}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  selector: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    minHeight: 54,
    paddingHorizontal: 12,
  },
  selectorCopy: {
    flex: 1,
    gap: 3,
  },
  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  value: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
  },
  placeholder: {
    color: colors.muted,
  },
  noteShell: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    minHeight: 50,
    paddingHorizontal: 12,
  },
  noteInput: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    minHeight: 44,
  },
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
    gap: 14,
    maxHeight: "82%",
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
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
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
  closeButton: {
    alignItems: "center",
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  searchShell: {
    alignItems: "center",
    backgroundColor: colors.elevated,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  searchInput: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    minHeight: 44,
  },
  list: {
    maxHeight: 390,
  },
  genreRow: {
    alignItems: "center",
    borderBottomColor: "rgba(255, 255, 255, 0.05)",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 52,
  },
  genreText: {
    color: colors.softText,
    flex: 1,
    fontSize: 15,
    fontWeight: "800",
  },
  genreTextActive: {
    color: colors.primary,
  },
  emptyText: {
    color: colors.muted,
    paddingVertical: 24,
    textAlign: "center",
  },
});

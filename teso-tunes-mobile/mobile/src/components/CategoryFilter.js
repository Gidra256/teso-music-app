import { ScrollView, StyleSheet, Text, TouchableOpacity } from "react-native";

import { CATEGORIES } from "../data/categories";
import { colors } from "../theme";

export default function CategoryFilter({ selected, onSelect }) {
  const categories = ["All", ...CATEGORIES];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {categories.map((category) => {
        const active = selected === category;
        return (
          <TouchableOpacity
            key={category}
            onPress={() => onSelect(category)}
            style={[styles.pill, active && styles.activePill]}
          >
            <Text style={[styles.label, active && styles.activeLabel]}>{category}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: 10,
    paddingVertical: 4,
  },
  pill: {
    backgroundColor: colors.elevated,
    borderRadius: 20,
    minHeight: 38,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  activePill: {
    backgroundColor: colors.primary,
  },
  label: {
    color: colors.softText,
    fontSize: 13,
    fontWeight: "700",
  },
  activeLabel: {
    color: colors.background,
  },
});

import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, TextInput, View } from "react-native";

import { colors } from "../theme";

export default function SearchBar({ value, onChangeText, placeholder = "Search Teso music" }) {
  return (
    <View style={styles.wrapper}>
      <Ionicons name="search" color={colors.muted} size={20} />
      <TextInput
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        value={value}
        onChangeText={onChangeText}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    height: 48,
  },
  input: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
  },
});

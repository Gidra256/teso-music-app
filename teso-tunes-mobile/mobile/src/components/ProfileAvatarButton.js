import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { StyleSheet, Text, TouchableOpacity } from "react-native";

import { useAuth } from "../context/AuthContext";
import { colors } from "../theme";

function getInitials(name) {
  return (
    name
      ?.split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || ""
  );
}

export default function ProfileAvatarButton() {
  const navigation = useNavigation();
  const { isAuthenticated, listener } = useAuth();
  const initials = getInitials(listener?.name);

  function openProfile() {
    const parentNavigation = navigation.getParent?.();
    if (parentNavigation?.navigate) {
      parentNavigation.navigate("Profile");
      return;
    }

    navigation.navigate("Profile");
  }

  return (
    <TouchableOpacity
      activeOpacity={0.82}
      accessibilityLabel="Open profile"
      style={[styles.button, isAuthenticated && styles.activeButton]}
      onPress={openProfile}
    >
      {initials ? (
        <Text style={styles.initials}>{initials}</Text>
      ) : (
        <Ionicons name="person" color={colors.text} size={18} />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    backgroundColor: colors.elevated,
    borderColor: "rgba(244, 39, 200, 0.28)",
    borderRadius: 20,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  activeButton: {
    backgroundColor: colors.primary,
    borderColor: "rgba(244, 39, 200, 0.5)",
  },
  initials: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "950",
  },
});

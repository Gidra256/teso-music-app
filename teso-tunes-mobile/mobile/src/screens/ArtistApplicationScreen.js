import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { submitArtistApplication } from "../api/musicApi";
import { useAuth } from "../context/AuthContext";
import { colors, spacing } from "../theme";

function pickedFile(asset, fallbackName, fallbackType) {
  return {
    name: asset.fileName || asset.name || fallbackName,
    type: asset.mimeType || fallbackType,
    uri: asset.uri,
  };
}

function errorMessage(error) {
  return (
    error?.detail ||
    error?.cause?.message ||
    error?.message ||
    "Could not submit application."
  );
}

export default function ArtistApplicationScreen({ navigation }) {
  const { listener, refreshAccount } = useAuth();
  const [form, setForm] = useState({
    artist_name: "",
    bio: "",
    contact_name: listener?.name || "",
    country: "Uganda",
    email: listener?.email || "",
    genre: "",
    genuine_confirmed: false,
    phone: listener?.phone || "",
    region: "",
    social_link: "",
  });
  const [photo, setPhoto] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const validationMessage = useMemo(() => {
    if (form.artist_name.trim().length < 2) return "Enter your artist name.";
    if (form.contact_name.trim().length < 2) return "Enter your contact name.";
    if (form.bio.trim().length < 20) return "Write a short artist biography.";
    if (!form.country.trim()) return "Enter your country.";
    if (!form.region.trim()) return "Enter your region or location.";
    if (!form.genre.trim()) return "Enter your primary genre.";
    if (!form.phone.trim()) return "Enter your phone number.";
    if (!form.email.trim()) return "Enter your email address.";
    if (!photo) return "Choose a profile photo.";
    if (!form.genuine_confirmed) return "Confirm the information is genuine.";
    return "";
  }, [form, photo]);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function choosePhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      mediaTypes: ["images"],
      quality: 0.86,
    });

    if (!result.canceled && result.assets?.[0]) {
      setPhoto(result.assets[0]);
    }
  }

  async function submitApplication() {
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const body = new FormData();
      Object.entries(form).forEach(([key, value]) => {
        body.append(key, typeof value === "boolean" ? String(value) : value);
      });
      body.append("photo_file", pickedFile(photo, "artist-photo.jpg", "image/jpeg"));

      await submitArtistApplication(body);
      await refreshAccount();
      Alert.alert("Application sent", "Your artist application is under review.");
      navigation.goBack();
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topbar}>
          <TouchableOpacity style={styles.iconButton} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" color={colors.softText} size={22} />
          </TouchableOpacity>
          <Text style={styles.title}>Become an Artist</Text>
          <View style={styles.iconSpacer} />
        </View>

        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="mic" color={colors.primary} size={24} />
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>Artist application</Text>
            <Text style={styles.heroText}>
              Submit your artist details for admin review before uploads unlock.
            </Text>
          </View>
        </View>

        <TouchableOpacity style={styles.photoPicker} onPress={choosePhoto}>
          {photo ? (
            <Image source={{ uri: photo.uri }} style={styles.photo} />
          ) : (
            <View style={styles.photoPlaceholder}>
              <Ionicons name="image" color={colors.primary} size={28} />
            </View>
          )}
          <View style={styles.photoCopy}>
            <Text style={styles.photoTitle}>Profile photo</Text>
            <Text style={styles.photoMeta}>{photo?.fileName || "Choose image"}</Text>
          </View>
          <Ionicons name="add-circle" color={colors.accent} size={24} />
        </TouchableOpacity>

        <View style={styles.form}>
          <StudioInput
            icon="musical-notes"
            placeholder="Artist/stage name"
            value={form.artist_name}
            onChangeText={(value) => updateField("artist_name", value)}
          />
          <StudioInput
            icon="person"
            placeholder="Real/contact name"
            value={form.contact_name}
            onChangeText={(value) => updateField("contact_name", value)}
          />
          <StudioInput
            icon="mail"
            keyboardType="email-address"
            placeholder="Email"
            value={form.email}
            autoCapitalize="none"
            onChangeText={(value) => updateField("email", value)}
          />
          <StudioInput
            icon="call"
            keyboardType="phone-pad"
            placeholder="Phone number"
            value={form.phone}
            onChangeText={(value) => updateField("phone", value)}
          />
          <View style={styles.row}>
            <StudioInput
              icon="flag"
              placeholder="Country"
              value={form.country}
              onChangeText={(value) => updateField("country", value)}
            />
            <StudioInput
              icon="location"
              placeholder="Region/location"
              value={form.region}
              onChangeText={(value) => updateField("region", value)}
            />
          </View>
          <StudioInput
            icon="radio"
            placeholder="Primary genre"
            value={form.genre}
            onChangeText={(value) => updateField("genre", value)}
          />
          <StudioInput
            icon="link"
            placeholder="Social media link (optional)"
            value={form.social_link}
            autoCapitalize="none"
            onChangeText={(value) => updateField("social_link", value)}
          />
          <StudioInput
            icon="reader"
            multiline
            placeholder="Short artist biography"
            style={styles.textArea}
            value={form.bio}
            onChangeText={(value) => updateField("bio", value)}
          />
        </View>

        <View style={styles.confirmRow}>
          <View style={styles.confirmCopy}>
            <Text style={styles.confirmTitle}>Information is genuine</Text>
            <Text style={styles.confirmText}>I confirm these artist details are true.</Text>
          </View>
          <Switch
            thumbColor={form.genuine_confirmed ? colors.accent : colors.softText}
            trackColor={{ false: colors.elevated, true: "rgba(244, 39, 200, 0.5)" }}
            value={form.genuine_confirmed}
            onValueChange={(value) => updateField("genuine_confirmed", value)}
          />
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <TouchableOpacity
          disabled={submitting}
          style={[styles.primaryButton, submitting && styles.disabledButton]}
          onPress={submitApplication}
        >
          {submitting ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <>
              <Ionicons name="send" color={colors.text} size={18} />
              <Text style={styles.primaryText}>Apply for Artist Account</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function StudioInput({ icon, style, ...props }) {
  return (
    <View style={[styles.inputShell, props.multiline && styles.multiShell]}>
      <Ionicons name={icon} color={colors.muted} size={18} />
      <TextInput
        placeholderTextColor={colors.muted}
        style={[styles.input, style]}
        {...props}
      />
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
    paddingBottom: 34,
  },
  topbar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: colors.elevated,
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  iconSpacer: {
    width: 40,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "950",
    textTransform: "uppercase",
  },
  hero: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: "rgba(32, 230, 243, 0.28)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 14,
  },
  heroIcon: {
    alignItems: "center",
    backgroundColor: "rgba(32, 230, 243, 0.1)",
    borderRadius: 8,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  heroCopy: {
    flex: 1,
    gap: 4,
  },
  heroTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "900",
  },
  heroText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  photoPicker: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 84,
    padding: 12,
  },
  photo: {
    backgroundColor: colors.elevated,
    borderRadius: 6,
    height: 60,
    width: 60,
  },
  photoPlaceholder: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 6,
    height: 60,
    justifyContent: "center",
    width: 60,
  },
  photoCopy: {
    flex: 1,
    gap: 4,
  },
  photoTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  photoMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
  },
  form: {
    gap: 10,
  },
  row: {
    gap: 10,
  },
  inputShell: {
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
  multiShell: {
    alignItems: "flex-start",
    paddingTop: 13,
  },
  input: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    minHeight: 44,
  },
  textArea: {
    minHeight: 112,
    textAlignVertical: "top",
  },
  confirmRow: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 14,
  },
  confirmCopy: {
    flex: 1,
    gap: 4,
  },
  confirmTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  confirmText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 8,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 50,
  },
  disabledButton: {
    backgroundColor: colors.elevated,
  },
  primaryText: {
    color: colors.background,
    fontSize: 15,
    fontWeight: "950",
  },
  errorText: {
    color: colors.softText,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
});

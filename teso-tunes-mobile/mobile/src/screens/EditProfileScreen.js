import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { CommonActions, usePreventRemove } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Keyboard, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import { resolveAccountAvatarUrl } from "../api/musicApi";
import AvatarCropEditor from "../components/AvatarCropEditor";
import AccountPage from "../components/AccountPage";
import { useAuth } from "../context/AuthContext";
import { colors } from "../theme";

// Native picker already provides a square crop UI. Always re-encode a small
// JPEG after cropping so large camera originals can upload successfully.
async function optimizeNativeAvatar(asset) {
  if (!asset?.uri) throw new Error("Could not open the selected picture.");
  const editor = ImageManipulator.ImageManipulator.manipulate(asset.uri);
  if (asset.width > 0 && asset.height > 0 && asset.width !== asset.height) {
    const side = Math.min(asset.width, asset.height);
    editor.crop({
      originX: Math.floor((asset.width - side) / 2),
      originY: Math.floor((asset.height - side) / 2),
      width: side,
      height: side,
    });
  }
  editor.resize({ width: 720, height: 720 });
  const rendered = await editor.renderAsync();
  const result = await rendered.saveAsync({
    format: ImageManipulator.SaveFormat.JPEG,
    compress: 0.82,
  });
  return {
    uri: result.uri,
    name: `listener-avatar-${Date.now()}.jpg`,
    type: "image/jpeg",
  };
}

function accountFields(listener) {
  return { name: listener?.name || "", email: listener?.email || "", phone: listener?.phone || "" };
}

export default function EditProfileScreen({ navigation }) {
  const { listener, updateAccount, updateAvatar } = useAuth();
  const [saved, setSaved] = useState(() => accountFields(listener));
  const [form, setForm] = useState(saved);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarUploadingRef = useRef(false);
  const [avatarMessage, setAvatarMessage] = useState("");
  const [avatarAsset, setAvatarAsset] = useState(null);
  const [avatarCropError, setAvatarCropError] = useState("");
  const avatarUri = resolveAccountAvatarUrl(listener?.avatar_url);
  const initials = (listener?.name || "Teso Listener").trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase()).join("") || "TT";
  const dirty = Object.keys(saved).some(key => form[key].trim() !== saved[key]);

  function confirmDiscard(proceed) {
    if (Platform.OS === "web") {
      if (window.confirm("Discard your unsaved profile changes?")) proceed();
    } else {
      Alert.alert("Discard changes?", "Your profile changes have not been saved.", [
        { text: "Keep editing", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: proceed },
      ]);
    }
  }

  usePreventRemove(dirty || saving || avatarUploading, ({ data }) => {
    if (!savingRef.current && !avatarUploadingRef.current) confirmDiscard(() => navigation.dispatch(data.action));
  });

  useEffect(() => {
    if (Platform.OS !== "web" || (!dirty && !saving && !avatarUploading && !avatarAsset)) return;
    const warn = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saving, avatarUploading, avatarAsset]);

  async function uploadPreparedAvatar(file) {
    if (savingRef.current || avatarUploadingRef.current) return false;
    avatarUploadingRef.current = true;
    setAvatarUploading(true);
    setError("");
    setAvatarCropError("");
    try {
      const formData = new FormData();
      if (Platform.OS === "web") {
        formData.append("avatar_upload", file, file.name || "listener-avatar.jpg");
      } else {
        formData.append("avatar_upload", file);
      }
      await updateAvatar(formData);
      setAvatarAsset(null);
      setAvatarMessage("Profile picture updated.");
      return true;
    } catch (uploadError) {
      const message = uploadError?.detail || uploadError?.message || "Could not upload your profile picture.";
      if (Platform.OS === "web") setAvatarCropError(message);
      else setError(message);
      return false;
    } finally {
      avatarUploadingRef.current = false;
      setAvatarUploading(false);
    }
  }

  async function changeAvatar() {
    if (savingRef.current || avatarUploadingRef.current) return;
    setError("");
    setAvatarMessage("");
    setAvatarCropError("");
    try {
      // This launches immediately from the button press, as web browsers require.
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: Platform.OS !== "web",
        aspect: [1, 1],
        mediaTypes: ["images"],
        quality: 0.86,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if (Platform.OS === "web") {
        setAvatarAsset(asset); // Crop and compress before POST, irrespective of original file size.
        return;
      }
      const optimized = await optimizeNativeAvatar(asset);
      await uploadPreparedAvatar(optimized);
    } catch (error) {
      setError(error?.detail || error?.message || "Could not prepare your photo.");
    }
  }

  async function save() {
    if (savingRef.current || avatarUploadingRef.current || !dirty) return;
    const payload = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim()]));
    if (payload.name.length < 2) { setError("Enter your profile name."); return; }
    if (!payload.email && !payload.phone) { setError("Enter an email or phone number."); return; }
    savingRef.current = true;
    setSaving(true);
    setSuccess(false);
    setError("");
    try {
      const account = await updateAccount(payload);
      const next = accountFields(account);
      setSaved(next);
      setForm(next);
      setSuccess(true);
      Keyboard.dismiss();
    } catch (saveError) {
      setError(saveError?.detail || saveError?.message || "Could not save your profile. Please try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function back() {
    if (savingRef.current || avatarUploadingRef.current) return;
    if (avatarAsset) { setAvatarAsset(null); return; }
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: "Profile" }] }));
  }

  return (
    <AccountPage title="Edit Profile" navigation={navigation} onBack={back} busy={saving || avatarUploading}>
      {Platform.OS === "web" ? (
        <AvatarCropEditor
          asset={avatarAsset}
          busy={avatarUploading}
          uploadError={avatarCropError}
          onCancel={() => { if (!avatarUploadingRef.current) { setAvatarAsset(null); setAvatarCropError(""); } }}
          onApply={uploadPreparedAvatar}
        />
      ) : null}
      <View style={styles.photoSection}>
        <View style={styles.photoCircle}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.photoImage} accessibilityLabel="Your profile picture" />
          ) : (
            <Text style={styles.photoInitials}>{initials}</Text>
          )}
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Choose profile picture"
          disabled={saving || avatarUploading}
          style={[styles.photoButton, (saving || avatarUploading) && styles.disabled]}
          onPress={changeAvatar}
        >
          {avatarUploading ? <ActivityIndicator color={colors.text} /> : <Ionicons name="camera-outline" color={colors.text} size={18} />}
          <Text style={styles.photoButtonText}>{avatarUploading ? "Uploading photo..." : avatarUri ? "Change photo" : "Add profile photo"}</Text>
        </TouchableOpacity>
        <Text style={styles.photoHint}>Choose a photo, crop it, and we’ll optimize it automatically</Text>
        {avatarMessage ? <Text accessibilityLiveRegion="polite" style={styles.message}>{avatarMessage}</Text> : null}
      </View>
      {[
        { key: "name", label: "Profile name", icon: "person-outline", autoCapitalize: "words" },
        { key: "email", label: "Email", icon: "mail-outline", keyboardType: "email-address", autoCapitalize: "none" },
        { key: "phone", label: "Phone", icon: "call-outline", keyboardType: "phone-pad" },
      ].map(field => (
        <View key={field.key} style={styles.field}>
          <Text style={styles.label}>{field.label}</Text>
          <View style={styles.inputRow}>
            <Ionicons name={field.icon} color={colors.muted} size={20} />
            <TextInput accessibilityLabel={field.label} placeholder={field.label} placeholderTextColor={colors.muted} style={styles.input} value={form[field.key]} editable={!saving && !avatarUploading} keyboardType={field.keyboardType} autoCapitalize={field.autoCapitalize} autoCorrect={false} returnKeyType="done" onSubmitEditing={save} onChangeText={value => { setForm(current => ({ ...current, [field.key]: value })); setSuccess(false); setError(""); }} />
          </View>
        </View>
      ))}
      {error ? <Text accessibilityRole="alert" style={styles.message}>{error}</Text> : null}
      {success ? <Text accessibilityLiveRegion="polite" style={styles.message}>Profile saved.</Text> : null}
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Save Changes" disabled={!dirty || saving || avatarUploading} activeOpacity={0.65} style={[styles.save, (!dirty || saving || avatarUploading) && styles.disabled]} onPress={save}>
        {saving ? <ActivityIndicator color={colors.text} /> : <Ionicons name="checkmark" color={colors.background} size={21} />}
        <Text style={[styles.saveText, saving && styles.savingText]}>{saving ? "Saving..." : "Save Changes"}</Text>
      </TouchableOpacity>
    </AccountPage>
  );
}

const styles = StyleSheet.create({
  photoSection: { alignItems: "center", gap: 12, marginBottom: 6 },
  photoCircle: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  photoImage: { width: 88, height: 88, borderRadius: 44 },
  photoInitials: { color: colors.background, fontSize: 27, fontWeight: "900" },
  photoButton: { flexDirection: "row", alignItems: "center", gap: 9, borderColor: colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 16, minHeight: 44 },
  photoButtonText: { color: colors.text, fontSize: 14, fontWeight: "700" },
  photoHint: { color: colors.muted, fontSize: 12 },
  field: { gap: 8 },
  label: { color: colors.softText, fontSize: 14, fontWeight: "700" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 14 },
  input: { color: colors.text, flex: 1, minWidth: 0, minHeight: 52, fontSize: 16 },
  message: { color: colors.softText, fontSize: 14, lineHeight: 21 },
  save: { flexDirection: "row", gap: 10, alignItems: "center", justifyContent: "center", minHeight: 48, borderRadius: 8, backgroundColor: colors.primary },
  disabled: { opacity: 0.5 },
  saveText: { color: colors.background, fontSize: 16, fontWeight: "800" },
  savingText: { color: colors.text },
});

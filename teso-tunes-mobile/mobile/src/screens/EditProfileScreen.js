import { Ionicons } from "@expo/vector-icons";
import { CommonActions, usePreventRemove } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Keyboard, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import AccountPage from "../components/AccountPage";
import { useAuth } from "../context/AuthContext";
import { colors } from "../theme";

function accountFields(listener) {
  return { name: listener?.name || "", email: listener?.email || "", phone: listener?.phone || "" };
}

export default function EditProfileScreen({ navigation }) {
  const { listener, updateAccount } = useAuth();
  const [saved, setSaved] = useState(() => accountFields(listener));
  const [form, setForm] = useState(saved);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
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

  usePreventRemove(dirty || saving, ({ data }) => {
    if (!savingRef.current) confirmDiscard(() => navigation.dispatch(data.action));
  });

  useEffect(() => {
    if (Platform.OS !== "web" || (!dirty && !saving)) return;
    const warn = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saving]);

  async function save() {
    if (savingRef.current || !dirty) return;
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
    if (savingRef.current) return;
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: "Profile" }] }));
  }

  return (
    <AccountPage title="Edit Profile" navigation={navigation} onBack={back} busy={saving}>
      {[
        { key: "name", label: "Profile name", icon: "person-outline", autoCapitalize: "words" },
        { key: "email", label: "Email", icon: "mail-outline", keyboardType: "email-address", autoCapitalize: "none" },
        { key: "phone", label: "Phone", icon: "call-outline", keyboardType: "phone-pad" },
      ].map(field => (
        <View key={field.key} style={styles.field}>
          <Text style={styles.label}>{field.label}</Text>
          <View style={styles.inputRow}>
            <Ionicons name={field.icon} color={colors.muted} size={20} />
            <TextInput accessibilityLabel={field.label} placeholder={field.label} placeholderTextColor={colors.muted} style={styles.input} value={form[field.key]} editable={!saving} keyboardType={field.keyboardType} autoCapitalize={field.autoCapitalize} autoCorrect={false} returnKeyType="done" onSubmitEditing={save} onChangeText={value => { setForm(current => ({ ...current, [field.key]: value })); setSuccess(false); setError(""); }} />
          </View>
        </View>
      ))}
      {error ? <Text accessibilityRole="alert" style={styles.message}>{error}</Text> : null}
      {success ? <Text accessibilityLiveRegion="polite" style={styles.message}>Profile saved.</Text> : null}
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Save Changes" disabled={!dirty || saving} activeOpacity={0.65} style={[styles.save, (!dirty || saving) && styles.disabled]} onPress={save}>
        {saving ? <ActivityIndicator color={colors.text} /> : <Ionicons name="checkmark" color={colors.background} size={21} />}
        <Text style={[styles.saveText, saving && styles.savingText]}>{saving ? "Saving..." : "Save Changes"}</Text>
      </TouchableOpacity>
    </AccountPage>
  );
}

const styles = StyleSheet.create({
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

import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { colors } from "../theme";

const GOOGLE_CLIENT_ID = "380021993741-6q5g850ds9qqu2u6c0q90rsucicj6l27.apps.googleusercontent.com";
const SCRIPT_URL = "https://accounts.google.com/gsi/client";
let sdkPromise;

function loadGoogleSdk() {
  if (globalThis.google?.accounts?.id) return Promise.resolve(globalThis.google);
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${SCRIPT_URL}"]`);
      const script = existing || document.createElement("script");
      const timeout = setTimeout(() => reject(new Error("Google sign-in timed out.")), 15000);
      function done() {
        clearTimeout(timeout);
        if (globalThis.google?.accounts?.id) resolve(globalThis.google);
        else reject(new Error("Google sign-in is unavailable in this browser."));
      }
      function fail() {
        clearTimeout(timeout);
        reject(new Error("Unable to load Google's sign-in service."));
      }
      script.addEventListener("load", done, { once: true });
      script.addEventListener("error", fail, { once: true });
      if (!existing) {
        script.src = SCRIPT_URL;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
    }).catch((error) => {
      sdkPromise = null;
      throw error;
    });
  }
  return sdkPromise;
}

export default function GoogleSignInButton({ onCredential, disabled = false, linkedMode = false }) {
  const element = useRef(null);
  const callback = useRef(onCredential);
  const disabledRef = useRef(disabled);
  const [error, setError] = useState("");
  callback.current = onCredential;
  disabledRef.current = disabled;

  useEffect(() => {
    let active = true;
    loadGoogleSdk().then((sdk) => {
      if (!active || !element.current) return;
      // Only one Google button is mounted on the Profile screen at a time.
      sdk.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => {
          if (active && !disabledRef.current && response?.credential) {
            callback.current?.(response.credential);
          }
        },
        auto_select: false,
        ux_mode: "popup",
      });
      sdk.accounts.id.renderButton(element.current, {
        theme: "filled_black",
        size: "large",
        shape: "pill",
        text: linkedMode ? "continue_with" : "continue_with",
        logo_alignment: "left",
        width: 280,
      });
    }).catch((cause) => {
      if (active) setError(cause.message);
    });
    return () => {
      active = false;
      if (element.current) element.current.innerHTML = "";
    };
  }, []);

  return (
    <View style={{ width: "100%", alignItems: "center", opacity: disabled ? 0.65 : 1 }}>
      <View ref={element} collapsable={false} style={{ minHeight: 44, width: 280, maxWidth: "100%" }} />
      {error ? <Text style={{ color: colors.softText, fontSize: 12, marginTop: 6 }}>{error}</Text> : null}
    </View>
  );
}

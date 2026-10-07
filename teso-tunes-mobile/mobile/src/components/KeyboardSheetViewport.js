import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";

export default function KeyboardSheetViewport({ children, style, visible }) {
  const [viewport, setViewport] = useState(null);
  useEffect(() => {
    if (Platform.OS !== "web" || !visible || !window.visualViewport) return;
    const source = window.visualViewport;
    const update = () => setViewport({ height: source.height, top: source.offsetTop });
    update();
    source.addEventListener("resize", update);
    source.addEventListener("scroll", update);
    return () => {
      source.removeEventListener("resize", update);
      source.removeEventListener("scroll", update);
    };
  }, [visible]);
  return <KeyboardAvoidingView
    behavior={Platform.OS === "ios" ? "padding" : "height"}
    enabled={Platform.OS !== "web"}
    style={[style, Platform.OS === "web" && viewport && {
      position: "absolute", left: 0, right: 0, top: viewport.top, height: viewport.height,
    }]}
  >{children}</KeyboardAvoidingView>;
}

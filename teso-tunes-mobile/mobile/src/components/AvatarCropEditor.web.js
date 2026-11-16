import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../theme";

// A square image is saved; the circular viewport previews how it appears in profiles.
const OUTPUT_PX = 720;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
const MAX_SOURCE_BYTES = 60 * 1024 * 1024; // prevent browser memory exhaustion

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function jpegBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Could not prepare this picture.")), "image/jpeg", quality);
  });
}

export default function AvatarCropEditor({ asset, busy, uploadError, onCancel, onApply }) {
  const [preview, setPreview] = useState("");
  const [dimensions, setDimensions] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState("");
  const [viewportSize, setViewportSize] = useState(300);
  const imageRef = useRef(null);
  const dragging = useRef(null);

  useEffect(() => {
    function measure() {
      setViewportSize(clamp(window.innerWidth - 80, 210, 330));
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setLocalError("");
    setDimensions(null);
    imageRef.current = null;
    if (!asset) { setPreview(""); return; }
    let active = true;
    let temporaryUrl = "";
    setLoading(true);
    async function load() {
      try {
        const blob = asset.file || (asset.uri ? await (await fetch(asset.uri)).blob() : null);
        if (!blob) throw new Error("Unable to read that picture.");
        if (blob.size > MAX_SOURCE_BYTES) throw new Error("This picture is unusually large. Select one under 60 MB.");
        temporaryUrl = URL.createObjectURL(blob);
        const img = new window.Image();
        img.onload = () => {
          if (!active) return;
          if (!img.naturalWidth || !img.naturalHeight) {
            setLocalError("This picture has no readable dimensions.");
          } else {
            imageRef.current = img;
            setDimensions({ width: img.naturalWidth, height: img.naturalHeight });
            setPreview(temporaryUrl);
          }
          setLoading(false);
        };
        img.onerror = () => {
          if (!active) return;
          setLoading(false);
          setLocalError("Your browser cannot open this photo. Try JPG or PNG (HEIC support varies by browser).");
        };
        img.src = temporaryUrl;
      } catch (error) {
        if (active) {
          setLocalError(error?.message || "Could not open this photo.");
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      active = false;
      imageRef.current = null;
      if (temporaryUrl) URL.revokeObjectURL(temporaryUrl);
    };
  }, [asset]);

  const scale = dimensions ? Math.max(viewportSize / dimensions.width, viewportSize / dimensions.height) * zoom : 1;
  const displayedW = dimensions ? dimensions.width * scale : 0;
  const displayedH = dimensions ? dimensions.height * scale : 0;
  const maxX = Math.max(0, (displayedW - viewportSize) / 2);
  const maxY = Math.max(0, (displayedH - viewportSize) / 2);
  const x = clamp(offset.x, -maxX, maxX);
  const y = clamp(offset.y, -maxY, maxY);

  function updateZoom(next) {
    const value = clamp(Number(next), 1, 3);
    const factor = value / zoom;
    // Preserve the position of the selected centre when changing zoom.
    const nextW = displayedW * factor;
    const nextH = displayedH * factor;
    setOffset(previous => ({
      x: clamp(previous.x * factor, -Math.max(0, (nextW - viewportSize) / 2), Math.max(0, (nextW - viewportSize) / 2)),
      y: clamp(previous.y * factor, -Math.max(0, (nextH - viewportSize) / 2), Math.max(0, (nextH - viewportSize) / 2)),
    }));
    setZoom(value);
  }

  function startDrag(event) {
    if (busy || !dimensions) return;
    dragging.current = { px: event.clientX, py: event.clientY, x, y };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function moveDrag(event) {
    if (!dragging.current || busy) return;
    const drag = dragging.current;
    setOffset({
      x: clamp(drag.x + event.clientX - drag.px, -maxX, maxX),
      y: clamp(drag.y + event.clientY - drag.py, -maxY, maxY),
    });
  }
  function stopDrag(event) {
    dragging.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  async function save() {
    if (busy || loading || !imageRef.current || !dimensions) return;
    setLocalError("");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT_PX;
      canvas.height = OUTPUT_PX;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("Your browser does not support image processing.");
      const sourceSize = viewportSize / scale;
      const originX = clamp((dimensions.width - sourceSize) / 2 - x / scale, 0, dimensions.width - sourceSize);
      const originY = clamp((dimensions.height - sourceSize) / 2 - y / scale, 0, dimensions.height - sourceSize);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, OUTPUT_PX, OUTPUT_PX);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(imageRef.current, originX, originY, sourceSize, sourceSize, 0, 0, OUTPUT_PX, OUTPUT_PX);
      let blob = await jpegBlob(canvas, 0.85);
      for (const quality of [0.72, 0.58, 0.4]) {
        if (blob.size <= MAX_OUTPUT_BYTES) break;
        blob = await jpegBlob(canvas, quality);
      }
      if (blob.size > MAX_OUTPUT_BYTES) throw new Error("Unable to compress this photo enough. Try another picture.");
      const prepared = new File([blob], `listener-avatar-${Date.now()}.jpg`, { type: "image/jpeg" });
      await onApply(prepared);
    } catch (error) {
      setLocalError(error?.message || "Could not crop this picture.");
    }
  }

  return (
    <Modal transparent visible={Boolean(asset)} animationType="fade" onRequestClose={busy ? undefined : onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.dialog}>
          <View style={styles.headingRow}>
            <View style={styles.headingText}>
              <Text style={styles.title}>Adjust profile photo</Text>
              <Text style={styles.subtitle}>Move and zoom to frame your face.</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close photo editor" disabled={busy} onPress={onCancel} style={styles.close}>
              <Ionicons name="close" size={23} color={colors.text} />
            </Pressable>
          </View>
          <View style={styles.previewWrap}>
            {loading ? <ActivityIndicator color={colors.primary} size="large" /> : null}
            {dimensions && preview ? (
              <div
                role="img"
                aria-label="Photo crop preview; drag to reposition your photo"
                tabIndex={0}
                onPointerDown={startDrag}
                onPointerMove={moveDrag}
                onPointerUp={stopDrag}
                onPointerCancel={stopDrag}
                onWheel={event => { event.preventDefault(); updateZoom(zoom + (event.deltaY > 0 ? -0.06 : 0.06)); }}
                onKeyDown={event => {
                  const deltas = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] };
                  if (!deltas[event.key]) return;
                  event.preventDefault();
                  setOffset(o => ({ x: clamp(o.x + deltas[event.key][0], -maxX, maxX), y: clamp(o.y + deltas[event.key][1], -maxY, maxY) }));
                }}
                style={{
                  width: viewportSize, height: viewportSize, position: "relative", overflow: "hidden",
                  borderRadius: "50%", outline: "3px solid #9ba5ff", touchAction: "none", cursor: busy ? "default" : "grab", background: "#10121c",
                }}
              >
                <img
                  src={preview}
                  alt=""
                  draggable={false}
                  style={{
                    position: "absolute", width: displayedW, height: displayedH,
                    left: (viewportSize - displayedW) / 2 + x,
                    top: (viewportSize - displayedH) / 2 + y,
                    pointerEvents: "none", userSelect: "none", maxWidth: "none", maxHeight: "none",
                  }}
                />
              </div>
            ) : null}
          </View>
          {dimensions ? (
            <View style={styles.zoomRow}>
              <Ionicons name="remove-circle-outline" size={22} color={colors.softText} />
              <input aria-label="Zoom photo" type="range" min="1" max="3" step="0.01" value={zoom}
                onChange={e => updateZoom(e.target.value)} disabled={busy}
                style={{ width: "100%", flex: 1, accentColor: "#9ba5ff", cursor: "pointer" }} />
              <Ionicons name="add-circle-outline" size={22} color={colors.softText} />
              <Pressable onPress={() => { setOffset({ x: 0, y: 0 }); setZoom(1); }} disabled={busy} accessibilityLabel="Reset crop">
                <Text style={styles.reset}>Reset</Text>
              </Pressable>
            </View>
          ) : null}
          <Text style={styles.hint}>Your photo will be cropped to a square and optimized automatically, even if the original is larger than 5 MB.</Text>
          {localError || uploadError ? <Text accessibilityRole="alert" style={styles.error}>{localError || uploadError}</Text> : null}
          <View style={styles.actions}>
            <Pressable onPress={onCancel} disabled={busy} style={[styles.button, styles.secondary]} accessibilityRole="button"><Text style={styles.secondaryText}>Cancel</Text></Pressable>
            <Pressable onPress={save} disabled={!dimensions || busy || loading} style={[styles.button, styles.primary, (!dimensions || busy) && styles.faded]} accessibilityRole="button">
              {busy ? <ActivityIndicator color={colors.background} /> : <Ionicons name="checkmark" size={18} color={colors.background} />}
              <Text style={styles.primaryText}>{busy ? "Saving…" : "Use this photo"}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0, 0, 0, .80)", justifyContent: "center", alignItems: "center", padding: 14 },
  dialog: { width: "100%", maxWidth: 480, padding: 20, borderRadius: 22, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, gap: 14 },
  headingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  headingText: { flex: 1, gap: 4 },
  title: { color: colors.text, fontSize: 21, fontWeight: "800" },
  subtitle: { color: colors.softText, fontSize: 13 },
  close: { padding: 6 },
  previewWrap: { minHeight: 220, justifyContent: "center", alignItems: "center", marginVertical: 4 },
  zoomRow: { flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 5 },
  reset: { color: colors.text, fontWeight: "700", fontSize: 13 },
  hint: { color: colors.softText, textAlign: "center", fontSize: 12, lineHeight: 18 },
  error: { color: "#ff8d8d", fontSize: 13, textAlign: "center" },
  actions: { flexDirection: "row", gap: 12, marginTop: 4 },
  button: { minHeight: 47, flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", borderRadius: 12, gap: 6 },
  secondary: { borderWidth: 1, borderColor: colors.border },
  secondaryText: { color: colors.text, fontWeight: "700" },
  primary: { backgroundColor: colors.primary },
  primaryText: { color: colors.background, fontWeight: "800" },
  faded: { opacity: .55 },
});

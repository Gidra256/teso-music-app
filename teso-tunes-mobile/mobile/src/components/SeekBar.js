import { useEffect, useRef, useState } from "react";
import { PanResponder, Platform, StyleSheet, View } from "react-native";

import { colors } from "../theme";
import { clampPosition } from "../utils/playerProgress";

export default function SeekBar({ currentTime = 0, disabled = false, duration = 0, onSeek, onSeekingChange }) {
  const widthRef = useRef(0);
  const gestureRef = useRef(null);
  const latest = useRef(null);
  const [preview, setPreview] = useState(null);
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const canSeek = !disabled && safeDuration > 0;
  const position = preview === null ? clampPosition(currentTime, safeDuration) : clampPosition(preview, safeDuration);
  latest.current = { canSeek, duration: safeDuration, onSeek, onSeekingChange };
  useEffect(() => () => { gestureRef.current = null; latest.current.canSeek = false; }, []);

  function previewAt(x) {
    const state = latest.current;
    if (!gestureRef.current || !state.canSeek || widthRef.current <= 0) return;
    const next = clampPosition(x / widthRef.current * state.duration, state.duration);
    gestureRef.current.position = next;
    setPreview(next);
    state.onSeekingChange?.(true, next);
  }

  function finish(commit) {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    setPreview(null);
    latest.current.onSeekingChange?.(false, null);
    if (commit && gesture && latest.current.canSeek) latest.current.onSeek?.(gesture.position);
  }

  // Keep the responder stable while audio status and preview values change.
  const responder = useRef(null);
  if (!responder.current) responder.current = PanResponder.create({
    onStartShouldSetPanResponder: () => latest.current.canSeek && widthRef.current > 0,
    onMoveShouldSetPanResponder: () => false,
    onPanResponderGrant: event => {
      const x = event.nativeEvent.locationX;
      gestureRef.current = { start: x, position: 0 };
      previewAt(x);
    },
    onPanResponderMove: (_event, gesture) => {
      if (gestureRef.current) previewAt(gestureRef.current.start + gesture.dx);
    },
    onPanResponderRelease: () => finish(true),
    onPanResponderTerminate: () => finish(false),
    onPanResponderTerminationRequest: () => false,
  });

  const webEvents = {
    onPointerDown: event => {
      if (!canSeek || (event.button !== undefined && event.button !== 0)) return;
      const rect = event.currentTarget.getBoundingClientRect();
      widthRef.current = rect.width;
      if (!rect.width) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      gestureRef.current = { left: rect.left, pointerId: event.pointerId, position: 0 };
      previewAt(event.clientX - rect.left);
    },
    onPointerMove: event => {
      if (gestureRef.current?.pointerId === event.pointerId) previewAt(event.clientX - gestureRef.current.left);
    },
    onPointerUp: event => {
      if (gestureRef.current?.pointerId !== event.pointerId) return;
      previewAt(event.clientX - gestureRef.current.left);
      finish(true);
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    },
    onPointerCancel: () => finish(false),
    onLostPointerCapture: () => { if (gestureRef.current) finish(false); },
    onKeyDown: event => {
      if (!canSeek) return;
      const keys = { ArrowLeft: position - 5, ArrowDown: position - 5, ArrowRight: position + 5, ArrowUp: position + 5, Home: 0, End: safeDuration };
      if (!(event.key in keys)) return;
      event.preventDefault();
      onSeek?.(clampPosition(keys[event.key], safeDuration));
    },
  };

  return (
    <View
      {...(Platform.OS === "web" ? webEvents : responder.current.panHandlers)}
      onLayout={event => { widthRef.current = event.nativeEvent.layout.width; }}
      accessibilityRole="adjustable"
      accessibilityLabel="Song progress"
      accessibilityValue={{ min: 0, max: safeDuration, now: position }}
      accessibilityState={{ disabled: !canSeek }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={event => {
        if (canSeek) onSeek?.(clampPosition(position + (event.nativeEvent.actionName === "increment" ? 5 : -5), safeDuration));
      }}
      {...(Platform.OS === "web" ? { role: "slider", tabIndex: canSeek ? 0 : -1, "aria-valuemin": 0, "aria-valuemax": safeDuration, "aria-valuenow": position, "aria-disabled": !canSeek } : {})}
      style={[styles.touchArea, Platform.OS === "web" && { touchAction: "none", cursor: canSeek ? "pointer" : "default" }, !canSeek && styles.disabled]}
    >
      <View pointerEvents="none" style={styles.track}>
        <View style={[styles.fill, { width: `${safeDuration ? position / safeDuration * 100 : 0}%` }]} />
        <View style={[styles.thumb, { left: `${safeDuration ? position / safeDuration * 100 : 0}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  touchArea: { justifyContent: "center", minHeight: 48, width: "100%" },
  disabled: { opacity: 0.5 },
  track: { backgroundColor: "rgba(255, 255, 255, 0.17)", borderRadius: 999, height: 6, width: "100%" },
  fill: { backgroundColor: colors.primary, borderRadius: 999, height: "100%" },
  thumb: { backgroundColor: colors.accent, borderColor: colors.background, borderRadius: 9, borderWidth: 3, height: 18, marginLeft: -9, marginTop: -6, position: "absolute", top: 0, width: 18 },
});

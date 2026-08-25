import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, View } from "react-native";

import { colors } from "../theme";

function clamp(value, min = 0, max = 1) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(value, max));
}

function safePositive(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function safeTime(value, duration) {
  const nextValue = Number.isFinite(value) ? value : 0;
  return duration > 0 ? clamp(nextValue, 0, duration) : Math.max(0, nextValue);
}

export default function SeekBar({
  currentTime = 0,
  disabled = false,
  duration = 0,
  onSeek,
  onSeekingChange,
}) {
  const trackWidthRef = useRef(0);
  const dragRatioRef = useRef(0);
  const dragStartXRef = useRef(0);
  const safeDuration = safePositive(duration);
  const safeCurrentTime = safeTime(currentTime, safeDuration);
  const [trackWidth, setTrackWidth] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [dragRatio, setDragRatio] = useState(0);

  const canSeek = !disabled && safeDuration > 0 && trackWidth > 0;
  const playerRatio = safeDuration > 0 ? clamp(safeCurrentTime / safeDuration) : 0;
  const visibleRatio = isSeeking ? dragRatio : playerRatio;

  useEffect(() => {
    if (isSeeking) return;
    dragRatioRef.current = playerRatio;
    setDragRatio(playerRatio);
  }, [isSeeking, playerRatio]);

  useEffect(() => {
    dragRatioRef.current = 0;
    setDragRatio(0);
    setIsSeeking(false);
    onSeekingChange?.(false, 0);
  }, [duration, onSeekingChange]);

  const setTrackWidthFromLayout = useCallback((width) => {
    const nextWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
    trackWidthRef.current = nextWidth;
    setTrackWidth(nextWidth);
  }, []);

  const ratioFromLocalX = useCallback((locationX) => {
    const width = trackWidthRef.current;
    if (width <= 0) return 0;
    return clamp(locationX / width);
  }, []);

  const previewRatio = useCallback(
    (ratio) => {
      const nextRatio = clamp(ratio);
      dragRatioRef.current = nextRatio;
      setDragRatio(nextRatio);
      onSeekingChange?.(true, nextRatio * safeDuration);
      return nextRatio;
    },
    [onSeekingChange, safeDuration]
  );

  const previewLocalX = useCallback(
    (locationX) => {
      if (!canSeek) return 0;
      return previewRatio(ratioFromLocalX(locationX));
    },
    [canSeek, previewRatio, ratioFromLocalX]
  );

  const finishSeek = useCallback(
    (ratio = dragRatioRef.current) => {
      if (!canSeek) {
        setIsSeeking(false);
        onSeekingChange?.(false, null);
        return;
      }

      const finalRatio = clamp(ratio);
      const finalTime = finalRatio * safeDuration;
      setIsSeeking(false);
      onSeekingChange?.(false, finalTime);
      onSeek?.(finalTime);
    },
    [canSeek, onSeek, onSeekingChange, safeDuration]
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => canSeek,
        onMoveShouldSetPanResponder: () => canSeek,
        onPanResponderGrant: (event) => {
          if (!canSeek) return;
          setIsSeeking(true);
          dragStartXRef.current = event.nativeEvent.locationX;
          previewLocalX(event.nativeEvent.locationX);
        },
        onPanResponderMove: (event, gestureState) => {
          if (!canSeek) return;
          previewLocalX(dragStartXRef.current + gestureState.dx);
        },
        onPanResponderRelease: () => finishSeek(),
        onPanResponderTerminate: () => finishSeek(),
      }),
    [canSeek, finishSeek, previewLocalX]
  );

  return (
    <View
      {...panResponder.panHandlers}
      style={[styles.touchArea, !canSeek && styles.disabled]}
    >
      <View
        onLayout={(event) => setTrackWidthFromLayout(event.nativeEvent.layout.width)}
        style={styles.track}
      >
        <View style={[styles.fill, { width: `${visibleRatio * 100}%` }]} />
        <View
          style={[
            styles.thumb,
            {
              left: `${visibleRatio * 100}%`,
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  touchArea: {
    justifyContent: "center",
    minHeight: 42,
    width: "100%",
  },
  disabled: {
    opacity: 0.5,
  },
  track: {
    backgroundColor: "rgba(255, 255, 255, 0.17)",
    borderRadius: 999,
    height: 6,
    overflow: "visible",
    width: "100%",
  },
  fill: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    height: "100%",
  },
  thumb: {
    backgroundColor: colors.accent,
    borderColor: colors.background,
    borderRadius: 9,
    borderWidth: 3,
    height: 18,
    marginLeft: -9,
    marginTop: -6,
    position: "absolute",
    shadowColor: colors.primary,
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 7,
    top: 0,
    width: 18,
  },
});

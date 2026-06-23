import { useCallback, useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, View } from "react-native";

import { colors } from "../theme";

const DEBUG_SEEK = false;

function isValidDuration(value) {
  return Number.isFinite(value) && value > 0;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(value, max));
}

export default function SeekBar({
  currentTime = 0,
  duration = 0,
  onSeek,
  onPreviewChange,
  disabled = false,
}) {
  const trackRef = useRef(null);
  const trackLeftRef = useRef(null);
  const trackWidthRef = useRef(0);
  const dragValueRef = useRef(0);
  const [trackWidth, setTrackWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragValue, setDragValue] = useState(0);

  const canSeek = !disabled && isValidDuration(duration) && trackWidth > 0;
  const safeDuration = isValidDuration(duration) ? duration : 0;
  const safeCurrentTime = clamp(currentTime, 0, safeDuration);
  const visibleValue = isDragging ? dragValue : safeCurrentTime;
  const progress = safeDuration > 0 ? clamp(visibleValue / safeDuration, 0, 1) : 0;

  const updateTrackMeasure = useCallback((callback) => {
    if (!trackRef.current?.measureInWindow) {
      callback?.();
      return;
    }

    trackRef.current.measureInWindow((x, y, width) => {
      if (Number.isFinite(x)) {
        trackLeftRef.current = x;
      }
      if (Number.isFinite(width) && width > 0) {
        trackWidthRef.current = width;
        setTrackWidth(width);
      }
      callback?.();
    });
  }, []);

  const updateTrackWidth = useCallback((width) => {
    if (!Number.isFinite(width) || width <= 0) return;
    trackWidthRef.current = width;
    setTrackWidth(width);
    requestAnimationFrame(() => updateTrackMeasure());
  }, [updateTrackMeasure]);

  const getValueFromFingerX = useCallback(
    (fingerX) => {
      const left = trackLeftRef.current;
      const width = trackWidthRef.current || trackWidth;
      if (!canSeek || !Number.isFinite(left) || !width || safeDuration <= 0) {
        return null;
      }

      const relativeX = fingerX - left;
      const percentage = clamp(relativeX / width, 0, 1);
      const seekTime = clamp(percentage * safeDuration, 0, safeDuration);

      if (DEBUG_SEEK) {
        console.log("SeekBar math:", {
          trackLeft: left,
          trackWidth: width,
          fingerX,
          relativeX,
          percentage,
          seekTime,
        });
      }

      return seekTime;
    },
    [canSeek, safeDuration, trackWidth]
  );

  const previewValue = useCallback(
    (value) => {
      const nextValue = clamp(value, 0, safeDuration);
      dragValueRef.current = nextValue;
      setDragValue(nextValue);
      onPreviewChange?.(nextValue, true);
      if (DEBUG_SEEK) console.log("Seek preview:", nextValue);
      return nextValue;
    },
    [onPreviewChange, safeDuration]
  );

  const previewFingerX = useCallback(
    (fingerX) => {
      const nextValue = getValueFromFingerX(fingerX);
      if (nextValue === null) return null;
      return previewValue(nextValue);
    },
    [getValueFromFingerX, previewValue]
  );

  const ensureTrackMeasureThenPreview = useCallback(
    (fingerX) => {
      const nextValue = previewFingerX(fingerX);
      if (nextValue !== null) return;
      updateTrackMeasure(() => previewFingerX(fingerX));
    },
    [previewFingerX, updateTrackMeasure]
  );

  const finishSeek = useCallback(() => {
    if (!canSeek) return;
    const finalValue = clamp(dragValueRef.current, 0, safeDuration);
    setIsDragging(false);
    onPreviewChange?.(finalValue, false);
    onSeek?.(finalValue);
    if (DEBUG_SEEK) console.log("Seek release:", finalValue);
  }, [canSeek, onPreviewChange, onSeek, safeDuration]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => canSeek,
        onMoveShouldSetPanResponder: () => canSeek,
        onPanResponderGrant: (event) => {
          if (!canSeek) return;
          setIsDragging(true);
          ensureTrackMeasureThenPreview(event.nativeEvent.pageX);
          if (DEBUG_SEEK) console.log("Seek start:", event.nativeEvent.pageX);
        },
        onPanResponderMove: (event, gestureState) => {
          if (!canSeek) return;
          ensureTrackMeasureThenPreview(gestureState.moveX);
        },
        onPanResponderRelease: () => {
          finishSeek();
        },
        onPanResponderTerminate: () => {
          finishSeek();
        },
      }),
    [canSeek, ensureTrackMeasureThenPreview, finishSeek]
  );

  return (
    <View
      {...panResponder.panHandlers}
      style={[styles.touchArea, !canSeek && styles.disabled]}
    >
      <View
        ref={trackRef}
        onLayout={(event) => updateTrackWidth(event.nativeEvent.layout.width)}
        style={styles.track}
      >
        <View style={[styles.fill, { width: `${progress * 100}%` }]} />
        <View
          style={[
            styles.thumb,
            {
              left: `${progress * 100}%`,
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

import { useCallback, useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, View } from "react-native";

import { colors } from "../theme";

export default function SeekBar({
  progress = 0,
  onSeek,
  onSeekComplete,
  onSeekPreview,
  onSeekStart,
  height = 8,
  thumbSize = 18,
}) {
  const dragStartProgressRef = useRef(0);
  const trackWidthRef = useRef(0);
  const [trackWidth, setTrackWidth] = useState(0);
  const safeProgress = Math.min(Math.max(progress, 0), 1);

  const updateTrackWidth = useCallback((width) => {
    if (!Number.isFinite(width) || width <= 0) return;
    if (Math.abs(trackWidthRef.current - width) < 1) return;
    trackWidthRef.current = width;
    setTrackWidth(width);
  }, []);

  const getProgressFromLocalX = useCallback(
    (x) => {
      if (!trackWidth) return safeProgress;
      return Math.min(Math.max(x / trackWidth, 0), 1);
    },
    [safeProgress, trackWidth]
  );

  const previewSeek = useCallback(
    (nextProgress) => {
      onSeekPreview?.(nextProgress);
      return nextProgress;
    },
    [onSeekPreview]
  );

  const previewDrag = useCallback(
    (gestureState) => {
      if (!trackWidth) return previewSeek(safeProgress);
      const nextProgress = Math.min(
        Math.max(dragStartProgressRef.current + gestureState.dx / trackWidth, 0),
        1
      );
      return previewSeek(nextProgress);
    },
    [previewSeek, safeProgress, trackWidth]
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          onSeekStart?.();
          const nextProgress = getProgressFromLocalX(event.nativeEvent.locationX);
          dragStartProgressRef.current = nextProgress;
          previewSeek(nextProgress);
        },
        onPanResponderMove: (event, gestureState) => {
          previewDrag(gestureState);
        },
        onPanResponderRelease: (event, gestureState) => {
          const nextProgress = previewDrag(gestureState);
          onSeekComplete?.(nextProgress);
          onSeek?.(nextProgress);
        },
        onPanResponderTerminate: (event, gestureState) => {
          const nextProgress = previewDrag(gestureState);
          onSeekComplete?.(nextProgress);
          onSeek?.(nextProgress);
        },
      }),
    [getProgressFromLocalX, onSeek, onSeekComplete, onSeekStart, previewDrag, previewSeek]
  );

  return (
    <View
      {...panResponder.panHandlers}
      onLayout={(event) => {
        updateTrackWidth(event.nativeEvent.layout.width);
      }}
      style={styles.touchArea}
    >
      <View style={[styles.track, { height, borderRadius: height / 2 }]}>
        <View style={[styles.fill, { width: `${safeProgress * 100}%` }]} />
        <View
          style={[
            styles.thumb,
            {
              height: thumbSize,
              left: `${safeProgress * 100}%`,
              marginLeft: -thumbSize / 2,
              marginTop: -thumbSize / 2,
              top: height / 2,
              width: thumbSize,
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
    minHeight: 44,
    width: "100%",
  },
  track: {
    backgroundColor: colors.border,
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
    borderColor: colors.text,
    borderRadius: 999,
    borderWidth: 2,
    position: "absolute",
  },
});

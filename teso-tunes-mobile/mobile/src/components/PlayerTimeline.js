import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { usePlayerProgress } from "../context/PlayerProgressContext";
import { colors } from "../theme";
import { formatTime } from "../utils/format";
import SeekBar from "./SeekBar";

export default function PlayerTimeline({ onSeek }) {
  const { currentTime, duration } = usePlayerProgress();
  const [preview, setPreview] = useState(null);
  return (
    <View style={styles.block}>
      <SeekBar currentTime={currentTime} duration={duration} onSeek={onSeek}
        onSeekingChange={(seeking, time) => setPreview(seeking ? time : null)} />
      <View style={styles.times}>
        <Text testID="elapsed-time" style={styles.time}>{formatTime(preview ?? currentTime)}</Text>
        <Text style={styles.time}>{formatTime(duration)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { alignSelf: "stretch", marginTop: 24 },
  times: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  time: { color: colors.muted, fontSize: 12, fontWeight: "800" },
});

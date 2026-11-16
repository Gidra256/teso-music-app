import { useState } from "react";
import { Image } from "react-native";
import { resolveAccountAvatarUrl } from "../api/musicApi";

export default function AccountAvatarImage({ avatarUrl, size = 40 }) {
  const [failedUrl, setFailedUrl] = useState("");
  const uri = resolveAccountAvatarUrl(avatarUrl);

  if (!uri || failedUrl === uri) return null;

  return (
    <Image
      key={uri}
      source={{ uri }}
      resizeMode="cover"
      pointerEvents="none"
      onError={() => setFailedUrl(uri)}
      accessibilityLabel="Account profile picture"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: size - 2,
        height: size - 2,
        borderRadius: (size - 2) / 2,
      }}
    />
  );
}

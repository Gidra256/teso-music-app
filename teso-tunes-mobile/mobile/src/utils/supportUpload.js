import { Platform } from "react-native";

export const SUPPORT_ATTACHMENT_LIMIT_BYTES = 8 * 1024 * 1024;

export function pickedAssetName(asset, fallbackName = "support-attachment") {
  return asset?.fileName || asset?.name || asset?.file?.name || fallbackName;
}

export function isSupportAttachmentTooLarge(asset) {
  const size = asset?.size || asset?.fileSize || asset?.file?.size || 0;
  return size > SUPPORT_ATTACHMENT_LIMIT_BYTES;
}

export async function fileFromPickedAsset(
  asset,
  fallbackName = "support-attachment.jpg",
  fallbackType = "image/jpeg",
) {
  const name = pickedAssetName(asset, fallbackName);
  const type = asset?.mimeType || asset?.type || asset?.file?.type || fallbackType;

  if (Platform.OS === "web") {
    if (asset?.file) return asset.file;

    if (asset?.uri) {
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      if (typeof File !== "undefined") {
        return new File([blob], name, { type: blob.type || type });
      }
      return blob;
    }
  }

  return {
    name,
    type,
    uri: asset?.uri,
  };
}

export function appendPickedFile(body, fieldName, file, fallbackName) {
  if (Platform.OS === "web" && typeof Blob !== "undefined" && file instanceof Blob) {
    body.append(fieldName, file, file.name || fallbackName);
    return;
  }

  body.append(fieldName, file);
}

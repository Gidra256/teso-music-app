export const TESOHUB_ARTWORK_PLACEHOLDER = require("../../assets/images/tesohub-music.png");

export function artworkSource(uri) {
  return uri ? { uri } : TESOHUB_ARTWORK_PLACEHOLDER;
}

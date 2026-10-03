export const ONBOARDING_KEY = "tesohub_music_onboarding_v1";
export const ONBOARDING_HISTORY_KEYS = [
  "teso_tunes_auth_listener",
  "teso_tunes_recently_played",
  "teso_tunes_liked_songs",
  "teso_tunes_followed_artists",
];

export function hasPreviousListeningAccount(values) {
  return values.some(([key, value]) => {
    try {
      const parsed = JSON.parse(value || "null");
      if (key === "teso_tunes_auth_listener") return Boolean(parsed?.id);
      return Array.isArray(parsed) && parsed.length > 0;
    } catch {
      return false;
    }
  });
}

export function shouldOfferOnboarding({ routeName, completed, existingUser, dismissed, hasSong }) {
  return routeName === "Home" && !completed && !existingUser && !dismissed && !hasSong;
}

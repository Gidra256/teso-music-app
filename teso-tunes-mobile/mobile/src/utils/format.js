export function formatPlays(count = 0) {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return String(count);
}

export function formatFollowers(count = 0) {
  const safeCount = Number.isFinite(Number(count)) ? Number(count) : 0;
  return `${formatPlays(safeCount)} ${safeCount === 1 ? "follower" : "followers"}`;
}

export function formatTime(seconds = 0) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }

  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

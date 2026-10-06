export function clampPosition(position, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(duration, Math.max(0, Number.isFinite(position) ? position : 0));
}

// Only timeline consumers subscribe. No clock extrapolation: values come from audio.
export function createProgressStore() {
  let snapshot = { currentTime: 0, duration: 0, progress: 0 };
  const listeners = new Set();
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    update(position, duration) {
      duration = Number.isFinite(duration) && duration > 0 ? duration : 0;
      const currentTime = clampPosition(position, duration);
      if (snapshot.currentTime === currentTime && snapshot.duration === duration) return;
      snapshot = { currentTime, duration, progress: duration ? currentTime / duration : 0 };
      listeners.forEach(listener => listener());
    },
  };
}

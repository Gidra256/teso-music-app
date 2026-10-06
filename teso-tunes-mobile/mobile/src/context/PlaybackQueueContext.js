import { createContext, useContext, useSyncExternalStore } from "react";

export const PlaybackQueueContext = createContext(null);

export function useCurrentQueueEntryId() {
  const store = useContext(PlaybackQueueContext);
  const snapshot = () => store.getSnapshot().currentEntry?.id || null;
  return useSyncExternalStore(store.subscribe, snapshot, snapshot);
}

export function usePlaybackQueue() {
  const store = useContext(PlaybackQueueContext);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...state, removeEntry: store.remove, moveEntry: store.move };
}

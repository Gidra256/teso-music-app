import { createContext, useContext, useMemo, useRef, useSyncExternalStore } from "react";

export const PlayerProgressContext = createContext(null);

export function usePlayerProgress() {
  const store = useContext(PlayerProgressContext);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function usePlayerActions(implementation) {
  const latest = useRef(implementation);
  latest.current = implementation;
  return useMemo(() => Object.fromEntries(Object.keys(implementation).map(name =>
    [name, (...args) => latest.current[name](...args)])), []);
}

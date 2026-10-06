import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { AppState } from "react-native";

import { incrementSongPlay } from "../api/musicApi";
import { createProgressStore } from "../utils/playerProgress";
import { createPlaybackQueue, songKey } from "../utils/playbackQueue";
import { PlaybackQueueContext } from "./PlaybackQueueContext";
import { PlayerProgressContext, usePlayerActions } from "./PlayerProgressContext";
export { usePlayerProgress } from "./PlayerProgressContext";

const PlayerContext = createContext(null);
const BACKGROUND_PLAYBACK_KEY = "teso_tunes_background_playback";
const RECENTLY_PLAYED_KEY = "teso_tunes_recently_played";
const RECENTLY_PLAYED_LIMIT = 30;

function compactRecentSong(song) {
  return {
    id: song.id,
    artist: song.artist || song.artist_id || null,
    artist_id: song.artist_id || song.artist || null,
    artist_name: song.artist_name || "",
    audio_file: song.audio_file || "",
    cover_image: song.cover_image || "",
    genre: song.genre || "",
    title: song.title || "Untitled song",
  };
}

export function PlayerProvider({ children }) {
  const soundRef = useRef(null);
  const failedPlayerRef = useRef(null);
  const statusSubscriptionRef = useRef(null);
  const currentSongRef = useRef(null);
  const sourceVersionRef = useRef(0);
  const commandRef = useRef(0);
  const preparingRef = useRef(false);
  const desiredPlayingRef = useRef(false);
  const pendingCommandRef = useRef(null);
  const pendingSeekRef = useRef(null);
  const seekWorkerRef = useRef(null);
  const loadTimerRef = useRef(null);
  const progressStore = useRef(createProgressStore()).current;
  const historyWriteRef = useRef(Promise.resolve());
  const historyRevisionRef = useRef(0);
  const recordedPlayerRef = useRef(null);
  const queueStore = useRef(createPlaybackQueue()).current;
  const finishHandledRef = useRef(false);
  const lastCountedSongIdRef = useRef(null);
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const recentlyPlayedRef = useRef([]);
  const audioModeReadyRef = useRef(false);
  const backgroundPlaybackEnabledRef = useRef(true);
  const [currentSong, setCurrentSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [playbackError, setPlaybackError] = useState("");
  const [didFinish, setDidFinish] = useState(false);
  const [repeatMode, setRepeatMode] = useState("off");
  const [isShuffleOn, setIsShuffleOn] = useState(false);
  const [recentlyPlayed, setRecentlyPlayed] = useState([]);
  const [backgroundPlaybackEnabled, setBackgroundPlaybackEnabledState] = useState(true);

  useEffect(() => {
    loadAudioSettings();
    loadRecentlyPlayed();

    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        syncCurrentPlayerStatus();
      }
    });

    return () => {
      sourceVersionRef.current += 1;
      commandRef.current += 1;
      clearTimeout(loadTimerRef.current);
      appStateSubscription.remove();
      unloadCurrentSound();
    };
  }, []);

  async function loadRecentlyPlayed() {
    const revision = historyRevisionRef.current;
    try {
      const savedSongs = await AsyncStorage.getItem(RECENTLY_PLAYED_KEY);
      const parsedSongs = JSON.parse(savedSongs || "[]");
      const nextSongs = Array.isArray(parsedSongs)
        ? parsedSongs.filter((song) => song?.id).slice(0, RECENTLY_PLAYED_LIMIT)
        : [];
      if (historyRevisionRef.current !== revision) return;
      recentlyPlayedRef.current = nextSongs;
      setRecentlyPlayed(nextSongs);
    } catch (error) {
      if (historyRevisionRef.current !== revision) return;
      recentlyPlayedRef.current = [];
      setRecentlyPlayed([]);
    }
  }

  async function recordRecentlyPlayed(song) {
    if (!song?.id) return;

    historyRevisionRef.current += 1;
    const compactSong = compactRecentSong(song);
    const nextSongs = [
      compactSong,
      ...recentlyPlayedRef.current.filter(
        (item) => Number(item?.id) !== Number(song.id)
      ),
    ].slice(0, RECENTLY_PLAYED_LIMIT);

    recentlyPlayedRef.current = nextSongs;
    setRecentlyPlayed(nextSongs);

    try {
      historyWriteRef.current = historyWriteRef.current.catch(() => {}).then(() =>
        AsyncStorage.setItem(RECENTLY_PLAYED_KEY, JSON.stringify(nextSongs)));
      await historyWriteRef.current;
    } catch (error) {}
  }

  async function loadAudioSettings() {
    try {
      const savedBackgroundPlayback = await AsyncStorage.getItem(BACKGROUND_PLAYBACK_KEY);
      const nextBackgroundPlayback = savedBackgroundPlayback === null
        ? true
        : savedBackgroundPlayback === "true";

      backgroundPlaybackEnabledRef.current = nextBackgroundPlayback;
      setBackgroundPlaybackEnabledState(nextBackgroundPlayback);
      await configureAudioSession(nextBackgroundPlayback);
    } catch (error) {
      await configureAudioSession(backgroundPlaybackEnabledRef.current);
    }
  }

  async function configureAudioSession(backgroundPlayback = backgroundPlaybackEnabledRef.current) {
    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: Boolean(backgroundPlayback),
        interruptionMode: "doNotMix",
      });
      audioModeReadyRef.current = true;
    } catch (error) {
      audioModeReadyRef.current = false;
    }
  }

  function clearStatusSubscription() {
    if (statusSubscriptionRef.current?.remove) {
      statusSubscriptionRef.current.remove();
    }
    statusSubscriptionRef.current = null;
  }

  function unloadCurrentSound() {
    clearTimeout(loadTimerRef.current);
    pendingSeekRef.current = null;
    seekWorkerRef.current = null;
    clearStatusSubscription();

    if (soundRef.current) {
      clearLockScreenControls(soundRef.current);
      try {
        soundRef.current.pause();
      } catch (error) {}
      try {
        soundRef.current.remove();
      } catch (error) {}
    }

    soundRef.current = null;
    currentTimeRef.current = 0;
    durationRef.current = 0;
    setIsPlaying(false);
    progressStore.update(0, 0);
    setDidFinish(false);
  }

  function setSafeCurrentTime(seconds) {
    const safeDuration = durationRef.current;
    const safeTime = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    const clampedTime =
      safeDuration > 0 ? Math.min(safeTime, safeDuration) : safeTime;
    currentTimeRef.current = clampedTime;
    progressStore.update(clampedTime, durationRef.current);
  }

  function currentStatusFor(player) {
    if (!player) return null;
    if (player.currentStatus) return player.currentStatus;
    return {
      currentTime: player.currentTime,
      duration: player.duration,
      isLoaded: player.isLoaded,
      playing: player.playing,
      didJustFinish: false,
    };
  }

  function syncCurrentPlayerStatus() {
    const player = soundRef.current;
    if (!player) return;
    syncPlaybackStatus(currentStatusFor(player));
  }

  function setUnsafeCurrentTimeForReset(seconds) {
    const safeTime = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    currentTimeRef.current = safeTime;
    progressStore.update(safeTime, durationRef.current);
  }

  function setSafeDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return durationRef.current;
    }

    durationRef.current = seconds;
    progressStore.update(currentTimeRef.current, seconds);
    return seconds;
  }

  function handleSongFinished() {
    const player = soundRef.current;
    if (queueStore.getSnapshot().repeatMode === "one" && player?.seekTo) {
      const command = commandRef.current;
      seekTo(0).then(() => {
        if (player !== soundRef.current || command !== commandRef.current) return;
        setSafeCurrentTime(0);
        setDidFinish(false);
        finishHandledRef.current = false;
        player.play();
        desiredPlayingRef.current = true;
        setIsPlaying(true);
      }).catch(() => {});
      return;
    }

    const next = queueStore.advance(1, true);
    if (next) playEntry(next);
    else {
      pendingCommandRef.current = null;
      desiredPlayingRef.current = false;
      setIsPlaying(false);
      setIsBuffering(false);
    }
  }

  function syncPlaybackStatus(status) {
    const player = soundRef.current;
    if (!player || !status) return;
    if (failedPlayerRef.current === player) return;
    if (status.playbackState === "error" || status.error) {
      failPlayback();
      return;
    }
    if (!status?.isLoaded) {
      setIsBuffering(desiredPlayingRef.current);
      return;
    }
    clearTimeout(loadTimerRef.current);
    setIsBuffering(Boolean(status.isBuffering) && desiredPlayingRef.current);

    const previousTime = currentTimeRef.current;
    const nextDuration = Number.isFinite(status.duration)
      ? Math.max(0, status.duration)
      : durationRef.current;
    const safeDuration = setSafeDuration(nextDuration);
    const nextTime = Number.isFinite(status.currentTime)
      ? Math.max(0, Math.min(status.currentTime, safeDuration || status.currentTime))
      : currentTimeRef.current;

    const pending = pendingCommandRef.current;
    if (!pending || Boolean(status.playing) === pending.playing || Date.now() > pending.until) {
      pendingCommandRef.current = null;
      desiredPlayingRef.current = Boolean(status.playing) && !status.didJustFinish;
      setIsPlaying(desiredPlayingRef.current);
    }
    const seek = pendingSeekRef.current;
    if (!seek || (!seek.inFlight && (Math.abs(nextTime - seek.target) < 0.75 || Date.now() > seek.until))) {
      if (seek) pendingSeekRef.current = null;
      setSafeCurrentTime(nextTime);
    }
    if (!seek && status.playing && !status.isBuffering && nextTime > previousTime && recordedPlayerRef.current !== player) {
      recordedPlayerRef.current = player;
      recordRecentlyPlayed(currentSongRef.current);
      recordPlayCount(currentSongRef.current);
    }
    setDidFinish(!seek && Boolean(status.didJustFinish));

    if (!seek && status.didJustFinish && !finishHandledRef.current) {
      finishHandledRef.current = true;
      const command = commandRef.current;
      setTimeout(() => {
        if (player === soundRef.current && command === commandRef.current) handleSongFinished();
      }, 0);
    }
  }

  function failPlayback() {
    if (soundRef.current && failedPlayerRef.current === soundRef.current) return;
    failedPlayerRef.current = soundRef.current;
    pendingCommandRef.current = null;
    desiredPlayingRef.current = false;
    setIsPlaying(false);
    setIsBuffering(false);
    setPlaybackError("Could not play this song. Please try again.");
    try { soundRef.current?.pause(); } catch {}
  }

  function recordPlayCount(song) {
    const songId = song?.id;
    if (!songId || lastCountedSongIdRef.current === songId) return;

    lastCountedSongIdRef.current = songId;
    incrementSongPlay(songId).catch(() => {});
  }

  async function ensureAudioSessionReady() {
    if (!audioModeReadyRef.current) {
      await configureAudioSession();
    }
  }

  function activateLockScreenControls(player, song) {
    if (!backgroundPlaybackEnabledRef.current) return;
    if (!player?.setActiveForLockScreen) return;

    try {
      player.setActiveForLockScreen(
        true,
        {
          title: song?.title || "TesoHub Music",
          artist: song?.artist_name || "TesoHub Music",
          albumTitle: "TesoHub Music",
          artworkUrl: song?.cover_image || undefined,
        },
        {
          showSeekForward: true,
          showSeekBackward: true,
        }
      );
    } catch (error) {}
  }

  function clearLockScreenControls(player) {
    try {
      if (player?.clearLockScreenControls) {
        player.clearLockScreenControls();
      } else if (player?.setActiveForLockScreen) {
        player.setActiveForLockScreen(false);
      }
    } catch (error) {}
  }

  function playEntry(entry) { if (entry) return playSong(entry.song, [], entry.id); }
  function playQueueEntry(id) { return playEntry(queueStore.select(id)); }
  function playNextSong() { return playEntry(queueStore.advance(1)); }
  function playPreviousSong() { return playEntry(queueStore.advance(-1)); }
  function playNext(song) { return queueStore.enqueue(song, true); }
  function addToQueue(song) { return queueStore.enqueue(song); }

  async function playSong(song, queue = [], entryId = null) {
    if (!song) return;
    if (!entryId && songKey(song) === songKey(currentSongRef.current) && (preparingRef.current || (desiredPlayingRef.current && soundRef.current && failedPlayerRef.current !== soundRef.current))) return;
    if (!entryId) queueStore.start(song, queue);
    const sourceVersion = ++sourceVersionRef.current;
    commandRef.current += 1;
    unloadCurrentSound();
    preparingRef.current = true;
    desiredPlayingRef.current = true;
    pendingCommandRef.current = null;
    setCurrentSong(song);
    currentSongRef.current = song;
    finishHandledRef.current = false;
    setIsPlaying(true);
    setIsBuffering(true);
    setPlaybackError("");
    currentTimeRef.current = 0;
    durationRef.current = 0;
    setUnsafeCurrentTimeForReset(0);
    progressStore.update(0, 0);
    setDidFinish(false);

    if (!song?.audio_file) {
      preparingRef.current = false;
      desiredPlayingRef.current = false;
      setIsBuffering(false);
      setIsPlaying(false);
      setPlaybackError("This song has no playable audio.");
      return;
    }

    try {
      await ensureAudioSessionReady();
      if (sourceVersion !== sourceVersionRef.current) return;
      const player = createAudioPlayer(
        { uri: song.audio_file },
        { updateInterval: 100, keepAudioSessionActive: true }
      );
      soundRef.current = player;

      if (player.addListener) {
        statusSubscriptionRef.current = player.addListener("playbackStatusUpdate", status => {
          if (player === soundRef.current) syncPlaybackStatus(status);
        });
      }

      activateLockScreenControls(player, song);
      pendingCommandRef.current = { playing: desiredPlayingRef.current, until: Date.now() + 2000 };
      if (desiredPlayingRef.current) player.play();
      loadTimerRef.current = setTimeout(() => {
        if (player === soundRef.current && !currentStatusFor(player)?.isLoaded) failPlayback();
      }, 30000);
      syncPlaybackStatus(currentStatusFor(player));
    } catch (error) {
      if (sourceVersion === sourceVersionRef.current) failPlayback();
    } finally {
      if (sourceVersion === sourceVersionRef.current) preparingRef.current = false;
    }
  }

  function isPlayerAtEnd(player) {
    const status = player.currentStatus;
    const statusDuration = Number.isFinite(status?.duration)
      ? status.duration
      : durationRef.current;
    const statusTime = Number.isFinite(status?.currentTime)
      ? status.currentTime
      : currentTimeRef.current;
    return Boolean(status?.didJustFinish || finishHandledRef.current || (statusDuration > 0 && statusTime >= statusDuration));
  }

  function clampTime(seconds) {
    if (!Number.isFinite(seconds)) return 0;
    const safeDuration = durationRef.current;
    if (safeDuration <= 0) return Math.max(0, seconds);
    return Math.min(Math.max(0, seconds), safeDuration);
  }

  async function seekTo(seconds) {
    const player = soundRef.current;
    const statusDuration = Number.isFinite(player?.currentStatus?.duration)
      ? player.currentStatus.duration
      : durationRef.current;
    const safeDuration = Math.max(0, statusDuration);
    if (!player?.seekTo || safeDuration <= 0 || !Number.isFinite(safeDuration)) return;

    const nextTime = clampTime(seconds);
    pendingSeekRef.current = { target: nextTime, inFlight: true, until: Date.now() + 2000 };
    setSafeCurrentTime(nextTime);
    setDidFinish(false);
    finishHandledRef.current = false;
    if (seekWorkerRef.current?.player === player) return seekWorkerRef.current.promise;
    const worker = { player, promise: null };
    seekWorkerRef.current = worker;
    worker.promise = runSeekWorker();
    return worker.promise;

    async function runSeekWorker() {
    try {
      while (player === soundRef.current && pendingSeekRef.current?.inFlight) {
        const request = pendingSeekRef.current;
        await player.seekTo(request.target);
        if (player !== soundRef.current) return;
        if (request === pendingSeekRef.current) {
          request.inFlight = false;
          request.until = Date.now() + 2000;
          syncPlaybackStatus(currentStatusFor(player));
        }
      }
    } catch (error) {
      if (player === soundRef.current) {
        pendingSeekRef.current = null;
        syncPlaybackStatus(currentStatusFor(player));
        setPlaybackError("Could not seek in this song. Please try again.");
      }
    } finally {
      if (seekWorkerRef.current === worker) seekWorkerRef.current = null;
    }
    }
  }

  function seekBy(seconds) {
    seekTo(currentTimeRef.current + seconds);
  }

  async function togglePlay() {
    if (!currentSongRef.current) return;
    const playing = !desiredPlayingRef.current;
    const command = ++commandRef.current;
    desiredPlayingRef.current = playing;
    pendingCommandRef.current = { playing, until: Date.now() + 2000 };
    setIsPlaying(playing);
    setPlaybackError("");
    if (!playing) setIsBuffering(false);
    const player = soundRef.current;
    if (!player) {
      if (playing && !preparingRef.current) retryPlayback();
      return;
    }
    try {
      if (!playing) {
        player.pause();
        setIsPlaying(false);
      } else {
        if (isPlayerAtEnd(player) && player.seekTo) {
          await seekTo(0);
          if (player !== soundRef.current || command !== commandRef.current) return;
          setSafeCurrentTime(0);
          setDidFinish(false);
          finishHandledRef.current = false;
        }
        activateLockScreenControls(player, currentSongRef.current);
        player.play();
        setIsPlaying(true);
        setDidFinish(false);
      }
    } catch (error) {
      if (player === soundRef.current && command === commandRef.current) failPlayback();
    }
  }

  function retryPlayback() { return playEntry(queueStore.getSnapshot().currentEntry); }

  function toggleRepeat() {
    setRepeatMode(queueStore.toggleRepeat());
  }

  function toggleShuffle() {
    setIsShuffleOn(queueStore.toggleShuffle());
  }

  async function setBackgroundPlaybackEnabled(enabled) {
    const nextEnabled = Boolean(enabled);
    backgroundPlaybackEnabledRef.current = nextEnabled;
    setBackgroundPlaybackEnabledState(nextEnabled);

    try {
      await AsyncStorage.setItem(
        BACKGROUND_PLAYBACK_KEY,
        nextEnabled ? "true" : "false"
      );
    } catch (error) {}

    await configureAudioSession(nextEnabled);

    if (nextEnabled) {
      activateLockScreenControls(soundRef.current, currentSongRef.current);
    } else {
      clearLockScreenControls(soundRef.current);
    }
  }

  const actions = usePlayerActions({ playNextSong, playPreviousSong, playSong, playQueueEntry, playNext, addToQueue, seekBy, seekTo, setBackgroundPlaybackEnabled, togglePlay, toggleRepeat, toggleShuffle, retryPlayback });
  const value = useMemo(
    () => ({
      backgroundPlaybackEnabled,
      currentSong,
      isBuffering,
      playbackError,
      didFinish,
      isPlaying,
      isRepeatOn: repeatMode !== "off",
      repeatMode,
      isShuffleOn,
      ...actions,
      recentlyPlayed,
    }),
    [
      backgroundPlaybackEnabled,
      currentSong,
      isBuffering,
      playbackError,
      didFinish,
      isPlaying,
      repeatMode,
      isShuffleOn,
      recentlyPlayed,
    ]
  );

  return <PlayerContext.Provider value={value}><PlaybackQueueContext.Provider value={queueStore}><PlayerProgressContext.Provider value={progressStore}>{children}</PlayerProgressContext.Provider></PlaybackQueueContext.Provider></PlayerContext.Provider>;
}

export function usePlayer() {
  return useContext(PlayerContext);
}

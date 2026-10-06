import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import { incrementSongPlay } from "../api/musicApi";
import { createProgressStore } from "../utils/playerProgress";
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

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function clampTime(value, duration) {
  const safeTime = Math.max(0, safeNumber(value));
  return duration > 0 ? Math.min(safeTime, duration) : safeTime;
}

export function PlayerProvider({ children }) {
  const audioRef = useRef(null);
  const cleanupAudioEventsRef = useRef(null);
  const currentSongRef = useRef(null);
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const finishHandledRef = useRef(false);
  const commandRef = useRef(0);
  const desiredPlayingRef = useRef(false);
  const pendingPlayRef = useRef(null);
  const progressStore = useRef(createProgressStore()).current;
  const historyWriteRef = useRef(Promise.resolve());
  const historyRevisionRef = useRef(0);
  const recordedAudioRef = useRef(null);
  const lastCountedSongIdRef = useRef(null);
  const queueRef = useRef([]);
  const recentlyPlayedRef = useRef([]);
  const repeatRef = useRef(false);
  const shuffleRef = useRef(false);
  const [backgroundPlaybackEnabled, setBackgroundPlaybackEnabledState] = useState(true);
  const [currentSong, setCurrentSong] = useState(null);
  const [didFinish, setDidFinish] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [playbackError, setPlaybackError] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRepeatOn, setIsRepeatOn] = useState(false);
  const [isShuffleOn, setIsShuffleOn] = useState(false);
  const [recentlyPlayed, setRecentlyPlayed] = useState([]);

  useEffect(() => {
    loadAudioSettings();
    loadRecentlyPlayed();
    configureMediaSessionHandlers();

    return () => {
      commandRef.current += 1;
      clearMediaSessionHandlers();
      unloadCurrentAudio();
    };
  }, []);

  async function loadAudioSettings() {
    try {
      const savedBackgroundPlayback = await AsyncStorage.getItem(BACKGROUND_PLAYBACK_KEY);
      const nextBackgroundPlayback =
        savedBackgroundPlayback === null ? true : savedBackgroundPlayback === "true";
      setBackgroundPlaybackEnabledState(nextBackgroundPlayback);
    } catch (error) {
      setBackgroundPlaybackEnabledState(true);
    }
  }

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
        (item) => Number(item?.id) !== Number(song.id),
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

  function setSafeDuration(seconds) {
    const nextDuration = safeNumber(seconds);
    const safeDuration = nextDuration > 0 ? nextDuration : 0;
    durationRef.current = safeDuration;
    progressStore.update(currentTimeRef.current, safeDuration);
    return safeDuration;
  }

  function setSafeCurrentTime(seconds) {
    const nextTime = clampTime(seconds, durationRef.current);
    currentTimeRef.current = nextTime;
    progressStore.update(nextTime, durationRef.current);
    return nextTime;
  }

  function syncFromAudio(audio = audioRef.current) {
    if (!audio || audio !== audioRef.current) return;

    const previousTime = currentTimeRef.current;
    const nextDuration = setSafeDuration(safeNumber(audio.duration));
    setSafeCurrentTime(clampTime(audio.currentTime, nextDuration));
    if (!pendingPlayRef.current) {
      desiredPlayingRef.current = !audio.paused && !audio.ended;
      setIsPlaying(desiredPlayingRef.current);
    }
    setDidFinish(Boolean(audio.ended));
    if (!audio.paused && !audio.seeking && audio.readyState >= 3 && audio.currentTime > previousTime && recordedAudioRef.current !== audio) {
      recordedAudioRef.current = audio;
      recordRecentlyPlayed(currentSongRef.current);
      recordPlayCount(currentSongRef.current);
    }
  }

  function clearAudioEvents() {
    if (cleanupAudioEventsRef.current) {
      cleanupAudioEventsRef.current();
    }
    cleanupAudioEventsRef.current = null;
  }

  function attachAudioEvents(audio) {
    let frame = null;
    const sample = () => {
      if (audio !== audioRef.current) return;
      syncFromAudio(audio);
      if (!audio.paused && !audio.ended) frame = requestAnimationFrame(sample);
    };
    const handleProgress = () => syncFromAudio(audio);
    const handlePlaying = () => {
      if (audio !== audioRef.current) return;
      setIsBuffering(false);
      setPlaybackError("");
      if (frame !== null) cancelAnimationFrame(frame);
      sample();
    };
    const handleWaiting = () => { if (audio === audioRef.current) setIsBuffering(desiredPlayingRef.current); };
    const handleEnded = () => {
      if (audio !== audioRef.current) return;
      pendingPlayRef.current = null;
      desiredPlayingRef.current = false;
      syncFromAudio(audio);
      if (!finishHandledRef.current) {
        finishHandledRef.current = true;
        handleSongFinished();
      }
    };
    const handleError = () => {
      if (audio !== audioRef.current) return;
      pendingPlayRef.current = null;
      desiredPlayingRef.current = false;
      audio.pause();
      setIsPlaying(false);
      setIsBuffering(false);
      setPlaybackError("Could not play this song. Please try again.");
      setDidFinish(false);
    };

    const listeners = [
      ["durationchange", handleProgress],
      ["ended", handleEnded],
      ["error", handleError],
      ["loadedmetadata", handleProgress],
      ["pause", handleProgress],
      ["play", handleProgress],
      ["playing", handlePlaying],
      ["waiting", handleWaiting],
      ["seeked", handleProgress],
      ["timeupdate", handleProgress],
    ];

    listeners.forEach(([eventName, handler]) => {
      audio.addEventListener(eventName, handler);
    });

    cleanupAudioEventsRef.current = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      listeners.forEach(([eventName, handler]) => {
        audio.removeEventListener(eventName, handler);
      });
    };
  }

  function unloadCurrentAudio() {
    clearAudioEvents();

    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.removeAttribute("src");
        audioRef.current.load();
      } catch (error) {}
    }

    audioRef.current = null;
    currentTimeRef.current = 0;
    durationRef.current = 0;
    setIsPlaying(false);
    progressStore.update(0, 0);
    setDidFinish(false);
  }

  function recordPlayCount(song) {
    const songId = song?.id;
    if (!songId || lastCountedSongIdRef.current === songId) return;

    lastCountedSongIdRef.current = songId;
    incrementSongPlay(songId).catch(() => {});
  }

  function findCurrentQueueIndex() {
    const currentId = currentSongRef.current?.id;
    return queueRef.current.findIndex((song) => Number(song?.id) === Number(currentId));
  }

  function playQueueSongAt(index) {
    const queue = queueRef.current;
    if (!Array.isArray(queue) || queue.length === 0) return;

    const safeIndex = (index + queue.length) % queue.length;
    const nextSong = queue[safeIndex];
    if (nextSong) {
      playSong(nextSong, queue);
    }
  }

  function playNextSong() {
    if (shuffleRef.current && queueRef.current.length > 1) {
      const alternatives = queueRef.current.filter(song => Number(song.id) !== Number(currentSongRef.current?.id));
      if (alternatives.length) playSong(alternatives[Math.floor(Math.random() * alternatives.length)], queueRef.current);
      return;
    }
    const index = findCurrentQueueIndex();
    if (index < 0) return;
    playQueueSongAt(index + 1);
  }

  function playPreviousSong() {
    const index = findCurrentQueueIndex();
    if (index < 0) return;
    playQueueSongAt(index - 1);
  }

  function handleSongFinished() {
    const audio = audioRef.current;

    if (repeatRef.current && audio) {
      audio.currentTime = 0;
      setSafeCurrentTime(0);
      setDidFinish(false);
      finishHandledRef.current = false;
      setPlayback(true);
      return;
    }

    if (shuffleRef.current && queueRef.current.length > 1) {
      const nextSongs = queueRef.current.filter(
        (song) => Number(song?.id) !== Number(currentSongRef.current?.id),
      );
      const nextSong = nextSongs[Math.floor(Math.random() * nextSongs.length)];
      if (nextSong) {
        playSong(nextSong, queueRef.current);
      }
      return;
    }

    setIsPlaying(false);
  }

  function updateMediaSession(song) {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    if (typeof window === "undefined" || typeof window.MediaMetadata === "undefined") return;

    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        album: "TesoHub Music",
        artist: song?.artist_name || "TesoHub Music",
        artwork: song?.cover_image
          ? [
              {
                sizes: "512x512",
                src: song.cover_image,
                type: "image/png",
              },
            ]
          : [],
        title: song?.title || "TesoHub Music",
      });
    } catch (error) {}
  }

  function configureMediaSessionHandlers() {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;

    try {
      navigator.mediaSession.setActionHandler("play", () => setPlayback(true));
      navigator.mediaSession.setActionHandler("pause", () => setPlayback(false));
      navigator.mediaSession.setActionHandler("previoustrack", () => playPreviousSong());
      navigator.mediaSession.setActionHandler("nexttrack", () => playNextSong());
      navigator.mediaSession.setActionHandler("seekbackward", () => seekBy(-10));
      navigator.mediaSession.setActionHandler("seekforward", () => seekBy(10));
      navigator.mediaSession.setActionHandler("seekto", (details) => {
        if (Number.isFinite(details.seekTime)) {
          seekTo(details.seekTime);
        }
      });
    } catch (error) {}
  }

  function clearMediaSessionHandlers() {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;

    try {
      [
        "nexttrack",
        "pause",
        "play",
        "previoustrack",
        "seekbackward",
        "seekforward",
        "seekto",
      ].forEach((action) => navigator.mediaSession.setActionHandler(action, null));
      navigator.mediaSession.metadata = null;
    } catch (error) {}
  }

  async function playSong(song, queue = []) {
    if (!song) return;
    if (Number(song.id) === Number(currentSongRef.current?.id) && audioRef.current && desiredPlayingRef.current && (pendingPlayRef.current || (!audioRef.current.paused && !audioRef.current.ended))) return;
    commandRef.current += 1;
    pendingPlayRef.current = null;
    unloadCurrentAudio();
    setCurrentSong(song);
    currentSongRef.current = song;
    finishHandledRef.current = false;
    if (Array.isArray(queue) && queue.length > 0) {
      queueRef.current = queue;
    } else if (!queueRef.current.some(item => Number(item.id) === Number(song.id))) {
      queueRef.current = [song];
    }
    currentTimeRef.current = 0;
    durationRef.current = 0;
    progressStore.update(0, 0);
    setDidFinish(false);
    setPlaybackError("");

    if (!song?.audio_file) {
      desiredPlayingRef.current = false;
      setIsBuffering(false);
      setPlaybackError("This song has no playable audio.");
      return;
    }

    try {
      const audio = new Audio(song.audio_file);
      audio.preload = "metadata";
      audioRef.current = audio;
      attachAudioEvents(audio);
      updateMediaSession(song);

      await setPlayback(true);
    } catch (error) {
      setIsPlaying(false);
      setIsBuffering(false);
      setPlaybackError("Could not play this song. Please try again.");
    }
  }

  async function seekTo(seconds) {
    const audio = audioRef.current;
    if (!audio) return;

    const safeDuration = durationRef.current;
    if (safeDuration <= 0) return;

    const nextTime = clampTime(seconds, safeDuration);
    try {
      audio.currentTime = nextTime;
      setSafeCurrentTime(nextTime);
      setDidFinish(false);
      finishHandledRef.current = false;
    } catch (error) {
      syncFromAudio(audio);
      setPlaybackError("Could not seek in this song. Please try again.");
    }
  }

  function seekBy(seconds) {
    seekTo(currentTimeRef.current + seconds);
  }

  async function setPlayback(playing) {
    if (!currentSongRef.current) return;

    const audio = audioRef.current;
    if (!audio) {
      if (playing) playSong(currentSongRef.current, queueRef.current);
      return;
    }
    if (playing && pendingPlayRef.current && desiredPlayingRef.current) return;
    const command = ++commandRef.current;
    desiredPlayingRef.current = playing;
    pendingPlayRef.current = playing ? command : null;
    setIsPlaying(playing);
    setIsBuffering(playing && audio.readyState < 3);
    setPlaybackError("");
    if (!playing) {
      audio.pause();
      syncFromAudio(audio);
      return;
    }
    try {
      if (audio.ended) {
        audio.currentTime = 0;
        setSafeCurrentTime(0);
        setDidFinish(false);
        finishHandledRef.current = false;
      }
      await audio.play();
      if (audio !== audioRef.current || command !== commandRef.current) return;
      pendingPlayRef.current = null;
      setIsBuffering(false);
      syncFromAudio(audio);
    } catch (error) {
      if (audio !== audioRef.current || command !== commandRef.current) return;
      pendingPlayRef.current = null;
      desiredPlayingRef.current = false;
      setIsPlaying(false);
      setIsBuffering(false);
      setPlaybackError("Could not play this song. Please try again.");
    }
  }

  function togglePlay() { return setPlayback(!desiredPlayingRef.current); }
  function retryPlayback() { return playSong(currentSongRef.current, queueRef.current); }

  function toggleRepeat() {
    setIsRepeatOn((value) => {
      repeatRef.current = !value;
      return !value;
    });
  }

  function toggleShuffle() {
    setIsShuffleOn((value) => {
      shuffleRef.current = !value;
      return !value;
    });
  }

  async function setBackgroundPlaybackEnabled(enabled) {
    const nextEnabled = Boolean(enabled);
    setBackgroundPlaybackEnabledState(nextEnabled);

    try {
      await AsyncStorage.setItem(
        BACKGROUND_PLAYBACK_KEY,
        nextEnabled ? "true" : "false",
      );
    } catch (error) {}
  }

  const actions = usePlayerActions({ playNextSong, playPreviousSong, playSong, seekBy, seekTo, setBackgroundPlaybackEnabled, togglePlay, toggleRepeat, toggleShuffle, retryPlayback });
  const value = useMemo(
    () => ({
      backgroundPlaybackEnabled,
      currentSong,
      didFinish,
      isBuffering,
      playbackError,
      isPlaying,
      isRepeatOn,
      isShuffleOn,
      ...actions,
      recentlyPlayed,
    }),
    [
      backgroundPlaybackEnabled,
      currentSong,
      didFinish,
      isBuffering,
      playbackError,
      isPlaying,
      isRepeatOn,
      isShuffleOn,
      recentlyPlayed,
    ],
  );

  return <PlayerContext.Provider value={value}><PlayerProgressContext.Provider value={progressStore}>{children}</PlayerProgressContext.Provider></PlayerContext.Provider>;
}

export function usePlayer() {
  return useContext(PlayerContext);
}

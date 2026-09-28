import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import { incrementSongPlay } from "../api/musicApi";

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
  const isBusyRef = useRef(false);
  const lastCountedSongIdRef = useRef(null);
  const queueRef = useRef([]);
  const recentlyPlayedRef = useRef([]);
  const repeatRef = useRef(false);
  const shuffleRef = useRef(false);
  const [backgroundPlaybackEnabled, setBackgroundPlaybackEnabledState] = useState(true);
  const [currentSong, setCurrentSong] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [didFinish, setDidFinish] = useState(false);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRepeatOn, setIsRepeatOn] = useState(false);
  const [isShuffleOn, setIsShuffleOn] = useState(false);
  const [recentlyPlayed, setRecentlyPlayed] = useState([]);

  useEffect(() => {
    loadAudioSettings();
    loadRecentlyPlayed();
    configureMediaSessionHandlers();

    return () => {
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
    try {
      const savedSongs = await AsyncStorage.getItem(RECENTLY_PLAYED_KEY);
      const parsedSongs = JSON.parse(savedSongs || "[]");
      const nextSongs = Array.isArray(parsedSongs)
        ? parsedSongs.filter((song) => song?.id).slice(0, RECENTLY_PLAYED_LIMIT)
        : [];
      recentlyPlayedRef.current = nextSongs;
      setRecentlyPlayed(nextSongs);
    } catch (error) {
      recentlyPlayedRef.current = [];
      setRecentlyPlayed([]);
    }
  }

  async function recordRecentlyPlayed(song) {
    if (!song?.id) return;

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
      await AsyncStorage.setItem(RECENTLY_PLAYED_KEY, JSON.stringify(nextSongs));
    } catch (error) {}
  }

  function setSafeDuration(seconds) {
    const nextDuration = safeNumber(seconds);
    const safeDuration = nextDuration > 0 ? nextDuration : 0;
    durationRef.current = safeDuration;
    setDuration(safeDuration);
    return safeDuration;
  }

  function setSafeCurrentTime(seconds) {
    const nextTime = clampTime(seconds, durationRef.current);
    currentTimeRef.current = nextTime;
    setCurrentTime(nextTime);
    return nextTime;
  }

  function syncFromAudio(audio = audioRef.current) {
    if (!audio) return;

    const nextDuration = setSafeDuration(safeNumber(audio.duration));
    setSafeCurrentTime(clampTime(audio.currentTime, nextDuration));
    setIsPlaying(!audio.paused && !audio.ended);
    setDidFinish(Boolean(audio.ended));
  }

  function clearAudioEvents() {
    if (cleanupAudioEventsRef.current) {
      cleanupAudioEventsRef.current();
    }
    cleanupAudioEventsRef.current = null;
  }

  function attachAudioEvents(audio) {
    const handleProgress = () => syncFromAudio(audio);
    const handleEnded = () => {
      syncFromAudio(audio);
      if (!finishHandledRef.current) {
        finishHandledRef.current = true;
        handleSongFinished();
      }
    };
    const handleError = () => {
      setIsPlaying(false);
      setDidFinish(false);
    };

    const listeners = [
      ["durationchange", handleProgress],
      ["ended", handleEnded],
      ["error", handleError],
      ["loadedmetadata", handleProgress],
      ["pause", handleProgress],
      ["play", handleProgress],
      ["timeupdate", handleProgress],
    ];

    listeners.forEach(([eventName, handler]) => {
      audio.addEventListener(eventName, handler);
    });

    cleanupAudioEventsRef.current = () => {
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
    setCurrentTime(0);
    setDuration(0);
    setDidFinish(false);
  }

  function releaseBusySoon() {
    setTimeout(() => {
      isBusyRef.current = false;
    }, 180);
  }

  function recordPlayCount(song) {
    const songId = song?.id;
    if (!songId || lastCountedSongIdRef.current === songId) return;

    lastCountedSongIdRef.current = songId;
    incrementSongPlay(songId);
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
      audio.play().catch(() => setIsPlaying(false));
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
      navigator.mediaSession.setActionHandler("play", () => togglePlay());
      navigator.mediaSession.setActionHandler("pause", () => togglePlay());
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
    if (!song || isBusyRef.current) return;

    isBusyRef.current = true;
    setCurrentSong(song);
    currentSongRef.current = song;
    finishHandledRef.current = false;
    if (Array.isArray(queue) && queue.length > 0) {
      queueRef.current = queue;
    } else if (queueRef.current.length === 0) {
      queueRef.current = [song];
    }
    currentTimeRef.current = 0;
    durationRef.current = 0;
    setCurrentTime(0);
    setDuration(0);
    setDidFinish(false);
    setIsPlaying(false);

    if (!song?.audio_file) {
      releaseBusySoon();
      return;
    }

    try {
      unloadCurrentAudio();
      const audio = new Audio(song.audio_file);
      audio.preload = "metadata";
      audioRef.current = audio;
      attachAudioEvents(audio);
      updateMediaSession(song);

      await audio.play();
      setIsPlaying(true);
      recordPlayCount(song);
      recordRecentlyPlayed(song);
      syncFromAudio(audio);
    } catch (error) {
      setIsPlaying(false);
    } finally {
      releaseBusySoon();
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
    } catch (error) {}
  }

  function seekBy(seconds) {
    seekTo(currentTimeRef.current + seconds);
  }

  async function togglePlay() {
    if (!currentSongRef.current) return;

    const audio = audioRef.current;
    if (!audio) {
      playSong(currentSongRef.current, queueRef.current);
      return;
    }

    if (!audio.paused && !audio.ended) {
      audio.pause();
      setIsPlaying(false);
      syncFromAudio(audio);
      return;
    }

    if (isBusyRef.current) return;

    isBusyRef.current = true;
    try {
      if (audio.ended || didFinish) {
        audio.currentTime = 0;
        setSafeCurrentTime(0);
        setDidFinish(false);
        finishHandledRef.current = false;
      }
      await audio.play();
      setIsPlaying(true);
      syncFromAudio(audio);
    } catch (error) {
      setIsPlaying(false);
    } finally {
      releaseBusySoon();
    }
  }

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

  const value = useMemo(
    () => ({
      backgroundPlaybackEnabled,
      currentSong,
      currentTime,
      didFinish,
      duration,
      isPlaying,
      isRepeatOn,
      isShuffleOn,
      playNextSong,
      playPreviousSong,
      playSong,
      progress:
        duration > 0 && Number.isFinite(currentTime)
          ? Math.min(Math.max(currentTime / duration, 0), 1)
          : 0,
      recentlyPlayed,
      seekBy,
      seekTo,
      setBackgroundPlaybackEnabled,
      togglePlay,
      toggleRepeat,
      toggleShuffle,
    }),
    [
      backgroundPlaybackEnabled,
      currentSong,
      currentTime,
      didFinish,
      duration,
      isPlaying,
      isRepeatOn,
      isShuffleOn,
      recentlyPlayed,
    ],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
  return useContext(PlayerContext);
}

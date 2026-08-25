import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { AppState } from "react-native";

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

export function PlayerProvider({ children }) {
  const soundRef = useRef(null);
  const statusSubscriptionRef = useRef(null);
  const currentSongRef = useRef(null);
  const isBusyRef = useRef(false);
  const queueRef = useRef([]);
  const repeatRef = useRef(false);
  const shuffleRef = useRef(false);
  const finishHandledRef = useRef(false);
  const lastCountedSongIdRef = useRef(null);
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const recentlyPlayedRef = useRef([]);
  const audioModeReadyRef = useRef(false);
  const backgroundPlaybackEnabledRef = useRef(true);
  const [currentSong, setCurrentSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [didFinish, setDidFinish] = useState(false);
  const [isRepeatOn, setIsRepeatOn] = useState(false);
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
      appStateSubscription.remove();
      unloadCurrentSound();
    };
  }, []);

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
        (item) => Number(item?.id) !== Number(song.id)
      ),
    ].slice(0, RECENTLY_PLAYED_LIMIT);

    recentlyPlayedRef.current = nextSongs;
    setRecentlyPlayed(nextSongs);

    try {
      await AsyncStorage.setItem(RECENTLY_PLAYED_KEY, JSON.stringify(nextSongs));
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
    setCurrentTime(0);
    setDuration(0);
    setDidFinish(false);
  }

  function setSafeCurrentTime(seconds) {
    const safeDuration = durationRef.current;
    const safeTime = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    const clampedTime =
      safeDuration > 0 ? Math.min(safeTime, safeDuration) : safeTime;
    currentTimeRef.current = clampedTime;
    setCurrentTime(clampedTime);
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
    setCurrentTime(safeTime);
  }

  function setSafeDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return durationRef.current;
    }

    durationRef.current = seconds;
    setDuration(seconds);
    return seconds;
  }

  function handleSongFinished() {
    const player = soundRef.current;
    if (repeatRef.current && player?.seekTo) {
      player.seekTo(0).then(() => {
        setSafeCurrentTime(0);
        setDidFinish(false);
        finishHandledRef.current = false;
        player.play();
        setIsPlaying(true);
      }).catch(() => {});
      return;
    }

    if (shuffleRef.current && queueRef.current.length > 1) {
      const nextSongs = queueRef.current.filter((song) => song?.id !== currentSongRef.current?.id);
      const nextSong = nextSongs[Math.floor(Math.random() * nextSongs.length)];
      if (nextSong) {
        playSong(nextSong, queueRef.current);
      }
    }
  }

  function syncPlaybackStatus(status) {
    if (!status?.isLoaded) {
      setIsPlaying(false);
      setSafeCurrentTime(0);
      setDidFinish(false);
      return;
    }

    const nextDuration = Number.isFinite(status.duration)
      ? Math.max(0, status.duration)
      : durationRef.current;
    const safeDuration = setSafeDuration(nextDuration);
    const nextTime = Number.isFinite(status.currentTime)
      ? Math.max(0, Math.min(status.currentTime, safeDuration || status.currentTime))
      : currentTimeRef.current;

    setIsPlaying(Boolean(status.playing) && !status.didJustFinish);
    setSafeCurrentTime(nextTime);
    setDidFinish(Boolean(status.didJustFinish));

    if (status.didJustFinish && !finishHandledRef.current) {
      finishHandledRef.current = true;
      setTimeout(handleSongFinished, 0);
    }
  }

  function syncPlayerStatusSoon(player) {
    setTimeout(() => {
      syncPlaybackStatus(currentStatusFor(player));
    }, 100);
  }

  function releaseBusySoon() {
    setTimeout(() => {
      isBusyRef.current = false;
    }, 250);
  }

  function recordPlayCount(song) {
    const songId = song?.id;
    if (!songId || lastCountedSongIdRef.current === songId) return;

    lastCountedSongIdRef.current = songId;
    incrementSongPlay(songId);
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

  function findCurrentQueueIndex() {
    const currentId = currentSongRef.current?.id;
    return queueRef.current.findIndex((song) => song?.id === currentId);
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
    setIsPlaying(false);
    currentTimeRef.current = 0;
    durationRef.current = 0;
    setUnsafeCurrentTimeForReset(0);
    setDuration(0);
    setDidFinish(false);

    if (!song?.audio_file) {
      releaseBusySoon();
      setIsPlaying(false);
      return;
    }

    try {
      await ensureAudioSessionReady();
      unloadCurrentSound();
      const player = createAudioPlayer(
        { uri: song.audio_file },
        { updateInterval: 350, keepAudioSessionActive: true }
      );
      soundRef.current = player;

      if (player.addListener) {
        statusSubscriptionRef.current = player.addListener("playbackStatusUpdate", syncPlaybackStatus);
      }

      activateLockScreenControls(player, song);
      player.play();
      recordPlayCount(song);
      recordRecentlyPlayed(song);
      syncPlaybackStatus(currentStatusFor(player));
      syncPlayerStatusSoon(player);
    } catch (error) {
      // Placeholder URLs or blocked network requests should never break browsing.
      setIsPlaying(false);
    } finally {
      releaseBusySoon();
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
    return Boolean(status?.didJustFinish || didFinish || (statusDuration > 0 && statusTime >= statusDuration - 0.35));
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
    setSafeCurrentTime(nextTime);
    setDidFinish(false);

    try {
      await player.seekTo(nextTime);
      setSafeCurrentTime(nextTime);
      setDidFinish(false);
    } catch (error) {
    }
  }

  function seekBy(seconds) {
    seekTo(currentTimeRef.current + seconds);
  }

  async function togglePlay() {
    if (!currentSongRef.current || isBusyRef.current) return;

    const player = soundRef.current;
    if (!player) {
      playSong(currentSongRef.current);
      return;
    }

    isBusyRef.current = true;
    try {
      if (player.playing || player.currentStatus?.playing) {
        player.pause();
        setIsPlaying(false);
      } else {
        if (isPlayerAtEnd(player) && player.seekTo) {
          await player.seekTo(0);
          setSafeCurrentTime(0);
          setDidFinish(false);
          finishHandledRef.current = false;
        }
        activateLockScreenControls(player, currentSongRef.current);
        player.play();
        setIsPlaying(true);
        setDidFinish(false);
      }

      syncPlayerStatusSoon(player);
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

  const value = useMemo(
    () => ({
      backgroundPlaybackEnabled,
      currentSong,
      currentTime,
      duration,
      didFinish,
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
      duration,
      didFinish,
      isPlaying,
      isRepeatOn,
      isShuffleOn,
      recentlyPlayed,
    ]
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
  return useContext(PlayerContext);
}

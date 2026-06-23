import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

const PlayerContext = createContext(null);

export function PlayerProvider({ children }) {
  const soundRef = useRef(null);
  const statusSubscriptionRef = useRef(null);
  const currentSongRef = useRef(null);
  const isBusyRef = useRef(false);
  const queueRef = useRef([]);
  const repeatRef = useRef(false);
  const shuffleRef = useRef(false);
  const finishHandledRef = useRef(false);
  const [currentSong, setCurrentSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [didFinish, setDidFinish] = useState(false);
  const [isRepeatOn, setIsRepeatOn] = useState(false);
  const [isShuffleOn, setIsShuffleOn] = useState(false);

  useEffect(() => {
    return () => {
      unloadCurrentSound();
    };
  }, []);

  function clearStatusSubscription() {
    if (statusSubscriptionRef.current?.remove) {
      statusSubscriptionRef.current.remove();
    }
    statusSubscriptionRef.current = null;
  }

  function unloadCurrentSound() {
    clearStatusSubscription();

    if (soundRef.current) {
      try {
        soundRef.current.pause();
      } catch (error) {}
      try {
        soundRef.current.remove();
      } catch (error) {}
    }

    soundRef.current = null;
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setDidFinish(false);
  }

  function handleSongFinished() {
    const player = soundRef.current;
    if (repeatRef.current && player?.seekTo) {
      player.seekTo(0).then(() => {
        setCurrentTime(0);
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
      setCurrentTime(0);
      setDidFinish(false);
      return;
    }

    setIsPlaying(Boolean(status.playing) && !status.didJustFinish);
    setCurrentTime(Number.isFinite(status.currentTime) ? Math.max(0, status.currentTime) : 0);
    setDuration(Number.isFinite(status.duration) ? Math.max(0, status.duration) : 0);
    setDidFinish(Boolean(status.didJustFinish));

    if (status.didJustFinish && !finishHandledRef.current) {
      finishHandledRef.current = true;
      setTimeout(handleSongFinished, 0);
    }
  }

  function syncPlayerStatusSoon(player) {
    setTimeout(() => {
      syncPlaybackStatus(player?.currentStatus || {
        isLoaded: player?.isLoaded,
        playing: player?.playing,
        didJustFinish: false,
      });
    }, 100);
  }

  function releaseBusySoon() {
    setTimeout(() => {
      isBusyRef.current = false;
    }, 250);
  }

  function playSong(song, queue = []) {
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
    setCurrentTime(0);
    setDuration(0);
    setDidFinish(false);

    if (!song?.audio_file) {
      releaseBusySoon();
      setIsPlaying(false);
      return;
    }

    try {
      const { createAudioPlayer } = require("expo-audio");
      unloadCurrentSound();
      const player = createAudioPlayer(
        { uri: song.audio_file },
        { updateInterval: 250, keepAudioSessionActive: true }
      );
      soundRef.current = player;

      if (player.addListener) {
        statusSubscriptionRef.current = player.addListener("playbackStatusUpdate", syncPlaybackStatus);
      }

      player.play();
      syncPlaybackStatus(player.currentStatus || {
        isLoaded: player.isLoaded,
        playing: player.playing,
        didJustFinish: false,
      });
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
    const statusDuration = Number.isFinite(status?.duration) ? status.duration : duration;
    const statusTime = Number.isFinite(status?.currentTime) ? status.currentTime : currentTime;
    return Boolean(status?.didJustFinish || didFinish || (statusDuration > 0 && statusTime >= statusDuration - 0.35));
  }

  function clampTime(seconds) {
    if (!Number.isFinite(seconds)) return 0;
    if (duration <= 0) return Math.max(0, seconds);
    return Math.min(Math.max(0, seconds), duration);
  }

  async function seekTo(seconds) {
    const player = soundRef.current;
    if (!player?.seekTo) return;

    const nextTime = clampTime(seconds);
    try {
      await player.seekTo(nextTime);
      setCurrentTime(nextTime);
      setDidFinish(false);
      syncPlayerStatusSoon(player);
    } catch (error) {}
  }

  function seekBy(seconds) {
    seekTo(currentTime + seconds);
  }

  function seekToProgress(nextProgress) {
    if (duration <= 0 || !Number.isFinite(nextProgress)) return;
    seekTo(duration * Math.min(Math.max(nextProgress, 0), 1));
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
          setCurrentTime(0);
          setDidFinish(false);
          finishHandledRef.current = false;
        }
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

  const value = useMemo(
    () => ({
      currentSong,
      currentTime,
      duration,
      didFinish,
      isPlaying,
      isRepeatOn,
      isShuffleOn,
      playSong,
      progress: duration > 0 ? Math.min(currentTime / duration, 1) : 0,
      seekBy,
      seekTo,
      seekToProgress,
      togglePlay,
      toggleRepeat,
      toggleShuffle,
    }),
    [currentSong, currentTime, duration, didFinish, isPlaying, isRepeatOn, isShuffleOn]
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
  return useContext(PlayerContext);
}

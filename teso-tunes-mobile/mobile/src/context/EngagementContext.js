import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";

import { followArtist, likeSong, unfollowArtist, unlikeSong } from "../api/musicApi";

const DEVICE_ID_KEY = "teso_tunes_device_id";
const LIKED_SONGS_KEY = "teso_tunes_liked_songs";
const FOLLOWED_ARTISTS_KEY = "teso_tunes_followed_artists";

const EngagementContext = createContext(null);

function makeDeviceId() {
  return `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toIdSet(values) {
  return new Set((values || []).map((value) => Number(value)));
}

function parseSavedIds(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function updateCountMap(previous, id, nextCount, delta) {
  const current = previous[id] || 0;
  const safeNext = Number.isFinite(nextCount) ? nextCount : Math.max(0, current + delta);
  return { ...previous, [id]: safeNext };
}

function actionCount(serverCount, optimisticCount, direction) {
  const safeOptimistic = Math.max(0, Number(optimisticCount || 0));
  if (!Number.isFinite(serverCount)) return safeOptimistic;
  const safeServer = Math.max(0, Number(serverCount));
  return direction > 0
    ? Math.max(safeServer, safeOptimistic)
    : Math.min(safeServer, safeOptimistic);
}

export function EngagementProvider({ children }) {
  const [deviceId, setDeviceId] = useState(null);
  const [likedSongs, setLikedSongs] = useState(new Set());
  const [followedArtists, setFollowedArtists] = useState(new Set());
  const likedSongsRef = useRef(new Set());
  const followedArtistsRef = useRef(new Set());
  const pendingSongLikeIdsRef = useRef(new Set());
  const pendingArtistFollowIdsRef = useRef(new Set());
  const [songLikeCounts, setSongLikeCounts] = useState({});
  const [artistFollowerCounts, setArtistFollowerCounts] = useState({});
  const [pendingSongLikeIds, setPendingSongLikeIds] = useState(new Set());
  const [pendingArtistFollowIds, setPendingArtistFollowIds] = useState(new Set());

  useEffect(() => {
    async function loadEngagement() {
      try {
        let savedDeviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);
        if (!savedDeviceId) {
          savedDeviceId = makeDeviceId();
          await AsyncStorage.setItem(DEVICE_ID_KEY, savedDeviceId);
        }

        const [savedLikes, savedFollows] = await Promise.all([
          AsyncStorage.getItem(LIKED_SONGS_KEY),
          AsyncStorage.getItem(FOLLOWED_ARTISTS_KEY),
        ]);

        setDeviceId(savedDeviceId);
        setLikedSongs(toIdSet(parseSavedIds(savedLikes)));
        setFollowedArtists(toIdSet(parseSavedIds(savedFollows)));
      } catch (error) {
        setDeviceId(makeDeviceId());
        setLikedSongs(new Set());
        setFollowedArtists(new Set());
      }
    }

    loadEngagement();
  }, []);

  useEffect(() => {
    likedSongsRef.current = likedSongs;
  }, [likedSongs]);

  useEffect(() => {
    followedArtistsRef.current = followedArtists;
  }, [followedArtists]);

  async function saveLikedSongs(nextSet) {
    setLikedSongs(nextSet);
    await AsyncStorage.setItem(LIKED_SONGS_KEY, JSON.stringify([...nextSet]));
  }

  async function saveFollowedArtists(nextSet) {
    followedArtistsRef.current = nextSet;
    setFollowedArtists(nextSet);
    await AsyncStorage.setItem(FOLLOWED_ARTISTS_KEY, JSON.stringify([...nextSet]));
  }

  function setArtistFollowPending(id, pending) {
    const nextPending = new Set(pendingArtistFollowIdsRef.current);
    if (pending) {
      nextPending.add(Number(id));
    } else {
      nextPending.delete(Number(id));
    }
    pendingArtistFollowIdsRef.current = nextPending;
    setPendingArtistFollowIds(nextPending);
  }

  function setSongLikePending(id, pending) {
    const nextPending = new Set(pendingSongLikeIdsRef.current);
    if (pending) {
      nextPending.add(Number(id));
    } else {
      nextPending.delete(Number(id));
    }
    pendingSongLikeIdsRef.current = nextPending;
    setPendingSongLikeIds(nextPending);
  }

  function showEngagementError(message) {
    try {
      Alert.alert("TesoHub Music", message);
    } catch (error) {}
  }

  async function syncFollowedArtistIds(ids = []) {
    await saveFollowedArtists(toIdSet(ids));
  }

  async function toggleSongLike(song) {
    if (!song || !deviceId) return;
    const id = Number(song.id);
    if (pendingSongLikeIdsRef.current.has(id)) return;

    const previousLikedSongs = new Set(likedSongsRef.current);
    const previousCount = getSongLikeCount(song);
    const alreadyLiked = previousLikedSongs.has(id);
    const nextLikedSongs = new Set(previousLikedSongs);

    setSongLikePending(id, true);
    if (alreadyLiked) {
      const optimisticCount = Math.max(0, previousCount - 1);
      nextLikedSongs.delete(id);
      await saveLikedSongs(nextLikedSongs);
      setSongLikeCounts((counts) => updateCountMap(counts, id, optimisticCount, 0));
      try {
        const result = await unlikeSong(id, deviceId);
        setSongLikeCounts((counts) =>
          updateCountMap(
            counts,
            id,
            actionCount(result.like_count, optimisticCount, -1),
            0,
          ),
        );
      } catch (error) {
        await saveLikedSongs(previousLikedSongs);
        setSongLikeCounts((counts) => updateCountMap(counts, id, previousCount, 0));
        showEngagementError("Could not update this like. Please try again.");
      } finally {
        setSongLikePending(id, false);
      }
    } else {
      const optimisticCount = previousCount + 1;
      nextLikedSongs.add(id);
      await saveLikedSongs(nextLikedSongs);
      setSongLikeCounts((counts) => updateCountMap(counts, id, optimisticCount, 0));
      try {
        const result = await likeSong(id, deviceId);
        setSongLikeCounts((counts) =>
          updateCountMap(
            counts,
            id,
            actionCount(result.like_count, optimisticCount, 1),
            0,
          ),
        );
      } catch (error) {
        await saveLikedSongs(previousLikedSongs);
        setSongLikeCounts((counts) => updateCountMap(counts, id, previousCount, 0));
        showEngagementError("Could not update this like. Please try again.");
      } finally {
        setSongLikePending(id, false);
      }
    }
  }

  async function toggleArtistFollow(artist) {
    const id = Number(artist?.id);
    const alreadyFollowed = followedArtistsRef.current.has(id);

    try {
      return alreadyFollowed
        ? await unfollowArtistAction(artist)
        : await followArtistAction(artist);
    } catch (error) {
      return null;
    }
  }

  async function followArtistAction(artist) {
    if (!artist || !deviceId) return;
    const id = Number(artist.id);
    if (pendingArtistFollowIdsRef.current.has(id)) {
      return {
        followed: followedArtistsRef.current.has(id),
        follower_count: getArtistFollowerCount(artist),
        skipped: true,
      };
    }

    if (followedArtistsRef.current.has(id)) {
      return {
        followed: true,
        follower_count: getArtistFollowerCount(artist),
      };
    }

    const previousFollowedArtists = new Set(followedArtistsRef.current);
    const previousCount = getArtistFollowerCount(artist);
    const optimisticFollowedArtists = new Set(previousFollowedArtists);
    optimisticFollowedArtists.add(id);
    setArtistFollowPending(id, true);
    try {
      await saveFollowedArtists(optimisticFollowedArtists);
      setArtistFollowerCounts((counts) =>
        updateCountMap(counts, id, previousCount + 1, 0),
      );
      const result = await followArtist(id, deviceId);
      const followerCount = actionCount(result.follower_count, previousCount + 1, 1);
      setArtistFollowerCounts((counts) =>
        updateCountMap(counts, id, followerCount, 1),
      );
      return { ...result, follower_count: followerCount };
    } catch (error) {
      await saveFollowedArtists(previousFollowedArtists);
      setArtistFollowerCounts((counts) => updateCountMap(counts, id, previousCount, 0));
      showEngagementError("Could not follow this artist. Please try again.");
      throw error;
    } finally {
      setArtistFollowPending(id, false);
    }
  }

  async function unfollowArtistAction(artist) {
    if (!artist || !deviceId) return;
    const id = Number(artist.id);
    if (pendingArtistFollowIdsRef.current.has(id)) {
      return {
        followed: followedArtistsRef.current.has(id),
        follower_count: getArtistFollowerCount(artist),
        skipped: true,
      };
    }

    if (!followedArtistsRef.current.has(id)) {
      return {
        followed: false,
        follower_count: getArtistFollowerCount(artist),
      };
    }

    const previousFollowedArtists = new Set(followedArtistsRef.current);
    const previousCount = getArtistFollowerCount(artist);
    const optimisticFollowedArtists = new Set(previousFollowedArtists);
    optimisticFollowedArtists.delete(id);
    setArtistFollowPending(id, true);
    try {
      await saveFollowedArtists(optimisticFollowedArtists);
      setArtistFollowerCounts((counts) =>
        updateCountMap(counts, id, Math.max(0, previousCount - 1), 0),
      );
      const result = await unfollowArtist(id, deviceId);
      const followerCount = actionCount(
        result.follower_count,
        Math.max(0, previousCount - 1),
        -1,
      );
      setArtistFollowerCounts((counts) =>
        updateCountMap(counts, id, followerCount, -1),
      );
      return { ...result, follower_count: followerCount };
    } catch (error) {
      await saveFollowedArtists(previousFollowedArtists);
      setArtistFollowerCounts((counts) => updateCountMap(counts, id, previousCount, 0));
      showEngagementError("Could not update this follow. Please try again.");
      throw error;
    } finally {
      setArtistFollowPending(id, false);
    }
  }

  function getSongLikeCount(song) {
    const id = Number(song?.id);
    return songLikeCounts[id] ?? song?.like_count ?? 0;
  }

  function getArtistFollowerCount(artist) {
    const id = Number(artist?.id);
    return artistFollowerCounts[id] ?? artist?.follower_count ?? 0;
  }

  const value = useMemo(
    () => ({
      deviceId,
      followedArtistIds: [...followedArtists],
      followArtistAction,
      getArtistFollowerCount,
      getSongLikeCount,
      isArtistFollowed: (id) => followedArtists.has(Number(id)),
      isArtistFollowPending: (id) => pendingArtistFollowIds.has(Number(id)),
      isSongLiked: (id) => likedSongs.has(Number(id)),
      isSongLikePending: (id) => pendingSongLikeIds.has(Number(id)),
      likedSongIds: [...likedSongs],
      syncFollowedArtistIds,
      toggleArtistFollow,
      toggleSongLike,
      unfollowArtistAction,
    }),
    [
      deviceId,
      followedArtists,
      likedSongs,
      pendingArtistFollowIds,
      pendingSongLikeIds,
      songLikeCounts,
      artistFollowerCounts,
    ]
  );

  return <EngagementContext.Provider value={value}>{children}</EngagementContext.Provider>;
}

export function useEngagement() {
  return useContext(EngagementContext);
}

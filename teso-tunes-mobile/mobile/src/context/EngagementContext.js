import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

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

export function EngagementProvider({ children }) {
  const [deviceId, setDeviceId] = useState(null);
  const [likedSongs, setLikedSongs] = useState(new Set());
  const [followedArtists, setFollowedArtists] = useState(new Set());
  const [songLikeCounts, setSongLikeCounts] = useState({});
  const [artistFollowerCounts, setArtistFollowerCounts] = useState({});

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

  async function saveLikedSongs(nextSet) {
    setLikedSongs(nextSet);
    await AsyncStorage.setItem(LIKED_SONGS_KEY, JSON.stringify([...nextSet]));
  }

  async function saveFollowedArtists(nextSet) {
    setFollowedArtists(nextSet);
    await AsyncStorage.setItem(FOLLOWED_ARTISTS_KEY, JSON.stringify([...nextSet]));
  }

  async function toggleSongLike(song) {
    if (!song || !deviceId) return;
    const id = Number(song.id);
    const alreadyLiked = likedSongs.has(id);
    const nextLikedSongs = new Set(likedSongs);

    if (alreadyLiked) {
      const optimisticCount = Math.max(0, getSongLikeCount(song) - 1);
      nextLikedSongs.delete(id);
      saveLikedSongs(nextLikedSongs);
      setSongLikeCounts((counts) => updateCountMap(counts, id, optimisticCount, 0));
      try {
        const result = await unlikeSong(id, deviceId);
        setSongLikeCounts((counts) => updateCountMap(counts, id, result.like_count, 0));
      } catch (error) {}
    } else {
      const optimisticCount = getSongLikeCount(song) + 1;
      nextLikedSongs.add(id);
      saveLikedSongs(nextLikedSongs);
      setSongLikeCounts((counts) => updateCountMap(counts, id, optimisticCount, 0));
      try {
        const result = await likeSong(id, deviceId);
        setSongLikeCounts((counts) => updateCountMap(counts, id, result.like_count, 0));
      } catch (error) {}
    }
  }

  async function toggleArtistFollow(artist) {
    if (!artist || !deviceId) return;
    const id = Number(artist.id);
    const alreadyFollowed = followedArtists.has(id);
    const nextFollowedArtists = new Set(followedArtists);

    if (alreadyFollowed) {
      const optimisticCount = Math.max(0, getArtistFollowerCount(artist) - 1);
      nextFollowedArtists.delete(id);
      saveFollowedArtists(nextFollowedArtists);
      setArtistFollowerCounts((counts) => updateCountMap(counts, id, optimisticCount, 0));
      try {
        const result = await unfollowArtist(id, deviceId);
        setArtistFollowerCounts((counts) => updateCountMap(counts, id, result.follower_count, 0));
      } catch (error) {}
    } else {
      const optimisticCount = getArtistFollowerCount(artist) + 1;
      nextFollowedArtists.add(id);
      saveFollowedArtists(nextFollowedArtists);
      setArtistFollowerCounts((counts) => updateCountMap(counts, id, optimisticCount, 0));
      try {
        const result = await followArtist(id, deviceId);
        setArtistFollowerCounts((counts) => updateCountMap(counts, id, result.follower_count, 0));
      } catch (error) {}
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
      getArtistFollowerCount,
      getSongLikeCount,
      isArtistFollowed: (id) => followedArtists.has(Number(id)),
      isSongLiked: (id) => likedSongs.has(Number(id)),
      toggleArtistFollow,
      toggleSongLike,
    }),
    [deviceId, followedArtists, likedSongs, songLikeCounts, artistFollowerCounts]
  );

  return <EngagementContext.Provider value={value}>{children}</EngagementContext.Provider>;
}

export function useEngagement() {
  return useContext(EngagementContext);
}

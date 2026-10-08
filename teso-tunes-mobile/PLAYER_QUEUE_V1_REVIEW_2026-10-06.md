# Player V1 Queue / Up Next - local implementation review

Status: implemented and tested locally. Not committed, pushed, published as an
OTA, or deployed to the PWA. No APK was built.

Local preview: http://127.0.0.1:53463/songs
Select a song, open the full Player, then select Up Next. This address works on
this laptop only. The public PWA and installed Android app remain unchanged.

## 1. Files changed

All implementation paths below are inside `teso-tunes-mobile/mobile`.

| File | Change |
| --- | --- |
| src/utils/playbackQueue.js | New shared, observable session queue store |
| src/context/PlaybackQueueContext.js | Queue subscription and current-entry selector |
| src/context/PlayerContext.js | Connect Expo Audio to entry-based queue transitions |
| src/context/PlayerContext.web.js | Connect HTML Audio to the same queue transitions |
| src/components/UpNextModal.js | Now Playing, upcoming entries and queue controls |
| src/components/SongActionsModal.js | Play Next, Add to Queue, feedback and queue access |
| src/components/SongCard.js | Reuse consistent actions menu; normalize active IDs |
| src/components/AddToPlaylistModal.js | Remove nested Share action/sheet |
| src/screens/PlayerScreen.js | Up Next header, More menu, repeat states, public metadata hydration |
| src/screens/PlaylistDetailScreen.js | Song actions alongside existing saved-playlist removal |
| scripts/test-playback-queue.cjs | New deterministic ordering/identity/guard tests |
| scripts/verify-playback-queue.cjs | New responsive queue, source and hydration browser tests |
| scripts/test-listener-player.cjs | Native adapter queue tests and render isolation measurements |
| scripts/verify-listener-player.cjs | Updated completion/repeat expectations; existing player regressions |
| scripts/verify-song-sharing.cjs | Updated non-nested Share menu expectations |
| scripts/verify-browse-songs.cjs | Additional diagnostics for virtualized-list failures |

This document and the two local export directories are review artifacts. The
temporary preview-server helper lives outside the repository. Pre-existing
backend/migration changes were left untouched and are not part of this task.

## 2. Previous behavior

Both audio adapters held an unobservable song array. Current position was found
by song ID, so duplicate entries were ambiguous. Next/Previous wrapped. Shuffle
selected another random song on each command; ordinary natural completion did
not advance. Repeat was a boolean for repeating one track. Player's Playlist
header opened the Songs catalog; More opened the playlist sheet.

## 3. New queue architecture

One shared store supplies both platforms. Each queue occurrence has a unique
session entry ID independent of its normalized song ID. Observable state exposes
entries, current index, current entry, upcoming entries, shuffle and repeat mode.
Audio creation/status/seek implementations remain in their existing adapters.

Queue subscriptions are separate from player and progress contexts. Progress
ticks never update the queue store. Measured native-adapter run: 20 clock updates
produced 20 progress consumer renders, zero main-player consumer renders and zero
queue consumer renders. Queue edits do not restart the current audio.

Existing playSong(song, sourceList) calls seed a new playback session in source
order at the selected entry. Actual browser checks cover Home sections, Continue
Listening, Search results, filtered Browse, artist songs, saved playlist order,
liked songs and compact Recently Played. Shared-song entry starts with that song
only, including the legacy Player deep-link entry.

## 4. Up Next UI

The safe-area-aware, scrollable modal contains Now Playing and Up Next, artwork,
title and artist. The current song is visually accented and has Play/Pause.
Upcoming entries can be selected immediately, moved up/down, moved to next, or
removed. Reordering uses accessible icon buttons, not drag-and-drop.

The Player header always exposes Up Next, including the empty Player. The song
menu also exposes queue access, so adding songs before selecting a current song
does not create an inaccessible queue. Adding to an empty queue does not autoplay;
select an entry in Up Next to start. The mini-player is unchanged.

## 5. Play Next

Inserts a new occurrence immediately after current, without interrupting audio.
The queue row's Play Next moves that existing occurrence instead of duplicating
it. Explicit Play Next priority is retained when shuffle is turned off.

## 6. Add to Queue

Appends an occurrence to the end and shows brief success feedback. Repeated
intentional additions are allowed. The same command for the same song within
350ms is ignored, preventing accidental double taps without song-ID deduplication.

## 7. Remove and reorder

Removal addresses only the chosen upcoming entry ID. Current and preceding
entries cannot be removed through these controls. Move Up/Down cannot cross the
current entry. No destructive skip-and-remove-current action was added.

## 8. Natural completion

With Repeat Off, completion advances to the next visible queue entry, including
when Up Next is open. At the genuine tail it stops; pressing Play replays that
entry. There is no implicit wrap. Failed playback retains existing error/Retry
handling instead of silently discarding queue entries.

## 9. Repeat

Off -> All -> One -> Off. Accessible labels identify the exact state; All/1 badges
distinguish enabled modes. All wraps to the queue head at the tail. One restarts
the current entry on natural completion. Manual Next still moves forward in One
mode and does not wrap. Previous moves backward in queue order, stopping at its
head rather than wrapping.

## 10. Shuffle algorithm

Enabling shuffle performs one Fisher-Yates shuffle of the upcoming entries only.
Current and preceding entries remain unchanged. Next and natural completion walk
that fixed visible order. Previous walks back through the retained queue order.
No independent random choice is made by Next. Entries are not repeated before the
set is exhausted, except deliberate duplicate songs and Repeat behavior.

Disabling shuffle restores the remaining entries to their source/insertion order.
Explicit manual reordering establishes the new order to restore; Play Next keeps
its priority. Enabling shuffle again reshuffles the then-upcoming portion.
Repeat All reuses the displayed order rather than silently reshuffling each cycle.

## 11. Header

The misleading Playlist header now reads Up Next and opens the actual queue.
Back retains existing navigation; the empty Player still offers Browse Songs.

## 12. More and song actions

Player More and non-compact song-card menus share Play/Pause, Play Next, Add to
Queue, Like/Unlike, Add to Playlist, Share, and Go to Artist when an artist exists.
Playlist rows also expose this menu while keeping saved-playlist removal separate.
An open Player menu keeps the originally selected track if playback advances.
Share is no longer nested inside Add to Playlist. No unavailable actions added.

## 13. Guests and account features

Playback, queue operations, Share and artist navigation need no login. Like,
Add to Playlist and other existing account features retain their friendly
Create Account / Log In / Keep Listening prompts and existing authorization.
Queue operations do not call account-write or backend queue APIs.

## 14. Recently Played and lyrics

When the selected song lacks full lyric metadata, Player requests that song
through the existing public song API. A matching public response hydrates display
metadata without reloading audio. Cleanup guards discard old responses after a
song switch. Loading/error/Retry states distinguish retrieval failure from absent
lyrics. Existing plain lyrics and the existing no-lyrics fallback remain.

No lyric timing, synced lyrics, new schema, or permanent duplicate song metadata
was added. About this track retains artist, genre, plays and available date.
The unreliable District row was removed; no credits were invented.

## 15. Android / PWA parity

Both adapters share normalized IDs, entry identities, ordering, repeat, shuffle
and queue mutation guards. Expo Audio, HTML Audio, Media Session, lock-screen
metadata, background configuration, seek workers and error handling remain in
their existing implementations. A different occurrence of the same song gets a
new timeline key, so a gesture from the previous occurrence cannot seek it.

## 16. Tests

- Final unit/native-adapter run: 31 passed, zero failed.
- Native adapter: natural advancement, single/multiple entries, duplicates,
  selection/removal, rapid Next, replay, Repeat All/One, shuffle, preparation races,
  rapid pause, coalesced seeking, history, errors/Retry and render isolation.
- Final queue browser suite passed at 320x568, 360x800, 390x844, 768x1024 and
  1280x900. Tests decode actual fixture audio and include end while queue open,
  empty queue, source entry points, lyrics hydration, last-row reachability,
  duplicate guards, explicit repeat/shuffle order and guest prompts.
- Final player browser suite passed at those same five sizes: real audio clock,
  pause/resume, tap/drag/keyboard seeking, next/previous, end/replay, buffering,
  loading pause, errors/Retry and real listening history.
- Browse, sharing, onboarding, Library, Profile and Discovery regression suites
  passed. These cover Like/Unlike/rollback, Follow/Unfollow/counts, playlists,
  Support flows, role-aware artist access, authentication fixtures, navigation,
  unavailable shared songs, and responsive/slow/error states. They passed before
  the last ordering-only Play Next/shuffle fix; queue/native/player tests and both
  exports were rerun after that fix.
- Earlier test runs exposed old assumptions about single-track completion and
  nested Share, plus a modal-transition selector race; tests now wait for the
  closed modal and assert the intended new behavior. One initial Browse virtual
  list-position timeout did not recur in two full reruns; diagnostics were added.
- Read-only real-backend smoke using the local frontend passed: Supabase health,
  private proxy first/nonzero ranges (HTTP 206), real guest audio/seek, sharing,
  Home/discovery/history, guest Profile and Help Center. Browser POSTs, including
  play counting, were intercepted. No real listener login/mutations were run;
  signed-in behavior used isolated fixtures.
- Screenshots reviewed at small-phone and desktop sizes; no horizontal overflow.
  Screenshot directory: `%TEMP%/tesohub-queue-review`.

## 17. Production exports

Both completed successfully after the final source edit:

- Web: `mobile/dist-queue-review`, bundle
  `AppEntry-ecc1bd8a17cf75716450d7d50476a4f9.js`.
- Android: `mobile/dist-queue-android-review`, bundle
  `AppEntry-170f8aa7d4e88da8ab140938f4ebe7f7.hbc`.

These are local export artifacts, not deployed releases or APKs.

## 18. OTA compatibility

JavaScript/UI only, compatible with the existing preview channel and runtime
1.0.6. App version remains 1.0.6. App/native configuration, package/dependency
files, permissions, SDK, EAS configuration and hosting configuration are unchanged.
No Supabase schema, persistence architecture or production catalog edits.

## 19. Remaining limitations

- Queue and repeat/shuffle state are session-local and reset on full reload or
  app process restart. Saved playlists/likes/follows remain separate and intact.
- Reordering uses buttons, not drag gestures. Mini-player has no additional
  queue button; its existing body opens Player, which exposes Up Next.
- Physical Android touch, hardware Back/modal dismissal, background continuation,
  lock-screen controls and native share-sheet behavior still need handset QA.
  Browser/native-adapter tests and exports are not physical-device verification.
- Physical iOS and installed-PWA testing was not performed.
- No OTA/PWA release was performed, as requested.

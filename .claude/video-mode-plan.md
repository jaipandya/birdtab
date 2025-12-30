# Video Mode Enhancement Plan

## Overview
Enhance the video mode feature in BirdTab to provide a polished, performant, and unobtrusive video experience for the new tab extension.

**Core Principle:** Subtle, stays out of the way, invisible until needed.

---

## Design Decisions

| Decision | Choice |
|----------|--------|
| Tab return after 30s unload | Semi-transparent overlay with centered play button |
| Progress bar | Bottom of video, hover only, auto-hide after 3s |
| Video indicator | Video icon in credits replaces camera icon |
| Video unavailable | Silently show image mode (camera + audio icons) - no notification |
| Loading state | Spinner replaces video icon in credits while loading |
| Slow connection | Silently fall back to image mode |

---

## Phase 0: Performance & Stability Foundation

### 0.1 Metadata-only preload
**File:** `src/script.js:612-615`
- Change `<video>` to use `preload="metadata"`
- Only fetch video dimensions/duration initially

### 0.2 Connection quality detection
**File:** `src/background.js`
- Use `navigator.connection` API to detect:
  - `effectiveType === '2g'` or `'slow-2g'`
  - `saveData === true`
- Add `isSlowConnection` flag to bird info response

### 0.3 Silent slow-connection fallback
**Files:** `src/background.js`, `src/script.js`
- When slow connection detected, skip video fetch entirely
- Use image mode without changing user's video mode setting
- No notification to user - just works

### 0.4 Tab visibility handler
**File:** `src/script.js`
- Create `VideoVisibilityManager` class
- On `visibilitychange` → hidden: pause video, record state
- Track: `hiddenTimestamp`, `wasPlaying`, `lastPosition`

### 0.5 Video unload after 30s hidden
**File:** `src/script.js`
- Start 30s timeout when tab hidden
- On timeout: `video.src = ''`, `video.load()` to release memory
- Set `isUnloaded = true` flag
- Clear timeout if tab visible before 30s

### 0.6 Tab return state (play button overlay)
**Files:** `src/script.js`, `src/styles.css`
- When returning after unload: show poster + overlay
- Semi-transparent dark overlay (30% opacity)
- Large centered play button (72px, white)
- Click: reload video, play from start
- **Credits:** Show photo credits while poster visible (photographer, camera icon)
- On video `canplay`: switch to video credits (videographer, video icon)

### 0.7 Video error handling
**File:** `src/script.js`
- Handle all `MediaError` types
- On any error: silently fall back to image mode
- Show standard image credits (camera + audio icons)

### 0.8 Page unload cleanup
**File:** `src/script.js`
- `beforeunload`: pause, clear src, release memory

### Phase 0 Edge Cases & Credit Logic
**Credits state machine for video mode:**
```
┌─────────────────────────────────────────────────────────────┐
│ State: Initial Load                                         │
│ - Display: Poster image                                     │
│ - Credits: 📷 Photographer (photo being shown)              │
│ - Video: Loading in background                              │
├─────────────────────────────────────────────────────────────┤
│ State: Video Ready (canplay)                                │
│ - Display: Video (auto-play or waiting for play)            │
│ - Credits: 🎬 Videographer                                  │
├─────────────────────────────────────────────────────────────┤
│ State: Tab Hidden < 30s                                     │
│ - Display: Video paused (in memory)                         │
│ - Credits: 🎬 Videographer (unchanged)                      │
├─────────────────────────────────────────────────────────────┤
│ State: Tab Return < 30s                                     │
│ - Display: Video resumes from position                      │
│ - Credits: 🎬 Videographer (unchanged)                      │
├─────────────────────────────────────────────────────────────┤
│ State: Tab Hidden > 30s (unloaded)                          │
│ - Display: Poster + Play overlay                            │
│ - Credits: 📷 Photographer (showing poster)                 │
├─────────────────────────────────────────────────────────────┤
│ State: Video Error/Unavailable                              │
│ - Display: Photo (fallback)                                 │
│ - Credits: 📷 Photographer + 🎵 Recordist (standard mode)   │
├─────────────────────────────────────────────────────────────┤
│ State: Slow Connection                                      │
│ - Display: Photo (video skipped)                            │
│ - Credits: 📷 Photographer + 🎵 Recordist (standard mode)   │
└─────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Loading States

### 1.1 Credits during video loading
**Files:** `src/script.js`, `src/styles.css`
- While video loading: show PHOTO credits (poster is the photo)
  - Camera icon + Photographer name
  - Small spinner indicator somewhere subtle
- When video ready (`canplay`): switch to VIDEO credits
  - Video icon + Videographer name

```html
<!-- Loading state (showing poster/photo) -->
<span class="credit-item">
  <img src="images/svg/camera.svg" ...>
  <a href="...">Photographer Name</a>
  <span class="credit-spinner"></span>  <!-- Small spinner indicating video loading -->
</span>

<!-- Video ready state -->
<span class="credit-item">
  <img src="images/svg/video.svg" ...>
  <a href="...">Videographer Name</a>
</span>
```

**Edge cases:**
- Video fails to load → keep photo credits (already showing correct info)
- Video loads quickly → brief flash of photo credits, then video credits
- Slow connection fallback → show photo credits (no video attempted)

### 1.2 Buffering state (mid-playback)
**Files:** `src/script.js`, `src/styles.css`
- On `waiting` event: show small spinner over video (center)
- On `canplay`: hide spinner
- Semi-transparent, unobtrusive

### 1.3 Video unavailable fallback
**File:** `src/script.js`
- When video unavailable or fails: show image mode
- Display standard credits: camera icon (photographer) + audio icon (recordist)
- No toast, no notification - silent fallback

---

## Phase 2: Video Controls

### 2.1 Progress bar (hover only)
**Files:** `src/script.js`, `src/styles.css`
- Container: absolute bottom, above info panel
- Height: 4px default, 8px on hover
- Hidden by default (`opacity: 0`)
- Show on video hover, hide after 3s no interaction

```css
.video-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 4px;
  opacity: 0;
  transition: opacity 0.3s, height 0.2s;
  z-index: 10;
}

.video-progress:hover,
.content-container:hover .video-progress {
  opacity: 1;
  height: 8px;
}
```

### 2.2 Progress bar segments
- Background: `rgba(255, 255, 255, 0.15)`
- Buffered: `rgba(255, 255, 255, 0.4)`
- Played: `#ffffff`

### 2.3 Progress updates
**File:** `src/script.js`
- Update on `timeupdate` event
- Calculate played: `(currentTime / duration) * 100`
- Calculate buffered from `video.buffered` ranges

### 2.4 Seek on click
**File:** `src/script.js`
- Click progress bar → calculate position
- `video.currentTime = (clickX / width) * duration`

### 2.5 Duration display
**Files:** `src/script.js`, `src/styles.css`
- Add next to existing play button: `0:23 / 1:45`
- Update on `timeupdate`
- Only visible in video mode

### 2.6 Controls auto-hide
**File:** `src/script.js`
- Show progress bar on mouse move over video
- Start 3s timer on each move
- Hide when timer expires
- Always show when paused

### 2.7 Play button overlay
**Files:** `src/script.js`, `src/styles.css`
- Show when: returning from unload, initial load before auto-play
- Semi-transparent overlay: `rgba(0, 0, 0, 0.3)`
- Centered play button: 72px circle, white bg
- Hide on click/play

```css
.video-play-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.3);
  z-index: 5;
}

.video-play-btn {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.9);
  border: none;
  cursor: pointer;
}
```

---

## Phase 3: Visual Polish

### 3.1 Video credit icon
**File:** `src/script.js:586-594`
- Already using `video.svg` in video mode ✓
- Verify it's working correctly

### 3.2 Spinner in credits while loading
**File:** `src/styles.css`
```css
.credit-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}
```

### 3.3 Update settings help text
**File:** `src/settingsModal.js:134`
- Current: "Show bird videos instead of photos when available. Videos include sound."
- Good as-is, maybe clarify: "Videos include their own audio from the recording."

---

## Files to Modify

| File | Key Changes |
|------|-------------|
| `src/script.js` | Visibility manager, progress bar, loading states, overlay |
| `src/styles.css` | Progress bar, spinner, overlay, credits loading state |
| `src/background.js` | Connection detection |
| `src/settingsModal.js` | Minor help text update |

---

## Implementation Order

**Phase 0** (Foundation - do first)
1. 0.1 Metadata preload
2. 0.2 + 0.3 Connection detection + fallback
3. 0.4 + 0.5 Tab visibility + unload
4. 0.6 Play button overlay (after unload)
5. 0.7 + 0.8 Error handling + cleanup

**Phase 1** (Loading states)
6. 1.1 Spinner in credits while loading
7. 1.2 Buffering overlay
8. 1.3 Silent fallback to image mode

**Phase 2** (Controls)
9. 2.1 + 2.2 Progress bar container + segments
10. 2.3 + 2.4 Progress updates + seek
11. 2.5 Duration display
12. 2.6 Auto-hide logic
13. 2.7 Refine play overlay

**Phase 3** (Polish)
14. 3.1 + 3.2 Verify credits, add spinner style
15. 3.3 Settings text
16. Testing

---

## Testing Checklist

- [ ] Video loads with metadata-only initially
- [ ] Slow connection silently uses image mode
- [ ] Tab hide pauses video
- [ ] Tab return < 30s resumes from position
- [ ] Tab return > 30s shows play overlay, reloads on click
- [ ] Video error silently falls back to image mode
- [ ] Credits show spinner while loading, video icon when ready
- [ ] Progress bar appears on hover, hides after 3s
- [ ] Seek works on progress bar click
- [ ] Duration display updates correctly
- [ ] Memory released on tab close
- [ ] No performance issues with normal browsing

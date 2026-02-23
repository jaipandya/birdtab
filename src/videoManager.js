/**
 * Video Manager Module
 * Handles video visibility, memory management, progress bar, and video controls
 */

import { log } from './logger.js';
import { isQuietHoursActive } from './quietHours.js';
import { getMessage } from './i18n.js';

// Module state
let videoVisibilityManager = null;
let video = null;
let progressHideTimeout = null;

// Callbacks that will be set by script.js
let onPlayVideo = null;
let onPauseVideo = null;
let onUpdatePlayPauseButton = null;
let onVideoReloaded = null;
let getIsPlaying = () => false;
let setIsPlaying = () => {};
let getIsMuted = () => false;
let getVolumeLevel = () => 0.8;
let getBirdInfo = () => null;

/**
 * Initialize video manager with callbacks from script.js
 */
export function initVideoManager(callbacks) {
  onPlayVideo = callbacks.onPlayVideo;
  onPauseVideo = callbacks.onPauseVideo;
  onUpdatePlayPauseButton = callbacks.onUpdatePlayPauseButton;
  onVideoReloaded = callbacks.onVideoReloaded || null;
  getIsPlaying = callbacks.getIsPlaying || getIsPlaying;
  setIsPlaying = callbacks.setIsPlaying || setIsPlaying;
  getIsMuted = callbacks.getIsMuted || getIsMuted;
  getVolumeLevel = callbacks.getVolumeLevel || getVolumeLevel;
  getBirdInfo = callbacks.getBirdInfo || getBirdInfo;
}

/**
 * Set the video element reference
 */
export function setVideoElement(videoEl) {
  video = videoEl;
}

/**
 * Get the video element reference
 */
export function getVideoElement() {
  return video;
}

/**
 * Get the video visibility manager instance
 */
export function getVideoVisibilityManager() {
  return videoVisibilityManager;
}

/**
 * Set the video visibility manager instance
 */
export function setVideoVisibilityManager(manager) {
  videoVisibilityManager = manager;
}

/**
 * Video Visibility Manager - handles tab visibility, memory management, and state
 */
export class VideoVisibilityManager {
  constructor(videoElement, birdData) {
    this.video = videoElement;
    this.birdData = birdData;
    this.hiddenTimestamp = null;
    this.wasPlaying = false;
    this.lastPlaybackPosition = 0;
    this.isUnloaded = false;
    this.unloadTimeout = null;
    this.pauseIndicatorTimeout = null;
    this.playIndicatorTimeout = null;
    this.UNLOAD_DELAY = 30000; // 30 seconds

    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    log('VideoVisibilityManager initialized');
  }

  handleVisibilityChange() {
    if (document.hidden) {
      this.onTabHidden();
    } else {
      this.onTabVisible();
    }
  }

  onTabHidden() {
    this.hiddenTimestamp = Date.now();
    this.wasPlaying = this.video && !this.video.paused;
    this.lastPlaybackPosition = this.video ? this.video.currentTime : 0;

    // Pause video immediately
    if (this.video && !this.video.paused) {
      this.video.pause();
      log('Video paused on tab hide');
    }

    // Schedule unload after 30 seconds
    this.unloadTimeout = setTimeout(() => {
      this.unloadVideo();
    }, this.UNLOAD_DELAY);

    log(`Tab hidden, scheduled unload in ${this.UNLOAD_DELAY}ms`);
  }

  async onTabVisible() {
    // Clear unload timeout if returning before 30s
    if (this.unloadTimeout) {
      clearTimeout(this.unloadTimeout);
      this.unloadTimeout = null;
    }

    // Check for quiet hours - ensure video stays muted but allow playback
    const isQuietHour = await isQuietHoursActive();
    if (isQuietHour && this.video) {
      this.video.muted = true;
    }

    if (this.isUnloaded) {
      // Video was unloaded - show play overlay, let user click to reload
      log('Tab visible after unload - showing play overlay');
      this.showPlayOverlay();
    } else if (this.wasPlaying && this.video) {
      // Video still in memory - resume playback (muted if quiet hours)
      log('Tab visible < 30s - resuming video');
      this.video.play().catch(err => {
        log(`Error resuming video: ${err.message}`);
      });
    }
  }

  unloadVideo() {
    if (!this.video || this.isUnloaded) return;

    log('Unloading video to release memory');
    this.isUnloaded = true;

    // Pause the video first
    this.video.pause();

    // Remove the video element entirely to release memory
    if (this.video.parentNode) {
      this.video.remove();
    }

    // Clear references
    this.video = null;
    video = null;

    // Show the poster image
    showPosterImage();

    // Show play overlay
    this.showPlayOverlay();

    // Hide video controls
    cleanupVideoControls();
  }

  showPauseIndicator() {
    // Clear any existing pause indicator timeout
    if (this.pauseIndicatorTimeout) {
      clearTimeout(this.pauseIndicatorTimeout);
      this.pauseIndicatorTimeout = null;
    }

    // Remove any existing pause indicator
    const existingIndicator = document.querySelector('.video-pause-indicator');
    if (existingIndicator) existingIndicator.remove();

    // Also remove any play indicator
    const playIndicator = document.querySelector('.video-play-indicator');
    if (playIndicator) playIndicator.remove();

    const indicator = document.createElement('div');
    indicator.className = 'video-pause-indicator';
    indicator.innerHTML = `
      <div class="pause-icon-container">
        <img src="images/svg/pause.svg" alt="${getMessage('pausedAlt')}" width="56" height="56">
      </div>
    `;

    const contentContainer = document.getElementById('content-container');
    if (contentContainer) {
      contentContainer.appendChild(indicator);
    }

    // Remove the pause indicator after animation completes (400ms)
    this.pauseIndicatorTimeout = setTimeout(() => {
      this.pauseIndicatorTimeout = null;
      const pauseIndicator = document.querySelector('.video-pause-indicator');
      if (pauseIndicator) pauseIndicator.remove();
    }, 400);
  }

  showPlayIndicator() {
    // Clear any existing play indicator timeout
    if (this.playIndicatorTimeout) {
      clearTimeout(this.playIndicatorTimeout);
      this.playIndicatorTimeout = null;
    }

    // Remove any existing play indicator
    const existingIndicator = document.querySelector('.video-play-indicator');
    if (existingIndicator) existingIndicator.remove();

    // Also remove any pause indicator
    const pauseIndicator = document.querySelector('.video-pause-indicator');
    if (pauseIndicator) pauseIndicator.remove();

    const indicator = document.createElement('div');
    indicator.className = 'video-play-indicator';
    indicator.innerHTML = `
      <div class="play-icon-container">
        <img src="images/svg/play.svg" alt="${getMessage('playAlt')}" width="56" height="56">
      </div>
    `;

    const contentContainer = document.getElementById('content-container');
    if (contentContainer) {
      contentContainer.appendChild(indicator);
    }

    // Remove the play indicator after animation completes (400ms)
    this.playIndicatorTimeout = setTimeout(() => {
      this.playIndicatorTimeout = null;
      const playIndicator = document.querySelector('.video-play-indicator');
      if (playIndicator) playIndicator.remove();
    }, 400);
  }

  showPlayOverlay() {
    // Remove existing overlay if present
    const existing = document.querySelector('.video-play-overlay');
    if (existing) existing.remove();

    // Remove any existing pause indicator
    const pauseIndicator = document.querySelector('.video-pause-indicator');
    if (pauseIndicator) pauseIndicator.remove();

    const overlay = document.createElement('div');
    overlay.className = 'video-play-overlay';
    overlay.innerHTML = `
      <button class="video-play-btn" aria-label="${chrome.i18n.getMessage('playTooltip') || 'Play video'}">
        <img src="images/svg/play.svg" alt="${getMessage('playAlt')}" width="32" height="32">
      </button>
    `;

    overlay.addEventListener('click', async () => {
      const isQuietHour = await isQuietHoursActive();
      if (isQuietHour && this.video) {
        this.video.muted = true;
      }

      if (this.isUnloaded) {
        await this.reloadAndPlay();
      } else {
        this.hidePlayOverlay();
        if (this.video && onPlayVideo) {
          await onPlayVideo(true);
        }
      }
    });

    const contentContainer = document.getElementById('content-container');
    if (contentContainer) {
      contentContainer.appendChild(overlay);
    }
  }

  hidePlayOverlay() {
    if (this.pauseIndicatorTimeout) {
      clearTimeout(this.pauseIndicatorTimeout);
      this.pauseIndicatorTimeout = null;
    }

    const overlay = document.querySelector('.video-play-overlay');
    if (overlay) overlay.remove();

    const pauseIndicator = document.querySelector('.video-pause-indicator');
    if (pauseIndicator) pauseIndicator.remove();
  }

  async reloadAndPlay() {
    if (!this.birdData || !this.birdData.videoUrl) {
      log('Cannot reload - no video URL available');
      return;
    }

    const isQuietHour = await isQuietHoursActive();

    log('Reloading video after unload');

    this.isUnloaded = false;
    this.wasPlaying = false;

    showVideoLoadingIndicator();
    this.hidePlayOverlay();

    const existingVideo = document.querySelector('.background-video');
    if (existingVideo) {
      existingVideo.remove();
    }

    const videoEl = document.createElement('video');
    videoEl.className = 'background-video hidden';
    videoEl.loop = true;
    videoEl.playsInline = true;
    videoEl.preload = 'auto';
    videoEl.poster = this.birdData.imageUrl;

    const source = document.createElement('source');
    source.src = this.birdData.videoUrl;
    source.type = 'video/mp4';
    videoEl.appendChild(source);

    const contentContainer = document.getElementById('content-container');
    if (contentContainer) {
      contentContainer.insertBefore(videoEl, contentContainer.firstChild);
    }

    this.video = videoEl;
    video = videoEl;

    const handleReloadError = () => {
      log('Error reloading video, falling back to image mode');
      hideVideoLoadingIndicator();
      showPosterImage();
      this.isUnloaded = true;
    };

    const markAsLoaded = setupVideoEventListeners(videoEl, handleReloadError);

    const handleCanPlay = () => {
      hideVideoLoadingIndicator();
      markAsLoaded();
      setupVideoControls();
    };

    videoEl.addEventListener('canplay', handleCanPlay, { once: true });
    videoEl.addEventListener('error', handleReloadError, { once: true });
    source.addEventListener('error', handleReloadError, { once: true });

    const shouldMute = getIsMuted() || isQuietHour;
    videoEl.volume = shouldMute ? 0 : getVolumeLevel();
    videoEl.muted = shouldMute;

    try {
      this.showPlayIndicator();
      await videoEl.play();
      setIsPlaying(true);
      if (onUpdatePlayPauseButton) onUpdatePlayPauseButton();
      if (onVideoReloaded) onVideoReloaded(videoEl);
    } catch (err) {
      log(`Error playing video after reload: ${err.message}`);
    }
  }

  destroy() {
    if (this.unloadTimeout) {
      clearTimeout(this.unloadTimeout);
    }
    if (this.pauseIndicatorTimeout) {
      clearTimeout(this.pauseIndicatorTimeout);
    }
    if (this.playIndicatorTimeout) {
      clearTimeout(this.playIndicatorTimeout);
    }
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.hidePlayOverlay();
    log('VideoVisibilityManager destroyed');
  }
}

/**
 * Show video loading indicator as a subtle pill badge
 */
export function showVideoLoadingIndicator(isBuffering = false) {
  const existing = document.querySelector('.video-loading-indicator');
  const bufferingText = chrome.i18n.getMessage('buffering') || 'Buffering';
  const loadingVideoText = chrome.i18n.getMessage('loadingVideo') || 'Loading video';

  if (existing) {
    const textEl = existing.querySelector('.loading-text');
    if (textEl) {
      textEl.textContent = isBuffering ? bufferingText : loadingVideoText;
    }
    return;
  }

  const indicator = document.createElement('div');
  indicator.className = 'video-loading-indicator';
  indicator.innerHTML = `
    <div class="loading-spinner"></div>
    <span class="loading-text">${isBuffering ? bufferingText : loadingVideoText}</span>
  `;

  const contentContainer = document.getElementById('content-container');
  if (contentContainer) {
    contentContainer.appendChild(indicator);
  }
}

/**
 * Hide video loading indicator
 */
export function hideVideoLoadingIndicator() {
  const indicator = document.querySelector('.video-loading-indicator');
  if (indicator) {
    indicator.remove();
  }
}

/**
 * Set up all video event listeners
 */
export function setupVideoEventListeners(videoEl, fallbackToImage) {
  let hasStartedPlaying = false;
  let hasLoadedSuccessfully = false;

  videoEl.addEventListener('waiting', function () {
    log('Video buffering...');
    showVideoLoadingIndicator(hasStartedPlaying);
  });

  videoEl.addEventListener('canplaythrough', function () {
    hideVideoLoadingIndicator();
  });

  videoEl.addEventListener('playing', function () {
    hasStartedPlaying = true;
    hideVideoLoadingIndicator();
  });

  videoEl.addEventListener('error', function (e) {
    if (videoVisibilityManager && videoVisibilityManager.isUnloaded) {
      log('Ignoring video error after intentional unload');
      return;
    }

    if (hasLoadedSuccessfully) {
      log(`Video playback error (non-fatal): ${e.message || 'Unknown error'}`);
      return;
    }

    log(`Video load error: ${e.message || 'Unknown error'}, falling back to image`);
    if (fallbackToImage) fallbackToImage();
  });

  const source = videoEl.querySelector('source');
  if (source) {
    source.addEventListener('error', function (e) {
      if (videoVisibilityManager && videoVisibilityManager.isUnloaded) {
        log('Ignoring source error after intentional unload');
        return;
      }

      if (hasLoadedSuccessfully) {
        log('Video source error (non-fatal during playback)');
        return;
      }

      log('Video source failed to load, falling back to image');
      if (fallbackToImage) fallbackToImage();
    });
  }

  videoEl.addEventListener('ended', function () {
    setIsPlaying(false);
    if (onUpdatePlayPauseButton) onUpdatePlayPauseButton();
    showPosterImage();
    videoEl.currentTime = 0;
  });

  videoEl.addEventListener('play', function () {
    setIsPlaying(true);
    if (onUpdatePlayPauseButton) onUpdatePlayPauseButton();
    showVideoElement();

    if (videoVisibilityManager) {
      videoVisibilityManager.hidePlayOverlay();
    }

    // Hide "Video unavailable (slow connection)" icon if video starts playing
    hideVideoUnavailableIcon();
  });

  videoEl.addEventListener('pause', function () {
    setIsPlaying(false);
    if (onUpdatePlayPauseButton) onUpdatePlayPauseButton();
    showPosterImage();

    if (videoVisibilityManager && !videoVisibilityManager.isUnloaded) {
      videoVisibilityManager.showPauseIndicator();
    }
  });

  videoEl.addEventListener('click', async function (e) {
    e.preventDefault();
    e.stopPropagation();

    if (videoVisibilityManager && videoVisibilityManager.isUnloaded) return;

    if (videoEl.paused) {
      if (onPlayVideo) await onPlayVideo(true);
    } else {
      if (onPauseVideo) onPauseVideo();
    }
  });

  return () => {
    hasLoadedSuccessfully = true;
  };
}

/**
 * Set up video to show when ready
 */
export function setVideoSource() {
  const videoEl = document.querySelector('.background-video');
  if (!videoEl) return;

  showVideoLoadingIndicator();

  const fallbackToImage = () => {
    log('Falling back to image mode (visual only)');
    showPosterImage();
    hideVideoLoadingIndicator();
    cleanupVideoControls();

    if (videoVisibilityManager) {
      videoVisibilityManager.isUnloaded = true;
      videoVisibilityManager.showPlayOverlay();
    }
  };

  const markAsLoaded = setupVideoEventListeners(videoEl, fallbackToImage);

  videoEl.addEventListener('canplay', function () {
    log('Video ready to play');
    markAsLoaded();
    hideVideoLoadingIndicator();
    setupVideoControls();
  }, { once: true });

  videoEl.load();
}

/**
 * Create video progress bar
 */
export function createVideoProgressBar() {
  if (document.querySelector('.video-progress')) return;

  const progressBar = document.createElement('div');
  progressBar.className = 'video-progress';
  progressBar.innerHTML = `
    <div class="video-progress-buffered"></div>
    <div class="video-progress-played"></div>
  `;

  const contentContainer = document.getElementById('content-container');
  if (contentContainer) {
    contentContainer.appendChild(progressBar);
  }

  progressBar.addEventListener('click', handleProgressBarClick);

  return progressBar;
}

/**
 * Handle click on progress bar to seek
 */
function handleProgressBarClick(e) {
  e.stopPropagation();
  e.preventDefault();

  if (!video || !video.duration) return;

  const progressBar = e.currentTarget;
  const rect = progressBar.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const percentage = clickX / rect.width;
  const newTime = percentage * video.duration;

  video.currentTime = newTime;
  updateProgressBar();
}

/**
 * Update progress bar visuals
 */
export function updateProgressBar() {
  if (!video) return;

  const playedBar = document.querySelector('.video-progress-played');
  const bufferedBar = document.querySelector('.video-progress-buffered');

  if (playedBar && video.duration) {
    const playedPercent = (video.currentTime / video.duration) * 100;
    playedBar.style.width = `${playedPercent}%`;
  }

  if (bufferedBar && video.buffered.length > 0 && video.duration) {
    let bufferedEnd = 0;
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= video.currentTime && video.currentTime <= video.buffered.end(i)) {
        bufferedEnd = video.buffered.end(i);
        break;
      }
    }
    const bufferedPercent = (bufferedEnd / video.duration) * 100;
    bufferedBar.style.width = `${bufferedPercent}%`;
  }
}

/**
 * Show progress bar
 */
export function showProgressBar() {
  const progressBar = document.querySelector('.video-progress');
  if (progressBar) {
    progressBar.classList.add('visible');
  }

  if (progressHideTimeout) {
    clearTimeout(progressHideTimeout);
  }

  if (video && !video.paused) {
    progressHideTimeout = setTimeout(() => {
      hideProgressBar();
    }, 3000);
  }
}

/**
 * Hide progress bar
 */
export function hideProgressBar() {
  const progressBar = document.querySelector('.video-progress');
  if (progressBar && video && !video.paused) {
    progressBar.classList.remove('visible');
  }
}

/**
 * Setup video controls (progress bar)
 */
export function setupVideoControls() {
  if (!video) return;

  createVideoProgressBar();

  video.addEventListener('timeupdate', () => {
    updateProgressBar();
  });

  const contentContainer = document.getElementById('content-container');
  if (contentContainer) {
    contentContainer.addEventListener('mousemove', () => {
      if (video) {
        showProgressBar();
      }
    });

    contentContainer.addEventListener('mouseleave', () => {
      if (video && !video.paused) {
        hideProgressBar();
      }
    });
  }

  video.addEventListener('pause', () => {
    showProgressBar();
    if (progressHideTimeout) {
      clearTimeout(progressHideTimeout);
    }
  });

  video.addEventListener('play', () => {
    showProgressBar();
  });
}

/**
 * Cleanup video controls
 */
export function cleanupVideoControls() {
  const progressBar = document.querySelector('.video-progress');
  if (progressBar) {
    progressBar.remove();
  }

  if (progressHideTimeout) {
    clearTimeout(progressHideTimeout);
    progressHideTimeout = null;
  }
}

/**
 * Hide the "Video unavailable (slow connection)" icon when video successfully plays
 */
function hideVideoUnavailableIcon() {
  const videoOffIcon = document.querySelector('.info-icon img[src*="video-off.svg"]');
  if (videoOffIcon && videoOffIcon.parentElement) {
    videoOffIcon.parentElement.style.display = 'none';
    log('Hidden video unavailable icon after successful video playback');
  }
}

/**
 * Show poster image, hide video
 */
export function showPosterImage() {
  const videoEl = document.querySelector('.background-video');
  const posterEl = document.querySelector('.background-image');

  if (videoEl) {
    videoEl.classList.add('hidden');
  }
  if (posterEl) {
    posterEl.classList.remove('hidden');
    posterEl.classList.remove('video-fallback');

    const birdInfo = getBirdInfo();
    if (posterEl.naturalWidth === 0 && birdInfo && birdInfo.imageUrl) {
      log('Image not loaded, attempting to reload');
      // Note: setImageSource will be called from script.js
    }
  }
  log('Showing poster image');
}

/**
 * Show video, hide poster
 */
export function showVideoElement() {
  const videoEl = document.querySelector('.background-video');
  const posterEl = document.querySelector('.background-image');

  if (videoEl) {
    videoEl.classList.remove('hidden');
  }
  if (posterEl) {
    posterEl.classList.add('video-fallback');
  }
  log('Showing video element');
}

/**
 * Create a new VideoVisibilityManager instance
 */
export function createVideoVisibilityManager(videoElement, birdData) {
  if (videoVisibilityManager) {
    videoVisibilityManager.destroy();
  }
  videoVisibilityManager = new VideoVisibilityManager(videoElement, birdData);
  return videoVisibilityManager;
}

/**
 * Destroy the current VideoVisibilityManager instance
 */
export function destroyVideoVisibilityManager() {
  if (videoVisibilityManager) {
    videoVisibilityManager.destroy();
    videoVisibilityManager = null;
  }
}

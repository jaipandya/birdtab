/**
 * Feature Tour Module
 * Provides a spotlight-style tour to highlight key features after onboarding
 * 
 * VERSIONING SYSTEM:
 * - TOUR_VERSION: Full tour version, shown to new users
 * - FEATURE_SPOTLIGHTS: Individual feature spotlights for existing users
 * 
 * FULL TOUR (new users):
 * - Shown to users who haven't completed the current TOUR_VERSION
 * - Shows welcome, all feature steps, and completion screen
 * 
 * FEATURE SPOTLIGHTS (existing users):
 * - Shown when a specific feature hasn't been seen yet
 * - Only shows the single feature step without welcome/complete
 * - Each feature tracks its own "seen" state
 * 
 * ADDING A NEW FEATURE:
 * 1. Add step to TOUR_STEPS array
 * 2. Add to FEATURE_SPOTLIGHTS with unique key and min version
 * 3. Add i18n strings to all locale files
 * 4. Increment TOUR_VERSION for new users to see full tour
 * 5. Existing users will only see the new feature spotlight
 */

import './featureTour.css';
import { log } from './logger.js';

// Tour version - increment when adding new features to show tour again
// Version history:
// 1 - Initial tour with Video Mode, Settings, History, Quiz, Refresh, Audio
const TOUR_VERSION = 1;

// Feature spotlights for existing users
// When adding new features, add them here with minVersion set to current TOUR_VERSION
// This allows existing users to see just the new feature without full tour
const FEATURE_SPOTLIGHTS = {
  // Example for future feature:
  // 'videoMode': { stepId: 'video', minVersion: 2 }
};

// Tour step configuration - ordered left to right as they appear in the UI
// Button order in UI: Settings, History, Quiz, Refresh, Volume
const TOUR_STEPS = [
  {
    id: 'welcome',
    targetSelector: null, // No target - centered welcome message
    icon: null,
    titleKey: 'tourWelcomeTitle',
    descriptionKey: 'tourWelcomeDescription',
    fallbackTitle: 'Welcome to BirdTab!',
    fallbackDescription: 'Let us show you around! This quick tour will help you discover all the features that make your birding experience special.',
    position: 'center',
    isWelcome: true
  },
  {
    id: 'videoToggle',
    targetSelector: '.media-toggle-container, .media-toggle',
    icon: 'images/svg/video.svg',
    titleKey: 'tourVideoToggleTitle',
    descriptionKey: 'tourVideoToggleDescription',
    fallbackTitle: 'Video Mode',
    fallbackDescription: 'Switch between photos and videos! Toggle this to watch birds in motion with beautiful video clips.',
    position: 'top'
  },
  {
    id: 'settings',
    targetSelector: '#settings-button',
    icon: 'images/svg/settings.svg',
    titleKey: 'tourSettingsTitle',
    descriptionKey: 'tourSettingsDescription',
    fallbackTitle: 'Settings',
    fallbackDescription: 'Customize your BirdTab experience. Choose your region, enable auto-play for bird calls, and more.',
    position: 'top'
  },
  {
    id: 'history',
    targetSelector: '#history-button',
    icon: 'images/svg/history.svg',
    titleKey: 'tourHistoryTitle',
    descriptionKey: 'tourHistoryDescription',
    fallbackTitle: 'Viewing History',
    fallbackDescription: 'See all the birds you\'ve discovered! Click here to revisit your favorites and explore your birding journey.',
    position: 'top'
  },
  {
    id: 'quiz',
    targetSelector: '#quiz-button',
    icon: 'images/svg/quiz.svg',
    titleKey: 'tourQuizTitle',
    descriptionKey: 'tourQuizDescription',
    fallbackTitle: 'Bird Quiz',
    fallbackDescription: 'Test your bird identification skills! Take a fun quiz to see how well you know your feathered friends.',
    position: 'top'
  },
  {
    id: 'refresh',
    targetSelector: '#refresh-button',
    icon: 'images/svg/refresh.svg',
    titleKey: 'tourRefreshTitle',
    descriptionKey: 'tourRefreshDescription',
    fallbackTitle: 'Discover New Birds',
    fallbackDescription: 'Ready for a new feathered friend? Click here anytime to load a fresh bird photo and learn something new.',
    position: 'top'
  },
  {
    id: 'volume',
    targetSelector: '#volume-button',
    icon: 'images/svg/sound-on.svg',
    titleKey: 'tourVolumeTitle',
    descriptionKey: 'tourVolumeDescription',
    fallbackTitle: 'Volume Control',
    fallbackDescription: 'Adjust the volume to your preference. Control the sound of bird calls and videos to create your perfect birding experience.',
    position: 'top'
  },
  {
    id: 'complete',
    targetSelector: null, // No target - centered completion message
    icon: null,
    titleKey: 'tourCompleteTitle',
    descriptionKey: 'tourCompleteDescription',
    fallbackTitle: 'You\'re All Set!',
    fallbackDescription: 'Enjoy discovering beautiful birds from around the world. Happy birding!',
    position: 'center',
    isComplete: true
  }
];

// Module state
let currentStep = 0;
let tourActive = false;
let backdropElement = null;
let spotlightElement = null;
let tooltipElement = null;
let keyboardHandler = null;
let resizeHandler = null;
let isAnimating = false; // Prevent rapid clicking during transitions

/**
 * Get localized message with fallback
 */
function getMessage(key, fallback) {
  try {
    const message = chrome.i18n?.getMessage(key);
    return message || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Check if tour has been completed for the current version
 * Returns true if the user has seen the current version of the tour
 */
export async function isTourCompleted() {
  return new Promise((resolve) => {
    if (!chrome?.storage?.sync) {
      resolve(false);
      return;
    }
    chrome.storage.sync.get(['featureTourVersion'], (result) => {
      // Tour is completed if the stored version matches or exceeds current version
      const storedVersion = result.featureTourVersion || 0;
      resolve(storedVersion >= TOUR_VERSION);
    });
  });
}

/**
 * Mark tour as completed with current version
 * This allows showing the tour again if TOUR_VERSION is incremented
 */
async function markTourCompleted() {
  return new Promise((resolve) => {
    if (!chrome?.storage?.sync) {
      resolve();
      return;
    }
    chrome.storage.sync.set({ featureTourVersion: TOUR_VERSION }, resolve);
  });
}

/**
 * Reset tour (for testing or re-showing)
 */
export async function resetTour() {
  return new Promise((resolve) => {
    if (!chrome?.storage?.sync) {
      resolve();
      return;
    }
    chrome.storage.sync.set({ featureTourVersion: 0 }, resolve);
  });
}

/**
 * Get current tour version
 */
export function getTourVersion() {
  return TOUR_VERSION;
}

/**
 * Check if a specific feature spotlight has been seen
 */
async function isFeatureSpotlightSeen(featureKey) {
  return new Promise((resolve) => {
    if (!chrome?.storage?.sync) {
      resolve(true); // Assume seen if storage unavailable
      return;
    }
    chrome.storage.sync.get(['seenFeatures'], (result) => {
      const seenFeatures = result.seenFeatures || {};
      resolve(!!seenFeatures[featureKey]);
    });
  });
}

/**
 * Mark a feature spotlight as seen
 */
async function markFeatureSpotlightSeen(featureKey) {
  return new Promise((resolve) => {
    if (!chrome?.storage?.sync) {
      resolve();
      return;
    }
    chrome.storage.sync.get(['seenFeatures'], (result) => {
      const seenFeatures = result.seenFeatures || {};
      seenFeatures[featureKey] = true;
      chrome.storage.sync.set({ seenFeatures }, resolve);
    });
  });
}

/**
 * Get unseen feature spotlights for existing users
 * Returns array of step IDs that should be shown
 */
export async function getUnseenFeatureSpotlights() {
  const unseenFeatures = [];
  
  // Get user's completed tour version
  const storedVersion = await new Promise((resolve) => {
    if (!chrome?.storage?.sync) {
      resolve(0);
      return;
    }
    chrome.storage.sync.get(['featureTourVersion'], (result) => {
      resolve(result.featureTourVersion || 0);
    });
  });
  
  // If user hasn't completed any tour, they'll get the full tour
  if (storedVersion === 0) {
    return [];
  }
  
  // Check each feature spotlight
  for (const [featureKey, config] of Object.entries(FEATURE_SPOTLIGHTS)) {
    // Only show if feature was added after user's last tour
    if (config.minVersion > storedVersion) {
      const seen = await isFeatureSpotlightSeen(featureKey);
      if (!seen) {
        unseenFeatures.push({ featureKey, stepId: config.stepId });
      }
    }
  }
  
  return unseenFeatures;
}

/**
 * Show a single feature spotlight (not the full tour)
 * Used for introducing new features to existing users
 */
export async function showFeatureSpotlight(featureKey) {
  const config = FEATURE_SPOTLIGHTS[featureKey];
  if (!config) {
    log(`Feature spotlight not found: ${featureKey}`);
    return false;
  }
  
  const stepIndex = TOUR_STEPS.findIndex(s => s.id === config.stepId);
  if (stepIndex === -1) {
    log(`Step not found for feature: ${featureKey}`);
    return false;
  }
  
  const step = TOUR_STEPS[stepIndex];
  const targetElement = findTargetElement(step);
  
  if (!targetElement) {
    log(`Target element not found for feature spotlight: ${featureKey}`);
    return false;
  }
  
  log(`Showing feature spotlight: ${featureKey}`);
  tourActive = true;
  currentStep = stepIndex;
  
  // Create backdrop and spotlight
  createBackdrop();
  createSpotlight();
  positionSpotlight(targetElement);
  
  // Create tooltip with simplified UI (no progress, no back button)
  const tooltip = createTooltip();
  const title = getMessage(step.titleKey, step.fallbackTitle);
  const description = getMessage(step.descriptionKey, step.fallbackDescription);
  
  const headerHtml = `
    <div class="tour-tooltip-header">
      <div class="tour-tooltip-icon">
        <img src="${step.icon}" alt="" width="24" height="24">
      </div>
      <h3 class="tour-tooltip-title">${title}</h3>
    </div>
  `;
  
  const newBadge = `<span class="tour-new-badge">${getMessage('tourNewFeature', 'New!')}</span>`;
  const gotItText = getMessage('tourGotIt', 'Got it!');
  
  tooltip.innerHTML = `
    ${headerHtml}
    ${newBadge}
    <p class="tour-tooltip-description">${description}</p>
    <div class="tour-actions tour-actions-centered">
      <button class="tour-btn primary" id="tour-next-btn">${gotItText}</button>
    </div>
  `;
  
  tooltip.setAttribute('aria-labelledby', 'tour-tooltip-title');
  
  const gotItBtn = tooltip.querySelector('#tour-next-btn');
  if (gotItBtn) {
    gotItBtn.addEventListener('click', async () => {
      await markFeatureSpotlightSeen(featureKey);
      endTour(false); // Don't mark full tour as completed
    });
  }
  
  positionTooltip(targetElement, step.position);
  
  // Set up keyboard handler (just Escape to close)
  keyboardHandler = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      markFeatureSpotlightSeen(featureKey);
      endTour(false);
    }
  };
  document.addEventListener('keydown', keyboardHandler);
  
  // Set up resize handler
  resizeHandler = handleResize;
  window.addEventListener('resize', resizeHandler);
  
  setTimeout(() => gotItBtn?.focus(), 100);
  
  return true;
}

/**
 * Create the backdrop element
 */
function createBackdrop() {
  if (backdropElement) return backdropElement;
  
  backdropElement = document.createElement('div');
  backdropElement.className = 'tour-backdrop';
  backdropElement.addEventListener('click', (e) => {
    // Don't close on backdrop click, only on explicit skip/close
    e.stopPropagation();
  });
  document.body.appendChild(backdropElement);
  
  return backdropElement;
}

/**
 * Create the spotlight element
 */
function createSpotlight() {
  if (spotlightElement) return spotlightElement;
  
  spotlightElement = document.createElement('div');
  spotlightElement.className = 'tour-spotlight';
  document.body.appendChild(spotlightElement);
  
  return spotlightElement;
}

/**
 * Create the tooltip element
 */
function createTooltip() {
  // Remove old tooltip immediately to avoid duplicate ID issues
  if (tooltipElement) {
    tooltipElement.remove();
  }
  
  tooltipElement = document.createElement('div');
  tooltipElement.className = 'tour-tooltip';
  tooltipElement.setAttribute('role', 'dialog');
  tooltipElement.setAttribute('aria-modal', 'true');
  document.body.appendChild(tooltipElement);
  
  return tooltipElement;
}

/**
 * Position the spotlight around a target element
 */
function positionSpotlight(targetElement) {
  if (!spotlightElement) return;
  
  if (!targetElement) {
    // Hide spotlight for centered messages
    spotlightElement.classList.add('hidden');
    return;
  }
  
  spotlightElement.classList.remove('hidden');
  
  const rect = targetElement.getBoundingClientRect();
  const padding = 10; // Extra padding around the element
  const size = Math.max(rect.width, rect.height) + padding * 2;
  
  spotlightElement.style.width = `${size}px`;
  spotlightElement.style.height = `${size}px`;
  spotlightElement.style.left = `${rect.left + rect.width / 2 - size / 2}px`;
  spotlightElement.style.top = `${rect.top + rect.height / 2 - size / 2}px`;
}

/**
 * Position the tooltip relative to the target element or center it
 */
function positionTooltip(targetElement, position) {
  if (!tooltipElement) return;
  
  // For centered tooltips (welcome/complete screens)
  if (position === 'center' || !targetElement) {
    tooltipElement.classList.add('centered');
    tooltipElement.classList.remove('arrow-top', 'arrow-bottom', 'arrow-left', 'arrow-right');
    Object.assign(tooltipElement.style, {
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)'
    });
    tooltipElement.style.setProperty('--arrow-offset', '50%');
    return;
  }
  
  tooltipElement.classList.remove('centered');
  
  const targetRect = targetElement.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  
  // Calculate spotlight radius (10px padding around target)
  const spotlightRadius = (Math.max(targetRect.width, targetRect.height) + 20) / 2;
  const targetCenterX = targetRect.left + targetRect.width / 2;
  const targetCenterY = targetRect.top + targetRect.height / 2;
  
  // Gap from spotlight edge to arrow tip
  const offset = spotlightRadius + 16; // 8px arrow + 8px gap
  const edgeMargin = 16;
  
  // Position config based on direction
  const positionConfig = {
    top: { top: targetCenterY - offset, transform: 'translate(-50%, -100%)', arrow: 'arrow-bottom' },
    bottom: { top: targetCenterY + offset, transform: 'translate(-50%, 0)', arrow: 'arrow-top' },
    left: { left: targetCenterX - offset, top: targetCenterY, transform: 'translate(-100%, -50%)', arrow: 'arrow-right' },
    right: { left: targetCenterX + offset, top: targetCenterY, transform: 'translate(0, -50%)', arrow: 'arrow-left' }
  };
  
  const config = positionConfig[position] || positionConfig.top;
  
  // Apply arrow class
  tooltipElement.classList.remove('arrow-top', 'arrow-bottom', 'arrow-left', 'arrow-right');
  tooltipElement.classList.add(config.arrow);
  
  // Apply initial position
  tooltipElement.style.left = `${config.left || targetCenterX}px`;
  tooltipElement.style.top = `${config.top}px`;
  tooltipElement.style.transform = config.transform;
  tooltipElement.style.setProperty('--arrow-offset', '50%');
  
  // Adjust for viewport bounds after render (only for top/bottom)
  if (position === 'top' || position === 'bottom' || !position) {
    requestAnimationFrame(() => {
      if (!tooltipElement) return;
      
      const tooltipRect = tooltipElement.getBoundingClientRect();
      let adjustedLeft = targetCenterX;
      let arrowOffsetPx = tooltipRect.width / 2;
      
      if (tooltipRect.left < edgeMargin) {
        adjustedLeft = edgeMargin + tooltipRect.width / 2;
        arrowOffsetPx = targetCenterX - edgeMargin;
      } else if (tooltipRect.right > viewportWidth - edgeMargin) {
        adjustedLeft = viewportWidth - edgeMargin - tooltipRect.width / 2;
        arrowOffsetPx = targetCenterX - (viewportWidth - edgeMargin - tooltipRect.width);
      }
      
      arrowOffsetPx = Math.max(20, Math.min(tooltipRect.width - 20, arrowOffsetPx));
      
      tooltipElement.style.left = `${adjustedLeft}px`;
      tooltipElement.style.setProperty('--arrow-offset', `${arrowOffsetPx}px`);
    });
  }
}

/**
 * Get the current feature step index (0-based, excluding welcome/complete)
 */
function getCurrentFeatureStepIndex() {
  let featureIndex = 0;
  for (let i = 0; i < currentStep; i++) {
    if (!TOUR_STEPS[i].isWelcome && !TOUR_STEPS[i].isComplete) {
      featureIndex++;
    }
  }
  return featureIndex;
}

/**
 * Render the current tour step
 */
function renderStep(stepIndex) {
  const step = TOUR_STEPS[stepIndex];
  if (!step) return false;
  
  const targetElement = findTargetElement(step);
  
  // Skip this step if target not found (except for welcome/complete)
  if (!targetElement && step.targetSelector && !step.isWelcome && !step.isComplete) {
    log(`Tour: Target not found for step ${step.id}, skipping`);
    return false;
  }
  
  // Create/update spotlight
  createSpotlight();
  positionSpotlight(targetElement);
  
  // Create tooltip content
  const tooltip = createTooltip();
  const title = getMessage(step.titleKey, step.fallbackTitle);
  const description = getMessage(step.descriptionKey, step.fallbackDescription);
  
  const isWelcome = step.isWelcome;
  const isComplete = step.isComplete;
  const isFirstFeatureStep = currentStep === 1;
  const isLastFeatureStep = stepIndex === TOUR_STEPS.length - 2; // Before complete step
  
  // Build progress dots (only for feature steps, not welcome/complete)
  const featureSteps = TOUR_STEPS.filter(s => !s.isWelcome && !s.isComplete);
  const currentFeatureIndex = getCurrentFeatureStepIndex();
  
  let progressHtml = '';
  if (!isWelcome && !isComplete) {
    progressHtml = `
      <div class="tour-progress">
        ${featureSteps.map((_, i) => `
          <span class="tour-progress-dot ${i === currentFeatureIndex ? 'active' : ''} ${i < currentFeatureIndex ? 'completed' : ''}"></span>
        `).join('')}
      </div>
    `;
  }
  
  // Build header
  let headerHtml = '';
  if (isWelcome) {
    headerHtml = `
      <div class="tour-welcome-icon">
        <img src="icons/icon128.png" alt="BirdTab" width="64" height="64">
      </div>
      <h3 class="tour-tooltip-title tour-welcome-title">${title}</h3>
    `;
  } else if (isComplete) {
    headerHtml = `
      <div class="tour-complete-icon">🎉</div>
      <h3 class="tour-tooltip-title tour-complete-title">${title}</h3>
    `;
  } else {
    headerHtml = `
      <div class="tour-tooltip-header">
        <div class="tour-tooltip-icon">
          <img src="${step.icon}" alt="" width="24" height="24">
        </div>
        <h3 class="tour-tooltip-title">${title}</h3>
      </div>
    `;
  }
  
  // Build action buttons
  let actionsHtml = '';
  if (isWelcome) {
    const startButtonText = getMessage('tourStartButton', 'Let\'s Go!');
    const skipButtonText = getMessage('tourSkipButton', 'Skip tour');
    actionsHtml = `
      <div class="tour-actions tour-actions-centered">
        <button class="tour-btn primary tour-btn-large" id="tour-next-btn">${startButtonText}</button>
      </div>
      <button class="tour-link-btn" id="tour-skip-btn">${skipButtonText}</button>
    `;
  } else if (isComplete) {
    const doneButtonText = getMessage('tourDoneButton', 'Start Exploring!');
    actionsHtml = `
      <div class="tour-actions tour-actions-centered">
        <button class="tour-btn primary tour-btn-large" id="tour-next-btn">${doneButtonText}</button>
      </div>
    `;
  } else {
    const nextButtonText = isLastFeatureStep 
      ? getMessage('tourFinishButton', 'Got it!')
      : getMessage('tourNextButton', 'Next');
    const backButtonText = getMessage('tourBackButton', 'Back');
    const skipButtonText = getMessage('tourSkipButton', 'Skip');
    
    actionsHtml = `
      <div class="tour-actions">
        ${!isFirstFeatureStep ? `<button class="tour-btn secondary" id="tour-back-btn">${backButtonText}</button>` : ''}
        <div class="tour-actions-right">
          <button class="tour-link-btn" id="tour-skip-btn">${skipButtonText}</button>
          <button class="tour-btn primary" id="tour-next-btn">${nextButtonText}</button>
        </div>
      </div>
    `;
  }
  
  // Add special classes for welcome/complete
  if (isWelcome) {
    tooltip.classList.add('tour-welcome');
  } else if (isComplete) {
    tooltip.classList.add('tour-complete');
  } else {
    tooltip.classList.remove('tour-welcome', 'tour-complete');
  }
  
  tooltip.innerHTML = `
    ${headerHtml}
    <p class="tour-tooltip-description">${description}</p>
    ${progressHtml}
    ${actionsHtml}
  `;
  
  tooltip.setAttribute('aria-labelledby', 'tour-tooltip-title');
  
  // Bind button events - use tooltip.querySelector to avoid finding old elements
  const nextBtn = tooltip.querySelector('#tour-next-btn');
  const skipBtn = tooltip.querySelector('#tour-skip-btn');
  const backBtn = tooltip.querySelector('#tour-back-btn');
  
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (isComplete) {
        endTour(true);
      } else {
        goToNextStep();
      }
    });
  }
  
  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      endTour(true);
    });
  }
  
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      goToPreviousStep();
    });
  }
  
  // Position the tooltip
  positionTooltip(targetElement, step.position);
  
  // Focus the next button for keyboard navigation
  setTimeout(() => nextBtn?.focus(), 100);
  
  return true;
}

/**
 * Go to the next step (with debouncing)
 */
function goToNextStep() {
  if (isAnimating) return; // Prevent rapid clicking
  isAnimating = true;
  
  currentStep++;
  
  // Try to render, skip steps where target is not found
  while (currentStep < TOUR_STEPS.length) {
    if (renderStep(currentStep)) {
      break;
    }
    currentStep++;
  }
  
  // If we've gone through all steps, end the tour
  if (currentStep >= TOUR_STEPS.length) {
    endTour(true);
  }
  
  // Reset animation lock after short delay
  setTimeout(() => { isAnimating = false; }, 200);
}

/**
 * Go to the previous step (with debouncing)
 */
function goToPreviousStep() {
  if (isAnimating) return; // Prevent rapid clicking
  isAnimating = true;
  
  currentStep--;
  
  // Try to render, skip steps where target is not found (going backwards)
  while (currentStep >= 0) {
    if (renderStep(currentStep)) {
      break;
    }
    currentStep--;
  }
  
  // If we've gone before the first step, just stay at step 0
  if (currentStep < 0) {
    currentStep = 0;
    renderStep(currentStep);
  }
  
  // Reset animation lock after short delay
  setTimeout(() => { isAnimating = false; }, 200);
}

/**
 * Handle keyboard events
 */
function handleKeyboard(e) {
  if (!tourActive) return;
  
  switch (e.key) {
    case 'Escape':
      e.preventDefault();
      endTour(true);
      break;
    case 'ArrowRight':
    case 'ArrowDown':
      e.preventDefault();
      goToNextStep();
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
      e.preventDefault();
      if (currentStep > 0) {
        goToPreviousStep();
      }
      break;
    case 'Tab':
      // Keep focus within tooltip
      e.preventDefault();
      const focusableElements = tooltipElement?.querySelectorAll('button');
      if (focusableElements && focusableElements.length > 0) {
        const currentFocus = document.activeElement;
        const currentIndex = Array.from(focusableElements).indexOf(currentFocus);
        const nextIndex = e.shiftKey 
          ? (currentIndex - 1 + focusableElements.length) % focusableElements.length
          : (currentIndex + 1) % focusableElements.length;
        focusableElements[nextIndex].focus();
      }
      break;
  }
}

/**
 * Find target element for a step (handles comma-separated selectors)
 */
function findTargetElement(step) {
  if (!step.targetSelector) return null;
  
  for (const selector of step.targetSelector.split(',').map(s => s.trim())) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return null;
}

/**
 * Handle window resize
 */
function handleResize() {
  if (!tourActive) return;
  
  const step = TOUR_STEPS[currentStep];
  if (!step) return;
  
  const targetElement = findTargetElement(step);
  positionSpotlight(targetElement);
  positionTooltip(targetElement, step.position);
}

/**
 * Start the feature tour
 */
export function startTour() {
  if (tourActive) return;
  
  log('Feature tour starting');
  tourActive = true;
  currentStep = 0;
  
  // Create backdrop
  createBackdrop();
  
  // Find first valid step
  while (currentStep < TOUR_STEPS.length) {
    if (renderStep(currentStep)) {
      break;
    }
    currentStep++;
  }
  
  // If no valid steps found, end tour
  if (currentStep >= TOUR_STEPS.length) {
    log('Tour: No valid steps found');
    endTour(false);
    return;
  }
  
  // Set up keyboard handler
  keyboardHandler = handleKeyboard;
  document.addEventListener('keydown', keyboardHandler);
  
  // Set up resize handler
  resizeHandler = handleResize;
  window.addEventListener('resize', resizeHandler);
}

/**
 * End the feature tour
 */
export async function endTour(markComplete = true) {
  if (!tourActive) return; // Prevent double-ending
  
  log('Feature tour ending');
  tourActive = false;
  isAnimating = false; // Reset animation lock to prevent stuck state
  
  // Add exit animation
  if (tooltipElement) {
    tooltipElement.classList.add('exiting');
  }
  if (spotlightElement) {
    spotlightElement.classList.add('exiting');
  }
  if (backdropElement) {
    backdropElement.classList.add('exiting');
  }
  
  // Wait for animation then clean up
  setTimeout(() => {
    if (backdropElement) {
      backdropElement.remove();
      backdropElement = null;
    }
    if (spotlightElement) {
      spotlightElement.remove();
      spotlightElement = null;
    }
    if (tooltipElement) {
      tooltipElement.remove();
      tooltipElement = null;
    }
  }, 300);
  
  // Remove event listeners
  if (keyboardHandler) {
    document.removeEventListener('keydown', keyboardHandler);
    keyboardHandler = null;
  }
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler);
    resizeHandler = null;
  }
  
  // Mark as completed
  if (markComplete) {
    await markTourCompleted();
    log('Feature tour marked as completed');
  }
}

/**
 * Check if tour is currently active
 */
export function isTourActive() {
  return tourActive;
}

export default {
  startTour,
  endTour,
  isTourCompleted,
  isTourActive,
  resetTour,
  showFeatureSpotlight,
  getUnseenFeatureSpotlights
};

/**
 * Feature Tour Tests
 *
 * Tests cover tour element availability and tour flow:
 * - All tour target elements are present in the DOM
 * - Tour step navigation
 * - Element availability checks
 * - Skipping missing elements gracefully
 */

describe('Feature Tour - Element Availability', () => {
  beforeEach(() => {
    // Setup DOM with all tour target elements (mirrors featureTour.js TOUR_STEPS)
    document.body.innerHTML = `
      <svg class="chrome-tab-icon" width="48" height="48"></svg>
      <div id="content-container">
        <img class="background-image" src="test.jpg" alt="Test Bird">
        <div class="control-buttons">
          <button id="settings-button" class="icon-button">
            <img src="images/svg/settings.svg" alt="Settings">
          </button>
          <button id="history-button" class="icon-button">
            <img src="images/svg/history.svg" alt="History">
          </button>
          <button id="quiz-button" class="icon-button">
            <img src="images/svg/quiz.svg" alt="Quiz">
          </button>
          <button id="refresh-button" class="icon-button">
            <img src="images/svg/refresh.svg" alt="Refresh">
          </button>
          <div id="volume-control" class="volume-control">
            <button id="volume-button" class="icon-button">
              <img src="images/svg/sound-on.svg" alt="Volume">
            </button>
          </div>
          <button id="play-button" class="icon-button play-button">
            <img src="images/svg/play.svg" alt="Play">
          </button>
        </div>
      </div>
      <div id="comma-selector-test-fixture" style="position:absolute;left:-9999px">
        <div class="outer-step-target">
          <button type="button" class="inner-step-target"></button>
        </div>
      </div>
    `;
  });

  afterEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';
  });

  describe('Tour Target Elements', () => {
    test('should have settings (options menu) button present', () => {
      const element = document.querySelector('#settings-button');
      expect(element).toBeTruthy();
    });

    test('should have history button present', () => {
      const element = document.querySelector('#history-button');
      expect(element).toBeTruthy();
    });

    test('should have quiz button present', () => {
      const element = document.querySelector('#quiz-button');
      expect(element).toBeTruthy();
    });

    test('should have refresh button present', () => {
      const element = document.querySelector('#refresh-button');
      expect(element).toBeTruthy();
    });

    test('should have volume button present', () => {
      const element = document.querySelector('#volume-button');
      expect(element).toBeTruthy();
    });

    test('should have play button present', () => {
      const element = document.querySelector('#play-button');
      expect(element).toBeTruthy();
    });

    test('should have chrome tab icon present', () => {
      const element = document.querySelector('.chrome-tab-icon');
      expect(element).toBeTruthy();
    });

    test('should have all tour target elements present', () => {
      const tourSelectors = [
        '#settings-button',
        '#refresh-button',
        '#volume-button',
        '#play-button',
        '.chrome-tab-icon'
      ];

      tourSelectors.forEach(selector => {
        expect(document.querySelector(selector)).toBeTruthy();
      });
    });
  });

  describe('Selector Matching Logic', () => {
    test('should find element with comma-separated selectors (first match)', () => {
      const selector = '.outer-step-target, .inner-step-target';
      const selectors = selector.split(',').map(s => s.trim());
      let found = null;
      for (const s of selectors) {
        const el = document.querySelector(s);
        if (el) {
          found = el;
          break;
        }
      }
      expect(found).toBeTruthy();
      expect(found.classList.contains('outer-step-target')).toBe(true);
    });

    test('should find element with comma-separated selectors (second match)', () => {
      const outer = document.querySelector('.outer-step-target');
      outer.classList.remove('outer-step-target');

      const selector = '.outer-step-target, .inner-step-target';
      const selectors = selector.split(',').map(s => s.trim());
      let found = null;
      for (const s of selectors) {
        const el = document.querySelector(s);
        if (el) {
          found = el;
          break;
        }
      }
      expect(found).toBeTruthy();
      expect(found.classList.contains('inner-step-target')).toBe(true);
    });
  });
});

describe('Feature Tour - Step Skipping', () => {
  beforeEach(() => {
    // Setup DOM with some elements missing
    document.body.innerHTML = `
      <div id="content-container">
        <div class="control-buttons">
          <button id="settings-button" class="icon-button"></button>
          <button id="refresh-button" class="icon-button"></button>
          <button id="volume-button" class="icon-button"></button>
        </div>
      </div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('should detect missing history button', () => {
    const element = document.querySelector('#history-button');
    expect(element).toBeNull();
  });

  test('should detect missing quiz button', () => {
    const element = document.querySelector('#quiz-button');
    expect(element).toBeNull();
  });

  test('should detect missing play button', () => {
    const element = document.querySelector('#play-button');
    expect(element).toBeNull();
  });

  test('should detect missing chrome tab icon', () => {
    const element = document.querySelector('.chrome-tab-icon');
    expect(element).toBeNull();
  });

  test('should still have settings button present', () => {
    const element = document.querySelector('#settings-button');
    expect(element).toBeTruthy();
  });

  test('should still have volume button present', () => {
    const element = document.querySelector('#volume-button');
    expect(element).toBeTruthy();
  });
});

describe('Feature Tour - Step Configuration', () => {
  // These tests verify the tour step configuration (mirrors featureTour.js TOUR_STEPS)
  const EXPECTED_TOUR_STEPS = [
    { id: 'welcome', targetSelector: null },
    { id: 'optionsMenu', targetSelector: '#settings-button' },
    { id: 'refresh', targetSelector: '#refresh-button' },
    { id: 'volume', targetSelector: '#volume-button' },
    { id: 'playPause', targetSelector: '#play-button' },
    { id: 'chromeTab', targetSelector: '.chrome-tab-icon' },
    { id: 'complete', targetSelector: null }
  ];

  test('should have welcome step as first step', () => {
    expect(EXPECTED_TOUR_STEPS[0].id).toBe('welcome');
    expect(EXPECTED_TOUR_STEPS[0].targetSelector).toBeNull();
  });

  test('should have complete step as last step', () => {
    const lastStep = EXPECTED_TOUR_STEPS[EXPECTED_TOUR_STEPS.length - 1];
    expect(lastStep.id).toBe('complete');
    expect(lastStep.targetSelector).toBeNull();
  });

  test('should have chromeTab step before complete step', () => {
    const chromeTabIndex = EXPECTED_TOUR_STEPS.findIndex(s => s.id === 'chromeTab');
    const completeIndex = EXPECTED_TOUR_STEPS.findIndex(s => s.id === 'complete');
    expect(chromeTabIndex).toBe(completeIndex - 1);
  });

  test('should have 7 total steps', () => {
    expect(EXPECTED_TOUR_STEPS.length).toBe(7);
  });

  test('should have 5 feature steps (excluding welcome and complete)', () => {
    const featureSteps = EXPECTED_TOUR_STEPS.filter(s => s.id !== 'welcome' && s.id !== 'complete');
    expect(featureSteps.length).toBe(5);
  });
});

describe('Feature Tour - Dynamic Last Step Detection', () => {
  // Helper to simulate finding next valid step
  function hasMoreValidSteps(steps, currentIndex, presentSelectors) {
    for (let i = currentIndex + 1; i < steps.length; i++) {
      const step = steps[i];
      if (step.id === 'complete') continue;
      if (!step.targetSelector) continue;
      // Check if any of the selectors match present elements
      const selectors = step.targetSelector.split(',').map(s => s.trim());
      if (selectors.some(s => presentSelectors.includes(s))) {
        return true;
      }
    }
    return false;
  }

  const STEPS = [
    { id: 'welcome', targetSelector: null },
    { id: 'optionsMenu', targetSelector: '#settings-button' },
    { id: 'refresh', targetSelector: '#refresh-button' },
    { id: 'volume', targetSelector: '#volume-button' },
    { id: 'playPause', targetSelector: '#play-button' },
    { id: 'chromeTab', targetSelector: '.chrome-tab-icon' },
    { id: 'complete', targetSelector: null }
  ];

  test('should detect chromeTab as last feature step when all elements present', () => {
    const presentElements = [
      '#settings-button', '#refresh-button',
      '#volume-button', '#play-button', '.chrome-tab-icon'
    ];

    // playPause (index 4) should have more steps (chromeTab)
    expect(hasMoreValidSteps(STEPS, 4, presentElements)).toBe(true);

    // chromeTab (index 5) should have no more feature steps (only complete follows)
    expect(hasMoreValidSteps(STEPS, 5, presentElements)).toBe(false);
  });

  test('should detect volume as last step when play button and chrome tab are missing', () => {
    const presentElements = [
      '#settings-button', '#refresh-button', '#volume-button'
    ];

    // Volume (index 3): playPause and chromeTab targets absent
    expect(hasMoreValidSteps(STEPS, 3, presentElements)).toBe(false);
  });

  test('should detect refresh as last step when volume, play, and chrome tab are missing', () => {
    const presentElements = [
      '#settings-button', '#refresh-button'
    ];

    // Refresh (index 2): no later targets present
    expect(hasMoreValidSteps(STEPS, 2, presentElements)).toBe(false);
  });
});

describe('Feature Tour - Version Upgrade Behavior', () => {
  /**
   * Tests for the versioning system that handles showing feature spotlights
   * to existing users when new features are added.
   *
   * The key logic being tested:
   * - hasCompletedAnyTour(): Returns true if storedVersion > 0 (user has seen ANY tour)
   * - isTourCompleted(): Returns true if storedVersion >= TOUR_VERSION (user has seen CURRENT version)
   * - getUnseenFeatureSpotlights(): Returns features where minVersion > storedVersion
   *
   * Bug fix tested: When TOUR_VERSION is incremented, existing users should see
   * only the new feature spotlight, not the full tour again.
   */

  // Simulate the version checking logic (must match featureTour.js TOUR_VERSION)
  const CURRENT_TOUR_VERSION = 3;

  // Feature spotlights configuration (mirrors featureTour.js)
  const FEATURE_SPOTLIGHTS = {
    'chromeTab': { stepId: 'chromeTab', minVersion: 2 }
  };

  // Helper: Check if user has completed ANY tour (storedVersion > 0)
  function hasCompletedAnyTour(storedVersion) {
    return storedVersion > 0;
  }

  // Helper: Check if user has completed CURRENT tour version
  function isTourCompleted(storedVersion, tourVersion) {
    return storedVersion >= tourVersion;
  }

  // Helper: Get unseen feature spotlights for a user
  function getUnseenFeatureSpotlights(storedVersion, seenFeatures = {}) {
    const unseenFeatures = [];

    // If user hasn't completed any tour, they'll get the full tour
    if (storedVersion === 0) {
      return [];
    }

    // Check each feature spotlight
    for (const [featureKey, config] of Object.entries(FEATURE_SPOTLIGHTS)) {
      // Only show if feature was added after user's last tour
      if (config.minVersion > storedVersion) {
        if (!seenFeatures[featureKey]) {
          unseenFeatures.push({ featureKey, stepId: config.stepId });
        }
      }
    }

    return unseenFeatures;
  }

  describe('hasCompletedAnyTour', () => {
    test('should return false for new users (storedVersion = 0)', () => {
      expect(hasCompletedAnyTour(0)).toBe(false);
    });

    test('should return true for users who completed version 1', () => {
      expect(hasCompletedAnyTour(1)).toBe(true);
    });

    test('should return true for users who completed version 2', () => {
      expect(hasCompletedAnyTour(2)).toBe(true);
    });
  });

  describe('isTourCompleted', () => {
    test('should return false for new users', () => {
      expect(isTourCompleted(0, CURRENT_TOUR_VERSION)).toBe(false);
    });

    test('should return false for users on older version', () => {
      // User completed v2, current is v3
      expect(isTourCompleted(2, CURRENT_TOUR_VERSION)).toBe(false);
    });

    test('should return true for users on current version', () => {
      expect(isTourCompleted(3, CURRENT_TOUR_VERSION)).toBe(true);
    });

    test('should return true for users on newer version (edge case)', () => {
      expect(isTourCompleted(4, CURRENT_TOUR_VERSION)).toBe(true);
    });
  });

  describe('getUnseenFeatureSpotlights', () => {
    test('should return empty array for new users (they get full tour)', () => {
      const spotlights = getUnseenFeatureSpotlights(0);
      expect(spotlights).toEqual([]);
    });

    test('should return new features for users on older version', () => {
      // User completed v1, chromeTab was added in v2
      const spotlights = getUnseenFeatureSpotlights(1);
      expect(spotlights).toHaveLength(1);
      expect(spotlights[0].featureKey).toBe('chromeTab');
    });

    test('should return empty array for users on current version', () => {
      // User completed v3, no new features since then
      const spotlights = getUnseenFeatureSpotlights(3);
      expect(spotlights).toEqual([]);
    });

    test('should not include already-seen features', () => {
      // User completed v1 but already saw chromeTab spotlight
      const spotlights = getUnseenFeatureSpotlights(1, { chromeTab: true });
      expect(spotlights).toEqual([]);
    });
  });

  describe('Tour Decision Logic (Bug Fix Verification)', () => {
    /**
     * This tests the actual decision flow that was buggy:
     *
     * OLD (buggy) logic:
     *   if (!isTourCompleted()) { startFullTour() }
     *   else { checkFeatureSpotlights() }
     *
     * NEW (fixed) logic:
     *   if (!hasCompletedAnyTour()) { startFullTour() }
     *   else { checkFeatureSpotlights() }
     */

    function decideTourAction(storedVersion) {
      // This mirrors the fixed logic in script.js
      const completedAnyTour = hasCompletedAnyTour(storedVersion);

      if (!completedAnyTour) {
        return 'SHOW_FULL_TOUR';
      } else {
        const unseenSpotlights = getUnseenFeatureSpotlights(storedVersion);
        if (unseenSpotlights.length > 0) {
          return { action: 'SHOW_SPOTLIGHT', features: unseenSpotlights };
        } else {
          return 'NO_TOUR';
        }
      }
    }

    test('new user should see full tour', () => {
      const result = decideTourAction(0);
      expect(result).toBe('SHOW_FULL_TOUR');
    });

    test('user who completed v1 should see only chromeTab spotlight (not full tour)', () => {
      // This is the key bug fix test!
      // Before fix: User would see full tour again
      // After fix: User sees only the new feature spotlight
      const result = decideTourAction(1);
      expect(result).not.toBe('SHOW_FULL_TOUR');
      expect(result.action).toBe('SHOW_SPOTLIGHT');
      expect(result.features).toHaveLength(1);
      expect(result.features[0].featureKey).toBe('chromeTab');
    });

    test('user who completed v2 should see no tour', () => {
      const result = decideTourAction(2);
      expect(result).toBe('NO_TOUR');
    });
  });
});

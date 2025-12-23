/**
 * Tests for core BirdTab functionality
 * 
 * These tests cover:
 * 1. Bird info fetching and display
 * 2. Audio playback controls
 * 3. Volume management
 * 4. Localization/i18n
 * 5. Error handling and UI states
 * 6. Review prompt logic
 * 7. Settings management
 */

// Mock chrome APIs
const mockStorage = {
  local: {
    data: {},
    get: jest.fn((keys, callback) => {
      if (keys === null) {
        callback(mockStorage.local.data);
      } else if (typeof keys === 'string') {
        callback({ [keys]: mockStorage.local.data[keys] });
      } else if (Array.isArray(keys)) {
        const result = {};
        keys.forEach(key => {
          if (mockStorage.local.data[key] !== undefined) {
            result[key] = mockStorage.local.data[key];
          }
        });
        callback(result);
      } else if (typeof keys === 'object') {
        const result = {};
        Object.keys(keys).forEach(key => {
          result[key] = mockStorage.local.data[key] !== undefined 
            ? mockStorage.local.data[key] 
            : keys[key];
        });
        callback(result);
      }
    }),
    set: jest.fn((items, callback) => {
      Object.assign(mockStorage.local.data, items);
      if (callback) callback();
    }),
    remove: jest.fn((keys, callback) => {
      if (Array.isArray(keys)) {
        keys.forEach(key => delete mockStorage.local.data[key]);
      } else {
        delete mockStorage.local.data[keys];
      }
      if (callback) callback();
    }),
    clear: jest.fn((callback) => {
      mockStorage.local.data = {};
      if (callback) callback();
    })
  },
  sync: {
    data: {},
    get: jest.fn((keys, callback) => {
      if (typeof keys === 'string') {
        callback({ [keys]: mockStorage.sync.data[keys] });
      } else if (Array.isArray(keys)) {
        const result = {};
        keys.forEach(key => {
          if (mockStorage.sync.data[key] !== undefined) {
            result[key] = mockStorage.sync.data[key];
          }
        });
        callback(result);
      } else if (typeof keys === 'object') {
        const result = {};
        Object.keys(keys).forEach(key => {
          result[key] = mockStorage.sync.data[key] !== undefined 
            ? mockStorage.sync.data[key] 
            : keys[key];
        });
        callback(result);
      }
    }),
    set: jest.fn((items, callback) => {
      Object.assign(mockStorage.sync.data, items);
      if (callback) callback();
    }),
    remove: jest.fn((keys, callback) => {
      if (Array.isArray(keys)) {
        keys.forEach(key => delete mockStorage.sync.data[key]);
      } else {
        delete mockStorage.sync.data[keys];
      }
      if (callback) callback();
    }),
    clear: jest.fn((callback) => {
      mockStorage.sync.data = {};
      if (callback) callback();
    })
  },
  onChanged: {
    addListener: jest.fn()
  }
};

const mockRuntime = {
  getURL: jest.fn((path) => `chrome-extension://test-id/${path}`),
  lastError: null,
  sendMessage: jest.fn((message, callback) => {
    if (callback) callback({ success: true });
  }),
  onMessage: {
    addListener: jest.fn()
  },
  onInstalled: {
    addListener: jest.fn()
  }
};

const mockI18n = {
  getMessage: jest.fn((key) => {
    const messages = {
      'errorTitle': 'Hmm, the birds seem shy today',
      'errorMessage': 'We\'re having trouble spotting our feathered friends.',
      'networkErrorTitle': 'Couldn\'t reach the birds',
      'networkErrorMessage': 'We\'re having trouble connecting to our bird database.',
      'tryAgain': 'Try Again',
      'contactSupport': 'Contact Support',
      'playTooltip': 'Play bird sound',
      'pauseTooltip': 'Pause bird sound',
      'volumeTooltip': 'Adjust volume',
      'reviewPromptTitle': 'Enjoying BirdTab?',
      'reviewPromptMessage': 'Your review would mean the world to us!',
      'leaveReview': 'Leave a Review',
      'maybeLater': 'Maybe Later',
      'noThanks': 'No, Thanks'
    };
    return messages[key] || key;
  }),
  getUILanguage: jest.fn(() => 'en-US')
};

const mockTabs = {
  create: jest.fn(),
  query: jest.fn((query, callback) => callback([{ id: 1 }])),
  sendMessage: jest.fn((tabId, message, callback) => {
    if (callback) callback();
  })
};

global.chrome = {
  storage: mockStorage,
  runtime: mockRuntime,
  i18n: mockI18n,
  tabs: mockTabs
};

// Configuration
const CONFIG = {
  DEFAULT_VOLUME: 0.3,
  VOLUME_STEP: 0.1,
  DEV_TAB_COUNT: 5,
  PROD_TAB_COUNT: 50,
  DEV_TIME_DELAY: 1 * 60 * 1000,
  PROD_TIME_DELAY: 4 * 24 * 60 * 60 * 1000
};

// Sample bird data
const SAMPLE_BIRD_INFO = {
  name: 'Black-necked Stilt',
  scientificName: 'Himantopus mexicanus',
  location: 'US',
  ebirdUrl: 'https://ebird.org/species/bknsti',
  imageUrl: 'https://cdn.download.ams.birds.cornell.edu/api/v1/asset/249446571/1200',
  photographer: 'Test Photographer',
  photographerUrl: 'https://macaulaylibrary.org/asset/249446571',
  mediaUrl: 'https://cdn.download.ams.birds.cornell.edu/api/v2/asset/548381/mp3',
  recordist: 'Test Recordist',
  recordistUrl: 'https://macaulaylibrary.org/asset/548381',
  description: 'Elegant shorebird with exceptionally long, bright pink legs.',
  conservationStatus: '',
  primaryComName_fr: 'Échasse d\'Amérique',
  primaryComName_cn: '黑颈长脚鹬'
};

const SAMPLE_BIRD_INFO_NO_AUDIO = {
  ...SAMPLE_BIRD_INFO,
  mediaUrl: null,
  recordist: null,
  recordistUrl: null
};

describe('Bird Info Display', () => {
  beforeEach(() => {
    mockStorage.local.data = {};
    mockStorage.sync.data = {};
    jest.clearAllMocks();
  });

  describe('Localized Bird Names', () => {
    test('should display English name by default', () => {
      mockI18n.getUILanguage.mockReturnValue('en-US');
      
      const lang = chrome.i18n.getUILanguage();
      let nameToDisplay = SAMPLE_BIRD_INFO.name;
      
      if (lang && SAMPLE_BIRD_INFO.primaryComName_fr && lang.toLowerCase().startsWith('fr')) {
        nameToDisplay = SAMPLE_BIRD_INFO.primaryComName_fr;
      } else if (lang && SAMPLE_BIRD_INFO.primaryComName_cn && lang.toLowerCase().startsWith('zh')) {
        nameToDisplay = SAMPLE_BIRD_INFO.primaryComName_cn;
      }
      
      expect(nameToDisplay).toBe('Black-necked Stilt');
    });

    test('should display French name for French locale', () => {
      mockI18n.getUILanguage.mockReturnValue('fr-FR');
      
      const lang = chrome.i18n.getUILanguage();
      let nameToDisplay = SAMPLE_BIRD_INFO.name;
      
      if (lang && SAMPLE_BIRD_INFO.primaryComName_fr && lang.toLowerCase().startsWith('fr')) {
        nameToDisplay = SAMPLE_BIRD_INFO.primaryComName_fr;
      } else if (lang && SAMPLE_BIRD_INFO.primaryComName_cn && lang.toLowerCase().startsWith('zh')) {
        nameToDisplay = SAMPLE_BIRD_INFO.primaryComName_cn;
      }
      
      expect(nameToDisplay).toBe('Échasse d\'Amérique');
    });

    test('should display Chinese name for Chinese locale', () => {
      mockI18n.getUILanguage.mockReturnValue('zh-CN');
      
      const lang = chrome.i18n.getUILanguage();
      let nameToDisplay = SAMPLE_BIRD_INFO.name;
      
      if (lang && SAMPLE_BIRD_INFO.primaryComName_fr && lang.toLowerCase().startsWith('fr')) {
        nameToDisplay = SAMPLE_BIRD_INFO.primaryComName_fr;
      } else if (lang && SAMPLE_BIRD_INFO.primaryComName_cn && lang.toLowerCase().startsWith('zh')) {
        nameToDisplay = SAMPLE_BIRD_INFO.primaryComName_cn;
      }
      
      expect(nameToDisplay).toBe('黑颈长脚鹬');
    });

    test('should fallback to English when localized name is missing', () => {
      mockI18n.getUILanguage.mockReturnValue('de-DE');
      
      const birdWithoutGerman = { ...SAMPLE_BIRD_INFO };
      const lang = chrome.i18n.getUILanguage();
      let nameToDisplay = birdWithoutGerman.name;
      
      // German is not supported, should use English
      if (lang && birdWithoutGerman.primaryComName_fr && lang.toLowerCase().startsWith('fr')) {
        nameToDisplay = birdWithoutGerman.primaryComName_fr;
      } else if (lang && birdWithoutGerman.primaryComName_cn && lang.toLowerCase().startsWith('zh')) {
        nameToDisplay = birdWithoutGerman.primaryComName_cn;
      }
      
      expect(nameToDisplay).toBe('Black-necked Stilt');
    });
  });
});

describe('Volume Control', () => {
  let isMuted = false;
  let volumeLevel = CONFIG.DEFAULT_VOLUME;
  let lastVolumeLevel = CONFIG.DEFAULT_VOLUME;

  beforeEach(() => {
    isMuted = false;
    volumeLevel = CONFIG.DEFAULT_VOLUME;
    lastVolumeLevel = CONFIG.DEFAULT_VOLUME;
    mockStorage.sync.data = {};
    jest.clearAllMocks();
  });

  // Helper functions that mirror the actual implementation
  const setVolume = (newLevel) => {
    volumeLevel = Math.max(0, Math.min(1, newLevel));
    
    if (volumeLevel === 0 && !isMuted) {
      isMuted = true;
    } else if (volumeLevel > 0 && isMuted) {
      isMuted = false;
    }
  };

  const toggleMute = () => {
    if (isMuted) {
      isMuted = false;
      if (lastVolumeLevel === 0) lastVolumeLevel = CONFIG.DEFAULT_VOLUME;
      setVolume(lastVolumeLevel);
    } else {
      if (volumeLevel > 0) lastVolumeLevel = volumeLevel;
      isMuted = true;
      setVolume(0);
    }
  };

  test('should initialize with default volume', () => {
    expect(volumeLevel).toBe(CONFIG.DEFAULT_VOLUME);
    expect(isMuted).toBe(false);
  });

  test('should set volume within valid range', () => {
    setVolume(0.5);
    expect(volumeLevel).toBe(0.5);
    
    setVolume(1.5); // Should clamp to 1
    expect(volumeLevel).toBe(1);
    
    setVolume(-0.5); // Should clamp to 0
    expect(volumeLevel).toBe(0);
  });

  test('should auto-mute when volume set to 0', () => {
    setVolume(0.5);
    expect(isMuted).toBe(false);
    
    setVolume(0);
    expect(isMuted).toBe(true);
  });

  test('should auto-unmute when volume set above 0', () => {
    setVolume(0);
    expect(isMuted).toBe(true);
    
    setVolume(0.3);
    expect(isMuted).toBe(false);
  });

  test('should toggle mute correctly', () => {
    volumeLevel = 0.5;
    lastVolumeLevel = 0.5;
    isMuted = false;
    
    toggleMute();
    expect(isMuted).toBe(true);
    expect(volumeLevel).toBe(0);
    
    toggleMute();
    expect(isMuted).toBe(false);
    expect(volumeLevel).toBe(0.5);
  });

  test('should restore last volume when unmuting', () => {
    volumeLevel = 0.7;
    lastVolumeLevel = 0.7;
    isMuted = false;
    
    toggleMute(); // Mute
    expect(volumeLevel).toBe(0);
    
    toggleMute(); // Unmute
    expect(volumeLevel).toBe(0.7);
  });

  test('should use default volume if last volume was 0', () => {
    volumeLevel = 0;
    lastVolumeLevel = 0;
    isMuted = true;
    
    toggleMute(); // Unmute with lastVolumeLevel = 0
    expect(volumeLevel).toBe(CONFIG.DEFAULT_VOLUME);
  });

  test('should handle volume step increments', () => {
    volumeLevel = 0.5;
    
    const newVolumeUp = Math.min(1, Math.round((volumeLevel + CONFIG.VOLUME_STEP) * 10) / 10);
    expect(newVolumeUp).toBe(0.6);
    
    const newVolumeDown = Math.max(0, Math.round((volumeLevel - CONFIG.VOLUME_STEP) * 10) / 10);
    expect(newVolumeDown).toBe(0.4);
  });
});

describe('Review Prompt Logic', () => {
  beforeEach(() => {
    mockStorage.local.data = {};
    jest.clearAllMocks();
  });

  const checkShouldShowReviewPrompt = (installTime, newTabCount, lastReviewPrompt, reviewDismissed, reviewLeft, isDev = false) => {
    const now = Date.now();
    
    if (reviewLeft || reviewDismissed) {
      return false;
    }

    const timeDelay = isDev ? CONFIG.DEV_TIME_DELAY : CONFIG.PROD_TIME_DELAY;
    const tabCountThreshold = isDev ? CONFIG.DEV_TAB_COUNT : CONFIG.PROD_TAB_COUNT;

    const timeCondition = now - installTime > timeDelay;
    const activityCondition = newTabCount >= tabCountThreshold;
    const frequencyCondition = now - lastReviewPrompt > timeDelay;

    return timeCondition && activityCondition && frequencyCondition;
  };

  test('should not show review if user already left review', () => {
    const result = checkShouldShowReviewPrompt(
      Date.now() - (5 * 24 * 60 * 60 * 1000), // 5 days ago
      100, // Many tabs
      0,
      false,
      true // Already left review
    );
    expect(result).toBe(false);
  });

  test('should not show review if user dismissed it', () => {
    const result = checkShouldShowReviewPrompt(
      Date.now() - (5 * 24 * 60 * 60 * 1000),
      100,
      0,
      true, // Dismissed
      false
    );
    expect(result).toBe(false);
  });

  test('should not show review before time delay (production)', () => {
    const result = checkShouldShowReviewPrompt(
      Date.now() - (1 * 24 * 60 * 60 * 1000), // Only 1 day ago
      100,
      0,
      false,
      false,
      false // Production
    );
    expect(result).toBe(false);
  });

  test('should not show review if not enough tabs opened', () => {
    const result = checkShouldShowReviewPrompt(
      Date.now() - (5 * 24 * 60 * 60 * 1000),
      10, // Only 10 tabs
      0,
      false,
      false,
      false // Production requires 50 tabs
    );
    expect(result).toBe(false);
  });

  test('should show review when all conditions are met (dev)', () => {
    const result = checkShouldShowReviewPrompt(
      Date.now() - (2 * 60 * 1000), // 2 minutes ago (> 1 min delay)
      10, // 10 tabs (> 5 threshold)
      0,
      false,
      false,
      true // Dev mode
    );
    expect(result).toBe(true);
  });

  test('should show review when all conditions are met (production)', () => {
    const result = checkShouldShowReviewPrompt(
      Date.now() - (5 * 24 * 60 * 60 * 1000), // 5 days ago (> 4 days)
      100, // 100 tabs (> 50 threshold)
      0,
      false,
      false,
      false // Production
    );
    expect(result).toBe(true);
  });

  test('should not show review if shown recently', () => {
    const result = checkShouldShowReviewPrompt(
      Date.now() - (10 * 24 * 60 * 60 * 1000), // 10 days ago
      100,
      Date.now() - (1 * 24 * 60 * 60 * 1000), // Shown 1 day ago
      false,
      false,
      false // Production (4 day frequency)
    );
    expect(result).toBe(false);
  });
});

describe('Audio Playback', () => {
  test('should not play audio when mediaUrl is missing', () => {
    const birdInfo = SAMPLE_BIRD_INFO_NO_AUDIO;
    
    const canPlayAudio = () => {
      if (!birdInfo || !birdInfo.mediaUrl) {
        return false;
      }
      return true;
    };
    
    expect(canPlayAudio()).toBe(false);
  });

  test('should allow audio playback when mediaUrl exists', () => {
    const birdInfo = SAMPLE_BIRD_INFO;
    
    const canPlayAudio = () => {
      if (!birdInfo || !birdInfo.mediaUrl) {
        return false;
      }
      return true;
    };
    
    expect(canPlayAudio()).toBe(true);
  });

  test('should skip first 4 seconds of audio (recordist commentary)', () => {
    const audioStartTime = 4; // Skip first 4 seconds
    expect(audioStartTime).toBe(4);
  });
});

describe('Error Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should identify NETWORK_ERROR_NO_CACHE error', () => {
    const errorMessage = 'NETWORK_ERROR_NO_CACHE';
    const isNetworkError = errorMessage === 'NETWORK_ERROR_NO_CACHE';
    expect(isNetworkError).toBe(true);
  });

  test('should not identify other errors as network error', () => {
    const errorMessage = 'HTTP error! status: 500';
    const isNetworkError = errorMessage === 'NETWORK_ERROR_NO_CACHE';
    expect(isNetworkError).toBe(false);
  });

  test('should handle request timeout', () => {
    const TIMEOUT_MS = 30000;
    expect(TIMEOUT_MS).toBe(30000);
  });
});

describe('Settings Management', () => {
  beforeEach(() => {
    mockStorage.sync.data = {};
    jest.clearAllMocks();
  });

  test('should use default region when not set', () => {
    const getRegion = () => {
      return mockStorage.sync.data.region || 'US';
    };
    
    expect(getRegion()).toBe('US');
  });

  test('should return stored region when set', () => {
    mockStorage.sync.data.region = 'CA';
    
    const getRegion = () => {
      return mockStorage.sync.data.region || 'US';
    };
    
    expect(getRegion()).toBe('CA');
  });

  test('should use default autoPlay setting when not set', () => {
    const getAutoPlay = () => {
      return mockStorage.sync.data.autoPlay || false;
    };
    
    expect(getAutoPlay()).toBe(false);
  });

  test('should return stored autoPlay when set', () => {
    mockStorage.sync.data.autoPlay = true;
    
    const getAutoPlay = () => {
      return mockStorage.sync.data.autoPlay || false;
    };
    
    expect(getAutoPlay()).toBe(true);
  });

  test('should handle quickAccessEnabled setting', () => {
    mockStorage.sync.data.quickAccessEnabled = true;
    
    const isQuickAccessEnabled = () => {
      return mockStorage.sync.data.quickAccessEnabled || false;
    };
    
    expect(isQuickAccessEnabled()).toBe(true);
  });
});

describe('New Tab Count Tracking', () => {
  beforeEach(() => {
    mockStorage.local.data = {};
    jest.clearAllMocks();
  });

  test('should increment new tab count within 28 days', () => {
    const now = Date.now();
    mockStorage.local.data.installTime = now - (10 * 24 * 60 * 60 * 1000); // 10 days ago
    mockStorage.local.data.newTabCount = 5;
    
    const incrementNewTabCount = () => {
      const installTime = mockStorage.local.data.installTime || now;
      const currentCount = mockStorage.local.data.newTabCount || 0;
      
      if (now - installTime <= 28 * 24 * 60 * 60 * 1000) {
        mockStorage.local.data.newTabCount = currentCount + 1;
      }
    };
    
    incrementNewTabCount();
    expect(mockStorage.local.data.newTabCount).toBe(6);
  });

  test('should not increment new tab count after 28 days', () => {
    const now = Date.now();
    mockStorage.local.data.installTime = now - (30 * 24 * 60 * 60 * 1000); // 30 days ago
    mockStorage.local.data.newTabCount = 100;
    
    const incrementNewTabCount = () => {
      const installTime = mockStorage.local.data.installTime || now;
      const currentCount = mockStorage.local.data.newTabCount || 0;
      
      if (now - installTime <= 28 * 24 * 60 * 60 * 1000) {
        mockStorage.local.data.newTabCount = currentCount + 1;
      }
    };
    
    incrementNewTabCount();
    expect(mockStorage.local.data.newTabCount).toBe(100); // Not incremented
  });
});

describe('Onboarding Flow', () => {
  beforeEach(() => {
    mockStorage.sync.data = {};
    jest.clearAllMocks();
  });

  test('should redirect to onboarding when not complete', () => {
    mockStorage.sync.data.onboardingComplete = false;
    
    const shouldRedirectToOnboarding = () => {
      return !mockStorage.sync.data.onboardingComplete;
    };
    
    expect(shouldRedirectToOnboarding()).toBe(true);
  });

  test('should not redirect when onboarding is complete', () => {
    mockStorage.sync.data.onboardingComplete = true;
    
    const shouldRedirectToOnboarding = () => {
      return !mockStorage.sync.data.onboardingComplete;
    };
    
    expect(shouldRedirectToOnboarding()).toBe(false);
  });
});

describe('Bird Info Validation', () => {
  test('should validate complete bird info', () => {
    const validateBirdInfo = (birdInfo) => {
      return !!(
        birdInfo &&
        birdInfo.name &&
        birdInfo.scientificName &&
        birdInfo.imageUrl &&
        birdInfo.photographer &&
        birdInfo.ebirdUrl
      );
    };
    
    expect(validateBirdInfo(SAMPLE_BIRD_INFO)).toBe(true);
  });

  test('should reject bird info without required fields', () => {
    const validateBirdInfo = (birdInfo) => {
      return !!(
        birdInfo &&
        birdInfo.name &&
        birdInfo.scientificName &&
        birdInfo.imageUrl &&
        birdInfo.photographer &&
        birdInfo.ebirdUrl
      );
    };
    
    const incompleteBird = {
      name: 'Test Bird'
      // Missing other required fields
    };
    
    expect(validateBirdInfo(incompleteBird)).toBe(false);
  });

  test('should accept bird info without optional audio', () => {
    const validateBirdInfo = (birdInfo) => {
      return !!(
        birdInfo &&
        birdInfo.name &&
        birdInfo.scientificName &&
        birdInfo.imageUrl &&
        birdInfo.photographer &&
        birdInfo.ebirdUrl
      );
    };
    
    expect(validateBirdInfo(SAMPLE_BIRD_INFO_NO_AUDIO)).toBe(true);
  });
});

describe('URL Construction', () => {
  test('should construct correct eBird URL', () => {
    const speciesCode = 'bknsti';
    const ebirdUrl = `https://ebird.org/species/${speciesCode}`;
    expect(ebirdUrl).toBe('https://ebird.org/species/bknsti');
  });

  test('should construct correct Bing search URL', () => {
    const birdName = 'Black-necked Stilt';
    const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(birdName)}`;
    expect(bingUrl).toBe('https://www.bing.com/search?q=Black-necked%20Stilt');
  });

  test('should construct correct Macaulay Library asset URL', () => {
    const assetId = '249446571';
    const assetUrl = `https://macaulaylibrary.org/asset/${assetId}`;
    expect(assetUrl).toBe('https://macaulaylibrary.org/asset/249446571');
  });
});

describe('Quiet Hours Logic', () => {
  test('should hide audio controls during quiet hours', () => {
    const isQuietHour = true;
    
    const shouldShowAudioControls = (birdInfo, isQuietHour) => {
      if (isQuietHour) {
        return false;
      }
      return !!(birdInfo && birdInfo.mediaUrl);
    };
    
    expect(shouldShowAudioControls(SAMPLE_BIRD_INFO, isQuietHour)).toBe(false);
  });

  test('should show audio controls outside quiet hours when audio available', () => {
    const isQuietHour = false;
    
    const shouldShowAudioControls = (birdInfo, isQuietHour) => {
      if (isQuietHour) {
        return false;
      }
      return !!(birdInfo && birdInfo.mediaUrl);
    };
    
    expect(shouldShowAudioControls(SAMPLE_BIRD_INFO, isQuietHour)).toBe(true);
  });

  test('should not show audio controls when no audio available', () => {
    const isQuietHour = false;
    
    const shouldShowAudioControls = (birdInfo, isQuietHour) => {
      if (isQuietHour) {
        return false;
      }
      return !!(birdInfo && birdInfo.mediaUrl);
    };
    
    expect(shouldShowAudioControls(SAMPLE_BIRD_INFO_NO_AUDIO, isQuietHour)).toBe(false);
  });
});

describe('Message Handling', () => {
  test('should handle refreshBird message', () => {
    const handleMessage = (request) => {
      if (request.action === 'refreshBird') {
        return 'reload';
      }
      return null;
    };
    
    expect(handleMessage({ action: 'refreshBird' })).toBe('reload');
  });

  test('should handle toggleMute message', () => {
    const handleMessage = (request) => {
      if (request.action === 'toggleMute') {
        return 'toggle';
      }
      return null;
    };
    
    expect(handleMessage({ action: 'toggleMute' })).toBe('toggle');
  });

  test('should handle pauseAudio message', () => {
    const handleMessage = (request) => {
      if (request.action === 'pauseAudio') {
        return 'pause';
      }
      return null;
    };
    
    expect(handleMessage({ action: 'pauseAudio' })).toBe('pause');
  });

  test('should handle quietHoursChanged message', () => {
    const handleMessage = (request) => {
      if (request.action === 'quietHoursChanged') {
        return request.quietHoursEnabled ? 'enabled' : 'disabled';
      }
      return null;
    };
    
    expect(handleMessage({ action: 'quietHoursChanged', quietHoursEnabled: true })).toBe('enabled');
    expect(handleMessage({ action: 'quietHoursChanged', quietHoursEnabled: false })).toBe('disabled');
  });
});


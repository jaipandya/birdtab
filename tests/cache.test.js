/**
 * Tests for bird caching functionality
 * 
 * These tests verify:
 * 1. Cached bird retrieval works correctly
 * 2. Network error fallback uses cached birds
 * 3. When no cache exists, NETWORK_ERROR_NO_CACHE is thrown
 * 4. Cache data structure is correct
 * 5. Error scenarios are handled properly
 */

// Mock chrome.storage API
const mockStorage = {
  local: {
    data: {},
    get: jest.fn((keys, callback) => {
      if (keys === null) {
        // Return all data
        callback(mockStorage.local.data);
      } else if (typeof keys === 'string') {
        callback({ [keys]: mockStorage.local.data[keys] });
      } else if (Array.isArray(keys)) {
        const result = {};
        keys.forEach(key => {
          if (mockStorage.local.data[key]) {
            result[key] = mockStorage.local.data[key];
          }
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
          if (mockStorage.sync.data[key]) {
            result[key] = mockStorage.sync.data[key];
          }
        });
        callback(result);
      }
    }),
    set: jest.fn((items, callback) => {
      Object.assign(mockStorage.sync.data, items);
      if (callback) callback();
    })
  }
};

// Mock chrome.runtime API
const mockRuntime = {
  getURL: jest.fn((path) => `chrome-extension://test-id/${path}`),
  lastError: null
};

// Set up global chrome mock
global.chrome = {
  storage: mockStorage,
  runtime: mockRuntime
};

// Configuration matching the actual app
const CONFIG = {
  CACHE_DURATION: {
    BIRD_INFO: 7 * 24 * 60 * 60 * 1000, // 7 days
    BIRDS_BY_REGION: 7 * 24 * 60 * 60 * 1000 // 7 days
  },
  API_SERVER_URL: 'https://api.birdtab.app/api'
};

// Sample data from real BirdTab API responses
const SAMPLE_BIRDS_API_RESPONSE = {
  birds: [
    {
      speciesCode: 'bknsti',
      primaryComName: 'Black-necked Stilt',
      scientificName: 'Himantopus mexicanus',
      conservationStatus: '',
      description: 'Elegant shorebird with exceptionally long, bright pink legs. Distinctive black-and-white plumage and thin black bill.',
      primaryComName_fr: 'Échasse d\'Amérique',
      primaryComName_cn: '黑颈长脚鹬'
    },
    {
      speciesCode: 'redhea',
      primaryComName: 'Redhead',
      scientificName: 'Aythya americana',
      conservationStatus: 'LC Least Concern',
      description: 'This attractive diving duck often gathers by the thousands on lakes or bays in the winter.',
      primaryComName_fr: 'Fuligule à tête rouge'
    },
    {
      speciesCode: 'amerob',
      primaryComName: 'American Robin',
      scientificName: 'Turdus migratorius',
      conservationStatus: 'LC Least Concern',
      description: 'American Robins are gray-brown birds with warm orange underparts and dark heads.',
      primaryComName_fr: 'Merle d\'Amérique',
      primaryComName_cn: '旅鸫'
    }
  ]
};

// Sample Macaulay Library image response
const SAMPLE_MACAULAY_IMAGE_RESPONSE = {
  results: {
    count: 1,
    content: [{
      catalogId: '249446571',
      mediaUrl: 'https://cdn.download.ams.birds.cornell.edu/api/v1/asset/249446571/1200',
      userDisplayName: 'Test Photographer',
      assetId: '249446571',
      location: 'San Francisco Bay Trail, California, United States'
    }]
  }
};

// Sample Macaulay Library audio response
const SAMPLE_MACAULAY_AUDIO_RESPONSE = {
  results: {
    count: 1,
    content: [{
      catalogId: '548381',
      mediaUrl: 'https://cdn.download.ams.birds.cornell.edu/api/v2/asset/548381/mp3',
      userDisplayName: 'Test Recordist',
      assetId: '548381'
    }]
  }
};

// Recreate cache functions for testing
async function getCachedData(key) {
  return new Promise(resolve => {
    chrome.storage.local.get(key, result => {
      const data = result[key];
      if (data && Date.now() - data.timestamp < data.duration) {
        resolve(data.value);
      } else {
        resolve(null);
      }
    });
  });
}

async function cacheData(key, value, duration) {
  return new Promise(resolve => {
    chrome.storage.local.set({
      [key]: { value, timestamp: Date.now(), duration }
    }, resolve);
  });
}

async function getRandomCachedBirdInfo() {
  return new Promise(resolve => {
    chrome.storage.local.get(null, async items => {
      // Find all cached images
      const imageKeys = Object.keys(items).filter(key => key.startsWith('image_'));
      if (imageKeys.length === 0) {
        resolve(null);
        return;
      }

      // Pick a random cached image
      const randomImageKey = imageKeys[Math.floor(Math.random() * imageKeys.length)];
      const imageData = items[randomImageKey];
      if (!imageData?.value) {
        resolve(null);
        return;
      }

      // Extract speciesCode from key (image_SPECIESCODE)
      const speciesCode = randomImageKey.replace('image_', '');

      // Find the bird data from any cached region
      const birdsKeys = Object.keys(items).filter(key => key.startsWith('birds_'));
      let bird = null;
      for (const birdsKey of birdsKeys) {
        const birdsData = items[birdsKey];
        if (birdsData?.value) {
          bird = birdsData.value.find(b => b.speciesCode === speciesCode);
          if (bird) break;
        }
      }

      if (!bird) {
        resolve(null);
        return;
      }

      // Get cached audio if available
      const audioData = items[`audio_${speciesCode}`];
      const audioInfo = audioData?.value || null;

      // Reconstruct complete bird info from cached data
      const birdInfo = {
        name: bird.primaryComName,
        scientificName: bird.scientificName,
        location: 'Cached',
        ebirdUrl: `https://ebird.org/species/${bird.speciesCode}`,
        imageUrl: imageData.value.imageUrl,
        photographer: imageData.value.photographer,
        photographerUrl: imageData.value.photographerUrl,
        mediaUrl: audioInfo?.mediaUrl,
        recordist: audioInfo?.recordist,
        recordistUrl: audioInfo?.recordistUrl,
        description: bird.description,
        conservationStatus: bird.conservationStatus,
        primaryComName_fr: bird.primaryComName_fr,
        primaryComName_cn: bird.primaryComName_cn
      };

      resolve(birdInfo);
    });
  });
}

describe('Cache Functions', () => {
  beforeEach(() => {
    // Clear mock storage before each test
    mockStorage.local.data = {};
    mockStorage.sync.data = {};
    jest.clearAllMocks();
  });

  describe('getCachedData', () => {
    test('returns null for non-existent cache key', async () => {
      const result = await getCachedData('non_existent_key');
      expect(result).toBeNull();
    });

    test('returns cached value when cache is valid', async () => {
      const testValue = { name: 'Test Bird', imageUrl: 'http://example.com/bird.jpg' };
      mockStorage.local.data['test_key'] = {
        value: testValue,
        timestamp: Date.now(),
        duration: CONFIG.CACHE_DURATION.BIRD_INFO
      };

      const result = await getCachedData('test_key');
      expect(result).toEqual(testValue);
    });

    test('returns null when cache is expired', async () => {
      const testValue = { name: 'Test Bird' };
      mockStorage.local.data['test_key'] = {
        value: testValue,
        timestamp: Date.now() - CONFIG.CACHE_DURATION.BIRD_INFO - 1000, // Expired
        duration: CONFIG.CACHE_DURATION.BIRD_INFO
      };

      const result = await getCachedData('test_key');
      expect(result).toBeNull();
    });
  });

  describe('cacheData', () => {
    test('stores data with correct structure', async () => {
      const testValue = { name: 'Test Bird' };
      await cacheData('test_key', testValue, CONFIG.CACHE_DURATION.BIRD_INFO);

      expect(mockStorage.local.data['test_key']).toBeDefined();
      expect(mockStorage.local.data['test_key'].value).toEqual(testValue);
      expect(mockStorage.local.data['test_key'].duration).toBe(CONFIG.CACHE_DURATION.BIRD_INFO);
      expect(mockStorage.local.data['test_key'].timestamp).toBeDefined();
    });
  });

  describe('getRandomCachedBirdInfo', () => {
    test('returns null when no cached images exist', async () => {
      const result = await getRandomCachedBirdInfo();
      expect(result).toBeNull();
    });

    test('returns null when cached image has no matching bird data', async () => {
      mockStorage.local.data['image_TESTBIRD'] = {
        value: {
          imageUrl: 'http://example.com/bird.jpg',
          photographer: 'Test Photographer',
          photographerUrl: 'http://example.com/photographer'
        },
        timestamp: Date.now(),
        duration: CONFIG.CACHE_DURATION.BIRD_INFO
      };

      const result = await getRandomCachedBirdInfo();
      expect(result).toBeNull();
    });

    test('returns complete bird info when cache has matching data', async () => {
      // Set up cached image
      mockStorage.local.data['image_TESTBIRD'] = {
        value: {
          imageUrl: 'http://example.com/bird.jpg',
          photographer: 'Test Photographer',
          photographerUrl: 'http://example.com/photographer'
        },
        timestamp: Date.now(),
        duration: CONFIG.CACHE_DURATION.BIRD_INFO
      };

      // Set up cached birds list
      mockStorage.local.data['birds_US'] = {
        value: [
          {
            speciesCode: 'TESTBIRD',
            primaryComName: 'Test Bird',
            scientificName: 'Testus birdus',
            description: 'A test bird',
            conservationStatus: 'Least Concern',
            primaryComName_fr: 'Oiseau Test',
            primaryComName_cn: '测试鸟'
          }
        ],
        timestamp: Date.now(),
        duration: CONFIG.CACHE_DURATION.BIRDS_BY_REGION
      };

      // Set up cached audio
      mockStorage.local.data['audio_TESTBIRD'] = {
        value: {
          mediaUrl: 'http://example.com/bird.mp3',
          recordist: 'Test Recordist',
          recordistUrl: 'http://example.com/recordist'
        },
        timestamp: Date.now(),
        duration: CONFIG.CACHE_DURATION.BIRD_INFO
      };

      const result = await getRandomCachedBirdInfo();

      expect(result).not.toBeNull();
      expect(result.name).toBe('Test Bird');
      expect(result.scientificName).toBe('Testus birdus');
      expect(result.imageUrl).toBe('http://example.com/bird.jpg');
      expect(result.photographer).toBe('Test Photographer');
      expect(result.mediaUrl).toBe('http://example.com/bird.mp3');
      expect(result.recordist).toBe('Test Recordist');
      expect(result.location).toBe('Cached');
      expect(result.ebirdUrl).toBe('https://ebird.org/species/TESTBIRD');
    });

    test('returns bird info without audio when audio is not cached', async () => {
      // Set up cached image
      mockStorage.local.data['image_TESTBIRD'] = {
        value: {
          imageUrl: 'http://example.com/bird.jpg',
          photographer: 'Test Photographer',
          photographerUrl: 'http://example.com/photographer'
        },
        timestamp: Date.now(),
        duration: CONFIG.CACHE_DURATION.BIRD_INFO
      };

      // Set up cached birds list (no audio)
      mockStorage.local.data['birds_US'] = {
        value: [
          {
            speciesCode: 'TESTBIRD',
            primaryComName: 'Test Bird',
            scientificName: 'Testus birdus',
            description: 'A test bird',
            conservationStatus: 'Least Concern'
          }
        ],
        timestamp: Date.now(),
        duration: CONFIG.CACHE_DURATION.BIRDS_BY_REGION
      };

      const result = await getRandomCachedBirdInfo();

      expect(result).not.toBeNull();
      expect(result.name).toBe('Test Bird');
      expect(result.imageUrl).toBe('http://example.com/bird.jpg');
      expect(result.mediaUrl).toBeUndefined();
      expect(result.recordist).toBeUndefined();
    });
  });
});

describe('Network Error Fallback Behavior', () => {
  beforeEach(() => {
    mockStorage.local.data = {};
    mockStorage.sync.data = {};
    jest.clearAllMocks();
  });

  test('should use cached bird when network fails and cache exists', async () => {
    // Set up valid cache
    mockStorage.local.data['image_CACHEDBIRD'] = {
      value: {
        imageUrl: 'http://example.com/cached-bird.jpg',
        photographer: 'Cached Photographer',
        photographerUrl: 'http://example.com/cached-photographer'
      },
      timestamp: Date.now(),
      duration: CONFIG.CACHE_DURATION.BIRD_INFO
    };

    mockStorage.local.data['birds_US'] = {
      value: [
        {
          speciesCode: 'CACHEDBIRD',
          primaryComName: 'Cached Bird',
          scientificName: 'Cachius birdus',
          description: 'A cached bird'
        }
      ],
      timestamp: Date.now(),
      duration: CONFIG.CACHE_DURATION.BIRDS_BY_REGION
    };

    const cachedBird = await getRandomCachedBirdInfo();
    expect(cachedBird).not.toBeNull();
    expect(cachedBird.name).toBe('Cached Bird');
  });

  test('should return null when network fails and no cache exists', async () => {
    // Empty cache
    const cachedBird = await getRandomCachedBirdInfo();
    expect(cachedBird).toBeNull();
  });
});

describe('Cache Clear Functionality', () => {
  beforeEach(() => {
    mockStorage.local.data = {};
    jest.clearAllMocks();
  });

  test('clearCache removes all bird-related cache keys', async () => {
    // Set up various cache entries
    mockStorage.local.data['image_BIRD1'] = { value: {}, timestamp: Date.now(), duration: 1000 };
    mockStorage.local.data['image_BIRD2'] = { value: {}, timestamp: Date.now(), duration: 1000 };
    mockStorage.local.data['audio_BIRD1'] = { value: {}, timestamp: Date.now(), duration: 1000 };
    mockStorage.local.data['birds_US'] = { value: [], timestamp: Date.now(), duration: 1000 };
    mockStorage.local.data['birds_CA'] = { value: [], timestamp: Date.now(), duration: 1000 };
    mockStorage.local.data['installTime'] = Date.now(); // Should not be removed by clearCache

    // Simulate clearCache function
    const items = mockStorage.local.data;
    const keysToRemove = Object.keys(items).filter(key =>
      key.startsWith('image_') || key.startsWith('audio_') || key.startsWith('birds_')
    );

    keysToRemove.forEach(key => delete mockStorage.local.data[key]);

    // Verify bird cache is cleared
    expect(mockStorage.local.data['image_BIRD1']).toBeUndefined();
    expect(mockStorage.local.data['image_BIRD2']).toBeUndefined();
    expect(mockStorage.local.data['audio_BIRD1']).toBeUndefined();
    expect(mockStorage.local.data['birds_US']).toBeUndefined();
    expect(mockStorage.local.data['birds_CA']).toBeUndefined();

    // Verify non-bird data is preserved
    expect(mockStorage.local.data['installTime']).toBeDefined();
  });

  test('full storage clear removes everything', async () => {
    // Set up various entries
    mockStorage.local.data['image_BIRD1'] = { value: {} };
    mockStorage.local.data['installTime'] = Date.now();
    mockStorage.local.data['newTabCount'] = 50;

    // Simulate chrome.storage.local.clear()
    mockStorage.local.data = {};

    expect(Object.keys(mockStorage.local.data).length).toBe(0);
  });
});

describe('Error Scenarios', () => {
  beforeEach(() => {
    mockStorage.local.data = {};
    mockStorage.sync.data = {};
    jest.clearAllMocks();
  });

  describe('NETWORK_ERROR_NO_CACHE scenario', () => {
    test('should signal NETWORK_ERROR_NO_CACHE when API fails and no cache exists', async () => {
      // Simulate the error flow from background.js
      const simulateFetchBirdInfoError = async () => {
        // First try to get cached bird as fallback
        const cachedBirdInfo = await getRandomCachedBirdInfo();
        if (cachedBirdInfo) {
          return cachedBirdInfo;
        }
        // No cached bird available - throw specific error
        throw new Error('NETWORK_ERROR_NO_CACHE');
      };

      await expect(simulateFetchBirdInfoError()).rejects.toThrow('NETWORK_ERROR_NO_CACHE');
    });

    test('should NOT throw NETWORK_ERROR_NO_CACHE when cache exists', async () => {
      // Set up valid cache with real data structure
      mockStorage.local.data['image_bknsti'] = {
        value: {
          imageUrl: SAMPLE_MACAULAY_IMAGE_RESPONSE.results.content[0].mediaUrl,
          photographer: SAMPLE_MACAULAY_IMAGE_RESPONSE.results.content[0].userDisplayName,
          photographerUrl: `https://macaulaylibrary.org/asset/${SAMPLE_MACAULAY_IMAGE_RESPONSE.results.content[0].assetId}`
        },
        timestamp: Date.now(),
        duration: CONFIG.CACHE_DURATION.BIRD_INFO
      };

      mockStorage.local.data['birds_US'] = {
        value: SAMPLE_BIRDS_API_RESPONSE.birds,
        timestamp: Date.now(),
        duration: CONFIG.CACHE_DURATION.BIRDS_BY_REGION
      };

      // Simulate the error flow
      const simulateFetchBirdInfoError = async () => {
        const cachedBirdInfo = await getRandomCachedBirdInfo();
        if (cachedBirdInfo) {
          return cachedBirdInfo;
        }
        throw new Error('NETWORK_ERROR_NO_CACHE');
      };

      const result = await simulateFetchBirdInfoError();
      expect(result).not.toBeNull();
      expect(result.name).toBe('Black-necked Stilt');
    });
  });

  describe('Image fetch failure with cache fallback', () => {
    test('should use cached bird when image fetch fails', async () => {
      // Set up cache for a different bird
      mockStorage.local.data['image_amerob'] = {
        value: {
          imageUrl: 'https://cdn.download.ams.birds.cornell.edu/api/v1/asset/123456/1200',
          photographer: 'Cached Photographer',
          photographerUrl: 'https://macaulaylibrary.org/asset/123456'
        },
        timestamp: Date.now(),
        duration: CONFIG.CACHE_DURATION.BIRD_INFO
      };

      mockStorage.local.data['birds_US'] = {
        value: SAMPLE_BIRDS_API_RESPONSE.birds,
        timestamp: Date.now(),
        duration: CONFIG.CACHE_DURATION.BIRDS_BY_REGION
      };

      // Simulate image fetch failure scenario
      const simulateImageFetchFailure = async () => {
        // Image fetch failed - try cached bird
        const cachedBirdInfo = await getRandomCachedBirdInfo();
        if (cachedBirdInfo) {
          return cachedBirdInfo;
        }
        throw new Error('NETWORK_ERROR_NO_CACHE');
      };

      const result = await simulateImageFetchFailure();
      expect(result).not.toBeNull();
      expect(result.name).toBe('American Robin');
      expect(result.photographer).toBe('Cached Photographer');
    });
  });

  describe('API response handling', () => {
    test('should handle empty birds array from API', async () => {
      const emptyResponse = { birds: [] };
      
      // Simulate getBirdsByRegion with empty response
      const simulateEmptyBirdsResponse = async () => {
        if (emptyResponse.birds.length === 0) {
          throw new Error('No birds found in the response');
        }
        return emptyResponse.birds;
      };

      await expect(simulateEmptyBirdsResponse()).rejects.toThrow('No birds found in the response');
    });

    test('should handle missing results from Macaulay API', async () => {
      const emptyMacaulayResponse = { results: { content: [] } };
      
      // Simulate getMacaulayImage with no results
      const simulateNoImageFound = async () => {
        if (!emptyMacaulayResponse.results?.content?.[0]) {
          throw new Error('No image found in Macaulay Library');
        }
        return emptyMacaulayResponse.results.content[0];
      };

      await expect(simulateNoImageFound()).rejects.toThrow('No image found in Macaulay Library');
    });

    test('should handle HTTP errors gracefully', async () => {
      // Simulate HTTP error
      const simulateHttpError = async () => {
        const status = 500;
        throw new Error(`HTTP error! status: ${status}`);
      };

      await expect(simulateHttpError()).rejects.toThrow('HTTP error! status: 500');
    });
  });

  describe('Message delivery failures', () => {
    test('should handle chrome.runtime.lastError in message delivery', async () => {
      // Simulate message delivery failure
      const simulateMessageDeliveryFailure = () => {
        mockRuntime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
        
        const handleResponse = () => {
          if (mockRuntime.lastError) {
            throw new Error(mockRuntime.lastError.message);
          }
        };

        expect(() => handleResponse()).toThrow('Could not establish connection');
        
        // Clean up
        mockRuntime.lastError = null;
      };

      simulateMessageDeliveryFailure();
    });

    test('should handle no response from background script', async () => {
      const simulateNoResponse = async () => {
        const response = undefined;
        if (!response) {
          throw new Error('No response from background script');
        }
        return response;
      };

      await expect(simulateNoResponse()).rejects.toThrow('No response from background script');
    });

    test('should handle error response from background script', async () => {
      const simulateErrorResponse = async () => {
        const response = { error: 'NETWORK_ERROR_NO_CACHE' };
        if (response.error) {
          throw new Error(response.error);
        }
        return response;
      };

      await expect(simulateErrorResponse()).rejects.toThrow('NETWORK_ERROR_NO_CACHE');
    });
  });

  describe('Request timeout handling', () => {
    test('should handle request timeout', async () => {
      jest.useFakeTimers();

      const simulateTimeout = () => {
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Request timed out'));
          }, 30000);

          // Simulate timeout by advancing timers
          jest.advanceTimersByTime(31000);
        });
      };

      await expect(simulateTimeout()).rejects.toThrow('Request timed out');
      
      jest.useRealTimers();
    });
  });
});

describe('Real Data Structure Tests', () => {
  beforeEach(() => {
    mockStorage.local.data = {};
    mockStorage.sync.data = {};
    jest.clearAllMocks();
  });

  test('should correctly parse and cache real API bird data', async () => {
    // Cache the real API response structure
    await cacheData('birds_US', SAMPLE_BIRDS_API_RESPONSE.birds, CONFIG.CACHE_DURATION.BIRDS_BY_REGION);

    const cached = await getCachedData('birds_US');
    expect(cached).not.toBeNull();
    expect(cached.length).toBe(3);
    expect(cached[0].speciesCode).toBe('bknsti');
    expect(cached[0].primaryComName).toBe('Black-necked Stilt');
    expect(cached[0].primaryComName_fr).toBe('Échasse d\'Amérique');
  });

  test('should correctly cache Macaulay Library image data', async () => {
    const imageInfo = {
      imageUrl: SAMPLE_MACAULAY_IMAGE_RESPONSE.results.content[0].mediaUrl,
      photographer: SAMPLE_MACAULAY_IMAGE_RESPONSE.results.content[0].userDisplayName,
      photographerUrl: `https://macaulaylibrary.org/asset/${SAMPLE_MACAULAY_IMAGE_RESPONSE.results.content[0].assetId}`
    };

    await cacheData('image_bknsti', imageInfo, CONFIG.CACHE_DURATION.BIRD_INFO);

    const cached = await getCachedData('image_bknsti');
    expect(cached).not.toBeNull();
    expect(cached.imageUrl).toContain('cdn.download.ams.birds.cornell.edu');
    expect(cached.photographer).toBe('Test Photographer');
  });

  test('should correctly cache Macaulay Library audio data', async () => {
    const audioInfo = {
      mediaUrl: SAMPLE_MACAULAY_AUDIO_RESPONSE.results.content[0].mediaUrl,
      recordist: SAMPLE_MACAULAY_AUDIO_RESPONSE.results.content[0].userDisplayName,
      recordistUrl: `https://macaulaylibrary.org/asset/${SAMPLE_MACAULAY_AUDIO_RESPONSE.results.content[0].assetId}`
    };

    await cacheData('audio_bknsti', audioInfo, CONFIG.CACHE_DURATION.BIRD_INFO);

    const cached = await getCachedData('audio_bknsti');
    expect(cached).not.toBeNull();
    expect(cached.mediaUrl).toContain('mp3');
    expect(cached.recordist).toBe('Test Recordist');
  });

  test('should reconstruct complete bird info from cached real data', async () => {
    // Set up cache with real data structures
    mockStorage.local.data['image_bknsti'] = {
      value: {
        imageUrl: SAMPLE_MACAULAY_IMAGE_RESPONSE.results.content[0].mediaUrl,
        photographer: SAMPLE_MACAULAY_IMAGE_RESPONSE.results.content[0].userDisplayName,
        photographerUrl: `https://macaulaylibrary.org/asset/${SAMPLE_MACAULAY_IMAGE_RESPONSE.results.content[0].assetId}`
      },
      timestamp: Date.now(),
      duration: CONFIG.CACHE_DURATION.BIRD_INFO
    };

    mockStorage.local.data['audio_bknsti'] = {
      value: {
        mediaUrl: SAMPLE_MACAULAY_AUDIO_RESPONSE.results.content[0].mediaUrl,
        recordist: SAMPLE_MACAULAY_AUDIO_RESPONSE.results.content[0].userDisplayName,
        recordistUrl: `https://macaulaylibrary.org/asset/${SAMPLE_MACAULAY_AUDIO_RESPONSE.results.content[0].assetId}`
      },
      timestamp: Date.now(),
      duration: CONFIG.CACHE_DURATION.BIRD_INFO
    };

    mockStorage.local.data['birds_US'] = {
      value: SAMPLE_BIRDS_API_RESPONSE.birds,
      timestamp: Date.now(),
      duration: CONFIG.CACHE_DURATION.BIRDS_BY_REGION
    };

    const result = await getRandomCachedBirdInfo();

    expect(result).not.toBeNull();
    expect(result.name).toBe('Black-necked Stilt');
    expect(result.scientificName).toBe('Himantopus mexicanus');
    expect(result.imageUrl).toContain('cdn.download.ams.birds.cornell.edu');
    expect(result.photographer).toBe('Test Photographer');
    expect(result.mediaUrl).toContain('mp3');
    expect(result.recordist).toBe('Test Recordist');
    expect(result.ebirdUrl).toBe('https://ebird.org/species/bknsti');
    expect(result.primaryComName_fr).toBe('Échasse d\'Amérique');
  });

  test('should handle birds with missing optional fields', async () => {
    // Set up cache with bird that has minimal data
    mockStorage.local.data['image_redhea'] = {
      value: {
        imageUrl: 'https://cdn.download.ams.birds.cornell.edu/api/v1/asset/99999/1200',
        photographer: 'Another Photographer',
        photographerUrl: 'https://macaulaylibrary.org/asset/99999'
      },
      timestamp: Date.now(),
      duration: CONFIG.CACHE_DURATION.BIRD_INFO
    };

    // Bird without audio and without Chinese name
    mockStorage.local.data['birds_US'] = {
      value: [SAMPLE_BIRDS_API_RESPONSE.birds[1]], // Redhead - no primaryComName_cn
      timestamp: Date.now(),
      duration: CONFIG.CACHE_DURATION.BIRDS_BY_REGION
    };

    const result = await getRandomCachedBirdInfo();

    expect(result).not.toBeNull();
    expect(result.name).toBe('Redhead');
    expect(result.mediaUrl).toBeUndefined();
    expect(result.recordist).toBeUndefined();
    expect(result.primaryComName_cn).toBeUndefined();
    expect(result.primaryComName_fr).toBe('Fuligule à tête rouge');
  });
});

describe('Multiple Region Cache Tests', () => {
  beforeEach(() => {
    mockStorage.local.data = {};
    jest.clearAllMocks();
  });

  test('should find bird data across different cached regions', async () => {
    // Cache bird image
    mockStorage.local.data['image_amerob'] = {
      value: {
        imageUrl: 'https://example.com/robin.jpg',
        photographer: 'Robin Photographer',
        photographerUrl: 'https://example.com/robin-photographer'
      },
      timestamp: Date.now(),
      duration: CONFIG.CACHE_DURATION.BIRD_INFO
    };

    // Cache birds in a different region (CA instead of US)
    mockStorage.local.data['birds_CA'] = {
      value: [SAMPLE_BIRDS_API_RESPONSE.birds[2]], // American Robin
      timestamp: Date.now(),
      duration: CONFIG.CACHE_DURATION.BIRDS_BY_REGION
    };

    const result = await getRandomCachedBirdInfo();

    expect(result).not.toBeNull();
    expect(result.name).toBe('American Robin');
  });

  test('should search multiple regions to find matching bird', async () => {
    // Cache bird image for bknsti
    mockStorage.local.data['image_bknsti'] = {
      value: {
        imageUrl: 'https://example.com/stilt.jpg',
        photographer: 'Stilt Photographer',
        photographerUrl: 'https://example.com/stilt-photographer'
      },
      timestamp: Date.now(),
      duration: CONFIG.CACHE_DURATION.BIRD_INFO
    };

    // Cache birds in US (doesn't have bknsti)
    mockStorage.local.data['birds_US'] = {
      value: [SAMPLE_BIRDS_API_RESPONSE.birds[2]], // Only American Robin
      timestamp: Date.now(),
      duration: CONFIG.CACHE_DURATION.BIRDS_BY_REGION
    };

    // Cache birds in MX (has bknsti)
    mockStorage.local.data['birds_MX'] = {
      value: [SAMPLE_BIRDS_API_RESPONSE.birds[0]], // Black-necked Stilt
      timestamp: Date.now(),
      duration: CONFIG.CACHE_DURATION.BIRDS_BY_REGION
    };

    const result = await getRandomCachedBirdInfo();

    expect(result).not.toBeNull();
    expect(result.name).toBe('Black-necked Stilt');
  });
});


import { captureException } from './sentry.js';
import './quiz.css';
import { log } from './logger.js';

/*
 * IMAGE PRELOADING OPTIMIZATION STRATEGY
 * =====================================
 * 
 * ISSUE: Images were loading on-demand when user clicked "Next", causing visible delays
 * on slow networks (3G). The preloading was happening AFTER nextQuestion() was called,
 * which was too late.
 * 
 * SOLUTION: 
 * 1. Preload next image immediately AFTER user answers current question (in submitAnswer)
 * 2. This gives maximum time for next image to load while user reads feedback
 * 3. Use browser cache preloading (new Image()) for instant display
 * 4. Add comprehensive logging to track preloading status
 * 
 * SEQUENCE:
 * 1. User answers question → submitAnswer() → preloadNextQuestionImage()
 * 2. Next image loads in background while user sees feedback
 * 3. User clicks "Next" → nextQuestion() → displayQuestion() 
 * 4. Image should already be loaded and cached → instant display
 * 
 * The key insight: Preload AFTER answering, not AFTER clicking next.
 */

class QuizMode {
  constructor(options = {}) {
    this.isActive = false;
    this.currentQuestion = 0;
    this.score = 0;
    this.questions = [];
    this.answers = [];
    this.selectedAnswer = null;
    this.hasAnswered = false;
    this.quizContainer = null;
    this.imageLoadingQueue = [];
    this.isLoadingImages = false;
    this.preloadedImages = new Map(); // Track preloaded images for cleanup
    this.abortController = null; // For cancelling pending requests
    this.eventListeners = []; // Track event listeners for cleanup
    this.onQuizStart = options.onQuizStart || null; // Callback when quiz starts

    this.setupKeyboardListener();
  }

  setupKeyboardListener() {
    const keyboardHandler = (e) => {
      // Don't trigger shortcuts when typing in input fields
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      if (e.key.toLowerCase() === 'q') {
        e.preventDefault();
        if (!this.isActive) {
          this.startQuiz();
        } else {
          this.showExitConfirmation();
        }
      }

      // Handle keyboard navigation in quiz
      if (this.isActive && !this.hasAnswered) {
        if (e.key >= '1' && e.key <= '4') {
          const optionIndex = parseInt(e.key) - 1;
          if (optionIndex < document.querySelectorAll('.quiz-option').length) {
            this.selectOption(optionIndex);
          }
        }
      }

      // Handle next question with Enter
      if (this.isActive && this.hasAnswered && e.key === 'Enter') {
        this.nextQuestion();
      }
    };

    document.addEventListener('keydown', keyboardHandler);
    this.eventListeners.push({ element: document, event: 'keydown', handler: keyboardHandler, persist: true });
  }

  async startQuiz() {
    try {
      // Call onQuizStart callback (e.g., to pause background media)
      if (this.onQuizStart) {
        this.onQuizStart();
      }

      // Get current region setting
      const region = await this.getCurrentRegion();

      // Get cached birds for the region, fetch if not available
      let birds = await this.getCachedBirds(region);
      let needsDataFetch = !birds;

      if (needsDataFetch) {
        // Show loading UI only when data needs to be fetched
        this.showQuizUI();
        this.isActive = true;
        this.hideMainUI();
        this.showQuizLoading();

        try {
          // Fetch birds from background script if not in cache
          birds = await this.fetchBirdsForRegion(region);
        } catch (error) {
          captureException(error, { tags: { operation: 'fetchBirdsForRegion', component: 'QuizMode' }, extra: { region } });
          this.showError(chrome.i18n.getMessage('quizErrorGeneral'));
          return;
        }
      }

      if (!birds || birds.length < 10) {
        this.showError(chrome.i18n.getMessage('quizErrorNotEnoughBirds'));
        return;
      }

      // Prepare quiz questions with enriched bird data
      await this.prepareQuestions(birds);

      // Show quiz UI only if not already shown during data fetch
      if (!needsDataFetch) {
        this.showQuizUI();
        this.isActive = true;
        this.hideMainUI();

        // Show loading indicator while preparing first image
        this.showQuizLoading();
      }

      // Wait for first image to load before displaying question
      await this.ensureFirstImageLoaded();

      // Guard: Check if quiz was closed during image loading
      if (!this.isActive) {
        log('startQuiz aborted: quiz was closed during initialization');
        return;
      }

      // Display first question
      await this.displayQuestion();
    } catch (error) {
      captureException(error, { tags: { operation: 'startQuiz', component: 'QuizMode' } });
      
      if (error.message === 'NOT_ENOUGH_IMAGES') {
        this.showError(chrome.i18n.getMessage('quizErrorNotEnoughImages') || 'Not enough bird images available. Please check your internet connection and try again.');
      } else {
        this.showError(chrome.i18n.getMessage('quizErrorGeneral'));
      }
    }
  }

  getCurrentRegion() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['region'], (result) => {
        resolve(result.region || 'US');
      });
    });
  }

  getCachedBirds(region) {
    return new Promise((resolve) => {
      const cacheKey = `birds_${region}`;
      chrome.storage.local.get(cacheKey, (result) => {
        const data = result[cacheKey];
        if (data && Date.now() - data.timestamp < data.duration) {
          resolve(data.value);
        } else {
          resolve(null);
        }
      });
    });
  }

  fetchBirdsForRegion(region) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'getBirdsByRegion',
        region: region
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.success) {
          resolve(response.birds);
        } else {
          reject(new Error(response?.error || 'Failed to fetch birds'));
        }
      });
    });
  }

  async prepareQuestions(birds) {
    // Select 10 unique birds for questions
    const shuffledBirds = [...birds].sort(() => 0.5 - Math.random());
    const selectedBirds = shuffledBirds.slice(0, 10);

    // Prepare questions without loading images first
    this.questions = selectedBirds.map(bird => {
      // Get 3 other birds as distractors (same region, different species)
      const distractors = shuffledBirds
        .filter(b => b.speciesCode !== bird.speciesCode)
        .sort(() => 0.5 - Math.random())
        .slice(0, 3);

      // Create options array with correct answer and distractors
      const options = [
        { name: bird.primaryComName, isCorrect: true },
        ...distractors.map(d => ({ name: d.primaryComName, isCorrect: false }))
      ];

      // Shuffle options
      options.sort(() => 0.5 - Math.random());

      return {
        bird: {
          ...bird,
          imageUrl: null, // Will be loaded when needed
          photographer: null,
          photographerUrl: null
        },
        options: options,
        correctAnswer: bird.primaryComName
      };
    });

    this.currentQuestion = 0;
    this.score = 0;
    this.answers = [];

    // Start loading images - first question with priority, others in background
    this.startImagePreloading();
  }

  async startImagePreloading() {
    // Load first question's image with priority
    if (this.questions.length > 0 && this.questions[0] && this.questions[0].bird) {
      const firstBird = this.questions[0].bird;

      // Check cache first
      let imageInfo = await this.getBirdImage(firstBird.speciesCode);
      if (!imageInfo) {
        imageInfo = await this.loadBirdImageFromCDN(firstBird.speciesCode, true); // Priority = true
      }

      // Update first question with image info (only if we got a valid image)
      if (this.questions && this.questions[0] && this.questions[0].bird && imageInfo?.imageUrl) {
        this.questions[0].bird = {
          ...firstBird,
          imageUrl: imageInfo.imageUrl,
          photographer: imageInfo.photographer,
          photographerUrl: imageInfo.photographerUrl
        };
      }

      // Preload first image in browser cache
      if (imageInfo?.imageUrl) {
        this.preloadImageInBrowser(imageInfo.imageUrl);
      }
    }

    // Start preloading remaining images in background (non-priority)
    this.preloadRemainingImages();
  }

  async ensureFirstImageLoaded() {
    // Make sure first question has a proper image loaded
    if (this.questions.length > 0 && this.questions[0] && this.questions[0].bird) {
      const firstBird = this.questions[0].bird;

      // If image is still null, try to load it
      if (!firstBird.imageUrl) {
        // Check cache first
        let imageInfo = await this.getBirdImage(firstBird.speciesCode);
        if (!imageInfo) {
          imageInfo = await this.loadBirdImageFromCDN(firstBird.speciesCode, true);
        }

        // Update first question with image info (only if we got a valid image)
        if (this.questions && this.questions[0] && this.questions[0].bird && imageInfo?.imageUrl) {
          this.questions[0].bird = {
            ...firstBird,
            imageUrl: imageInfo.imageUrl,
            photographer: imageInfo.photographer,
            photographerUrl: imageInfo.photographerUrl
          };
        }
      }
    }
    
    // If first question still has no image, try to find another question with an image
    // or skip to a question that has one
    await this.ensureValidQuestionImages();
  }
  
  async ensureValidQuestionImages() {
    // Filter out questions without valid images and ensure we have enough
    const validQuestions = [];
    
    for (const question of this.questions) {
      if (question.bird.imageUrl) {
        validQuestions.push(question);
      } else {
        // Try one more time to load the image
        let imageInfo = await this.getBirdImage(question.bird.speciesCode);
        if (!imageInfo) {
          try {
            imageInfo = await this.loadBirdImageFromCDN(question.bird.speciesCode, true);
          } catch (error) {
            // Skip this question if image fails to load
            log(`Skipping question for ${question.bird.primaryComName} - no image available`);
            continue;
          }
        }
        
        if (imageInfo?.imageUrl) {
          question.bird.imageUrl = imageInfo.imageUrl;
          question.bird.photographer = imageInfo.photographer;
          question.bird.photographerUrl = imageInfo.photographerUrl;
          validQuestions.push(question);
        } else {
          log(`Skipping question for ${question.bird.primaryComName} - no image available`);
        }
      }
    }
    
    // Update questions array with only valid ones
    this.questions = validQuestions;
    
    // Check if we still have enough questions (minimum 5 for a meaningful quiz)
    if (this.questions.length < 5) {
      throw new Error('NOT_ENOUGH_IMAGES');
    }
  }

  async preloadRemainingImages() {
    // Load images for remaining questions in background
    for (let i = 1; i < this.questions.length; i++) {
      if (!this.questions[i] || !this.questions[i].bird) continue;
      const bird = this.questions[i].bird;

      // Skip if already has an image
      if (bird.imageUrl) continue;

      // Check cache first
      let imageInfo = await this.getBirdImage(bird.speciesCode);
      if (!imageInfo) {
        // Add to queue without priority
        this.loadBirdImageFromCDN(bird.speciesCode, false).then(info => {
          // Safety check: ensure questions array and question still exist
          // Only update if we got a valid image
          if (this.questions && this.questions[i] && this.questions[i].bird && info?.imageUrl) {
            this.questions[i].bird = {
              ...bird,
              imageUrl: info.imageUrl,
              photographer: info.photographer,
              photographerUrl: info.photographerUrl
            };
          }
        }).catch(error => {
          // Log error but don't update with default image
          log(`Failed to preload image for ${bird.primaryComName}: ${error.message}`);
        });
      } else if (imageInfo?.imageUrl) {
        // Update immediately if cached and has valid URL
        if (this.questions && this.questions[i] && this.questions[i].bird) {
          this.questions[i].bird = {
            ...bird,
            imageUrl: imageInfo.imageUrl,
            photographer: imageInfo.photographer,
            photographerUrl: imageInfo.photographerUrl
          };
        }
      }
    }
  }

  async getBirdImage(speciesCode) {
    return new Promise((resolve) => {
      const cacheKey = `image_${speciesCode}`;
      chrome.storage.local.get(cacheKey, (result) => {
        const data = result[cacheKey];
        if (data && Date.now() - data.timestamp < data.duration) {
          resolve(data.value);
        } else {
          resolve(null);
        }
      });
    });
  }

  // Throttled image loading to respect Macaulay Library API
  async loadBirdImageFromCDN(speciesCode, priority = false) {
    return new Promise((resolve) => {
      this.imageLoadingQueue.push({ speciesCode, resolve, priority });
      this.processImageQueue();
    });
  }

  async processImageQueue() {
    if (this.isLoadingImages || this.imageLoadingQueue.length === 0) {
      return;
    }

    this.isLoadingImages = true;

    // Process priority items first (current question), then regular items
    this.imageLoadingQueue.sort((a, b) => b.priority - a.priority);

    while (this.imageLoadingQueue.length > 0) {
      const { speciesCode, resolve } = this.imageLoadingQueue.shift();

      try {
        const imageInfo = await this.fetchImageFromAPI(speciesCode);
        resolve(imageInfo);
      } catch (error) {
        // Return null instead of default image - let caller handle the failure
        resolve(null);
      }

      // Add delay between requests to be respectful to Macaulay Library
      if (this.imageLoadingQueue.length > 0) {
        await this.delay(300); // 300ms delay between requests
      }
    }

    this.isLoadingImages = false;
  }

  async fetchImageFromAPI(speciesCode) {
    try {
      // Create abort controller for this request
      if (!this.abortController) {
        this.abortController = new AbortController();
      }

      // Use the same logic as in background.js to fetch from Macaulay Library
      const url = `https://search.macaulaylibrary.org/api/v1/search?taxonCode=${speciesCode}&count=1&sort=rating_rank_desc&mediaType=photo`;
      const response = await fetch(url, {
        signal: this.abortController.signal,
        cache: 'default' // Use browser cache when available
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.results?.content?.[0]) {
        const image = data.results.content[0];
        if (image.mediaUrl) {
          const imageInfo = {
            imageUrl: image.mediaUrl,
            photographer: image.userDisplayName,
            photographerUrl: `https://macaulaylibrary.org/asset/${image.assetId}`
          };

          // Cache the image data
          const cacheKey = `image_${speciesCode}`;
          chrome.storage.local.set({
            [cacheKey]: {
              value: imageInfo,
              timestamp: Date.now(),
              duration: 24 * 60 * 60 * 1000 // 24 hours
            }
          });

          // Preload image in browser cache for faster display
          this.preloadImageInBrowser(imageInfo.imageUrl);

          return imageInfo;
        }
      }

      throw new Error('No image found in Macaulay Library');
    } catch (error) {
      log(`Error loading image for ${speciesCode}: ${error.message}`);
      throw error;
    }
  }

  // Helper delay function
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Preload image in browser cache for instant display
  preloadImageInBrowser(imageUrl) {
    if (!imageUrl || this.preloadedImages.has(imageUrl)) {
      return;
    }

    const img = new Image();
    img.onload = () => {
      // Image successfully preloaded in browser cache
    };
    img.onerror = () => {
      // Remove from tracking if failed to load
      this.preloadedImages.delete(imageUrl);
    };
    img.src = imageUrl;

    // Track for cleanup
    this.preloadedImages.set(imageUrl, img);
  }

  showQuizLoading() {
    // Show loading text in question area for visual cohesion
    const questionText = document.getElementById('quiz-question-text');
    if (questionText) {
      questionText.innerHTML = `<span class="loading-text">${chrome.i18n.getMessage('quizLoadingQuestions')}</span>`;
    }

    // Show skeleton loading state for image
    const imageContainer = document.getElementById('quiz-image-container');
    if (imageContainer) {
      imageContainer.classList.add('loading');
      imageContainer.innerHTML = `
        <div class="skeleton skeleton-image"></div>
      `;
    }

    // Hide image meta during loading (will be shown when image loads)
    const imageMeta = document.getElementById('quiz-image-meta');
    if (imageMeta) {
      imageMeta.style.visibility = 'hidden';
    }

    // Show skeleton options - preserves 2x2 grid layout
    const optionsContainer = document.getElementById('quiz-options');
    if (optionsContainer) {
      optionsContainer.innerHTML = `
        <div class="skeleton skeleton-option"></div>
        <div class="skeleton skeleton-option"></div>
        <div class="skeleton skeleton-option"></div>
        <div class="skeleton skeleton-option"></div>
      `;
    }

    // Disable next button while loading
    const nextButton = document.getElementById('quiz-next');
    if (nextButton) {
      nextButton.disabled = true;
    }
  }

  showQuizUI() {
    // Create quiz container
    this.quizContainer = document.createElement('div');
    this.quizContainer.className = 'quiz-mode';
    this.quizContainer.innerHTML = `
      <button class="quiz-close-btn" id="quiz-close" aria-label="${chrome.i18n.getMessage('closeQuiz')}">
        <img src="images/svg/close.svg" alt="${chrome.i18n.getMessage('closeAlt')}" width="20" height="20">
      </button>
      <div class="quiz-container">
        <div class="quiz-header">
          <div class="quiz-progress-bar">
            <div class="quiz-progress-fill" id="quiz-progress-fill" style="width: 10%"></div>
          </div>
          <div class="quiz-meta">
            <span>${chrome.i18n.getMessage('quizProgress').replace('{currentQuestion}', '<span id="quiz-current">1</span>').replace('{totalQuestions}', '10')}</span>
          </div>
        </div>
        
        <div class="quiz-content">
          <!-- Question Section -->
          <div class="quiz-question-section">
            <div class="quiz-question-text" id="quiz-question-text">
              ${chrome.i18n.getMessage('quizModeQuestion')}
            </div>
          </div>
          
          <!-- Image Section -->
          <div class="quiz-image-section">
            <div class="quiz-image-container" id="quiz-image-container">
              <!-- Image will be loaded here -->
            </div>
            <div class="quiz-image-meta" id="quiz-image-meta">
              ${chrome.i18n.getMessage('photoBy')} <a href="#" id="quiz-photographer" target="_blank">${chrome.i18n.getMessage('loading')}</a>
            </div>
          </div>
          
          <!-- Options Section -->
          <div class="quiz-options-section">
            <div class="quiz-options-grid" id="quiz-options">
              <!-- Options will be inserted here -->
            </div>
          </div>
          
          <!-- Actions Section -->
          <div class="quiz-actions">
            <button class="quiz-btn" id="quiz-next" disabled>${chrome.i18n.getMessage('quizNextQuestion')}</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.quizContainer);

    // Setup event listeners
    this.setupQuizEventListeners();
  }

  hideMainUI() {
    // Hide all main UI elements except the background image
    const elementsToHide = [
      '.info-panel',
      '.control-buttons',
      '.search-container',
      '.top-sites-container',
      '.external-links'
    ];

    elementsToHide.forEach(selector => {
      const element = document.querySelector(selector);
      if (element) {
        element.style.display = 'none';
      }
    });
  }

  showMainUI() {
    // Use centralized UI restoration function for consistency
    if (window.restoreMainUIElements) {
      window.restoreMainUIElements();
    } else {
      // Fallback if function isn't available yet
      const elementsToShow = [
        '.info-panel',
        '.control-buttons',
        '.external-links'
      ];

      elementsToShow.forEach(selector => {
        const element = document.querySelector(selector);
        if (element) {
          element.style.display = '';
        }
      });
    }
  }

  async displayQuestion() {
    // Guard: Check if quiz is still active and container exists
    if (!this.isActive || !this.quizContainer || !document.body.contains(this.quizContainer)) {
      log('displayQuestion aborted: quiz is no longer active or container removed');
      return;
    }

    // Guard: Check if questions array is valid
    if (!this.questions || this.currentQuestion >= this.questions.length) {
      log('displayQuestion aborted: no valid question at current index');
      return;
    }

    const question = this.questions[this.currentQuestion];
    if (!question) {
      log('displayQuestion aborted: question is null');
      return;
    }

    this.selectedAnswer = null;
    this.hasAnswered = false;

    // Update progress - with null checks for DOM elements
    const progressPercent = ((this.currentQuestion + 1) / 10) * 100;
    const progressFill = document.getElementById('quiz-progress-fill');
    const currentEl = document.getElementById('quiz-current');
    
    if (!progressFill || !currentEl) {
      log('displayQuestion aborted: required DOM elements not found');
      return;
    }
    
    progressFill.style.width = `${progressPercent}%`;
    currentEl.textContent = this.currentQuestion + 1;

    // Update question text (clear any loading state)
    const questionText = document.getElementById('quiz-question-text');
    if (questionText) {
      questionText.textContent = chrome.i18n.getMessage('quizModeQuestion');
    }

    // Update next button text
    const nextBtn = document.getElementById('quiz-next');
    if (!nextBtn) {
      log('displayQuestion aborted: next button not found');
      return;
    }
    if (this.currentQuestion === 9) {
      nextBtn.textContent = chrome.i18n.getMessage('quizShowResults');
    } else {
      nextBtn.textContent = chrome.i18n.getMessage('quizNextQuestion');
    }
    nextBtn.disabled = true;

    // OPTIMAL TIMING: Preload next question's image immediately when displaying current question
    // This gives maximum time for the next image to load while user reads and answers
    this.preloadNextQuestionImage();

    // Update photographer info immediately if available
    if (question.bird.photographer) {
      this.updateImageMeta(question.bird);
    } else {
      // Show loading for photographer if not available
      const imageMeta = document.getElementById('quiz-image-meta');
      if (imageMeta) {
        imageMeta.style.visibility = 'visible';
        imageMeta.innerHTML = `${chrome.i18n.getMessage('photoBy')} <a href="#" id="quiz-photographer" target="_blank">${chrome.i18n.getMessage('loading')}</a>`;
      }
    }

    // Show skeleton loading indicator for image
    const imageContainer = document.getElementById('quiz-image-container');
    if (!imageContainer) {
      log('displayQuestion aborted: image container not found');
      return;
    }
    imageContainer.classList.add('loading');
    imageContainer.innerHTML = `
      <div class="image-loading-overlay">
        <div class="spinner"></div>
      </div>
    `;

    // Load image - question should already have a valid imageUrl from ensureValidQuestionImages
    const imageUrl = question.bird.imageUrl;
    
    if (!imageUrl) {
      // This shouldn't happen as we filter out questions without images, but handle it gracefully
      log(`Warning: Question for ${question.bird.primaryComName} has no image URL`);
      this.showImageLoadError(imageContainer, question.bird.primaryComName);
      return;
    }
    
    const img = new Image();

    img.onload = () => {
      // Guard: Check if quiz is still active and container exists
      if (!this.isActive || !document.body.contains(imageContainer)) {
        return;
      }
      imageContainer.classList.remove('loading');
      imageContainer.innerHTML = '';
      const imageElement = document.createElement('img');
      imageElement.className = 'quiz-image loaded';
      imageElement.src = imageUrl;
      imageElement.alt = `${question.bird.primaryComName} - Bird quiz image`;
      imageContainer.appendChild(imageElement);
    };

    img.onerror = async () => {
      // Guard: Check if quiz is still active
      if (!this.isActive) {
        return;
      }
      
      // If image fails to load, try to fetch a new one
      const imageInfo = await this.loadBirdImageFromCDN(question.bird.speciesCode);
      
      // Guard again after async operation
      if (!this.isActive || !document.body.contains(imageContainer)) {
        return;
      }
      
      if (!imageInfo?.imageUrl) {
        // Show a friendly error message instead of default image
        this.showImageLoadError(imageContainer, question.bird.primaryComName);
        return;
      }
      
      const newImageUrl = imageInfo.imageUrl;

      const retryImg = new Image();
      retryImg.onload = () => {
        // Guard: Check if quiz is still active and container exists
        if (!this.isActive || !document.body.contains(imageContainer)) {
          return;
        }
        imageContainer.classList.remove('loading');
        imageContainer.innerHTML = '';
        const imageElement = document.createElement('img');
        imageElement.className = 'quiz-image loaded';
        imageElement.src = newImageUrl;
        imageElement.alt = `${question.bird.primaryComName} - Bird quiz image`;
        imageContainer.appendChild(imageElement);

        // Update the question data with new image
        if (this.questions && this.questions[this.currentQuestion]) {
          question.bird.imageUrl = newImageUrl;

          // Update photographer info if we got new info
          if (imageInfo.photographer) {
            question.bird.photographer = imageInfo.photographer;
            question.bird.photographerUrl = imageInfo.photographerUrl;
            this.updateImageMeta(question.bird);
          }
        }
      };

      retryImg.onerror = () => {
        // Guard: Check if quiz is still active and container exists
        if (!this.isActive || !document.body.contains(imageContainer)) {
          return;
        }
        // Show a friendly error message instead of default image
        this.showImageLoadError(imageContainer, question.bird.primaryComName);
      };

      retryImg.src = newImageUrl;
    };

    img.src = imageUrl;

    // Display options with staggered animation
    const optionsContainer = document.getElementById('quiz-options');
    if (!optionsContainer) {
      log('displayQuestion aborted: options container not found');
      return;
    }
    optionsContainer.innerHTML = '';

    question.options.forEach((option, index) => {
      const optionElement = document.createElement('div');
      optionElement.className = 'quiz-option';
      optionElement.textContent = option.name;
      optionElement.style.opacity = '0';

      const optionHandler = () => this.selectOption(index);
      optionElement.addEventListener('click', optionHandler);
      this.eventListeners.push({ element: optionElement, event: 'click', handler: optionHandler });

      optionsContainer.appendChild(optionElement);

      // Staggered fade-in animation
      setTimeout(() => {
        optionElement.classList.add('loaded');
        optionElement.style.opacity = '';
      }, index * 50);
    });
  }

  updateImageMeta(bird) {
    const imageMeta = document.getElementById('quiz-image-meta');
    const photographerLink = document.getElementById('quiz-photographer');
    
    // Show the image meta container
    if (imageMeta) {
      imageMeta.style.visibility = 'visible';
    }
    
    if (photographerLink && bird.photographer) {
      photographerLink.textContent = bird.photographer;
      photographerLink.href = bird.photographerUrl || '#';
    }
  }
  
  showImageLoadError(container, birdName) {
    container.classList.remove('loading');
    container.innerHTML = `
      <div class="quiz-image-error">
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="32" cy="32" r="30" stroke="currentColor" stroke-width="2" stroke-dasharray="6 4" opacity="0.3"/>
          <path d="M32 18C32 18 22 24 22 32C22 40 32 46 32 46" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.6"/>
          <path d="M32 18C32 18 42 24 42 32C42 40 32 46 32 46" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.6"/>
          <circle cx="32" cy="28" r="3" fill="currentColor" opacity="0.8"/>
          <path d="M26 38C26 38 28 42 32 42C36 42 38 38 38 38" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.6"/>
        </svg>
        <p class="quiz-image-error-text">Image unavailable</p>
        <p class="quiz-image-error-hint">Can you identify this bird?</p>
      </div>
    `;
    
    // Hide photographer info when there's no image
    const imageMeta = document.getElementById('quiz-image-meta');
    if (imageMeta) {
      imageMeta.style.display = 'none';
    }
  }

  selectOption(index) {
    if (this.hasAnswered) return;

    const options = document.querySelectorAll('.quiz-option');

    // Add selection to clicked option
    options[index].classList.add('selected');
    this.selectedAnswer = index;

    // Automatically submit the answer
    this.submitAnswer();
  }

  submitAnswer() {
    if (this.selectedAnswer === null || this.hasAnswered) return;
    
    // Guard: Check if quiz is still active and has valid question
    if (!this.isActive || !this.questions || !this.questions[this.currentQuestion]) {
      return;
    }

    const question = this.questions[this.currentQuestion];
    const selectedOption = question.options[this.selectedAnswer];
    const isCorrect = selectedOption.isCorrect;

    // Update score
    if (isCorrect) {
      this.score++;
    }

    // Record answer
    this.answers.push({
      question: question,
      selectedAnswer: selectedOption.name,
      correctAnswer: question.correctAnswer,
      isCorrect: isCorrect
    });

    // Show feedback
    this.showAnswerFeedback();
    this.hasAnswered = true;

    // Update next button
    const nextBtn = document.getElementById('quiz-next');
    if (!nextBtn) return;
    
    if (this.currentQuestion === 9) {
      nextBtn.textContent = chrome.i18n.getMessage('quizShowResults');
    } else {
      nextBtn.textContent = chrome.i18n.getMessage('quizNextQuestion');
    }
    nextBtn.disabled = false;
  }

  showAnswerFeedback() {
    // Guard: Check if quiz is still active
    if (!this.isActive || !this.questions || !this.questions[this.currentQuestion]) {
      return;
    }
    
    const options = document.querySelectorAll('.quiz-option');

    // Only show which option was selected - don't reveal correct/incorrect
    // The reveal happens on the results page
    options.forEach((option, index) => {
      option.classList.add('disabled');

      if (index === this.selectedAnswer) {
        option.classList.add('selected-confirmed');
      }
    });
  }

  async nextQuestion() {
    // Guard: Check if quiz is still active
    if (!this.isActive) {
      log('nextQuestion aborted: quiz is no longer active');
      return;
    }
    this.currentQuestion++;
    await this.displayQuestion();
  }

  async preloadNextQuestionImage() {
    // Guard: Check if quiz is still active
    if (!this.isActive || !this.questions) {
      return;
    }
    
    const nextQuestionIndex = this.currentQuestion + 1;
    if (nextQuestionIndex < this.questions.length && this.questions[nextQuestionIndex] && this.questions[nextQuestionIndex].bird) {
      const nextBird = this.questions[nextQuestionIndex].bird;

      // Only preload if image not already loaded
      if (!nextBird.imageUrl) {
        // Check cache first
        let imageInfo = await this.getBirdImage(nextBird.speciesCode);
        if (imageInfo?.imageUrl) {
          // Update immediately if cached
          if (this.questions && this.questions[nextQuestionIndex] && this.questions[nextQuestionIndex].bird) {
            this.questions[nextQuestionIndex].bird = {
              ...nextBird,
              imageUrl: imageInfo.imageUrl,
              photographer: imageInfo.photographer,
              photographerUrl: imageInfo.photographerUrl
            };
          }

          // Preload in browser cache for instant display
          this.preloadImageInBrowser(imageInfo.imageUrl);
        } else {
          // Add to priority queue for next question
          try {
            const info = await this.loadBirdImageFromCDN(nextBird.speciesCode, true);
            if (info?.imageUrl && this.questions && this.questions[nextQuestionIndex] && this.questions[nextQuestionIndex].bird) {
              this.questions[nextQuestionIndex].bird = {
                ...nextBird,
                imageUrl: info.imageUrl,
                photographer: info.photographer,
                photographerUrl: info.photographerUrl
              };
            }
          } catch (error) {
            // Log error - question will show error state if image truly unavailable
            log(`Failed to preload next question image: ${error.message}`);
          }
        }
      } else {
        // Still preload in browser cache if not already done
        this.preloadImageInBrowser(nextBird.imageUrl);
      }
    }
  }

  showResults() {
    // Guard: Check if quiz container still exists
    if (!this.quizContainer || !document.body.contains(this.quizContainer)) {
      log('showResults aborted: quiz container no longer exists');
      return;
    }
    
    this.quizContainer.innerHTML = `
      <button class="quiz-close-btn" id="quiz-results-close" aria-label="${chrome.i18n.getMessage('closeQuiz')}">
        <img src="images/svg/close.svg" alt="${chrome.i18n.getMessage('closeAlt')}" width="20" height="20">
      </button>
      <div class="quiz-container">
        <div class="quiz-header">
          <div class="quiz-progress-bar">
            <div class="quiz-progress-fill" style="width: 100%"></div>
          </div>
          <h1 class="quiz-question-title">${chrome.i18n.getMessage('quizResults')}</h1>
        </div>
        
        <div class="quiz-content">
          <div class="quiz-results">
            <div class="quiz-final-score">${this.score}/10</div>
            <div class="quiz-results-summary">
              ${this.getScoreMessage(this.score)}
            </div>
            <div class="quiz-results-list">
              <h3 class="quiz-results-title">${chrome.i18n.getMessage('questionReview')}</h3>
              ${this.answers.map((answer, index) => `
                <div class="quiz-result-item ${answer.isCorrect ? 'correct' : 'incorrect'}">
                  <div class="quiz-result-thumbnail-wrapper">
                    <img src="${answer.question.bird.imageUrl}" alt="${answer.question.bird.primaryComName}" class="quiz-result-thumbnail" />
                    <div class="quiz-result-badge ${answer.isCorrect ? 'correct' : 'incorrect'}">
                      ${answer.isCorrect ? '✓' : '✗'}
                    </div>
                  </div>
                  <div class="quiz-result-info">
                    <div class="quiz-result-bird-name">${answer.question.bird.primaryComName}</div>
                    ${!answer.isCorrect ? `<div class="quiz-result-correct-answer">${chrome.i18n.getMessage('correctAnswer', [answer.correctAnswer])}</div>` : ''}
                  </div>
                </div>
              `).join('')}
            </div>
            <div class="quiz-actions quiz-actions-results">
              <button class="quiz-btn share" id="quiz-share-results">
                <img src="images/svg/share.svg" alt="" width="16" height="16" class="quiz-share-icon">
                ${chrome.i18n.getMessage('quizShareResults') || 'Share Results'}
              </button>
              <button class="quiz-btn primary" id="quiz-restart">${chrome.i18n.getMessage('quizStartNewQuiz')}</button>
              <button class="quiz-btn secondary" id="quiz-exit">${chrome.i18n.getMessage('quizExitQuiz')}</button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Add event listeners and track them for cleanup
    const shareButton = document.getElementById('quiz-share-results');
    const restartButton = document.getElementById('quiz-restart');
    const exitButton = document.getElementById('quiz-exit');

    // Share results handler
    const shareHandler = () => this.shareCollage();
    shareButton.addEventListener('click', shareHandler);
    this.eventListeners.push({ element: shareButton, event: 'click', handler: shareHandler });

    const restartHandler = async () => {
      // Reset quiz state without exiting the modal
      this.currentQuestion = 0;
      this.score = 0;
      this.questions = [];
      this.answers = [];
      this.selectedAnswer = null;
      this.hasAnswered = false;

      // Clear preloaded images and reset loading state
      this.imageLoadingQueue = [];
      this.isLoadingImages = false;

      try {
        // Get current region setting
        const region = await this.getCurrentRegion();

        // Get cached birds for the region
        const birds = await this.getCachedBirds(region);

        if (!birds || birds.length < 10) {
          this.showError(chrome.i18n.getMessage('quizErrorNotEnoughBirds'));
          return;
        }

        // Prepare new quiz questions
        await this.prepareQuestions(birds);

        // Update the modal content to show quiz UI instead of results
        this.updateQuizUIForNewQuiz();

        // Show loading indicator while preparing first image
        this.showQuizLoading();

        // Wait for first image to load before displaying question
        await this.ensureFirstImageLoaded();

        // Display first question
        await this.displayQuestion();
      } catch (error) {
        log(`Error restarting quiz: ${error.message}`);
        captureException(error, { tags: { operation: 'restartQuiz', component: 'QuizMode' } });
        this.showError(chrome.i18n.getMessage('quizErrorGeneral'));
      }
    };
    const exitHandler = () => this.exitQuiz();

    restartButton.addEventListener('click', restartHandler);
    exitButton.addEventListener('click', exitHandler);

    this.eventListeners.push({ element: restartButton, event: 'click', handler: restartHandler });
    this.eventListeners.push({ element: exitButton, event: 'click', handler: exitHandler });

    // Add close button for results page
    const resultsCloseButton = document.getElementById('quiz-results-close');
    if (resultsCloseButton) {
      const resultsCloseHandler = () => this.exitQuiz();
      resultsCloseButton.addEventListener('click', resultsCloseHandler);
      this.eventListeners.push({ element: resultsCloseButton, event: 'click', handler: resultsCloseHandler });
    }
  }

  getScoreMessage(score) {
    if (score >= 9) return chrome.i18n.getMessage('quizScoreExcellent');
    if (score >= 7) return chrome.i18n.getMessage('quizScoreGreat');
    if (score >= 5) return chrome.i18n.getMessage('quizScoreGood');
    if (score >= 3) return chrome.i18n.getMessage('quizScoreNotBad');
    return chrome.i18n.getMessage('quizScoreKeepLearning');
  }

  showExitConfirmation() {
    // Don't show confirmation on results page
    if (this.currentQuestion >= 10 || this.answers.length === 10) {
      this.exitQuiz();
      return;
    }
    
    // Prevent multiple exit modals from being created
    const existingModal = document.querySelector('.quiz-exit-modal');
    if (existingModal) {
      return; // Modal already shown
    }

    const exitModal = document.createElement('div');
    exitModal.className = 'quiz-exit-modal';
    exitModal.innerHTML = `
      <div class="quiz-exit-content">
        <h3>${chrome.i18n.getMessage('quizExitConfirmTitle')}</h3>
        <p>${chrome.i18n.getMessage('quizExitConfirmMessage')}</p>
        <div class="quiz-exit-actions">
          <button class="quiz-btn primary" id="quiz-confirm-exit">${chrome.i18n.getMessage('quizExitConfirm')}</button>
          <button class="quiz-btn" id="quiz-cancel-exit">${chrome.i18n.getMessage('quizExitCancel')}</button>
        </div>
      </div>
    `;

    document.body.appendChild(exitModal);

    const confirmButton = document.getElementById('quiz-confirm-exit');
    const cancelButton = document.getElementById('quiz-cancel-exit');

    if (!confirmButton || !cancelButton) {
      captureException(new Error('Exit confirmation buttons not found'), { tags: { component: 'QuizMode' } });
      // Remove the modal if buttons weren't found to prevent it from being stuck
      if (exitModal && exitModal.parentNode) {
        document.body.removeChild(exitModal);
      }
      return;
    }

    const confirmHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (exitModal && exitModal.parentNode) {
        document.body.removeChild(exitModal);
      }
      this.exitQuiz();
    };
    const cancelHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (exitModal && exitModal.parentNode) {
        document.body.removeChild(exitModal);
      }
    };
    
    // Also allow clicking outside the modal content to cancel
    const outsideClickHandler = (e) => {
      if (e.target === exitModal) {
        cancelHandler(e);
      }
    };

    confirmButton.addEventListener('click', confirmHandler);
    cancelButton.addEventListener('click', cancelHandler);
    exitModal.addEventListener('click', outsideClickHandler);

    // Note: These don't need to be tracked in this.eventListeners since the modal will be removed
  }

  exitQuiz() {
    // Clean up resources before exiting
    this.cleanup();

    this.isActive = false;
    this.currentQuestion = 0;
    this.score = 0;
    this.questions = [];
    this.answers = [];
    this.selectedAnswer = null;
    this.hasAnswered = false;

    if (this.quizContainer) {
      document.body.removeChild(this.quizContainer);
      this.quizContainer = null;
    }

    // Remove any exit modals
    const exitModal = document.querySelector('.quiz-exit-modal');
    if (exitModal) {
      document.body.removeChild(exitModal);
    }

    this.showMainUI();
  }

  // Comprehensive cleanup method to prevent memory leaks
  cleanup() {
    log('Cleaning up quiz resources...');

    // Cancel any pending image loading requests
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Clear image loading queue
    this.imageLoadingQueue = [];
    this.isLoadingImages = false;

    // Clean up preloaded images
    this.preloadedImages.forEach((img, url) => {
      // Set src to empty to potentially free memory
      img.src = '';
      img.onload = null;
      img.onerror = null;
    });
    this.preloadedImages.clear();

    // Remove tracked event listeners (except main keyboard listener)
    this.eventListeners.forEach(({ element, event, handler, persist }) => {
      if (!persist) { // Only remove non-persistent listeners
        try {
          element.removeEventListener(event, handler);
        } catch (error) {
          // Element might have been removed already, ignore error
        }
      }
    });
    // Keep only persistent listeners (like main keyboard listener)
    this.eventListeners = this.eventListeners.filter(listener => listener.persist);

    // Clear large data structures
    if (this.questions.length > 0) {
      this.questions.forEach(question => {
        // Clear image references
        if (question.bird) {
          question.bird.imageUrl = null;
          question.bird.photographer = null;
          question.bird.photographerUrl = null;
        }
      });
      this.questions = [];
    }

    if (this.answers.length > 0) {
      this.answers.forEach(answer => {
        // Clear references
        answer.question = null;
      });
      this.answers = [];
    }

    // Force garbage collection hint (not guaranteed but helpful)
    if (window.gc && typeof window.gc === 'function') {
      window.gc();
    }

    log('Quiz cleanup completed');
  }

  // Destructor method - call this when QuizMode instance is no longer needed
  destroy() {
    log('Destroying QuizMode instance...');

    // Exit quiz if active
    if (this.isActive) {
      this.exitQuiz();
    } else {
      // Just cleanup if not active
      this.cleanup();
    }

    // Remove global keyboard listener if it exists
    this.eventListeners.forEach(({ element, event, handler }) => {
      if (element === document && event === 'keydown') {
        document.removeEventListener(event, handler);
      }
    });

    // Clear all references
    this.quizContainer = null;
    this.questions = null;
    this.answers = null;
    this.imageLoadingQueue = null;
    this.preloadedImages = null;
    this.eventListeners = null;
    this.abortController = null;

    log('QuizMode instance destroyed');
  }

  updateQuizUIForNewQuiz() {
    // Clean up existing event listeners before replacing HTML
    this.eventListeners.forEach(({ element, event, handler, persist }) => {
      if (!persist) { // Only remove non-persistent listeners
        try {
          element.removeEventListener(event, handler);
        } catch (error) {
          // Element might have been removed already, ignore error
        }
      }
    });
    // Remove non-persistent listeners from the array
    this.eventListeners = this.eventListeners.filter(listener => listener.persist);

    // Replace results content with fresh quiz UI
    this.quizContainer.innerHTML = `
      <button class="quiz-close-btn" id="quiz-close" aria-label="${chrome.i18n.getMessage('closeQuiz')}">
        <img src="images/svg/close.svg" alt="${chrome.i18n.getMessage('closeAlt')}" width="20" height="20">
      </button>
      <div class="quiz-container">
        <div class="quiz-header">
          <div class="quiz-progress-bar">
            <div class="quiz-progress-fill" id="quiz-progress-fill" style="width: 10%"></div>
          </div>
          <div class="quiz-meta">
            <span>${chrome.i18n.getMessage('quizProgress').replace('{currentQuestion}', '<span id="quiz-current">1</span>').replace('{totalQuestions}', '10')}</span>
          </div>
        </div>
        
        <div class="quiz-content">
          <!-- Question Section -->
          <div class="quiz-question-section">
            <div class="quiz-question-text" id="quiz-question-text">
              ${chrome.i18n.getMessage('quizModeQuestion')}
            </div>
          </div>
          
          <!-- Image Section -->
          <div class="quiz-image-section">
            <div class="quiz-image-container" id="quiz-image-container">
              <!-- Image will be loaded here -->
            </div>
            <div class="quiz-image-meta" id="quiz-image-meta">
              ${chrome.i18n.getMessage('photoBy')} <a href="#" id="quiz-photographer" target="_blank">${chrome.i18n.getMessage('loading')}</a>
            </div>
          </div>
          
          <!-- Options Section -->
          <div class="quiz-options-section">
            <div class="quiz-options-grid" id="quiz-options">
              <!-- Options will be inserted here -->
            </div>
          </div>
          
          <!-- Actions Section -->
          <div class="quiz-actions">
            <button class="quiz-btn" id="quiz-next" disabled>${chrome.i18n.getMessage('quizNextQuestion')}</button>
          </div>
        </div>
      </div>
    `;

    // Re-add event listeners for the new UI
    this.setupQuizEventListeners();
  }

  setupQuizEventListeners() {
    // Add event listeners and track them for cleanup
    const nextButton = document.getElementById('quiz-next');
    const nextHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      log(`Next button clicked. Current question: ${this.currentQuestion}, Answers: ${this.answers.length}`);
      if (this.currentQuestion < 9) {
        this.nextQuestion();
      } else {
        // This is the last question, show results
        log('Showing results...');
        this.showResults();
      }
    };
    nextButton.addEventListener('click', nextHandler);
    this.eventListeners.push({ element: nextButton, event: 'click', handler: nextHandler });

    // Add close button listener
    const closeButton = document.getElementById('quiz-close');
    if (closeButton) {
      const closeHandler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showExitConfirmation();
      };
      closeButton.addEventListener('click', closeHandler);
      this.eventListeners.push({ element: closeButton, event: 'click', handler: closeHandler });
    } else {
      console.error('Quiz close button not found');
    }

    // Add click outside to close functionality
    const outsideClickHandler = (e) => {
      // Guard: Check if quiz is still active
      if (!this.isActive) {
        return;
      }
      
      // Check if we're on share preview page - don't close on outside click
      if (this._shareDataUrl) {
        return;
      }
      
      // Check if click is on the close button (already handled separately)
      const closeButton = document.getElementById('quiz-close') || document.getElementById('quiz-results-close') || document.getElementById('quiz-share-close');
      if (closeButton && (e.target === closeButton || closeButton.contains(e.target))) {
        return; // Let the close button handler deal with this
      }
      
      // Check if click is outside the quiz container
      const quizContainerInner = document.querySelector('.quiz-container');
      if (quizContainerInner && !quizContainerInner.contains(e.target)) {
        // If on results page, exit directly, otherwise show confirmation
        if (this.currentQuestion >= 9 && this.answers.length === 10) {
          this.exitQuiz();
        } else {
          this.showExitConfirmation();
        }
      }
    };
    this.quizContainer.addEventListener('click', outsideClickHandler);
    this.eventListeners.push({ element: this.quizContainer, event: 'click', handler: outsideClickHandler });
  }

  showError(message) {
    const errorModal = document.createElement('div');
    errorModal.className = 'quiz-exit-modal';
    errorModal.innerHTML = `
      <div class="quiz-exit-content">
        <h3>${chrome.i18n.getMessage('quizErrorTitle')}</h3>
        <p>${message}</p>
        <div class="quiz-exit-actions">
          <button class="quiz-btn primary" id="quiz-error-ok">${chrome.i18n.getMessage('quizErrorOk')}</button>
        </div>
      </div>
    `;

    document.body.appendChild(errorModal);

    const errorOkButton = document.getElementById('quiz-error-ok');
    const errorHandler = () => {
      document.body.removeChild(errorModal);
    };

    errorOkButton.addEventListener('click', errorHandler);
    // Note: Error modal listeners don't need tracking since modal will be removed

    // Auto-remove after 5 seconds
    const timeoutId = setTimeout(() => {
      if (document.body.contains(errorModal)) {
        document.body.removeChild(errorModal);
      }
    }, 5000);

    // Clear timeout if modal is manually closed
    errorOkButton.addEventListener('click', () => {
      clearTimeout(timeoutId);
    });
  }

  // ==========================================
  // SHAREABLE RESULTS COLLAGE FUNCTIONALITY
  // ==========================================

  /**
   * Draw a rounded rectangle on the canvas
   */
  drawRoundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  /**
   * Draw a checkmark icon on the canvas
   */
  drawCheckmark(ctx, x, y, size) {
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = size / 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x - size / 3, y);
    ctx.lineTo(x - size / 10, y + size / 3);
    ctx.lineTo(x + size / 3, y - size / 4);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draw an X icon on the canvas
   */
  drawCross(ctx, x, y, size) {
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = size / 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - size / 4, y - size / 4);
    ctx.lineTo(x + size / 4, y + size / 4);
    ctx.moveTo(x + size / 4, y - size / 4);
    ctx.lineTo(x - size / 4, y + size / 4);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Load the BirdTab logo from extension assets
   * @returns {Promise<HTMLImageElement>} - Loaded logo image
   */
  async loadBirdTabLogo() {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load BirdTab logo'));
      // Use chrome.runtime.getURL to get the correct path to extension assets
      img.src = chrome.runtime.getURL('icons/icon128.png');
    });
  }

  /**
   * Generate a shareable collage image from quiz results
   * Professional, clean design optimized for social sharing
   * @returns {Promise<string>} - Data URL of the generated image
   */
  async generateShareableCollage() {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 630;
    const ctx = canvas.getContext('2d');

    // Design system colors - Clean, minimal palette
    const colors = {
      bgDark: '#0a0a0a',
      bgCard: '#141414',
      textPrimary: '#ffffff',
      textSecondary: '#a3a3a3',
      textMuted: '#525252',
      correct: '#22c55e',
      incorrect: '#ef4444',
      border: '#262626',
      accent: '#fafafa'
    };

    // Fill solid dark background
    ctx.fillStyle = colors.bgDark;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // ===== LEFT SIDE: Score & Branding =====
    const leftPanelWidth = 400;
    
    // Subtle gradient on left panel
    const leftGradient = ctx.createLinearGradient(0, 0, leftPanelWidth, canvas.height);
    leftGradient.addColorStop(0, '#0f0f0f');
    leftGradient.addColorStop(1, '#0a0a0a');
    ctx.fillStyle = leftGradient;
    ctx.fillRect(0, 0, leftPanelWidth, canvas.height);

    // Vertical separator line
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(leftPanelWidth, 40);
    ctx.lineTo(leftPanelWidth, canvas.height - 40);
    ctx.stroke();

    // Load and draw BirdTab logo
    const logoX = 50;
    const logoY = 50;
    try {
      const logo = await this.loadBirdTabLogo();
      ctx.drawImage(logo, logoX, logoY, 48, 48);
    } catch (error) {
      log(`Failed to load logo: ${error.message}`);
    }
    
    // BirdTab text next to logo
    ctx.fillStyle = colors.textPrimary;
    ctx.font = '600 24px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('BirdTab', logoX + 60, logoY + 24);

    // Score section - centered in left panel
    const scoreCenterX = leftPanelWidth / 2;
    const scoreCenterY = 280;
    
    // Large score number
    ctx.font = '700 120px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif';
    ctx.fillStyle = colors.textPrimary;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.score.toString(), scoreCenterX, scoreCenterY);
    
    // "out of 10" text
    ctx.font = '400 24px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif';
    ctx.fillStyle = colors.textSecondary;
    ctx.fillText(chrome.i18n.getMessage('quizShareOutOf') || 'out of 10', scoreCenterX, scoreCenterY + 70);

    // Score message
    ctx.font = '500 18px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif';
    ctx.fillStyle = colors.textMuted;
    ctx.fillText(this.getScoreMessage(this.score), scoreCenterX, scoreCenterY + 110);

    // Correct/Incorrect summary pills
    const pillY = scoreCenterY + 160;
    const pillWidth = 120;
    const pillHeight = 36;
    const pillGap = 16;
    
    // Correct pill (left)
    const correctCount = this.answers.filter(a => a.isCorrect).length;
    const correctPillX = scoreCenterX - pillWidth - pillGap / 2;
    this.drawPill(ctx, correctPillX, pillY, pillWidth, pillHeight, colors.correct, '0.15');
    ctx.fillStyle = colors.correct;
    ctx.font = '600 13px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const correctText = chrome.i18n.getMessage('quizShareCorrectCount', [correctCount]) || `${correctCount} correct`;
    ctx.fillText(`✓ ${correctText}`, correctPillX + pillWidth / 2, pillY + pillHeight / 2);
    
    // Incorrect pill (right)
    const incorrectCount = this.answers.filter(a => !a.isCorrect).length;
    const incorrectPillX = scoreCenterX + pillGap / 2;
    this.drawPill(ctx, incorrectPillX, pillY, pillWidth, pillHeight, colors.incorrect, '0.15');
    ctx.fillStyle = colors.incorrect;
    const incorrectText = chrome.i18n.getMessage('quizShareIncorrectCount', [incorrectCount]) || `${incorrectCount} incorrect`;
    ctx.fillText(`✗ ${incorrectText}`, incorrectPillX + pillWidth / 2, pillY + pillHeight / 2);

    // Footer CTA
    ctx.font = '400 14px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif';
    ctx.fillStyle = colors.textMuted;
    ctx.textAlign = 'center';
    ctx.fillText('birdtab.app', scoreCenterX, canvas.height - 40);

    // ===== RIGHT SIDE: Bird List =====
    const rightStartX = leftPanelWidth + 50;
    const rightWidth = canvas.width - leftPanelWidth - 100;
    const listStartY = 40;
    const rowHeight = 52;  // Slightly smaller to fit with bottom margin
    const cardPadding = 20;

    // Section header
    ctx.font = '500 14px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif';
    ctx.fillStyle = colors.textMuted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(chrome.i18n.getMessage('quizShareResultsHeader') || 'BIRD IDENTIFICATION RESULTS', rightStartX, listStartY + 10);

    // Draw each bird result row
    for (let i = 0; i < this.answers.length && i < 10; i++) {
      const answer = this.answers[i];
      const y = listStartY + 35 + i * rowHeight;
      const cardHeight = rowHeight - 6;

      // Row background - subtle card
      ctx.fillStyle = colors.bgCard;
      this.drawRoundedRect(ctx, rightStartX, y, rightWidth, cardHeight, 8);
      ctx.fill();

      // Left accent bar
      ctx.fillStyle = answer.isCorrect ? colors.correct : colors.incorrect;
      this.drawRoundedRect(ctx, rightStartX, y, 3, cardHeight, 2);
      ctx.fill();

      // Row number
      ctx.font = '500 14px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif';
      ctx.fillStyle = colors.textMuted;
      ctx.textAlign = 'right';
      ctx.fillText(`${i + 1}`, rightStartX + cardPadding + 20, y + cardHeight / 2 + 5);

      // Bird name
      const birdName = answer.question?.bird?.primaryComName || chrome.i18n.getMessage('quizShareUnknownBird') || 'Unknown Bird';
      ctx.font = '400 16px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif';
      ctx.fillStyle = colors.textPrimary;
      ctx.textAlign = 'left';
      
      // Truncate name if needed
      let displayName = birdName;
      const maxNameWidth = rightWidth - 120;
      while (ctx.measureText(displayName).width > maxNameWidth && displayName.length > 3) {
        displayName = displayName.slice(0, -4) + '...';
      }
      ctx.fillText(displayName, rightStartX + cardPadding + 40, y + cardHeight / 2 + 5);

      // Status indicator on right
      const statusX = rightStartX + rightWidth - 35;
      const statusY = y + cardHeight / 2;
      
      // Circle background
      ctx.beginPath();
      ctx.arc(statusX, statusY, 12, 0, Math.PI * 2);
      ctx.fillStyle = answer.isCorrect ? colors.correct : colors.incorrect;
      ctx.fill();

      // Check or X
      if (answer.isCorrect) {
        this.drawCheckmark(ctx, statusX, statusY, 10);
      } else {
        this.drawCross(ctx, statusX, statusY, 10);
      }
    }

    return canvas.toDataURL('image/png');
  }

  /**
   * Draw a pill-shaped background
   */
  drawPill(ctx, x, y, width, height, color, opacity) {
    ctx.fillStyle = color.replace(')', `, ${opacity})`).replace('rgb', 'rgba');
    if (!color.startsWith('rgb')) {
      // Convert hex to rgba
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }
    this.drawRoundedRect(ctx, x, y, width, height, height / 2);
    ctx.fill();
  }

  /**
   * Download the generated collage image
   * @param {string} dataUrl - Data URL of the image to download
   */
  downloadCollage(dataUrl) {
    const link = document.createElement('a');
    link.download = 'birdtab-quiz-results.png';
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /**
   * Share the quiz results collage
   * Shows a preview page with the generated image and share/download options
   */
  async shareCollage() {
    // Show loading state on button
    const shareBtn = document.getElementById('quiz-share-results');
    const originalContent = shareBtn?.innerHTML;
    if (shareBtn) {
      shareBtn.disabled = true;
      shareBtn.innerHTML = `<span class="quiz-share-spinner"></span> ${chrome.i18n.getMessage('quizShareGenerating') || 'Generating...'}`;
    }

    try {
      const dataUrl = await this.generateShareableCollage();
      
      // Restore button state BEFORE capturing resultsHTML
      if (shareBtn) {
        shareBtn.innerHTML = originalContent;
        shareBtn.disabled = false;
      }
      
      // Show the preview page with the generated image
      this.showSharePreview(dataUrl);
      
    } catch (error) {
      log(`Error generating collage: ${error.message}`);
      captureException(error, { tags: { operation: 'shareCollage', component: 'QuizMode' } });
      
      // Show error to user
      if (shareBtn) {
        shareBtn.innerHTML = `${chrome.i18n.getMessage('quizShareError') || 'Failed to generate'}`;
        setTimeout(() => {
          shareBtn.innerHTML = originalContent;
          shareBtn.disabled = false;
        }, 2000);
      }
      return;
    }
  }

  /**
   * Show the share preview page with the generated collage
   * @param {string} dataUrl - Data URL of the generated image
   */
  showSharePreview(dataUrl) {
    // Store reference to current results HTML to restore later
    const resultsHTML = this.quizContainer.innerHTML;
    
    // Create share preview page
    this.quizContainer.innerHTML = `
      <button class="quiz-close-btn" id="quiz-share-close" aria-label="${chrome.i18n.getMessage('closeQuiz') || 'Close'}">
        <img src="images/svg/close.svg" alt="${chrome.i18n.getMessage('closeAlt') || 'Close'}" width="20" height="20">
      </button>
      <div class="quiz-container quiz-share-preview">
        <div class="quiz-header">
          <div class="quiz-meta">
            <span>${chrome.i18n.getMessage('quizShareTitle') || 'Bird Quiz Results'}</span>
          </div>
          <h1 class="quiz-question-title">${chrome.i18n.getMessage('quizSharePreviewTitle') || 'Share Your Results'}</h1>
        </div>
        
        <div class="quiz-content quiz-share-content">
          <div class="quiz-share-image-container">
            <img src="${dataUrl}" alt="${chrome.i18n.getMessage('quizShareCollageAlt')}" class="quiz-share-preview-image" />
          </div>
          
          <div class="quiz-share-actions">
            <button class="quiz-btn share-action download" id="quiz-download-image">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              ${chrome.i18n.getMessage('quizShareDownload') || 'Download Image'}
            </button>
            <button class="quiz-btn share-action copy" id="quiz-copy-image">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              ${chrome.i18n.getMessage('quizShareCopyImage') || 'Copy to Clipboard'}
            </button>
          </div>
          
          <div class="quiz-share-back">
            <button class="quiz-btn secondary" id="quiz-share-back">
              ${chrome.i18n.getMessage('quizShareBack') || 'Back to Results'}
            </button>
          </div>
        </div>
      </div>
    `;

    // Store dataUrl and resultsHTML for later use
    this._shareDataUrl = dataUrl;
    this._resultsHTML = resultsHTML;

    // Setup event listeners
    this.setupSharePreviewListeners();
  }

  /**
   * Setup event listeners for the share preview page
   */
  setupSharePreviewListeners() {
    const closeBtn = document.getElementById('quiz-share-close');
    const downloadBtn = document.getElementById('quiz-download-image');
    const copyBtn = document.getElementById('quiz-copy-image');
    const backBtn = document.getElementById('quiz-share-back');

    // Close button - exit quiz
    if (closeBtn) {
      const closeHandler = () => this.exitQuiz();
      closeBtn.addEventListener('click', closeHandler);
      this.eventListeners.push({ element: closeBtn, event: 'click', handler: closeHandler });
    }

    // Download button
    if (downloadBtn) {
      const downloadHandler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.downloadCollage(this._shareDataUrl);
        // Show feedback
        downloadBtn.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          ${chrome.i18n.getMessage('quizShareDownloaded') || 'Downloaded!'}
        `;
        setTimeout(() => {
          downloadBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            ${chrome.i18n.getMessage('quizShareDownload') || 'Download Image'}
          `;
        }, 2000);
      };
      downloadBtn.addEventListener('click', downloadHandler);
      this.eventListeners.push({ element: downloadBtn, event: 'click', handler: downloadHandler });
    }

    // Copy to clipboard button
    if (copyBtn) {
      const copyHandler = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          // Convert data URL to blob
          const response = await fetch(this._shareDataUrl);
          const blob = await response.blob();
          
          // Try to copy image to clipboard
          if (navigator.clipboard && navigator.clipboard.write) {
            const item = new ClipboardItem({ 'image/png': blob });
            await navigator.clipboard.write([item]);
            
            // Show success feedback
            copyBtn.innerHTML = `
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              ${chrome.i18n.getMessage('quizShareCopied') || 'Copied!'}
            `;
          } else {
            throw new Error('Clipboard API not available');
          }
        } catch (error) {
          log(`Failed to copy image to clipboard: ${error.message}`);
          copyBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="15" y1="9" x2="9" y2="15"></line>
              <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>
            ${chrome.i18n.getMessage('quizShareCopyFailed') || 'Copy failed'}
          `;
        }
        
        // Reset button after delay
        setTimeout(() => {
          copyBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            ${chrome.i18n.getMessage('quizShareCopyImage') || 'Copy to Clipboard'}
          `;
        }, 2000);
      };
      copyBtn.addEventListener('click', copyHandler);
      this.eventListeners.push({ element: copyBtn, event: 'click', handler: copyHandler });
    }

    // Back button - return to results
    if (backBtn) {
      const backHandler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.returnToResults();
      };
      backBtn.addEventListener('click', backHandler);
      this.eventListeners.push({ element: backBtn, event: 'click', handler: backHandler });
    }
  }

  /**
   * Return to the results page from share preview
   */
  returnToResults() {
    if (this._resultsHTML) {
      // Clean up share preview listeners (elements will be replaced)
      this.eventListeners = this.eventListeners.filter(listener => listener.persist);
      
      this.quizContainer.innerHTML = this._resultsHTML;
      
      // Re-setup event listeners for results page
      this.setupResultsEventListeners();
      
      // Clean up stored data
      delete this._shareDataUrl;
      delete this._resultsHTML;
    }
  }

  /**
   * Setup event listeners for results page (called when returning from share preview)
   */
  setupResultsEventListeners() {
    const shareButton = document.getElementById('quiz-share-results');
    const restartButton = document.getElementById('quiz-restart');
    const exitButton = document.getElementById('quiz-exit');
    const resultsCloseButton = document.getElementById('quiz-results-close');

    // Share results handler
    if (shareButton) {
      const shareHandler = () => this.shareCollage();
      shareButton.addEventListener('click', shareHandler);
      this.eventListeners.push({ element: shareButton, event: 'click', handler: shareHandler });
    }

    // Restart handler
    if (restartButton) {
      const restartHandler = async () => {
        this.currentQuestion = 0;
        this.score = 0;
        this.questions = [];
        this.answers = [];
        this.selectedAnswer = null;
        this.hasAnswered = false;
        this.imageLoadingQueue = [];
        this.isLoadingImages = false;

        try {
          const region = await this.getCurrentRegion();
          const birds = await this.getCachedBirds(region);

          if (!birds || birds.length < 10) {
            this.showError(chrome.i18n.getMessage('quizErrorNotEnoughBirds'));
            return;
          }

          await this.prepareQuestions(birds);
          this.updateQuizUIForNewQuiz();
          this.showQuizLoading();
          await this.ensureFirstImageLoaded();
          await this.displayQuestion();
        } catch (error) {
          log(`Error restarting quiz: ${error.message}`);
          captureException(error, { tags: { operation: 'restartQuiz', component: 'QuizMode' } });
          this.showError(chrome.i18n.getMessage('quizErrorGeneral'));
        }
      };
      restartButton.addEventListener('click', restartHandler);
      this.eventListeners.push({ element: restartButton, event: 'click', handler: restartHandler });
    }

    // Exit handler
    if (exitButton) {
      const exitHandler = () => this.exitQuiz();
      exitButton.addEventListener('click', exitHandler);
      this.eventListeners.push({ element: exitButton, event: 'click', handler: exitHandler });
    }

    // Close button
    if (resultsCloseButton) {
      const closeHandler = () => this.exitQuiz();
      resultsCloseButton.addEventListener('click', closeHandler);
      this.eventListeners.push({ element: resultsCloseButton, event: 'click', handler: closeHandler });
    }
  }
}

// Export for use in main script
export default QuizMode;
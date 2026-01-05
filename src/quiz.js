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

// ==========================================
// CONSTANTS
// ==========================================
const QUIZ_TOTAL_QUESTIONS = 10;
const MIN_QUESTIONS_REQUIRED = 5;
const IMAGE_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const IMAGE_REQUEST_DELAY = 300; // ms between API requests
const ERROR_MODAL_AUTO_CLOSE = 5000; // ms
const MACAULAY_API_URL = 'https://search.macaulaylibrary.org/api/v1/search';
const MACAULAY_ASSET_URL = 'https://macaulaylibrary.org/asset';
const BUTTON_FEEDBACK_DELAY = 2000; // ms

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
    this.loadingProgress = 0; // Track image loading progress (0-100%)
    this.totalImagesToLoad = QUIZ_TOTAL_QUESTIONS; // Total images to preload

    this.setupKeyboardListener();
  }

  // ==========================================
  // UTILITY HELPERS
  // ==========================================

  /**
   * Safely get a DOM element by ID, logging if not found
   */
  getElement(id) {
    const el = document.getElementById(id);
    if (!el) {
      log(`Element not found: ${id}`);
    }
    return el;
  }

  /**
   * Get multiple DOM elements, returns null if any are missing
   */
  getElements(...ids) {
    const elements = {};
    for (const id of ids) {
      elements[id] = this.getElement(id);
      if (!elements[id]) return null;
    }
    return elements;
  }

  /**
   * Check if quiz is in a valid active state
   */
  isQuizActive() {
    return this.isActive && this.quizContainer && document.body.contains(this.quizContainer);
  }

  /**
   * Check if current question index is valid
   */
  hasValidQuestion() {
    return this.questions && this.currentQuestion < this.questions.length && this.questions[this.currentQuestion];
  }

  /**
   * Helper delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }


  /**
   * Add an event listener and track it for cleanup
   */
  addTrackedListener(element, event, handler, persist = false) {
    element.addEventListener(event, handler);
    this.eventListeners.push({ element, event, handler, persist });
  }

  /**
   * Create a promise wrapper for chrome.storage operations
   */
  getFromStorage(storageType, key) {
    return new Promise((resolve) => {
      chrome.storage[storageType].get([key], (result) => {
        resolve(result[key]);
      });
    });
  }

  /**
   * Get cached data with expiry check
   */
  async getCachedData(key) {
    const data = await this.getFromStorage('local', key);
    if (data && Date.now() - data.timestamp < data.duration) {
      return data.value;
    }
    return null;
  }

  /**
   * Cache data with timestamp and duration
   */
  setCachedData(key, value, duration = IMAGE_CACHE_DURATION) {
    chrome.storage.local.set({
      [key]: {
        value,
        timestamp: Date.now(),
        duration
      }
    });
  }

  // ==========================================
  // IMAGE HELPERS
  // ==========================================

  /**
   * Create image info object from raw data
   */
  createImageInfo(imageUrl, photographer, photographerUrl) {
    return { imageUrl, photographer, photographerUrl };
  }

  /**
   * Update a bird object with image info (immutably)
   */
  updateBirdWithImage(bird, imageInfo) {
    if (!imageInfo?.imageUrl) return bird;
    return {
      ...bird,
      imageUrl: imageInfo.imageUrl,
      photographer: imageInfo.photographer,
      photographerUrl: imageInfo.photographerUrl
    };
  }

  /**
   * Update a question's bird with image info (if question exists)
   */
  updateQuestionImage(questionIndex, imageInfo) {
    if (!this.questions?.[questionIndex]?.bird || !imageInfo?.imageUrl) return false;
    this.questions[questionIndex].bird = this.updateBirdWithImage(
      this.questions[questionIndex].bird,
      imageInfo
    );
    return true;
  }

  /**
   * Load image for a species, checking cache first
   */
  async loadImageForSpecies(speciesCode, priority = false) {
    // Check cache first
    let imageInfo = await this.getBirdImage(speciesCode);
    if (!imageInfo) {
      imageInfo = await this.loadBirdImageFromCDN(speciesCode, priority);
    }
    return imageInfo;
  }

  // ==========================================
  // UI HELPERS
  // ==========================================

  /**
   * Generate quiz UI HTML template
   */
  generateQuizHTML() {
    return `
      <button class="quiz-close-btn" id="quiz-close" aria-label="${chrome.i18n.getMessage('closeQuiz')}">
        <img src="images/svg/close.svg" alt="${chrome.i18n.getMessage('closeAlt')}" width="20" height="20">
      </button>
      <div class="quiz-container">
        <div class="quiz-header">
          <div class="quiz-progress-bar">
            <div class="quiz-progress-fill" id="quiz-progress-fill" style="width: 10%"></div>
          </div>
          <div class="quiz-meta">
            <span>${chrome.i18n.getMessage('quizProgress').replace('{currentQuestion}', '<span id="quiz-current">1</span>').replace('{totalQuestions}', QUIZ_TOTAL_QUESTIONS.toString())}</span>
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
  }

  /**
   * Show a modal dialog with consistent styling
   */
  showModal(content, className = 'quiz-exit-modal') {
    // Prevent duplicate modals (check first class name for compound classes)
    const primaryClass = className.split(' ')[0];
    const existing = document.querySelector(`.${primaryClass}`);
    if (existing) return null;

    const modal = document.createElement('div');
    modal.className = className;
    modal.innerHTML = content;
    document.body.appendChild(modal);
    return modal;
  }

  /**
   * Remove a modal from the DOM
   */
  removeModal(modal) {
    if (modal?.parentNode) {
      document.body.removeChild(modal);
    }
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
      this.onQuizStart?.();

      const region = await this.getCurrentRegion();
      let birds = await this.getCachedBirds(region);
      const needsDataFetch = !birds;

      // Show loading UI early if data needs fetching
      if (needsDataFetch) {
        this.activateQuizUI();
        birds = await this.fetchBirdsWithErrorHandling(region);
        if (!birds) return;
      }

      if (!birds || birds.length < QUIZ_TOTAL_QUESTIONS) {
        this.showError(chrome.i18n.getMessage('quizErrorNotEnoughBirds'));
        return;
      }

      await this.prepareQuestions(birds);

      if (!needsDataFetch) {
        this.activateQuizUI();
      }

      await this.ensureFirstImageLoaded();

      if (!this.isActive) {
        log('startQuiz aborted: quiz was closed during initialization');
        return;
      }

      await this.displayQuestion();
    } catch (error) {
      captureException(error, { tags: { operation: 'startQuiz', component: 'QuizMode' } });
      const message = error.message === 'NOT_ENOUGH_IMAGES'
        ? chrome.i18n.getMessage('quizErrorNotEnoughImages') || 'Not enough bird images available.'
        : chrome.i18n.getMessage('quizErrorGeneral');
      this.showError(message);
    }
  }

  /**
   * Activate the quiz UI and hide main content
   */
  activateQuizUI() {
    this.showQuizUI();
    this.isActive = true;
    this.hideMainUI();
    this.showQuizLoading();
  }

  /**
   * Fetch birds with error handling
   */
  async fetchBirdsWithErrorHandling(region) {
    try {
      return await this.fetchBirdsForRegion(region);
    } catch (error) {
      captureException(error, { tags: { operation: 'fetchBirdsForRegion', component: 'QuizMode' }, extra: { region } });
      this.showError(chrome.i18n.getMessage('quizErrorGeneral'));
      return null;
    }
  }

  async getCurrentRegion() {
    const region = await this.getFromStorage('sync', 'region');
    return region || 'US';
  }

  getCachedBirds(region) {
    return this.getCachedData(`birds_${region}`);
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

  /**
   * Load image for a specific question index
   */
  async loadQuestionImage(questionIndex, priority = false) {
    if (!this.questions?.[questionIndex]?.bird) return null;
    
    const bird = this.questions[questionIndex].bird;
    if (bird.imageUrl) return bird; // Already loaded
    
    const imageInfo = await this.loadImageForSpecies(bird.speciesCode, priority);
    this.updateQuestionImage(questionIndex, imageInfo);
    
    if (imageInfo?.imageUrl) {
      this.preloadImageInBrowser(imageInfo.imageUrl);
    }
    
    return imageInfo;
  }

  async startImagePreloading() {
    // Reset loading progress
    this.loadingProgress = 0;
    
    // Load first question's image with priority
    await this.loadQuestionImage(0, true);
    this.incrementLoadingProgress();
    
    // Start preloading remaining images in background (non-priority)
    this.preloadRemainingImages();
  }

  /**
   * Increment loading progress when an image successfully loads
   */
  incrementLoadingProgress() {
    this.loadingProgress += (100 / this.totalImagesToLoad);
    this.updateLoadingProgress(Math.min(100, this.loadingProgress));
  }

  async ensureFirstImageLoaded() {
    // Make sure first question has a proper image loaded
    if (this.questions?.[0]?.bird && !this.questions[0].bird.imageUrl) {
      await this.loadQuestionImage(0, true);
    }
    
    // If first question still has no image, filter out invalid questions
    await this.ensureValidQuestionImages();
  }
  
  async ensureValidQuestionImages() {
    const validQuestions = [];
    
    for (const question of this.questions) {
      if (question.bird.imageUrl) {
        validQuestions.push(question);
        continue;
      }
      
      // Try to load the image
      try {
        const imageInfo = await this.loadImageForSpecies(question.bird.speciesCode, true);
        if (imageInfo?.imageUrl) {
          question.bird = this.updateBirdWithImage(question.bird, imageInfo);
          validQuestions.push(question);
        } else {
          log(`Skipping question for ${question.bird.primaryComName} - no image available`);
        }
      } catch {
        log(`Skipping question for ${question.bird.primaryComName} - image load failed`);
      }
    }
    
    this.questions = validQuestions;
    
    if (this.questions.length < MIN_QUESTIONS_REQUIRED) {
      throw new Error('NOT_ENOUGH_IMAGES');
    }
  }

  async preloadRemainingImages() {
    for (let i = 1; i < this.questions.length; i++) {
      const bird = this.questions?.[i]?.bird;
      if (!bird || bird.imageUrl) {
        // If already loaded, count it towards progress
        this.incrementLoadingProgress();
        continue;
      }

      // Check cache first
      const cachedInfo = await this.getBirdImage(bird.speciesCode);
      if (cachedInfo?.imageUrl) {
        this.updateQuestionImage(i, cachedInfo);
        this.incrementLoadingProgress();
        continue;
      }

      // Load in background without priority
      const questionIndex = i; // Capture for closure
      this.loadBirdImageFromCDN(bird.speciesCode, false)
        .then(info => {
          this.updateQuestionImage(questionIndex, info);
          this.incrementLoadingProgress();
        })
        .catch(error => {
          log(`Failed to preload image for ${bird.primaryComName}: ${error.message}`);
          // Still increment progress even on failure to avoid getting stuck
          this.incrementLoadingProgress();
        });
    }
  }

  getBirdImage(speciesCode) {
    return this.getCachedData(`image_${speciesCode}`);
  }

  // Throttled image loading to respect Macaulay Library API
  async loadBirdImageFromCDN(speciesCode, priority = false) {
    return new Promise((resolve) => {
      this.imageLoadingQueue.push({ speciesCode, resolve, priority });
      this.processImageQueue();
    });
  }

  async processImageQueue() {
    if (this.isLoadingImages || this.imageLoadingQueue.length === 0) return;

    this.isLoadingImages = true;
    this.imageLoadingQueue.sort((a, b) => b.priority - a.priority);

    while (this.imageLoadingQueue.length > 0) {
      const { speciesCode, resolve } = this.imageLoadingQueue.shift();

      try {
        resolve(await this.fetchImageFromAPI(speciesCode));
      } catch {
        resolve(null);
      }

      if (this.imageLoadingQueue.length > 0) {
        await this.delay(IMAGE_REQUEST_DELAY);
      }
    }

    this.isLoadingImages = false;
  }

  async fetchImageFromAPI(speciesCode) {
    try {
      this.abortController ??= new AbortController();

      const url = `${MACAULAY_API_URL}?taxonCode=${speciesCode}&count=1&sort=rating_rank_desc&mediaType=photo`;
      const response = await fetch(url, {
        signal: this.abortController.signal,
        cache: 'default'
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const image = data.results?.content?.[0];

      if (!image?.mediaUrl) {
        throw new Error('No image found in Macaulay Library');
      }

      const imageInfo = this.createImageInfo(
        image.mediaUrl,
        image.userDisplayName,
        `${MACAULAY_ASSET_URL}/${image.assetId}`
      );

      this.setCachedData(`image_${speciesCode}`, imageInfo);
      this.preloadImageInBrowser(imageInfo.imageUrl);

      return imageInfo;
    } catch (error) {
      log(`Error loading image for ${speciesCode}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Preload image in browser cache for instant display
   */
  preloadImageInBrowser(imageUrl) {
    if (!imageUrl || this.preloadedImages.has(imageUrl)) return;

    const img = new Image();
    img.onerror = () => this.preloadedImages.delete(imageUrl);
    img.src = imageUrl;
    this.preloadedImages.set(imageUrl, img);
  }

  showQuizLoading() {
    const questionText = this.getElement('quiz-question-text');
    if (questionText) {
      questionText.innerHTML = `<span class="loading-text">${chrome.i18n.getMessage('quizLoadingQuestions')}</span>`;
    }

    const imageContainer = this.getElement('quiz-image-container');
    if (imageContainer) {
      imageContainer.classList.add('loading');
      imageContainer.innerHTML = '<div class="skeleton skeleton-image"></div>';
    }

    const imageMeta = this.getElement('quiz-image-meta');
    if (imageMeta) {
      imageMeta.style.visibility = 'hidden';
    }

    const optionsContainer = this.getElement('quiz-options');
    if (optionsContainer) {
      optionsContainer.innerHTML = Array(4).fill('<div class="skeleton skeleton-option"></div>').join('');
    }

    const nextButton = this.getElement('quiz-next');
    if (nextButton) {
      nextButton.disabled = true;
    }

    // Hide the "Question X of 10" text during loading
    const progressMeta = document.querySelector('.quiz-meta');
    if (progressMeta) {
      progressMeta.style.visibility = 'hidden';
    }

    // Initialize loading progress bar
    this.updateLoadingProgress(0);
  }

  /**
   * Update the loading progress bar during initial quiz setup
   * @param {number} progress - Progress percentage (0-100)
   */
  updateLoadingProgress(progress) {
    const progressBar = this.getElement('quiz-progress-fill');
    
    if (progressBar) {
      progressBar.style.width = `${progress}%`;
      progressBar.style.transition = 'width 0.3s ease';
    }
  }

  showQuizUI() {
    this.quizContainer = document.createElement('div');
    this.quizContainer.className = 'quiz-mode';
    this.quizContainer.innerHTML = this.generateQuizHTML();
    document.body.appendChild(this.quizContainer);
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
    if (!this.isQuizActive() || !this.hasValidQuestion()) {
      log('displayQuestion aborted: invalid state');
      return;
    }

    const question = this.questions[this.currentQuestion];
    this.selectedAnswer = null;
    this.hasAnswered = false;

    // Update progress
    const elements = this.getElements('quiz-progress-fill', 'quiz-current', 'quiz-next', 'quiz-image-container');
    if (!elements) {
      log('displayQuestion aborted: required DOM elements not found');
      return;
    }

    // Show the "Question X of 10" text now that we're displaying actual questions
    const progressMeta = document.querySelector('.quiz-meta');
    if (progressMeta) {
      progressMeta.style.visibility = 'visible';
    }

    const progressPercent = ((this.currentQuestion + 1) / QUIZ_TOTAL_QUESTIONS) * 100;
    elements['quiz-progress-fill'].style.width = `${progressPercent}%`;
    elements['quiz-current'].textContent = this.currentQuestion + 1;

    // Update question text
    const questionText = this.getElement('quiz-question-text');
    if (questionText) {
      questionText.textContent = chrome.i18n.getMessage('quizModeQuestion');
    }

    // Update next button
    const isLastQuestion = this.currentQuestion === QUIZ_TOTAL_QUESTIONS - 1;
    elements['quiz-next'].textContent = chrome.i18n.getMessage(isLastQuestion ? 'quizShowResults' : 'quizNextQuestion');
    elements['quiz-next'].disabled = true;

    // Preload next question's image
    this.preloadNextQuestionImage();

    // Update photographer info
    this.updatePhotographerDisplay(question.bird);

    // Load and display image
    await this.loadAndDisplayQuestionImage(question, elements['quiz-image-container']);

    // Display options
    this.displayQuestionOptions(question);
  }

  /**
   * Update photographer display
   */
  updatePhotographerDisplay(bird) {
    const imageMeta = this.getElement('quiz-image-meta');
    if (!imageMeta) return;

    if (bird.photographer) {
      this.updateImageMeta(bird);
    } else {
      imageMeta.style.visibility = 'visible';
      imageMeta.innerHTML = `${chrome.i18n.getMessage('photoBy')} <a href="#" id="quiz-photographer" target="_blank">${chrome.i18n.getMessage('loading')}</a>`;
    }
  }

  /**
   * Load and display the question image with fallback
   */
  async loadAndDisplayQuestionImage(question, container) {
    container.classList.add('loading');
    container.innerHTML = '<div class="image-loading-overlay"><div class="spinner"></div></div>';

    const imageUrl = question.bird.imageUrl;
    if (!imageUrl) {
      log(`Warning: Question for ${question.bird.primaryComName} has no image URL`);
      this.showImageLoadError(container);
      return;
    }

    const displayImage = (url, birdName) => {
      if (!this.isActive || !document.body.contains(container)) return;
      container.classList.remove('loading');
      container.innerHTML = '';
      const img = document.createElement('img');
      img.className = 'quiz-image loaded';
      img.src = url;
      img.alt = `${birdName} - Bird quiz image`;
      container.appendChild(img);
    };

    const img = new Image();
    img.onload = () => displayImage(imageUrl, question.bird.primaryComName);
    img.onerror = async () => {
      if (!this.isActive) return;

      const imageInfo = await this.loadBirdImageFromCDN(question.bird.speciesCode);
      if (!this.isActive || !document.body.contains(container)) return;

      if (!imageInfo?.imageUrl) {
        this.showImageLoadError(container);
        return;
      }

      const retryImg = new Image();
      retryImg.onload = () => {
        displayImage(imageInfo.imageUrl, question.bird.primaryComName);
        if (this.hasValidQuestion()) {
          question.bird = this.updateBirdWithImage(question.bird, imageInfo);
          if (imageInfo.photographer) {
            this.updateImageMeta(question.bird);
          }
        }
      };
      retryImg.onerror = () => {
        if (this.isActive && document.body.contains(container)) {
          this.showImageLoadError(container);
        }
      };
      retryImg.src = imageInfo.imageUrl;
    };
    img.src = imageUrl;
  }

  /**
   * Display question options with staggered animation
   */
  displayQuestionOptions(question) {
    const optionsContainer = this.getElement('quiz-options');
    if (!optionsContainer) {
      log('displayQuestionOptions: options container not found');
      return;
    }
    optionsContainer.innerHTML = '';

    question.options.forEach((option, index) => {
      const optionElement = document.createElement('div');
      optionElement.className = 'quiz-option';
      optionElement.textContent = option.name;
      optionElement.style.opacity = '0';

      this.addTrackedListener(optionElement, 'click', () => this.selectOption(index));
      optionsContainer.appendChild(optionElement);

      // Staggered fade-in
      setTimeout(() => {
        optionElement.classList.add('loaded');
        optionElement.style.opacity = '';
      }, index * 50);
    });
  }

  updateImageMeta(bird) {
    const imageMeta = this.getElement('quiz-image-meta');
    const photographerLink = this.getElement('quiz-photographer');
    
    if (imageMeta) {
      imageMeta.style.visibility = 'visible';
    }
    
    if (photographerLink && bird.photographer) {
      photographerLink.textContent = bird.photographer;
      photographerLink.href = bird.photographerUrl || '#';
    }
  }

  // Error icon SVG for image load failures
  static ERROR_BIRD_SVG = `
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="32" cy="32" r="30" stroke="currentColor" stroke-width="2" stroke-dasharray="6 4" opacity="0.3"/>
      <path d="M32 18C32 18 22 24 22 32C22 40 32 46 32 46" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.6"/>
      <path d="M32 18C32 18 42 24 42 32C42 40 32 46 32 46" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.6"/>
      <circle cx="32" cy="28" r="3" fill="currentColor" opacity="0.8"/>
      <path d="M26 38C26 38 28 42 32 42C36 42 38 38 38 38" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.6"/>
    </svg>
  `;

  showImageLoadError(container) {
    container.classList.remove('loading');
    container.innerHTML = `
      <div class="quiz-image-error">
        ${QuizMode.ERROR_BIRD_SVG}
        <p class="quiz-image-error-text">${chrome.i18n.getMessage('quizImageUnavailable') || 'Image unavailable'}</p>
        <p class="quiz-image-error-hint">${chrome.i18n.getMessage('quizImageUnavailableHint') || 'Can you identify this bird?'}</p>
      </div>
    `;
    
    const imageMeta = this.getElement('quiz-image-meta');
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
    if (!this.isActive || !this.hasValidQuestion()) return;

    const question = this.questions[this.currentQuestion];
    const selectedOption = question.options[this.selectedAnswer];
    const isCorrect = selectedOption.isCorrect;

    if (isCorrect) this.score++;

    this.answers.push({
      question,
      selectedAnswer: selectedOption.name,
      correctAnswer: question.correctAnswer,
      isCorrect
    });

    this.showAnswerFeedback();
    this.hasAnswered = true;

    const nextBtn = this.getElement('quiz-next');
    if (!nextBtn) return;

    const isLastQuestion = this.currentQuestion === QUIZ_TOTAL_QUESTIONS - 1;
    nextBtn.textContent = chrome.i18n.getMessage(isLastQuestion ? 'quizShowResults' : 'quizNextQuestion');
    nextBtn.disabled = false;
  }

  showAnswerFeedback() {
    if (!this.isActive || !this.hasValidQuestion()) return;

    document.querySelectorAll('.quiz-option').forEach((option, index) => {
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
    if (!this.isActive || !this.questions) return;
    
    const nextIndex = this.currentQuestion + 1;
    const nextBird = this.questions?.[nextIndex]?.bird;
    if (!nextBird) return;

    if (nextBird.imageUrl) {
      // Already loaded, just preload in browser cache
      this.preloadImageInBrowser(nextBird.imageUrl);
      return;
    }

    try {
      const imageInfo = await this.loadImageForSpecies(nextBird.speciesCode, true);
      this.updateQuestionImage(nextIndex, imageInfo);
    } catch (error) {
      log(`Failed to preload next question image: ${error.message}`);
    }
  }

  /**
   * Reset quiz state for a new quiz
   */
  resetQuizState() {
    this.currentQuestion = 0;
    this.score = 0;
    this.questions = [];
    this.answers = [];
    this.selectedAnswer = null;
    this.hasAnswered = false;
    this.imageLoadingQueue = [];
    this.isLoadingImages = false;
    this.loadingProgress = 0;
  }

  /**
   * Restart the quiz with new questions
   */
  async restartQuiz() {
    this.resetQuizState();

    try {
      const region = await this.getCurrentRegion();
      const birds = await this.getCachedBirds(region);

      if (!birds || birds.length < QUIZ_TOTAL_QUESTIONS) {
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
  }

  /**
   * Generate results HTML
   */
  generateResultsHTML() {
    const resultItems = this.answers.map(answer => {
      const statusClass = answer.isCorrect ? 'correct' : 'incorrect';
      const badge = answer.isCorrect ? '✓' : '✗';
      const incorrectHint = answer.isCorrect ? '' : 
        `<div class="quiz-result-correct-answer">${chrome.i18n.getMessage('correctAnswer', [answer.correctAnswer])}</div>`;
      
      return `
        <div class="quiz-result-item ${statusClass}">
          <div class="quiz-result-thumbnail-wrapper">
            <img src="${answer.question.bird.imageUrl}" alt="${answer.question.bird.primaryComName}" class="quiz-result-thumbnail" />
            <div class="quiz-result-badge ${statusClass}">${badge}</div>
          </div>
          <div class="quiz-result-info">
            <div class="quiz-result-bird-name">${answer.question.bird.primaryComName}</div>
            ${incorrectHint}
          </div>
        </div>
      `;
    }).join('');

    return `
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
            <div class="quiz-final-score">${this.score}/${QUIZ_TOTAL_QUESTIONS}</div>
            <div class="quiz-results-summary">${this.getScoreMessage(this.score)}</div>
            <div class="quiz-results-list">
              <h3 class="quiz-results-title">${chrome.i18n.getMessage('questionReview')}</h3>
              ${resultItems}
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
  }

  showResults() {
    if (!this.isQuizActive()) {
      log('showResults aborted: quiz container no longer exists');
      return;
    }
    
    this.quizContainer.innerHTML = this.generateResultsHTML();
    this.setupResultsEventListeners();
  }

  getScoreMessage(score) {
    if (score >= 9) return chrome.i18n.getMessage('quizScoreExcellent');
    if (score >= 7) return chrome.i18n.getMessage('quizScoreGreat');
    if (score >= 5) return chrome.i18n.getMessage('quizScoreGood');
    if (score >= 3) return chrome.i18n.getMessage('quizScoreNotBad');
    return chrome.i18n.getMessage('quizScoreKeepLearning');
  }

  showExitConfirmation(forceConfirm = false) {
    // Check if we're on results or share page
    const isOnResultsOrShare = this.currentQuestion >= QUIZ_TOTAL_QUESTIONS || 
                               this.answers.length === QUIZ_TOTAL_QUESTIONS ||
                               this._shareDataUrl;
    
    // On results/share page, exit directly without confirmation unless force is true
    if (isOnResultsOrShare && !forceConfirm) {
      this.exitQuiz();
      return;
    }

    // Use different messages for results/share page vs during quiz
    const title = chrome.i18n.getMessage('quizExitConfirmTitle');
    const message = isOnResultsOrShare 
      ? chrome.i18n.getMessage('quizExitConfirmMessageResults') || 'Are you sure you want to close?'
      : chrome.i18n.getMessage('quizExitConfirmMessage');

    const modalContent = `
      <div class="quiz-exit-content">
        <h3>${title}</h3>
        <p>${message}</p>
        <div class="quiz-exit-actions">
          <button class="quiz-btn primary" id="quiz-confirm-exit">${chrome.i18n.getMessage('quizExitConfirm')}</button>
          <button class="quiz-btn" id="quiz-cancel-exit">${chrome.i18n.getMessage('quizExitCancel')}</button>
        </div>
      </div>
    `;

    const exitModal = this.showModal(modalContent);
    if (!exitModal) return;

    const confirmButton = this.getElement('quiz-confirm-exit');
    const cancelButton = this.getElement('quiz-cancel-exit');

    if (!confirmButton || !cancelButton) {
      captureException(new Error('Exit confirmation buttons not found'), { tags: { component: 'QuizMode' } });
      this.removeModal(exitModal);
      return;
    }

    const closeModal = (e) => {
      e?.preventDefault();
      e?.stopPropagation();
      this.removeModal(exitModal);
    };

    confirmButton.addEventListener('click', (e) => {
      closeModal(e);
      this.exitQuiz();
    });
    
    cancelButton.addEventListener('click', closeModal);
    exitModal.addEventListener('click', (e) => {
      if (e.target === exitModal) closeModal(e);
    });
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

    this.imageLoadingQueue = [];
    this.isLoadingImages = false;

    // Clean up preloaded images
    this.preloadedImages.forEach((img) => {
      img.src = '';
      img.onload = null;
      img.onerror = null;
    });
    this.preloadedImages.clear();

    // Remove non-persistent event listeners
    this.cleanupNonPersistentListeners();

    // Clear question and answer data
    this.questions.forEach(q => {
      if (q.bird) {
        q.bird.imageUrl = null;
        q.bird.photographer = null;
        q.bird.photographerUrl = null;
      }
    });
    this.questions = [];

    this.answers.forEach(a => { a.question = null; });
    this.answers = [];

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
    this.cleanupNonPersistentListeners();
    this.quizContainer.innerHTML = this.generateQuizHTML();
    this.setupQuizEventListeners();
  }

  /**
   * Remove all non-persistent event listeners
   */
  cleanupNonPersistentListeners() {
    this.eventListeners.forEach(({ element, event, handler, persist }) => {
      if (!persist) {
        try {
          element.removeEventListener(event, handler);
        } catch {
          // Element might have been removed already
        }
      }
    });
    this.eventListeners = this.eventListeners.filter(listener => listener.persist);
  }

  setupQuizEventListeners() {
    const nextButton = this.getElement('quiz-next');
    if (nextButton) {
      this.addTrackedListener(nextButton, 'click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        log(`Next button clicked. Current question: ${this.currentQuestion}, Answers: ${this.answers.length}`);
        if (this.currentQuestion < QUIZ_TOTAL_QUESTIONS - 1) {
          this.nextQuestion();
        } else {
          log('Showing results...');
          this.showResults();
        }
      });
    }

    const closeButton = this.getElement('quiz-close');
    if (closeButton) {
      this.addTrackedListener(closeButton, 'click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showExitConfirmation();
      });
    } else {
      log('Quiz close button not found');
    }

    // Click outside to close
    this.addTrackedListener(this.quizContainer, 'click', (e) => this.handleOutsideClick(e));
  }

  /**
   * Handle click outside quiz container
   */
  handleOutsideClick(e) {
    if (!this.isActive) return;

    const closeButton = this.getElement('quiz-close') || 
                        this.getElement('quiz-results-close') || 
                        this.getElement('quiz-share-close');
    if (closeButton?.contains(e.target)) return;

    const quizContainerInner = document.querySelector('.quiz-container');
    if (quizContainerInner && !quizContainerInner.contains(e.target)) {
      // Always show confirmation when clicking outside (forceConfirm = true)
      // Users who want to close quickly can use the X button
      this.showExitConfirmation(true);
    }
  }

  showError(message) {
    const modalContent = `
      <div class="quiz-exit-content">
        <h3>${chrome.i18n.getMessage('quizErrorTitle')}</h3>
        <p>${message}</p>
        <div class="quiz-exit-actions">
          <button class="quiz-btn primary" id="quiz-error-ok">${chrome.i18n.getMessage('quizErrorOk')}</button>
        </div>
      </div>
    `;

    const errorModal = this.showModal(modalContent, 'quiz-exit-modal quiz-error-modal');
    if (!errorModal) return;

    const closeModal = () => {
      clearTimeout(timeoutId);
      this.removeModal(errorModal);
    };

    const timeoutId = setTimeout(closeModal, ERROR_MODAL_AUTO_CLOSE);

    const okButton = this.getElement('quiz-error-ok');
    okButton?.addEventListener('click', closeModal);
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
    ctx.textAlign = 'center';
    const maxMessageWidth = leftPanelWidth - 60;
    this.drawWrappedText(ctx, this.getScoreMessage(this.score), scoreCenterX, scoreCenterY + 110, maxMessageWidth, 24);

    // Correct/Incorrect summary pills
    const pillY = scoreCenterY + 160;
    const pillWidth = 120;
    const pillHeight = 36;
    const pillGap = 16;
    
    const correctCount = this.answers.filter(a => a.isCorrect).length;
    const incorrectCount = this.answers.filter(a => !a.isCorrect).length;
    
    // Correct pill (left)
    const correctPillX = scoreCenterX - pillWidth - pillGap / 2;
    this.drawPill(ctx, correctPillX, pillY, pillWidth, pillHeight, colors.correct, '0.15');
    ctx.fillStyle = colors.correct;
    ctx.font = '600 13px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const correctText = chrome.i18n.getMessage('quizShareCorrectCount', [correctCount]) || `${correctCount} correct`;
    ctx.fillText(`✓ ${correctText}`, correctPillX + pillWidth / 2, pillY + pillHeight / 2);
    
    // Incorrect pill (right)
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
    const cardHeight = rowHeight - 6;
    const maxAnswers = Math.min(this.answers.length, QUIZ_TOTAL_QUESTIONS);
    
    for (let i = 0; i < maxAnswers; i++) {
      const answer = this.answers[i];
      const y = listStartY + 35 + i * rowHeight;

      // Row background
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

      // Bird name (truncated if needed)
      const birdName = answer.question?.bird?.primaryComName || chrome.i18n.getMessage('quizShareUnknownBird') || 'Unknown Bird';
      ctx.font = '400 16px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif';
      ctx.fillStyle = colors.textPrimary;
      ctx.textAlign = 'left';
      
      const displayName = this.truncateText(ctx, birdName, rightWidth - 120);
      ctx.fillText(displayName, rightStartX + cardPadding + 40, y + cardHeight / 2 + 5);

      // Status indicator
      const statusX = rightStartX + rightWidth - 35;
      const statusY = y + cardHeight / 2;
      
      ctx.beginPath();
      ctx.arc(statusX, statusY, 12, 0, Math.PI * 2);
      ctx.fillStyle = answer.isCorrect ? colors.correct : colors.incorrect;
      ctx.fill();

      answer.isCorrect 
        ? this.drawCheckmark(ctx, statusX, statusY, 10)
        : this.drawCross(ctx, statusX, statusY, 10);
    }

    return canvas.toDataURL('image/png');
  }

  /**
   * Truncate text to fit within max width
   */
  truncateText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let truncated = text;
    while (ctx.measureText(truncated + '...').width > maxWidth && truncated.length > 1) {
      truncated = truncated.slice(0, -1);
    }
    return truncated + '...';
  }

  /**
   * Convert hex color to rgba with opacity
   */
  hexToRgba(hex, opacity) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }

  /**
   * Draw a pill-shaped background
   */
  drawPill(ctx, x, y, width, height, color, opacity) {
    ctx.fillStyle = color.startsWith('#') 
      ? this.hexToRgba(color, opacity)
      : color.replace(')', `, ${opacity})`).replace('rgb', 'rgba');
    this.drawRoundedRect(ctx, x, y, width, height, height / 2);
    ctx.fill();
  }

  /**
   * Draw text that wraps within a maximum width
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {string} text - Text to draw
   * @param {number} x - X position (center for centered text)
   * @param {number} y - Y position (top of first line)
   * @param {number} maxWidth - Maximum width for text
   * @param {number} lineHeight - Height between lines
   * @returns {number} - The Y position after the last line
   */
  drawWrappedText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    let currentY = y;

    for (let i = 0; i < words.length; i++) {
      const testLine = line + words[i] + ' ';
      const metrics = ctx.measureText(testLine);
      
      if (metrics.width > maxWidth && i > 0) {
        ctx.fillText(line.trim(), x, currentY);
        line = words[i] + ' ';
        currentY += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line.trim(), x, currentY);
    return currentY;
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
    const shareBtn = this.getElement('quiz-share-results');
    const originalContent = shareBtn?.innerHTML;
    
    if (shareBtn) {
      shareBtn.disabled = true;
      shareBtn.innerHTML = `<span class="quiz-share-spinner"></span> ${chrome.i18n.getMessage('quizShareGenerating') || 'Generating...'}`;
    }

    try {
      const dataUrl = await this.generateShareableCollage();
      
      if (shareBtn) {
        shareBtn.innerHTML = originalContent;
        shareBtn.disabled = false;
      }
      
      this.showSharePreview(dataUrl);
    } catch (error) {
      log(`Error generating collage: ${error.message}`);
      captureException(error, { tags: { operation: 'shareCollage', component: 'QuizMode' } });
      
      if (shareBtn) {
        shareBtn.innerHTML = chrome.i18n.getMessage('quizShareError') || 'Failed to generate';
        setTimeout(() => {
          shareBtn.innerHTML = originalContent;
          shareBtn.disabled = false;
        }, BUTTON_FEEDBACK_DELAY);
      }
    }
  }

  /**
   * Show the share preview page with the generated collage
   * @param {string} dataUrl - Data URL of the generated image
   */
  showSharePreview(dataUrl) {
    const resultsHTML = this.quizContainer.innerHTML;
    
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
              ${QuizMode.ICONS.download}
              ${chrome.i18n.getMessage('quizShareDownload') || 'Download Image'}
            </button>
            <button class="quiz-btn share-action copy" id="quiz-copy-image">
              ${QuizMode.ICONS.copy}
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

  // SVG icon templates
  static ICONS = {
    checkmark: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
    download: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`,
    copy: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
    error: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`
  };

  /**
   * Show temporary button feedback
   */
  showButtonFeedback(button, icon, text, originalContent, delay = BUTTON_FEEDBACK_DELAY) {
    button.innerHTML = `${icon} ${text}`;
    setTimeout(() => { button.innerHTML = originalContent; }, delay);
  }

  /**
   * Setup event listeners for the share preview page
   */
  setupSharePreviewListeners() {
    const closeBtn = this.getElement('quiz-share-close');
    const downloadBtn = this.getElement('quiz-download-image');
    const copyBtn = this.getElement('quiz-copy-image');
    const backBtn = this.getElement('quiz-share-back');

    if (closeBtn) {
      this.addTrackedListener(closeBtn, 'click', () => this.exitQuiz());
    }

    if (downloadBtn) {
      const originalContent = `${QuizMode.ICONS.download} ${chrome.i18n.getMessage('quizShareDownload') || 'Download Image'}`;
      this.addTrackedListener(downloadBtn, 'click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.downloadCollage(this._shareDataUrl);
        this.showButtonFeedback(
          downloadBtn, 
          QuizMode.ICONS.checkmark, 
          chrome.i18n.getMessage('quizShareDownloaded') || 'Downloaded!',
          originalContent
        );
      });
    }

    if (copyBtn) {
      const originalContent = `${QuizMode.ICONS.copy} ${chrome.i18n.getMessage('quizShareCopyImage') || 'Copy to Clipboard'}`;
      this.addTrackedListener(copyBtn, 'click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        try {
          const response = await fetch(this._shareDataUrl);
          const blob = await response.blob();
          
          if (!navigator.clipboard?.write) {
            throw new Error('Clipboard API not available');
          }
          
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          this.showButtonFeedback(copyBtn, QuizMode.ICONS.checkmark, chrome.i18n.getMessage('quizShareCopied') || 'Copied!', originalContent);
        } catch (error) {
          log(`Failed to copy image to clipboard: ${error.message}`);
          this.showButtonFeedback(copyBtn, QuizMode.ICONS.error, chrome.i18n.getMessage('quizShareCopyFailed') || 'Copy failed', originalContent);
        }
      });
    }

    if (backBtn) {
      this.addTrackedListener(backBtn, 'click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.returnToResults();
      });
    }
  }

  /**
   * Return to the results page from share preview
   */
  returnToResults() {
    if (!this._resultsHTML) return;
    
    this.cleanupNonPersistentListeners();
    this.quizContainer.innerHTML = this._resultsHTML;
    this.setupResultsEventListeners();
    
    delete this._shareDataUrl;
    delete this._resultsHTML;
  }

  /**
   * Setup event listeners for results page
   */
  setupResultsEventListeners() {
    const shareButton = this.getElement('quiz-share-results');
    const restartButton = this.getElement('quiz-restart');
    const exitButton = this.getElement('quiz-exit');
    const resultsCloseButton = this.getElement('quiz-results-close');

    if (shareButton) {
      this.addTrackedListener(shareButton, 'click', () => this.shareCollage());
    }

    if (restartButton) {
      this.addTrackedListener(restartButton, 'click', () => this.restartQuiz());
    }

    if (exitButton) {
      this.addTrackedListener(exitButton, 'click', () => this.exitQuiz());
    }

    if (resultsCloseButton) {
      this.addTrackedListener(resultsCloseButton, 'click', () => this.exitQuiz());
    }
  }
}

// Export for use in main script
export default QuizMode;
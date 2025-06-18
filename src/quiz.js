import './quiz.css';

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

// Helper function for logging messages (only in development)
function log(message) {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[BirdTab]: ${message}`);
  }
}

class QuizMode {
  constructor() {
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
    
    this.setupKeyboardListener();
  }

  setupKeyboardListener() {
    const keyboardHandler = (e) => {
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
      // Get current region setting
      const region = await this.getCurrentRegion();
      
      // Get cached birds for the region
      const birds = await this.getCachedBirds(region);
      
      if (!birds || birds.length < 10) {
        this.showError(chrome.i18n.getMessage('quizErrorNotEnoughBirds'));
        return;
      }

      // Prepare quiz questions with enriched bird data
      await this.prepareQuestions(birds);
      
      // Show quiz UI with loading state
      this.showQuizUI();
      this.isActive = true;
      this.hideMainUI();
      
      // Show loading indicator while preparing first image
      this.showQuizLoading();
      
      // Wait for first image to load before displaying question
      await this.ensureFirstImageLoaded();
      
      // Display first question
      await this.displayQuestion();
    } catch (error) {
      log(`Error starting quiz: ${error.message}`);
      this.showError(chrome.i18n.getMessage('quizErrorGeneral'));
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
    if (this.questions.length > 0) {
      const firstBird = this.questions[0].bird;
      
      // Check cache first
      let imageInfo = await this.getBirdImage(firstBird.speciesCode);
      if (!imageInfo) {
        imageInfo = await this.loadBirdImageFromCDN(firstBird.speciesCode, true); // Priority = true
      }
      
      // Update first question with image info
      this.questions[0].bird = {
        ...firstBird,
        imageUrl: imageInfo?.imageUrl || chrome.runtime.getURL('images/default-bird.jpg'),
        photographer: imageInfo?.photographer,
        photographerUrl: imageInfo?.photographerUrl
      };
      
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
    if (this.questions.length > 0) {
      const firstBird = this.questions[0].bird;
      
      // If image is still null or default, try to load it
      if (!firstBird.imageUrl || firstBird.imageUrl.includes('default-bird.jpg')) {
        // Check cache first
        let imageInfo = await this.getBirdImage(firstBird.speciesCode);
        if (!imageInfo) {
          imageInfo = await this.loadBirdImageFromCDN(firstBird.speciesCode, true);
        }
        
        // Update first question with image info
        this.questions[0].bird = {
          ...firstBird,
          imageUrl: imageInfo?.imageUrl || chrome.runtime.getURL('images/default-bird.jpg'),
          photographer: imageInfo?.photographer,
          photographerUrl: imageInfo?.photographerUrl
        };
      }
    }
  }

  async preloadRemainingImages() {
    // Load images for questions 2-10 in background
    for (let i = 1; i < this.questions.length; i++) {
      const bird = this.questions[i].bird;
      
      // Check cache first
      let imageInfo = await this.getBirdImage(bird.speciesCode);
      if (!imageInfo) {
        // Add to queue without priority
        this.loadBirdImageFromCDN(bird.speciesCode, false).then(info => {
          this.questions[i].bird = {
            ...bird,
            imageUrl: info?.imageUrl || chrome.runtime.getURL('images/default-bird.jpg'),
            photographer: info?.photographer,
            photographerUrl: info?.photographerUrl
          };
        });
      } else {
        // Update immediately if cached
        this.questions[i].bird = {
          ...bird,
          imageUrl: imageInfo?.imageUrl || chrome.runtime.getURL('images/default-bird.jpg'),
          photographer: imageInfo?.photographer,
          photographerUrl: imageInfo?.photographerUrl
        };
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
        resolve({
          imageUrl: chrome.runtime.getURL('images/default-bird.jpg'),
          photographer: 'Unknown',
          photographerUrl: '#'
        });
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
    // Show loading state in quiz image container only (don't overwrite the whole content)
    const imageContainer = document.getElementById('quiz-image-container');
    if (imageContainer) {
      imageContainer.innerHTML = `
        <div class="quiz-loading">
          <div class="quiz-loading-spinner"></div>
          <p class="quiz-loading-text">Preparing quiz questions...</p>
        </div>
      `;
    }
    
    // Update question text to show loading
    const questionText = document.getElementById('quiz-question-text');
    if (questionText) {
      questionText.textContent = 'Preparing your quiz...';
    }
    
    // Disable options while loading
    const optionsContainer = document.getElementById('quiz-options');
    if (optionsContainer) {
      optionsContainer.innerHTML = `
        <div class="quiz-loading-message">Loading questions...</div>
      `;
    }
  }

  showQuizUI() {
    // Create quiz container
    this.quizContainer = document.createElement('div');
    this.quizContainer.className = 'quiz-mode';
    this.quizContainer.innerHTML = `
      <button class="quiz-close-btn" id="quiz-close" aria-label="Close quiz">
        <img src="images/svg/close.svg" alt="Close" width="20" height="20">
      </button>
      <div class="quiz-container">
        <div class="quiz-header">
          <div class="quiz-progress-bar">
            <div class="quiz-progress-fill" id="quiz-progress-fill" style="width: 10%"></div>
          </div>
          <div class="quiz-meta">
            <span>Question <span id="quiz-current">1</span> of 10</span>
            <span>Score: <span id="quiz-score">0</span>/10</span>
          </div>
          <h1 class="quiz-question-title">${chrome.i18n.getMessage('quizModeQuestion')}</h1>
        </div>
        
        <div class="quiz-content">
          <!-- Question Section -->
          <div class="quiz-question-section">
            <div class="quiz-question-text" id="quiz-question-text">
              Which bird is this?
            </div>
          </div>
          
          <!-- Image Section -->
          <div class="quiz-image-section">
            <div class="quiz-image-container" id="quiz-image-container">
              <!-- Image will be loaded here -->
            </div>
            <div class="quiz-image-meta" id="quiz-image-meta">
              Photo by <a href="#" id="quiz-photographer" target="_blank">Loading...</a>
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
    // Show main UI elements again
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
    
    // Re-initialize components that might need showing based on settings
    if (window.topSitesInstance) {
      window.topSitesInstance.updateVisibility();
    }
    
    // Show search if enabled
    chrome.storage.sync.get(['quickAccessEnabled'], (result) => {
      chrome.permissions.contains({
        permissions: ['search']
      }, (hasPermission) => {
        const searchContainer = document.querySelector('.search-container');
        if (searchContainer && hasPermission && result.quickAccessEnabled) {
          searchContainer.style.display = 'block';
        }
      });
    });
  }

  async displayQuestion() {
    const question = this.questions[this.currentQuestion];
    this.selectedAnswer = null;
    this.hasAnswered = false;
    
    // Update progress
    const progressPercent = ((this.currentQuestion + 1) / 10) * 100;
    document.getElementById('quiz-progress-fill').style.width = `${progressPercent}%`;
    document.getElementById('quiz-current').textContent = this.currentQuestion + 1;
    document.getElementById('quiz-score').textContent = this.score;
    
    // Update next button text
    const nextBtn = document.getElementById('quiz-next');
    if (this.currentQuestion === 9) {
      nextBtn.textContent = chrome.i18n.getMessage('quizShowResults');
    } else {
      nextBtn.textContent = chrome.i18n.getMessage('quizNextQuestion');
    }
    nextBtn.disabled = true;
    
    // OPTIMAL TIMING: Preload next question's image immediately when displaying current question
    // This gives maximum time for the next image to load while user reads and answers
    this.preloadNextQuestionImage();
    
    // Show loading indicator for image
    const imageContainer = document.getElementById('quiz-image-container');
    imageContainer.innerHTML = '';
    
    const loader = document.createElement('div');
    loader.className = 'image-loader';
    loader.innerHTML = `
      <div class="spinner"></div>
      <p>Loading bird image...</p>
    `;
    imageContainer.appendChild(loader);
    
    // Load image with fallback
    const imageUrl = question.bird.imageUrl || chrome.runtime.getURL('images/default-bird.jpg');
    const img = new Image();
    
    img.onload = () => {
      imageContainer.innerHTML = '';
      const imageElement = document.createElement('img');
      imageElement.className = 'quiz-image';
      imageElement.src = imageUrl;
      imageElement.alt = `${question.bird.primaryComName} - Bird quiz image`;
      imageContainer.appendChild(imageElement);
      
      // Update photographer credit
      this.updateImageMeta(question.bird);
    };
    
    img.onerror = async () => {
      // If image fails to load, try to fetch a new one
      const imageInfo = await this.loadBirdImageFromCDN(question.bird.speciesCode);
      const newImageUrl = imageInfo.imageUrl;
      
      const retryImg = new Image();
      retryImg.onload = () => {
        imageContainer.innerHTML = '';
        const imageElement = document.createElement('img');
        imageElement.className = 'quiz-image';
        imageElement.src = newImageUrl;
        imageElement.alt = `${question.bird.primaryComName} - Bird quiz image`;
        imageContainer.appendChild(imageElement);
        
        // Update the question data with new image
        question.bird.imageUrl = newImageUrl;
        question.bird.photographer = imageInfo.photographer;
        question.bird.photographerUrl = imageInfo.photographerUrl;
        
        this.updateImageMeta(question.bird);
      };
      
      retryImg.onerror = () => {
        // Fallback to default image
        imageContainer.innerHTML = '';
        const imageElement = document.createElement('img');
        imageElement.className = 'quiz-image';
        imageElement.src = chrome.runtime.getURL('images/default-bird.jpg');
        imageElement.alt = 'Default bird image';
        imageContainer.appendChild(imageElement);
        
        this.updateImageMeta({ photographer: 'Unknown', photographerUrl: '#' });
      };
      
      retryImg.src = newImageUrl;
    };
    
    img.src = imageUrl;
    
    // Display options
    const optionsContainer = document.getElementById('quiz-options');
    optionsContainer.innerHTML = '';
    
    question.options.forEach((option, index) => {
      const optionElement = document.createElement('div');
      optionElement.className = 'quiz-option';
      optionElement.textContent = option.name;
      
      const optionHandler = () => this.selectOption(index);
      optionElement.addEventListener('click', optionHandler);
      this.eventListeners.push({ element: optionElement, event: 'click', handler: optionHandler });
      
      optionsContainer.appendChild(optionElement);
    });
  }

  updateImageMeta(bird) {
    const photographerLink = document.getElementById('quiz-photographer');
    if (photographerLink && bird.photographer) {
      photographerLink.textContent = bird.photographer;
      photographerLink.href = bird.photographerUrl || '#';
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
    if (this.currentQuestion === 9) {
      nextBtn.textContent = chrome.i18n.getMessage('quizShowResults');
    } else {
      nextBtn.textContent = chrome.i18n.getMessage('quizNextQuestion');
    }
    nextBtn.disabled = false;
  }

  showAnswerFeedback() {
    const options = document.querySelectorAll('.quiz-option');
    const question = this.questions[this.currentQuestion];
    
    options.forEach((option, index) => {
      const optionData = question.options[index];
      option.classList.add('disabled');
      
      if (optionData.isCorrect) {
        option.classList.add('correct');
      } else if (index === this.selectedAnswer) {
        option.classList.add('incorrect');
      }
    });
    
    // Update score display
    document.getElementById('quiz-score').textContent = this.score;
  }

  async nextQuestion() {
    this.currentQuestion++;
    await this.displayQuestion();
  }

  async preloadNextQuestionImage() {
    const nextQuestionIndex = this.currentQuestion + 1;
    if (nextQuestionIndex < this.questions.length) {
      const nextBird = this.questions[nextQuestionIndex].bird;
      
      // Only preload if image not already loaded
      if (!nextBird.imageUrl || nextBird.imageUrl.includes('default-bird.jpg')) {
        // Check cache first
        let imageInfo = await this.getBirdImage(nextBird.speciesCode);
        if (imageInfo) {
          // Update immediately if cached
          this.questions[nextQuestionIndex].bird = {
            ...nextBird,
            imageUrl: imageInfo?.imageUrl || chrome.runtime.getURL('images/default-bird.jpg'),
            photographer: imageInfo?.photographer,
            photographerUrl: imageInfo?.photographerUrl
          };
          
          // Preload in browser cache for instant display
          this.preloadImageInBrowser(imageInfo.imageUrl);
        } else {
          // Add to priority queue for next question
          try {
            const info = await this.loadBirdImageFromCDN(nextBird.speciesCode, true);
            this.questions[nextQuestionIndex].bird = {
              ...nextBird,
              imageUrl: info?.imageUrl || chrome.runtime.getURL('images/default-bird.jpg'),
              photographer: info?.photographer,
              photographerUrl: info?.photographerUrl
            };
          } catch (error) {
            // Silently handle errors, will fallback to default image
          }
        }
      } else {
        // Still preload in browser cache if not already done
        this.preloadImageInBrowser(nextBird.imageUrl);
      }
    }
  }

  showResults() {
    this.quizContainer.innerHTML = `
      <button class="quiz-close-btn" id="quiz-results-close" aria-label="Close quiz">
        <img src="images/svg/close.svg" alt="Close" width="20" height="20">
      </button>
      <div class="quiz-container">
        <div class="quiz-header">
          <div class="quiz-progress-bar">
            <div class="quiz-progress-fill" style="width: 100%"></div>
          </div>
          <div class="quiz-meta">
            <span>Quiz Complete!</span>
            <span>Final Score: ${this.score}/10</span>
          </div>
          <h1 class="quiz-question-title">Quiz Results</h1>
        </div>
        
        <div class="quiz-content">
          <div class="quiz-results">
            <div class="quiz-final-score">${this.score}/10</div>
            <div class="quiz-results-summary">
              ${this.getScoreMessage(this.score)}
            </div>
            <div class="quiz-results-list">
              <h3 class="quiz-results-title">Question Review</h3>
              ${this.answers.map((answer, index) => `
                <div class="quiz-result-item ${answer.isCorrect ? 'correct' : 'incorrect'}">
                  <div class="quiz-result-bird">
                    ${index + 1}. ${answer.question.bird.primaryComName}
                    ${!answer.isCorrect ? `<div class="quiz-result-correct-answer">Correct answer: ${answer.correctAnswer}</div>` : ''}
                  </div>
                  <div class="quiz-result-status ${answer.isCorrect ? 'correct' : 'incorrect'}">
                    ${answer.isCorrect ? 'Correct' : 'Incorrect'}
                  </div>
                </div>
              `).join('')}
            </div>
            <div class="quiz-actions">
              <button class="quiz-btn primary" id="quiz-restart">${chrome.i18n.getMessage('quizStartNewQuiz')}</button>
              <button class="quiz-btn secondary" id="quiz-exit">${chrome.i18n.getMessage('quizExitQuiz')}</button>
            </div>
          </div>
        </div>
      </div>
    `;
    
    // Add event listeners and track them for cleanup
    const restartButton = document.getElementById('quiz-restart');
    const exitButton = document.getElementById('quiz-exit');
    
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
    
    const confirmHandler = () => {
      document.body.removeChild(exitModal);
      this.exitQuiz();
    };
    const cancelHandler = () => {
      document.body.removeChild(exitModal);
    };
    
    confirmButton.addEventListener('click', confirmHandler);
    cancelButton.addEventListener('click', cancelHandler);
    
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
    // Replace results content with fresh quiz UI
    this.quizContainer.innerHTML = `
      <button class="quiz-close-btn" id="quiz-close" aria-label="Close quiz">
        <img src="images/svg/close.svg" alt="Close" width="20" height="20">
      </button>
      <div class="quiz-container">
        <div class="quiz-header">
          <div class="quiz-progress-bar">
            <div class="quiz-progress-fill" id="quiz-progress-fill" style="width: 10%"></div>
          </div>
          <div class="quiz-meta">
            <span>Question <span id="quiz-current">1</span> of 10</span>
            <span>Score: <span id="quiz-score">0</span>/10</span>
          </div>
          <h1 class="quiz-question-title">${chrome.i18n.getMessage('quizModeQuestion')}</h1>
        </div>
        
        <div class="quiz-content">
          <!-- Question Section -->
          <div class="quiz-question-section">
            <div class="quiz-question-text" id="quiz-question-text">
              Which bird is this?
            </div>
          </div>
          
          <!-- Image Section -->
          <div class="quiz-image-section">
            <div class="quiz-image-container" id="quiz-image-container">
              <!-- Image will be loaded here -->
            </div>
            <div class="quiz-image-meta" id="quiz-image-meta">
              Photo by <a href="#" id="quiz-photographer" target="_blank">Loading...</a>
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
    const closeHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showExitConfirmation();
    };
    closeButton.addEventListener('click', closeHandler);
    this.eventListeners.push({ element: closeButton, event: 'click', handler: closeHandler });

    // Add click outside to close functionality
    const outsideClickHandler = (e) => {
      // Check if click is outside the quiz container
      const quizContainer = document.querySelector('.quiz-container');
      if (quizContainer && !quizContainer.contains(e.target)) {
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
}

// Export for use in main script
export default QuizMode;
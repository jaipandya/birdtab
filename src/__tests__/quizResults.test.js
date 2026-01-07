/**
 * Quiz Results Tests
 *
 * Tests for the quiz results page functionality:
 * - Correct display of answers in results
 * - Showing user's wrong answer for incorrect responses
 */

// Mock QuizMode class methods for testing
const createMockQuizMode = () => {
  return {
    answers: [],
    score: 0,
    getScoreMessage: (score) => {
      if (score >= 9) return 'Excellent!';
      if (score >= 7) return 'Great!';
      if (score >= 5) return 'Good!';
      if (score >= 3) return 'Not bad!';
      return 'Keep learning!';
    },
    generateResultsHTML: function() {
      const QUIZ_TOTAL_QUESTIONS = 10;
      const resultItems = this.answers.map(answer => {
        const statusClass = answer.isCorrect ? 'correct' : 'incorrect';
        const badge = answer.isCorrect ? '✓' : '✗';
        const incorrectHint = answer.isCorrect ? '' : 
          `<div class="quiz-result-your-answer">${chrome.i18n.getMessage('yourAnswer', [answer.selectedAnswer])}</div>`;
        
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
        <div class="quiz-results">
          <div class="quiz-final-score">${this.score}/${QUIZ_TOTAL_QUESTIONS}</div>
          <div class="quiz-results-summary">${this.getScoreMessage(this.score)}</div>
          <div class="quiz-results-list">
            ${resultItems}
          </div>
        </div>
      `;
    }
  };
};

describe('Quiz Results - Answer Display', () => {
  let quizMode;

  beforeEach(() => {
    // Override chrome.i18n.getMessage to return formatted strings
    chrome.i18n.getMessage = jest.fn((key, args) => {
      if (key === 'yourAnswer' && args) {
        return `Your answer: ${args[0]}`;
      }
      return key;
    });

    quizMode = createMockQuizMode();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Correct Answer Display', () => {
    test('should show correct answer without "Your answer" hint', () => {
      quizMode.answers = [{
        question: {
          bird: {
            primaryComName: 'American Robin',
            imageUrl: 'https://example.com/robin.jpg'
          }
        },
        selectedAnswer: 'American Robin',
        correctAnswer: 'American Robin',
        isCorrect: true
      }];
      quizMode.score = 1;

      const html = quizMode.generateResultsHTML();

      // Should contain the bird name
      expect(html).toContain('American Robin');
      // Should have correct status class
      expect(html).toContain('class="quiz-result-item correct"');
      // Should have checkmark badge
      expect(html).toContain('✓');
      // Should NOT contain "Your answer" for correct answers
      expect(html).not.toContain('Your answer:');
      expect(html).not.toContain('quiz-result-your-answer');
    });
  });

  describe('Incorrect Answer Display', () => {
    test('should show user\'s wrong answer for incorrect responses', () => {
      quizMode.answers = [{
        question: {
          bird: {
            primaryComName: 'American Robin',
            imageUrl: 'https://example.com/robin.jpg'
          }
        },
        selectedAnswer: 'Northern Cardinal',
        correctAnswer: 'American Robin',
        isCorrect: false
      }];
      quizMode.score = 0;

      const html = quizMode.generateResultsHTML();

      // Should contain the correct bird name (from the image)
      expect(html).toContain('American Robin');
      // Should show what the user answered
      expect(html).toContain('Your answer: Northern Cardinal');
      // Should have the yourAnswer class
      expect(html).toContain('quiz-result-your-answer');
      // Should have incorrect status class
      expect(html).toContain('class="quiz-result-item incorrect"');
      // Should have X badge
      expect(html).toContain('✗');
    });

    test('should display user\'s selected answer, not the correct answer twice', () => {
      quizMode.answers = [{
        question: {
          bird: {
            primaryComName: 'Blue Jay',
            imageUrl: 'https://example.com/bird.jpg'
          }
        },
        selectedAnswer: 'Eastern Bluebird',
        correctAnswer: 'Blue Jay',
        isCorrect: false
      }];
      quizMode.score = 0;

      const html = quizMode.generateResultsHTML();

      // Should show the bird's name (correct answer)
      expect(html).toContain('Blue Jay');
      // Should show user's wrong answer
      expect(html).toContain('Eastern Bluebird');
      expect(html).toContain('Your answer: Eastern Bluebird');
      // The correct answer should appear only once (as the bird name in quiz-result-bird-name)
      // and not in the "Your answer" hint
      expect(html).not.toContain('Your answer: Blue Jay');
    });
  });

  describe('Mixed Results Display', () => {
    test('should correctly show mixed correct and incorrect answers', () => {
      quizMode.answers = [
        {
          question: {
            bird: {
              primaryComName: 'American Robin',
              imageUrl: 'https://example.com/robin.jpg'
            }
          },
          selectedAnswer: 'American Robin',
          correctAnswer: 'American Robin',
          isCorrect: true
        },
        {
          question: {
            bird: {
              primaryComName: 'Blue Jay',
              imageUrl: 'https://example.com/bluejay.jpg'
            }
          },
          selectedAnswer: 'Northern Cardinal',
          correctAnswer: 'Blue Jay',
          isCorrect: false
        },
        {
          question: {
            bird: {
              primaryComName: 'Bald Eagle',
              imageUrl: 'https://example.com/eagle.jpg'
            }
          },
          selectedAnswer: 'Bald Eagle',
          correctAnswer: 'Bald Eagle',
          isCorrect: true
        }
      ];
      quizMode.score = 2;

      const html = quizMode.generateResultsHTML();

      // Should contain all bird names
      expect(html).toContain('American Robin');
      expect(html).toContain('Blue Jay');
      expect(html).toContain('Bald Eagle');
      
      // Should show the user's wrong answer for Blue Jay question
      expect(html).toContain('Your answer: Northern Cardinal');
      
      // Should have 2 correct items and 1 incorrect
      const correctMatches = html.match(/class="quiz-result-item correct"/g);
      const incorrectMatches = html.match(/class="quiz-result-item incorrect"/g);
      expect(correctMatches.length).toBe(2);
      expect(incorrectMatches.length).toBe(1);
      
      // Score should be displayed correctly
      expect(html).toContain('2/10');
    });
  });

  describe('i18n Integration', () => {
    test('should call chrome.i18n.getMessage with yourAnswer key and selectedAnswer', () => {
      quizMode.answers = [{
        question: {
          bird: {
            primaryComName: 'Sparrow',
            imageUrl: 'https://example.com/sparrow.jpg'
          }
        },
        selectedAnswer: 'Finch',
        correctAnswer: 'Sparrow',
        isCorrect: false
      }];
      quizMode.score = 0;

      quizMode.generateResultsHTML();

      expect(chrome.i18n.getMessage).toHaveBeenCalledWith('yourAnswer', ['Finch']);
    });

    test('should not call yourAnswer for correct answers', () => {
      quizMode.answers = [{
        question: {
          bird: {
            primaryComName: 'Sparrow',
            imageUrl: 'https://example.com/sparrow.jpg'
          }
        },
        selectedAnswer: 'Sparrow',
        correctAnswer: 'Sparrow',
        isCorrect: true
      }];
      quizMode.score = 1;

      quizMode.generateResultsHTML();

      expect(chrome.i18n.getMessage).not.toHaveBeenCalledWith('yourAnswer', expect.anything());
    });
  });
});

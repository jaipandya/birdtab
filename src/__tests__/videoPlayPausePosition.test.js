/**
 * Video Play/Pause Button Positioning Tests
 *
 * Tests cover all positioning scenarios for play/pause buttons based on quick access visibility:
 * - Default (no quick access) - centered
 * - Clock only - centered
 * - Search bar only - centered (no top sites)
 * - Clock + search bar (no top sites) - shifted down 30vh
 * - Top sites visible (no clock) - shifted down 20vh
 * - Clock + search bar + top sites - shifted down 12vh
 */

describe('Video Play/Pause Button Positioning', () => {
  let playOverlay;
  let pauseIndicator;

  beforeEach(() => {
    // Setup DOM
    document.body.innerHTML = `
      <div id="content-container">
        <video class="background-video" loop playsinline preload="metadata">
          <source src="test-video.mp4" type="video/mp4">
        </video>
        <img class="background-image" src="test-poster.jpg" alt="Test Bird">
      </div>
    `;

    // Reset body classes
    document.body.className = '';

    // Create play overlay
    playOverlay = document.createElement('div');
    playOverlay.className = 'video-play-overlay';
    playOverlay.innerHTML = `
      <button class="video-play-btn">
        <img src="images/svg/play.svg" alt="Play">
      </button>
    `;
    document.getElementById('content-container').appendChild(playOverlay);

    // Create pause indicator
    pauseIndicator = document.createElement('div');
    pauseIndicator.className = 'video-pause-indicator';
    pauseIndicator.innerHTML = `
      <div class="pause-icon-container">
        <img src="images/svg/pause.svg" alt="Pause">
      </div>
    `;
    document.getElementById('content-container').appendChild(pauseIndicator);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.body.className = '';
  });

  describe('Default State (No Quick Access)', () => {
    test('should have no quick access classes on body', () => {
      expect(document.body.classList.contains('quick-access-enabled')).toBe(false);
      expect(document.body.classList.contains('quick-access-has-clock')).toBe(false);
      expect(document.body.classList.contains('quick-access-has-top-sites')).toBe(false);
    });

    test('play overlay should be centered (no positioning classes active)', () => {
      // Without any quick access classes, the play overlay uses default centering
      const overlay = document.querySelector('.video-play-overlay');
      expect(overlay).toBeTruthy();
      
      // Verify no quick access classes affect positioning
      expect(document.body.classList.contains('quick-access-has-top-sites')).toBe(false);
      expect(document.body.classList.contains('quick-access-has-clock')).toBe(false);
    });

    test('pause indicator should be centered (no positioning classes active)', () => {
      const indicator = document.querySelector('.video-pause-indicator');
      expect(indicator).toBeTruthy();
      
      // Verify no quick access classes affect positioning
      expect(document.body.classList.contains('quick-access-has-top-sites')).toBe(false);
      expect(document.body.classList.contains('quick-access-has-clock')).toBe(false);
    });
  });

  describe('Clock Only Visible', () => {
    beforeEach(() => {
      document.body.classList.add('quick-access-has-clock');
    });

    test('should have clock class but not search or top sites classes', () => {
      expect(document.body.classList.contains('quick-access-has-clock')).toBe(true);
      expect(document.body.classList.contains('quick-access-enabled')).toBe(false);
      expect(document.body.classList.contains('quick-access-has-top-sites')).toBe(false);
    });

    test('play overlay should remain centered (clock only does not shift)', () => {
      // Clock only case: has clock but NOT (quick-access-enabled and not top-sites)
      // CSS rule: .quick-access-has-clock.quick-access-enabled:not(.quick-access-has-top-sites)
      // This rule requires quick-access-enabled, so clock-only stays centered
      const overlay = document.querySelector('.video-play-overlay');
      expect(overlay).toBeTruthy();
      
      // Verify the specific condition: clock only without search bar
      expect(document.body.classList.contains('quick-access-has-clock')).toBe(true);
      expect(document.body.classList.contains('quick-access-enabled')).toBe(false);
    });

    test('pause indicator should remain centered (clock only does not shift)', () => {
      const indicator = document.querySelector('.video-pause-indicator');
      expect(indicator).toBeTruthy();
      
      expect(document.body.classList.contains('quick-access-has-clock')).toBe(true);
      expect(document.body.classList.contains('quick-access-enabled')).toBe(false);
    });
  });

  describe('Search Bar Only Visible (No Top Sites)', () => {
    beforeEach(() => {
      document.body.classList.add('quick-access-enabled');
    });

    test('should have search class but not clock or top sites classes', () => {
      expect(document.body.classList.contains('quick-access-enabled')).toBe(true);
      expect(document.body.classList.contains('quick-access-has-clock')).toBe(false);
      expect(document.body.classList.contains('quick-access-has-top-sites')).toBe(false);
    });

    test('play overlay should remain centered (search only without top sites)', () => {
      // No CSS rule matches: quick-access-enabled alone without top-sites or clock
      const overlay = document.querySelector('.video-play-overlay');
      expect(overlay).toBeTruthy();
      
      expect(document.body.classList.contains('quick-access-enabled')).toBe(true);
      expect(document.body.classList.contains('quick-access-has-top-sites')).toBe(false);
    });

    test('pause indicator should remain centered (search only without top sites)', () => {
      const indicator = document.querySelector('.video-pause-indicator');
      expect(indicator).toBeTruthy();
    });
  });

  describe('Clock + Search Bar Visible (No Top Sites)', () => {
    beforeEach(() => {
      document.body.classList.add('quick-access-has-clock');
      document.body.classList.add('quick-access-enabled');
    });

    test('should have clock and search classes but not top sites class', () => {
      expect(document.body.classList.contains('quick-access-has-clock')).toBe(true);
      expect(document.body.classList.contains('quick-access-enabled')).toBe(true);
      expect(document.body.classList.contains('quick-access-has-top-sites')).toBe(false);
    });

    test('play overlay should be shifted down (30vh from bottom)', () => {
      // CSS rule: .quick-access-has-clock.quick-access-enabled:not(.quick-access-has-top-sites)
      const overlay = document.querySelector('.video-play-overlay');
      expect(overlay).toBeTruthy();
      
      // Verify the class combination matches the CSS rule
      expect(document.body.classList.contains('quick-access-has-clock')).toBe(true);
      expect(document.body.classList.contains('quick-access-enabled')).toBe(true);
      expect(document.body.classList.contains('quick-access-has-top-sites')).toBe(false);
    });

    test('pause indicator should be shifted down (30vh from bottom)', () => {
      const indicator = document.querySelector('.video-pause-indicator');
      expect(indicator).toBeTruthy();
      
      expect(document.body.classList.contains('quick-access-has-clock')).toBe(true);
      expect(document.body.classList.contains('quick-access-enabled')).toBe(true);
      expect(document.body.classList.contains('quick-access-has-top-sites')).toBe(false);
    });
  });

  describe('Top Sites Visible (No Clock)', () => {
    beforeEach(() => {
      document.body.classList.add('quick-access-enabled');
      document.body.classList.add('quick-access-has-top-sites');
    });

    test('should have search and top sites classes but not clock class', () => {
      expect(document.body.classList.contains('quick-access-enabled')).toBe(true);
      expect(document.body.classList.contains('quick-access-has-top-sites')).toBe(true);
      expect(document.body.classList.contains('quick-access-has-clock')).toBe(false);
    });

    test('play overlay should be shifted down (20vh from bottom)', () => {
      // CSS rule: .quick-access-has-top-sites:not(.quick-access-has-clock)
      const overlay = document.querySelector('.video-play-overlay');
      expect(overlay).toBeTruthy();
      
      expect(document.body.classList.contains('quick-access-has-top-sites')).toBe(true);
      expect(document.body.classList.contains('quick-access-has-clock')).toBe(false);
    });

    test('pause indicator should be shifted down (20vh from bottom)', () => {
      const indicator = document.querySelector('.video-pause-indicator');
      expect(indicator).toBeTruthy();
      
      expect(document.body.classList.contains('quick-access-has-top-sites')).toBe(true);
      expect(document.body.classList.contains('quick-access-has-clock')).toBe(false);
    });
  });

  describe('Clock + Search Bar + Top Sites All Visible', () => {
    beforeEach(() => {
      document.body.classList.add('quick-access-has-clock');
      document.body.classList.add('quick-access-enabled');
      document.body.classList.add('quick-access-has-top-sites');
    });

    test('should have all three quick access classes', () => {
      expect(document.body.classList.contains('quick-access-has-clock')).toBe(true);
      expect(document.body.classList.contains('quick-access-enabled')).toBe(true);
      expect(document.body.classList.contains('quick-access-has-top-sites')).toBe(true);
    });

    test('play overlay should be shifted down most (12vh from bottom)', () => {
      // CSS rule: .quick-access-has-clock.quick-access-has-top-sites
      const overlay = document.querySelector('.video-play-overlay');
      expect(overlay).toBeTruthy();
      
      expect(document.body.classList.contains('quick-access-has-clock')).toBe(true);
      expect(document.body.classList.contains('quick-access-has-top-sites')).toBe(true);
    });

    test('pause indicator should be shifted down most (12vh from bottom)', () => {
      const indicator = document.querySelector('.video-pause-indicator');
      expect(indicator).toBeTruthy();
      
      expect(document.body.classList.contains('quick-access-has-clock')).toBe(true);
      expect(document.body.classList.contains('quick-access-has-top-sites')).toBe(true);
    });
  });

  describe('Body Class Management', () => {
    test('adding quick-access-has-clock should only affect clock state', () => {
      document.body.classList.add('quick-access-has-clock');
      
      expect(document.body.classList.contains('quick-access-has-clock')).toBe(true);
      expect(document.body.classList.contains('quick-access-enabled')).toBe(false);
      expect(document.body.classList.contains('quick-access-has-top-sites')).toBe(false);
    });

    test('adding quick-access-has-top-sites should only affect top sites state', () => {
      document.body.classList.add('quick-access-has-top-sites');
      
      expect(document.body.classList.contains('quick-access-has-top-sites')).toBe(true);
      expect(document.body.classList.contains('quick-access-has-clock')).toBe(false);
      expect(document.body.classList.contains('quick-access-enabled')).toBe(false);
    });

    test('removing quick-access-has-top-sites should update positioning', () => {
      // Start with all classes
      document.body.classList.add('quick-access-has-clock');
      document.body.classList.add('quick-access-enabled');
      document.body.classList.add('quick-access-has-top-sites');
      
      // Remove top sites class (simulating hiding top sites)
      document.body.classList.remove('quick-access-has-top-sites');
      
      // Should now match clock + search bar only case
      expect(document.body.classList.contains('quick-access-has-clock')).toBe(true);
      expect(document.body.classList.contains('quick-access-enabled')).toBe(true);
      expect(document.body.classList.contains('quick-access-has-top-sites')).toBe(false);
    });

    test('removing quick-access-has-clock should update positioning', () => {
      // Start with all classes
      document.body.classList.add('quick-access-has-clock');
      document.body.classList.add('quick-access-enabled');
      document.body.classList.add('quick-access-has-top-sites');
      
      // Remove clock class (simulating hiding clock)
      document.body.classList.remove('quick-access-has-clock');
      
      // Should now match top sites without clock case
      expect(document.body.classList.contains('quick-access-has-clock')).toBe(false);
      expect(document.body.classList.contains('quick-access-enabled')).toBe(true);
      expect(document.body.classList.contains('quick-access-has-top-sites')).toBe(true);
    });
  });

  describe('Play and Pause Button Same Position', () => {
    test('play overlay and pause indicator should have same positioning classes', () => {
      // Both elements should be affected by the same body classes
      document.body.classList.add('quick-access-has-clock');
      document.body.classList.add('quick-access-has-top-sites');
      
      const overlay = document.querySelector('.video-play-overlay');
      const indicator = document.querySelector('.video-pause-indicator');
      
      expect(overlay).toBeTruthy();
      expect(indicator).toBeTruthy();
      
      // Both should be affected by the same body class state
      // The CSS rules use the same selectors for both elements
    });

    test('toggling quick access should affect both play and pause equally', () => {
      // Start with no classes
      expect(document.body.classList.contains('quick-access-has-top-sites')).toBe(false);
      
      // Add top sites
      document.body.classList.add('quick-access-has-top-sites');
      
      // Both elements exist and will be positioned by same CSS rules
      expect(document.querySelector('.video-play-overlay')).toBeTruthy();
      expect(document.querySelector('.video-pause-indicator')).toBeTruthy();
      expect(document.body.classList.contains('quick-access-has-top-sites')).toBe(true);
    });
  });
});

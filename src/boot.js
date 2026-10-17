// Runs before anything else on a new tab (Chrome build only, copied as-is).
//
// BirdTab can step aside for Chrome's own new tab page (Settings → Open BirdTab):
//   'hourly'  the first new tab after an hour without BirdTab shows a bird, the rest open Chrome's page
//   'button'  BirdTab opens only from its toolbar button or the "bird" keyword (index.html?open)
// Decided here, from a localStorage mirror of the setting (newTabMode.js keeps it in step with
// chrome.storage), so nothing is painted first. Only on a fresh new tab: never on reload (refresh,
// picking a bird from History) or Back/Forward.
(function () {
  try {
    var mode = localStorage.getItem('birdtab:newTabMode');
    if (mode !== 'hourly' && mode !== 'button') return;
    if (/[?&]open\b/.test(location.search)) return;
    var nav = performance.getEntriesByType('navigation')[0];
    if (!nav || nav.type !== 'navigate') return;
    if (mode === 'hourly') {
      var lastShown = Number(localStorage.getItem('birdtab:lastShown') || 0);
      if (Date.now() - lastShown >= 60 * 60 * 1000) return;
    }
    // script.js checks this and starts nothing (no history, no stats, no bird taken from the queue)
    window.__birdtabSteppedAside = true;
    // Chrome's new tab page background, light or dark, instead of a flash of black
    document.documentElement.style.background = matchMedia('(prefers-color-scheme: dark)').matches ? '#202124' : '#ffffff';
    chrome.tabs.update({ url: 'chrome://new-tab-page/' });
  } catch (e) {
    // Show BirdTab rather than nothing
  }
})();

/* Maps Lead Finder - by Saim Rauf
   popup.js - toolbar popup that starts the scan. */
(function () {
  'use strict';

  var U = window.MapLeadUtils || {};
  var DEFAULTS = {
    query: 'Gym', location: 'London, UK', minRating: 4, minReviews: 50,
    maxResults: 100, sortBy: 'reviews', verifyWebsites: true
  };

  var startBtn = document.getElementById('startAuto');
  var statusEl = document.getElementById('status');
  var panelBtn = document.getElementById('openPanel');
  var started = false;

  function setStatus(text) { statusEl.textContent = text; }

  function searchUrl(options) {
    if (U.buildSearchUrl) return U.buildSearchUrl(options.query, options.location);
    return 'https://www.google.com/maps/search/' + encodeURIComponent((options.query || '') + ' ' + (options.location || '')).replace(/%20/g, '+');
  }

  async function startAuto() {
    if (started) return;
    started = true;
    startBtn.disabled = true;
    setStatus('Opening Google Maps…');

    try {
      var data = await chrome.storage.local.get({ lastOptions: null });
      var options = Object.assign({}, DEFAULTS, data.lastOptions || {});
      var tab = await chrome.tabs.create({ url: searchUrl(options), active: true });
      await chrome.storage.local.set({ autoStart: true, activeMapsTabId: tab.id });

      var panelOpened = false;
      try {
        if (chrome.sidePanel && chrome.sidePanel.open) {
          await chrome.sidePanel.open({ tabId: tab.id });
          panelOpened = true;
        }
      } catch (error) {
        /* older Chrome / no gesture - use a tab instead */
      }

      if (!panelOpened) {
        await chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html'), active: true });
      }
      setStatus(panelOpened ? 'Started in the side panel. Check progress there.' : 'Started in a new dashboard tab.');
    } catch (error) {
      setStatus('Error: ' + (error && error.message ? error.message : error));
      startBtn.disabled = false;
      started = false;
    }
  }

  startBtn.addEventListener('click', startAuto);
  panelBtn.addEventListener('click', function () {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html'), active: true });
  });

  // Starts automatically as soon as the popup appears.
  setTimeout(startAuto, 350);
})();

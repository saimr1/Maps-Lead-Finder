/* Maps Lead Finder - by Saim Rauf
   dashboard.js - search form, progress, results and export. */
(function () {
  'use strict';

  var U = window.MapLeadUtils || {};
  var $ = function (id) { return document.getElementById(id); };

  var els = {
    query: $('query'), location: $('location'), minRating: $('minRating'),
    minReviews: $('minReviews'), maxResults: $('maxResults'), sortBy: $('sortBy'),
    verifyWebsites: $('verifyWebsites'),
    startBtn: $('startBtn'), cancelBtn: $('cancelBtn'), openMapsBtn: $('openMapsBtn'),
    statusText: $('statusText'), statusCount: $('statusCount'),
    progressBar: $('progressBar'), log: $('log'),
    summary: $('summary'), resultsBody: $('resultsBody'),
    exportXlsxBtn: $('exportXlsxBtn'), exportCsvBtn: $('exportCsvBtn')
  };

  var mapsTabId = null;
  var leads = [];
  var currentOptions = {};
  var watchdog = null;
  var readyWatchdog = null;
  var candidates = [];
  var verifierTabs = [];
  var placeResolvers = {};
  var verifyCancelled = false;

  var DEFAULTS = {
    query: 'Gym', location: 'London, UK', minRating: 4, minReviews: 50,
    maxResults: 100, sortBy: 'reviews', verifyWebsites: true
  };

  function log(message) {
    var li = document.createElement('li');
    li.textContent = new Date().toLocaleTimeString('en-GB') + '  ' + message;
    els.log.appendChild(li);
    els.log.scrollTop = els.log.scrollHeight;
  }

  function setStatus(text, count) {
    els.statusText.textContent = text;
    els.statusCount.textContent = count || '';
  }

  function setProgress(percent) {
    els.progressBar.style.width = Math.max(0, Math.min(100, percent)) + '%';
  }

  function readOptions() {
    return {
      query: (els.query.value || '').trim(),
      location: (els.location.value || '').trim(),
      minRating: parseFloat(els.minRating.value) || 0,
      minReviews: parseInt(els.minReviews.value, 10) || 0,
      maxResults: parseInt(els.maxResults.value, 10) || 100,
      sortBy: els.sortBy.value,
      verifyWebsites: els.verifyWebsites.checked
    };
  }

  function saveOptions(options) {
    try { chrome.storage.local.set({ lastOptions: options }); } catch (error) { /* ignore */ }
  }

  function applyOptionsToForm(options) {
    if (!options) return;
    ['query', 'location', 'minRating', 'minReviews', 'maxResults', 'sortBy'].forEach(function (key) {
      if (options[key] !== undefined && els[key]) els[key].value = options[key];
    });
    if (options.verifyWebsites !== undefined) els.verifyWebsites.checked = !!options.verifyWebsites;
  }

  function loadOptions() {
    try {
      chrome.storage.local.get({ lastOptions: null }, function (data) {
        applyOptionsToForm(data && data.lastOptions);
      });
    } catch (error) { /* ignore */ }
  }

  function clearWatchdog() {
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
    if (readyWatchdog) { clearTimeout(readyWatchdog); readyWatchdog = null; }
  }

  function resetRun() {
    mapsTabId = null;
    leads = [];
    candidates = [];
    verifierTabs = [];
    placeResolvers = {};
    verifyCancelled = false;
    els.resultsBody.innerHTML = '';
    var tr = document.createElement('tr');
    var td = document.createElement('td');
    td.colSpan = 9;
    td.className = 'empty';
    td.textContent = 'Scraping in progress…';
    tr.appendChild(td);
    els.resultsBody.appendChild(tr);
    els.summary.innerHTML = '';
    els.exportXlsxBtn.disabled = true;
    els.exportCsvBtn.disabled = true;
    els.cancelBtn.disabled = false;
    els.startBtn.disabled = true;
    els.log.innerHTML = '';
    setProgress(4);
  }

  function finishRun() {
    clearWatchdog();
    mapsTabId = null;
    els.cancelBtn.disabled = true;
    els.startBtn.disabled = false;
  }

  function setWatchdogs() {
    clearWatchdog();
    readyWatchdog = setTimeout(function () {
      if (mapsTabId == null) {
        setStatus('Waiting for Google Maps to load…');
        log('Hint: accept any cookie / consent screen in the Maps tab, then wait a little longer.');
      }
    }, 45000);

    watchdog = setTimeout(function () {
      setStatus('Scrape timed out after 6 minutes.');
      log('Timeout. Check the Maps tab and try a smaller scan.');
      finishRun();
    }, 6 * 60 * 1000);
  }

  function pingAndStart(tabId, options, tries) {
    if (tabId == null) return;
    try {
      chrome.tabs.sendMessage(tabId, { type: 'PING' }, function (response) {
        if (chrome.runtime.lastError || !response || !response.ok) {
          if (tries > 0) {
            setTimeout(function () { pingAndStart(tabId, options, tries - 1); }, 350);
          } else {
            setStatus('Google Maps tab did not respond. Try again.');
            log('Could not contact the Maps tab.');
            finishRun();
          }
          return;
        }
        log('Scraping started in the Google Maps tab.');
        sendToMaps('START', options);
      });
    } catch (error) {
      if (tries > 0) setTimeout(function () { pingAndStart(tabId, options, tries - 1); }, 350);
    }
  }

  function waitForPlaceInfo(tabId, timeoutMs) {
    var started = Date.now();
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () {
        if (!done) { done = true; delete placeResolvers[tabId]; resolve(null); }
      }, timeoutMs || 9000);
      placeResolvers[tabId] = {
        started: started,
        resolve: function (info) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          delete placeResolvers[tabId];
          resolve(info);
        }
      };
    });
  }

  function finishWithLeads(rows, stats, noWebsiteOnly) {
    leads = U.filterAndSort ? U.filterAndSort(rows, {
      minRating: currentOptions.minRating,
      minReviews: currentOptions.minReviews,
      sortBy: currentOptions.sortBy,
      noWebsiteOnly: noWebsiteOnly !== false
    }) : rows;
    renderLeads(leads, stats || {});
    setStatus(leads.length ? ('Done - ' + leads.length + ' leads found.') : 'Done - no matching leads.');
    log('Website checks: ' + ((stats && stats.checkedWith) || 0) + ' with site, ' +
        ((stats && stats.checkedWithout) || 0) + ' without site, ' +
        ((stats && stats.unchecked) || 0) + ' not checked.');
    setProgress(100);
    els.exportXlsxBtn.disabled = leads.length === 0;
    els.exportCsvBtn.disabled = leads.length === 0;
    if (verifierTabs.length) {
      chrome.tabs.remove(verifierTabs, function () { void chrome.runtime.lastError; });
      verifierTabs = [];
    }
    placeResolvers = {};
    finishRun();
  }

  async function verifyCandidates(stats) {
    var poolSize = Math.min(4, candidates.length);
    var counts = { withSite: 0, withoutSite: 0, unknown: 0 };

    function checkOne(row, tabId) {
      var started = Date.now();
      return new Promise(function (resolve) {
        chrome.tabs.update(tabId, { url: row.link }, function () {
          waitForPlaceInfo(tabId, 10000).then(function (info) {
            if (info && info.ts >= started) {
              row.hasWebsite = info.hasWebsite;
              row.websiteUrl = info.websiteUrl || '';
              row.phone = info.phone || row.phone;
              row.address = info.address || row.address;
              row.websiteChecked = info.hasWebsite !== null;
              if (info.hasWebsite === true) counts.withSite++;
              else if (info.hasWebsite === false) counts.withoutSite++;
              else counts.unknown++;
            } else {
              counts.unknown++;
            }
            resolve();
          });
        });
      });
    }

    for (var start = 0; start < candidates.length && !verifyCancelled; start += poolSize) {
      var batch = candidates.slice(start, start + poolSize);
      var done = Math.min(start + poolSize, candidates.length);
      setStatus('Checking websites ' + done + ' / ' + candidates.length);
      setProgress(45 + 50 * (start / candidates.length));

      verifierTabs = [];
      for (var t = 0; t < batch.length; t++) {
        var tab = await new Promise(function (resolve) {
          chrome.tabs.create({ url: 'about:blank', active: true }, function (created) { resolve(created); });
        });
        verifierTabs.push(tab.id);
      }

      await Promise.all(batch.map(function (row, index) { return checkOne(row, verifierTabs[index]); }));

      if (verifierTabs.length) {
        chrome.tabs.remove(verifierTabs, function () { void chrome.runtime.lastError; });
        verifierTabs = [];
      }
    }

    stats = stats || {};
    stats.checkedWith = counts.withSite;
    stats.checkedWithout = counts.withoutSite;
    stats.unchecked = counts.unknown;
    finishWithLeads(candidates, stats, true);
  }

  function setCandidates(rows, options, stats) {
    candidates = rows || [];
    currentOptions = options || currentOptions;
    if (candidates.length === 0) {
      finishWithLeads([], stats, true);
      return;
    }
    if (currentOptions.verifyWebsites === false) {
      candidates.forEach(function (row) { row.hasWebsite = null; row.websiteChecked = false; });
      finishWithLeads(candidates, stats, false);
      return;
    }
    log('Checking websites for ' + candidates.length + ' places in a separate tab…');
    verifyCandidates(stats);
  }

  function startScrape() {
    var options = readOptions();
    if (!options.query && !options.location) {
      setStatus('Enter a search term or location first.');
      return;
    }
    currentOptions = options;
    saveOptions(options);
    resetRun();
    setStatus('Opening Google Maps…');
    log('Search: "' + (options.query || 'businesses') + '" in "' + (options.location || 'anywhere') + '"');

    var url = U.buildSearchUrl(options.query, options.location);
    setWatchdogs();
    chrome.tabs.create({ url: url, active: true }, function (tab) {
      mapsTabId = tab.id;
      log('Google Maps tab opened. Waiting for results…');
      pingAndStart(tab.id, options, 30);
    });
  }

  chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
    if (changeInfo.status === 'complete' && verifierTabs.indexOf(tabId) !== -1) {
      try {
        chrome.tabs.sendMessage(tabId, { type: 'CHECK_PLACE' }, function () { void chrome.runtime.lastError; });
      } catch (error) { /* ignore */ }
    }
  });

  function sendToMaps(type, payload) {
    if (mapsTabId == null) return;
    try {
      chrome.tabs.sendMessage(mapsTabId, Object.assign({ type: type }, payload || {}), function () {
        void chrome.runtime.lastError;
      });
    } catch (error) { /* ignore */ }
  }

  chrome.runtime.onMessage.addListener(function (message, sender) {
    if (!message || !message.type) return;

    if (message.type === 'MAPS_READY') {
      if (mapsTabId == null && sender.tab && sender.tab.id && sender.tab.url && sender.tab.url.indexOf('/maps/search/') !== -1) {
        mapsTabId = sender.tab.id;
        if (readyWatchdog) { clearTimeout(readyWatchdog); readyWatchdog = null; }
        log('Google Maps page is ready.');
      }
      return;
    }

    if (message.type === 'PLACE_INFO') {
      if (sender.tab && placeResolvers[sender.tab.id] && message.ts >= placeResolvers[sender.tab.id].started) {
        placeResolvers[sender.tab.id].resolve(message);
      }
      return;
    }

    if (message.type === 'CANDIDATES') {
      if (mapsTabId == null || !sender.tab || sender.tab.id !== mapsTabId) return;
      setCandidates(message.rows, message.options, message.stats);
      return;
    }

    if (mapsTabId == null || !sender.tab || sender.tab.id !== mapsTabId) return;

    if (message.type === 'PROGRESS') {
      setStatus(message.message || 'Working…');
      if (message.phase === 'collecting' && message.target) {
        setProgress(10 + 35 * Math.min(1, (message.collected || 0) / message.target));
        els.statusCount.textContent = (message.collected || 0) + ' / ' + message.target + ' collected';
      } else if (message.phase === 'verifying' && message.total) {
        setProgress(45 + 50 * ((message.done || 0) / message.total));
        els.statusCount.textContent = (message.done || 0) + ' / ' + message.total + ' checked';
      } else {
        setProgress(60);
      }
      log(message.message || message.phase);
      return;
    }

    if (message.type === 'ERROR') {
      setStatus('Error: ' + message.message);
      log('ERROR: ' + message.message);
      finishRun();
      return;
    }

    if (message.type === 'DONE') {
      leads = message.rows || [];
      renderLeads(leads, message.stats || {});
      var text = leads.length ? ('Done - ' + leads.length + ' leads found.') : 'Done - no matching leads.';
      setStatus(text);
      log(message.message || text);
      setProgress(100);
      els.exportXlsxBtn.disabled = leads.length === 0;
      els.exportCsvBtn.disabled = leads.length === 0;
      finishRun();
    }
  });

  function renderLeads(rows, stats) {
    els.resultsBody.innerHTML = '';
    if (!rows.length) {
      var tr = document.createElement('tr');
      var td = document.createElement('td');
      td.colSpan = 9;
      td.className = 'empty';
      td.textContent = (stats && stats.checkedWith > 0 && !stats.checkedWithout)
        ? 'Every checked place lists a website. Try another category or location.'
        : 'No businesses matched your filters. Try lowering the minimum reviews or rating.';
      tr.appendChild(td);
      els.resultsBody.appendChild(tr);
    }

    rows.forEach(function (row, index) {
      var tr = document.createElement('tr');

      function cell(value, className) {
        var td = document.createElement('td');
        td.textContent = value == null ? '' : String(value);
        if (className) td.className = className;
        tr.appendChild(td);
        return td;
      }

      cell(index + 1);
      cell(row.name);
      cell(row.category);
      cell((row.rating ? row.rating.toFixed(1) : '—') + ' ★', 'rating');
      cell(U.formatNumber ? U.formatNumber(row.reviews) : String(row.reviews || 0), 'reviews');
      cell(row.phone || '—');
      cell(row.address || '—');

      var websiteTd = document.createElement('td');
      var pill = document.createElement('span');
      if (row.hasWebsite === false) {
        pill.className = 'pill pill-no';
        pill.textContent = 'NO WEBSITE';
      } else if (row.hasWebsite === true) {
        pill.className = 'pill pill-unknown';
        pill.textContent = 'HAS WEBSITE';
      } else {
        pill.className = 'pill pill-unknown';
        pill.textContent = 'NOT CHECKED';
      }
      websiteTd.appendChild(pill);
      tr.appendChild(websiteTd);

      var linkTd = document.createElement('td');
      var link = document.createElement('a');
      link.href = /^https:\/\/www\.google\.com\/maps\//.test(row.link || '') ? row.link : '#';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Open in Maps';
      linkTd.appendChild(link);
      tr.appendChild(linkTd);

      els.resultsBody.appendChild(tr);
    });

    els.summary.innerHTML = '';
    [
      ['Scanned', stats.collected || 0],
      ['Matched filters', stats.candidates || 0],
      ['No-website leads', leads.length],
      ['Search', currentOptions.query || 'all']
    ].forEach(function (pair) {
      var chip = document.createElement('span');
      chip.className = 'chip';
      var strong = document.createElement('strong');
      strong.textContent = String(pair[1]);
      chip.appendChild(strong);
      chip.appendChild(document.createTextNode(' ' + pair[0]));
      els.summary.appendChild(chip);
    });
  }

  function triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function exportXlsx() {
    if (!leads.length || typeof XLSX === 'undefined') {
      setStatus('Excel library is not loaded.');
      return;
    }

    var headers = ['#', 'Business name', 'Category', 'Rating', 'Reviews', 'Phone', 'Address', 'Website', 'Map link', 'Website checked'];
    var data = leads.map(function (row, index) {
      return [
        index + 1,
        row.name || '',
        row.category || '',
        row.rating || 0,
        row.reviews || 0,
        row.phone || '',
        row.address || '',
        row.hasWebsite === false ? 'No website' : (row.hasWebsite === true ? 'Has website' : 'Not checked'),
        row.link || '',
        row.websiteChecked ? 'Yes' : 'No'
      ];
    });

    var sheet = XLSX.utils.aoa_to_sheet([headers].concat(data));
    sheet['!cols'] = [
      { wch: 5 }, { wch: 32 }, { wch: 18 }, { wch: 9 }, { wch: 11 },
      { wch: 19 }, { wch: 42 }, { wch: 15 }, { wch: 48 }, { wch: 15 }
    ];
    sheet['!autofilter'] = { ref: 'A1:J' + (data.length + 1) };

    var info = [
      ['Maps Lead Finder - export details'],
      [],
      ['Search term', currentOptions.query || ''],
      ['Location', currentOptions.location || ''],
      ['Minimum rating', currentOptions.minRating || 0],
      ['Minimum reviews', currentOptions.minReviews || 0],
      ['Sorted by', currentOptions.sortBy === 'rating' ? 'Highest rating' : 'Most reviews'],
      ['Website verification', currentOptions.verifyWebsites ? 'On (checked per place)' : 'Off (not checked)'],
      ['Leads exported', leads.length],
      ['Exported at', new Date().toLocaleString('en-GB')],
      [],
      ['Note', 'Website status is based on the Website link shown in Google Maps at the time of scanning. Re-check before outreach.']
    ];
    var infoSheet = XLSX.utils.aoa_to_sheet(info);
    infoSheet['!cols'] = [{ wch: 24 }, { wch: 70 }];

    var workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Leads');
    XLSX.utils.book_append_sheet(workbook, infoSheet, 'Search info');

    try {
      var buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      var blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      var name = 'maps-leads-' + (U.safeFileName ? U.safeFileName(currentOptions.query || 'businesses') : 'leads') + '-' + (U.timestamp ? U.timestamp() : 'export') + '.xlsx';
      triggerDownload(blob, name);
      log('Excel file downloaded: ' + name);
    } catch (error) {
      setStatus('Excel export failed: ' + error.message);
    }
  }

  function csvCell(value) {
    var text = value == null ? '' : String(value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function exportCsv() {
    if (!leads.length) return;
    var headers = ['#', 'Business name', 'Category', 'Rating', 'Reviews', 'Phone', 'Address', 'Website', 'Map link'];
    var lines = [headers.map(csvCell).join(',')];
    leads.forEach(function (row, index) {
      lines.push([
        index + 1, row.name, row.category, row.rating, row.reviews, row.phone, row.address,
        row.hasWebsite === false ? 'No website' : (row.hasWebsite === true ? 'Has website' : 'Not checked'),
        row.link
      ].map(csvCell).join(','));
    });
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    triggerDownload(blob, 'maps-leads-' + (U.safeFileName ? U.safeFileName(currentOptions.query || 'businesses') : 'leads') + '.csv');
  }

  els.startBtn.addEventListener('click', startScrape);
  els.cancelBtn.addEventListener('click', function () {
    sendToMaps('CANCEL', {});
    verifyCancelled = true;
    Object.keys(placeResolvers).forEach(function (tabId) { placeResolvers[tabId].resolve(null); });
    setStatus('Cancelling…');
    log('Cancel requested.');
  });
  els.openMapsBtn.addEventListener('click', function () {
    chrome.tabs.create({ url: U.buildSearchUrl(els.query.value, els.location.value), active: true });
  });
  els.exportXlsxBtn.addEventListener('click', exportXlsx);
  els.exportCsvBtn.addEventListener('click', exportCsv);

  function runAuto(options, tabId) {
    applyOptionsToForm(options);
    currentOptions = options;
    resetRun();
    setStatus('Auto-start: Google Maps is opening…');
    log('Auto-started from the extension icon.');

    function run(id) {
      mapsTabId = id;
      setWatchdogs();
      pingAndStart(id, options, 30);
    }
    function create() {
      chrome.tabs.create({ url: U.buildSearchUrl(options.query, options.location), active: true }, function (tab) {
        run(tab.id);
      });
    }

    if (tabId != null) {
      chrome.tabs.get(tabId, function (tab) {
        if (chrome.runtime.lastError || !tab) create();
        else run(tab.id);
      });
    } else {
      create();
    }
  }

  function autoInit() {
    chrome.storage.local.get({ autoStart: false, activeMapsTabId: null, lastOptions: null }, function (data) {
      if (!data.autoStart) {
        loadOptions();
        setStatus('Ready. Click the extension icon to auto-open Maps and scrape.');
        return;
      }
      chrome.storage.local.set({ autoStart: false }, function () {});
      runAuto(Object.assign({}, DEFAULTS, data.lastOptions || {}), data.activeMapsTabId);
    });
  }

  // Also handles a second icon click while the side panel is already open.
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local' || !changes.autoStart || !changes.autoStart.newValue) return;
    chrome.storage.local.get({ activeMapsTabId: null, lastOptions: null }, function (data) {
      chrome.storage.local.set({ autoStart: false }, function () {});
      runAuto(Object.assign({}, DEFAULTS, data.lastOptions || {}), data.activeMapsTabId);
    });
  });

  autoInit();
})();

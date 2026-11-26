/*
 * Maps Lead Finder - by Saim Rauf
 * content.js - reads Google Maps. Search tabs collect results; place tabs
 * report whether Google Maps shows a Website link.
 */
(function () {
  'use strict';

  var U = window.MapLeadUtils || {};
  var searchRunning = false;
  var cancelled = false;

  document.documentElement.setAttribute('data-mlf-loaded', '1');

  function post(type, payload) {
    try {
      chrome.runtime.sendMessage(Object.assign({ type: type }, payload || {}), function () { void chrome.runtime.lastError; });
    } catch (error) {
      /* dashboard may be closed */
    }
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function clean(value) {
    return U.cleanText ? U.cleanText(value) : String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function isPlacePage() {
    return location.href.indexOf('/maps/place/') !== -1;
  }

  function detailScope() {
    return document.querySelector('div[role="main"]') || document;
  }

  function inPanel(node) {
    return !node.closest('div[role="feed"]');
  }

  async function waitForDetail(timeoutMs) {
    var deadline = Date.now() + (timeoutMs || 5000);
    while (Date.now() < deadline) {
      var scope = detailScope();
      var text = scope.innerText || '';
      var selectors = [
        'a[aria-label*="website" i]',
        'button[aria-label*="website" i]',
        'a[href^="tel:"]',
        'button[aria-label*="phone" i]',
        '[aria-label^="Address"]',
        'button[aria-label="Directions"]',
        'button[aria-label="Save"]'
      ];
      for (var i = 0; i < selectors.length; i++) {
        if (Array.from(scope.querySelectorAll(selectors[i])).some(inPanel)) return true;
      }
      if (/add website/i.test(text)) return true;
      await sleep(200);
    }
    return false;
  }

  function detectWebsite() {
    var scope = detailScope();
    var links = Array.from(scope.querySelectorAll('a[aria-label]')).filter(inPanel);
    var site = links.find(function (node) {
      return /^website\b/i.test(clean(node.getAttribute('aria-label')));
    });
    if (!site) return { has: false, url: '' };
    var href = site.href || '';
    return { has: true, url: /^https?:\/\//i.test(href) ? href : '' };
  }

  function detectPhone() {
    var scope = detailScope();
    var tel = Array.from(scope.querySelectorAll('a[href^="tel:"]')).find(inPanel);
    if (tel) return clean(tel.innerText || tel.getAttribute('href').slice(4));
    var nodes = Array.from(scope.querySelectorAll('[aria-label]')).filter(inPanel);
    var phone = nodes.find(function (node) { return /^phone\b/i.test(clean(node.getAttribute('aria-label'))); });
    return phone ? clean(phone.getAttribute('aria-label').replace(/^phone\s*:\s*/i, '')) : '';
  }

  function detectAddress() {
    var scope = detailScope();
    var nodes = Array.from(scope.querySelectorAll('[aria-label]')).filter(inPanel);
    var address = nodes.find(function (node) { return /^address\b/i.test(clean(node.getAttribute('aria-label'))); });
    return address ? clean(address.getAttribute('aria-label').replace(/^address\s*:\s*/i, '')) : '';
  }

  function placeName() {
    var scope = detailScope();
    var node = scope.querySelector('h1');
    return clean(node ? node.innerText : document.title.replace(/\s*-\s*Google Maps.*$/, ''));
  }

  async function inspectPlace() {
    var loaded = await waitForDetail(5000);
    var website = loaded ? detectWebsite() : { has: null, url: '' };
    document.documentElement.setAttribute('data-mlf-place', website.has === null ? 'unknown' : String(website.has));
    return {
      url: location.href,
      name: placeName(),
      hasWebsite: website.has,
      websiteUrl: website.url,
      phone: loaded ? detectPhone() : '',
      address: loaded ? detectAddress() : '',
      ts: Date.now()
    };
  }

  function reportPlace() {
    inspectPlace().then(function (info) { post('PLACE_INFO', info); });
  }

  function getFeed() {
    return document.querySelector('div[role="feed"]');
  }

  async function waitForFeed(timeoutMs) {
    var deadline = Date.now() + (timeoutMs || 20000);
    while (Date.now() < deadline) {
      var feed = getFeed();
      if (feed && feed.querySelectorAll('div[role="article"]').length) return feed;
      await sleep(250);
    }
    throw new Error('Google Maps results did not load. Accept any consent screen in the Maps tab and try again.');
  }

  function parseCard(card) {
    var anchor = card.querySelector('a.hfpxzc') || card.querySelector('a[href*="/maps/place/"]');
    if (!anchor) return null;
    var name = clean(anchor.getAttribute('aria-label') || anchor.innerText);
    var link = anchor.href || '';
    if (!name || !link) return null;

    var ratingEl = card.querySelector('[role="img"][aria-label*="star" i]');
    var rr = U.parseRatingText
      ? U.parseRatingText(ratingEl ? ratingEl.getAttribute('aria-label') : '', card.innerText || '')
      : { rating: 0, reviews: 0 };

    var lines = (card.innerText || '').split('\n').map(clean).filter(Boolean);
    var detailLine = '';
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('·') !== -1) { detailLine = lines[i]; break; }
    }
    var parts = detailLine.split('·').map(clean).filter(Boolean);

    return {
      name: name,
      link: link,
      rating: rr.rating,
      reviews: rr.reviews,
      category: parts.length ? parts[0] : '',
      address: parts.length > 1 ? parts.slice(1).join(', ') : '',
      phone: '',
      hasWebsite: null,
      websiteUrl: '',
      websiteChecked: false
    };
  }

  async function collectCards(options, onProgress) {
    var feed = await waitForFeed(20000);
    var maxResults = Math.max(1, Number(options.maxResults) || 100);
    var delay = Math.max(200, Number(options.scrollDelay) || 550);
    var seen = new Map();
    var idleRounds = 0;
    var lastCount = -1;

    while (!cancelled && seen.size < maxResults && idleRounds < 4) {
      var cards = Array.from(feed.querySelectorAll('div[role="article"]'));
      for (var i = 0; i < cards.length; i++) {
        var firstLine = ((cards[i].innerText || '').split('\n')[0] || '').trim();
        if (/^sponsored$/i.test(firstLine)) continue;
        var row = parseCard(cards[i]);
        if (!row) continue;
        var key = row.name.toLowerCase() + '|' + row.address.toLowerCase();
        if (!seen.has(key)) seen.set(key, row);
      }
      onProgress(seen.size, maxResults);
      if (seen.size >= maxResults) break;
      if (seen.size === lastCount) idleRounds += 1;
      else idleRounds = 0;
      lastCount = seen.size;
      feed.scrollTop = feed.scrollHeight;
      await sleep(delay);
    }
    return Array.from(seen.values()).slice(0, maxResults);
  }

  function parsePlacePage() {
    var scope = detailScope();
    var text = clean(scope.innerText || '');
    var rr = U.parseRatingText ? U.parseRatingText('', text) : { rating: 0, reviews: 0 };
    return {
      name: placeName(),
      link: location.href,
      rating: rr.rating,
      reviews: rr.reviews,
      category: '',
      address: detectAddress(),
      phone: '',
      hasWebsite: null,
      websiteUrl: '',
      websiteChecked: false
    };
  }

  function findAnchor(name) {
    var anchors = Array.from(document.querySelectorAll('a.hfpxzc, a[href*="/maps/place/"]'));
    return anchors.find(function (a) { return clean(a.getAttribute('aria-label')) === name; }) || null;
  }

  async function ensureAnchor(name, feed) {
    for (var i = 0; i < 10; i++) {
      var anchor = findAnchor(name);
      if (anchor) return anchor;
      if (feed) feed.scrollTop = feed.scrollHeight;
      await sleep(300);
    }
    return null;
  }

  async function closePanel() {
    var nodes = Array.from(document.querySelectorAll('button[aria-label], a[aria-label]'));
    var back = nodes.find(function (node) { return /^(back|close)$/i.test(clean(node.getAttribute('aria-label'))); });
    if (back) { back.click(); await sleep(300); return; }
    if (location.href.indexOf('/place/') !== -1) history.back();
  }

  async function verifyInTab(rows, onProgress) {
    var feed = getFeed();
    for (var i = 0; i < rows.length; i++) {
      if (cancelled) break;
      var row = rows[i];
      onProgress(i + 1, rows.length);
      var anchor = await ensureAnchor(row.name, feed);
      if (!anchor) continue;
      anchor.click();
      if (await waitForDetail(4000)) {
        var info = await inspectPlace();
        row.hasWebsite = info.hasWebsite;
        row.websiteUrl = info.websiteUrl;
        row.phone = info.phone || row.phone;
        row.address = info.address || row.address;
        row.websiteChecked = info.hasWebsite !== null;
      }
      await closePanel();
      try { await waitForFeed(8000); } catch (error) { break; }
      feed = getFeed();
    }
  }

  async function start(options) {
    if (isPlacePage()) {
      var single = [parsePlacePage()].filter(function (row) {
        return row.rating >= (Number(options.minRating) || 0) && row.reviews >= (Number(options.minReviews) || 0);
      });
      post('DONE', { rows: single, stats: { collected: 1, candidates: single.length, leads: single.length }, message: 'Scan complete.' });
      return;
    }

    var rows = await collectCards(options, function (count, target) {
      post('PROGRESS', {
        phase: 'collecting',
        collected: count,
        target: target,
        message: 'Collecting results: ' + count + ' found'
      });
    });

    var candidates = U.filterAndSort
      ? U.filterAndSort(rows, {
          minRating: options.minRating,
          minReviews: options.minReviews,
          sortBy: options.sortBy,
          noWebsiteOnly: false
        })
      : rows;

    if (options.verifyWebsites !== false) {
      await verifyInTab(candidates, function (done, total) {
        post('PROGRESS', { phase: 'verifying', done: done, total: total, message: 'Checking website ' + done + ' / ' + total });
      });
    }

    var leads = U.filterAndSort
      ? U.filterAndSort(candidates, {
          minRating: options.minRating,
          minReviews: options.minReviews,
          sortBy: options.sortBy,
          noWebsiteOnly: options.verifyWebsites !== false
        })
      : candidates;

    post('DONE', {
      rows: leads,
      stats: {
        collected: rows.length,
        candidates: candidates.length,
        leads: leads.length,
        checkedWith: candidates.filter(function (r) { return r.hasWebsite === true; }).length,
        checkedWithout: candidates.filter(function (r) { return r.hasWebsite === false; }).length,
        unchecked: candidates.filter(function (r) { return r.hasWebsite === null; }).length
      },
      message: 'Scan complete: ' + leads.length + ' leads found.'
    });
  }

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || !message.type) return;
    if (message.type === 'PING') {
      sendResponse({ ok: true });
      return;
    }
    if (message.type === 'CHECK_PLACE') {
      if (!isPlacePage()) { sendResponse({ hasWebsite: null }); return; }
      inspectPlace().then(function (info) { sendResponse(info); });
      return true;
    }
    if (message.type === 'CANCEL') {
      cancelled = true;
      return;
    }
    if (message.type === 'START' && !searchRunning) {
      searchRunning = true;
      cancelled = false;
      start(message.options || {})
        .catch(function (error) {
          post('ERROR', { message: String((error && error.message) || error) });
        })
        .finally(function () { searchRunning = false; });
    }
  });

  post('MAPS_READY', { url: location.href });
  if (isPlacePage()) reportPlace();
})();

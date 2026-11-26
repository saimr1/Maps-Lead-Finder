/*
 * Maps Lead Finder - by Saim Rauf
 * content.js - runs on google.com/maps pages.
 * Collects result cards, optionally verifies the website on each promising
 * place's detail panel, filters and sorts, then sends results to the dashboard.
 */
(function () {
  'use strict';

  var U = window.MapLeadUtils || {};
  var running = false;
  var cancelled = false;

  function post(type, payload) {
    var message = Object.assign({ type: type }, payload || {});
    try {
      chrome.runtime.sendMessage(message, function () { void chrome.runtime.lastError; });
    } catch (error) {
      /* dashboard may be closed - ignore */
    }
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function clean(value) {
    return U.cleanText ? U.cleanText(value) : String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
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
    throw new Error('Google Maps results did not load. If you see a consent or sign-in page, accept it once and try again.');
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
    var category = parts.length ? parts[0] : '';
    var address = parts.length > 1 ? parts.slice(1).join(', ') : '';

    return {
      name: name,
      link: link,
      rating: rr.rating,
      reviews: rr.reviews,
      category: category,
      address: address,
      phone: '',
      hasWebsite: null,
      websiteUrl: '',
      websiteChecked: false
    };
  }

  async function collectCards(options, onProgress) {
    var feed = await waitForFeed(20000);
    var maxResults = Math.max(1, Number(options.maxResults) || 100);
    var delay = Math.max(200, Number(options.scrollDelay) || 900);
    var seen = new Map();
    var idleRounds = 0;
    var lastCount = -1;

    while (!cancelled && seen.size < maxResults && idleRounds < 4) {
      var cards = Array.from(feed.querySelectorAll('div[role="article"]'));
      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var firstLine = ((card.innerText || '').split('\n')[0] || '').trim();
        if (/^sponsored$/i.test(firstLine)) continue; // skip ads
        var row = parseCard(card);
        if (!row) continue;
        var key = row.name.toLowerCase() + '|' + row.address.toLowerCase();
        if (!seen.has(key)) seen.set(key, row);
      }

      onProgress({ phase: 'collecting', collected: seen.size, target: maxResults });
      if (seen.size >= maxResults) break;

      if (seen.size === lastCount) idleRounds += 1;
      else idleRounds = 0;
      lastCount = seen.size;

      feed.scrollTop = feed.scrollHeight;
      await sleep(delay);
    }

    return Array.from(seen.values()).slice(0, maxResults);
  }

  function findAnchor(name) {
    var anchors = Array.from(document.querySelectorAll('a.hfpxzc, a[href*="/maps/place/"]'));
    var exact = anchors.find(function (a) { return clean(a.getAttribute('aria-label')) === name; });
    if (exact) return exact;
    return anchors.find(function (a) { return clean(a.getAttribute('aria-label')).indexOf(name) === 0; }) || null;
  }

  function detailScope() {
    return document.querySelector('div[role="main"]') || document;
  }

  function inPanel(node) {
    return !node.closest('div[role="feed"]');
  }

  async function waitForPanel(name, timeoutMs) {
    var deadline = Date.now() + (timeoutMs || 3500);
    while (Date.now() < deadline) {
      // The URL changes before the panel finishes loading, so wait for a detail link.
      if (location.href.indexOf('/place/') !== -1) {
        var scope = detailScope();
        var selectors = [
          'a[aria-label*="website" i]',
          'button[aria-label*="website" i]',
          'a[href^="tel:"]',
          '[aria-label*="phone number" i]',
          '[aria-label^="Address"]',
          'button[aria-label="Directions"]',
          'button[aria-label="Save"]'
        ];
        var found = false;
        for (var s = 0; s < selectors.length && !found; s++) {
          found = Array.from(scope.querySelectorAll(selectors[s])).some(inPanel);
        }
        if (found) return true;
      }
      await sleep(150);
    }
    return false;
  }

  function detectWebsite() {
    var scope = detailScope();
    var nodes = Array.from(scope.querySelectorAll('a, button, [aria-label]')).filter(inPanel);
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var aria = clean(node.getAttribute('aria-label') || '');
      var text = clean(node.innerText || '');
      if (/^website\b/i.test(aria) || /^website\b/i.test(text)) {
        var href = node.href || '';
        var url = /^https?:\/\//i.test(href) && !/google\.|g\.co\b/i.test(href) ? href : '';
        return { has: true, url: url };
      }
    }
    return { has: false, url: '' };
  }

  function detectPhone() {
    var scope = detailScope();
    var tel = Array.from(scope.querySelectorAll('a[href^="tel:"]')).find(inPanel);
    if (tel) return clean(tel.innerText || tel.getAttribute('href').slice(4));
    var nodes = Array.from(scope.querySelectorAll('[aria-label]')).filter(inPanel);
    var phoneNode = nodes.find(function (node) { return /phone number/i.test(node.getAttribute('aria-label') || ''); });
    return phoneNode ? clean(phoneNode.innerText || phoneNode.getAttribute('aria-label')) : '';
  }

  function detectAddress() {
    var scope = detailScope();
    var nodes = Array.from(scope.querySelectorAll('[aria-label]')).filter(inPanel);
    var addressNode = nodes.find(function (node) { return /^address\b/i.test(node.getAttribute('aria-label') || ''); });
    return addressNode ? clean(addressNode.getAttribute('aria-label').replace(/^address\s*:\s*/i, '')) : '';
  }

  async function closePanel() {
    var buttons = Array.from(document.querySelectorAll('button[aria-label], a[aria-label]'));
    var back = buttons.find(function (node) { return /^(back|close)$/i.test(clean(node.getAttribute('aria-label'))); });
    if (back) {
      back.click();
      await sleep(350);
      return;
    }
    if (location.href.indexOf('/place/') !== -1) {
      history.back();
      try { await waitForFeed(8000); } catch (error) { /* ignore */ }
      await sleep(250);
    }
  }

  async function verifyOne(row) {
    var anchor = findAnchor(row.name);
    if (!anchor) return row; // card no longer available - leave unchecked

    try {
      anchor.click();
    } catch (error) {
      return row;
    }

    var loaded = await waitForPanel(row.name, 3500);
    if (!loaded) {
      await closePanel();
      return row;
    }

    var website = detectWebsite();
    row.hasWebsite = website.has;
    row.websiteUrl = website.url;
    row.phone = detectPhone();
    var fullAddress = detectAddress();
    if (fullAddress) row.address = fullAddress;
    row.websiteChecked = true;

    await closePanel();
    return row;
  }

  async function start(options) {
    post('PROGRESS', { phase: 'collecting', collected: 0, target: options.maxResults, message: 'Loading Google Maps results…' });

    var rows = await collectCards(options, function (info) {
      post('PROGRESS', Object.assign({ message: 'Collecting results: ' + info.collected + ' found' }, info));
    });

    post('PROGRESS', { phase: 'filtering', collected: rows.length, message: 'Filtering by rating and review count…' });

    var candidates = U.filterAndSort
      ? U.filterAndSort(rows, {
          minRating: options.minRating,
          minReviews: options.minReviews,
          sortBy: options.sortBy,
          noWebsiteOnly: false
        })
      : rows;

    if (candidates.length === 0) {
      post('DONE', {
        rows: [],
        stats: { collected: rows.length, candidates: 0, leads: 0 },
        message: 'No results matched your rating / review filters.'
      });
      return;
    }

    if (options.verifyWebsites !== false) {
      for (var i = 0; i < candidates.length; i++) {
        if (cancelled) break;
        post('PROGRESS', {
          phase: 'verifying',
          done: i,
          total: candidates.length,
          message: 'Checking website: ' + (i + 1) + ' / ' + candidates.length
        });
        candidates[i] = await verifyOne(candidates[i]);
      }
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
        leads: leads.length
      },
      message: 'Scrape complete: ' + leads.length + ' leads found.'
    });
  }

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || !message.type) return;
    if (message.type === 'PING') {
      sendResponse({ ok: true });
      return;
    }
    if (message.type === 'CANCEL') {
      cancelled = true;
      return;
    }
    if (message.type === 'START' && !running) {
      running = true;
      cancelled = false;
      start(message.options || {})
        .catch(function (error) {
          post('ERROR', { message: String((error && error.message) || error) });
        })
        .finally(function () { running = false; });
    }
  });

  post('MAPS_READY', { url: location.href });
})();

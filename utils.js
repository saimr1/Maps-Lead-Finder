/*
 * Maps Lead Finder - by Saim Rauf
 * utils.js - pure helpers shared by the content script, dashboard and Node tests.
 * Exposed as window.MapLeadUtils in the browser and module.exports in Node.
 */
(function (root) {
  'use strict';

  function cleanText(value) {
    var text = String(value == null ? '' : value)
      .replace(/[\uE000-\uF8FF]/g, ' ') // private-use icon glyphs used by Google Maps
      .replace(/[\u00a0\u202f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text;
  }

  function parseRatingText(ariaLabel, text) {
    var source = cleanText(ariaLabel) + ' ' + cleanText(text);
    var match = /(\d(?:\.\d)?)\s*stars?\s*,?\s*([\d,]+)\s*reviews?/i.exec(source);
    if (!match) {
      match = /(\d(?:\.\d)?)\s*\(([\d,]+)\)/.exec(source);
    }
    if (!match) return { rating: 0, reviews: 0 };
    return {
      rating: parseFloat(match[1]) || 0,
      reviews: parseInt(String(match[2]).replace(/,/g, ''), 10) || 0
    };
  }

  function buildSearchUrl(query, location) {
    var term = cleanText(query) + (cleanText(location) ? ' ' + cleanText(location) : '');
    return 'https://www.google.com/maps/search/' + encodeURIComponent(term).replace(/%20/g, '+');
  }

  function filterAndSort(rows, options) {
    var opts = options || {};
    var minRating = Number(opts.minRating) || 0;
    var minReviews = Number(opts.minReviews) || 0;
    var noWebsiteOnly = opts.noWebsiteOnly !== false;

    var filtered = (rows || []).filter(function (row) {
      if ((Number(row.rating) || 0) < minRating) return false;
      if ((Number(row.reviews) || 0) < minReviews) return false;
      if (noWebsiteOnly && row.hasWebsite !== false) return false;
      return true;
    });

    var sortBy = opts.sortBy === 'rating' ? 'rating' : 'reviews';
    filtered.sort(function (a, b) {
      if (sortBy === 'rating') {
        return (b.rating - a.rating) || (b.reviews - a.reviews) || String(a.name).localeCompare(String(b.name));
      }
      return (b.reviews - a.reviews) || (b.rating - a.rating) || String(a.name).localeCompare(String(b.name));
    });

    return filtered;
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString('en-GB');
  }

  function safeFileName(value) {
    return String(value || 'leads')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'leads';
  }

  function timestamp() {
    var d = new Date();
    function pad(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes());
  }

  var api = {
    cleanText: cleanText,
    parseRatingText: parseRatingText,
    buildSearchUrl: buildSearchUrl,
    filterAndSort: filterAndSort,
    formatNumber: formatNumber,
    safeFileName: safeFileName,
    timestamp: timestamp
  };

  root.MapLeadUtils = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

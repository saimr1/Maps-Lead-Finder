/* Simple Node checks for the pure helpers and the Excel writer. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');

function loadUtils() {
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'utils.js'), 'utf8'), sandbox, { filename: 'utils.js' });
  return sandbox.MapLeadUtils;
}

const U = loadUtils();

// Objects created inside the vm context have a different prototype,
// so normalise through JSON before deep comparisons.
function plain(value) { return JSON.parse(JSON.stringify(value)); }

// parseRatingText
assert.deepStrictEqual(plain(U.parseRatingText('4.8 stars 1,574 Reviews', '')), { rating: 4.8, reviews: 1574 });
assert.deepStrictEqual(plain(U.parseRatingText('', '4.6(624)')), { rating: 4.6, reviews: 624 });
assert.deepStrictEqual(plain(U.parseRatingText('', 'No reviews')), { rating: 0, reviews: 0 });

// buildSearchUrl
const url = U.buildSearchUrl('Gym', 'London, UK');
assert.ok(url.startsWith('https://www.google.com/maps/search/'), url);
assert.ok(url.includes('Gym+London'), url);

// filterAndSort
const rows = [
  { name: 'A', rating: 4.8, reviews: 100, hasWebsite: false },
  { name: 'B', rating: 4.9, reviews: 20, hasWebsite: false },
  { name: 'C', rating: 4.2, reviews: 900, hasWebsite: true },
  { name: 'D', rating: 4.1, reviews: 250, hasWebsite: false }
];
const leads = U.filterAndSort(rows, { minRating: 4, minReviews: 50, sortBy: 'reviews', noWebsiteOnly: true });
assert.deepStrictEqual(leads.map(r => r.name), ['D', 'A']);
const byRating = U.filterAndSort(rows, { minRating: 4, minReviews: 0, sortBy: 'rating', noWebsiteOnly: false });
assert.deepStrictEqual(byRating.slice(0, 2).map(r => r.name), ['B', 'A']);

// manifest is valid JSON with the expected permissions
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
assert.strictEqual(manifest.manifest_version, 3);
assert.ok(manifest.content_scripts[0].js.includes('content.js'));
assert.strictEqual(manifest.side_panel.default_path, 'dashboard.html');
assert.strictEqual(manifest.action.default_popup, 'popup.html');
assert.ok(manifest.permissions.includes('sidePanel'));

// Excel writer produces a readable .xlsx
const XLSX = require(path.join(root, 'vendor', 'xlsx.full.min.js'));
const ws = XLSX.utils.aoa_to_sheet([
  ['#', 'Business name', 'Rating', 'Reviews'],
  [1, 'Test Gym', 4.8, 1574]
]);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Leads');
const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'test.xlsx');
// Use write()+fs directly; the browser-oriented bundle does not bind Node's fs automatically.
const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
fs.writeFileSync(outFile, buffer);
const bytes = fs.readFileSync(outFile);
assert.strictEqual(bytes.slice(0, 2).toString(), 'PK', 'xlsx should be a ZIP archive');
assert.ok(bytes.length > 3000, 'xlsx should not be empty');

console.log('All checks passed. Sample workbook:', outFile);

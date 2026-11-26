# Maps Lead Finder

by Saim Rauf

A Chrome extension that finds businesses on Google Maps with good ratings and plenty of reviews but no website. It puts the results in an Excel file.

## Install

1. Unzip `maps-lead-finder-extension.zip` into a folder.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
3. Switch on Developer mode.
4. Click Load unpacked and pick the unzipped folder.
5. Click the extension icon in the toolbar.

Chrome may warn about a developer-mode extension. That is expected.

## Run it

Click the extension icon. A small popup opens and starts the scan on its own. You can also press "Start auto scrape" in the popup.

The extension opens Google Maps with your last search, which starts as "Gym" in "London, UK". It opens the dashboard next to Maps in a side panel. If your browser will not open a side panel, the dashboard opens in a normal tab instead.

The dashboard has these settings:

- What are you looking for: any Google Maps search term. The dropdown has a few common ones.
- Where: a city, area or postcode.
- Minimum rating: starts at 4.0.
- Minimum reviews: starts at 50. Raise this if you want fewer, stronger leads.
- Maximum results to scan: starts at 100.
- Sort results by: most reviews or highest rating.
- Verify website on every matched place: leave this on. It slows the scan down but gives accurate results.

Press Start scraping to rerun with changed settings. The settings are saved for the next click on the icon.

When the scan finishes, press Download Excel (.xlsx). There is also a CSV button if you need plain text.

## What ends up in the Excel file

The first sheet, Leads, has the business name, category, rating, review count, phone, address, website status, a link back to the place on Maps, and whether the website was checked. The second sheet, Search info, records the filters and the time of the scan.

## How the website check works

Google Maps result cards show the rating, review count, category and address. They do not show a website link. So the extension opens each place that passes your filters and looks for the Website link in its detail panel. A place without that link becomes a lead.

Sometimes a detail panel will not load. That row stays marked "Not checked" and is left out of the final leads.

## Troubleshooting

"Google Maps results did not load" usually means a consent or sign-in screen is in the way. Deal with that in the Maps tab and run the scan again.

If you get very few results, try a narrower location, a different search term, or a lower minimum review count. Google Maps also caps how many results it will show for one search.

If the website checking feels slow, lower the maximum results or raise the minimum reviews. Each place needs a moment to load.

Google changes the Maps markup now and then. If extraction stops working, the selectors to check are in `content.js`: `div[role="feed"]`, `div[role="article"]`, `a.hfpxzc`, and the Website lookup in the detail panel.

## Files

| File | What it does |
| --- | --- |
| `manifest.json` | Extension settings and permissions |
| `popup.html`, `popup.css`, `popup.js` | Toolbar popup that starts the scan |
| `dashboard.html`, `dashboard.css`, `dashboard.js` | Search form, progress, results and export |
| `content.js` | Reads Google Maps and checks each place |
| `utils.js` | Parsing, filtering and sorting helpers |
| `vendor/xlsx.full.min.js` | SheetJS, used to write the xlsx file |
| `tests/run-tests.js` | Checks for the helpers and the Excel writer |
| `build-zip.py` | Builds the installable ZIP |
| `LICENSE` | MIT license |

## Things to know

Keep scans modest and do not run them over and over. Google Maps may not allow automated collection, and the contact details you collect may fall under local marketing rules. Check the website yourself before you contact anyone. The extension does not get around CAPTCHAs or logins.

## Tests

```bash
node tests/run-tests.js
```

## License

MIT. Copyright 2026 Saim Rauf.

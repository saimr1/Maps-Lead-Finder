"""Build the load-unpacked ZIP next to this folder. By Saim Rauf."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent
target = root.parent / "maps-lead-finder-extension.zip"

files = [
    "manifest.json",
    "popup.html",
    "popup.css",
    "popup.js",
    "dashboard.html",
    "dashboard.css",
    "dashboard.js",
    "content.js",
    "utils.js",
    "vendor/xlsx.full.min.js",
    "README.md",
    "LICENSE",
    "tests/run-tests.js",
]

with ZipFile(target, "w", ZIP_DEFLATED) as archive:
    for name in files:
        path = root / name
        if not path.exists():
            raise SystemExit(f"Missing file: {path}")
        archive.write(path, name)

print(f"Created {target} ({target.stat().st_size:,} bytes)")

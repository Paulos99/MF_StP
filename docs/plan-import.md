# Browser plan import (MVP)

Open **План по фото** in the sketch toolbar (draw mode). The old photo-background
and calibration flow is still available beside it. Help is optional, inside
**Как работает?**. Nothing starts automatically on page load or upload.

1. Upload a PNG/JPEG/WebP. Header checks reject files over 12 MiB, 16 megapixels,
   or a 16,000-pixel side before decoding; unsupported/malformed headers fail closed.
   Large JPEG metadata beyond the 256 KiB header window is unsupported.
2. **Найти контуры** searches enclosed light regions in a dedicated module worker.
   Each proposed room is numbered on the image. Always select a contour explicitly,
   even if there is only one. For missing/wrong contours, draw points in order,
   close the contour and drag points (or edit their pixel coordinates).
3. Optional **Прочитать размеры (OCR)** starts a separate worker tree with
   Tesseract.js. Text-line boxes appear on the image; number candidates appear as
   buttons. They are NOT wall measurements. A number with no recognized unit stays
   unitless. Low-confidence text is marked; all recognition requires human review.
4. Select two points of a known segment (at least 10 pixels apart), type a real
   length and explicitly choose mm/cm/m. Calibration taps within 16 CSS pixels
   of an existing corner snap to that corner to avoid touch-position scale drift. OCR can fill that input only after clicking
   a candidate. Uniform scale is computed from this user-selected segment; each
   wall's derived length and total area are displayed for review.
5. The review checkbox and **Применить к комнате** are required. Any edit invalidates
   the checkbox. Only validated meter geometry and edge lengths cross into the
   existing `Room.setVertices`/sketch pipeline. There is no packing on draft drags.

Apply warns that it replaces the current contour and removes its windows/doors,
old image background and sketch undo/redo history. Height, material and other
calculator settings are retained. Cancel/Escape/close and recognition failure do
not change any room, openings or settings. Changing the active room closes the draft.

## Privacy, network and licenses

No server recognition, paid APIs, LLMs, account, telemetry or file upload was added.
The image and OCR payload stay in memory in the document and its dedicated workers.
No localStorage/IndexedDB image storage. OCR `cacheMethod: none` avoids model DB writes;
ordinary HTTP caching of static modules is still controlled by the browser/server.
Existing site analytics configuration is untouched.

`prepare:ocr` copies assets from pinned npm packages to ignored `public/ocr/` and
worker sources to ignored `public/plan-import/`. Both Vite and esbuild builds copy
these assets. All runtime OCR worker/core/model URLs are explicitly same-origin,
relative to the page, including GitHub Pages subpaths. No CDN fallback is requested.
A first OCR run fetches approximately 10 MiB in total of local scripts/core and English and
Russian integer LSTM models (models total about 5.4 MiB); exact transfer depends on
compression and core SIMD selection. Contour-only import fetches no OCR assets.
The generated full asset directory includes all core variants and is about 49 MiB;
only the supported variant is downloaded per run. Nothing is downloaded at startup
beyond a small toolbar handler and CSS; the dialog is dynamically imported on click.

Pinned new packages: `tesseract.js@7.0.0` (Apache-2.0),
`@tesseract.js-data/eng@1.0.0`, `@tesseract.js-data/rus@1.0.0`
(package metadata MIT; upstream tessdata models Apache-2.0).
Core is locked at 7.0.0 (Apache-2.0). `linkedom@0.18.12` is MIT, dev-only.
See `plan-import-licenses.txt`; full runtime license/notices are copied to
`ocr/licenses/` and beside the minified scripts in the build.

## Work bounds and limitations

- Decoded images are resampled to a longest side of 1,000 pixels before CV/OCR.
  Browser image decoding itself may still need memory for the original bounded
  image; a low-memory phone should use a smaller scan.
- CV visits at most 1,000,000 pixels, traces at most 32 eligible enclosed regions,
  returns at most 12 proposals, limits boundary complexity, and accepts at most
  64 vertices. Timers terminate CV after 15 seconds and OCR after 90 seconds.
- Stop, cancel, replacement upload and dialog close first invalidate UI ownership.
  The OCR host explicitly terminates its tracked children (including during initial
  model loading), then ACKs; the document terminates the host after that ACK. A
  500 ms hard fallback covers unresponsive/failed host startup. Completed OCR also
  terminates its child before publishing results. Browser-specific hard-fallback
  orphan-worker cleanup still needs real-device verification. Stale messages/decodes
  are ignored. Bitmaps/canvas surfaces are released; no object URLs are used.
- No arbitrary BTI reliability claim. The detector is a simple dark-wall/light-room
  algorithm, not OpenCV/semantic recognition. Open door gaps, photos with shadows,
  rotated/skewed drawings and clutter may fail or produce wrong proposals. It does
  not correct perspective or discover internal columns/holes. Review is mandatory.
- Uniform scale cannot repair perspective or inconsistent scan dimensions. Fix the
  image first; use the existing sketch tools for individual wall corrections later.
- OCR is not a room/edge association algorithm. It may read area/room numbers as
  candidates. Even the clean synthetic fixture reads `2.70 m` as `2.70 т`; the parser
  correctly leaves 2.70 unitless instead of guessing meters.
- Requires a modern browser with dialog, createImageBitmap, Worker, nested workers,
  and WebAssembly for OCR. OCR failure leaves manual tracing/calibration available.
  PDF, SVG and animated formats are not supported (animated WebP is rejected).

## Verification

```
npm ci
npm test                # existing layout invariants + 26 deterministic import checks
npm run test:ocr        # real Tesseract Node smoke test, self-hosted model files
npm run build
npm run build:esbuild
```

Fixtures: `scripts/fixtures/plan-import/` (fictional rectangular, irregular,
multi-room, blank, open-wall PNGs; compressed raw pixels for CV; OCR image;
unsupported SVG). `generate.py` regenerates fixtures with Pillow, but tests do not
require Python/Pillow. No customer plans are included.

DOM tests use linkedom and canvas/worker stubs; they are not visual browser QA.
Before merge, desktop/browser verification is still needed at 412×915 and desktop:
- Load under a subpath; ensure no OCR/third-party request before the OCR action.
- Upload fixtures; choose among numbered contours; move points; calibrate in mm/cm/m.
- Run real OCR and verify number boxes and explicit units; check the network contains
  only same-origin static GETs and no image/recognized-text request payload.
- Stop during module loading/recognition, replace an upload, Escape/close, and inspect
  that all child workers terminate and current room/openings/settings remain intact.
- Apply after review; verify the changed scheme and PDF still use the normal pipeline.

`npm audit` still reports the repository's existing Vite/esbuild development-tool
advisories (one high, one moderate). No automatic/major tooling upgrade in this PR.
Do not expose the development server publicly. No deployment or merge is included.

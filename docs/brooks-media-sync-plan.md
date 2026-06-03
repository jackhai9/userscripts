# Brooks Media Sync Plan

## Goal

Audit the local Brooks Trading Course archive against the currently available course media before downloading or replacing anything.

The local archive is expected at:

```text
/Users/lizhenhai/PA/input_videos
```

The workflow must answer:

- Which videos are missing locally.
- Which English subtitles are missing or changed.
- Which Chinese subtitles are missing or changed.
- Which local videos are likely stale, duplicated, or malformed.
- Which files should be downloaded next, with a clear reason for each candidate.

Video downloads are not automatic. They require an explicit candidate list and user approval.

## Source Of Truth

The durable source of truth is a course media index exported from the logged-in Brooks pages. Each index row should contain:

- Course page URL.
- Page title.
- Media title from the detected m3u8 `title` query parameter when available.
- `yt-dlp` output name.
- Bunny iframe referer.
- Bunny video ID.
- m3u8 URL.
- Chinese subtitle URL.
- English subtitle URL.
- Collection status and failure reason when collection fails.

This index is the basis for later subtitle download, video duration comparison, local file matching, and candidate report generation.

## Page HTML And Rendered DOM

Unauthenticated command-line HTTP reads of Brooks video page HTML did not expose `iframe.mediadelivery.net` or Bunny video IDs in tested pages. The media data is protected by the logged-in Brooks session.

Inside a logged-in Brooks page, the rendered video page DOM has exposed a single Bunny iframe such as:

```text
https://iframe.mediadelivery.net/embed/<libraryId>/<videoId>?autoplay=false&loop=false&muted=false&preload=true
```

The lightweight exporter path should therefore run from the authenticated Brooks origin, fetch each video page with same-origin XHR, parse the returned HTML with `DOMParser`, extract the Bunny iframe URL, and then load only that Bunny iframe for m3u8 detection. This avoids rendering a full WordPress page for every video and reduces CPU/memory pressure during long index runs.

If same-origin XHR fails or the parsed HTML does not contain the Bunny iframe, treat that page as an explicit failure with the fetch/parse reason. Do not silently fall back to full-page batching without surfacing the cost and failure mode.

## Recommended Exporter

Prefer enhancing the existing Tampermonkey userscript before building a standalone Chrome extension.

Recommended userscript flow:

1. Add an export command on the Brooks course index page.
2. Collect video page links from the course index page.
3. Process links sequentially with concurrency `1`.
4. Fetch each video page HTML with same-origin XHR from the logged-in Brooks page.
5. Parse `iframe[src*="iframe.mediadelivery.net/embed/"]` and normalize the page title.
6. Load only the Bunny embed iframe, appending exporter context parameters such as `jhBrooksPageUrl` and `jhBrooksTitle`.
7. Wait for m3u8 detection from that Bunny iframe.
8. Extract `referer`, `videoId`, m3u8 URL, CN subtitle URL, EN subtitle URL, and output name.
9. Store progress in `localStorage` or `GM_setValue` so the run can resume.
10. Export JSON and CSV.
11. Record timeouts and failures instead of silently skipping pages.

## Exporter State Model

The Brooks exporter is a resumable state machine, not a fire-and-forget page scraper. Keep these fields and transitions explicit:

- `links` must remain the original full course page list so totals and indexes stay stable.
- `records` stores successful original indexes.
- `failures` stores failed original indexes and failure reasons.
- `index` is the next normal full-run index, not a retry-only queue cursor.
- `retryQueue` is temporary and must contain only failed original indexes.
- A retry flow must preserve existing successful `records`; it must not restart the full 208-item run.
- `重试失败` should only be available after the export is complete, non-running, and still has failures.
- Do not offer `重试失败` for a paused partial run. If a partial run has failures and unprocessed links, the correct action is `继续`, not retry-only recovery.
- All success paths must advance the same queue primitive. This includes both direct Bunny iframe `m3u8` messages and same-origin Brooks record messages. Do not manually set `index = pending.index + 1` in one path while retry uses `retryQueue`.
- A completed retry should drain `retryQueue`, set `running` false when no queued item remains, and leave the original `links` intact.
- `重置` is a discard action, not a start action. It should clear the saved export state and return to the initial panel, but it must not automatically start collection.
- Hide `重置` when there is no saved state, while collection is running, and after a complete successful run. Show it only when discarding state is useful: paused/interrupted runs, incomplete non-running state, or completed runs with failures.
- When `重置` is visible, show a short helper text that explains it clears current progress/results and does not auto-start. Do not show that helper in initial or complete-success states.

Timeouts such as `m3u8 detection timeout` are recoverable per-item failures. The UI should guide users to `重试失败` first. If retry still fails, export JSON so the failing URLs and reasons are visible for manual inspection.

## Runtime Timing Semantics

Exporter runtime means active script runtime, not wall-clock time since the first start.

Do not compute elapsed time as `startedAt -> updatedAt`; that incorrectly counts:

- User-paused periods.
- Time where the page stayed open but the exporter was stopped.
- Long gaps between a previous run and a later resume.

Use an active-run accumulator instead:

- Start or resume sets `activeRunStartedAt`.
- Pause or completion adds `now - activeRunStartedAt` into `activeElapsedMs` and clears `activeRunStartedAt`.
- While running, displayed elapsed time is `activeElapsedMs + now - activeRunStartedAt`.
- While paused or completed, displayed elapsed time is just `activeElapsedMs`.
- Export JSON should include machine-readable `elapsedMs` / `elapsedSeconds` and human-readable `elapsedText`.

Old persisted states that do not have active timing fields should not invent a wall-clock runtime from `startedAt` and `updatedAt`. Prefer showing no elapsed time over showing a misleading duration.

If the userscript becomes unreliable, upgrade to a Chrome extension with:

- A content script for page DOM extraction.
- A background/service worker for cross-origin requests and queue management.
- Explicit `host_permissions` for Brooks, mediadelivery, and Bunny CDN hosts.
- `chrome.scripting.executeScript()` or registered content scripts in `MAIN` world only when the code must share the host page JavaScript environment. Keep extension APIs in isolated content scripts/background code and bridge with `postMessage`.

## Bunny Referer Behavior

Do not validate Bunny embeds by opening the embed URL as a top-level page. In live checks on 2026-06-03, top-level access to a Bunny embed produced a restricted `403`-style page in Chrome and a small response by command line.

The same Bunny embed URL returned the full player HTML when requested with the Brooks video page as the HTTP referer. The full player response included:

- `playlist.m3u8`.
- `captions/EN.vtt`.
- `captions/CN.vtt`.

Adding exporter-only query parameters such as `jhBrooksPageUrl` and `jhBrooksTitle` did not change the full player response when the Brooks referer was present.

Implication: validation must either run the Bunny embed as an iframe inside a Brooks page, or reproduce the request with the Brooks video page as `Referer`. A top-level Bunny tab is not a valid negative test.

## Codex Chrome Verification Limits

The Codex Chrome extension is useful for authenticated DOM inspection, screenshots, console logs, and observed page assets. It is not always equivalent to the browser's own DevTools Console.

Observed on 2026-06-03 in the extension-backed Playwright evaluation surface:

- `document.querySelector()` and layout inspection worked.
- `fetch`, `XMLHttpRequest`, `DOMParser`, `document.createElement`, `window.addEventListener`, and `window.performance` were unavailable or not callable from that evaluation sandbox.
- This limitation belongs to the automation surface, not necessarily to the target Brooks page.

When this happens, use layered evidence instead of assuming the page cannot run the code:

1. Use Chrome automation for read-only live DOM, iframe attributes, layout, screenshots, and console logs.
2. Use command-line `curl` with and without `Referer` to verify server-side access-control behavior.
3. Use unit tests or jsdom for deterministic parser/state-machine behavior.
4. Use the actual Tampermonkey script or a purpose-built helper extension for full in-page execution of XHR, DOM mutation, iframe creation, and `postMessage`.

Computer-use style clicking can confirm visible UI state, but it does not bypass JavaScript execution-world or extension sandbox limits. For full programmatic validation, prefer DevTools Console/Snippets, a temporary helper extension, or the installed userscript itself.

## Local Audit Workflow

After exporting the index:

1. Download current CN and EN subtitles into a staging directory.
2. Compare staged subtitles with local subtitles by hash and optional text diff.
3. Compute remote video duration by summing m3u8 `#EXTINF` entries.
4. Compute local mp4 duration with `ffprobe`.
5. Match local files by normalized title and video code.
6. Generate a report with categories:
   - Missing subtitles.
   - Changed subtitles.
   - Missing videos.
   - Video duration mismatch.
   - Version-name-only differences.
   - Local files with no current course match.

Only download videos after reviewing the report.

## Caption URL Derivation

Caption URLs should be derived from the actual detected m3u8 URL, not from a hardcoded Bunny CDN host.

Supported patterns:

```text
https://<bunny-host>/<videoId>/<resolution>/video.m3u8
https://<bunny-host>/<videoId>/video.m3u8
https://<bunny-host>/<videoId>/playlist.m3u8
```

Expected captions:

```text
https://<bunny-host>/<videoId>/captions/CN.vtt
https://<bunny-host>/<videoId>/captions/EN.vtt
```

The userscript may remove its own `title` query parameter, but should preserve other query parameters because CDN token or expiry values may be required.

## Safety Rules

- Do not read or export cookies.
- Do not use `yt-dlp --cookies-from-browser`.
- Do not download videos by default.
- Keep browser automation low-concurrency and resumable.
- Keep old videos unless the user explicitly approves deletion.
- Write new subtitle/video downloads to staging first.
- Treat 403/404/timeouts as explicit failure states, not as proof that media is missing.

## Independent Review Result

A read-only reviewer agent using `gpt-5.5` reviewed this plan and the caption derivation fix direction.

Reviewer verdict:

- The plan is aligned with common engineering practice for logged-in, dynamically rendered HLS pages.
- The main risk is access-control and completeness: login state, referer, CDN token, lazy iframe loading, and retry behavior must be captured explicitly.
- The caption fix is worthwhile, but must support both `video.m3u8` and `playlist.m3u8` and preserve non-`title` query parameters.

## Validation Checklist

- After changing `src/m3u8-downloader/**`, run `npm run build:m3u8-downloader` and `npm run check:m3u8-downloader`.
- Run the focused Brooks media export tests when changing index/export behavior.
- Test caption derivation for:
  - `/<id>/playlist.m3u8`
  - `/<id>/video.m3u8`
  - `/<id>/<resolution>/video.m3u8`
  - URLs with `?title=`
  - URLs with non-`title` query parameters
- Test one logged-in Brooks page end to end:
  - m3u8 detected.
  - CN and EN subtitle URLs use the detected media host.
  - CN and EN subtitle requests return 200.
- For performance-sensitive exporter changes, confirm that the exporter loads only the Bunny iframe for each item, not a full WordPress video page iframe.
- When Codex Chrome cannot execute page-side network or DOM-mutation APIs, record that as a tool limitation and use the layered validation path above.
- For a full exporter, verify:
  - Course link count.
  - Successful page count.
  - Timeout/failure count.
  - Duplicate video IDs.
  - Exported field completeness.
  - Retry failed drains only failed original indexes.
  - Partial paused exports do not expose retry-only recovery.
  - Elapsed runtime excludes paused/stopped wall-clock time.
  - Complete successful exports hide `重置`; paused/interrupted or failed states show `重置` with helper text.

## Source Split Baseline

`src/m3u8-downloader/` is the source of truth for `scripts/m3u8-downloader.user.js`.

The module split preserves behavior while moving the install entry to an esbuild-generated bundle. The generated `scripts/m3u8-downloader.user.js` must stay readable, non-minified, and suitable for Tampermonkey install/update.

Current module boundaries:

```text
src/m3u8-downloader/
  index.user.js       userscript metadata, generic m3u8 interception, media scanning, and startup glue
  constants.js        message types, storage keys, timeouts, and blocked host suffixes
  media-url.js        m3u8 cleanup, caption URL derivation, video IDs, yt-dlp output names, shell quoting
  brooks-pages.js     Brooks host/page detection, course link extraction, page title and Bunny iframe parsing
  brooks-record.js    Brooks media index record construction
  brooks-status.js    export status text, active runtime accounting, reset/retry visibility, JSON payloads
  brooks-exporter.js  Brooks export state machine, hidden iframe runner, localStorage state, panel DOM
```

Migration checklist:

- Keep the metadata block in `src/m3u8-downloader/index.user.js`.
- Preserve `@updateURL` and `@downloadURL`.
- Keep generated output readable, non-compressed, and non-obfuscated.
- After changing `src/m3u8-downloader/**`, run `npm run build:m3u8-downloader` and `npm run check:m3u8-downloader`.
- Bump `@version` in `src/m3u8-downloader/index.user.js` before generating when behavior changes.
- Focused Brooks unit tests should import source modules directly for pure logic and use the generated userscript only for browser/runtime integration checks.
- Keep future behavior changes separate from mechanical module moves unless the behavior change is required to preserve existing semantics.

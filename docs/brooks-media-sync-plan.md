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
- `yt-dlp` output name.
- Bunny iframe referer.
- Bunny video ID.
- m3u8 URL.
- Chinese subtitle URL.
- English subtitle URL.
- Collection status and failure reason when collection fails.

This index is the basis for later subtitle download, video duration comparison, local file matching, and candidate report generation.

## Why HTML Fetch Alone Is Not Enough

Direct unauthenticated HTTP reads of Brooks video page HTML did not expose `iframe.mediadelivery.net` or Bunny video IDs in tested pages. The media data appears only after the logged-in browser page loads and renders the player.

Because of that, the index exporter should not assume the raw HTML contains the media iframe. It should read the rendered DOM from the authenticated page context.

## Recommended Exporter

Prefer enhancing the existing Tampermonkey userscript before building a standalone Chrome extension.

Recommended userscript flow:

1. Add an export command on the Brooks course index page.
2. Collect video page links from the course index page.
3. Process links sequentially with concurrency `1`.
4. Load each video page in a controlled same-origin page or hidden iframe.
5. Wait for the Bunny iframe or m3u8 detection to appear.
6. Extract `referer`, `videoId`, m3u8 URL, CN subtitle URL, EN subtitle URL, and output name.
7. Store progress with `GM_setValue` so the run can resume.
8. Export JSON and CSV.
9. Record timeouts and failures instead of silently skipping pages.

If the userscript becomes unreliable, upgrade to a Chrome extension with:

- A content script for page DOM extraction.
- A background/service worker for cross-origin requests and queue management.
- Explicit `host_permissions` for Brooks, mediadelivery, and Bunny CDN hosts.

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

- Run `node --check scripts/m3u8-downloader.user.js` after userscript edits.
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
- For a full exporter, verify:
  - Course link count.
  - Successful page count.
  - Timeout/failure count.
  - Duplicate video IDs.
  - Exported field completeness.

#!/usr/bin/env python3
"""Batch check bookmark URLs: detect dead links and http→https upgrade opportunities.

Checks:
1. HTTP status code (2xx/3xx = alive, 4xx anti-bot = uncertain)
2. Redirect domain mismatch (parked/expired domain detection)
3. Page content keywords for parked/expired/for-sale pages (HTML only)
4. http → https upgrade feasibility (with SSL verification)
"""

import asyncio
import csv
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

import aiohttp

# --- Config ---
INPUT_TSV = Path(__file__).parent.parent / "chrome_bookmark_scan_compare.fast-20260315.tsv"
OUTPUT_TSV = Path(__file__).parent.parent / "bookmark_check_result.tsv"
CONCURRENCY = 50
PER_HOST_LIMIT = 5  # max concurrent requests per host (#9)
TIMEOUT = 15  # seconds per request
CONTENT_READ_LIMIT = 30_000  # bytes to read for content check (#8: increased from 10KB)
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

# Status codes that indicate anti-bot / auth wall, not truly dead (#5)
UNCERTAIN_STATUS_CODES = {401, 403, 405, 429, 503, 999}

# Known domain parking / expired domain hosting services (#4, #12: cleaned up)
PARKING_DOMAINS = {
    "hugedomains.com",
    "sedoparking.com",
    "afternic.com",
    "bodis.com",
    "above.com",
    "parkingcrew.net",
    "domainmarket.com",
    "dan.com",
    "undeveloped.com",
    "dnspod.qcloud.com",
    "namesilo.com",
    "dynadot.com",
    "porkbun.com",
    "epik.com",
}

# Multi-level TLDs where root domain needs 3 parts (#1)
MULTI_LEVEL_TLDS = {
    "co.uk", "org.uk", "me.uk", "ac.uk", "gov.uk",
    "com.au", "net.au", "org.au", "edu.au",
    "co.nz", "net.nz", "org.nz",
    "co.jp", "or.jp", "ne.jp", "ac.jp",
    "co.kr", "or.kr",
    "com.cn", "net.cn", "org.cn", "gov.cn",
    "com.tw", "org.tw", "net.tw",
    "com.hk", "org.hk", "net.hk",
    "com.sg", "org.sg", "net.sg",
    "com.br", "org.br", "net.br",
    "co.in", "net.in", "org.in",
    "co.za", "org.za", "net.za",
    "com.mx", "org.mx",
    "co.il",
    "github.io", "gitlab.io", "blogspot.com", "herokuapp.com",
    "vercel.app", "netlify.app", "pages.dev",
}

# Content patterns indicating parked/expired/for-sale pages (#7: tightened)
PARKING_CONTENT_PATTERNS = re.compile(
    r"(?i)"
    r"(?:domain\s+(?:has\s+)?expir(?:ed|es|y))"
    r"|(?:this\s+domain\s+is\s+for\s+sale)"
    r"|(?:buy\s+this\s+domain)"
    r"|(?:domain\s+(?:is\s+)?parked)"
    r"|(?:is\s+this\s+your\s+domain\?\s*renew)"
    r"|(?:domain\s+name\s+(?:is\s+)?for\s+sale)"
    r"|(?:this\s+(?:web\s*)?page\s+is\s+parked)"
    r"|(?:parked\s+(?:by|domain|page|free))"
    r"|(?:the\s+owner\s+of\s+this\s+domain\s+has\s+not)"
)

# Non-checkable URL schemes (#6)
SKIP_SCHEMES = {"javascript", "mailto", "chrome", "chrome-extension",
                "file", "about", "data", "blob", "ftp"}


def get_root_domain(url: str) -> str:
    """Extract root domain from URL, handling multi-level TLDs (#1)."""
    host = urlparse(url).netloc.lower().split(":")[0]
    host = host.removeprefix("www.")
    if not host or host.replace(".", "").isdigit():  # IP address
        return host
    parts = host.split(".")
    if len(parts) >= 3:
        candidate = ".".join(parts[-2:])
        if candidate in MULTI_LEVEL_TLDS:
            return ".".join(parts[-3:])
    if len(parts) >= 2:
        return ".".join(parts[-2:])
    return host


def is_parked_domain(url: str) -> bool:
    """Check if the URL's domain is a known parking service."""
    host = urlparse(url).netloc.lower().split(":")[0].removeprefix("www.")
    for pd in PARKING_DOMAINS:
        if host == pd or host.endswith("." + pd):
            return True
    return False


def is_html_content_type(content_type: str) -> bool:
    """Check if Content-Type indicates HTML (#11)."""
    ct = content_type.lower()
    return "text/html" in ct or "application/xhtml" in ct


async def check_url(
    session: aiohttp.ClientSession,
    url: str,
    read_body: bool = False,
    verify_ssl: bool = False,
) -> tuple[int | str, str, str, str]:
    """Return (status_code_or_error, final_url, body_snippet, content_type)."""
    try:
        ssl_ctx: bool = True if verify_ssl else False
        async with session.get(
            url,
            allow_redirects=True,
            timeout=aiohttp.ClientTimeout(total=TIMEOUT),
            ssl=ssl_ctx,
        ) as resp:
            body = ""
            content_type = resp.headers.get("Content-Type", "")
            if read_body and is_html_content_type(content_type):  # #11: only scan HTML
                raw = await resp.content.read(CONTENT_READ_LIMIT)
                try:
                    charset = resp.get_encoding() or "utf-8"
                except Exception:
                    charset = "utf-8"
                body = raw.decode(charset, errors="ignore")
            return resp.status, str(resp.url), body, content_type
    except asyncio.TimeoutError:
        return "timeout", url, "", ""
    except aiohttp.ClientError as e:
        return f"error:{type(e).__name__}", url, "", ""
    except Exception as e:
        return f"error:{type(e).__name__}", url, "", ""


def classify(url: str, status, final_url: str, body: str) -> tuple[str, str]:
    """Classify URL status. Returns (status_label, reason).

    status_label: "alive", "dead", "uncertain"
    """
    # Non-2xx/3xx
    if not (isinstance(status, int) and 200 <= status < 400):
        # Transport errors (timeout, connection) → uncertain, not dead
        if isinstance(status, str):
            return "uncertain", f"transport_{status}"
        # Anti-bot / auth wall → uncertain
        if status in UNCERTAIN_STATUS_CODES:
            return "uncertain", f"http_{status}"
        # Definitive dead: 404, 410, 500, 502, etc.
        return "dead", f"http_{status}"

    orig_root = get_root_domain(url)
    final_root = get_root_domain(final_url)

    # Check known parking domains
    if is_parked_domain(final_url):
        return "dead", f"parked:{final_root}"

    # Check domain mismatch
    if orig_root != final_root:
        if body and PARKING_CONTENT_PATTERNS.search(body):
            return "dead", f"expired_redirect:{final_root}"
        return "alive", f"redirect:{final_root}"

    # Same domain, check content for parking patterns
    if body and PARKING_CONTENT_PATTERNS.search(body):
        return "dead", "parked_content"

    return "alive", "ok"


async def process_one(
    sem: asyncio.Semaphore,
    session: aiohttp.ClientSession,
    url: str,
    idx: int,
    total: int,
) -> dict:
    # #6: skip non-HTTP(S) URLs
    scheme = urlparse(url).scheme.lower()
    if scheme in SKIP_SCHEMES or not scheme.startswith("http"):
        return {
            "url": url, "status": "skipped", "classification": "skipped",
            "final_url": url, "reason": f"non_http:{scheme}",
            "https_upgradable": False, "https_status": "", "https_url": "",
            "https_final_url": "", "recommendation": "skip",
        }

    async with sem:
        # https:// URLs: try with SSL verification first
        ssl_for_orig = url.startswith("https://")
        status, final_url, body, ct = await check_url(
            session, url, read_body=True, verify_ssl=ssl_for_orig
        )
        # Only treat as bad_cert if the error is SSL-specific, not timeout/network
        bad_cert = False
        if ssl_for_orig and isinstance(status, str) and ("SSL" in status or "Certificate" in status):
            status2, final_url2, body2, ct2 = await check_url(
                session, url, read_body=True, verify_ssl=False
            )
            if isinstance(status2, int) and 200 <= status2 < 400:
                status, final_url, body, ct = status2, final_url2, body2, ct2
                bad_cert = True
        # Transient retry for timeout/connection errors (both http and https)
        if isinstance(status, str) and ("timeout" in status or "Connector" in status):
            await asyncio.sleep(1)
            status, final_url, body, ct = await check_url(
                session, url, read_body=True, verify_ssl=False
            )

        classification, reason = classify(url, status, final_url, body)
        if bad_cert and classification == "alive":
            reason = f"bad_cert:{reason}"

        result = {
            "url": url,
            "status": status,
            "classification": classification,
            "final_url": final_url,
            "reason": reason,
            "https_upgradable": False,
            "https_status": "",
            "https_url": "",
            "https_final_url": "",
            "recommendation": "",
        }

        # bad_cert sites should not be "keep" — they need manual review
        if bad_cert:
            result["recommendation"] = "review"
            return result

        # For http:// URLs, try https:// (with SSL verification #2)
        if url.startswith("http://"):
            https_url = "https://" + url[7:]
            hs, hf, hb, hct = await check_url(
                session, https_url, read_body=True, verify_ssl=True
            )
            h_class, h_reason = classify(https_url, hs, hf, hb)
            result["https_status"] = hs

            if h_class == "alive":
                result["https_upgradable"] = True
                result["https_url"] = https_url  # deterministic scheme upgrade only
                result["https_final_url"] = hf   # actual landing page for reference
                result["recommendation"] = "upgrade_https"
            elif classification == "alive":
                result["recommendation"] = "keep"
            elif classification == "uncertain":
                result["recommendation"] = "review"
            else:
                result["recommendation"] = "delete"
        elif classification == "alive":
            result["recommendation"] = "keep"
        elif classification == "uncertain":
            result["recommendation"] = "review"
        else:
            result["recommendation"] = "delete"

        if (idx + 1) % 100 == 0 or idx + 1 == total:
            print(f"  [{idx + 1}/{total}] checked", file=sys.stderr)

        return result


async def main():
    urls = []
    skipped_input = 0
    with open(INPUT_TSV, newline="", encoding="utf-8-sig") as f:  # #6: handle BOM
        reader = csv.reader(f, delimiter="\t")
        for row in reader:
            if row:
                url = row[0].strip()
                if url:
                    urls.append(url)
                else:
                    skipped_input += 1

    total = len(urls)
    print(f"Loaded {total} URLs from {INPUT_TSV.name}", file=sys.stderr)
    if skipped_input:
        print(f"  Skipped {skipped_input} empty rows", file=sys.stderr)

    sem = asyncio.Semaphore(CONCURRENCY)
    connector = aiohttp.TCPConnector(
        limit=CONCURRENCY,
        limit_per_host=PER_HOST_LIMIT,  # #9: prevent hammering single host
    )
    headers = {"User-Agent": USER_AGENT}

    start = time.monotonic()
    async with aiohttp.ClientSession(connector=connector, headers=headers) as session:
        tasks = [process_one(sem, session, url, i, total) for i, url in enumerate(urls)]
        results = await asyncio.gather(*tasks)
    elapsed = time.monotonic() - start

    # Write results
    with open(OUTPUT_TSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f, delimiter="\t")
        writer.writerow([
            "url", "status", "classification", "reason", "final_url",
            "https_status", "https_upgradable", "https_url", "https_final_url",
            "recommendation",
        ])
        for r in results:
            writer.writerow([
                r["url"], r["status"], r["classification"], r["reason"],
                r["final_url"], r["https_status"], r["https_upgradable"],
                r["https_url"], r["https_final_url"], r["recommendation"],
            ])

    # Summary
    alive_count = sum(1 for r in results if r["classification"] == "alive")
    dead_count = sum(1 for r in results if r["classification"] == "dead")
    uncertain_count = sum(1 for r in results if r["classification"] == "uncertain")
    skipped_count = sum(1 for r in results if r["classification"] == "skipped")
    upgrade_count = sum(1 for r in results if r["https_upgradable"])
    delete_count = sum(1 for r in results if r["recommendation"] == "delete")
    review_count = sum(1 for r in results if r["recommendation"] == "review")
    redirect_count = sum(1 for r in results if r["reason"].startswith("redirect:"))
    parked_count = sum(
        1 for r in results if "parked" in r["reason"] or "expired" in r["reason"]
    )

    print(f"\nDone in {elapsed:.1f}s", file=sys.stderr)
    print(f"  Total:               {total}", file=sys.stderr)
    print(f"  Alive:               {alive_count}", file=sys.stderr)
    print(f"  Dead/Unreachable:    {dead_count}", file=sys.stderr)
    print(f"    Parked/Expired:    {parked_count}", file=sys.stderr)
    print(f"  Uncertain (review):  {uncertain_count} (403/429/anti-bot)", file=sys.stderr)
    print(f"  Skipped:             {skipped_count} (non-HTTP)", file=sys.stderr)
    print(f"  Domain redirected:   {redirect_count} (alive but different domain)", file=sys.stderr)
    print(f"  HTTPS upgradable:    {upgrade_count}", file=sys.stderr)
    print(f"  Recommend delete:    {delete_count}", file=sys.stderr)
    print(f"  Recommend review:    {review_count}", file=sys.stderr)
    print(f"  Report: {OUTPUT_TSV}", file=sys.stderr)


if __name__ == "__main__":
    asyncio.run(main())

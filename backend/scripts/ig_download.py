#!/usr/bin/env python3
"""
Instagram image/video downloader using curl_cffi with TLS impersonation.
Replaces gallery-dl for Instagram content by bypassing TLS fingerprint detection.

Usage:
  python3 ig_download.py <url> <output_dir> <cookies_file>

Output (JSON to stdout):
  {"success": true, "username": "...", "files": ["/path/to/file1.jpg", ...]}
  {"success": false, "error": "..."}

Exit code: 0 on success, 1 on failure.
"""

import sys
import os
import re
import json
import time
import hashlib
from http.cookiejar import MozillaCookieJar
from urllib.parse import unquote

try:
    from curl_cffi import requests as curl_requests
except ImportError:
    print(json.dumps({"success": False, "error": "curl_cffi not installed"}))
    sys.exit(1)


def load_cookies(cookies_path):
    """Load Netscape cookie file into a dict for curl_cffi."""
    jar = MozillaCookieJar(cookies_path)
    jar.load(ignore_discard=True, ignore_expires=True)
    cookies = {}
    for cookie in jar:
        if '.instagram.com' in (cookie.domain or ''):
            cookies[cookie.name] = cookie.value
    return cookies


def extract_shortcode(url):
    """Extract shortcode from Instagram URL."""
    # Handle various URL formats
    # https://www.instagram.com/p/XXXXX/
    # https://www.instagram.com/reel/XXXXX/
    # https://www.instagram.com/tv/XXXXX/
    # https://www.instagram.com/share/p/XXXXX/
    m = re.search(r'instagram\.com/(?:p|reel|tv|share/p)/([A-Za-z0-9_-]+)', url)
    if m:
        return m.group(1)
    # Try bare shortcode
    parts = url.rstrip('/').split('/')
    for part in reversed(parts):
        if re.match(r'^[A-Za-z0-9_-]{5,15}$', part) and '?' not in part:
            return part
    return None


def fetch_post_page(session, shortcode):
    """Fetch the Instagram post page and return the HTML."""
    url = f'https://www.instagram.com/p/{shortcode}/'
    headers = {
        'X-IG-App-ID': '936619743392459',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
    }
    r = session.get(url, headers=headers, allow_redirects=True)
    if r.status_code != 200:
        return None, f"HTTP {r.status_code}"
    # Check if redirected to login
    if 'accounts/login' in r.url:
        return None, "Redirected to login (session expired)"
    return r.text, None


def unescape_json(s):
    """Unescape JSON string escapes."""
    return unquote(s.replace('\\/', '/').replace('\\u0026', '&').replace('\\u00253D', '='))


def extract_post_data(html, shortcode):
    """Extract post metadata from the embedded HTML data."""
    result = {
        'username': 'unknown',
        'media_type': None,  # 1=image, 2=video, 8=carousel
        'items': [],  # list of {type: 'image'|'video', url: '...'}
    }

    # Extract username
    username_patterns = [
        r'"username"\s*:\s*"([^"]+)"',
        r'"owner"\s*:\s*\{[^}]*"username"\s*:\s*"([^"]+)"',
    ]
    for pat in username_patterns:
        m = re.search(pat, html)
        if m:
            result['username'] = m.group(1)
            break

    # Detect media_type from og:type
    og_type = re.search(r'<meta[^>]*property="og:type"[^>]*content="([^"]+)"', html)

    # Find all non-null carousel_media arrays
    carousel_arrays = []
    for m in re.finditer(r'"carousel_media"\s*:\s*\[', html):
        start = m.end() - 1
        depth = 0
        j = start
        while j < len(html):
            if html[j] == '[':
                depth += 1
            elif html[j] == ']':
                depth -= 1
                if depth == 0:
                    break
            j += 1
        arr_text = html[start:j + 1]
        if len(arr_text) > 10:  # Skip empty arrays "[]"
            carousel_arrays.append(arr_text)

    if carousel_arrays:
        # Pick the longest carousel array (most complete data)
        carousel_text = max(carousel_arrays, key=len)
        result['media_type'] = 8

        # Split by "image_versions2" or "video_versions" to find individual items
        # Each item starts with {"image_versions2":... or {"video_versions":...
        item_starts = list(re.finditer(r'\{(?:"image_versions2"|"video_versions")', carousel_text))

        for idx, item_match in enumerate(item_starts):
            item_start = item_match.start()
            if idx + 1 < len(item_starts):
                item_end = item_starts[idx + 1].start()
            else:
                item_end = len(carousel_text)
            item_text = carousel_text[item_start:item_end]

            # Check if this is a video item
            if '"video_versions"' in item_text:
                # Extract video URL - look for the first URL in video_versions
                vid_match = re.search(r'"video_versions"\s*:\s*\[(?:\{[^}]*?)?"url"\s*:\s*"([^"]+)"', item_text)
                if not vid_match:
                    vid_match = re.search(r'"url"\s*:\s*"(https[^"]+)"', item_text)
                if vid_match:
                    url = unescape_json(vid_match.group(1))
                    result['items'].append({'type': 'video', 'url': url})
                    continue

            # Image item - extract from image_versions2.candidates
            img_match = re.search(r'"image_versions2"\s*:\s*\{[^}]*"candidates"\s*:\s*\[(?:\{[^}]*?)?"url"\s*:\s*"([^"]+)"', item_text)
            if not img_match:
                # Fallback: just find any URL in the candidates
                img_match = re.search(r'"url"\s*:\s*"(https[^"]+)"', item_text)
            if img_match:
                url = unescape_json(img_match.group(1))
                result['items'].append({'type': 'image', 'url': url})

    # If no carousel found, try single post extraction
    if not result['items']:
        # Try og:video first (video post)
        og_video = re.search(r'<meta[^>]*property="og:video"[^>]*content="([^"]+)"', html)
        if og_video:
            result['items'].append({'type': 'video', 'url': unescape_json(og_video.group(1))})
            result['media_type'] = 2
        else:
            # Try image_versions2 candidates (single image post)
            img_block = re.search(r'"image_versions2"\s*:\s*\{[^}]*"candidates"\s*:\s*\[', html)
            if img_block:
                # Find the first URL in candidates
                url_match = re.search(r'"url"\s*:\s*"(https[^"]+)"', html[img_block.start():img_block.start() + 2000])
                if url_match:
                    result['items'].append({'type': 'image', 'url': unescape_json(url_match.group(1))})
                    result['media_type'] = 1

            # Fallback to og:image
            if not result['items']:
                og_image = re.search(r'<meta[^>]*property="og:image"[^>]*content="([^"]+)"', html)
                if og_image:
                    result['items'].append({'type': 'image', 'url': unescape_json(og_image.group(1))})
                    if result['media_type'] is None:
                        result['media_type'] = 1

    # Deduplicate by URL
    seen = set()
    unique_items = []
    for item in result['items']:
        if item['url'] not in seen:
            seen.add(item['url'])
            unique_items.append(item)
    result['items'] = unique_items

    return result


def download_media(session, items, output_dir):
    """Download media files and return list of file paths."""
    files = []
    for idx, item in enumerate(items):
        url = item['url']
        if not url:
            continue

        ext = 'mp4' if item['type'] == 'video' else 'jpg'
        # Try to detect extension from URL
        url_path = url.split('?')[0]
        for e in ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'webm']:
            if url_path.endswith(f'.{e}'):
                ext = e
                break

        filename = f'ig_{idx + 1}.{ext}'
        filepath = os.path.join(output_dir, filename)

        try:
            r = session.get(url, headers={
                'Referer': 'https://www.instagram.com/',
                'Accept': '*/*',
            }, timeout=60)
            if r.status_code == 200 and len(r.content) > 1000:
                with open(filepath, 'wb') as f:
                    f.write(r.content)
                files.append(filepath)
            else:
                print(f"Warning: Failed to download {url} (status={r.status_code}, size={len(r.content)})", file=sys.stderr)
        except Exception as e:
            print(f"Warning: Error downloading {url}: {e}", file=sys.stderr)

    return files


def main():
    if len(sys.argv) < 4:
        print(json.dumps({"success": False, "error": "Usage: ig_download.py <url> <output_dir> <cookies_file>"}))
        sys.exit(1)

    url = sys.argv[1]
    output_dir = sys.argv[2]
    cookies_file = sys.argv[3]

    # Validate
    shortcode = extract_shortcode(url)
    if not shortcode:
        print(json.dumps({"success": False, "error": f"Cannot extract shortcode from URL: {url}"}))
        sys.exit(1)

    if not os.path.exists(cookies_file):
        print(json.dumps({"success": False, "error": f"Cookies file not found: {cookies_file}"}))
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)

    # Load cookies
    try:
        cookies = load_cookies(cookies_file)
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Failed to load cookies: {e}"}))
        sys.exit(1)

    if 'sessionid' not in cookies:
        print(json.dumps({"success": False, "error": "No Instagram sessionid in cookies file"}))
        sys.exit(1)

    # Create session with Chrome impersonation
    session = curl_requests.Session(impersonate="chrome")
    for name, value in cookies.items():
        session.cookies.set(name, value, domain='.instagram.com')

    # Fetch post page
    html, err = fetch_post_page(session, shortcode)
    if err:
        print(json.dumps({"success": False, "error": f"Failed to fetch post: {err}"}))
        sys.exit(1)

    # Extract post data
    post_data = extract_post_data(html, shortcode)

    if not post_data['items']:
        print(json.dumps({"success": False, "error": "No media found in post", "username": post_data['username']}))
        sys.exit(1)

    # Download media
    files = download_media(session, post_data['items'], output_dir)

    if not files:
        print(json.dumps({"success": False, "error": "Download completed but no files saved", "username": post_data['username']}))
        sys.exit(1)

    # Output result
    result = {
        "success": True,
        "username": post_data['username'],
        "media_type": post_data['media_type'],
        "files": files,
    }
    print(json.dumps(result))
    sys.exit(0)


if __name__ == '__main__':
    main()

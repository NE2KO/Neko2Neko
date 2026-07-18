# Issue: Instagram Image Download Fails — "gallery-dl did not report an output file"

**Date:** 2026-06-20
**Severity:** High — Instagram image posts completely broken via gallery-dl fallback
**Affected:** All Instagram image/carousel posts (non-video) downloaded through gallery-dl fallback path

---

## Error Message

```
Image download completed, but gallery-dl did not report an output file
```

Displayed in the downloader UI as: **failed** — "Image download completed, but gallery-dl did not report an output file"

---

## Root Cause

**gallery-dl has a global download archive configured at `~/.config/gallery-dl/config.json`:**

```json
{
  "archive": "/home/CATIAA/Downloads/Y/archive.txt"
}
```

This archive file tracks all previously downloaded files. When gallery-dl encounters a URL whose file is **already recorded** in the archive, it:

1. **Skips the actual download** (file is NOT written to disk)
2. **Still prints the output path** via `--Print after:{_path}` (stdout shows the path as if it succeeded)
3. **Returns exit code 0** (success)

Our code in `manager.js` then:
1. Parses the stdout → finds valid file paths
2. Calls `scanDownloadDir()` as fallback → directory is **empty** (nothing was downloaded)
3. Both path resolution methods return `[]`
4. Triggers: `finishTask(task, 'failed', 'Image download completed, but gallery-dl did not report an output file')`

### Why video downloads via yt-dlp are NOT affected

yt-dlp does not use gallery-dl's archive system. Only the Instagram image fallback path (gallery-dl) is affected.

---

## Reproduction

```bash
# This FAILS — files are in the archive, nothing downloaded
gallery-dl --Print 'after:{_path}' --no-mtime --directory /tmp/test 'https://www.instagram.com/p/DZkh_rlTMat/'
# Output: # /tmp/test/3919407087377761965.jpg  (printed but NOT on disk)
# ls /tmp/test/ → empty

# This WORKS — archive is disabled
gallery-dl --no-mtime --Print 'after:{_path}' --download-archive /dev/null --directory /tmp/test 'https://www.instagram.com/p/DZkh_rlTMat/'
# Output: /tmp/test/3919407087377761965.jpg  (actually on disk)
# ls /tmp/test/ → 3919407087377761965.jpg  948235156708169.jpg
```

---

## Fix Applied

### 1. `backend/src/downloader/manager.js` (line 1217)

Added `--download-archive /dev/null` to gallery-dl args to override the global archive config:

```diff
- const imgArgs = ['--directory', imgDownloadDir, '--no-mtime', '--Print', 'after:{_path}'];
+ const imgArgs = ['--directory', imgDownloadDir, '--no-mtime', '--Print', 'after:{_path}', '--download-archive', '/dev/null'];
```

**Why `/dev/null`:** gallery-dl requires a value for `--download-archive`. Pointing it to `/dev/null` (a write-only device) causes a non-fatal warning but successfully prevents archive lookups, forcing an actual download.

### 2. `~/.config/gallery-dl/config.json` — NOT changed

Attempted `"archive": null` under `extractor.instagram` but this does **not** override the global archive. Only the CLI flag works.

---

## Why This Was Hard to Diagnose

1. **gallery-dl exit code was 0** — success, no error
2. **stdout contained valid file paths** — parsing worked correctly
3. **No stderr error** — archive skip is silent (no warning printed without `-v`)
4. **Only verbose mode (`-v`) reveals:** `Using download archive '/home/CATIAA/Downloads/Y/archive.txt'`
5. **The `--Print` flag prints paths regardless of whether download occurs** — it prints the *intended* path, not necessarily the *actual* file

---

## Prevention Measures

### Immediate
- [x] Added `--download-archive /dev/null` to gallery-dl invocation in `manager.js`
- [x] Documented this issue for future reference

### Long-term
- [ ] **Consider removing global archive from `~/.config/gallery-dl/config.json`** — the archive at `/home/CATIAA/Downloads/Y/archive.txt` was likely for manual gallery-dl usage and conflicts with programmatic usage
- [ ] **Add file existence check after gallery-dl finishes** — `scanDownloadDir()` already does this as a fallback, but the error message should be more descriptive (e.g., "gallery-dl skipped download (file may be in download archive)")
- [ ] **Log gallery-dl verbose output** — capture `-v` output to logs so archive-related skips are visible in the UI
- [ ] **For new Instagram posts, the archive should not cause issues** — the problem only occurs when the same URL was previously attempted/downloaded via gallery-dl

### Best Practice for gallery-dl Programmatic Usage
When using gallery-dl as a library/subprocess (not interactively), always pass:
```
--download-archive /dev/null
```
This prevents the global archive from interfering with programmatic downloads, regardless of what's configured in `~/.config/gallery-dl/config.json`.

---

## Testing

After fix, verify:
```bash
# 1. Download an image post that's already in the archive
gallery-dl --no-mtime --Print 'after:{_path}' --download-archive /dev/null --directory /tmp/test2 'https://www.instagram.com/p/DZkh_rlTMat/'
# Expected: files actually exist on disk

# 2. Verify the download manager handles it
# Trigger an Instagram image download via the UI → should complete successfully
```

---

## Related Files
- `backend/src/downloader/manager.js:1217` — gallery-dl args (fixed)
- `~/.config/gallery-dl/config.json` — global gallery-dl config with archive setting
- `/home/CATIAA/Downloads/Y/archive.txt` — the archive causing the skip

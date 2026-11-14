# Roadmap

## Done

- **P0–P1**: link capture, 115 push, directory picker, default directory, request scheduler, risk state.
- **P2**: persistent task queue, low-frequency polling, result-folder detection, task page, multi-tab sync.
- **P3**: name cleanup, junk classification, preview, batch delete, per-file rename, manual organize of any directory, resource modes, subtitle protection, series sample/extras rules.

## Next (P4 candidates)

1. **In-panel manual CAPTCHA**
   - Use `captchaapi.115.com` images + `webapi.115.com/user/captcha`.
   - Manual solving only; no OCR/auto-cracking.
   - Fallback to opening the 115 page remains.

2. **In-place selection pill**
   - The current build uses a top-right toast because the floating pill did not paint reliably in a fixed shadow host in headless Chromium.
   - Revisit with a different host/compositing approach or a small toolbar.

3. **Episode tools**
   - `S01E01` normalization from `E01` / `EP01` / `第01集`.
   - Season folder normalization (`Season 1` / `第一季` → `S01`).
   - Duplicate-episode resolution (keep the largest per episode).
   - Subtitle-to-episode pairing.

4. **Flatten / undo**
   - Flatten a single wrapper folder.
   - Undo renames from the task log.

5. **More input types**
   - HTTP/FTP direct links.
   - 115 share-link transfer.

6. **Optional local backend**
   - AList/OpenList adapter for directory listing/rename/delete, to reduce direct 115 API calls for power users.

7. **Compatibility**
   - Verify the new `clouddownload.115.com` task list and `lixianssp` batch-add API on a real account.
   - Enable `batch_rename` only after a verified field/response test.

## Non-goals

- Automated CAPTCHA cracking, device/UA spoofing, or retrying `911` without human verification.
- Bulk scraping or high-frequency account automation.
- Storing passwords or cookies.

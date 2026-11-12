# Changelog

All notable changes to this project are documented here. The format is inspired by [Keep a Changelog](https://keepachangelog.com/), and the project follows a `0.x` version scheme while the 115 endpoints are still being verified.

## [0.3.7] - 2026-11-12

### Changed

- Install/update URLs now use `ghproxy.net` (5-minute cache) instead of `raw.githubusercontent.com`, which is reset or blocked on some networks. `jsDelivr` is documented as a fallback.
- One-time reinstall/paste is required because older installed copies either have no `@updateURL` (manual paste) or still point to the blocked raw URL.

## [0.3.6] - 2026-11-12

### Fixed

- Tasks stuck in "检查中" after a tab reload/close, a hung request, or a risk cooldown are now recovered automatically: stale checks are reset to `pending` after 90 seconds, and a manual re-check can reset them after 10 seconds.
- Added a "重新检查" action for checking tasks.
- Added a polling watchdog that resets a stuck poll after 120 seconds so the queue can continue.

## [0.3.5] - 2026-11-12

### Fixed

- Post-push fast checks now use absolute deadlines from the push (1.5/3/5/8/12/18 seconds) instead of accumulating delays, so instant tasks are detected within the intended 15-second window.

## [0.3.4] - 2026-11-12

### Changed

- Post-push fast path: check at 1.5/3/5/8/12/18 seconds and run auto-organize immediately, aiming to finish simple instant tasks in about 10-15 seconds.
- If the task is not done during the 18-second burst, polling drops to every 10 minutes (configurable) instead of every 2 minutes.
- Faster organizer settling: 2 checks with a 1-second gap instead of 3 × 1.5 seconds; auto-apply delay reduced to 50 ms.
- Auto-organize toast now says "正在自动整理" instead of offering a preview action.

## [0.3.3] - 2026-11-12

### Added

- Automatic frequently-used directories: the top 3 are chosen by usage count, then by most recent use. Old manual favorites and recent paths are migrated automatically.
- Task filters: **未完成 / 已完成 / 全部**. The task page defaults to unfinished tasks; completed and ignored tasks are separated and can be cleared in one action.

### Changed

- Removed the manual "收藏当前" button from the directory picker.

## [0.3.2] - 2026-11-11

### Added

- Manual favorite directories (up to 3) below the "保存到" field.

## [0.3.1] - 2026-11-11

### Added

- Series mode deletes sample/trailer files by name, even when they are large (`sample`, `trailer`, `预告`, etc.).
- Series mode protects extras (`花絮`, `幕后`, `特典`, `featurette`, `extras`, etc.) by default.
- Settings for both behaviors.

## [0.3.0] - 2026-11-11

### Added

- Resource modes: 影视 / 剧集 / 音乐 / 软件·电子书 / 通用.
- Per-mode classification so music, software, ebooks, and mixed resources are not deleted by video-oriented rules.
- The preview shows the active mode.

## [0.2.3] - 2026-11-10

### Added

- Forced subtitle protection by default: large subtitles (`.sup`, `.pgs`), ad-named subtitles, subtitle archives, and subtitle-named `.txt` files are kept.
- "强制保留字幕" setting.

## [0.2.2] - 2026-11-10

### Added

- "按目录检查" button on unfinished tasks: force completion detection from the target-directory diff when 115's task status lags.
- Raw 115 status and percent on task cards.
- Cross-tab task synchronization through `GM_addValueChangeListener`.

### Changed

- Default polling interval: 2 minutes, with early checks at 30/90/180 seconds after a push.
- Long tasks back off to 5/15 minutes.
- Stronger leader-lock check for multi-tab polling.

## [0.2.1] - 2026-11-10

### Added

- Automatic switch to the task tab after a successful push.
- Early status checks after push.
- Task-title fallback shows `哈希 01bb…` instead of a raw 40-character info hash.

### Changed

- Faster organizer execution: shorter stability checks, batch gaps, and rename gaps.

## [0.2.0] - 2026-11-10

### Added

- Task queue with persistent state.
- Low-frequency task polling and result-folder detection (before/after diff).
- Organizer: name cleanup, junk classification, preview, batch delete, per-file rename, manual organize of any directory.
- Safety guards: largest-file protection, conservative mode, recycle bin, large-delete confirmation.

## [0.1.0] - 2026-11-10

### Added

- Tampermonkey userscript skeleton and settings.
- Magnet/ed2k detection from selection and clipboard.
- 115 sign/add-task client, directory picker, default directory.
- Serial request scheduler, hourly budget, push limits, `911`/`590075` handling.

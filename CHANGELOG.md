# Changelog

All notable changes to this project are documented here. The format is inspired by [Keep a Changelog](https://keepachangelog.com/), and the project follows a `0.x` version scheme while the 115 endpoints are still being verified.

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

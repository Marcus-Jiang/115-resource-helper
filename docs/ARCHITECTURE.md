# Architecture

This document describes the internal structure of `115-resource-helper.user.js` (v0.4.2). It is a single-file Tampermonkey userscript with no build step and no runtime dependencies.

## Data flow

```
selection / clipboard / panel input
        │
        ▼
Link.extract  ──►  UI.send
        │
        ├─ Queue.snapshot(target cid)        (1 APS list request)
        ├─ Pan115.getSign()                  (1 request)
        ├─ Pan115.addTask()                  (1 request)
        └─ Queue.add(task)                   (GM storage + early checks)
                    │
                    ▼
        Queue.poll (leader tab, 1.5/3/5/8/12/18s then 10 min)
                    │
                    ├─ Pan115.listTasks(page 1..3)
                    ├─ match by info hash / name
                    └─ completion:
                         task status done, or percentDone >= 100 + diff,
                         or "按目录检查"
                    │
                    ▼
        detect result (target folder before/after diff)
                    │
                    ▼
        Organizer.planFolder / planEntries
                    │
                    ▼
        UI preview (checkboxes, warnings)
                    │
                    ▼
        Organizer.apply
          ├─ delete junk in batches (recycle bin)
          ├─ rename files/subfolders one by one
          └─ rename result folder last
```

## Modules

| Module | Responsibility |
|---|---|
| `Store` | GM storage wrapper, defaults, settings migration |
| `Budget` | Hourly request counter shared by all 115 calls |
| `Risk` | `911` / `590075` / login-expired state, cross-tab sync, probe after verification |
| `Scheduler` | Serial request queue, minimum gap, jitter, pause/block |
| `rawRequest` / `api` | `GM_xmlhttpRequest` wrapper, JSON parsing, risk detection, budget |
| `Pan115` | Sign, offline add, task list, APS/webapi listing, path→cid, mkdir, rename, delete, move |
| `Link` | Magnet/ed2k extraction, dedupe, trim, base32→hex |
| `Name` | Ad-token cleanup, bracket handling, subtitle/sample/extra name detection |
| `Organizer` | Scan, classify, build plan, apply plan, safety guards |
| `Queue` | Persistent task queue, polling, completion detection, leader lock |
| `UI` | Shadow-DOM panel, picker, task list, preview, toasts, risk modal |

## Storage keys (Tampermonkey GM storage, prefix `rh115.`)

| Key | Content |
|---|---|
| `defaultPath`, `defaultCid` | Current target directory |
| `dirUsage` | Usage stats for automatic common directories |
| `tasks` | Up to 30 task records, including plans for `ready` tasks |
| `risk` | Current risk state and last 911 time |
| `budget` | Current hour request count |
| `pushLog` | Timestamps of pushes in the current hour |
| `pollLock` | Leader-tab lease for polling |
| `resourceMode`, `minVideoMB`, `keepRatio`, `minAudioMB`, `keepImages`, `keepNfo`, `keepSubtitles`, `deleteSamples`, `keepExtras` | Organizer rules |
| `autoOrganize`, `pollMinutes`, `mode`, `pushGapMs`, `pushPerHour`, `budgetPerHour` | Behavior settings |
| `favoritePaths`, `recentPaths` | Legacy; migrated into `dirUsage` |

## Request scheduling and risk control

- All 115 calls go through `Scheduler`, which enforces one in-flight request and a minimum gap (1.2s ± jitter in standard mode, 2.5s in low mode, 3s in manual mode).
- `Budget` limits the total to 300 requests/hour (configurable).
- Push spacing is 10 seconds and 20 pushes/hour by default.
- After a push, the tab that pushed takes the polling lock and checks 8 times in the first 9 seconds (0.7/1.5/2.5/3.6/4.8/6/7.5/9s), then at 15/25/40/60 seconds; if the task is still not done, polling drops to every 10 minutes.
- Fast checks keep running while the tab is hidden; slow polling still requires a visible leader tab. Returning to the tab forces a check immediately.
- `911` blocks the scheduler and opens a modal; the user verifies on 115, then `Risk.probe()` checks the sign endpoint. A 10-minute cooldown follows.
- `590075` pauses for 60 seconds.
- A leader tab owns `pollLock`; other tabs sync tasks through `GM_addValueChangeListener`.

## Organizer plan

A plan is a plain object:

```js
{
  kind: 'folder' | 'flat',
  mode: 'movie' | 'series' | 'music' | 'software' | 'generic',
  rootId, rootName, targetCid,
  folderRename: { fileId, oldName, newName, changed } | null,
  renames: [{ fileId, oldName, newName, changed, isFolder? }],
  junk: [{ id, name, size, isFolder, reason }],
  keeps: [...],
  stats: { files, keep, junk, totalBytes, junkBytes, keepBytes, rename },
  warnings: [{ code, text }],
  safe: boolean,
  wrap: { parentCid, name, ids[] } | null,  // flat results only
}
```

`Organizer.apply` deletes junk in batches of 20 files / 10 folders, falls back to per-item deletion on batch failure, then (for flat results) creates the `wrap` folder and moves the surviving files into it, renames files/subfolders one by one, and renames the result folder last. Deletions go to the 115 recycle bin.

## Safety model

- Preview is the default; auto-organize is opt-in.
- Subtitles are kept by default (including large PGS `.sup` and ad-named subtitles).
- The largest video/file is always kept; non-video resources use conservative mode.
- A plan with more than 50% of bytes or more than 100 items to delete requires a second confirmation; auto mode skips it.
- Rename/delete failures are recorded per item; the task summary shows counts.

## Testing

- `test/core.test.js` exercises pure functions: link parsing, name cleanup, classification, plans, modes, subtitle protection.
- `test/ui.html` stubs GM APIs and renders the panel, picker, task filters, and preview for visual checks.
- CI runs syntax checking and pure-function tests on Node 22.

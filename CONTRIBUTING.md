# Contributing

Thanks for helping improve 115 资源助手.

## Requirements

- Node.js >= 18 (Node 22 recommended)
- Tampermonkey 5.x in Edge/Chrome for manual UI tests
- No build step and no runtime dependencies

## Checks

```bash
npm run verify
# or
node --check 115-resource-helper.user.js
node test/core.test.js
```

## UI smoke test

Open `test/ui.html` in Edge. It stubs `GM_xmlhttpRequest`, so no real 115 requests are made.

Available views:

- `?view=panel` / `send` / `picker` / `settings`
- `?view=pill` — selection toast
- `?view=tasks` / `done` — task list filters
- `?view=preview` — organizer preview

There is no automated browser test in CI yet; the screenshots under `docs/images/` are generated from a demo page.

## Project layout

```
115-resource-helper.user.js   single-file userscript (no build)
test/core.test.js             pure-function tests (Node)
test/ui.html                  UI smoke page with fake GM APIs
docs/115-api.md               115 endpoint notes
docs/ARCHITECTURE.md          module and data-flow notes
docs/ROADMAP.md               planned work
docs/PUBLISHING.md            GitHub release checklist
scripts/set-repo.mjs          fill GitHub owner/repo placeholders
```

## Code guidelines

- Keep the project a **single userscript** with no runtime dependencies.
- All 115 requests must go through `api()` and `Scheduler`. Do not call `GM_xmlhttpRequest` directly for 115 endpoints.
- New 115 hosts must be added to `@connect`.
- Respect the request budget: no aggressive polling, no parallel 115 requests, and stop on `911` / `590075`.
- Put pure logic in `Name` / `Organizer` and cover it in `test/core.test.js`.
- UI text and comments are Chinese; code identifiers stay English.
- Any deletion must remain previewable. Keep the largest-file, subtitle, conservative-mode, and recycle-bin guards.

## Adding an organizer rule

1. Add a small pure helper in `Organizer` or `Name`.
2. Add a test with a minimal fake tree (name, size, parentId).
3. Decide which resource mode it applies to and its `reason` label.
4. Update `README.md` and, if the API behavior changes, `docs/115-api.md`.
5. Verify the item appears in the preview with a readable reason.

## Pull request checklist

- [ ] `npm run verify` passes
- [ ] New rules are covered by tests
- [ ] No cookies, credentials, personal paths, or private magnets
- [ ] `reference/` is not committed (it is gitignored)
- [ ] Documentation updated

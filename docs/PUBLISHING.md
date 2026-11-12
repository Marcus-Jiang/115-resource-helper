# Publishing to GitHub

This checklist prepares the repository for a public GitHub release. It does **not** push automatically.

## 0. Fill the repository placeholders

The userscript, `README.md`, and `package.json` contain `YOUR_GITHUB_USER` / `YOUR_REPO_NAME`.

```bash
node scripts/set-repo.mjs <github-user-or-org> [repo-name]
```

Default repo name: `115-resource-helper`. The script updates:

- Tampermonkey `@homepageURL`, `@supportURL`, `@updateURL`, `@downloadURL`
- Raw install URL in `README.md`
- `package.json` repository/bugs/homepage

## 1. Initialize and commit

```bash
git init -b main
git add -A
git status
git commit -m "chore: initial public release v0.3.5"
```

`reference/` is intentionally ignored: it contains third-party research scripts and must not be redistributed.

## 2. Create the GitHub repository

Create an **empty** repository (no README, no license, no .gitignore) with the same name, then:

```bash
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin main
```

## 3. Repository settings

- **Description**: `Tampermonkey userscript: magnet/ed2k to 115 cloud download, with low-risk request scheduling and a file organizer.`
- **Topics**: `tampermonkey`, `userscript`, `115`, `115wangpan`, `magnet`, `offline-download`, `media-organizer`
- Enable **Issues** and **Discussions** (optional).
- Enable **Actions** (the CI workflow runs syntax checks and unit tests).
- Set the default branch to `main`.

## 4. Release

```bash
git tag -a v0.3.5 -m "v0.3.5"
git push origin v0.3.5
```

Create a GitHub Release from the tag, using the `CHANGELOG.md` section. Suggested assets:

- `115-resource-helper.user.js` (optional; raw install is enough)

Install URL after release:

```
https://raw.githubusercontent.com/<owner>/<repo>/main/115-resource-helper.user.js
```

## 5. Post-release checks

- [ ] CI is green.
- [ ] Raw userscript URL opens and Tampermonkey shows the install page.
- [ ] The userscript version in the panel matches `package.json` / `CHANGELOG.md`.
- [ ] `@updateURL` / `@downloadURL` point to the real repository.
- [ ] The repository does **not** contain `reference/`, logs, screenshots from `test/`, or personal data.
- [ ] `LICENSE` and the author line are correct.

## Screenshots

`docs/images/` contains screenshots generated from `docs/demo.html` (fake data, no real 115 requests). Regenerate them if the UI changes:

1. Open `docs/demo.html?view=panel`, `?view=tasks`, `?view=preview` in Edge.
2. Take 1280×900 screenshots.
3. Save as `docs/images/panel.png`, `tasks.png`, `preview.png`.

## Notes

- The project uses a generic MIT copyright line (`115 Resource Helper contributors`). Replace it if you prefer a personal or organization name.
- Do not publish `reference/`; it contains third-party code collected for API research.
- Do not include real 115 cookies, task dumps, or personal folder names in issues, screenshots, or commit messages.

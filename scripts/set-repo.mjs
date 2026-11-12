#!/usr/bin/env node
// Fill GitHub owner/repo placeholders in the userscript, README, and package.json.
// Usage: node scripts/set-repo.mjs <github-user-or-org> [repo-name]
import fs from 'node:fs';
import path from 'node:path';

const [owner, repoArg] = process.argv.slice(2);
const repo = repoArg || '115-resource-helper';

if (!owner || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
  console.error('Usage: node scripts/set-repo.mjs <github-user-or-org> [repo-name]');
  process.exit(1);
}

const root = process.cwd();
const files = ['115-resource-helper.user.js', 'README.md', 'package.json'];
const replacements = [
  ['YOUR_GITHUB_USER', owner],
  ['YOUR_REPO_NAME', repo],
  ['<your-name>', owner],
  ['<repo>', repo],
];

for (const rel of files) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    console.warn('skip missing file:', rel);
    continue;
  }
  let text = fs.readFileSync(file, 'utf8');
  let changed = 0;
  for (const [from, to] of replacements) {
    if (text.includes(from)) {
      text = text.split(from).join(to);
      changed += 1;
    }
  }
  if (changed) {
    fs.writeFileSync(file, text);
    console.log('updated', rel);
  } else {
    console.log('no placeholders in', rel);
  }
}

const repoUrl = `https://github.com/${owner}/${repo}`;
const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/115-resource-helper.user.js`;
console.log(`\nRepository: ${repoUrl}`);
console.log(`Raw install: ${rawUrl}`);
console.log('\nNext:');
console.log('  git init -b main');
console.log('  git add -A');
console.log('  git commit -m "chore: initial public release"');

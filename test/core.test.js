// 纯函数测试：链接识别、规范化、目录条目归一化
// 运行：node test/core.test.js
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const script = fs.readFileSync(path.join(__dirname, '..', '115-resource-helper.user.js'), 'utf8');

const sandbox = {
  window: {},
  document: {
    readyState: 'loading',
    addEventListener() {},
  },
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  GM_getValue: () => undefined,
  GM_setValue: () => {},
  GM_deleteValue: () => {},
  GM_xmlhttpRequest: () => {},
  GM_registerMenuCommand: () => {},
  GM_addValueChangeListener: () => {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(script, sandbox, { filename: '115-resource-helper.user.js' });

const api = sandbox.window.__RH115__;
if (!api) throw new Error('脚本没有导出 __RH115__');
const { Link, Name, Organizer, normalizeEntry, base32ToHex } = api;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ok  ' + name);
  } catch (e) {
    console.error('FAIL  ' + name);
    console.error(e && e.stack || e);
    process.exitCode = 1;
  }
}

const USER_MAGNET = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567';

test('识别用户给的磁力链接', () => {
  const links = Link.extract(USER_MAGNET);
  assert.strictEqual(links.length, 1);
  assert.strictEqual(links[0].hash, '0123456789abcdef0123456789abcdef01234567');
  assert.strictEqual(links[0].type, 'magnet');
});

test('磁力链接去重', () => {
  const links = Link.extract(USER_MAGNET + '\n' + USER_MAGNET);
  assert.strictEqual(links.length, 1);
});

test('精简磁力链接只保留 xt 和 dn', () => {
  const raw = USER_MAGNET + '&dn=Example.Movie.2026.2160p&tr=udp%3A%2F%2Ftracker.example%3A80';
  const links = Link.extract(raw);
  assert.strictEqual(links.length, 1);
  assert.ok(links[0].url.startsWith('magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567'));
  assert.ok(links[0].url.includes('&dn=Example.Movie.2026.2160p'));
  assert.ok(!links[0].url.includes('tr='));
});

test('去掉链接尾部的中文标点', () => {
  const links = Link.extract('看看这个 ' + USER_MAGNET + '】');
  assert.strictEqual(links.length, 1);
  assert.strictEqual(links[0].hash, '0123456789abcdef0123456789abcdef01234567');
});

test('识别 ed2k 链接', () => {
  const ed2k = 'ed2k://|file|Some.Movie.2024.1080p.mkv|1234567890|0123456789abcdef0123456789abcdef|/';
  const links = Link.extract(ed2k);
  assert.strictEqual(links.length, 1);
  assert.strictEqual(links[0].type, 'ed2k');
  assert.strictEqual(links[0].hash, '0123456789abcdef0123456789abcdef');
  assert.strictEqual(links[0].name, 'Some.Movie.2024.1080p.mkv');
});

test('32 位 base32 info hash 转 40 位 hex', () => {
  const hex = base32ToHex('MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U');
  assert.strictEqual(hex.length, 40);
  assert.ok(/^[0-9a-f]{40}$/.test(hex));
});

test('普通文本不识别', () => {
  assert.strictEqual(Link.extract('这不是磁力链接').length, 0);
});

test('目录条目：文件', () => {
  const e = normalizeEntry({ fid: '123', cid: '1', n: 'a.mkv', s: '1024', pc: 'abc' });
  assert.strictEqual(e.isFolder, false);
  assert.strictEqual(e.id, '123');
  assert.strictEqual(e.name, 'a.mkv');
  assert.strictEqual(e.size, 1024);
  assert.strictEqual(e.pickcode, 'abc');
});

test('目录条目：文件夹（无 fid）', () => {
  const e = normalizeEntry({ cid: '456', n: '电影' });
  assert.strictEqual(e.isFolder, true);
  assert.strictEqual(e.id, '456');
  assert.strictEqual(e.name, '电影');
});

test('目录条目：文件夹（fid 为 0）', () => {
  const e = normalizeEntry({ fid: '0', cid: '789', n: '剧集' });
  assert.strictEqual(e.isFolder, true);
  assert.strictEqual(e.id, '789');
});

test('目录条目：APS 风格字段', () => {
  const e = normalizeEntry({ file_id: '999', file_name: 'x.mp4', file_size: 2048 });
  assert.strictEqual(e.isFolder, false);
  assert.strictEqual(e.id, '999');
  assert.strictEqual(e.name, 'x.mp4');
  assert.strictEqual(e.size, 2048);
});

// ---- 名称清洗 ----

test('清洗示例文件夹名', () => {
  const raw = '【示例站发布 www.example.com】示例电影[简繁英字幕].Example.Movie.2026.2160p.NF.WEB-DL.DDP.5.1.Atmos.H.265-DreamHD';
  assert.strictEqual(
    Name.clean(raw),
    '示例电影[简繁英字幕].Example.Movie.2026.2160p.NF.WEB-DL.DDP.5.1.Atmos.H.265-DreamHD'
  );
});

test('保留有意义的方括号', () => {
  assert.strictEqual(Name.clean('片名.2024.1080p.[国语中字].mkv'), '片名.2024.1080p.[国语中字].mkv');
});

test('去掉无域名的广告括号', () => {
  assert.strictEqual(Name.clean('【更多资源】片名.2024.1080p.mkv'), '片名.2024.1080p.mkv');
});

test('去掉广告域名括号但保留字幕标签', () => {
  assert.strictEqual(Name.clean('[简繁字幕 www.example.com]片名.mkv'), '[简繁字幕]片名.mkv');
});

test('纯广告文件名清洗后为空', () => {
  const ad = '【更多无水印高品质资源请访问 www.example.com】【更多无水印高品质资源请访问 www.example.com】';
  assert.strictEqual(Name.cleanFileName(ad + '.MP4'), '');
  assert.strictEqual(Name.cleanFileName(ad + '.DOC'), '');
});

test('普通文件名不受影响', () => {
  assert.strictEqual(
    Name.cleanFileName('Example.Movie.2026.2160p.NF.WEB-DL.DDP.5.1.Atmos.H.265-DreamHD.mkv'),
    'Example.Movie.2026.2160p.NF.WEB-DL.DDP.5.1.Atmos.H.265-DreamHD.mkv'
  );
});

// ---- 整理计划 ----

test('整理计划：示例目录树', () => {
  const root = {
    id: '100',
    name: '【示例站发布 www.example.com】示例电影[简繁英字幕].Example.Movie.2026.2160p.NF.WEB-DL.DDP.5.1.Atmos.H.265-DreamHD',
    children: [
      { id: '1', isFolder: false, name: '【更多无水印高品质资源请访问 www.example.com】【更多无水印高品质资源请访问 www.example.com】.MP4', size: 300 * 1024, parentId: '100', children: [] },
      { id: '2', isFolder: false, name: '【更多无水印高品质资源请访问 www.example.com】【更多无水印高品质资源请访问 www.example.com】.MKV', size: 400 * 1024, parentId: '100', children: [] },
      { id: '3', isFolder: false, name: '【更多无水印高品质资源请访问 www.example.com】【更多无水印高品质资源请访问 www.example.com】.DOC', size: 200 * 1024, parentId: '100', children: [] },
      { id: '4', isFolder: false, name: 'Example.Movie.2026.2160p.NF.WEB-DL.DDP.5.1.Atmos.H.265-DreamHD.mkv', size: 21 * 1024 * 1024 * 1024, parentId: '100', children: [] },
    ],
  };
  const plan = Organizer.planTree(root, { rootName: root.name, minVideoMB: 100, keepRatio: 1 });
  assert.strictEqual(plan.stats.keep, 1);
  assert.strictEqual(plan.stats.junk, 3);
  assert.ok(plan.keeps.some((x) => x.name.endsWith('.mkv')));
  assert.ok(plan.junk.some((x) => x.name.endsWith('.DOC')));
  assert.ok(plan.folderRename, '应该有文件夹改名');
  assert.strictEqual(
    plan.folderRename.newName,
    '示例电影[简繁英字幕].Example.Movie.2026.2160p.NF.WEB-DL.DDP.5.1.Atmos.H.265-DreamHD'
  );
  assert.strictEqual(plan.renames.length, 0);
});

test('整理计划：保留字幕和大视频', () => {
  const entries = [
    { id: '10', isFolder: false, name: 'Movie.2024.1080p.mkv', size: 8 * 1024 * 1024 * 1024 },
    { id: '11', isFolder: false, name: 'Movie.2024.1080p.chs.srt', size: 80 * 1024 },
  ];
  const plan = Organizer.planEntries(entries, { minVideoMB: 100, keepRatio: 1 });
  assert.strictEqual(plan.stats.keep, 2);
  assert.strictEqual(plan.stats.junk, 0);
});

test('整理计划：最大文件永远不被删', () => {
  const entries = [
    { id: '20', isFolder: false, name: 'Movie.mkv', size: 10 * 1024 * 1024 * 1024 },
    { id: '21', isFolder: false, name: 'sample.mkv', size: 50 * 1024 * 1024 },
  ];
  const plan = Organizer.planEntries(entries, { minVideoMB: 100, keepRatio: 1 });
  assert.ok(plan.keeps.some((x) => x.id === '20'));
  assert.ok(plan.junk.some((x) => x.id === '21'));
});

test('整理计划：广告子目录整体删除', () => {
  const root = {
    id: '1', name: 'Movie', children: [
      { id: '2', isFolder: true, name: '【更多资源】', parentId: '1', children: [
        { id: '3', isFolder: false, name: 'ad.txt', size: 100, parentId: '2', children: [] },
      ] },
      { id: '4', isFolder: false, name: 'Movie.mkv', size: 5 * 1024 * 1024 * 1024, parentId: '1', children: [] },
    ],
  };
  const plan = Organizer.planTree(root, { rootName: 'Movie', minVideoMB: 100, keepRatio: 1 });
  assert.ok(plan.junk.some((x) => x.name === '【更多资源】' && x.isFolder));
  assert.ok(!plan.junk.some((x) => x.name === 'ad.txt'));
});

test('整理计划：子文件夹改名', () => {
  const root = {
    id: '1', name: 'Movie', children: [
      { id: '2', isFolder: true, name: '【更多资源】Subs', parentId: '1', children: [
        { id: '3', isFolder: false, name: 'Movie.chs.srt', size: 1000, parentId: '2', children: [] },
      ] },
      { id: '4', isFolder: false, name: 'Movie.mkv', size: 5 * 1024 * 1024 * 1024, parentId: '1', children: [] },
    ],
  };
  const plan = Organizer.planTree(root, { rootName: 'Movie', minVideoMB: 100, keepRatio: 1 });
  assert.ok(plan.renames.some((x) => x.isFolder && x.oldName === '【更多资源】Subs' && x.newName === 'Subs'));
});

test('整理计划：非视频资源走保守模式', () => {
  const entries = [
    { id: '30', isFolder: false, name: 'setup.exe', size: 500 * 1024 * 1024 },
    { id: '31', isFolder: false, name: 'readme.txt', size: 1024 },
    { id: '32', isFolder: false, name: '【更多资源】.txt', size: 100 },
  ];
  const plan = Organizer.planEntries(entries, { minVideoMB: 100, keepRatio: 1 });
  assert.ok(plan.keeps.some((x) => x.id === '30'));
  assert.ok(plan.keeps.some((x) => x.id === '31'));
  assert.ok(plan.junk.some((x) => x.id === '32'));
});

test('整理计划：最大视频即使文件名是广告也保留', () => {
  const entries = [
    { id: '40', isFolder: false, name: '【更多资源】.mkv', size: 10 * 1024 * 1024 * 1024 },
    { id: '41', isFolder: false, name: '【更多资源】.txt', size: 100 },
  ];
  const plan = Organizer.planEntries(entries, { minVideoMB: 100, keepRatio: 1 });
  assert.ok(plan.keeps.some((x) => x.id === '40'));
  assert.ok(plan.junk.some((x) => x.id === '41'));
});

test('整理计划：大字幕文件也保留（PGS/Sup）', () => {
  const entries = [
    { id: '50', isFolder: false, name: 'Movie.mkv', size: 10 * 1024 * 1024 * 1024 },
    { id: '51', isFolder: false, name: 'Movie.sup', size: 200 * 1024 * 1024 },
  ];
  const plan = Organizer.planEntries(entries, { minVideoMB: 100, keepRatio: 1 });
  assert.ok(plan.keeps.some((x) => x.id === '51'));
});

test('整理计划：广告名字幕也保留', () => {
  const entries = [
    { id: '60', isFolder: false, name: 'Movie.mkv', size: 10 * 1024 * 1024 * 1024 },
    { id: '61', isFolder: false, name: '【更多资源】.srt', size: 100 * 1024 },
  ];
  const plan = Organizer.planEntries(entries, { minVideoMB: 100, keepRatio: 1 });
  assert.ok(plan.keeps.some((x) => x.id === '61'));
});

test('整理计划：字幕压缩包保留，小压缩包仍删除', () => {
  const entries = [
    { id: '70', isFolder: false, name: 'Movie.mkv', size: 10 * 1024 * 1024 * 1024 },
    { id: '71', isFolder: false, name: 'Subs.rar', size: 2 * 1024 * 1024 },
    { id: '72', isFolder: false, name: 'sample.zip', size: 2 * 1024 * 1024 },
  ];
  const plan = Organizer.planEntries(entries, { minVideoMB: 100, keepRatio: 1 });
  assert.ok(plan.keeps.some((x) => x.id === '71'));
  assert.ok(plan.junk.some((x) => x.id === '72'));
});

test('整理计划：字幕命名的 txt 也保留', () => {
  const entries = [
    { id: '80', isFolder: false, name: 'Movie.mkv', size: 10 * 1024 * 1024 * 1024 },
    { id: '81', isFolder: false, name: 'Movie.chs.txt', size: 100 * 1024 },
    { id: '82', isFolder: false, name: 'ad.txt', size: 100 },
  ];
  const plan = Organizer.planEntries(entries, { minVideoMB: 100, keepRatio: 1 });
  assert.ok(plan.keeps.some((x) => x.id === '81'));
  assert.ok(plan.junk.some((x) => x.id === '82'));
});

// ---- 资源模式 ----

test('资源模式：通用只清广告名', () => {
  const entries = [
    { id: '90', isFolder: false, name: 'setup.exe', size: 500 * 1024 * 1024 },
    { id: '91', isFolder: false, name: '【更多资源】.txt', size: 100 },
    { id: '92', isFolder: false, name: 'Movie.mkv', size: 100 * 1024 * 1024 },
  ];
  const plan = Organizer.planEntries(entries, { mode: 'generic' });
  assert.ok(plan.keeps.some((x) => x.id === '90'));
  assert.ok(plan.keeps.some((x) => x.id === '92'));
  assert.ok(plan.junk.some((x) => x.id === '91'));
});

test('资源模式：软件/电子书保留 exe，只清小广告页', () => {
  const entries = [
    { id: '100', isFolder: false, name: 'setup.exe', size: 500 * 1024 * 1024 },
    { id: '101', isFolder: false, name: 'readme.txt', size: 1024 },
    { id: '102', isFolder: false, name: '官方.html', size: 100 },
    { id: '103', isFolder: false, name: '【更多资源】.url', size: 100 },
  ];
  const plan = Organizer.planEntries(entries, { mode: 'software' });
  assert.ok(plan.keeps.some((x) => x.id === '100'));
  assert.ok(plan.keeps.some((x) => x.id === '101'));
  assert.ok(plan.junk.some((x) => x.id === '102'));
  assert.ok(plan.junk.some((x) => x.id === '103'));
});

test('资源模式：音乐保留音频和封面', () => {
  const entries = [
    { id: '110', isFolder: false, name: 'track.flac', size: 5 * 1024 * 1024 },
    { id: '111', isFolder: false, name: 'cover.jpg', size: 500 * 1024 },
    { id: '112', isFolder: false, name: '【更多资源】.txt', size: 100 },
    { id: '113', isFolder: false, name: 'MV.mkv', size: 100 * 1024 * 1024 },
  ];
  const plan = Organizer.planEntries(entries, { mode: 'music' });
  assert.ok(plan.keeps.some((x) => x.id === '110'));
  assert.ok(plan.keeps.some((x) => x.id === '111'));
  assert.ok(plan.keeps.some((x) => x.id === '113'));
  assert.ok(plan.junk.some((x) => x.id === '112'));
});

test('资源模式：剧集保留较小的一集，影视模式按比例删', () => {
  const entries = [
    { id: '120', isFolder: false, name: 'S01E01.mkv', size: 20 * 1024 * 1024 * 1024 },
    { id: '121', isFolder: false, name: 'S01E02.mkv', size: 150 * 1024 * 1024 },
    { id: '122', isFolder: false, name: 'sample.mkv', size: 10 * 1024 * 1024 },
  ];
  const movie = Organizer.planEntries(entries, { mode: 'movie', minVideoMB: 100, keepRatio: 1 });
  const series = Organizer.planEntries(entries, { mode: 'series', minVideoMB: 100, keepRatio: 1 });
  assert.ok(movie.junk.some((x) => x.id === '121'));
  assert.ok(series.keeps.some((x) => x.id === '121'));
  assert.ok(series.junk.some((x) => x.id === '122'));
});

test('剧集优化：按名字删除超大样片/预告', () => {
  const entries = [
    { id: '130', isFolder: false, name: 'S01E01.mkv', size: 5 * 1024 * 1024 * 1024 },
    { id: '131', isFolder: false, name: 'S01E01.sample.mkv', size: 2 * 1024 * 1024 * 1024 },
    { id: '132', isFolder: false, name: 'Trailer.mkv', size: 1 * 1024 * 1024 * 1024 },
  ];
  const plan = Organizer.planEntries(entries, { mode: 'series', minVideoMB: 100, keepRatio: 1 });
  assert.ok(plan.keeps.some((x) => x.id === '130'));
  assert.ok(plan.junk.some((x) => x.id === '131'));
  assert.ok(plan.junk.some((x) => x.id === '132'));
});

test('剧集优化：花絮默认保留，影视模式按样片处理', () => {
  const entries = [
    { id: '140', isFolder: false, name: 'S01E01.mkv', size: 5 * 1024 * 1024 * 1024 },
    { id: '141', isFolder: false, name: '花絮.mkv', size: 90 * 1024 * 1024 },
  ];
  const series = Organizer.planEntries(entries, { mode: 'series', minVideoMB: 100, keepRatio: 1 });
  const movie = Organizer.planEntries(entries, { mode: 'movie', minVideoMB: 100, keepRatio: 1 });
  assert.ok(series.keeps.some((x) => x.id === '141'));
  assert.ok(movie.junk.some((x) => x.id === '141'));
});

test('剧集优化：关掉删样片后不按名字删', () => {
  const entries = [
    { id: '150', isFolder: false, name: 'Sample.mkv', size: 2 * 1024 * 1024 * 1024 },
  ];
  const plan = Organizer.planEntries(entries, { mode: 'series', deleteSamples: false });
  assert.ok(plan.keeps.some((x) => x.id === '150'));
});

console.log(`\n${passed} 项通过${process.exitCode ? '，有失败' : ''}`);

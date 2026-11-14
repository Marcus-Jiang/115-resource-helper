// ==UserScript==
// @name         115 资源助手
// @namespace    https://github.com/115-resource-helper
// @version      0.4.2
// @description  选中/复制磁力链接，一键推送到 115 云下载；低风控请求调度；下载完成后整理文件名与垃圾文件
// @author       115 Resource Helper contributors
// @license      MIT
// @homepageURL  https://github.com/Marcus-Jiang/115-resource-helper
// @supportURL   https://github.com/Marcus-Jiang/115-resource-helper/issues
// @updateURL    https://ghproxy.net/https://raw.githubusercontent.com/Marcus-Jiang/115-resource-helper/main/115-resource-helper.user.js
// @downloadURL  https://ghproxy.net/https://raw.githubusercontent.com/Marcus-Jiang/115-resource-helper/main/115-resource-helper.user.js
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_addValueChangeListener
// @grant        GM_notification
// @connect      115.com
// @connect      webapi.115.com
// @connect      aps.115.com
// @connect      lixian.115.com
// @connect      captchaapi.115.com
// @connect      my.115.com
// @connect      api.github.com
// @connect      cdn.jsdelivr.net
// @connect      ghproxy.net
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const NS = 'rh115';
  const VERSION = '0.4.2';

  const API = {
    sign:          'https://115.com/?ct=offline&ac=space',
    add:           'https://115.com/web/lixian/?ct=lixian&ac=add_task_url',
    tasks:         'https://115.com/web/lixian/?ct=lixian&ac=task_lists',
    listAps:       'https://aps.115.com/natsort/files.php',
    listWeb:       'https://webapi.115.com/files',
    getid:         'https://webapi.115.com/files/getid',
    mkdir:         'https://webapi.115.com/files/add',
    renameOne:     'https://webapi.115.com/files/edit',
    renameMany:    'https://webapi.115.com/files/batch_rename',
    del:           'https://webapi.115.com/rb/delete',
    move:          'https://webapi.115.com/files/move',
    nav:           'https://my.115.com/?ct=ajax&ac=nav',
    captchaAll:    'https://captchaapi.115.com/?ct=index&ac=code&t=all',
    captchaCode:   'https://captchaapi.115.com/?ct=index&ac=code',
    captchaSign:   'https://captchaapi.115.com/?ac=code&t=sign',
    captchaVerify: 'https://webapi.115.com/user/captcha',
  };

  const REPO = 'Marcus-Jiang/115-resource-helper';
  const RAW_URL = `https://raw.githubusercontent.com/${REPO}/main/115-resource-helper.user.js`;
  const PROXY_URL = `https://ghproxy.net/${RAW_URL}`;
  const JSDELIVR_URL = `https://cdn.jsdelivr.net/gh/${REPO}@latest/115-resource-helper.user.js`;
  const UPDATE_SOURCES = [
    { name: 'GitHub API', url: `https://api.github.com/repos/${REPO}/contents/115-resource-helper.user.js`, api: true, install: PROXY_URL },
    { name: 'ghproxy', url: PROXY_URL, install: PROXY_URL },
    { name: 'jsDelivr', url: JSDELIVR_URL, install: JSDELIVR_URL },
  ];

  // ---------------------------------------------------------------- utils

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (min, max) => min + Math.random() * (max - min);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const now = () => Date.now();

  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    const units = ['KB', 'MB', 'GB', 'TB'];
    let i = -1;
    do { n /= 1024; i += 1; } while (n >= 1024 && i < units.length - 1);
    return n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2) + ' ' + units[i];
  }

  function fmtAgo(ts) {
    const d = now() - (Number(ts) || 0);
    if (!d || d < 0) return '';
    if (d < 60 * 1000) return '刚刚';
    if (d < 3600 * 1000) return Math.floor(d / 60000) + ' 分钟前';
    if (d < 86400 * 1000) return Math.floor(d / 3600000) + ' 小时前';
    return Math.floor(d / 86400000) + ' 天前';
  }

  function isHashLike(s) {
    return /^[a-f0-9]{32,40}$/i.test(String(s || '').trim());
  }

  function cmpVer(a, b) {
    const pa = String(a || '').split('.').map((x) => Number(x) || 0);
    const pb = String(b || '').split('.').map((x) => Number(x) || 0);
    const n = Math.max(pa.length, pb.length);
    for (let i = 0; i < n; i += 1) {
      const x = pa[i] || 0;
      const y = pb[i] || 0;
      if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
  }

  // 115 任务列表里的原始状态码（老接口 status，新接口 stat）
  const REMOTE_STATE = {
    '-1': '失败',
    0: '等待下载',
    1: '下载中',
    2: '已完成',
    3: '失败',
    9: '失败',
    10: '已完成',
    11: '已完成',
    12: '进行中',
  };

  const TASK_STATUS = {
    pending: '等待下载',
    checking: '检查中',
    ready: '待整理',
    organizing: '整理中',
    organized: '已整理',
    failed: '失败',
    timeout: '超时',
    ignored: '已忽略',
  };

  const MODE_LABEL = { movie: '影视', series: '剧集', music: '音乐', software: '软件/电子书', generic: '通用' };

  const REASON_LABEL = {
    sample: '小视频',
    'junk-ext': '垃圾扩展名',
    image: '图片',
    'ad-name': '广告名',
    'small-audio': '小音频',
    'big-subtitle': '过大字幕',
    'small-archive': '小压缩包',
    'subtitle-archive': '字幕压缩包',
    'subtitle-name': '字幕文件',
    'ad-file': '广告快捷方式',
    'sample-name': '样片/预告',
    extra: '花絮/特典',
    generic: '通用保留',
    music: '音乐',
    software: '软件/电子书',
    'junk-folder': '广告目录',
    'empty-folder': '空目录',
    'all-junk': '全是垃圾',
    'no-video': '无视频',
  };

  function debounce(fn, ms) {
    let t = 0;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function h(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.startsWith('on') && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else node.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const c of children.flat(Infinity)) {
      if (c === undefined || c === null || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  function hourKey() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}-${d.getHours()}`;
  }

  function log(...args) {
    try { console.debug('[115助手]', ...args); } catch (_) {}
  }

  // ---------------------------------------------------------------- store

  const DEFAULTS = {
    defaultPath: '',
    defaultCid: '',
    recentPaths: [],
    mode: 'standard',        // standard | low | manual
    pushGapMs: 10000,
    pushPerHour: 20,
    budgetPerHour: 300,
    trimMagnet: true,
    copyToast: true,
    ballPos: null,
    firstRun: true,
    risk: { state: 'normal', until: 0, last911: 0, message: '' },
    budget: { k: '', n: 0 },
    pushLog: [],
    tasks: [],
    pollMinutes: 10,
    autoOrganize: false,
    minVideoMB: 100,
    keepRatio: 1,
    minAudioMB: 20,
    keepImages: false,
    keepNfo: false,
    keepSubtitles: true,
    resourceMode: 'movie',
    favoritePaths: [],
    dirUsage: {},
    dirUsageMigrated: false,
    deleteSamples: true,
    keepExtras: true,
    pollLock: null,
  };

  const Store = {
    key(k) { return NS + '.' + k; },
    get(k, dflt) {
      const fallback = dflt !== undefined ? dflt : DEFAULTS[k];
      try {
        const v = GM_getValue(this.key(k), undefined);
        return v === undefined ? fallback : v;
      } catch (_) {
        return fallback;
      }
    },
    set(k, v) {
      try { GM_setValue(this.key(k), v); } catch (_) {}
    },
    del(k) {
      try { GM_deleteValue(this.key(k)); } catch (_) {}
    },
  };

  // ---------------------------------------------------------------- risk

  const Risk = {
    state: null,
    init() {
      this.state = Store.get('risk', { state: 'normal', until: 0, last911: 0, message: '' });
      try {
        GM_addValueChangeListener(Store.key('risk'), (_n, _o, v, remote) => {
          if (!remote) return;
          this.state = v || { state: 'normal', until: 0, last911: 0, message: '' };
          this.applyToScheduler();
          if (UI.ready) UI.refreshRisk();
        });
      } catch (_) {}
      this.applyToScheduler();
    },
    applyToScheduler() {
      const st = this.current;
      if (st.state === 'verify') {
        Scheduler.block('115 要求人机验证');
      } else if (st.state === 'auth') {
        Scheduler.block('115 登录已失效');
      } else {
        Scheduler.unblock();
        if (st.state === 'busy' && Number(st.until) > now()) {
          Scheduler.pause(Number(st.until) - now(), '操作太频繁');
        }
      }
    },
    get current() { return this.state || { state: 'normal', until: 0, last911: 0, message: '' }; },
    set(state, message, until) {
      this.state = {
        state,
        message: message || '',
        until: Number(until) || 0,
        last911: state === 'verify' ? now() : (this.current.last911 || 0),
      };
      Store.set('risk', this.state);
      if (UI.ready) UI.refreshRisk();
    },
    clear() {
      this.state = { state: 'normal', until: 0, last911: this.current.last911 || 0, message: '' };
      Store.set('risk', this.state);
      if (UI.ready) UI.refreshRisk();
      Scheduler.unblock();
    },
    blocked() {
      const s = this.current.state;
      return s === 'verify' || s === 'auth';
    },
    async probe() {
      // 绕过调度器，只发一次轻量请求确认登录/验证是否恢复
      try {
        const res = await rawRequest({
          method: 'GET',
          url: API.sign + '&_=' + now(),
          headers: {
            Accept: 'application/json, text/plain, */*',
            Referer: 'https://115.com/?tab=offline&mode=wangpan',
          },
        });
        if (res.json && res.json.sign && res.json.time) {
          Pan115._sign = null;
          this.clear();
          Scheduler.pause(10 * 60 * 1000, '验证后冷却');
          if (UI.ready) UI.toast('验证通过，已恢复（冷却 10 分钟）', 'success');
          return true;
        }
      } catch (_) {}
      if (UI.ready) UI.toast('仍未通过验证，请先在 115 页面完成人机验证', 'error');
      return false;
    },
  };

  // ---------------------------------------------------------------- budget

  class BudgetError extends Error {
    constructor(message) {
      super(message);
      this.name = 'BudgetError';
    }
  }

  const Budget = {
    limit() { return Math.max(50, Number(Store.get('budgetPerHour', 300)) || 300); },
    used() {
      const b = Store.get('budget', { k: '', n: 0 });
      return b && b.k === hourKey() ? Number(b.n) || 0 : 0;
    },
    take() {
      const k = hourKey();
      let b = Store.get('budget', { k: '', n: 0 });
      if (!b || b.k !== k) b = { k, n: 0 };
      const limit = this.limit();
      if (b.n >= limit) {
        throw new BudgetError(`本小时 115 请求已达上限（${limit} 次），整点自动恢复；可在设置里调高预算或点「重置计数」`);
      }
      b.n += 1;
      Store.set('budget', b);
      if (b.n === limit && UI.ready) {
        UI.toast(`本小时 115 请求已达上限（${limit} 次），整点自动恢复`, 'warn', { timeout: 8000 });
      }
      if (b.n === Math.ceil(limit * 0.7) && UI.ready) {
        UI.toast(`本小时 115 请求已用 ${b.n}/${limit}`, 'warn');
      }
      return b.n;
    },
    reset() { Store.set('budget', { k: hourKey(), n: 0 }); },
  };

  // ---------------------------------------------------------------- http

  class RiskError extends Error {
    constructor(risk) {
      super(risk.message || '115 风控拦截');
      this.name = 'RiskError';
      this.risk = risk;
    }
  }

  function parseRisk(json, text) {
    if (!json || typeof json !== 'object') {
      if (text && /<html|请登录|登录|login|验证/i.test(text) && !/^\s*[\[{]/.test(text)) {
        return { kind: 'auth', message: '115 登录状态异常，请先登录 115' };
      }
      return null;
    }
    const code = String(json.errno ?? json.errcode ?? json.errCode ?? json.code ?? '');
    const msg = String(json.error || json.error_msg || json.msg || json.message || '');
    if (code === '911') return { kind: 'verify', code, message: msg || '115 要求人机验证' };
    if (code === '590075') return { kind: 'busy', code, message: msg || '操作太频繁，请稍候再试' };
    if (code === '99' || code === '990001') return { kind: 'auth', code, message: msg || '115 登录已失效' };
    return null;
  }

  function rawRequest(opts) {
    return new Promise((resolve, reject) => {
      const method = (opts.method || 'GET').toUpperCase();
      const headers = Object.assign({}, opts.headers || {});
      const responseType = opts.responseType || '';
      let settled = false;
      const done = (fn, v) => { if (!settled) { settled = true; fn(v); } };
      try {
        GM_xmlhttpRequest({
          method,
          url: opts.url,
          headers,
          data: opts.data,
          timeout: opts.timeout || 20000,
          responseType,
          anonymous: false,
          onload(res) {
            let json = null;
            let text = '';
            if (responseType === 'arraybuffer' || responseType === 'blob') {
              text = '';
            } else {
              text = String(res.responseText || '');
              try { json = JSON.parse(text); } catch (_) {}
            }
            const risk = parseRisk(json, text);
            done(resolve, {
              status: res.status,
              text,
              json,
              risk,
              response: res.response,
              headers: res.responseHeaders || '',
              finalUrl: res.finalUrl || opts.url,
            });
          },
          onerror() { done(reject, new Error('网络请求失败，请检查网络或跨源权限')); },
          ontimeout() { done(reject, new Error('115 请求超时')); },
          onabort() { done(reject, new Error('115 请求已取消')); },
        });
      } catch (e) {
        done(reject, e);
      }
    });
  }

  // ---------------------------------------------------------------- scheduler

  const Scheduler = {
    q: [],
    busy: false,
    lastAt: 0,
    blocked: false,
    blockedReason: '',
    pausedUntil: 0,
    pauseReason: '',

    gap() {
      const mode = Store.get('mode', 'standard');
      if (mode === 'manual') return 3000;
      if (mode === 'low') return 2500;
      return 1200;
    },

    enqueue(fn, opts) {
      opts = opts || {};
      return new Promise((resolve, reject) => {
        this.q.push({
          fn,
          priority: Number(opts.priority) || 5,
          label: opts.label || '',
          resolve,
          reject,
        });
        this.q.sort((a, b) => a.priority - b.priority);
        this.pump();
      });
    },

    async pump() {
      if (this.busy) return;
      this.busy = true;
      try {
        while (this.q.length) {
          if (this.blocked) {
            const item = this.q.shift();
            item.reject(new RiskError({ kind: 'verify', message: this.blockedReason || '115 操作已暂停' }));
            continue;
          }
          const waitPause = this.pausedUntil - now();
          if (waitPause > 0) await sleep(Math.min(waitPause, 30000));
          const waitGap = this.lastAt + this.gap() + rand(-300, 300) - now();
          if (waitGap > 0) await sleep(waitGap);
          const item = this.q.shift();
          if (!item) break;
          this.lastAt = now();
          try {
            item.resolve(await item.fn());
          } catch (e) {
            item.reject(e);
          }
        }
      } finally {
        this.busy = false;
      }
    },

    block(reason) {
      this.blocked = true;
      this.blockedReason = reason || '115 操作已暂停';
    },
    unblock() {
      this.blocked = false;
      this.blockedReason = '';
    },
    pause(ms, reason) {
      this.pausedUntil = Math.max(this.pausedUntil, now() + Math.max(0, Number(ms) || 0));
      this.pauseReason = reason || '';
    },
  };

  function handleRisk(risk) {
    if (!risk) return;
    if (risk.kind === 'verify') {
      Risk.set('verify', risk.message);
      Scheduler.block('115 要求人机验证');
      if (UI.ready) UI.showRiskModal(risk);
    } else if (risk.kind === 'busy') {
      Risk.set('busy', risk.message, now() + 60 * 1000);
      Scheduler.pause(60 * 1000, '操作太频繁');
      if (UI.ready) UI.toast('115 提示操作太频繁，已暂停 60 秒', 'warn');
    } else if (risk.kind === 'auth') {
      Risk.set('auth', risk.message);
      Scheduler.block('115 登录已失效');
      if (UI.ready) UI.showRiskModal(risk);
    }
  }

  async function api(opts) {
    return Scheduler.enqueue(async () => {
      Budget.take();
      const res = await rawRequest(opts);
      if (res.risk) {
        handleRisk(res.risk);
        throw new RiskError(res.risk);
      }
      return res;
    }, { priority: opts.priority, label: opts.label });
  }

  const JSON_HEADERS = {
    Accept: 'application/json, text/plain, */*',
    Referer: 'https://115.com/',
  };

  const OFFLINE_HEADERS = {
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://115.com',
    Referer: 'https://115.com/?tab=offline&mode=wangpan',
    'X-Requested-With': 'XMLHttpRequest',
  };

  const FORM_HEADERS = {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  };

  // ---------------------------------------------------------------- link

  function base32ToHex(s) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const ch of String(s).toUpperCase()) {
      const v = alphabet.indexOf(ch);
      if (v < 0) return '';
      bits += v.toString(2).padStart(5, '0');
    }
    let hex = '';
    for (let i = 0; i + 4 <= bits.length && hex.length < 40; i += 4) {
      hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    }
    return hex.length >= 40 ? hex.slice(0, 40) : '';
  }

  const Link = {
    RE: /(magnet:\?xt=urn:btih:[a-z0-9]{32,40}[^\s"'<>]*)|(ed2k:\/\/\|file\|[^\s"'<>]+)/gi,

    extract(text) {
      const out = [];
      const seen = new Set();
      const src = String(text || '');
      const re = new RegExp(this.RE.source, 'gi');
      let m;
      while ((m = re.exec(src))) {
        const raw = m[1] || m[2];
        const info = this.info(raw);
        if (!info || !info.hash) continue;
        if (seen.has(info.hash)) continue;
        seen.add(info.hash);
        out.push(info);
      }
      return out;
    },

    info(raw) {
      // 去掉页面里跟在链接后面的标点，避免把 】、,、; 之类带进 info hash
      const url = String(raw || '').trim().replace(/[】,;。，、]+$/g, '');
      let m = url.match(/urn:btih:([a-z0-9]{32,40})/i);
      if (m) {
        let hash = m[1].toLowerCase();
        if (hash.length === 32) {
          const hex = base32ToHex(hash);
          if (hex) hash = hex;
        }
        return { type: 'magnet', raw: url, url: this.normalize(url), hash, name: this.dn(url), size: 0 };
      }
      m = url.match(/^ed2k:\/\/\|file\|([^|]*)\|(\d+)\|([a-f0-9]{32})\|/i);
      if (m) {
        return { type: 'ed2k', raw: url, url, hash: m[3].toLowerCase(), name: m[1], size: Number(m[2]) || 0 };
      }
      return null;
    },

    normalize(raw) {
      const url = String(raw || '').trim();
      const m = url.match(/urn:btih:([a-z0-9]{32,40})/i);
      if (!m) return url;
      if (!Store.get('trimMagnet', true)) return url;
      const dn = this.dn(url);
      return 'magnet:?xt=urn:btih:' + m[1] + (dn ? '&dn=' + encodeURIComponent(dn) : '');
    },

    dn(url) {
      const m = String(url || '').match(/[?&]dn=([^&]+)/i);
      if (!m) return '';
      try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (_) { return m[1]; }
    },
  };

  // ---------------------------------------------------------------- name

  const Name = {
    TLD: 'com|net|org|cn|top|xyz|cc|tv|me|la|vip|io|co|info|biz|club|site|online|shop|app|pro|link|fun|live|icu|work|asia|us|uk|jp|kr|tw|hk',
    BRACKET_RE: /【[^】]*】|\[[^\]]*\]|（[^）]*）|\([^)]*\)|｛[^｝]*｝|\{[^}]*\}/g,
    KEEP_TAGS: [
      '字幕', '中字', '简繁', '繁体', '简体', '国语', '粤语', '双语', '中英',
      '特效', '导演剪辑', '加长', '未删减', '完整版', '修复版', '重制',
      'REMUX', 'HDR', 'DV', '杜比', '全景声', '60帧', '120帧', '4K', '8K',
      '合集', '全季', '蓝光', '原盘', '国配', '内封', '外挂',
    ],
    STRONG_AD: [
      '最新地址', '永久地址', '地址发布', '发布页', '公众号', '微信', 'QQ群',
      '加群', '扫码', '二维码', '免费下载', '下载地址', '电影天堂', '请访问',
      '防失联', '更多', '无水印', '高品质',
    ],
    WEAK_AD: ['资源', '发布', '官方', '网站', '网址', '获取', '每日更新', '本站'],
    PHRASES: [
      /更多[^，。,\s]{0,12}资源/g,
      /最新地址[^，。,\s]*/g,
      /永久地址[^，。,\s]*/g,
      /请访问[^，。,\s]*/g,
      /扫码[^，。,\s]*/g,
      /关注公众号[^，。,\s]*/g,
      /免费下载[^，。,\s]*/g,
      /电影天堂/g,
      /www\.[^\s]+/gi,
    ],

    domainRe() {
      return new RegExp('(?:[A-Za-z0-9][A-Za-z0-9-]*\\.)+(?:' + this.TLD + ')(?![A-Za-z0-9])', 'gi');
    },
    hasDomain(text) {
      return this.domainRe().test(String(text || ''));
    },
    adScore(text) {
      const s = String(text || '');
      let score = 0;
      for (const w of this.STRONG_AD) if (s.includes(w)) score += 2;
      for (const w of this.WEAK_AD) if (s.includes(w)) score += 1;
      return score;
    },
    tidy(s) {
      let v = String(s || '');
      v = v.replace(/ /g, ' ');
      v = v.replace(/[\\/:*?"<>|]/g, ' ');
      v = v.replace(/\s+/g, ' ').trim();
      v = v.replace(/([-_.·|])\s+/g, '$1').replace(/\s+([-_.·|])/g, '$1');
      v = v.replace(/([-_.·|]){2,}/g, '$1');
      v = v.replace(/^[\s\-_.·|]+|[\s\-_.·|]+$/g, '');
      return v;
    },
    clean(raw) {
      let s = String(raw || '');
      if (!s) return '';
      s = s.replace(/https?:\/\/[^\s【】\[\]（）()]+/gi, ' ');
      s = s.replace(this.BRACKET_RE, (whole) => {
        const inner = whole.slice(1, -1);
        if (!inner.trim()) return ' ';
        const domain = this.hasDomain(inner);
        const score = this.adScore(inner);
        const keepTags = this.KEEP_TAGS.filter((t) => inner.includes(t));
        if (!domain && score < 2) return whole;
        if (!keepTags.length) return ' ';
        // 有字幕/版本等有意义标签时，只去掉括号里的域名和广告词，保留标签
        let cleaned = inner.replace(this.domainRe(), ' ').replace(/www\.\S+/gi, ' ');
        for (const w of this.STRONG_AD) cleaned = cleaned.split(w).join(' ');
        for (const w of this.WEAK_AD) cleaned = cleaned.split(w).join(' ');
        cleaned = this.tidy(cleaned);
        return cleaned ? whole[0] + cleaned + whole[whole.length - 1] : ' ';
      });
      s = s.replace(/https?:\/\/\S+/gi, ' ');
      s = s.replace(this.domainRe(), ' ');
      for (const re of this.PHRASES) s = s.replace(re, ' ');
      s = s.replace(/【\s*】|\[\s*\]|（\s*）|\(\s*\)|｛\s*｝|\{\s*\}/g, ' ');
      return this.tidy(s);
    },
    splitExt(name) {
      const m = String(name || '').match(/^(.*?)(\.[A-Za-z0-9]{1,8})$/);
      return m ? { stem: m[1], ext: m[2] } : { stem: String(name || ''), ext: '' };
    },
    cleanFileName(name) {
      const { stem, ext } = this.splitExt(name);
      const cleaned = this.clean(stem);
      return cleaned ? cleaned + ext : '';
    },
    isAdName(name) {
      return !this.clean(name);
    },
    isAdFile(name) {
      return !this.cleanFileName(name);
    },
    isSample(name) {
      const v = String(name || '').toLowerCase();
      return /(^|[.\-_\s\[\]()【】])(sample|trailer|teaser|preview|样片|预告|抢先|片花)([.\-_\s\[\]()【】]|$)/.test(v);
    },
    isExtra(name) {
      const v = String(name || '').toLowerCase();
      return /(^|[.\-_\s\[\]()【】])(featurette|behind[.\-_\s]*the[.\-_\s]*scenes|behind|interview|deleted[.\-_\s]*scenes|extras?|bonus|花絮|幕后|特典|访谈|制作特辑|删减片段)([.\-_\s\[\]()【】]|$)/.test(v);
    },
  };

  // ---------------------------------------------------------------- pan115

  function normalizeEntry(e) {
    if (!e || typeof e !== 'object') return null;
    const hasFid = e.fid !== undefined && e.fid !== null && String(e.fid) !== '0' && String(e.fid) !== '';
    const hasAltId = e.file_id !== undefined && e.file_id !== null && String(e.file_id) !== '0' && String(e.file_id) !== '';
    const sizeKnown = ['s', 'size', 'file_size', 'fs'].some((k) => e[k] !== undefined && e[k] !== null);
    let isFolder;
    if (typeof e.is_dir === 'boolean') isFolder = e.is_dir;
    else if (typeof e.isFolder === 'boolean') isFolder = e.isFolder;
    else isFolder = !hasFid && !(hasAltId && sizeKnown);
    const id = isFolder
      ? (e.cid ?? e.category_id ?? e.file_id ?? e.id)
      : (e.fid ?? e.file_id ?? e.id);
    const name = e.n ?? e.name ?? e.file_name ?? e.fn ?? '';
    const size = Number(e.s ?? e.size ?? e.file_size ?? e.fs ?? 0) || 0;
    if (!name || id === undefined || id === null || id === '') return null;
    return {
      id: String(id),
      isFolder: !!isFolder,
      name: String(name),
      size,
      pickcode: String(e.pc ?? e.pick_code ?? e.pickcode ?? ''),
    };
  }

  const Pan115 = {
    _sign: null,
    _cache: new Map(),

    async getSign(force) {
      if (!force && this._sign && now() - this._sign.at < 30000) return this._sign.value;
      const res = await api({
        method: 'GET',
        url: API.sign + '&_=' + now(),
        headers: OFFLINE_HEADERS,
        label: 'sign',
      });
      const j = res.json;
      if (!j || !j.sign || !j.time) {
        throw new Error('获取 115 签名失败，请确认已登录 115');
      }
      this._sign = { value: j, at: now() };
      return j;
    },

    async addTask(rawUrl, cid) {
      const url = Link.normalize(rawUrl);
      if (!url) throw new Error('不是有效的磁力/电驴链接');
      // 不跨任务复用 sign：115 可能对 sign/time 有一次性或短窗口校验
      const sign = await this.getSign(true);
      const form = new URLSearchParams();
      form.set('url', url);
      form.set('uid', '');
      if (cid && String(cid) !== '0') form.set('wp_path_id', String(cid));
      form.set('sign', sign.sign);
      form.set('time', String(sign.time));
      const res = await api({
        method: 'POST',
        url: API.add,
        data: form.toString(),
        headers: Object.assign({}, OFFLINE_HEADERS, FORM_HEADERS),
        label: 'add',
      });
      const j = res.json;
      if (j && j.state) return { ok: true, duplicate: false };
      const code = String(j?.errcode ?? j?.errno ?? j?.code ?? '');
      if (code === '10008') return { ok: true, duplicate: true };
      const detail = j?.error_msg || j?.msg || j?.error;
      const snippet = res.text ? String(res.text).replace(/\s+/g, ' ').slice(0, 120) : '';
      return {
        ok: false,
        code,
        message: detail || (code ? `错误码 ${code}` : `HTTP ${res.status}${snippet ? ' · ' + snippet : ''}`),
      };
    },

    _listApsPage(cid, offset) {
      const params = new URLSearchParams({
        aid: '1',
        cid: String(cid || 0),
        offset: String(offset || 0),
        limit: '500',
        show_dir: '1',
        format: 'json',
        record_open_time: '1',
        count_folders: '1',
        natsort: '1',
        fc_mix: '0',
      });
      return api({
        method: 'GET',
        url: API.listAps + '?' + params.toString(),
        headers: JSON_HEADERS,
        label: 'list',
      });
    },

    async _listAps(cid) {
      const acc = [];
      let offset = 0;
      for (let page = 0; page < 4; page += 1) {
        const res = await this._listApsPage(cid, offset);
        const j = res.json;
        if (!j || !Array.isArray(j.data)) throw new Error('APS 目录返回异常');
        acc.push(...j.data);
        const total = Number(j.count || 0);
        if (j.data.length < 500) break;
        if (total && acc.length >= total) break;
        offset += j.data.length;
      }
      return acc;
    },

    _listWebPage(cid, offset) {
      const params = new URLSearchParams({
        aid: '1',
        cid: String(cid || 0),
        o: 'user_ptime',
        asc: '0',
        offset: String(offset || 0),
        limit: '100',
        show_dir: '1',
        type: '0',
        natsort: '1',
        record_open_time: '1',
        format: 'json',
      });
      return api({
        method: 'GET',
        url: API.listWeb + '?' + params.toString(),
        headers: JSON_HEADERS,
        label: 'list',
      });
    },

    async _listWeb(cid) {
      const acc = [];
      let offset = 0;
      for (let page = 0; page < 8; page += 1) {
        const res = await this._listWebPage(cid, offset);
        const j = res.json;
        if (!j || !Array.isArray(j.data)) throw new Error('115 目录返回异常');
        acc.push(...j.data);
        if (j.data.length < 100) break;
        offset += j.data.length;
        if (acc.length > 2000) break;
      }
      return acc;
    },

    async listFolder(cid, opts) {
      opts = opts || {};
      cid = String(cid || 0);
      const cacheKey = cid + ':' + (opts.foldersOnly ? 'd' : 'a');
      const cached = this._cache.get(cacheKey);
      if (cached && now() - cached.at < 10 * 60 * 1000) {
        return cached.data;
      }
      let raw;
      try {
        raw = await this._listAps(cid);
      } catch (e) {
        if (e instanceof RiskError) throw e;
        log('APS 目录失败，回退 webapi', e);
        raw = await this._listWeb(cid);
      }
      let list = raw.map(normalizeEntry).filter(Boolean);
      if (opts.foldersOnly) list = list.filter((x) => x.isFolder);
      list.sort((a, b) => {
        if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
        return a.name.localeCompare(b.name, 'zh-Hans-CN');
      });
      this._cache.set(cacheKey, { at: now(), data: list });
      return list;
    },

    clearListCache() { this._cache.clear(); },

    clearFolderCache(cid) {
      cid = String(cid || 0);
      this._cache.delete(cid + ':a');
      this._cache.delete(cid + ':d');
    },

    async resolvePath(path) {
      const p = String(path || '').trim();
      if (!p || p === '/') return '0';
      const clean = p.replace(/^\/+/, '').replace(/\/+$/, '');
      const res = await api({
        method: 'GET',
        url: API.getid + '?path=' + encodeURIComponent('/' + clean),
        headers: JSON_HEADERS,
        label: 'getid',
      });
      const j = res.json;
      const id = j?.id ?? j?.cid ?? j?.file_id ?? j?.data?.id ?? j?.data?.cid;
      if (id === undefined || id === null || String(id) === '0') return '';
      return String(id);
    },

    async mkdir(name, pid) {
      const form = new URLSearchParams({ cname: String(name), pid: String(pid || '0') });
      const res = await api({
        method: 'POST',
        url: API.mkdir,
        data: form.toString(),
        headers: Object.assign({}, JSON_HEADERS, FORM_HEADERS),
        label: 'mkdir',
      });
      const j = res.json;
      if (!j || j.state === false) throw new Error(j?.error || j?.message || '新建文件夹失败');
      const id = j.cid ?? j.cate_id ?? j.id ?? j.file_id ?? j.data?.cid;
      if (!id) throw new Error('新建文件夹未返回目录 ID');
      this.clearListCache();
      return String(id);
    },

    async listFolderFresh(cid, opts) {
      this.clearFolderCache(cid);
      return this.listFolder(cid, opts);
    },

    async listTasks(page) {
      const res = await api({
        method: 'GET',
        url: API.tasks + '&page=' + (page || 1) + '&_=' + now(),
        headers: OFFLINE_HEADERS,
        label: 'tasks',
      });
      const j = res.json || {};
      const arr = Array.isArray(j.tasks) ? j.tasks : Array.isArray(j.data) ? j.data : [];
      return arr.map((t) => ({
        infoHash: String(t.info_hash || t.infoHash || '').toLowerCase(),
        name: String(t.name || t.file_name || t.title || ''),
        url: String(t.url || ''),
        status: Number(t.status ?? t.stat ?? -999),
        size: Number(t.size || 0),
        percent: Number(t.percentDone ?? t.percent ?? 0),
        fileId: String(t.file_id ?? t.fileId ?? ''),
        dirId: String(t.wp_path_id ?? t.dir_id ?? ''),
        addTime: Number(t.add_time || 0),
        raw: t,
      }));
    },

    async renameOne(fileId, newName) {
      const form = new URLSearchParams({ fid: String(fileId), file_name: String(newName) });
      const res = await api({
        method: 'POST',
        url: API.renameOne,
        data: form.toString(),
        headers: Object.assign({}, JSON_HEADERS, FORM_HEADERS),
        label: 'rename',
      });
      const j = res.json;
      if (!j || j.state === false) throw new Error(j?.error || j?.message || '改名失败');
      return true;
    },

    async renameMany(items) {
      const list = (items || []).filter((x) => x && x.fileId && x.newName);
      if (!list.length) return { ok: 0, failed: [] };
      // 逐个用 files/edit：这是老司机验证过的接口。
      // batch_rename 虽能减少请求，但字段行为还没在真实账号上验证，暂不默认启用。
      let ok = 0;
      const failed = [];
      for (const it of list) {
        try {
          await this.renameOne(it.fileId, it.newName);
          ok += 1;
        } catch (e) {
          if (e instanceof RiskError) throw e;
          failed.push({ item: it, error: e.message });
        }
        await sleep(300);
      }
      return { ok, failed };
    },

    async deleteMany(ids) {
      const list = (ids || []).map(String).filter(Boolean);
      if (!list.length) return { ok: 0 };
      const form = new URLSearchParams();
      list.forEach((id, i) => form.set(`fid[${i}]`, id));
      form.set('ignore_warn', '1');
      const res = await api({
        method: 'POST',
        url: API.del,
        data: form.toString(),
        headers: Object.assign({}, JSON_HEADERS, FORM_HEADERS),
        label: 'delete',
      });
      const j = res.json;
      if (!j || j.state === false) throw new Error(j?.error || j?.message || '删除失败');
      return { ok: list.length };
    },

    async move(ids, pid) {
      const list = (ids || []).map(String).filter(Boolean);
      if (!list.length) return { ok: 0, cid: String(pid || '0') };
      const form = new URLSearchParams();
      list.forEach((id, i) => form.set(`fid[${i}]`, id));
      form.set('pid', String(pid || '0'));
      form.set('move_proid', '');
      const res = await api({
        method: 'POST',
        url: API.move,
        data: form.toString(),
        headers: Object.assign({}, JSON_HEADERS, FORM_HEADERS),
        label: 'move',
      });
      const j = res.json;
      if (!j || j.state === false) throw new Error(j?.error || j?.message || '移动文件失败');
      this.clearListCache();
      return { ok: list.length, cid: String(pid || '0') };
    },

    async getUser() {
      const res = await api({
        method: 'GET',
        url: API.nav + '&_=' + now(),
        headers: JSON_HEADERS,
        label: 'nav',
      });
      const j = res.json;
      const uid = j?.data?.uid ?? j?.uid ?? j?.data?.user_id ?? j?.user_id;
      return uid ? String(uid) : '';
    },
  };

  // ---------------------------------------------------------------- ui

  const CSS = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    [hidden] { display: none !important; }
    .wrap {
      position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;
      font: 13px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
      color: #e5e7eb;
    }
    .wrap > * { pointer-events: auto; }
    button { font: inherit; cursor: pointer; }
    .ball {
      position: fixed; right: 24px; bottom: 24px; width: 46px; height: 46px;
      border-radius: 50%; border: 1px solid rgba(255,255,255,.18);
      background: linear-gradient(135deg,#2563eb,#1e40af); color: #fff;
      font-weight: 700; font-size: 13px; display: flex; align-items: center; justify-content: center;
      box-shadow: 0 8px 24px rgba(0,0,0,.35); user-select: none; touch-action: none;
    }
    .ball:hover { filter: brightness(1.08); }
    .ball .badge {
      position: absolute; top: -4px; right: -4px; min-width: 16px; height: 16px;
      padding: 0 4px; border-radius: 8px; background: #ef4444; color: #fff;
      font-size: 10px; line-height: 16px; text-align: center;
    }
    .ball .badge.warn { background: #f59e0b; }
    .panel {
      position: fixed; right: 24px; bottom: 82px; width: 380px;
      max-width: calc(100vw - 32px); max-height: min(72vh, 640px); background: #0f172a; border: 1px solid #334155;
      border-radius: 14px; box-shadow: 0 20px 50px rgba(0,0,0,.5);
      display: flex; flex-direction: column; overflow: hidden;
    }
    .panel header, .modal header, .picker header {
      display: flex; align-items: center; gap: 8px; padding: 12px 14px;
      background: #111c33; border-bottom: 1px solid #22304a;
    }
    .panel header .title { font-weight: 700; font-size: 14px; }
    .panel header .ver { color: #94a3b8; font-size: 11px; }
    .spacer, .grow { flex: 1; }
    .iconbtn {
      background: transparent; border: 0; color: #94a3b8; font-size: 18px;
      line-height: 1; padding: 4px 6px; border-radius: 6px;
    }
    .iconbtn:hover { background: #1e293b; color: #e5e7eb; }
    .riskbar {
      padding: 8px 14px; background: #7c2d12; color: #fed7aa; font-size: 12px;
      display: flex; gap: 8px; align-items: center;
    }
    .riskbar button {
      background: #ea580c; border: 0; color: #fff; border-radius: 6px;
      padding: 4px 8px; font-size: 12px; white-space: nowrap;
    }
    .tabs { display: flex; gap: 4px; padding: 8px 12px 0; background: #0f172a; }
    .tabs button {
      flex: 1; background: transparent; border: 0; color: #94a3b8; padding: 8px 0;
      border-bottom: 2px solid transparent; font-size: 13px;
    }
    .tabs button.active { color: #e5e7eb; border-bottom-color: #3b82f6; }
    .body { padding: 14px; overflow: auto; }
    .field { margin-bottom: 12px; }
    .label {
      display: flex; justify-content: space-between; align-items: center;
      color: #94a3b8; font-size: 12px; margin-bottom: 6px;
    }
    textarea, input[type=text], input[type=number], select {
      width: 100%; background: #111c33; border: 1px solid #334155; color: #e5e7eb;
      border-radius: 8px; padding: 8px 10px; font: inherit; outline: none;
    }
    textarea:focus, input:focus, select:focus { border-color: #3b82f6; }
    textarea { min-height: 92px; resize: vertical; }
    .row { display: flex; align-items: center; gap: 8px; }
    .pathbox {
      display: flex; align-items: center; gap: 8px; background: #111c33;
      border: 1px solid #334155; border-radius: 8px; padding: 6px 8px 6px 10px; min-height: 38px;
    }
    .pathbox .path {
      flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #e5e7eb;
    }
    .pathbox .path.empty { color: #64748b; }
    .favrow { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 7px; align-items: center; }
    .favhint { color: #64748b; font-size: 11px; }
    .favchip { display: inline-flex; align-items: center; gap: 4px; background: #1e293b; border: 1px solid #334155; color: #cbd5e1; border-radius: 999px; padding: 3px 4px 3px 9px; font-size: 11px; cursor: pointer; max-width: 100%; }
    .favchip:hover { background: #27364d; }
    .favchip.active { border-color: #3b82f6; color: #dbeafe; background: #172554; }
    .favchip .favname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 110px; }
    .favchip .favx { display: inline-flex; width: 16px; height: 16px; align-items: center; justify-content: center; border-radius: 50%; color: #94a3b8; }
    .favchip .favx:hover { background: #7f1d1d; color: #fecaca; }
    .picker footer { flex-wrap: wrap; }
    .btn {
      background: #1e293b; border: 1px solid #334155; color: #e5e7eb;
      border-radius: 8px; padding: 7px 12px; font-size: 13px;
    }
    .btn:hover { background: #27364d; }
    .btn.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
    .btn.primary:hover { background: #1d4ed8; }
    .btn.block { width: 100%; padding: 10px; font-weight: 600; }
    .btn:disabled { opacity: .5; cursor: not-allowed; }
    .hint { color: #64748b; font-size: 11px; margin-top: 6px; line-height: 1.5; }
    .status { margin-top: 10px; font-size: 12px; color: #93c5fd; min-height: 18px; white-space: pre-wrap; }
    .status.error { color: #fca5a5; }
    .status.success { color: #86efac; }
    .checkrow {
      display: flex; gap: 8px; align-items: center; color: #cbd5e1;
      font-size: 12px; margin: 8px 0;
    }
    .checkrow input { width: auto; }
    .overlay {
      position: fixed; inset: 0; background: rgba(2,6,23,.62);
      display: flex; align-items: center; justify-content: center;
    }
    .modal, .picker {
      width: 460px; max-width: calc(100vw - 32px); max-height: 78vh;
      background: #0f172a; border: 1px solid #334155; border-radius: 14px;
      box-shadow: 0 24px 60px rgba(0,0,0,.55); display: flex; flex-direction: column; overflow: hidden;
    }
    .modal .content { padding: 16px; overflow: auto; }
    .modal h3 { margin: 0 0 8px; font-size: 15px; }
    .modal p { margin: 0 0 10px; color: #cbd5e1; font-size: 13px; }
    .modal ul { margin: 0 0 12px; padding-left: 18px; color: #cbd5e1; font-size: 13px; }
    .modal .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
    .picker .crumbs {
      display: flex; flex-wrap: wrap; gap: 4px; padding: 8px 12px;
      border-bottom: 1px solid #22304a; font-size: 12px; color: #94a3b8;
    }
    .picker .crumbs button { background: transparent; border: 0; color: #60a5fa; padding: 2px 4px; }
    .picker .crumbs button:hover { text-decoration: underline; }
    .picker .list { overflow: auto; max-height: 44vh; padding: 6px 8px; }
    .dirrow {
      display: flex; align-items: center; gap: 8px; padding: 8px;
      border-radius: 8px; cursor: pointer;
    }
    .dirrow:hover { background: #17233a; }
    .dirrow .ico { width: 18px; text-align: center; color: #60a5fa; }
    .dirrow .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .picker .newrow {
      display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid #22304a;
    }
    .picker .newrow input { flex: 1; }
    .picker footer {
      display: flex; gap: 8px; justify-content: flex-end;
      padding: 10px 12px; border-top: 1px solid #22304a;
    }
    .empty { color: #64748b; text-align: center; padding: 24px 12px; font-size: 12px; }
    .toasts {
      position: fixed; right: 24px; top: 24px; display: flex; flex-direction: column;
      gap: 8px; max-width: min(340px, calc(100vw - 48px));
    }
    .toast {
      background: #111c33; border: 1px solid #334155; border-left: 3px solid #3b82f6;
      border-radius: 10px; padding: 10px 12px; box-shadow: 0 12px 30px rgba(0,0,0,.4);
      font-size: 12px; color: #e5e7eb; display: flex; gap: 10px; align-items: center;
      animation: rh115-slidein .18s ease-out;
    }
    .toast.success { border-left-color: #22c55e; }
    .toast.warn { border-left-color: #f59e0b; }
    .toast.error { border-left-color: #ef4444; }
    .toast .msg { flex: 1; }
    .toast .act {
      background: #1e293b; border: 1px solid #334155; color: #bfdbfe;
      border-radius: 6px; padding: 4px 8px; font-size: 12px; white-space: nowrap;
    }
    @keyframes rh115-slidein { from { transform: translateY(-6px); opacity: 0; } to { transform: none; opacity: 1; } }
    .ball .badge.task { background: #22c55e; left: -4px; right: auto; }
    .tasklist { display: flex; flex-direction: column; gap: 8px; }
    .taskcard { background: #111c33; border: 1px solid #22304a; border-radius: 10px; padding: 10px; }
    .taskhead { display: flex; gap: 8px; align-items: center; }
    .tasktitle { flex: 1; font-weight: 600; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .taskstate { font-size: 11px; padding: 2px 6px; border-radius: 999px; background: #1e293b; color: #94a3b8; white-space: nowrap; }
    .taskstate.ready { background: #14532d; color: #86efac; }
    .taskstate.organized { background: #1e3a8a; color: #bfdbfe; }
    .taskstate.failed, .taskstate.timeout { background: #7f1d1d; color: #fecaca; }
    .taskstate.pending, .taskstate.checking { background: #78350f; color: #fde68a; }
    .taskmeta { color: #64748b; font-size: 11px; margin-top: 5px; }
    .taskmeta.warn { color: #fbbf24; }
    .taskmeta.success { color: #86efac; }
    .taskactions { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
    .taskactions .btn { padding: 4px 9px; font-size: 11px; }
    .filterrow { display: flex; gap: 6px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }
    .filterbtn { background: transparent; border: 1px solid #334155; color: #94a3b8; border-radius: 999px; padding: 3px 10px; font-size: 11px; cursor: pointer; }
    .filterbtn.active { background: #1d4ed8; border-color: #1d4ed8; color: #fff; }
    .filterrow .btn { margin-left: auto; padding: 3px 9px; font-size: 11px; }
    .previewstats { color: #cbd5e1; font-size: 12px; background: #111c33; border: 1px solid #22304a; border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; }
    .previewsec { margin: 12px 0 6px; color: #94a3b8; font-size: 12px; font-weight: 600; }
    .previewwarn { color: #fbbf24; font-size: 12px; margin: 6px 0; }
    .previewrow { display: flex; gap: 8px; align-items: flex-start; padding: 5px 0; border-bottom: 1px solid #1e293b; font-size: 12px; }
    .previewrow input[type=checkbox] { margin-top: 3px; }
    .previewrow .pname { flex: 1; overflow: hidden; text-overflow: ellipsis; }
    .previewrow .pmeta { color: #64748b; font-size: 11px; white-space: nowrap; }
    .modal-actions { display: flex; gap: 8px; justify-content: flex-end; padding: 12px 16px; border-top: 1px solid #22304a; }
    .previewpre { white-space: pre-wrap; word-break: break-all; font-size: 11px; max-height: 50vh; overflow: auto; color: #cbd5e1; background: #0b1220; border: 1px solid #22304a; border-radius: 8px; padding: 10px; margin: 8px 0 0; }
    .btnrow { display: flex; gap: 8px; flex-wrap: wrap; }
  `;

  const UI = {
    ready: false,
    shadow: null,
    els: {},
    sending: false,
    _checkingUpdate: false,
    taskFilter: 'active',
    _selToastAt: 0,
    _riskTimer: 0,
    picker: { cid: '0', crumbs: [{ name: '根目录', cid: '0' }], busy: false },

    init() {
      if (this.ready) return;
      const host = document.createElement('div');
      host.id = 'rh115-host';
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
      (document.documentElement || document.body).appendChild(host);

      const shadow = host.attachShadow({ mode: 'open' });
      this.shadow = shadow;
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(CSS);
        shadow.adoptedStyleSheets = [sheet];
      } catch (_) {
        const style = document.createElement('style');
        style.textContent = CSS;
        shadow.appendChild(style);
      }

      const wrap = h('div', { class: 'wrap' });
      shadow.appendChild(wrap);
      this.els.wrap = wrap;

      this.els.toasts = h('div', { class: 'toasts' });
      this.els.badge = h('span', { class: 'badge', hidden: true });
      this.els.ball = h('button', { class: 'ball', title: '115 资源助手', type: 'button' },
        '115',
        this.els.badge
      );

      this.els.riskText = h('span', { class: 'grow' });
      this.els.riskBtn = h('button', {
        text: '去验证',
        onclick: () => this.showRiskModal(Risk.current),
      });
      this.els.riskbar = h('div', { class: 'riskbar', hidden: true },
        this.els.riskText,
        this.els.riskBtn
      );

      const sendSec = this.buildSend();
      const setSec = this.buildSettings();
      const tasksSec = this.buildTasks();
      this.els.sendSec = sendSec;
      this.els.setSec = setSec;
      this.els.tasksSec = tasksSec;

      this.els.tabSend = h('button', {
        class: 'active', type: 'button', text: '发送',
        onclick: () => this.showTab('send'),
      });
      this.els.tabTasks = h('button', {
        type: 'button', text: '任务',
        onclick: () => this.showTab('tasks'),
      });
      this.els.tabSettings = h('button', {
        type: 'button', text: '设置',
        onclick: () => this.showTab('settings'),
      });

      this.els.panel = h('div', { class: 'panel', hidden: true },
        h('header', null,
          h('span', { class: 'title', text: '115 资源助手' }),
          h('span', { class: 'ver', text: 'v' + VERSION, title: '点击检查更新', style: 'cursor:pointer', onclick: () => this.checkUpdate(true) }),
          h('span', { class: 'spacer' }),
          h('button', {
            class: 'iconbtn', type: 'button', title: '关闭', text: '×',
            onclick: () => this.closePanel(),
          })
        ),
        this.els.riskbar,
        h('div', { class: 'tabs' }, this.els.tabSend, this.els.tabTasks, this.els.tabSettings),
        h('div', { class: 'body' }, sendSec, tasksSec, setSec)
      );

      this.els.pickerOverlay = this.buildPicker();
      this.els.riskOverlay = this.buildRiskModal();
      this.els.noticeOverlay = this.buildNotice();
      this.els.previewOverlay = this.buildPreview();

      wrap.append(
        this.els.toasts,
        this.els.ball,
        this.els.panel,
        this.els.pickerOverlay,
        this.els.riskOverlay,
        this.els.noticeOverlay,
        this.els.previewOverlay
      );

      this.initBall();
      this.ready = true;
      if (Store.get('pollMigrated034', false) !== true) {
        const pm = Number(Store.get('pollMinutes', 10));
        if (!pm || pm === 2) Store.set('pollMinutes', 10);
        Store.set('pollMigrated034', true);
      }
      this.ensureDirUsage();
      this.renderPath();
      this.renderFavorites();
      this.renderSettings();
      this.renderBudget();
      this.refreshTasks();
      this.refreshRisk();

      if (Store.get('firstRun', true)) this.els.noticeOverlay.hidden = false;
    },

    field(label, control, hint) {
      return h('div', { class: 'field' },
        h('div', { class: 'label' }, h('span', { text: label })),
        control,
        hint ? h('div', { class: 'hint', text: hint }) : null
      );
    },

    buildSend() {
      const ta = h('textarea', {
        placeholder: 'magnet:?xt=urn:btih:...\n或 ed2k://|file|...',
        spellcheck: 'false',
      });
      this.els.links = ta;

      this.els.pathText = h('span', { class: 'path empty', text: '未设置目录' });
      this.els.status = h('div', { class: 'status' });
      this.els.sendBtn = h('button', {
        class: 'btn primary block', type: 'button', text: '发送到 115',
        onclick: () => this.send(),
      });

      return h('section', null,
        this.field('链接', ta, '支持 magnet 与 ed2k，可一次粘贴多个；重复的 info hash 会自动去掉。'),
        this.field('保存到',
          h('div', null,
            h('div', { class: 'pathbox' },
              this.els.pathText,
              h('button', { class: 'btn', type: 'button', text: '更改', onclick: () => this.openPicker() })
            ),
            this.els.favRow = h('div', { class: 'favrow' })
          )
        ),
        this.els.sendBtn,
        this.els.status,
        h('div', { class: 'hint', text: '首次使用请先选择默认目录。遇到人机验证会暂停，不会自动破解。' })
      );
    },

    buildTasks() {
      this.els.tasksList = h('div', { class: 'tasklist' });
      this.els.filterActive = h('button', { class: 'filterbtn active', type: 'button', text: '未完成', onclick: () => this.setTaskFilter('active') });
      this.els.filterDone = h('button', { class: 'filterbtn', type: 'button', text: '已完成', onclick: () => this.setTaskFilter('done') });
      this.els.filterAll = h('button', { class: 'filterbtn', type: 'button', text: '全部', onclick: () => this.setTaskFilter('all') });
      this.els.clearDone = h('button', { class: 'btn', type: 'button', text: '清空已完成', hidden: true, onclick: () => this.clearFinished() });
      return h('section', { hidden: true },
        h('div', { class: 'row', style: 'margin-bottom:8px' },
          h('button', { class: 'btn primary', type: 'button', text: '立即检查', onclick: () => this.checkAll() }),
          h('button', { class: 'btn', type: 'button', text: '整理任意目录', onclick: () => this.openPicker() })
        ),
        h('div', { class: 'filterrow' },
          this.els.filterActive,
          this.els.filterDone,
          this.els.filterAll,
          this.els.clearDone
        ),
        this.els.tasksList
      );
    },

    buildSettings() {
      const mode = h('select', null,
        h('option', { value: 'standard' }, '标准（推荐）'),
        h('option', { value: 'low' }, '低频'),
        h('option', { value: 'manual' }, '全手动')
      );
      const gap = h('input', { type: 'number', min: '3', max: '600', step: '1' });
      const pushLimit = h('input', { type: 'number', min: '1', max: '100', step: '1' });
      const budget = h('input', { type: 'number', min: '50', max: '2000', step: '50' });
      const trim = h('input', { type: 'checkbox' });
      const copy = h('input', { type: 'checkbox' });
      const auto = h('input', { type: 'checkbox' });
      const minVideo = h('input', { type: 'number', min: '0', max: '10000', step: '10' });
      const ratio = h('input', { type: 'number', min: '0', max: '100', step: '0.5' });
      const minAudio = h('input', { type: 'number', min: '0', max: '1000', step: '5' });
      const keepImages = h('input', { type: 'checkbox' });
      const keepNfo = h('input', { type: 'checkbox' });
      const keepSubs = h('input', { type: 'checkbox' });
      const delSamples = h('input', { type: 'checkbox' });
      const keepExtras = h('input', { type: 'checkbox' });
      const resMode = h('select', null,
        h('option', { value: 'movie' }, '影视（电影/剧集，推荐）'),
        h('option', { value: 'series' }, '剧集（保留所有集）'),
        h('option', { value: 'music' }, '音乐'),
        h('option', { value: 'software' }, '软件/电子书'),
        h('option', { value: 'generic' }, '通用（只清名字，不删内容）')
      );
      const pollMin = h('input', { type: 'number', min: '1', max: '120', step: '1' });
      const pathText = h('span', { class: 'path empty', text: '未设置' });
      const budgetText = h('div', { class: 'hint' });

      this.els.cfgMode = mode;
      this.els.cfgGap = gap;
      this.els.cfgPushLimit = pushLimit;
      this.els.cfgBudget = budget;
      this.els.cfgTrim = trim;
      this.els.cfgCopy = copy;
      this.els.cfgAuto = auto;
      this.els.cfgMinVideo = minVideo;
      this.els.cfgRatio = ratio;
      this.els.cfgMinAudio = minAudio;
      this.els.cfgKeepImages = keepImages;
      this.els.cfgKeepNfo = keepNfo;
      this.els.cfgKeepSubs = keepSubs;
      this.els.cfgDelSamples = delSamples;
      this.els.cfgKeepExtras = keepExtras;
      this.els.cfgResMode = resMode;
      this.els.cfgPoll = pollMin;
      this.els.cfgPathText = pathText;
      this.els.budgetText = budgetText;

      return h('section', { hidden: true },
        this.field('默认目录',
          h('div', { class: 'pathbox' },
            pathText,
            h('button', { class: 'btn', type: 'button', text: '更改', onclick: () => this.openPicker() })
          )
        ),
        this.field('模式', mode, '标准：正常节奏；低频：更慢；全手动：最慢，适合谨慎使用。'),
        this.field('推送间隔（秒）', gap, '两条磁力之间至少间隔多久。'),
        this.field('每小时推送上限', pushLimit, '超过后本小时不再推送。'),
        this.field('每小时请求预算', budget, '所有 115 请求共享，达到后自动暂停。'),
        h('label', { class: 'checkrow' }, trim, h('span', { text: '精简磁力链接（只保留 xt 和 dn）' })),
        h('label', { class: 'checkrow' }, copy, h('span', { text: '复制链接时弹出“发送到 115”提示' })),
        h('div', { class: 'previewsec', text: '整理规则' }),
        this.field('资源类型', resMode, '影视保留最大视频；剧集保留所有集；音乐/软件/通用不按视频大小删。'),
        h('label', { class: 'checkrow' }, auto, h('span', { text: '下载完成后自动整理（关闭则先弹预览）' })),
        h('label', { class: 'checkrow' }, delSamples, h('span', { text: '删除样片/预告（按文件名）' })),
        h('label', { class: 'checkrow' }, keepExtras, h('span', { text: '剧集模式保留花絮/特典' })),
        this.field('最小视频阈值（MB）', minVideo, '低于该值且远小于最大视频的文件按样片/广告删除。'),
        this.field('保留比例（%）', ratio, '例如 1 表示小于最大视频 1% 的视频按样片删除。'),
        this.field('最小音频阈值（MB）', minAudio, '小于该值的音频视为小文件。'),
        h('label', { class: 'checkrow' }, keepSubs, h('span', { text: '强制保留字幕（推荐）' })),
        h('label', { class: 'checkrow' }, keepImages, h('span', { text: '保留图片（海报/封面等）' })),
        h('label', { class: 'checkrow' }, keepNfo, h('span', { text: '保留 NFO 文件' })),
        this.field('轮询间隔（分钟）', pollMin, '推送后前 18 秒会快速检查；之后按这个间隔慢速检查。'),
        h('div', { class: 'btnrow' },
          h('button', { class: 'btn primary', type: 'button', text: '保存设置', onclick: () => this.saveSettings() }),
          h('button', { class: 'btn', type: 'button', text: '检查登录', onclick: () => this.checkLogin() }),
          h('button', { class: 'btn', type: 'button', text: '立即检查', onclick: () => this.checkAll() }),
          h('button', { class: 'btn', type: 'button', text: '诊断', onclick: () => this.diagnose() }),
          h('button', { class: 'btn', type: 'button', text: '检查更新', onclick: () => this.checkUpdate(true) }),
          h('button', {
            class: 'btn', type: 'button', text: '重置计数',
            onclick: () => { Budget.reset(); this.renderBudget(); this.toast('本小时请求计数已重置', 'success'); },
          })
        ),
        budgetText
      );
    },

    buildPicker() {
      this.els.pickerCrumbs = h('div', { class: 'crumbs' });
      this.els.pickerList = h('div', { class: 'list' });
      this.els.newDirName = h('input', { type: 'text', placeholder: '新建文件夹名称' });
      return h('div', { class: 'overlay', hidden: true },
        h('div', { class: 'picker' },
          h('header', null,
            h('strong', { text: '选择 115 目录' }),
            h('span', { class: 'spacer' }),
            h('button', {
              class: 'iconbtn', type: 'button', title: '关闭', text: '×',
              onclick: () => { this.els.pickerOverlay.hidden = true; },
            })
          ),
          this.els.pickerCrumbs,
          this.els.pickerList,
          h('div', { class: 'newrow' },
            this.els.newDirName,
            h('button', { class: 'btn', type: 'button', text: '新建', onclick: () => this.pickerNew() })
          ),
          h('footer', null,
            h('button', {
              class: 'btn', type: 'button', text: '取消',
              onclick: () => { this.els.pickerOverlay.hidden = true; },
            }),
            h('button', {
              class: 'btn', type: 'button', text: '整理此目录',
              onclick: () => this.pickerOrganize(),
            }),
            h('button', { class: 'btn primary', type: 'button', text: '选择当前目录', onclick: () => this.pickerOk() })
          )
        )
      );
    },

    buildRiskModal() {
      this.els.riskTitle = h('h3', { text: '115 需要处理' });
      this.els.riskBody = h('p');
      return h('div', { class: 'overlay', hidden: true },
        h('div', { class: 'modal' },
          h('header', null,
            h('strong', { text: '115 操作暂停' }),
            h('span', { class: 'spacer' }),
            h('button', {
              class: 'iconbtn', type: 'button', title: '关闭', text: '×',
              onclick: () => { this.els.riskOverlay.hidden = true; },
            })
          ),
          h('div', { class: 'content' },
            this.els.riskTitle,
            this.els.riskBody,
            h('p', { class: 'hint', text: '验证通过后会冷却 10 分钟，再以较低频率恢复。插件不会自动破解验证码。' }),
            h('div', { class: 'actions' },
              this.els.riskOpen = h('button', { class: 'btn', type: 'button', text: '打开 115' }),
              this.els.riskDone = h('button', { class: 'btn primary', type: 'button', text: '我已完成验证' })
            )
          )
        )
      );
    },

    buildNotice() {
      const close = () => {
        Store.set('firstRun', false);
        this.els.noticeOverlay.hidden = true;
      };
      return h('div', { class: 'overlay', hidden: true },
        h('div', { class: 'modal' },
          h('header', null,
            h('strong', { text: '使用前须知' }),
            h('span', { class: 'spacer' }),
            h('button', { class: 'iconbtn', type: 'button', title: '关闭', text: '×', onclick: close })
          ),
          h('div', { class: 'content' },
            h('ul', null,
              h('li', { text: '本工具调用 115 网页接口，不会保存你的密码或 Cookie。' }),
              h('li', { text: '请低频使用。遇到人机验证时，需要在 115 页面手动完成，插件不会自动破解。' }),
              h('li', { text: '删除操作会进入 115 回收站，可在回收站恢复。' }),
              h('li', { text: '默认节奏：每 10 秒推送 1 条，每小时最多 20 条；可在设置里调整。' })
            ),
            h('div', { class: 'actions' },
              h('button', { class: 'btn primary', type: 'button', text: '开始使用', onclick: close })
            )
          )
        )
      );
    },

    initBall() {
      const ball = this.els.ball;
      let dragging = false;
      let moved = false;
      let sx = 0;
      let sy = 0;
      let startRight = 24;
      let startBottom = 24;

      ball.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        dragging = true;
        moved = false;
        sx = e.clientX;
        sy = e.clientY;
        const rect = ball.getBoundingClientRect();
        startRight = innerWidth - rect.right;
        startBottom = innerHeight - rect.bottom;
        try { ball.setPointerCapture(e.pointerId); } catch (_) {}
      });

      ball.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - sx;
        const dy = e.clientY - sy;
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        const right = clamp(startRight - dx, 8, Math.max(8, innerWidth - 54));
        const bottom = clamp(startBottom - dy, 8, Math.max(8, innerHeight - 54));
        ball.style.right = right + 'px';
        ball.style.bottom = bottom + 'px';
      });

      const endDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        try { ball.releasePointerCapture(e.pointerId); } catch (_) {}
        if (moved) {
          Store.set('ballPos', {
            right: parseInt(ball.style.right, 10) || 24,
            bottom: parseInt(ball.style.bottom, 10) || 24,
          });
        } else {
          this.togglePanel();
        }
      };
      ball.addEventListener('pointerup', endDrag);
      ball.addEventListener('pointercancel', () => { dragging = false; });

      const pos = Store.get('ballPos', null);
      if (pos) {
        ball.style.right = clamp(Number(pos.right) || 24, 8, Math.max(8, innerWidth - 54)) + 'px';
        ball.style.bottom = clamp(Number(pos.bottom) || 24, 8, Math.max(8, innerHeight - 54)) + 'px';
      }
    },

    bindGlobal() {
      document.addEventListener('selectionchange', debounce(() => this.onSelection(), 200), true);
      document.addEventListener('copy', (e) => this.onCopy(e), true);
      window.addEventListener('resize', () => this.clampBall());
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (!this.els.panel.hidden) this.closePanel();
      }, true);
      try { GM_registerMenuCommand('115 资源助手：打开面板', () => this.openPanel()); } catch (_) {}
      try { GM_registerMenuCommand('115 资源助手：选择默认目录', () => { this.openPanel(); this.openPicker(); }); } catch (_) {}
    },

    clampBall() {
      const ball = this.els.ball;
      if (!ball) return;
      const right = parseInt(ball.style.right, 10) || 24;
      const bottom = parseInt(ball.style.bottom, 10) || 24;
      ball.style.right = clamp(right, 8, Math.max(8, innerWidth - 54)) + 'px';
      ball.style.bottom = clamp(bottom, 8, Math.max(8, innerHeight - 54)) + 'px';
    },

    togglePanel() {
      if (this.els.panel.hidden) this.openPanel();
      else this.closePanel();
    },

    closePanel() {
      this.els.panel.hidden = true;
    },

    openPanel(prefill) {
      this.els.panel.hidden = false;
      if (prefill) {
        const cur = this.els.links.value.trim();
        const add = String(prefill).trim();
        if (add && !cur.includes(add)) {
          this.els.links.value = cur ? cur + '\n' + add : add;
        }
      }
      this.showTab('send');
      this.renderPath();
      this.renderFavorites();
      this.renderSettings();
      this.renderBudget();
      this.refreshRisk();
      setTimeout(() => {
        try { this.els.links.focus({ preventScroll: true }); } catch (_) {}
      }, 30);
    },

    showTab(name) {
      this.els.tabSend.classList.toggle('active', name === 'send');
      this.els.tabTasks.classList.toggle('active', name === 'tasks');
      this.els.tabSettings.classList.toggle('active', name === 'settings');
      this.els.sendSec.hidden = name !== 'send';
      this.els.tasksSec.hidden = name !== 'tasks';
      this.els.setSec.hidden = name !== 'settings';
      if (name === 'settings') {
        this.renderSettings();
        this.renderBudget();
      }
      if (name === 'tasks') this.refreshTasks();
    },

    renderPath() {
      const path = String(Store.get('defaultPath', '') || '');
      const cid = String(Store.get('defaultCid', '') || '');
      const text = path || (cid ? '目录 ID ' + cid : '未设置目录');
      for (const node of [this.els.pathText, this.els.cfgPathText]) {
        if (!node) continue;
        node.textContent = text;
        node.classList.toggle('empty', !path && !cid);
      }
    },

    topDirs() {
      const usage = Store.get('dirUsage', {}) || {};
      const list = Object.values(usage).filter((x) => x && x.path);
      list.sort((a, b) =>
        (Number(b.count) || 0) - (Number(a.count) || 0) ||
        (Number(b.lastUsedAt) || 0) - (Number(a.lastUsedAt) || 0)
      );
      return list.slice(0, 3);
    },

    ensureDirUsage() {
      if (Store.get('dirUsageMigrated', false)) return;
      const usage = Store.get('dirUsage', {}) || {};
      const add = (path, cid, name, count, at) => {
        path = String(path || '').trim();
        if (!path) return;
        const key = String(cid || '') || path;
        if (usage[key]) return;
        usage[key] = {
          path,
          cid: String(cid || ''),
          name: name || (path === '/' ? '根目录' : path.split('/').filter(Boolean).pop() || path),
          count,
          lastUsedAt: Number(at) || now(),
        };
      };
      for (const f of Store.get('favoritePaths', []) || []) add(f.path, f.cid, f.name, 2, now());
      for (const r of Store.get('recentPaths', []) || []) add(r.path, r.cid, '', 1, r.at);
      Store.set('dirUsage', usage);
      Store.set('dirUsageMigrated', true);
    },

    recordDir(path, cid, name) {
      path = String(path || '').trim();
      if (!path) return;
      cid = String(cid || '');
      const key = cid || path;
      const usage = Store.get('dirUsage', {}) || {};
      let extra = 0;
      for (const k of Object.keys(usage)) {
        if (k !== key && usage[k] && String(usage[k].path) === path) {
          extra += Number(usage[k].count) || 0;
          delete usage[k];
        }
      }
      const old = usage[key] || {};
      usage[key] = {
        path,
        cid,
        name: name || old.name || (path === '/' ? '根目录' : path.split('/').filter(Boolean).pop() || path),
        count: (Number(old.count) || 0) + extra + 1,
        lastUsedAt: now(),
      };
      const keys = Object.keys(usage);
      if (keys.length > 30) {
        keys.sort((a, b) => (Number(usage[a].lastUsedAt) || 0) - (Number(usage[b].lastUsedAt) || 0));
        for (const k of keys.slice(0, keys.length - 30)) delete usage[k];
      }
      Store.set('dirUsage', usage);
    },

    renderFavorites() {
      const box = this.els.favRow;
      if (!box) return;
      box.innerHTML = '';
      const dirs = this.topDirs();
      if (!dirs.length) {
        box.appendChild(h('span', { class: 'favhint', text: '常用目录会根据你的选择自动生成（最多 3 个）' }));
        return;
      }
      const curCid = String(Store.get('defaultCid', '') || '');
      const curPath = String(Store.get('defaultPath', '') || '');
      for (const dir of dirs) {
        const active = (dir.cid && String(dir.cid) === curCid) || dir.path === curPath;
        box.appendChild(h('span', {
          class: 'favchip' + (active ? ' active' : ''),
          title: dir.path,
          onclick: () => this.selectFavorite(dir),
        },
          h('span', { class: 'favname', text: dir.name || dir.path }),
          h('span', {
            class: 'favx', title: '从常用中移除', text: '×',
            onclick: (e) => { e.stopPropagation(); this.removeDirUsage(dir); },
          })
        ));
      }
    },

    selectFavorite(dir) {
      Store.set('defaultPath', dir.path);
      Store.set('defaultCid', String(dir.cid || ''));
      this.recordDir(dir.path, dir.cid, dir.name);
      this.renderPath();
      this.renderFavorites();
      this.renderSettings();
      this.toast('已切换到 ' + dir.path, 'success', { timeout: 2000 });
    },

    removeDirUsage(dir) {
      const usage = Store.get('dirUsage', {}) || {};
      const key = String(dir.cid || '') || dir.path;
      delete usage[key];
      for (const k of Object.keys(usage)) {
        if (usage[k] && usage[k].path === dir.path) delete usage[k];
      }
      Store.set('dirUsage', usage);
      this.renderFavorites();
      this.toast('已从常用移除；再次使用会重新出现', 'info', { timeout: 2000 });
    },

    renderSettings() {
      if (!this.els.cfgMode) return;
      const mode = String(Store.get('mode', 'standard') || 'standard');
      this.els.cfgMode.value = ['standard', 'low', 'manual'].includes(mode) ? mode : 'standard';
      this.els.cfgGap.value = Math.round((Number(Store.get('pushGapMs', 10000)) || 10000) / 1000);
      this.els.cfgPushLimit.value = Number(Store.get('pushPerHour', 20)) || 20;
      this.els.cfgBudget.value = Number(Store.get('budgetPerHour', 300)) || 300;
      this.els.cfgTrim.checked = !!Store.get('trimMagnet', true);
      this.els.cfgCopy.checked = !!Store.get('copyToast', true);
      this.els.cfgAuto.checked = !!Store.get('autoOrganize', false);
      this.els.cfgMinVideo.value = Number(Store.get('minVideoMB', 100)) || 0;
      this.els.cfgRatio.value = Number(Store.get('keepRatio', 1)) || 0;
      this.els.cfgMinAudio.value = Number(Store.get('minAudioMB', 20)) || 0;
      this.els.cfgKeepImages.checked = !!Store.get('keepImages', false);
      this.els.cfgKeepNfo.checked = !!Store.get('keepNfo', false);
      this.els.cfgKeepSubs.checked = Store.get('keepSubtitles', true) !== false;
      this.els.cfgDelSamples.checked = Store.get('deleteSamples', true) !== false;
      this.els.cfgKeepExtras.checked = Store.get('keepExtras', true) !== false;
      const rm = String(Store.get('resourceMode', 'movie'));
      this.els.cfgResMode.value = ['movie', 'series', 'music', 'software', 'generic'].includes(rm) ? rm : 'movie';
      this.els.cfgPoll.value = Number(Store.get('pollMinutes', 10)) || 10;
      this.renderPath();
    },

    saveSettings() {
      const mode = ['standard', 'low', 'manual'].includes(this.els.cfgMode.value) ? this.els.cfgMode.value : 'standard';
      const gapSec = clamp(Number(this.els.cfgGap.value) || 10, 3, 600);
      const pushLimit = clamp(Number(this.els.cfgPushLimit.value) || 20, 1, 100);
      const budget = clamp(Number(this.els.cfgBudget.value) || 300, 50, 2000);
      Store.set('mode', mode);
      Store.set('pushGapMs', Math.round(gapSec * 1000));
      Store.set('pushPerHour', Math.round(pushLimit));
      Store.set('budgetPerHour', Math.round(budget));
      Store.set('trimMagnet', !!this.els.cfgTrim.checked);
      Store.set('copyToast', !!this.els.cfgCopy.checked);
      Store.set('autoOrganize', !!this.els.cfgAuto.checked);
      Store.set('minVideoMB', clamp(Number(this.els.cfgMinVideo.value) || 0, 0, 10000));
      Store.set('keepRatio', clamp(Number(this.els.cfgRatio.value) || 0, 0, 100));
      Store.set('minAudioMB', clamp(Number(this.els.cfgMinAudio.value) || 0, 0, 1000));
      Store.set('keepImages', !!this.els.cfgKeepImages.checked);
      Store.set('keepNfo', !!this.els.cfgKeepNfo.checked);
      Store.set('keepSubtitles', !!this.els.cfgKeepSubs.checked);
      Store.set('deleteSamples', !!this.els.cfgDelSamples.checked);
      Store.set('keepExtras', !!this.els.cfgKeepExtras.checked);
      const rm = this.els.cfgResMode.value;
      Store.set('resourceMode', ['movie', 'series', 'music', 'software', 'generic'].includes(rm) ? rm : 'movie');
      Store.set('pollMinutes', clamp(Number(this.els.cfgPoll.value) || 10, 1, 120));
      this.renderBudget();
      this.toast('设置已保存', 'success');
    },

    renderBudget() {
      if (!this.els.budgetText) return;
      const cap = this.canPush();
      this.els.budgetText.textContent =
        `本小时：请求 ${Budget.used()}/${Budget.limit()} 次 · 推送 ${cap.count}/${cap.limit} 条`;
    },

    canPush() {
      const log = (Store.get('pushLog', []) || []).filter((t) => now() - t < 3600 * 1000);
      const limit = Math.max(1, Number(Store.get('pushPerHour', 20)) || 20);
      return { ok: log.length < limit, count: log.length, limit };
    },

    recordPush() {
      const log = (Store.get('pushLog', []) || []).filter((t) => now() - t < 3600 * 1000);
      log.push(now());
      Store.set('pushLog', log);
    },

    pushGap() {
      const mode = Store.get('mode', 'standard');
      const base = Math.max(3000, Number(Store.get('pushGapMs', 10000)) || 10000);
      if (mode === 'manual' || mode === 'low') return Math.max(base, 30000);
      return base;
    },

    setStatus(text, type) {
      if (!this.els.status) return;
      this.els.status.textContent = text || '';
      this.els.status.className = 'status' + (type ? ' ' + type : '');
    },

    async send() {
      if (this.sending) return;
      const links = Link.extract(this.els.links.value);
      if (!links.length) {
        this.setStatus('没有识别到磁力/电驴链接', 'error');
        return;
      }
      if (Risk.blocked()) {
        this.showRiskModal(Risk.current);
        return;
      }
      let cid = String(Store.get('defaultCid', '') || '');
      if (!cid) {
        const path = String(Store.get('defaultPath', '') || '');
        if (!path) {
          this.openPicker();
          this.setStatus('请先选择保存目录', 'error');
          return;
        }
        try {
          cid = await Pan115.resolvePath(path);
        } catch (e) {
          this.setStatus(e.message || '解析目录失败', 'error');
          if (e.risk) this.showRiskModal(e.risk);
          return;
        }
        if (!cid) {
          this.setStatus('默认目录不存在，请重新选择', 'error');
          return;
        }
        Store.set('defaultCid', cid);
      }
      this.recordDir(String(Store.get('defaultPath', '') || ''), cid, '');

      const cap = this.canPush();
      if (!cap.ok) {
        this.setStatus(`本小时已推送 ${cap.count}/${cap.limit} 条，已达上限`, 'error');
        return;
      }
      const max = Math.min(links.length, 20, cap.limit - cap.count);
      this.sending = true;
      this.els.sendBtn.disabled = true;
      this.els.sendBtn.textContent = '发送中…';
      let ok = 0;
      let dup = 0;
      let fail = 0;
      let lastError = '';
      try {
        for (let i = 0; i < max; i += 1) {
          const link = links[i];
          this.setStatus(`正在发送 ${i + 1}/${max}…`);
          if (i > 0) await sleep(this.pushGap());
          try {
            this.recordPush();
            this.renderBudget();
            const snap = await Queue.snapshot(cid);
            const r = await Pan115.addTask(link.url, cid);
            if (r.ok) {
              ok += 1;
              if (r.duplicate) dup += 1;
              Pan115.clearFolderCache(cid);
              Queue.add({
                id: 't' + now().toString(36) + Math.random().toString(36).slice(2, 6),
                url: link.url,
                infoHash: link.hash,
                name: link.name || '',
                targetCid: cid,
                targetPath: String(Store.get('defaultPath', '') || ''),
                beforeIds: snap.ids,
                beforeCount: snap.count,
                addedAt: now(),
                status: 'pending',
                checkCount: 0,
                remote: null,
                plan: null,
              });
            } else {
              fail += 1;
              lastError = `第 ${i + 1} 个：${r.message || ('错误码 ' + (r.code || '未知'))}`;
              this.setStatus(lastError, 'error');
            }
          } catch (e) {
            fail += 1;
            lastError = e.message || '发送失败';
            this.setStatus(lastError, 'error');
            if (e instanceof RiskError || e.risk) break;
          }
        }
        if (ok > 0) {
          const summary = `已发送 ${ok} 个${dup ? `（重复 ${dup} 个）` : ''}${fail ? `，失败 ${fail} 个` : ''}`;
          this.setStatus(summary + (fail && lastError ? `；${lastError}` : ''), fail ? 'warn' : 'success');
          this.toast(summary + (fail && lastError ? `；${lastError}` : ''), fail ? 'warn' : 'success', {
            action: '查看任务', timeout: 8000,
            onAction: () => this.openTasks(),
          });
          if (ok === links.length) this.els.links.value = '';
          // 发送成功后自动切到任务页
          setTimeout(() => { if (!this.els.panel.hidden) this.showTab('tasks'); }, 500);
        } else if (fail > 0) {
          const msg = lastError ? `发送失败：${lastError}` : '发送失败，请查看上方提示';
          this.setStatus(msg, 'error');
          this.toast(msg, 'error', { timeout: 10000 });
        }
      } finally {
        this.sending = false;
        this.els.sendBtn.disabled = false;
        this.els.sendBtn.textContent = '发送到 115';
        this.renderBudget();
        this.refreshRisk();
        // 整批推送结束后再启动快速检查，避免和后续推送抢请求队列
        if (ok > 0) Queue.scheduleEarly();
      }
    },

    async checkUpdate(force) {
      if (this._checkingUpdate) return;
      this._checkingUpdate = true;
      this.toast('正在检查更新…', 'info', { timeout: 2000 });
      try {
        const r = await Update.check(!!force);
        if (cmpVer(r.latest, VERSION) > 0) {
          this.toast(`发现新版本 ${r.latest}（当前 ${VERSION}）`, 'info', {
            action: '去更新', timeout: 20000,
            onAction: () => { try { window.open(r.url, '_blank', 'noopener'); } catch (_) {} },
          });
        } else {
          this.toast(`已是最新版本 ${VERSION}`, 'success', { timeout: 3000 });
        }
      } catch (e) {
        this.toast(e.message || '检查更新失败', 'error');
      } finally {
        this._checkingUpdate = false;
      }
    },

    async checkLogin() {
      try {
        await Pan115.getSign(true);
        this.toast('115 登录正常', 'success');
      } catch (e) {
        this.toast(e.message || '检查登录失败', 'error');
        if (e.risk) this.showRiskModal(e.risk);
      }
      this.renderBudget();
    },

    // ---- tasks / organizer

    refreshTasks() {
      if (!this.ready || !this.els.tasksList) return;
      const all = Queue.list().slice().reverse();
      const doneStates = ['organized', 'ignored'];
      const done = all.filter((t) => doneStates.includes(t.status));
      const active = all.filter((t) => !doneStates.includes(t.status));
      if (this.els.filterActive) {
        this.els.filterActive.textContent = `未完成 ${active.length}`;
        this.els.filterDone.textContent = `已完成 ${done.length}`;
        this.els.filterAll.textContent = `全部 ${all.length}`;
        this.els.filterActive.classList.toggle('active', this.taskFilter === 'active');
        this.els.filterDone.classList.toggle('active', this.taskFilter === 'done');
        this.els.filterAll.classList.toggle('active', this.taskFilter === 'all');
        this.els.clearDone.hidden = this.taskFilter !== 'done' || !done.length;
      }
      const list = this.taskFilter === 'done' ? done : this.taskFilter === 'all' ? all : active;
      this.els.tasksList.innerHTML = '';
      if (!list.length) {
        const text = this.taskFilter === 'done'
          ? '还没有已整理的任务'
          : this.taskFilter === 'all'
            ? '还没有任务。推送成功后会自动出现在这里。'
            : '没有未完成的任务';
        this.els.tasksList.appendChild(h('div', { class: 'empty', text }));
      } else {
        for (const t of list) this.els.tasksList.appendChild(this.taskCard(t));
      }
      this.refreshRisk();
    },

    setTaskFilter(filter) {
      this.taskFilter = ['active', 'done', 'all'].includes(filter) ? filter : 'active';
      this.refreshTasks();
    },

    clearFinished() {
      const ids = Queue.list().filter((t) => ['organized', 'ignored'].includes(t.status)).map((t) => t.id);
      if (!ids.length) return;
      Queue.removeMany(ids);
      this.refreshTasks();
      this.toast(`已清空 ${ids.length} 条已完成记录`, 'success');
    },

    taskCard(t) {
      const label = TASK_STATUS[t.status] || t.status;
      const candidates = [
        t.plan && t.plan.rootName,
        t.result && t.result.rootName,
        t.remote && t.remote.name,
        t.name,
      ];
      let rawTitle = '';
      for (const c of candidates) {
        if (c && !isHashLike(c)) { rawTitle = c; break; }
      }
      const title = (Name.clean(rawTitle) || rawTitle) ||
        (t.infoHash ? `哈希 ${t.infoHash.slice(0, 14)}…` : t.id);
      const hashText = t.infoHash ? ` · 哈希 ${t.infoHash.slice(0, 10)}…` : '';
      const card = h('div', { class: 'taskcard' },
        h('div', { class: 'taskhead' },
          h('span', { class: 'tasktitle', text: title, title: rawTitle || t.infoHash || title }),
          h('span', { class: 'taskstate ' + t.status, text: label })
        ),
        h('div', { class: 'taskmeta', text: `保存到 ${t.targetPath || '/'}${hashText} · ${fmtAgo(t.addedAt)}` })
      );
      if (t.remote && t.remote.status !== undefined && t.remote.status !== null && t.remote.status !== -999) {
        const pct = Number(t.remote.percent) || 0;
        const code = String(t.remote.status);
        const label = REMOTE_STATE[code];
        card.appendChild(h('div', {
          class: 'taskmeta',
          text: `115 状态 ${code}${label ? `（${label}）` : ''}${pct > 0 ? ` · ${Math.round(pct)}%` : ''}`,
          title: '0 等待下载 · 1 下载中 · 2/10/11 已完成 · -1/3/9 失败 · 12 进行中',
        }));
      }
      if (t.error) card.appendChild(h('div', { class: 'taskmeta warn', text: t.error }));
      const actions = [];
      if (t.status === 'pending' || t.status === 'checking') {
        if (t.status === 'checking') {
          actions.push(h('button', { class: 'btn', type: 'button', text: '重新检查', onclick: () => {
            Queue.update(t.id, { status: 'pending', checkingAt: 0, error: '' });
            this.checkAll();
          } }));
        } else {
          actions.push(h('button', { class: 'btn', type: 'button', text: '立即检查', onclick: async () => { await this.checkAll(); } }));
        }
        actions.push(h('button', { class: 'btn', type: 'button', text: '按目录检查', onclick: () => this.forceCheckDiff(t.id) }));
        actions.push(h('button', { class: 'btn', type: 'button', text: '取消跟踪', onclick: () => { Queue.remove(t.id); this.refreshTasks(); } }));
      } else if (t.status === 'ready') {
        if (t.plan) {
          card.appendChild(h('div', { class: 'taskmeta', text: `保留 ${t.plan.stats.keep} · 待删 ${t.plan.stats.junk} · 改名 ${t.plan.stats.rename}` }));
          actions.push(h('button', { class: 'btn primary', type: 'button', text: '预览整理', onclick: () => this.openPreview(t.id) }));
          actions.push(h('button', { class: 'btn', type: 'button', text: '全自动执行', onclick: () => this.applyPlan(t.id) }));
        } else {
          actions.push(h('button', { class: 'btn', type: 'button', text: '手动整理', onclick: () => this.openPicker() }));
        }
        actions.push(h('button', { class: 'btn', type: 'button', text: '忽略', onclick: () => { Queue.update(t.id, { status: 'ignored' }); this.refreshTasks(); } }));
      } else if (t.status === 'organizing') {
        actions.push(h('button', { class: 'btn', type: 'button', text: '查看进度', onclick: () => this.openPreview(t.id) }));
      } else if (t.status === 'organized') {
        if (t.summary) card.appendChild(h('div', { class: 'taskmeta success', text: t.summary }));
        actions.push(h('button', { class: 'btn', type: 'button', text: '打开 115', onclick: () => this.openDir(t) }));
        actions.push(h('button', { class: 'btn', type: 'button', text: '删除记录', onclick: () => { Queue.remove(t.id); this.refreshTasks(); } }));
      } else if (t.status === 'failed' || t.status === 'timeout') {
        actions.push(h('button', { class: 'btn', type: 'button', text: '重试检查', onclick: async () => { Queue.update(t.id, { status: 'pending', error: '' }); await this.checkAll(); } }));
        actions.push(h('button', { class: 'btn', type: 'button', text: '删除记录', onclick: () => { Queue.remove(t.id); this.refreshTasks(); } }));
      } else {
        actions.push(h('button', { class: 'btn', type: 'button', text: '删除记录', onclick: () => { Queue.remove(t.id); this.refreshTasks(); } }));
      }
      if (actions.length) card.appendChild(h('div', { class: 'taskactions' }, ...actions));
      return card;
    },

    openTasks() {
      this.taskFilter = 'active';
      this.openPanel();
      this.showTab('tasks');
    },

    async checkAll() {
      if (Queue.polling) {
        if (!Queue.pollStartedAt || now() - Queue.pollStartedAt < 10 * 1000) {
          this.toast('正在检查，请稍候…', 'info', { timeout: 2500 });
          return;
        }
        // 检查卡住超过 10 秒：手动复位并回收“检查中”任务
        Queue.polling = false;
        Queue.recoverStaleChecks(true);
      }
      try {
        await Queue.poll(true);
        this.refreshTasks();
        this.toast('检查完成', 'success', { timeout: 2500 });
      } catch (e) {
        this.toast(e.message || '检查失败', 'error');
        if (e.risk) this.showRiskModal(e.risk);
      }
    },

    async forceCheckDiff(id) {
      const task = Queue.get(id);
      if (!task) return;
      try {
        const result = await Queue.detectByDiff(task);
        if (!result) {
          this.toast('目标目录没有发现新增内容；可以用「整理任意目录」手动处理', 'warn', { timeout: 5000 });
          return;
        }
        await Queue.finalize(id, task.remote || null, result);
        this.refreshTasks();
      } catch (e) {
        this.toast(e.message || '检查失败', 'error');
        if (e.risk) this.showRiskModal(e.risk);
      }
    },

    openDir(t) {
      const cid = t && t.result && t.result.parentCid ? t.result.parentCid : (t && t.targetCid) || '0';
      try { window.open('https://115.com/?cid=' + encodeURIComponent(cid) + '&mode=wangpan', '_blank', 'noopener'); } catch (_) {}
    },

    async applyPlan(id) {
      const task = Queue.get(id);
      if (!task || !task.plan) { this.toast('没有可执行的整理计划', 'warn'); return; }
      if (task.status === 'organizing') return;
      Queue.update(id, { status: 'organizing' });
      this.refreshTasks();
      try {
        const result = await Organizer.apply(task.plan);
        Queue.update(id, {
          status: 'organized',
          plan: null,
          summary: `删除 ${result.cleaned} · 改名 ${result.renamed}${result.wrapped ? ` · 归档到 ${result.wrapped.name}` : ''}${result.failed ? ` · 失败 ${result.failed}` : ''}`,
          errors: result.errors,
        });
        this.toast(`整理完成：删除 ${result.cleaned}，改名 ${result.renamed}${result.wrapped ? `，已归档到 ${result.wrapped.name}` : ''}`, 'success');
      } catch (e) {
        Queue.update(id, { status: 'ready', error: e.message });
        this.toast('整理失败：' + e.message, 'error');
        if (e.risk) this.showRiskModal(e.risk);
      }
      this.refreshTasks();
    },

    buildPreview() {
      this.els.previewBody = h('div');
      this.els.previewStatus = h('div', { class: 'status' });
      this.els.previewExec = h('button', { class: 'btn primary', type: 'button', text: '执行整理', onclick: () => this.executePreview() });
      return h('div', { class: 'overlay', hidden: true },
        h('div', { class: 'modal', style: 'width:560px' },
          h('header', null,
            h('strong', { text: '整理预览' }),
            h('span', { class: 'spacer' }),
            h('button', { class: 'iconbtn', type: 'button', title: '关闭', text: '×', onclick: () => { this.els.previewOverlay.hidden = true; } })
          ),
          h('div', { class: 'content' }, this.els.previewBody, this.els.previewStatus),
          h('div', { class: 'modal-actions' },
            h('button', { class: 'btn', type: 'button', text: '取消', onclick: () => { this.els.previewOverlay.hidden = true; } }),
            this.els.previewExec
          )
        )
      );
    },

    openPreview(id) {
      const task = Queue.get(id);
      if (!task) return;
      if (!task.plan) { this.toast('这个任务还没有整理计划', 'warn'); return; }
      this.openPreviewFor(task, task.plan);
    },

    openPreviewFor(task, plan) {
      this._previewTask = task;
      this._previewPlan = plan;
      this._previewConfirmed = false;
      this._previewJunkRows = [];
      this._previewRenameRows = [];
      this._previewWrapCheck = null;
      this._previewWrapInput = null;
      this.els.previewExec.onclick = () => this.executePreview();
      const body = this.els.previewBody;
      body.innerHTML = '';
      const stats = plan.stats;
      const modeLabel = MODE_LABEL[plan.mode] || plan.mode || '';
      body.appendChild(h('div', { class: 'previewstats' },
        h('div', { text: plan.kind === 'folder' ? '当前目录：' + (plan.rootName || '(未命名)') : '目标目录（平铺）' }),
        h('div', { text: `${modeLabel ? '模式：' + modeLabel + ' · ' : ''}文件 ${stats.files} · 保留 ${stats.keep}（${fmtBytes(stats.keepBytes)}） · 待删 ${stats.junk}（${fmtBytes(stats.junkBytes)}） · 改名 ${stats.rename}` })
      ));
      for (const w of plan.warnings || []) body.appendChild(h('div', { class: 'previewwarn', text: '⚠ ' + w.text }));
      if (plan.wrap) {
        this._previewWrapCheck = h('input', { type: 'checkbox' });
        this._previewWrapCheck.checked = true;
        this._previewWrapInput = h('input', { type: 'text', value: plan.wrap.name || '' });
        this._previewWrapInput.style.flex = '1';
        body.appendChild(h('div', { class: 'previewsec', text: '归档到新文件夹' }));
        body.appendChild(h('div', { class: 'previewrow' },
          this._previewWrapCheck,
          h('div', { class: 'pname' },
            h('div', { class: 'previewsec', style: 'margin:0', text: '文件夹名' }),
            this._previewWrapInput
          ),
          h('span', { class: 'pmeta', text: `${plan.wrap.ids.length} 项` })
        ));
      }
      if (plan.kind === 'folder') {
        this._previewFolderCheck = h('input', { type: 'checkbox' });
        this._previewFolderCheck.checked = !!(plan.folderRename && plan.folderRename.changed);
        this._previewFolderInput = h('input', { type: 'text', value: (plan.folderRename && plan.folderRename.newName) || plan.rootName || '' });
        this._previewFolderInput.style.flex = '1';
        body.appendChild(h('div', { class: 'previewrow' },
          this._previewFolderCheck,
          h('div', { class: 'pname' },
            h('div', { class: 'previewsec', style: 'margin:0', text: '文件夹名' }),
            this._previewFolderInput
          )
        ));
      }
      if (plan.junk && plan.junk.length) {
        body.appendChild(h('div', { class: 'previewsec', text: `待删除（${plan.junk.length}）` }));
        for (const item of plan.junk) {
          const check = h('input', { type: 'checkbox' });
          check.checked = true;
          body.appendChild(h('div', { class: 'previewrow' },
            check,
            h('span', { class: 'pname', text: (item.isFolder ? '📁 ' : '') + item.name, title: item.name }),
            h('span', { class: 'pmeta', text: (REASON_LABEL[item.reason] || item.reason) + ' · ' + fmtBytes(item.size) })
          ));
          this._previewJunkRows.push({ check, item });
        }
      }
      if (plan.renames && plan.renames.length) {
        body.appendChild(h('div', { class: 'previewsec', text: `改名（${plan.renames.length}）` }));
        for (const item of plan.renames) {
          const check = h('input', { type: 'checkbox' });
          check.checked = true;
          body.appendChild(h('div', { class: 'previewrow' },
            check,
            h('span', { class: 'pname', text: (item.isFolder ? '📁 ' : '') + item.oldName + '  →  ' + item.newName, title: item.oldName + ' → ' + item.newName })
          ));
          this._previewRenameRows.push({ check, item });
        }
      }
      if (!plan.junk.length && !plan.renames.length && !(plan.folderRename && plan.folderRename.changed) && !plan.wrap) {
        body.appendChild(h('div', { class: 'empty', text: '没有需要处理的项' }));
      }
      this.els.previewStatus.textContent = '';
      this.els.previewExec.textContent = '执行整理';
      this.els.previewExec.disabled = false;
      this.els.previewOverlay.hidden = false;
    },

    async executePreview() {
      const plan = this._previewPlan;
      if (!plan) return;
      const junk = (this._previewJunkRows || []).filter((r) => r.check.checked).map((r) => r.item);
      const renames = (this._previewRenameRows || []).filter((r) => r.check.checked && r.item.changed).map((r) => r.item);
      let folderRename = null;
      if (plan.kind === 'folder' && this._previewFolderCheck && this._previewFolderCheck.checked) {
        const newName = String(this._previewFolderInput.value || '').trim();
        if (newName && newName !== plan.rootName) {
          folderRename = { fileId: plan.rootId, oldName: plan.rootName, newName, changed: true };
        }
      }
      let wrap = null;
      if (plan.wrap && this._previewWrapCheck && this._previewWrapCheck.checked) {
        const name = String(this._previewWrapInput.value || '').trim();
        if (name) wrap = Object.assign({}, plan.wrap, { name });
      }
      if (!junk.length && !renames.length && !folderRename && !wrap) {
        this.toast('没有勾选任何操作', 'warn');
        return;
      }
      const junkBytes = junk.reduce((s, x) => s + (Number(x.size) || 0), 0);
      const unsafe = (plan.stats.totalBytes && junkBytes / plan.stats.totalBytes > 0.5) || junk.length > 100;
      if (unsafe && !this._previewConfirmed) {
        this._previewConfirmed = true;
        this.els.previewExec.textContent = '确认执行（再点一次）';
        this.toast('删除量较大，请再点一次确认', 'warn');
        return;
      }
      const modified = Object.assign({}, plan, { junk, renames, folderRename, wrap });
      this.els.previewExec.disabled = true;
      this.els.previewStatus.textContent = '正在执行…';
      try {
        const result = await Organizer.apply(modified, (msg) => { this.els.previewStatus.textContent = msg; });
        this.els.previewStatus.textContent = `完成：删除 ${result.cleaned}，改名 ${result.renamed}${result.failed ? `，失败 ${result.failed}` : ''}`;
        const task = this._previewTask;
        if (task && task.id && !String(task.id).startsWith('manual-')) {
          Queue.update(task.id, {
            status: 'organized',
            plan: null,
            summary: `删除 ${result.cleaned} · 改名 ${result.renamed}${result.wrapped ? ` · 归档到 ${result.wrapped.name}` : ''}${result.failed ? ` · 失败 ${result.failed}` : ''}`,
            errors: result.errors,
          });
        }
        this.toast(`整理完成：删除 ${result.cleaned}，改名 ${result.renamed}${result.wrapped ? `，已归档到 ${result.wrapped.name}` : ''}`, 'success');
        setTimeout(() => { this.els.previewOverlay.hidden = true; this.refreshTasks(); }, 900);
      } catch (e) {
        this.els.previewStatus.textContent = '失败：' + e.message;
        if (e.risk) this.showRiskModal(e.risk);
      } finally {
        this.els.previewExec.disabled = false;
        this.els.previewExec.textContent = '执行整理';
        this._previewConfirmed = false;
      }
    },

    async prepareManual(cid, name) {
      this.toast('正在扫描目录…', 'info', { timeout: 3000 });
      try {
        Pan115.clearFolderCache(cid);
        const plan = await Organizer.planFolder(cid, name, Queue.opts());
        if (!plan || (!plan.junk.length && !plan.renames.length && !plan.folderRename)) {
          this.toast('这个目录没有需要整理的项', 'info');
          return;
        }
        this.openPreviewFor({ id: 'manual-' + now(), name }, plan);
      } catch (e) {
        this.toast(e.message || '扫描失败', 'error');
        if (e.risk) this.showRiskModal(e.risk);
      }
    },

    async diagnose() {
      try {
        const list = await Pan115.listTasks(1);
        const text = JSON.stringify(list.slice(0, 8).map((x) => x.raw), null, 2);
        this.showText('115 最近任务（诊断）', text || '没有任务');
      } catch (e) {
        this.toast(e.message || '诊断失败', 'error');
        if (e.risk) this.showRiskModal(e.risk);
      }
    },

    showText(title, text) {
      this._previewPlan = null;
      const body = this.els.previewBody;
      body.innerHTML = '';
      body.appendChild(h('div', { class: 'previewsec', style: 'margin-top:0', text: title }));
      body.appendChild(h('pre', { class: 'previewpre', text }));
      this.els.previewStatus.textContent = '';
      this.els.previewExec.textContent = '关闭';
      this.els.previewExec.onclick = () => { this.els.previewOverlay.hidden = true; };
      this.els.previewOverlay.hidden = false;
    },

    // ---- picker

    openPicker() {
      this.picker = { cid: '0', crumbs: [{ name: '根目录', cid: '0' }], busy: false };
      this.els.pickerOverlay.hidden = false;
      this.els.newDirName.value = '';
      this.loadDir('0', undefined, false);
    },

    async loadDir(cid, name, pushCrumb) {
      if (this.picker.busy) return;
      this.picker.busy = true;
      const box = this.els.pickerList;
      box.innerHTML = '';
      box.appendChild(h('div', { class: 'empty', text: '加载中…' }));
      try {
        const list = await Pan115.listFolder(cid, { foldersOnly: true });
        this.picker.cid = String(cid || 0);
        if (pushCrumb) {
          const exists = this.picker.crumbs.findIndex((c) => c.cid === this.picker.cid);
          if (exists >= 0) this.picker.crumbs = this.picker.crumbs.slice(0, exists + 1);
          else this.picker.crumbs.push({ name: name || '目录', cid: this.picker.cid });
        }
        this.renderCrumbs();
        this.renderPickerList(list);
      } catch (e) {
        box.innerHTML = '';
        box.appendChild(h('div', { class: 'empty', text: e.message || '加载目录失败' }));
        if (e.risk) this.showRiskModal(e.risk);
      } finally {
        this.picker.busy = false;
      }
    },

    renderCrumbs() {
      const box = this.els.pickerCrumbs;
      box.innerHTML = '';
      this.picker.crumbs.forEach((c, i) => {
        if (i) box.appendChild(h('span', { text: '/' }));
        box.appendChild(h('button', {
          type: 'button', text: c.name,
          onclick: () => {
            this.picker.crumbs = this.picker.crumbs.slice(0, i + 1);
            this.loadDir(c.cid, c.name, false);
          },
        }));
      });
    },

    renderPickerList(list) {
      const box = this.els.pickerList;
      box.innerHTML = '';
      if (!list.length) {
        box.appendChild(h('div', { class: 'empty', text: '此目录下没有子文件夹' }));
        return;
      }
      for (const item of list) {
        box.appendChild(h('div', {
          class: 'dirrow',
          onclick: () => this.loadDir(item.id, item.name, true),
        },
          h('span', { class: 'ico', text: '📁' }),
          h('span', { class: 'name', text: item.name, title: item.name })
        ));
      }
    },

    async pickerNew() {
      const name = String(this.els.newDirName.value || '').trim();
      if (!name) return;
      if (name.includes('/')) {
        this.toast('文件夹名不能包含 /', 'error');
        return;
      }
      try {
        await Pan115.mkdir(name, this.picker.cid);
        this.els.newDirName.value = '';
        this.toast('已创建 ' + name, 'success');
        await this.loadDir(this.picker.cid, undefined, false);
      } catch (e) {
        this.toast(e.message || '新建失败', 'error');
        if (e.risk) this.showRiskModal(e.risk);
      }
    },

    pickerOrganize() {
      if (this.picker.busy) return;
      if (this.picker.crumbs.length <= 1) {
        this.toast('请先进入一个要整理的目录', 'warn');
        return;
      }
      const cid = String(this.picker.cid);
      const name = this.picker.crumbs[this.picker.crumbs.length - 1].name;
      this.els.pickerOverlay.hidden = true;
      this.prepareManual(cid, name);
    },

    pickerOk() {
      if (this.picker.busy) return;
      const cid = String(this.picker.cid || '0');
      const parts = this.picker.crumbs.slice(1).map((c) => c.name).filter(Boolean);
      const path = parts.length ? '/' + parts.join('/') : '/';
      Store.set('defaultPath', path);
      Store.set('defaultCid', cid);
      const recent = (Store.get('recentPaths', []) || []).filter((x) => x && x.path !== path);
      recent.unshift({ path, cid, at: now() });
      Store.set('recentPaths', recent.slice(0, 8));
      const name = this.picker.crumbs[this.picker.crumbs.length - 1].name || '';
      this.recordDir(path, cid, name);
      this.els.pickerOverlay.hidden = true;
      this.renderPath();
      this.renderFavorites();
      this.renderSettings();
      this.toast('默认目录已设为 ' + path, 'success');
    },

    // ---- risk / notice

    refreshRisk() {
      if (!this.ready) return;
      const st = Risk.current;
      const busyUntil = Math.max(Number(st.until) || 0, Scheduler.pausedUntil || 0);
      const busyLeft = Math.ceil((busyUntil - now()) / 1000);
      const bar = this.els.riskbar;
      const badge = this.els.badge;
      bar.hidden = true;
      badge.hidden = true;

      if (st.state === 'verify' || st.state === 'auth') {
        this.els.riskText.textContent =
          st.state === 'verify' ? '115 要求人机验证，操作已暂停' : '115 登录已失效';
        this.els.riskBtn.hidden = false;
        this.els.riskBtn.textContent = st.state === 'verify' ? '去验证' : '去登录';
        bar.hidden = false;
        badge.hidden = false;
        badge.textContent = '!';
        badge.className = 'badge';
      } else if (busyLeft > 0) {
        this.els.riskText.textContent = `115 操作太频繁，冷却中（${busyLeft} 秒）`;
        this.els.riskBtn.hidden = true;
        bar.hidden = false;
        badge.hidden = false;
        badge.textContent = '…';
        badge.className = 'badge warn';
      }

      if (busyLeft > 0 && !this._riskTimer) {
        this._riskTimer = setInterval(() => {
          const till = Math.max(Number(Risk.current.until) || 0, Scheduler.pausedUntil || 0);
          if (now() >= till) {
            clearInterval(this._riskTimer);
            this._riskTimer = 0;
            if (Risk.current.state === 'busy') Risk.clear();
          }
          this.refreshRisk();
        }, 5000);
      }
      if (bar.hidden) {
        const readyCount = Queue.list().filter((x) => x.status === 'ready').length;
        if (readyCount > 0) {
          badge.hidden = false;
          badge.textContent = String(readyCount);
          badge.className = 'badge task';
        }
      }
    },

    showRiskModal(risk) {
      risk = risk || Risk.current;
      const kind = risk.kind || risk.state || 'verify';
      if (kind === 'auth') {
        this.els.riskTitle.textContent = '115 登录已失效';
        this.els.riskBody.textContent = '请先登录 115，然后回来点“我已登录”。';
        this.els.riskOpen.textContent = '打开 115 登录';
        this.els.riskDone.textContent = '我已登录';
      } else if (kind === 'verify') {
        this.els.riskTitle.textContent = '115 要求人机验证';
        this.els.riskBody.textContent =
          (risk.message || '115 检测到操作频繁，需要先通过人机验证。') +
          ' 请先在 115 完成验证，再回来继续。';
        this.els.riskOpen.textContent = '打开 115 验证';
        this.els.riskDone.textContent = '我已完成验证';
      } else {
        this.els.riskTitle.textContent = '115 操作已暂停';
        this.els.riskBody.textContent = risk.message || '请稍后再试。';
        this.els.riskOpen.textContent = '打开 115';
        this.els.riskDone.textContent = '我已处理';
      }
      this.els.riskOpen.onclick = () => {
        try { window.open('https://115.com/?tab=offline&mode=wangpan', '_blank', 'noopener'); } catch (_) {}
      };
      this.els.riskDone.onclick = async () => {
        this.els.riskDone.disabled = true;
        const ok = await Risk.probe();
        this.els.riskDone.disabled = false;
        if (ok) this.els.riskOverlay.hidden = true;
      };
      this.els.riskOverlay.hidden = false;
    },

    // ---- toast / pill / copy

    toast(message, type, opts) {
      if (!this.ready || !this.els.toasts) return;
      opts = opts || {};
      const node = h('div', { class: 'toast ' + (type || 'info') },
        h('div', { class: 'msg', text: message })
      );
      if (opts.action) {
        node.appendChild(h('button', {
          class: 'act', type: 'button', text: opts.action,
          onclick: () => {
            try { opts.onAction && opts.onAction(); } catch (_) {}
            node.remove();
          },
        }));
      }
      node.appendChild(h('button', {
        class: 'act', type: 'button', text: '×',
        onclick: () => node.remove(),
      }));
      this.els.toasts.appendChild(node);
      setTimeout(() => node.remove(), Math.max(2000, Number(opts.timeout) || 6000));
    },

    onSelection() {
      try {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) return;
        const text = sel.toString();
        if (!text || text.length > 8000) return;
        const links = Link.extract(text);
        if (!links.length) return;
        if (this._selToastAt && now() - this._selToastAt < 3000) return;
        this._selToastAt = now();
        this.toast(
          `选中${links.length > 1 ? ' ' + links.length + ' 个链接' : '磁力链接'}`,
          'info',
          {
            action: '发送到 115',
            timeout: 8000,
            onAction: () => this.openPanel(links.map((l) => l.url).join('\n')),
          }
        );
      } catch (_) {}
    },

    onCopy(e) {
      try {
        if (!Store.get('copyToast', true)) return;
        const data = e.clipboardData && e.clipboardData.getData('text/plain');
        const sel = window.getSelection ? window.getSelection().toString() : '';
        const links = Link.extract(data || sel || '');
        if (!links.length) return;
        this.toast(
          `已复制${links.length > 1 ? ' ' + links.length + ' 个链接' : '磁力链接'}`,
          'info',
          {
            action: '发送到 115',
            timeout: 8000,
            onAction: () => this.openPanel(links.map((l) => l.url).join('\n')),
          }
        );
      } catch (_) {}
    },
  };

  // ---------------------------------------------------------------- update

  const Update = {
    cacheTtl: 6 * 3600 * 1000,
    cached() {
      const c = Store.get('updateCheck', null);
      return c && c.latest ? c : null;
    },
    async sourceVersion(src) {
      const sep = src.url.includes('?') ? '&' : '?';
      const res = await rawRequest({
        method: 'GET',
        url: src.url + sep + '_=' + now(),
        headers: { Accept: src.api ? 'application/vnd.github+json' : '*/*' },
        timeout: 15000,
      });
      let text = res.text || '';
      if (src.api && res.json && res.json.content) {
        try { text = atob(String(res.json.content).replace(/\s+/g, '')); } catch (_) {}
      }
      const m = text.match(/\/\/\s*@version\s+([0-9]+(?:\.[0-9]+)*)/);
      return m ? m[1] : '';
    },
    async check(force) {
      const c = this.cached();
      if (!force && c && now() - Number(c.at) < this.cacheTtl) return c;
      for (const src of UPDATE_SOURCES) {
        try {
          const latest = await this.sourceVersion(src);
          if (!latest) continue;
          const data = { latest, source: src.name, url: src.install, at: now() };
          Store.set('updateCheck', data);
          return data;
        } catch (_) {}
      }
      throw new Error('检查更新失败，请稍后再试');
    },
  };

  // ---------------------------------------------------------------- organizer

  const Organizer = {
    VIDEO: new Set(['mp4', 'mkv', 'avi', 'wmv', 'mov', 'm4v', 'ts', 'm2ts', 'mts', 'flv', 'rmvb', 'webm', 'mpg', 'mpeg', 'vob', 'iso']),
    SUBTITLE: new Set(['srt', 'ass', 'ssa', 'sub', 'idx', 'sup', 'vtt', 'smi', 'sami', 'ttml', 'dfxp', 'sbv', 'pgs', 'mks', 'usf', 'rt', 'stl', 'psb', 'pes']),
    AUDIO: new Set(['flac', 'mp3', 'aac', 'm4a', 'wav', 'dts', 'ac3', 'ape', 'ogg', 'mka']),
    IMAGE: new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'heic']),
    ARCHIVE: new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'iso']),
    JUNK: new Set(['txt', 'url', 'html', 'htm', 'doc', 'docx', 'pdf', 'xls', 'xlsx', 'ppt', 'pptx', 'exe', 'msi', 'bat', 'cmd', 'lnk', 'torrent', 'nfo', 'diz', 'ini', 'bak', 'tmp', 'website', 'mht', 'mhtml', 'db', 'apk', 'swf', 'vbs', 'scr', 'hta', 'cue', 'sfv', 'log', 'xml', 'json', 'md']),
    MAX_DEPTH: 2,
    MAX_FOLDERS: 24,
    MAX_FILES: 2000,

    ext(name) {
      const m = String(name || '').match(/\.([A-Za-z0-9]{1,8})$/);
      return m ? m[1].toLowerCase() : '';
    },
    isVideo(name) { return this.VIDEO.has(this.ext(name)); },
    isSubtitle(name) { return this.SUBTITLE.has(this.ext(name)); },
    isAudio(name) { return this.AUDIO.has(this.ext(name)); },
    isImage(name) { return this.IMAGE.has(this.ext(name)); },
    isArchive(name) { return this.ARCHIVE.has(this.ext(name)); },
    isJunkExt(name) { return this.JUNK.has(this.ext(name)); },

    async scanFolder(cid, rootName) {
      const root = {
        id: String(cid),
        isFolder: true,
        name: String(rootName || ''),
        size: 0,
        parentId: '',
        children: [],
      };
      const state = { folders: 0, files: 0, truncated: false };
      await this._scanInto(root, root.id, 0, state);
      if (state.truncated) root.truncated = true;
      return root;
    },

    async _scanInto(node, cid, depth, state) {
      if (state.folders >= this.MAX_FOLDERS || state.files >= this.MAX_FILES) {
        state.truncated = true;
        return;
      }
      const items = await Pan115.listFolder(cid, {});
      for (const item of items) {
        if (state.files >= this.MAX_FILES) { state.truncated = true; break; }
        const entry = {
          id: item.id,
          isFolder: item.isFolder,
          name: item.name,
          size: item.size,
          parentId: String(cid),
          children: [],
        };
        node.children.push(entry);
        if (item.isFolder) {
          state.folders += 1;
          if (depth < this.MAX_DEPTH) await this._scanInto(entry, item.id, depth + 1, state);
          else state.truncated = true;
        } else {
          state.files += 1;
        }
      }
    },

    flatten(node, out, folderPath) {
      out = out || [];
      folderPath = folderPath || [];
      for (const child of node.children || []) {
        if (child.isFolder) this.flatten(child, out, folderPath.concat(child.name));
        else out.push({ entry: child, folderPath });
      }
      return out;
    },

    collectFolders(node, out) {
      out = out || [];
      for (const child of node.children || []) {
        if (!child.isFolder) continue;
        out.push(child);
        this.collectFolders(child, out);
      }
      return out;
    },

    classify(entry, ctx) {
      const name = entry.name;
      const ext = this.ext(name);
      const size = Number(entry.size) || 0;

      // 通用：只清广告名，不按扩展名/大小删
      if (ctx.mode === 'generic') {
        if (Name.isAdFile(name)) return { keep: false, reason: 'ad-name' };
        return { keep: true, reason: 'generic' };
      }
      // 软件/电子书：保留 exe/zip/pdf/doc，只清广告名和小广告快捷方式
      if (ctx.mode === 'software') {
        if (Name.isAdFile(name)) return { keep: false, reason: 'ad-name' };
        if (['url', 'website', 'htm', 'html'].includes(ext) && size < 1024 * 1024) {
          return { keep: false, reason: 'ad-file' };
        }
        return { keep: true, reason: 'software' };
      }
      // 音乐：保留音频/封面/字幕/说明，不按大小删
      if (ctx.mode === 'music') {
        if (Name.isAdFile(name)) return { keep: false, reason: 'ad-name' };
        if (this.SUBTITLE.has(ext) && ctx.keepSubtitles) return { keep: true, reason: 'subtitle' };
        if (['url', 'website', 'htm', 'html'].includes(ext) && size < 1024 * 1024) {
          return { keep: false, reason: 'ad-file' };
        }
        return { keep: true, reason: 'music' };
      }

      // 影视/剧集：没有足够大的视频时只清广告名，避免把软件/音乐/电子书误判成垃圾
      if (ctx.conservative) {
        if (this.SUBTITLE.has(this.ext(entry.name)) && ctx.keepSubtitles) return { keep: true, reason: 'subtitle' };
        if (ctx.keepSubtitles && /subs?|字幕|chs|cht|中字|双语|中英|srt/.test(entry.name.toLowerCase())) {
          return { keep: true, reason: 'subtitle-name' };
        }
        if (Name.isAdFile(entry.name)) return { keep: false, reason: 'ad-name' };
        return { keep: true, reason: 'conservative' };
      }
      if (this.SUBTITLE.has(ext)) {
        if (ctx.keepSubtitles) return { keep: true, reason: 'subtitle' };
        return size > 50 * 1024 * 1024
          ? { keep: false, reason: 'big-subtitle' }
          : { keep: true, reason: 'subtitle' };
      }
      if (ctx.deleteSamples && Name.isSample(name)) return { keep: false, reason: 'sample-name' };
      if (ctx.mode === 'series' && ctx.keepExtras && Name.isExtra(name)) return { keep: true, reason: 'extra' };
      if (this.VIDEO.has(ext)) {
        if (entry.id === ctx.largestId) return { keep: true, reason: 'largest-video' };
        if (ctx.mode === 'series') {
          if (size < ctx.minVideoBytes) return { keep: false, reason: 'sample' };
          return { keep: true, reason: 'video' };
        }
        const threshold = Math.max(ctx.minVideoBytes, ctx.largestSize * ctx.keepRatio);
        if (size < threshold) return { keep: false, reason: 'sample' };
        return { keep: true, reason: 'video' };
      }
      if (this.AUDIO.has(ext)) {
        if (size < ctx.minAudioBytes) return { keep: false, reason: 'small-audio' };
        return { keep: true, reason: 'audio' };
      }
      if (this.IMAGE.has(ext)) {
        return ctx.keepImages ? { keep: true, reason: 'image' } : { keep: false, reason: 'image' };
      }
      if (this.JUNK.has(ext)) {
        if (ctx.keepSubtitles && /subs?|字幕|chs|cht|中字|双语|中英|srt/.test(entry.name.toLowerCase())) {
          return { keep: true, reason: 'subtitle-name' };
        }
        if (ctx.keepNfo && ext === 'nfo') return { keep: true, reason: 'nfo' };
        return { keep: false, reason: 'junk-ext' };
      }
      if (this.ARCHIVE.has(ext)) {
        if (/subs?|字幕|chs|cht|中字|双语|中英/.test(entry.name.toLowerCase())) {
          return { keep: true, reason: 'subtitle-archive' };
        }
        if (size < 10 * 1024 * 1024) return { keep: false, reason: 'small-archive' };
        return { keep: true, reason: 'archive' };
      }
      return { keep: true, reason: 'other' };
    },

    ctxFor(files, opts) {
      const mode = opts.mode || 'movie';
      let largest = null;
      for (const f of files) {
        if (!this.isVideo(f.entry.name)) continue;
        if (!largest || f.entry.size > largest.entry.size) largest = f;
      }
      const largestSize = largest ? Number(largest.entry.size) || 0 : 0;
      return {
        mode,
        largestId: largest ? largest.entry.id : '',
        largestSize,
        conservative: (mode === 'movie' || mode === 'series') && (!largest || largestSize < 50 * 1024 * 1024),
        minVideoBytes: Math.max(0, Number(opts.minVideoMB ?? 100)) * 1024 * 1024,
        keepRatio: Math.max(0, Number(opts.keepRatio ?? 1)) / 100,
        minAudioBytes: Math.max(0, Number(opts.minAudioMB ?? 20)) * 1024 * 1024,
        keepImages: !!opts.keepImages,
        keepNfo: !!opts.keepNfo,
        keepSubtitles: opts.keepSubtitles !== false,
        deleteSamples: opts.deleteSamples !== false,
        keepExtras: opts.keepExtras !== false,
      };
    },

    _hasChildren(folder) {
      return !!(folder.children && folder.children.length);
    },
    _isDescendant(file, folder, folders) {
      let pid = file.entry.parentId;
      const visited = new Set();
      while (pid && !visited.has(pid)) {
        visited.add(pid);
        if (pid === folder.id) return true;
        const parent = folders.find((f) => f.id === pid);
        if (!parent) break;
        pid = parent.parentId;
      }
      return false;
    },
    _folderInsideAny(folder, junkFolders, folders) {
      let pid = folder.parentId;
      const visited = new Set();
      while (pid && !visited.has(pid)) {
        visited.add(pid);
        if (junkFolders.some((j) => j.id === pid)) return true;
        const parent = folders.find((f) => f.id === pid);
        if (!parent) break;
        pid = parent.parentId;
      }
      return false;
    },

    planTree(root, opts) {
      opts = opts || {};
      const files = this.flatten(root);
      const folders = this.collectFolders(root);
      const ctx = this.ctxFor(files, opts);
      const junk = [];
      const keeps = [];
      for (const f of files) {
        const c = this.classify(f.entry, ctx);
        const item = {
          id: f.entry.id,
          name: f.entry.name,
          size: Number(f.entry.size) || 0,
          isFolder: false,
          reason: c.reason,
          path: f.folderPath.join('/'),
        };
        const isSub = this.SUBTITLE.has(this.ext(f.entry.name));
        const protect = c.keep && ((isSub && ctx.keepSubtitles) || !Name.isAdFile(f.entry.name));
        if (f.entry.id === ctx.largestId || protect) {
          keeps.push(item);
        } else {
          if (c.keep) item.reason = 'ad-name';
          junk.push(item);
        }
      }
      const keepIds = new Set(keeps.map((x) => x.id));
      const folderJunk = [];
      for (const f of folders) {
        const descendants = files.filter((x) => this._isDescendant(x, f, folders));
        if (descendants.some((x) => keepIds.has(x.entry.id))) continue;
        const empty = !this._hasChildren(f) && !descendants.length;
        const adLike = Name.isAdName(f.name);
        if (adLike || empty || descendants.length) {
          folderJunk.push({
            id: f.id,
            name: f.name,
            size: 0,
            isFolder: true,
            reason: adLike ? 'junk-folder' : (empty ? 'empty-folder' : 'all-junk'),
          });
        }
      }
      const topJunkFolders = folderJunk.filter((f) => !this._folderInsideAny(f, folderJunk, folders));
      const junkFolderChildIds = new Set();
      for (const jf of topJunkFolders) {
        for (const f of files) {
          if (this._isDescendant(f, jf, folders)) junkFolderChildIds.add(f.entry.id);
        }
      }
      const junkFiles = junk.filter((x) => !junkFolderChildIds.has(x.id));
      const junkAll = topJunkFolders.concat(junkFiles);

      const renames = [];
      const used = new Set();
      for (const k of keeps) {
        const newName = Name.cleanFileName(k.name);
        if (!newName || newName === k.name) continue;
        let candidate = newName;
        if (used.has(candidate)) {
          const { stem, ext } = Name.splitExt(newName);
          let i = 1;
          while (used.has(stem + '.' + String(i).padStart(2, '0') + ext)) i += 1;
          candidate = stem + '.' + String(i).padStart(2, '0') + ext;
        }
        used.add(candidate);
        renames.push({ fileId: k.id, oldName: k.name, newName: candidate, changed: true });
      }

      // 子文件夹改名（只改还有保留内容的文件夹）
      const usedFolders = new Set();
      for (const f of folders) {
        const descendants = files.filter((x) => this._isDescendant(x, f, folders));
        if (!descendants.some((x) => keepIds.has(x.entry.id))) continue;
        const newName = Name.clean(f.name);
        if (!newName || newName === f.name) continue;
        let candidate = newName;
        if (usedFolders.has(candidate)) {
          let i = 1;
          while (usedFolders.has(candidate + '.' + String(i).padStart(2, '0'))) i += 1;
          candidate = candidate + '.' + String(i).padStart(2, '0');
        }
        usedFolders.add(candidate);
        renames.push({ fileId: f.id, oldName: f.name, newName: candidate, isFolder: true, changed: true });
      }

      let folderRename = null;
      const baseName = String(opts.rootName || root.name || '');
      let cleanFolder = Name.clean(baseName);
      if (!cleanFolder && ctx.largestId) {
        const largest = files.find((f) => f.entry.id === ctx.largestId);
        if (largest) cleanFolder = Name.cleanFileName(largest.entry.name).replace(/\.[^.]+$/, '');
      }
      if (cleanFolder && cleanFolder !== baseName) {
        folderRename = { fileId: root.id, oldName: baseName, newName: cleanFolder, changed: true };
      }

      const totalBytes = files.reduce((s, x) => s + (Number(x.entry.size) || 0), 0);
      const junkBytes = junkAll.reduce((s, x) => s + (Number(x.size) || 0), 0);
      const warnings = [];
      if (!ctx.largestId) warnings.push({ code: 'no-video', text: '没有找到视频文件，已切换为保守模式（只清广告名）' });
      else if (ctx.conservative) warnings.push({ code: 'no-video', text: '视频较小，已切换为保守模式（只清广告名）' });
      if (totalBytes && junkBytes / totalBytes > 0.5) warnings.push({ code: 'large-junk', text: '待删除内容超过总量 50%，请逐项确认' });
      if (junkAll.length > 100) warnings.push({ code: 'many-junk', text: '待删除项目超过 100 个，请逐项确认' });
      if (root.truncated) warnings.push({ code: 'truncated', text: '目录较大，只扫描了前一部分，建议手动确认' });

      return {
        kind: 'folder',
        mode: ctx.mode,
        rootId: root.id,
        rootName: baseName,
        targetCid: String(opts.targetCid || ''),
        folderRename,
        renames,
        junk: junkAll,
        keeps,
        stats: {
          files: files.length,
          keep: keeps.length,
          junk: junkAll.length,
          totalBytes,
          junkBytes,
          keepBytes: Math.max(0, totalBytes - junkBytes),
          rename: renames.length,
        },
        warnings,
        safe: !warnings.some((w) => ['large-junk', 'many-junk', 'truncated'].includes(w.code)),
      };
    },

    planEntries(entries, opts) {
      opts = opts || {};
      const files = (entries || []).filter((e) => e && !e.isFolder).map((e) => ({ entry: e, folderPath: [] }));
      const ctx = this.ctxFor(files, opts);
      const junk = [];
      const keeps = [];
      for (const f of files) {
        const c = this.classify(f.entry, ctx);
        const item = { id: f.entry.id, name: f.entry.name, size: Number(f.entry.size) || 0, isFolder: false, reason: c.reason };
        const isSub = this.SUBTITLE.has(this.ext(f.entry.name));
        const protect = c.keep && ((isSub && ctx.keepSubtitles) || !Name.isAdFile(f.entry.name));
        if (f.entry.id === ctx.largestId || protect) {
          keeps.push(item);
        } else {
          if (c.keep) item.reason = 'ad-name';
          junk.push(item);
        }
      }
      const renames = [];
      for (const k of keeps) {
        const newName = Name.cleanFileName(k.name);
        if (newName && newName !== k.name) renames.push({ fileId: k.id, oldName: k.name, newName, changed: true });
      }
      const totalBytes = files.reduce((s, x) => s + (Number(x.entry.size) || 0), 0);
      const junkBytes = junk.reduce((s, x) => s + (Number(x.size) || 0), 0);
      const warnings = [];
      if (!ctx.largestId) warnings.push({ code: 'no-video', text: '没有找到视频文件，已切换为保守模式（只清广告名）' });
      else if (ctx.conservative) warnings.push({ code: 'no-video', text: '视频较小，已切换为保守模式（只清广告名）' });
      return {
        kind: 'flat',
        mode: ctx.mode,
        rootId: '',
        rootName: '',
        targetCid: String(opts.targetCid || ''),
        folderRename: null,
        renames,
        junk,
        keeps,
        stats: {
          files: files.length,
          keep: keeps.length,
          junk: junk.length,
          totalBytes,
          junkBytes,
          keepBytes: Math.max(0, totalBytes - junkBytes),
          rename: renames.length,
        },
        warnings,
        safe: !warnings.some((w) => ['large-junk', 'many-junk'].includes(w.code)),
      };
    },

    async planFolder(cid, rootName, opts) {
      const root = await this.scanFolder(cid, rootName);
      return this.planTree(root, Object.assign({}, opts, { rootName }));
    },

    async apply(plan, onProgress) {
      const result = { cleaned: 0, renamed: 0, failed: 0, errors: [] };
      const progress = (msg) => { try { onProgress && onProgress(msg); } catch (_) {} };
      const junk = (plan.junk || []).slice();
      const folders = junk.filter((x) => x.isFolder);
      const files = junk.filter((x) => !x.isFolder);
      const batches = [];
      for (let i = 0; i < folders.length; i += 10) batches.push(folders.slice(i, i + 10));
      for (let i = 0; i < files.length; i += 20) batches.push(files.slice(i, i + 20));
      for (let bi = 0; bi < batches.length; bi += 1) {
        const batch = batches[bi];
        progress(`正在删除 ${result.cleaned + batch.length}/${junk.length}…`);
        try {
          await Pan115.deleteMany(batch.map((x) => x.id));
          result.cleaned += batch.length;
        } catch (e) {
          if (e instanceof RiskError) throw e;
          // 批量失败时逐个回退
          for (const item of batch) {
            try {
              await Pan115.deleteMany([item.id]);
              result.cleaned += 1;
            } catch (err) {
              if (err instanceof RiskError) throw err;
              result.failed += 1;
              result.errors.push(`${item.name}：${err.message}`);
            }
            await sleep(500);
          }
        }
        if (bi < batches.length - 1) await sleep(800);
      }

      const wrap = plan.wrap;
      if (wrap && wrap.name && Array.isArray(wrap.ids) && wrap.ids.length) {
        // 刚删掉的文件不要带进 move 请求
        const removed = new Set(junk.map((x) => String(x.id)));
        const moveIds = wrap.ids.map(String).filter((id) => !removed.has(id));
        if (moveIds.length) {
          progress('正在新建文件夹并移入…');
          try {
            const cid = await Pan115.mkdir(wrap.name, wrap.parentCid || '0');
            await Pan115.move(moveIds, cid);
            result.wrapped = { cid, name: wrap.name, count: moveIds.length };
          } catch (e) {
            if (e instanceof RiskError) throw e;
            result.failed += 1;
            result.errors.push(`归档到文件夹失败：${e.message}`);
          }
        }
      }

      const renames = (plan.renames || []).filter((x) => x.changed);
      if (renames.length) {
        progress(`正在改名 ${renames.length} 项…`);
        const r = await Pan115.renameMany(renames.map((x) => ({ fileId: x.fileId, newName: x.newName })));
        result.renamed += r.ok;
        result.failed += r.failed.length;
        for (const f of r.failed) result.errors.push(`${f.item.oldName || f.item.fileId}：${f.error}`);
        await sleep(1000);
      }

      if (plan.folderRename && plan.folderRename.changed) {
        progress('正在修改文件夹名…');
        try {
          await Pan115.renameOne(plan.folderRename.fileId, plan.folderRename.newName);
          result.renamed += 1;
        } catch (e) {
          if (e instanceof RiskError) throw e;
          result.failed += 1;
          result.errors.push(`文件夹：${e.message}`);
        }
      }
      progress('完成');
      return result;
    },
  };

  // ---------------------------------------------------------------- queue

  const Queue = {
    timer: null,
    polling: false,
    pollStartedAt: 0,
    lastPollAt: 0,
    _earlyTimer: 0,
    _earlyActive: false,
    tabId: Math.random().toString(36).slice(2, 10),

    list() { return Store.get('tasks', []) || []; },
    save(list) { Store.set('tasks', (list || []).slice(-30)); UI.refreshTasks(); },
    get(id) { return this.list().find((x) => x.id === id) || null; },
    add(task) {
      const list = this.list();
      list.push(task);
      this.save(list);
    },
    update(id, patch) {
      const list = this.list();
      const t = list.find((x) => x.id === id);
      if (!t) return null;
      Object.assign(t, patch);
      if (t.status === 'organized') {
        t.plan = null;
        t.beforeIds = [];
      }
      this.save(list);
      return t;
    },
    remove(id) {
      this.save(this.list().filter((x) => x.id !== id));
    },

    removeMany(ids) {
      const set = new Set(ids || []);
      this.save(this.list().filter((t) => !set.has(t.id)));
    },
    ready() { return this.list().filter((x) => x.status === 'ready'); },
    opts() {
      return {
        minVideoMB: Number(Store.get('minVideoMB', 100)) || 100,
        keepRatio: Number(Store.get('keepRatio', 1)),
        minAudioMB: Number(Store.get('minAudioMB', 20)) || 20,
        keepImages: !!Store.get('keepImages', false),
        keepNfo: !!Store.get('keepNfo', false),
        keepSubtitles: Store.get('keepSubtitles', true) !== false,
        mode: Store.get('resourceMode', 'movie'),
        deleteSamples: Store.get('deleteSamples', true) !== false,
        keepExtras: Store.get('keepExtras', true) !== false,
      };
    },

    async snapshot(cid) {
      try {
        const items = await Pan115.listFolderFresh(cid);
        return { ids: items.map((x) => x.id), count: items.length, at: now() };
      } catch (e) {
        log('snapshot failed', e);
        return { ids: [], count: 0, at: now(), error: e.message };
      }
    },

    recoverStaleChecks(force) {
      const list = this.list();
      const nowTs = now();
      let changed = false;
      for (const t of list) {
        if (t.status !== 'checking') continue;
        const at = Number(t.checkingAt) || 0;
        const stale = force
          ? (!at || nowTs - at > 10 * 1000)
          : (!at || nowTs - at > 90 * 1000);
        if (!stale) continue;
        t.status = 'pending';
        t.checkingAt = 0;
        if (!t.error) t.error = '上次检查中断，已重新排队';
        changed = true;
      }
      if (changed) this.save(list);
    },

    scheduleEarly() {
      // 推送后 9 秒内密集检查（每秒级别）；之后留到 60 秒的尾巴，避免秒传任务等到下一次 10 分钟轮询
      if (this._earlyActive) return;
      this._earlyActive = true;
      try { Store.set('pollLock', { id: this.tabId, until: now() + 2 * 60 * 1000, at: now() }); } catch (_) {}
      const start = now();
      const delays = [700, 1500, 2500, 3600, 4800, 6000, 7500, 9000, 15000, 25000, 40000, 60000]; // 从推送时刻起算的绝对时间
      let i = 0;
      const tick = async () => {
        this._earlyTimer = 0;
        try { await this.poll(false, true); } catch (_) {}
        i += 1;
        if (i < delays.length && this.list().some((t) => t.status === 'pending')) {
          const wait = Math.max(0, start + delays[i] - now());
          this._earlyTimer = setTimeout(tick, wait);
        } else {
          this._earlyActive = false;
        }
      };
      this._earlyTimer = setTimeout(tick, delays[0]);
    },

    async poll(manual, early) {
      if (this.polling) return;
      this.recoverStaleChecks(!!manual);
      const pending = this.list().filter((x) => x.status === 'pending');
      if (!pending.length) return;
      if (!manual) {
        const mode = Store.get('mode', 'standard');
        if (mode === 'manual' || mode === 'low') return;
        // 快速检查允许在后台标签页继续：切走标签也照样盯着任务
        if (document.hidden && !early) return;
        if (!this.isLeader(!!early)) return;
        let interval = Math.max(1, Number(Store.get('pollMinutes', 10)) || 10) * 60 * 1000;
        const oldest = Math.min.apply(null, pending.map((t) => Number(t.addedAt) || now()));
        if (now() - oldest > 30 * 60 * 1000) interval = Math.max(interval, 5 * 60 * 1000);
        if (now() - oldest > 2 * 3600 * 1000) interval = Math.max(interval, 15 * 60 * 1000);
        if (!early && now() - this.lastPollAt < interval) return;
      }
      this.polling = true;
      this.pollStartedAt = now();
      this.lastPollAt = now();
      try {
        let remote = [];
        try {
          const pages = early ? 1 : 3;
          for (let page = 1; page <= pages; page += 1) {
            const list = await Pan115.listTasks(page);
            remote.push(...list);
            if (list.length < 30) break;
          }
        } catch (e) {
          // 预算用完不算一次有效轮询，整点恢复后要能立刻重试
          if (e instanceof BudgetError) { this.lastPollAt = 0; throw e; }
          if (e instanceof RiskError) throw e;
          log('poll task list failed', e);
          return;
        }
        for (const task of pending) {
          if (!this.get(task.id)) continue;
          const rt = this.matchRemote(task, remote);
          if (rt) {
            const state = taskState(rt.status);
            const patch = {
              remote: { status: rt.status, name: rt.name, percent: rt.percent, fileId: rt.fileId, dirId: rt.dirId },
              lastCheckAt: now(),
              checkCount: (task.checkCount || 0) + 1,
            };
            // 115 返回了真实任务名时补上，避免任务卡一直显示 info hash
            if (rt.name && !isHashLike(rt.name) && (!task.name || isHashLike(task.name))) {
              patch.name = rt.name;
            }
            this.update(task.id, patch);
            if (state === 'done') await this.finalize(task.id, rt);
            else if (state === 'failed') this.update(task.id, { status: 'failed', error: '115 任务失败', finishedAt: now() });
            else {
              // 有的任务状态会滞后在“进行中”或一直停在“等待下载”，用目录差异兜底
              const pct = Number(rt.percent) || 0;
              const age = now() - (Number(task.addedAt) || 0);
              const stalledTodo = state === 'todo' && age > 5 * 60 * 1000;
              const diffDue = now() - (Number(task.lastDiffAt) || 0) > 60 * 1000;
              if (diffDue && ((pct >= 100 && age > 60 * 1000) || stalledTodo)) {
                this.update(task.id, { lastDiffAt: now() });
                const result = await this.detectByDiff(task);
                if (result) await this.finalize(task.id, rt, result);
              }
            }
          } else {
            const age = now() - task.addedAt;
            if (age > 10 * 60 * 1000) {
              const result = await this.detectByDiff(task);
              if (result) await this.finalize(task.id, null, result);
              else if (age > 24 * 3600 * 1000) this.update(task.id, { status: 'timeout', error: '24 小时未找到任务', finishedAt: now() });
            }
            this.update(task.id, { lastCheckAt: now(), checkCount: (task.checkCount || 0) + 1 });
          }
        }
      } finally {
        this.polling = false;
      }
    },

    matchRemote(task, remote) {
      const hash = String(task.infoHash || '').toLowerCase();
      if (hash) {
        const hit = remote.find((r) => r.infoHash === hash);
        if (hit) return hit;
      }
      const name = String(task.name || '').trim();
      if (name) {
        const hit = remote.find((r) => r.name === name);
        if (hit) return hit;
      }
      return null;
    },

    async detectByDiff(task) {
      if (!task.beforeIds || !task.beforeIds.length) return null;
      try {
        const items = await Pan115.listFolderFresh(task.targetCid);
        const before = new Set(task.beforeIds);
        const added = items.filter((x) => !before.has(x.id));
        if (!added.length) return null;
        return this.resolveResult(task, added);
      } catch (e) {
        log('diff failed', e);
        return null;
      }
    },

    resolveResult(task, added) {
      if (added.length === 1) {
        const a = added[0];
        if (a.isFolder) return { kind: 'folder', rootId: a.id, rootName: a.name, parentCid: task.targetCid, added };
        return { kind: 'flat', parentCid: task.targetCid, entries: added, rootName: '' };
      }
      const folders = added.filter((x) => x.isFolder);
      if (folders.length === 1) {
        return { kind: 'folder', rootId: folders[0].id, rootName: folders[0].name, parentCid: task.targetCid, added };
      }
      const cleanTask = Name.clean(task.name || '');
      const match = folders.find((f) => Name.clean(f.name) === cleanTask || f.name === task.name);
      if (match) return { kind: 'folder', rootId: match.id, rootName: match.name, parentCid: task.targetCid, added };
      if (!folders.length) return { kind: 'flat', parentCid: task.targetCid, entries: added, rootName: '' };
      return { kind: 'ambiguous', parentCid: task.targetCid, added };
    },

    async finalize(id, remote, precomputed) {
      const task = this.get(id);
      if (!task) return;
      this.update(id, { status: 'checking', checkingAt: now() });
      try {
        let result = precomputed || await this.detectByDiff(task);
        if (!result && remote && remote.fileId) {
          try {
            const items = await Pan115.listFolderFresh(task.targetCid);
            const hit = items.find((x) => x.id === String(remote.fileId));
            if (hit && hit.isFolder) {
              result = { kind: 'folder', rootId: hit.id, rootName: hit.name, parentCid: task.targetCid, added: [] };
            } else if (hit) {
              result = { kind: 'flat', parentCid: task.targetCid, entries: [hit], rootName: '' };
            }
          } catch (e) {
            if (e instanceof RiskError) throw e;
          }
        }
        if (!result) {
          this.update(id, { status: 'ready', result: { kind: 'unknown', parentCid: task.targetCid }, error: '无法自动定位结果文件夹，请手动整理' });
          UI.toast('任务完成，但没能自动定位目录，请手动整理', 'warn', { action: '查看', onAction: () => UI.openTasks() });
          return;
        }
        if (result.kind === 'ambiguous') {
          this.update(id, { status: 'ready', result, error: '新增了多个内容，无法确认哪个是本次任务' });
          UI.toast('任务完成，但结果不唯一，请手动整理', 'warn', { action: '查看', onAction: () => UI.openTasks() });
          return;
        }
        if (result.kind === 'folder') await this.waitStable(result.rootId);
        const plan = await this.buildPlanFor(task, result);
        if (!plan) {
          this.update(id, { status: 'ready', result, error: '生成整理计划失败' });
          return;
        }
        const finalName = (result.kind === 'folder' ? result.rootName : (remote && remote.name)) || task.name || '';
        this.update(id, { status: 'ready', result, plan, name: finalName, finishedAt: now(), error: '' });
        const auto = Store.get('autoOrganize', false) && plan.safe;
        UI.toast(
          auto
            ? `任务完成，正在自动整理（保留 ${plan.stats.keep} / 待删 ${plan.stats.junk}）`
            : `任务完成：保留 ${plan.stats.keep} 个，待删 ${plan.stats.junk} 个`,
          'success',
          auto
            ? { timeout: 5000 }
            : { action: '预览', timeout: 12000, onAction: () => UI.openPreview(id) }
        );
        if (auto) {
          setTimeout(() => { UI.applyPlan(id).catch((e) => log('auto apply failed', e)); }, 50);
        }
      } catch (e) {
        if (e instanceof RiskError) { this.update(id, { status: 'pending', checkingAt: 0 }); return; }
        this.update(id, { status: 'ready', error: e.message, checkingAt: 0 });
        UI.toast('整理计划生成失败：' + e.message, 'error');
      } finally {
        try {
          const cur = this.get(id);
          if (cur && cur.status === 'checking') {
            this.update(id, { status: 'pending', checkingAt: 0, error: '检查中断，已重新排队' });
          }
        } catch (_) {}
      }
    },

    async buildPlanFor(task, result) {
      const opts = this.opts();
      if (result.kind === 'folder') {
        return Organizer.planFolder(result.rootId, result.rootName || task.name || '', Object.assign({ targetCid: task.targetCid }, opts));
      }
      if (result.kind === 'flat') {
        const plan = Organizer.planEntries(result.entries || [], Object.assign({ targetCid: task.targetCid }, opts));
        if (plan) this.attachWrap(plan, task, result);
        return plan;
      }
      return null;
    },

    // 平铺结果（ED2K 常见：没有文件夹，文件直接落在目标目录）归档到同名文件夹
    attachWrap(plan, task, result) {
      const entries = (result && result.entries) || [];
      if (!entries.length || !plan.keeps.length) return;
      const name = this.wrapName(plan, task);
      if (!name) return;
      plan.wrap = {
        parentCid: String((result && result.parentCid) || task.targetCid || '0'),
        name,
        ids: entries.map((x) => String(x.id)).filter(Boolean),
      };
    },

    wrapName(plan, task) {
      const keeps = (plan && plan.keeps) || [];
      const videos = keeps.filter((x) => Organizer.isVideo(x.name));
      const pool = videos.length ? videos : keeps;
      const primary = pool.slice().sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0))[0];
      const raw = (primary && primary.name) || task.name || '';
      const { stem } = Name.splitExt(raw);
      return Name.clean(stem) || Name.clean(raw) || stem || raw || '';
    },

    async waitStable(cid) {
      let last = '';
      for (let i = 0; i < 2; i += 1) {
        try {
          const items = await Pan115.listFolderFresh(cid);
          const sig = items.length + ':' + items.reduce((s, x) => s + (Number(x.size) || 0), 0);
          if (sig === last) return true;
          last = sig;
        } catch (e) {
          if (e instanceof RiskError) throw e;
        }
        if (i < 1) await sleep(400);
      }
      return false;
    },

    isLeader(force) {
      const lock = Store.get('pollLock', null);
      const until = Number(lock && lock.until) || 0;
      // force：刚推送或刚从后台切回来的标签页可以直接接管，避免被不可见标签的空锁挡住
      if (!force && lock && lock.id !== this.tabId && until > now()) return false;
      Store.set('pollLock', { id: this.tabId, until: now() + 60 * 1000, at: now() });
      // 回读一次，降低两个标签同时抢到锁的概率
      const check = Store.get('pollLock', null);
      return !!(check && check.id === this.tabId);
    },

    start() {
      if (this.timer) return;
      try {
        GM_addValueChangeListener(Store.key('tasks'), (_n, _o, _v, remote) => {
          if (remote && UI.ready) UI.refreshTasks();
        });
      } catch (_) {}
      this.timer = setInterval(() => {
        let early = false;
        if (this.polling && now() - (this.pollStartedAt || 0) > 120 * 1000) {
          log('poll watchdog: resetting stuck poll');
          this.polling = false;
          this.recoverStaleChecks(false);
          early = true;
        }
        this.poll(false, early).catch((e) => log('poll error', e));
      }, 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        const run = () => this.poll(false, true).catch(() => {});
        const busy = this.polling;
        run();
        // 上一轮轮询还没结束时这次会被直接丢弃，补一次；否则不重复请求
        if (busy) setTimeout(run, 3000);
      });
      window.addEventListener('beforeunload', () => {
        const lock = Store.get('pollLock', null);
        if (lock && lock.id === this.tabId) Store.del('pollLock');
      });
    },
  };

  function taskState(status) {
    const s = Number(status);
    if ([2, 10, 11].includes(s)) return 'done';
    if ([-1, 3, 9].includes(s)) return 'failed';
    if (s === 0) return 'todo';
    return 'running';
  }

  // ---------------------------------------------------------------- exports (debug)

  window.__RH115__ = { NS, VERSION, API, Store, Risk, Budget, Scheduler, Link, Name, Pan115, Organizer, Queue, Update, taskState, UI, log, normalizeEntry, base32ToHex, cmpVer };

  // ---------------------------------------------------------------- boot

  function boot() {
    if (!document.documentElement) {
      setTimeout(boot, 80);
      return;
    }
    try { Risk.init(); } catch (e) { log('risk init failed', e); }
    try {
      UI.init();
      UI.bindGlobal();
      Queue.start();
      log('booted', VERSION);
    } catch (e) {
      log('ui init failed', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();

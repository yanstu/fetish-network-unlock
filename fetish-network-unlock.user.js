// ==UserScript==
// @name         Fetish Network - Full Video Unlock
// @name:zh-CN   Fetish 网络 - 完整版视频解锁
// @namespace    https://github.com/yanstu/fetish-network-unlock
// @version      2.0.0
// @description  Play full-length scenes instead of trailers on hentaied.com and its sibling sites. Rewrites the trailer playlist to the full-length playlist at request time, removes the member modal, and adds quality control, resume, keyboard shortcuts and a copy-ffmpeg-command panel. Adult content.
// @description:zh-CN  在 hentaied.com 及同网络站点直接播放完整版而非预告片：请求层重写播放列表、移除会员弹窗，并提供画质切换、断点续播、快捷键与 ffmpeg 下载命令面板。成人内容。
// @author       yanstu
// @license      MIT
// @match        https://hentaied.com/*
// @match        https://*.hentaied.com/*
// @match        https://vampired.com/*
// @match        https://*.vampired.com/*
// @match        https://vored.com/*
// @match        https://*.vored.com/*
// @match        https://voodooed.com/*
// @match        https://*.voodooed.com/*
// @match        https://monsterporn.com/*
// @match        https://*.monsterporn.com/*
// @match        https://parasited.com/*
// @match        https://*.parasited.com/*
// @match        https://plantsvscunts.com/*
// @match        https://*.plantsvscunts.com/*
// @match        https://cumflation.com/*
// @match        https://*.cumflation.com/*
// @match        https://futanari.xxx/*
// @match        https://*.futanari.xxx/*
// @match        https://freeze.xxx/*
// @match        https://*.freeze.xxx/*
// @run-at       document-start
// @grant        none
// @noframes     false
// ==/UserScript==

/* eslint-disable no-empty */

/*
 * ── 原理 ────────────────────────────────────────────────────────────
 * 站点给访客注入的只有预告片播放列表：
 *     https://hls.fetish.lol/trailers/hentaied/Awoken/hls/master.m3u8
 * 完整版与它同机同路径，只差一个 /trailers 前缀：
 *     https://hls.fetish.lol/hentaied/Awoken/hls/master.m3u8
 *
 * 主题 bundle 里的播放器逻辑是：
 *     var src = preview.getAttribute('data-preview-src');
 *     hls.loadSource(src);
 * 它在请求层无法区分这两条 URL，所以只要改写 XHR / fetch 的 URL，
 * hls.js 就会照常拉取完整版，播放器代码一行都不用动。
 *
 * 会员墙同样只是前端装饰：
 *     video.addEventListener('ended', () => modal.classList.add('opened'));
 * 完整版有 20-40 分钟，ended 不会触发；脚本再直接摘掉弹窗节点兜底。
 *
 * 服务器侧只校验 Referer，而页面带 <meta name="referrer" content="unsafe-url">，
 * 浏览器发起的跨域请求会自动带上正确 Referer；同时返回
 * Access-Control-Allow-Origin: *，所以请求层改写无需任何代理。
 * ────────────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════ 配置

  var STORE = {
    quality: 'fn_unlock_quality',
    resume: 'fn_unlock_resume',
    panel: 'fn_unlock_panel'
  };
  var QUALITIES = ['auto', '4k', '1080p', '720p'];
  var TRAILER_SEG = /\/trailers\/([a-z0-9.-]+)\//i;
  var MASTER_RE = /\/hls\/master\.m3u8(\?|$)/;

  function store(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      if (val === null) localStorage.removeItem(key);
      else localStorage.setItem(key, val);
    } catch (e) { /* 隐私模式 */ }
    return null;
  }

  function currentQuality() {
    var q = store(STORE.quality);
    return QUALITIES.indexOf(q) > 0 ? q : '';
  }

  // ══════════════════════════════════════════════════════════ 请求重写

  function rewrite(url) {
    if (typeof url !== 'string' || url.indexOf('/trailers/') === -1) return url;
    var out = url.replace(TRAILER_SEG, '/$1/');
    var q = currentQuality();
    // 指定画质时直接把 master 换成对应 variant，省掉 hls.js 的码率探测
    if (q && MASTER_RE.test(out)) {
      out = out.replace(/\/hls\/master\.m3u8/, '/hls/' + q + '/index.m3u8');
    }
    return out;
  }

  function isUnlockable(url) {
    return typeof url === 'string' && url.indexOf('/trailers/') !== -1;
  }

  function installRequestHooks() {
    // 1) XMLHttpRequest —— hls.js 默认走这条
    var xhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      var args = Array.prototype.slice.call(arguments);
      if (isUnlockable(args[1])) args[1] = rewrite(args[1]);
      return xhrOpen.apply(this, args);
    };

    // 2) fetch
    if (typeof window.fetch === 'function') {
      var nativeFetch = window.fetch;
      window.fetch = function (input, init) {
        try {
          if (typeof input === 'string') {
            if (isUnlockable(input)) input = rewrite(input);
          } else if (input instanceof Request) {
            var fixed = rewrite(input.url);
            if (fixed !== input.url) input = new Request(fixed, input);
          }
        } catch (e) { /* 原样放行 */ }
        return nativeFetch.call(this, input, init);
      };
    }

    // 3) 原生 HLS 路径（Safari）会直接写 video.src
    try {
      var d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
      if (d && d.set) {
        Object.defineProperty(HTMLMediaElement.prototype, 'src', {
          configurable: true,
          enumerable: d.enumerable,
          get: d.get,
          set: function (v) { d.set.call(this, isUnlockable(v) ? rewrite(v) : v); }
        });
      }
    } catch (e) { /* 内核不允许则忽略 */ }

    // 4) new URL() / URL.createObjectURL 之外的字符串拼接路径
    try {
      var NativeURL = window.URL;
      function PatchedURL(u, base) {
        if (base !== undefined) return new NativeURL(isUnlockable(u) ? rewrite(u) : u, base);
        return new NativeURL(isUnlockable(u) ? rewrite(u) : u);
      }
      PatchedURL.prototype = NativeURL.prototype;
      ['createObjectURL', 'revokeObjectURL'].forEach(function (k) {
        if (NativeURL[k]) PatchedURL[k] = NativeURL[k].bind(NativeURL);
      });
      window.URL = PatchedURL;
    } catch (e) { /* 忽略 */ }
  }

  // ══════════════════════════════════════════════════════════ 前端清理

  var HIDE_CSS = [
    '.modal-member{display:none !important}',
    '.previewlabel{display:none !important}',
    '.notice-info{display:none !important}',
    '.previewbanner{display:none !important}'
  ].join('');

  function injectCSS() {
    if (document.getElementById('fn-unlock-css')) return;
    var s = document.createElement('style');
    s.id = 'fn-unlock-css';
    s.textContent = HIDE_CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function cleanDOM() {
    injectCSS();
    var nodes = document.querySelectorAll('.modal-member, .previewlabel');
    for (var i = 0; i < nodes.length; i++) nodes[i].remove();
  }

  // ══════════════════════════════════════════════════════════ 进度记忆

  function videoKey() {
    var m = location.pathname.match(/^\/([a-z0-9][a-z0-9-]*)\/?$/i);
    return m ? m[1] : null;
  }

  function readResume(key) {
    try {
      var all = JSON.parse(store(STORE.resume) || '{}');
      var t = all[key];
      return typeof t === 'number' && t > 5 ? t : 0;
    } catch (e) { return 0; }
  }

  function writeResume(key, t) {
    try {
      var all = JSON.parse(store(STORE.resume) || '{}');
      all[key] = Math.floor(t);
      var keys = Object.keys(all);
      if (keys.length > 300) {           // 限制体积
        keys.slice(0, keys.length - 300).forEach(function (k) { delete all[k]; });
      }
      store(STORE.resume, JSON.stringify(all));
    } catch (e) { /* 忽略 */ }
  }

  function installResume(video) {
    var key = videoKey();
    if (!key) return;
    var saved = readResume(key);
    var restored = false;
    if (saved > 5) {
      var tryRestore = function () {
        if (restored) return;
        if (video.duration && saved < video.duration - 10) {
          restored = true;
          try { video.currentTime = saved; } catch (e) { /* 忽略 */ }
        }
      };
      video.addEventListener('loadedmetadata', tryRestore);
      video.addEventListener('canplay', tryRestore, { once: true });
    }
    var last = 0;
    video.addEventListener('timeupdate', function () {
      var now = Date.now();
      if (now - last < 5000) return;     // 5s 一次，避免写爆 localStorage
      last = now;
      writeResume(key, video.currentTime);
    });
    window.addEventListener('beforeunload', function () {
      writeResume(key, video.currentTime);
    });
  }

  // ══════════════════════════════════════════════════════════ 快捷键

  function installKeyboard(video) {
    document.addEventListener('keydown', function (e) {
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case 'ArrowLeft':  video.currentTime -= 10; break;
        case 'ArrowRight': video.currentTime += 10; break;
        case 'ArrowUp':    video.volume = Math.min(1, video.volume + 0.05); break;
        case 'ArrowDown':  video.volume = Math.max(0, video.volume - 0.05); break;
        case ' ':          video.paused ? video.play() : video.pause(); break;
        case 'f': case 'F':
          if (document.fullscreenElement) document.exitFullscreen();
          else if (video.requestFullscreen) video.requestFullscreen();
          break;
        case 'p': case 'P':
          if (document.pictureInPictureElement) document.exitPictureInPicture();
          else if (video.requestPictureInPicture) video.requestPictureInPicture().catch(function () {});
          break;
        default: return;
      }
      e.preventDefault();
    });
  }

  // ══════════════════════════════════════════════════════════ 控制面板

  var panel = null;

  function buildPanel(video, src) {
    if (panel || !document.body) return;
    panel = document.createElement('div');
    panel.id = 'fn-unlock-panel';
    panel.innerHTML = [
      '<style>',
      '#fn-unlock-panel{position:fixed;right:16px;bottom:16px;z-index:2147483000;',
      'font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
      'background:rgba(16,16,20,.93);color:#eaeaea;border:1px solid #333;border-radius:10px;',
      'padding:10px 12px;min-width:210px;box-shadow:0 8px 28px rgba(0,0,0,.5);backdrop-filter:blur(8px)}',
      '#fn-unlock-panel h4{margin:0 0 6px;font-size:12px;font-weight:600;color:#7ee787;',
      'display:flex;justify-content:space-between;align-items:center;cursor:move}',
      '#fn-unlock-panel .fn-row{display:flex;justify-content:space-between;gap:10px;margin:3px 0}',
      '#fn-unlock-panel .fn-k{color:#9aa0a6}',
      '#fn-unlock-panel select,#fn-unlock-panel button{font:inherit;background:#26262c;color:#eaeaea;',
      'border:1px solid #3a3a42;border-radius:5px;padding:2px 6px;cursor:pointer}',
      '#fn-unlock-panel button:hover{background:#33333c}',
      '#fn-unlock-panel .fn-min{background:none;border:none;color:#9aa0a6;padding:0 2px;font-size:14px}',
      '#fn-unlock-panel .fn-keys{color:#7a8085;font-size:11px;margin-top:6px;border-top:1px solid #2c2c33;padding-top:6px}',
      '#fn-unlock-panel.fn-collapsed .fn-body{display:none}',
      '</style>',
      '<h4><span>● 完整版已解锁</span><button class="fn-min" title="折叠">–</button></h4>',
      '<div class="fn-body">',
      '<div class="fn-row"><span class="fn-k">时长</span><span id="fn-dur">–</span></div>',
      '<div class="fn-row"><span class="fn-k">画质</span>',
      '<select id="fn-q">', QUALITIES.map(function (q) {
        return '<option value="' + q + '">' + (q === 'auto' ? '自动' : q) + '</option>';
      }).join(''), '</select></div>',
      '<div class="fn-row"><span class="fn-k">下载</span><button id="fn-dl">复制命令</button></div>',
      '<div class="fn-keys">←/→ 快退快进 · 空格 暂停 · F 全屏 · P 画中画</div>',
      '</div>'
    ].join('');
    document.body.appendChild(panel);

    var qsel = panel.querySelector('#fn-q');
    qsel.value = currentQuality() || 'auto';
    qsel.addEventListener('change', function () {
      store(STORE.quality, qsel.value === 'auto' ? null : qsel.value);
      location.reload();                 // 重新拉流最省事且无副作用
    });

    panel.querySelector('#fn-dl').addEventListener('click', function () {
      var cmd = 'ffmpeg -headers "Referer: https://' + location.hostname +
                '/\\r\\n" -i "' + src + '" -c copy out.mp4';
      var done = function () {
        var b = panel.querySelector('#fn-dl');
        b.textContent = '已复制';
        setTimeout(function () { b.textContent = '复制命令'; }, 1500);
      };
      if (navigator.clipboard) navigator.clipboard.writeText(cmd).then(done, done);
      else { window.prompt('复制以下命令：', cmd); }
    });

    panel.querySelector('.fn-min').addEventListener('click', function () {
      panel.classList.toggle('fn-collapsed');
    });

    if (store(STORE.panel) === 'collapsed') panel.classList.add('fn-collapsed');

    // 拖动
    var head = panel.querySelector('h4'), dragging = false, ox = 0, oy = 0;
    head.addEventListener('mousedown', function (e) {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true; ox = e.clientX; oy = e.clientY;
      e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
      panel.style.left = (panel.offsetLeft + e.clientX - ox) + 'px';
      panel.style.top = (panel.offsetTop + e.clientY - oy) + 'px';
      ox = e.clientX; oy = e.clientY;
    });
    document.addEventListener('mouseup', function () { dragging = false; });

    function fmt(s) {
      if (!s || !isFinite(s)) return '–';
      s = Math.floor(s);
      var m = Math.floor(s / 60);
      return m + ':' + ('0' + (s % 60)).slice(-2);
    }
    video.addEventListener('loadedmetadata', function () {
      var el = panel.querySelector('#fn-dur');
      if (el) el.textContent = fmt(video.duration);
    });
  }

  // ══════════════════════════════════════════════════════════ 装配

  function attachPlayer() {
    var video = document.querySelector('.singlepreview') ||
                document.querySelector('.isabelle-hls-preview video');
    if (!video) return false;
    if (video.dataset.fnHooked === '1') return true;
    video.dataset.fnHooked = '1';

    installResume(video);
    installKeyboard(video);

    // 从 data-preview-src 推导正片地址，供面板展示/复制
    var holder = document.querySelector('.isabelle-hls-preview[data-preview-src]');
    var src = holder ? holder.getAttribute('data-preview-src') : '';
    src = rewrite(src);
    buildPanel(video, src);
    return true;
  }

  // document-start 阶段 documentElement 可能还不存在，
  // observe(null) 会抛错并让后续清理静默失效，所以先探测再退回事件监听
  var observing = false;
  function start() {
    cleanDOM();
    attachPlayer();
    var root = document.documentElement;
    if (!root || observing) return;
    observing = true;
    var pending = false;
    new MutationObserver(function () {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () {
        pending = false;
        cleanDOM();
        attachPlayer();
      });
    }).observe(root, { childList: true, subtree: true });
  }

  installRequestHooks();

  if (document.documentElement) {
    start();
  } else {
    document.addEventListener('readystatechange', start);
    document.addEventListener('DOMContentLoaded', start);
  }
  window.addEventListener('load', function () { cleanDOM(); attachPlayer(); });
})();

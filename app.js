/* H TV for VIDAA: a player only. No content is included. */
(function () {
'use strict';
var $ = function (id) { return document.getElementById(id); };
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); };
var store = {
  get: function (k, d) { try { var v = localStorage.getItem('htv.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set: function (k, v) { try { localStorage.setItem('htv.' + k, JSON.stringify(v)); } catch (e) {} }
};

/* ---------- stage scaling ---------- */
function fit() { var s = Math.min(innerWidth / 1920, innerHeight / 1080); var st = $('stage'); st.style.transform = 'scale(' + s + ')'; st.style.left = (innerWidth - 1920 * s) / 2 + 'px'; st.style.top = (innerHeight - 1080 * s) / 2 + 'px'; }
addEventListener('resize', fit); fit();

/* ---------- state ---------- */
var S = {
  playlists: store.get('playlists', []), active: store.get('active', null),
  fav: store.get('fav', {}), recent: store.get('recent', []), proxy: store.get('proxy', ''),
  tabs: ['Live TV', 'Movies', 'Series', 'Settings'], tab: 0, zone: 'chans', ti: 0,
  lib: null, loading: false, err: '',
  catIdx: 0, chIdx: 0, mCat: 0, mIdx: 0, sCat: 0, sIdx: 0,
  playing: null, fullscreen: false, epg: null,
  view: 'main', // main | setup | series
  setup: { type: 'xtream', name: '', url: '', server: '', user: '', pass: '' }, fi: 0, fj: 0,
  series: null, epIdx: 0, settingsIdx: 0
};
function activePl() { for (var i = 0; i < S.playlists.length; i++) if (S.playlists[i].id === S.active) return S.playlists[i]; return null; }
function favKey(ch) { return S.active + ':' + ch.id; }
function isFav(ch) { return !!S.fav[favKey(ch)]; }
function toast(m) { var t = $('toast'); t.textContent = m; t.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.add('hidden'); }, 2600); }

/* ---------- networking ---------- */
function prox(u) { return S.proxy ? S.proxy + encodeURIComponent(u) : u; }
function getText(u) {
  return fetch(prox(u)).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); });
}
function getJSON(u) { return getText(u).then(function (t) { return JSON.parse(t); }); }
function base(server) { server = (server || '').trim().replace(/\/+$/, ''); if (!/^https?:\/\//i.test(server)) server = 'http://' + server; return server; }

/* ---------- M3U ---------- */
function parseM3U(text) {
  var lines = text.split(/\r?\n/), out = [], cur = null, cats = {}, id = 0;
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i].trim(); if (!l) continue;
    if (l.indexOf('#EXTINF') === 0) {
      cur = {};
      var m = l.match(/tvg-logo="([^"]*)"/i); cur.logo = m ? m[1] : '';
      m = l.match(/group-title="([^"]*)"/i); cur.cat = m && m[1] ? m[1] : 'Other';
      m = l.match(/tvg-name="([^"]*)"/i);
      var comma = l.lastIndexOf(',');
      cur.name = (comma >= 0 ? l.slice(comma + 1).trim() : '') || (m ? m[1] : 'Channel');
    } else if (l.charAt(0) !== '#' && cur) {
      cur.url = l; cur.id = 'm' + (id++); cur.num = id; out.push(cur); cats[cur.cat] = 1; cur = null;
    }
  }
  return { channels: out, cats: Object.keys(cats).sort(), movies: [], series: [], mcats: [], scats: [] };
}

/* ---------- Xtream ---------- */
function xt(pl, action, extra) {
  return base(pl.server) + '/player_api.php?username=' + encodeURIComponent(pl.user) + '&password=' + encodeURIComponent(pl.pass) + '&action=' + action + (extra || '');
}
function loadXtream(pl) {
  var b = base(pl.server), u = encodeURIComponent(pl.user), p = encodeURIComponent(pl.pass);
  var safe = function (x) { return x.catch(function () { return []; }); };
  return getJSON(base(pl.server) + '/player_api.php?username=' + u + '&password=' + p).then(function (info) {
    if (info && info.user_info && info.user_info.auth === 0) throw new Error('Wrong username or password');
    return Promise.all([getJSON(xt(pl, 'get_live_categories')), getJSON(xt(pl, 'get_live_streams')),
      safe(getJSON(xt(pl, 'get_vod_categories'))), safe(getJSON(xt(pl, 'get_vod_streams'))),
      safe(getJSON(xt(pl, 'get_series_categories'))), safe(getJSON(xt(pl, 'get_series')))]);
  }).then(function (r) {
    var cn = function (arr) { var m = {}; (arr || []).forEach(function (c) { m[c.category_id] = c.category_name; }); return m; };
    var lc = cn(r[0]), vc = cn(r[2]), sc = cn(r[4]);
    var ch = (r[1] || []).map(function (s, i) { return { id: 'x' + s.stream_id, sid: s.stream_id, name: s.name, logo: s.stream_icon || '', cat: lc[s.category_id] || 'Other', num: s.num || i + 1, url: b + '/live/' + u + '/' + p + '/' + s.stream_id + '.m3u8' }; });
    var mv = (r[3] || []).map(function (s) { return { id: 'v' + s.stream_id, name: s.name, logo: s.stream_icon || '', cat: vc[s.category_id] || 'Other', url: b + '/movie/' + u + '/' + p + '/' + s.stream_id + '.' + (s.container_extension || 'mp4') }; });
    var se = (r[5] || []).map(function (s) { return { id: 's' + s.series_id, sid: s.series_id, name: s.name, logo: s.cover || '', cat: sc[s.category_id] || 'Other' }; });
    var uniq = function (a) { var m = {}; a.forEach(function (x) { m[x.cat] = 1; }); return Object.keys(m).sort(); };
    return { channels: ch, cats: uniq(ch), movies: mv, series: se, mcats: uniq(mv), scats: uniq(se) };
  });
}
function loadLibrary() {
  var pl = activePl(); S.lib = null; S.err = '';
  if (!pl) { render(); return; }
  S.loading = true; render();
  var job = pl.type === 'xtream' ? loadXtream(pl) : getText(pl.url).then(function (t) {
    if (t.indexOf('#EXTM3U') < 0 && t.indexOf('#EXTINF') < 0) throw new Error('This link is not an M3U playlist');
    return parseM3U(t);
  });
  job.then(function (lib) { S.lib = lib; S.loading = false; S.catIdx = 0; S.chIdx = 0; render(); })
     .catch(function (e) { S.loading = false; S.err = (e && e.message ? e.message : 'Could not load') + (/Failed to fetch|NetworkError/i.test(String(e)) ? ' (the server may block TV browsers. Try a proxy in Settings.)' : ''); render(); });
}

/* ---------- lists ---------- */
function liveCats() { return ['All', 'Favorites', 'Recent'].concat(S.lib ? S.lib.cats : []); }
function liveList() {
  if (!S.lib) return [];
  var c = liveCats()[S.catIdx];
  if (c === 'All') return S.lib.channels;
  if (c === 'Favorites') return S.lib.channels.filter(isFav);
  if (c === 'Recent') { var m = {}; S.lib.channels.forEach(function (x) { m[x.id] = x; }); return S.recent.map(function (id) { return m[id]; }).filter(Boolean); }
  return S.lib.channels.filter(function (x) { return x.cat === c; });
}
function gridList(kind) {
  if (!S.lib) return [];
  var all = kind === 'm' ? S.lib.movies : S.lib.series, cats = kind === 'm' ? S.lib.mcats : S.lib.scats, ci = kind === 'm' ? S.mCat : S.sCat;
  if (ci === 0) return all;
  return all.filter(function (x) { return x.cat === cats[ci - 1]; });
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function win(idx, len, n) { return clamp(idx - Math.floor(n / 2) + 1, 0, Math.max(0, len - n)); }

/* ---------- render ---------- */
function logoHTML(ch) { var i = (ch.name || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'TV'; return '<div class="lg">' + (ch.logo ? '<img src="' + esc(ch.logo) + '" onerror="this.remove()">' : '') + (ch.logo ? '' : i) + '</div>'; }
function topHTML() {
  var h = '<div class="top"><div class="logo"><img src="logo.png" alt="H">TV</div>';
  S.tabs.forEach(function (t, i) { h += '<div class="tab' + (i === S.tab ? ' on' : '') + (S.zone === 'tabs' && i === S.tab ? ' focus' : '') + '">' + t + '</div>'; });
  return h + '</div>';
}
function render() {
  var a = $('app'), h = '';
  if (S.view === 'setup') h = setupHTML();
  else if (S.view === 'series') h = seriesHTML();
  else {
    h = topHTML();
    if (!activePl()) h += '<div class="body"><div class="form"><h2>Welcome to H TV</h2><p>H TV is a player only. Add your own M3U link or Xtream Codes login to start. No channels or content are included.</p><div class="btn pri focus">Add a playlist</div></div></div>';
    else if (S.loading) h += '<div class="body"><div class="empty">Loading your playlist…</div></div>';
    else if (S.err) h += '<div class="body"><div class="form"><h2>Could not load</h2><p>' + esc(S.err) + '</p><div class="btn pri focus">Try again</div></div></div>';
    else if (S.tab === 0) h += liveHTML();
    else if (S.tab === 1 || S.tab === 2) h += gridHTML(S.tab === 1 ? 'm' : 's');
    else h += settingsHTML();
  }
  a.innerHTML = h;
  syncMini();
}
function liveHTML() {
  var cats = liveCats(), list = liveList(), n = 10, h = '<div class="body">';
  var s = win(S.catIdx, cats.length, n);
  h += '<div class="col cats">';
  for (var i = s; i < Math.min(cats.length, s + n); i++) h += '<div class="item' + (i === S.catIdx ? ' sel' : '') + (S.zone === 'cats' && i === S.catIdx ? ' focus' : '') + '"><div class="t"><div class="t1">' + esc(cats[i]) + '</div></div></div>';
  h += '</div><div class="col chans">';
  if (!list.length) h += '<div class="empty">' + (cats[S.catIdx] === 'Favorites' ? 'No favorites yet. Press Right on a channel to add one.' : 'No channels here.') + '</div>';
  s = win(S.chIdx, list.length, n);
  for (i = s; i < Math.min(list.length, s + n); i++) {
    var c = list[i], on = S.playing && S.playing.id === c.id;
    h += '<div class="item' + (on ? ' sel' : '') + (S.zone === 'chans' && i === S.chIdx ? ' focus' : '') + '"><div class="n">' + esc(c.num) + '</div>' + logoHTML(c) + '<div class="t"><div class="t1">' + esc(c.name) + '</div></div>' + (isFav(c) ? '<div class="c" style="color:#facc15">★</div>' : '') + '</div>';
  }
  h += '</div><div class="col side"><div class="prev" id="prevbox">' + (S.playing ? '' : 'Press OK on a channel to preview') + '</div>';
  var cur = S.playing;
  h += '<div class="info"><div class="h">' + esc(cur ? cur.name : 'H TV') + '</div>' + epgHTML() + '</div>';
  h += '<div class="sub">OK: preview, OK again: fullscreen · Right: favorite</div></div></div>';
  return h;
}
function epgHTML() {
  if (!S.epg || !S.epg.now) return '<div class="s">' + (S.playing && S.playing.sid ? 'No guide data' : '') + '</div>';
  var e = S.epg, pct = clamp((Date.now() / 1000 - e.now.start) / Math.max(1, e.now.end - e.now.start) * 100, 0, 100);
  return '<div class="s">Now: ' + esc(e.now.title) + '</div><div class="bar"><i style="width:' + pct + '%"></i></div>' + (e.next ? '<div class="s">Next: ' + esc(e.next.title) + '</div>' : '');
}
function gridHTML(kind) {
  var cats = ['All'].concat(kind === 'm' ? S.lib.mcats : S.lib.scats), ci = kind === 'm' ? S.mCat : S.sCat, ix = kind === 'm' ? S.mIdx : S.sIdx;
  var list = gridList(kind), cols = 8, rows = 2, row = Math.floor(ix / cols), start = clamp(row - (S.zone === 'grid' ? 0 : 0), 0, Math.max(0, Math.ceil(list.length / cols) - rows));
  if (row >= start + rows) start = row - rows + 1;
  var h = '<div class="body v"><div class="chiprow">';
  var cs = clamp(ci - 3, 0, Math.max(0, cats.length - 6));
  for (var i = cs; i < Math.min(cats.length, cs + 6); i++) h += '<div class="tab' + (i === ci ? ' on' : '') + (S.zone === 'gcats' && i === ci ? ' focus' : '') + '" style="font-size:24px;white-space:nowrap">' + esc(cats[i]) + '</div>';
  h += '</div>';
  if (!list.length) return h + '<div class="empty">' + (S.lib.movies.length || S.lib.series.length ? 'Nothing here.' : 'This playlist has no ' + (kind === 'm' ? 'movies' : 'series') + '. Movies and series need an Xtream Codes playlist.') + '</div></div>';
  h += '<div class="grid">';
  for (i = start * cols; i < Math.min(list.length, (start + rows) * cols); i++) {
    var c = list[i];
    h += '<div class="card' + (S.zone === 'grid' && i === ix ? ' focus' : '') + '"><div class="p">' + (c.logo ? '<img src="' + esc(c.logo) + '" onerror="this.remove()">' : esc((c.name || '?').charAt(0))) + '</div><div class="ti">' + esc(c.name) + '</div></div>';
  }
  return h + '</div></div>';
}
function fi(idx, label, cls) { return '<div class="btn ' + (cls || '') + ((S.view === 'setup' || S.zone === 'form') && S.fi === idx ? ' focus' : '') + '">' + label + '</div>'; }
function settingsHTML() {
  var h = '<div class="body"><div class="form"><h2>Settings</h2><p>Playlists (OK to switch)</p>', k = 0, i;
  for (i = 0; i < S.playlists.length; i++, k++) h += '<div class="btn' + (S.playlists[i].id === S.active ? ' pri' : '') + (S.zone === 'form' && S.fi === k ? ' focus' : '') + '">' + esc(S.playlists[i].name) + (S.playlists[i].id === S.active ? '  (active)' : '') + '</div>';
  h += fi(k++, 'Add playlist') + fi(k++, 'Reload playlist') + fi(k++, 'Remove active playlist');
  h += '<p style="margin-top:14px">Proxy (only if your provider blocks TV browsers). Leave empty normally.</p><input class="f' + (S.zone === 'form' && S.fi === k ? ' focus' : '') + '" id="proxy" placeholder="https://your-proxy.example/?url=" value="' + esc(S.proxy) + '"></div></div>';
  return h;
}
function settingsCount() { return S.playlists.length + 3 + 1; }
function setupHTML() {
  var s = S.setup, h = topHTML().replace(/<div class="tab[^>]*>[^<]*<\/div>/g, '');
  h += '<div class="body"><div class="form"><h2>Add a playlist</h2><p>Only add playlists you have the right to use. H TV does not provide any content.</p>';
  h += '<div class="seg"><div class="btn' + (s.type === 'xtream' ? ' on' : '') + (S.fi === 0 && S.fj === 0 ? ' focus' : '') + '">Xtream Codes</div><div class="btn' + (s.type === 'm3u' ? ' on' : '') + (S.fi === 0 && S.fj === 1 ? ' focus' : '') + '">M3U link</div></div>';
  var inp = function (id, ph, val, idx, type) { return '<input class="f' + (S.fi === idx ? ' focus' : '') + '" id="' + id + '" placeholder="' + ph + '" value="' + esc(val) + '"' + (type ? ' type="' + type + '"' : '') + '>'; };
  h += inp('f_name', 'Name (optional)', s.name, 1);
  if (s.type === 'xtream') h += inp('f_server', 'Server, e.g. http://example.com:8080', s.server, 2) + inp('f_user', 'Username', s.user, 3) + inp('f_pass', 'Password', s.pass, 4, 'password');
  else h += inp('f_url', 'Playlist URL (.m3u / .m3u8)', s.url, 2);
  h += fi(setupCount() - 2, 'Add and load', 'pri') + fi(setupCount() - 1, 'Cancel') + '</div></div>';
  return h;
}
function setupCount() { return S.setup.type === 'xtream' ? 7 : 5; }
function seriesHTML() {
  var h = topHTML().replace(/<div class="tab[^>]*>[^<]*<\/div>/g, ''), eps = S.series.eps || [], n = 10, s = win(S.epIdx, eps.length, n);
  h += '<div class="body v"><div class="info" style="padding:0"><div class="h">' + esc(S.series.name) + '</div></div><div class="col" style="width:1200px">';
  if (S.series.loading) h += '<div class="empty">Loading episodes…</div>';
  else if (!eps.length) h += '<div class="empty">No episodes found.</div>';
  for (var i = s; i < Math.min(eps.length, s + n); i++) h += '<div class="item' + (i === S.epIdx ? ' focus' : '') + '"><div class="t"><div class="t1">' + esc(eps[i].label) + '</div></div></div>';
  return h + '</div></div>';
}

/* ---------- player ---------- */
var hls = null, vid = $('vid');
function syncMini() {
  var f = $('full'), box = $('prevbox');
  if (S.fullscreen) { f.className = ''; return; }
  if (S.playing && S.view === 'main' && S.tab === 0 && box && !S.loading) {
    f.className = 'mini';
    f.style.cssText = 'left:1216px;top:110px;width:634px;height:357px;border-radius:18px;overflow:hidden';
  } else { f.className = 'hidden'; f.style.cssText = ''; }
}
function msg(t) { var m = $('osdmsg'); if (!t) { m.classList.add('hidden'); return; } m.textContent = t; m.classList.remove('hidden'); }
function startStream(url) {
  stopStream(true);
  var isHls = /\.m3u8(\?|$)/i.test(url) || /\/live\//.test(url);
  var native = vid.canPlayType('application/vnd.apple.mpegurl');
  msg('Loading…');
  if (isHls && !native && window.Hls && Hls.isSupported()) {
    hls = new Hls({ maxBufferLength: 20, lowLatencyMode: false });
    hls.on(Hls.Events.ERROR, function (e, d) { if (d.fatal) msg('Cannot play this stream'); });
    hls.loadSource(prox(url)); hls.attachMedia(vid);
  } else vid.src = prox(url);
  var p = vid.play(); if (p && p.catch) p.catch(function () {});
}
function stopStream(keepUI) { if (hls) { hls.destroy(); hls = null; } try { vid.pause(); vid.removeAttribute('src'); vid.load(); } catch (e) {} if (!keepUI) msg(''); }
vid.addEventListener('playing', function () { msg(''); });
vid.addEventListener('error', function () { msg('Cannot play this stream'); });
vid.addEventListener('waiting', function () { msg('Buffering…'); });
function loadEPG(ch) {
  S.epg = null;
  var pl = activePl();
  if (!ch.sid || !pl || pl.type !== 'xtream') return;
  getJSON(xt(pl, 'get_short_epg', '&stream_id=' + ch.sid + '&limit=2')).then(function (r) {
    if (!S.playing || S.playing.id !== ch.id) return;
    var l = (r && r.epg_listings) || [], dec = function (x) { try { return decodeURIComponent(escape(atob(x))); } catch (e) { return x; } };
    var m = function (e) { return e ? { title: dec(e.title), start: +e.start_timestamp, end: +e.stop_timestamp } : null; };
    S.epg = { now: m(l[0]), next: m(l[1]) };
    if (S.view === 'main' && S.tab === 0) render(); showOSD();
  }).catch(function () {});
}
function playChannel(ch, full) {
  S.playing = ch; S.recent = [ch.id].concat(S.recent.filter(function (x) { return x !== ch.id; })).slice(0, 30); store.set('recent', S.recent);
  startStream(ch.url); loadEPG(ch);
  if (full) goFull(); else render();
}
function playVOD(item) { S.playing = item; S.epg = null; startStream(item.url); goFull(); }
var osdT;
function showOSD() {
  if (!S.fullscreen || !S.playing) return;
  var o = $('osd'), e = S.epg;
  o.innerHTML = '<div class="a">' + logoHTML(S.playing) + '<div><div class="h">' + esc((S.playing.num ? S.playing.num + '  ' : '') + S.playing.name) + '</div><div class="s">' + (e && e.now ? 'Now: ' + esc(e.now.title) + (e.next ? '   ·   Next: ' + esc(e.next.title) : '') : '') + '</div></div></div>';
  o.classList.remove('hidden'); clearTimeout(osdT); osdT = setTimeout(function () { o.classList.add('hidden'); }, 4000);
}
function goFull() { S.fullscreen = true; $('full').className = ''; $('full').style.cssText = ''; showOSD(); }
function exitFull() { S.fullscreen = false; $('osd').classList.add('hidden'); render(); }
function zap(d) {
  var list = liveList(); if (!list.length) return;
  var i = -1; for (var k = 0; k < list.length; k++) if (S.playing && list[k].id === S.playing.id) i = k;
  if (i < 0) i = S.chIdx; i = (i + d + list.length) % list.length; S.chIdx = i; S.live = true; playChannel(list[i], true);
}

/* ---------- series ---------- */
function openSeries(it) {
  var pl = activePl(); S.series = { name: it.name, loading: true, eps: [] }; S.view = 'series'; S.epIdx = 0; render();
  getJSON(xt(pl, 'get_series_info', '&series_id=' + it.sid)).then(function (r) {
    var eps = [], b = base(pl.server), u = encodeURIComponent(pl.user), p = encodeURIComponent(pl.pass);
    var seasons = r.episodes || {};
    Object.keys(seasons).sort(function (a, b) { return a - b; }).forEach(function (sn) {
      seasons[sn].forEach(function (e) { eps.push({ label: 'S' + sn + ' E' + (e.episode_num || '?') + '  ' + (e.title || ''), name: it.name + ' S' + sn + 'E' + e.episode_num, logo: it.logo, id: 'e' + e.id, url: b + '/series/' + u + '/' + p + '/' + e.id + '.' + (e.container_extension || 'mp4') }); });
    });
    S.series.eps = eps; S.series.loading = false; render();
  }).catch(function () { S.series.loading = false; render(); toast('Could not load episodes'); });
}

/* ---------- setup / playlist mgmt ---------- */
function readInputs() {
  var g = function (id) { var e = $(id); return e ? e.value : null; }, s = S.setup;
  if (g('f_name') !== null) s.name = g('f_name');
  if (g('f_server') !== null) s.server = g('f_server');
  if (g('f_user') !== null) s.user = g('f_user');
  if (g('f_pass') !== null) s.pass = g('f_pass');
  if (g('f_url') !== null) s.url = g('f_url');
}
function addPlaylist() {
  readInputs(); var s = S.setup, pl;
  if (s.type === 'xtream') { if (!s.server.trim() || !s.user.trim()) return toast('Enter server and username'); pl = { type: 'xtream', server: s.server.trim(), user: s.user.trim(), pass: s.pass, name: s.name.trim() || s.server.trim() }; }
  else { if (!/^https?:\/\//i.test(s.url.trim())) return toast('Enter a link starting with http'); pl = { type: 'm3u', url: s.url.trim(), name: s.name.trim() || 'My playlist' }; }
  pl.id = 'p' + Date.now(); S.playlists.push(pl); S.active = pl.id; store.set('playlists', S.playlists); store.set('active', S.active);
  S.view = 'main'; S.tab = 0; S.zone = 'chans'; S.catIdx = 0; loadLibrary();
}
function openSetup() { S.setup = { type: 'xtream', name: '', url: '', server: '', user: '', pass: '' }; S.view = 'setup'; S.fi = 0; S.fj = 0; render(); }
function removeActive() {
  S.playlists = S.playlists.filter(function (p) { return p.id !== S.active; }); S.active = S.playlists.length ? S.playlists[0].id : null;
  store.set('playlists', S.playlists); store.set('active', S.active); S.lib = null; S.playing = null; stopStream(); S.fi = 0;
  if (S.active) loadLibrary(); else render();
}

/* ---------- keys ---------- */
var K = { L: 37, U: 38, R: 39, D: 40, OK: 13 };
function isBack(e) { return e.keyCode === 8 || e.keyCode === 27 || e.keyCode === 461 || e.keyCode === 10009 || e.key === 'XF86Back' || e.key === 'BrowserBack'; }
function focusInput() { var el = document.querySelector('input.f.focus'); if (el) el.focus(); }
function setTab(i) {
  i = clamp(i, 0, S.tabs.length - 1); if (i === S.tab) return;
  if (S.tab === 0 && !S.fullscreen) { S.playing = null; stopStream(); }
  S.tab = i; S.fi = 0;
}
function key(e) {
  var k = e.keyCode, ae = document.activeElement, inInput = ae && ae.tagName === 'INPUT';
  if (S.fullscreen) {
    if (isBack(e) || k === K.L) { e.preventDefault(); if (S.live === false) { S.live = true; S.playing = null; stopStream(); } exitFull(); return; }
    if (k === K.U || k === 33 || k === 427) { e.preventDefault(); if (S.live) zap(-1); else showOSD(); return; }
    if (k === K.D || k === 34 || k === 428) { e.preventDefault(); if (S.live) zap(1); else showOSD(); return; }
    if (k === K.OK) { e.preventDefault(); if (S.live === false) { vid.paused ? vid.play() : vid.pause(); } showOSD(); return; }
    if (k === K.R && S.live === false) { vid.currentTime += 30; showOSD(); return; }
    if (k === 415) vid.play(); if (k === 19) vid.pause(); if (k === 463) { vid.paused ? vid.play() : vid.pause(); } if (k === 413) { if (S.live === false) { S.live = true; S.playing = null; stopStream(); } exitFull(); return; } if (k === 417) vid.currentTime += 30; if (k === 412) vid.currentTime -= 30;
    showOSD(); return;
  }
  if (inInput) {
    if (isBack(e) && k !== 8) { ae.blur(); readInputs(); S.proxy = $('proxy') ? $('proxy').value : S.proxy; return; }
    if (k === K.U || k === K.D) { e.preventDefault(); ae.blur(); if (ae.id === 'proxy') { S.proxy = ae.value.trim(); store.set('proxy', S.proxy); } else readInputs(); /* fall through to navigation */ }
    else if (k === K.OK) { e.preventDefault(); ae.blur(); if (ae.id === 'proxy') { S.proxy = ae.value.trim(); store.set('proxy', S.proxy); toast('Proxy saved'); } else readInputs(); render(); return; }
    else return;
  }
  var nav = k >= 37 && k <= 40 || k === K.OK || isBack(e);
  if (!nav) return; e.preventDefault();
  if (S.view === 'setup') return setupKey(k, e);
  if (S.view === 'series') return seriesKey(k, e);
  if (!activePl()) { if (k === K.OK) openSetup(); return; }
  if (S.err) { if (k === K.OK) loadLibrary(); if (isBack(e) || k === K.U) { S.zone = 'tabs'; S.tab = 3; S.err = ''; S.loading = false; render(); } return; }
  if (S.loading) return;
  if (S.zone === 'tabs') {
    if (isBack(e)) { try { window.close(); } catch (x) {} return; }
    if (k === K.L) setTab(S.tab - 1); else if (k === K.R) setTab(S.tab + 1);
    else if (k === K.D || k === K.OK) { S.zone = S.tab === 0 ? 'chans' : S.tab === 3 ? 'form' : 'gcats'; S.fi = 0; }
    render(); return;
  }
  if (isBack(e)) { S.zone = 'tabs'; render(); return; }
  if (S.tab === 0) {
    var list = liveList(), cats = liveCats();
    if (S.zone === 'cats') {
      if (k === K.U) { if (S.catIdx === 0) S.zone = 'tabs'; else { S.catIdx--; S.chIdx = 0; } }
      else if (k === K.D) { S.catIdx = Math.min(cats.length - 1, S.catIdx + 1); S.chIdx = 0; }
      else if (k === K.R || k === K.OK) S.zone = 'chans';
    } else {
      if (k === K.U) { if (S.chIdx === 0) S.zone = 'tabs'; else S.chIdx--; }
      else if (k === K.D) S.chIdx = Math.min(list.length - 1, S.chIdx + 1);
      else if (k === K.L) S.zone = 'cats';
      else if (k === K.R) { var c = list[S.chIdx]; if (c) { S.fav[favKey(c)] = !S.fav[favKey(c)]; if (!S.fav[favKey(c)]) delete S.fav[favKey(c)]; store.set('fav', S.fav); toast(isFav(c) ? 'Added to favorites' : 'Removed from favorites'); if (liveCats()[S.catIdx] === 'Favorites') S.chIdx = clamp(S.chIdx, 0, Math.max(0, liveList().length - 1)); } }
      else if (k === K.OK) { var ch = list[S.chIdx]; if (ch) { S.live = true; if (S.playing && S.playing.id === ch.id) goFull(); else playChannel(ch, false); } }
    }
    return render();
  }
  if (S.tab === 1 || S.tab === 2) {
    var kind = S.tab === 1 ? 'm' : 's', cs = ['x'].concat(kind === 'm' ? S.lib.mcats : S.lib.scats), g = gridList(kind), cols = 8;
    var ci = kind === 'm' ? 'mCat' : 'sCat', ii = kind === 'm' ? 'mIdx' : 'sIdx';
    if (S.zone === 'gcats') {
      if (k === K.L) { S[ci] = Math.max(0, S[ci] - 1); S[ii] = 0; } else if (k === K.R) { S[ci] = Math.min(cs.length - 1, S[ci] + 1); S[ii] = 0; }
      else if (k === K.U) S.zone = 'tabs'; else if (k === K.D || k === K.OK) { if (g.length) S.zone = 'grid'; }
    } else {
      var i = S[ii];
      if (k === K.L) S[ii] = Math.max(0, i - 1); else if (k === K.R) S[ii] = Math.min(g.length - 1, i + 1);
      else if (k === K.U) { if (i < cols) S.zone = 'gcats'; else S[ii] = i - cols; }
      else if (k === K.D) S[ii] = Math.min(g.length - 1, i + cols);
      else if (k === K.OK && g[i]) { S.live = false; if (kind === 'm') playVOD(g[i]); else openSeries(g[i]); return; }
    }
    return render();
  }
  if (S.tab === 3) {
    var n = settingsCount(), pc = S.playlists.length;
    if (k === K.U) { if (S.fi === 0) S.zone = 'tabs'; else S.fi--; }
    else if (k === K.D) S.fi = Math.min(n - 1, S.fi + 1);
    else if (k === K.OK) {
      if (S.fi < pc) { S.active = S.playlists[S.fi].id; store.set('active', S.active); S.playing = null; stopStream(); loadLibrary(); return; }
      if (S.fi === pc) return openSetup();
      if (S.fi === pc + 1) return loadLibrary();
      if (S.fi === pc + 2) return removeActive();
      render(); return focusInput();
    }
    render();
  }
}
function setupKey(k, e) {
  var n = setupCount();
  if (isBack(e)) { if (S.playlists.length) { S.view = 'main'; S.zone = 'tabs'; render(); } return; }
  if (S.fi === 0 && (k === K.L || k === K.R)) { S.fj = k === K.L ? 0 : 1; readInputs(); S.setup.type = S.fj === 0 ? 'xtream' : 'm3u'; render(); return; }
  if (k === K.U) S.fi = Math.max(0, S.fi - 1); else if (k === K.D) S.fi = Math.min(n - 1, S.fi + 1);
  else if (k === K.OK) {
    if (S.fi === 0) { S.setup.type = S.fj === 0 ? 'xtream' : 'm3u'; render(); return; }
    if (S.fi === n - 2) return addPlaylist();
    if (S.fi === n - 1) { if (S.playlists.length) { S.view = 'main'; S.zone = 'tabs'; } render(); return; }
    render(); return focusInput();
  }
  readInputs(); render();
}
function seriesKey(k, e) {
  var eps = S.series.eps || [];
  if (isBack(e) || k === K.L) { S.view = 'main'; S.zone = 'grid'; render(); return; }
  if (k === K.U) S.epIdx = Math.max(0, S.epIdx - 1); else if (k === K.D) S.epIdx = Math.min(eps.length - 1, S.epIdx + 1);
  else if (k === K.OK && eps[S.epIdx]) { S.live = false; playVOD(eps[S.epIdx]); return; }
  render();
}
addEventListener('keydown', key);

/* ---------- boot ---------- */
S.live = true;
if (S.active && !activePl()) S.active = S.playlists.length ? S.playlists[0].id : null;
S.zone = 'chans';
render();
if (activePl()) loadLibrary();
// Enter key on welcome screen
})();

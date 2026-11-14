/* ============================================================
   Hertz Forge — mobile UI
   ============================================================ */
(function (global) {
  'use strict';

  var M = global.HFModel;
  var player = new global.HFPlayer.Player();

  var state = {
    playlists: [],
    masterVol: 50,
    chain: { loop: false, shuffle: false },
    play: null,              /* { pi, mode } */
    queue: [],
    queuePos: 0,
    active: { pi: -1, ri: -1 }
  };

  var els = {};
  var saveTimer = 0;
  var updateTimer = 0;
  var pendingUpdate = -1;
  var wakeLock = null;
  var busyExport = false;
  var importTarget = -1;
  var statusHold = 0;   /* keep a transient message visible over playback text */

  /* ── helpers ─────────────────────────────────────────────── */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtTime(sec) {
    var e = Math.max(0, Math.floor(sec || 0));
    var s = e % 60;
    var m = Math.floor(e / 60) % 60;
    var h = Math.floor(e / 3600);
    if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    return m + ':' + String(s).padStart(2, '0');
  }

  function setStatus(msg, kind) {
    els.dockInfo.textContent = msg || '';
    els.dockInfo.dataset.kind = kind || '';
    statusHold = Date.now() + (kind === 'busy' ? 60000 : 4000);
    if (!state.play) {
      els.dockTime.textContent = '';
      els.dockFill.style.width = '0%';
    }
  }

  function clampNum(v, lo, hi) {
    if (!isFinite(v)) return lo;
    return Math.min(hi, Math.max(lo, v));
  }

  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 250);
  }

  function saveNow() {
    M.saveState({ playlists: state.playlists, masterVol: state.masterVol, chain: state.chain });
  }

  /* ── engine payloads ─────────────────────────────────────── */

  function engineRows(pl) {
    return pl.rows.map(function (r) {
      return {
        included: r.included !== false,
        duration: r.duration,
        binaural_on: r.binaural_on,
        bi_carrier: r.bi_carrier,
        bi_wave: r.bi_wave,
        bi_bw: r.bi_bw,
        bi_left_amp: r.bi_left_amp,
        bi_right_amp: r.bi_right_amp,
        left: Object.assign({}, r.left),
        right: Object.assign({}, r.right)
      };
    });
  }

  function engineOpts(pl) {
    return {
      loop: !!pl.row_loop,
      shuffle: !!pl.row_shuffle,
      playRows: pl.play_rows | 0,
      seed: pl.seed || 12345
    };
  }

  /* Throttled so slider drags don't flood the audio thread. */
  function pushUpdate(pi) {
    if (!state.play || state.play.pi !== pi) return;
    pendingUpdate = pi;
    if (updateTimer) return;
    updateTimer = setTimeout(function () {
      updateTimer = 0;
      var target = pendingUpdate;
      pendingUpdate = -1;
      var pl = state.playlists[target];
      if (!pl || !state.play || state.play.pi !== target) return;
      player.update(engineRows(pl), engineOpts(pl));
    }, 60);
  }

  /* ── markup ──────────────────────────────────────────────── */

  function ctlAttrs(pi, ri, scope, field, side) {
    return 'data-pi="' + pi + '" data-ri="' + ri + '" data-scope="' + scope +
      '" data-field="' + field + '"' + (side ? ' data-side="' + side + '"' : '');
  }

  function rangeField(pi, ri, scope, field, side, value, min, max, step, unit, label) {
    var v = +value;
    var s = parseFloat(step) || 1;
    var txt = (s < 1 ? v.toFixed(1) : String(Math.round(v))) + (unit ? ' ' + unit : '');
    return '<label class="field"><span class="lab-row"><span class="lab">' + label + '</span>' +
      '<output>' + txt + '</output></span>' +
      '<input type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + v +
      '" data-unit="' + (unit || '') + '" ' + ctlAttrs(pi, ri, scope, field, side) + '>' +
      '</label>';
  }

  function waveField(pi, ri, scope, field, side, value, label) {
    return '<label class="field"><span class="lab">' + label + '</span>' +
      '<select ' + ctlAttrs(pi, ri, scope, field, side) + '>' +
      M.WAVES.map(function (w) {
        return '<option value="' + w + '"' + (w === value ? ' selected' : '') + '>' +
          w.charAt(0).toUpperCase() + w.slice(1) + '</option>';
      }).join('') + '</select></label>';
  }

  function numField(pi, ri, scope, field, side, value, min, max, step, unit, label) {
    return '<label class="field"><span class="lab">' + label + '</span><span class="ctl">' +
      '<input class="num" type="number" inputmode="decimal" min="' + min + '" max="' + max +
      '" step="' + step + '" value="' + Math.round(value) + '" data-unit="' + (unit || '') + '" ' +
      ctlAttrs(pi, ri, scope, field, side) + '><em class="unit">' + (unit || '') + '</em>' +
      '</span></label>';
  }

  function sidesBody(pi, ri, row) {
    function side(s) {
      var ch = row[s];
      var tag = s === 'left' ? 'L' : 'R';
      return '<div class="side"><h4>' + tag + '</h4>' +
        rangeField(pi, ri, 'ch', 'carrier', s, ch.carrier, 0, 2000, 1, 'Hz', 'Carrier') +
        waveField(pi, ri, 'ch', 'wave', s, ch.wave, 'Wave') +
        rangeField(pi, ri, 'ch', 'bw', s, ch.bw_freq, 0, 100, 0.5, 'Hz', 'BW') +
        rangeField(pi, ri, 'ch', 'amp', s, ch.amp_val, 0, 100, 1, '', 'Amp') +
        rangeField(pi, ri, 'ch', 'vol', s, ch.vol, 0, 100, 1, '%', 'Vol') +
        '</div>';
    }
    return '<div class="sides">' + side('left') + side('right') + '</div>';
  }

  function binBody(pi, ri, row) {
    return '<div class="bin">' +
      rangeField(pi, ri, 'bi', 'bi-carrier', '', row.bi_carrier, 0, 2000, 1, 'Hz', 'Center') +
      waveField(pi, ri, 'bi', 'bi-wave', '', row.bi_wave, 'Wave') +
      rangeField(pi, ri, 'bi', 'bi-bw', '', row.bi_bw, 0, 100, 0.5, 'Hz', 'Beat') +
      '<div class="sides">' +
        '<div class="side"><h4>L</h4>' +
          '<div class="field"><span class="lab">Carrier</span><span class="ctl">' +
            '<b class="comp" data-comp="bin-l">' + (row.bi_carrier - row.bi_bw / 2).toFixed(2) +
            ' Hz</b></span></div>' +
          rangeField(pi, ri, 'ch', 'bi-amp', 'left', row.bi_left_amp, 0, 100, 1, '', 'Amp') +
          rangeField(pi, ri, 'ch', 'vol', 'left', row.left.vol, 0, 100, 1, '%', 'Vol') +
        '</div>' +
        '<div class="side"><h4>R</h4>' +
          '<div class="field"><span class="lab">Carrier</span><span class="ctl">' +
            '<b class="comp" data-comp="bin-r">' + (row.bi_carrier + row.bi_bw / 2).toFixed(2) +
            ' Hz</b></span></div>' +
          rangeField(pi, ri, 'ch', 'bi-amp', 'right', row.bi_right_amp, 0, 100, 1, '', 'Amp') +
          rangeField(pi, ri, 'ch', 'vol', 'right', row.right.vol, 0, 100, 1, '%', 'Vol') +
        '</div>' +
      '</div></div>';
  }

  function advBody(pi, ri, row) {
    function side(s) {
      var ch = row[s];
      var eff = effectiveCarrier(row, s);
      var tag = s === 'left' ? 'L' : 'R';
      return '<div class="side"><h4>' + tag + ' · advanced</h4>' +
        rangeField(pi, ri, 'ch', 'bi', s, ch.bi_val, 0, 100, 1, '', 'Bi') +
        '<label class="chk"><input type="checkbox" ' + ctlAttrs(pi, ri, 'ch', 'fm', s) +
          (ch.fm_on ? ' checked' : '') + '> FM</label>' +
        numField(pi, ri, 'ch', 'fm-lo', s, eff + ch.fm_offset_lo, 0, 2000, 1, 'Hz', 'From') +
        numField(pi, ri, 'ch', 'fm-hi', s, eff + ch.fm_offset_hi, 0, 2000, 1, 'Hz', 'To') +
        '</div>';
    }
    return '<div class="sides">' + side('left') + side('right') + '</div>';
  }

  function rowBodyHTML(pi, ri, row) {
    var mode = row.binaural_on ? 'bin' : (row.adv_on ? 'adv' : 'norm');
    var d = 'data-pi="' + pi + '" data-ri="' + ri + '"';

    var html = '<div class="row-top">' +
      '<div class="seg">' +
        '<button class="seg-btn' + (mode === 'norm' ? ' on' : '') + '" data-act="row-mode" data-mode="norm" ' + d + '>Normal</button>' +
        '<button class="seg-btn' + (mode === 'bin' ? ' on' : '') + '" data-act="row-mode" data-mode="bin" ' + d + '>Binaural</button>' +
      '</div>' +
      (mode === 'norm'
        ? '<button class="seg-btn adv-toggle' + (row.adv_on ? ' on' : '') + '" data-act="row-mode" data-mode="' +
          (row.adv_on ? 'norm' : 'adv') + '" ' + d + '>Adv ' + (row.adv_on ? '▾' : '▸') + '</button>'
        : '') +
      '<label class="chk"><input type="checkbox" ' + ctlAttrs(pi, ri, 'row', 'sync') +
        (row.sync_on ? ' checked' : '') + '> sync</label>' +
      '<label class="dur">for <input class="num" type="number" inputmode="numeric" min="0" max="36000" step="1" value="' +
        Math.round(row.duration) + '" ' + ctlAttrs(pi, ri, 'row', 'duration') + '> s</label>' +
      '</div>';

    if (mode === 'bin') return html + binBody(pi, ri, row);
    html += sidesBody(pi, ri, row);
    if (mode === 'adv') html += advBody(pi, ri, row);
    return html;
  }

  function rowSummary(row) {
    if (row.binaural_on) {
      return 'Binaural · ' + Math.round(row.bi_carrier) + ' Hz · ' + row.bi_bw + ' Hz beat';
    }
    if (row.adv_on) return 'Adv · ' + Math.round(row.left.carrier) + ' Hz';
    var wave = row.left.wave || 'sine';
    return 'Normal · ' + Math.round(row.left.carrier) + ' Hz · ' +
      wave.charAt(0).toUpperCase() + wave.slice(1);
  }

  function rowHTML(pi, ri, row) {
    var active = state.active.pi === pi && state.active.ri === ri;
    var name = row.name || ('Row ' + (ri + 1));
    var d = 'data-pi="' + pi + '" data-ri="' + ri + '"';
    var check = '<label class="check-wrap"><input type="checkbox" class="check" ' +
      ctlAttrs(pi, ri, 'row', 'include') + (row.included !== false ? ' checked' : '') +
      ' aria-label="Include row"></label>';
    var caret = '<span class="caret" aria-hidden="true">' + (row.collapsed ? '▸' : '▾') + '</span>';
    var more = '<button class="icon" type="button" data-act="row-more" ' + d +
      ' aria-label="Row actions" aria-expanded="false">⋯</button>';

    if (row.collapsed) {
      return '<article class="row collapsed' + (active ? ' active' : '') + '" ' + d + '>' +
        '<div class="row-head">' + check + caret +
          '<span class="row-name">' + esc(name) + '</span>' +
          '<span class="row-time" data-time="' + pi + ':' + ri + '">' + fmtTime(row.duration) + '</span>' +
          more +
        '</div>' +
        '<div class="row-sum">' + rowSummary(row) + '</div>' +
      '</article>';
    }

    return '<article class="row' + (active ? ' active' : '') + '" ' + d + '>' +
      '<div class="row-head">' + check + caret +
        '<span class="row-name">' + esc(name) + '</span>' +
        '<span class="row-time" data-time="' + pi + ':' + ri + '">' +
          fmtTime(active ? 0 : row.duration) + '</span>' +
        more +
      '</div>' +
      '<div class="row-body">' + rowBodyHTML(pi, ri, row) +
        '<div class="row-actions" hidden>' +
          '<button class="btn small" type="button" data-act="row-dup" ' + d + '>Duplicate</button>' +
          '<button class="btn small" type="button" data-act="row-up" ' + d + '>↑ Up</button>' +
          '<button class="btn small" type="button" data-act="row-down" ' + d + '>↓ Down</button>' +
          '<button class="btn small" type="button" data-act="row-save" ' + d + '>Save .hfc</button>' +
          '<button class="btn small danger" type="button" data-act="row-del" ' + d + '>Delete</button>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function playlistHTML(pl, pi) {
    var playing = !!(state.play && state.play.pi === pi);
    var total = M.playbackDuration(pl);
    var d = 'data-pi="' + pi + '"';

    return '<section class="pl' + (pl.collapsed ? ' collapsed' : '') + (playing ? ' playing' : '') + '" ' + d + '>' +
      '<div class="pl-head">' +
        '<label class="check-wrap"><input type="checkbox" class="check" ' + ctlAttrs(pi, 0, 'pl', 'include') +
          (pl.included !== false ? ' checked' : '') + ' aria-label="Include playlist"></label>' +
        '<span class="caret" aria-hidden="true">' + (pl.collapsed ? '▸' : '▾') + '</span>' +
        '<div class="pl-title">' +
          '<input class="pl-name" type="text" value="' + esc(pl.name) + '" ' +
            ctlAttrs(pi, 0, 'pl', 'name') + ' aria-label="Playlist name">' +
          '<span class="total" data-total="' + pi + '">' + fmtTime(total) + '</span>' +
        '</div>' +
        '<button class="btn play' + (playing ? ' stop' : '') + '" type="button" data-act="pl-play" ' + d +
          ' aria-label="' + (playing ? 'Stop playlist' : 'Play playlist') + '">' +
          (playing ? '■' : '▶') + '</button>' +
        '<button class="icon" type="button" data-act="pl-more" ' + d +
          ' aria-label="Playlist actions" aria-expanded="false">⋯</button>' +
      '</div>' +
      '<div class="pl-meta">' +
        '<label class="chk"><input type="checkbox" ' + ctlAttrs(pi, 0, 'pl', 'loop') +
          (pl.row_loop ? ' checked' : '') + '> loop</label>' +
        '<label class="chk"><input type="checkbox" ' + ctlAttrs(pi, 0, 'pl', 'shuffle') +
          (pl.row_shuffle ? ' checked' : '') + '> shuffle</label>' +
        '<label class="chk tiny">rows <input class="num" type="number" inputmode="numeric" min="0" max="99" value="' +
          (pl.play_rows | 0) + '" ' + ctlAttrs(pi, 0, 'pl', 'playrows') + '></label>' +
      '</div>' +
      (pl.collapsed ? '' :
        '<div class="pl-more" hidden>' +
          '<button class="btn small" type="button" data-act="pl-wav" ' + d + '>Export WAV</button>' +
          '<button class="btn small" type="button" data-act="pl-dup" ' + d + '>Duplicate</button>' +
          '<button class="btn small" type="button" data-act="pl-load" ' + d + '>Load .hfc</button>' +
          '<button class="btn small danger" type="button" data-act="pl-del" ' + d + '>Delete</button>' +
        '</div>' +
        '<div class="rows">' + pl.rows.map(function (r, ri) {
          return rowHTML(pi, ri, r);
        }).join('') + '</div>' +
        '<button class="btn add" type="button" data-act="row-add" ' + d + '>＋ row</button>') +
      '</section>';
  }

  /* Rebuilds the playlist list while keeping the viewport and the focused
     control where the user left them. Structural edits otherwise jump the
     page, close the keyboard and lose the caret. */
  function renderAll(opts) {
    opts = opts || {};
    var scrollY = window.scrollY;
    var focus = captureFocus();
    var anchor = opts.anchor || null;
    var anchorSel = anchor ? selectorForEl(anchor) : null;
    var anchorTop = anchor ? anchor.getBoundingClientRect().top : 0;

    els.list.innerHTML = state.playlists.map(playlistHTML).join('');

    var again = anchorSel ? els.list.querySelector(anchorSel) : null;
    if (anchor && again) {
      /* Keep the control the user just tapped under their thumb. */
      var delta = again.getBoundingClientRect().top - anchorTop;
      if (delta) window.scrollBy(0, delta);
    } else {
      window.scrollTo(0, scrollY);
    }
    restoreFocus(focus);
    syncChrome();
  }

  /* Stable identity for a rendered control, independent of DOM order. */
  function selectorForEl(el) {
    if (!el || !el.dataset) return null;
    var ds = el.dataset;
    var parts = [];
    if (ds.act) parts.push('[data-act="' + ds.act + '"]');
    if (ds.scope) parts.push('[data-scope="' + ds.scope + '"]');
    if (ds.field) parts.push('[data-field="' + ds.field + '"]');
    if (ds.side) parts.push('[data-side="' + ds.side + '"]');
    if (ds.mode) parts.push('[data-mode="' + ds.mode + '"]');
    if (ds.pi != null) parts.push('[data-pi="' + ds.pi + '"]');
    if (ds.ri != null) parts.push('[data-ri="' + ds.ri + '"]');
    return parts.length ? parts.join('') : null;
  }

  function captureFocus() {
    var el = document.activeElement;
    if (!el || el === document.body || !els.list.contains(el)) return null;
    var sel = selectorForEl(el);
    if (!sel) return null;
    var start = null;
    var end = null;
    try {
      if (typeof el.selectionStart === 'number') {
        start = el.selectionStart;
        end = el.selectionEnd;
      }
    } catch (e) {
      /* number inputs reject selection reads in some browsers */
    }
    return { sel: sel, start: start, end: end };
  }

  function restoreFocus(key) {
    if (!key) return;
    var el = els.list.querySelector(key.sel);
    if (!el) return;
    try {
      el.focus({ preventScroll: true });
    } catch (e) {
      return;
    }
    if (key.start != null) {
      try {
        el.setSelectionRange(key.start, key.end);
      } catch (e) {
        /* not a text input */
      }
    }
  }

  function syncChrome() {
    var playing = !!state.play;
    els.dockPlay.textContent = playing ? '■' : '▶';
    els.dockPlay.classList.toggle('stop', playing);
    els.dockPlay.setAttribute('aria-label', playing ? 'Stop' : 'Play all');
    setToggle(els.chainLoop, state.chain.loop);
    setToggle(els.chainShuffle, state.chain.shuffle);
    els.vol.value = state.masterVol;
    els.volOut.textContent = Math.round(state.masterVol) + '%';
    els.volLabel.textContent = Math.round(state.masterVol) + '%';
    els.prev.disabled = !canStep(-1);
    els.next.disabled = !canStep(1);
    if (!playing) {
      els.dockTime.textContent = '';
      els.dockFill.style.width = '0%';
    }
  }

  function setToggle(btn, on) {
    btn.classList.toggle('on', !!on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function refreshTotal(pi) {
    var el = els.list.querySelector('[data-total="' + pi + '"]');
    if (el) el.textContent = fmtTime(M.playbackDuration(state.playlists[pi]));
  }

  /* ── model helpers used by the UI ────────────────────────── */

  function effectiveCarrier(row, side) {
    if (row.binaural_on) {
      return side === 'left'
        ? row.bi_carrier - row.bi_bw / 2
        : row.bi_carrier + row.bi_bw / 2;
    }
    return (row[side] || row.left).carrier;
  }

  function mirrorChannel(row, side) {
    var src = side === 'left' ? row.left : row.right;
    var dst = side === 'left' ? row.right : row.left;

    if (row.binaural_on) {
      if (side === 'left') {
        row.bi_right_amp = row.bi_left_amp;
        row.right.vol = row.left.vol;
      } else {
        row.bi_left_amp = row.bi_right_amp;
        row.left.vol = row.right.vol;
      }
      return;
    }

    dst.carrier = src.carrier;
    dst.wave = src.wave;
    dst.bw_freq = src.bw_freq;
    dst.amp_val = src.amp_val;
    dst.vol = src.vol;
    dst.bi_val = src.bi_val;
    dst.fm_on = src.fm_on;
    dst.fm_offset_lo = src.fm_offset_lo;
    dst.fm_offset_hi = src.fm_offset_hi;
  }

  function carryNormalToBin(row) {
    row.bi_carrier = (row.left.carrier + row.right.carrier) / 2;
    row.bi_bw = row.left.bw_freq;
    row.bi_wave = row.left.wave;
    row.left.carrier = row.bi_carrier - row.bi_bw / 2;
    row.right.carrier = row.bi_carrier + row.bi_bw / 2;
    row.left.bw_freq = row.bi_bw;
    row.right.bw_freq = row.bi_bw;
  }

  function carryBinToNormal(row) {
    row.left.carrier = row.bi_carrier;
    row.right.carrier = row.bi_carrier;
    row.left.bw_freq = row.bi_bw;
    row.right.bw_freq = row.bi_bw;
    row.left.wave = row.bi_wave;
    row.right.wave = row.bi_wave;
  }

  /* ── syncing controls back to the model ──────────────────── */

  var CH_KEY = {
    carrier: 'carrier', wave: 'wave', bw: 'bw_freq', amp: 'amp_val',
    vol: 'vol', bi: 'bi_val', fm: 'fm_on'
  };

  function updateOut(inp) {
    var out = inp.parentNode && inp.parentNode.querySelector('output');
    if (!out) return;
    var step = parseFloat(inp.step) || 1;
    var v = parseFloat(inp.value);
    var unit = inp.dataset.unit || '';
    out.textContent = (step < 1 ? v.toFixed(1) : String(Math.round(v))) + (unit ? ' ' + unit : '');
  }

  function refreshRowInputs(pi, ri) {
    var rowEl = els.list.querySelector('article.row[data-pi="' + pi + '"][data-ri="' + ri + '"]');
    var row = state.playlists[pi] && state.playlists[pi].rows[ri];
    if (!rowEl || !row) return;

    var inputs = rowEl.querySelectorAll('[data-scope]');
    for (var i = 0; i < inputs.length; i++) {
      var inp = inputs[i];
      var scope = inp.dataset.scope;
      var f = inp.dataset.field;
      var side = inp.dataset.side;
      var v;

      if (scope === 'ch') {
        var ch = row[side || 'left'];
        if (!ch) continue;
        if (f === 'bi-amp') v = side === 'right' ? row.bi_right_amp : row.bi_left_amp;
        else if (f === 'fm-lo') v = Math.round(effectiveCarrier(row, side) + ch.fm_offset_lo);
        else if (f === 'fm-hi') v = Math.round(effectiveCarrier(row, side) + ch.fm_offset_hi);
        else if (CH_KEY[f]) v = ch[CH_KEY[f]];
      } else if (scope === 'bi') {
        v = { 'bi-carrier': row.bi_carrier, 'bi-bw': row.bi_bw, 'bi-wave': row.bi_wave }[f];
      } else if (scope === 'row' && f === 'duration') {
        v = Math.round(row.duration);
      } else {
        continue;
      }

      if (inp.type === 'checkbox') inp.checked = !!v;
      else inp.value = v;
      if (inp.type === 'range') updateOut(inp);
    }

    var cl = rowEl.querySelector('[data-comp="bin-l"]');
    if (cl) cl.textContent = (row.bi_carrier - row.bi_bw / 2).toFixed(2) + ' Hz';
    var cr = rowEl.querySelector('[data-comp="bin-r"]');
    if (cr) cr.textContent = (row.bi_carrier + row.bi_bw / 2).toFixed(2) + ' Hz';

    var tl = rowEl.querySelector('[data-time]');
    if (tl && !(state.active.pi === pi && state.active.ri === ri)) tl.textContent = fmtTime(row.duration);

    refreshTotal(pi);
  }

  /* ── edits ───────────────────────────────────────────────── */

  function handleEdit(e) {
    var t = e.target;
    var scope = t.dataset.scope;
    if (!scope) return;

    var pi = Number(t.dataset.pi);
    var pl = state.playlists[pi];
    if (!pl) return;
    var ri = Number(t.dataset.ri);
    var row = pl.rows[ri];

    if (scope === 'pl') {
      switch (t.dataset.field) {
        case 'name':
          pl.name = t.value;
          saveSoon();
          return;
        case 'include':
          pl.included = t.checked;
          break;
        case 'loop':
          pl.row_loop = t.checked;
          break;
        case 'shuffle':
          pl.row_shuffle = t.checked;
          break;
        case 'playrows':
          if (t.value === '') return;
          pl.play_rows = Math.round(clampNum(+t.value, 0, 999));
          refreshTotal(pi);
          break;
      }
      saveSoon();
      pushUpdate(pi);
      return;
    }

    if (!row) return;

    if (scope === 'row') {
      switch (t.dataset.field) {
        case 'include':
          row.included = t.checked;
          refreshTotal(pi);
          break;
        case 'duration':
          if (t.value === '') return;
          row.duration = Math.round(clampNum(+t.value, 0, 36000));
          var durLbl = els.list.querySelector('[data-time="' + pi + ':' + ri + '"]');
          if (durLbl && !(state.active.pi === pi && state.active.ri === ri)) {
            durLbl.textContent = fmtTime(row.duration);
          }
          refreshTotal(pi);
          break;
        case 'sync':
          row.sync_on = t.checked;
          if (t.checked) {
            mirrorChannel(row, 'left');
            refreshRowInputs(pi, ri);
          }
          break;
      }
      saveSoon();
      pushUpdate(pi);
      return;
    }

    if (scope === 'bi') {
      switch (t.dataset.field) {
        case 'bi-carrier':
          row.bi_carrier = clampNum(+t.value, 0, 2000);
          break;
        case 'bi-bw':
          row.bi_bw = clampNum(+t.value, 0, 100);
          break;
        case 'bi-wave':
          row.bi_wave = t.value;
          break;
      }
      refreshRowInputs(pi, ri);
      saveSoon();
      pushUpdate(pi);
      return;
    }

    if (scope === 'ch') {
      var side = t.dataset.side || 'left';
      var f = t.dataset.field;
      var ch = row[side];
      if (!ch) return;

      if (f === 'bi-amp') {
        if (side === 'left') row.bi_left_amp = clampNum(+t.value, 0, 100);
        else row.bi_right_amp = clampNum(+t.value, 0, 100);
      } else if (f === 'fm') {
        ch.fm_on = t.checked;
        refreshRowInputs(pi, ri);
      } else if (f === 'fm-lo' || f === 'fm-hi') {
        if (t.value === '') return;
        var off = (+t.value) - effectiveCarrier(row, side);
        if (f === 'fm-lo') ch.fm_offset_lo = off;
        else ch.fm_offset_hi = off;
      } else if (f === 'wave') {
        ch.wave = t.value;
      } else if (CH_KEY[f]) {
        var max = f === 'carrier' ? 2000 : 100;
        ch[CH_KEY[f]] = clampNum(+t.value, 0, max);
      } else {
        return;
      }

      if (t.type === 'range') updateOut(t);
      if (row.sync_on) {
        mirrorChannel(row, side);
        refreshRowInputs(pi, ri);
      }
      saveSoon();
      pushUpdate(pi);
    }
  }

  /* ── structural actions ──────────────────────────────────── */

  function togglePanel(el) {
    if (el) el.hidden = !el.hidden;
  }

  function addPlaylist() {
    var pl = M.newPlaylist('Playlist ' + (state.playlists.length + 1));
    state.playlists.push(pl);
    saveNow();
    renderAll();
    setStatus('Added ' + pl.name);
  }

  function duplicatePlaylist(pi) {
    var src = state.playlists[pi];
    var copy = M.clone(src);
    copy.name = src.name + ' (copy)';
    M.renumber(copy);
    state.playlists.splice(pi + 1, 0, copy);
    saveNow();
    renderAll();
    setStatus('Duplicated ' + src.name);
  }

  function removePlaylist(pi) {
    var pl = state.playlists[pi];
    if (!confirm('Delete "' + pl.name + '"? Its ' + pl.rows.length + ' row(s) go with it.')) return;
    if (state.play) stopPlayback(true);
    state.playlists.splice(pi, 1);
    if (!state.playlists.length) state.playlists.push(M.newPlaylist('Playlist 1'));
    saveNow();
    renderAll();
    setStatus('Deleted ' + pl.name);
  }

  function addRow(pi, opener) {
    var pl = state.playlists[pi];
    pl.rows.push(M.newRow());
    M.renumber(pl);
    saveNow();
    /* Anchor on the add button so it stays under the thumb. */
    renderAll({ anchor: opener });
    pushUpdate(pi);
  }

  function removeRow(pi, ri) {
    var pl = state.playlists[pi];
    pl.rows.splice(ri, 1);
    M.renumber(pl);
    if (state.active.pi === pi) state.active = { pi: -1, ri: -1 };
    saveNow();
    renderAll();
    pushUpdate(pi);
  }

  function duplicateRow(pi, ri) {
    var pl = state.playlists[pi];
    pl.rows.splice(ri + 1, 0, M.clone(pl.rows[ri]));
    M.renumber(pl);
    saveNow();
    renderAll();
    pushUpdate(pi);
  }

  function moveRow(pi, ri, delta) {
    var pl = state.playlists[pi];
    var next = ri + delta;
    if (next < 0 || next >= pl.rows.length) return;
    var tmp = pl.rows[ri];
    pl.rows[ri] = pl.rows[next];
    pl.rows[next] = tmp;
    M.renumber(pl);
    saveNow();
    renderAll();
    pushUpdate(pi);
  }

  function setMode(pi, ri, mode) {
    var row = state.playlists[pi].rows[ri];
    if (mode === 'bin') {
      if (!row.binaural_on) carryNormalToBin(row);
      row.binaural_on = true;
      row.adv_on = false;
    } else if (mode === 'adv') {
      if (row.binaural_on) carryBinToNormal(row);
      row.binaural_on = false;
      row.adv_on = true;
    } else {
      if (row.binaural_on) carryBinToNormal(row);
      row.binaural_on = false;
      row.adv_on = false;
    }
    if (row.sync_on) mirrorChannel(row, 'left');
    saveSoon();
    renderAll();
    pushUpdate(pi);
  }

  /* ── files ───────────────────────────────────────────────── */

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.remove();
    }, 2000);
  }

  /* Inside the Android shell a blob download would be swallowed by the
     WebView, so the native bridge writes into Downloads instead. */
  function deliverFile(blob, name) {
    var bridge = global.AndroidBridge;
    if (bridge && typeof bridge.saveFile === 'function' && global.FileReader) {
      var reader = new FileReader();
      reader.onloadend = function () {
        var result = String(reader.result || '');
        var b64 = result.indexOf(',') >= 0 ? result.split(',')[1] : '';
        try {
          bridge.saveFile(name, blob.type || 'application/octet-stream', b64);
        } catch (e) {
          download(blob, name);
        }
      };
      reader.readAsDataURL(blob);
      return;
    }
    download(blob, name);
  }

  function saveRowConfig(pi, ri) {
    var row = state.playlists[pi].rows[ri];
    var blob = new Blob([JSON.stringify(M.rowToDict(row), null, 2)], { type: 'application/json' });
    deliverFile(blob, M.suggestedFilename(row));
    setStatus('Saved ' + M.suggestedFilename(row), 'ok');
  }

  function beginImport(pi) {
    importTarget = pi;
    els.file.value = '';
    els.file.click();
  }

  async function onFiles() {
    var files = Array.prototype.slice.call(els.file.files || []);
    if (!files.length) return;

    var target = state.playlists[importTarget] || state.playlists[state.playlists.length - 1];
    if (!target) return;

    var added = 0;
    var failed = [];

    for (var i = 0; i < files.length; i++) {
      try {
        var text = await files[i].text();
        target.rows.push(M.parseConfig(text));
        added++;
      } catch (err) {
        failed.push(files[i].name + ': ' + err.message);
      }
    }

    M.renumber(target);
    saveNow();
    renderAll();
    pushUpdate(state.playlists.indexOf(target));

    if (added) {
      setStatus('Loaded ' + added + ' row(s) into ' + target.name +
        (failed.length ? ' · ' + failed.length + ' skipped' : ''), 'ok');
    } else {
      setStatus('Load failed — ' + failed.join('; '), 'error');
    }
  }

  async function exportPlaylist(pi) {
    if (busyExport) return;
    var pl = state.playlists[pi];
    busyExport = true;
    setStatus('Rendering ' + fmtTime(M.playbackDuration(pl)) + ' of audio…', 'busy');
    try {
      var blob = await player.renderWav(engineRows(pl), engineOpts(pl), state.masterVol / 100);
      var name = M.slug(pl.name) + '.wav';
      deliverFile(blob, name);
      setStatus('Exported ' + name + ' · ' + (blob.size / 1048576).toFixed(1) + ' MB', 'ok');
    } catch (err) {
      setStatus('Export failed: ' + err.message, 'error');
    } finally {
      busyExport = false;
    }
  }

  /* ── playback ────────────────────────────────────────────── */

  function buildQueue() {
    var q = [];
    for (var i = 0; i < state.playlists.length; i++) {
      if (state.playlists[i].included !== false) q.push(i);
    }
    if (state.chain.shuffle) {
      var rand = global.HFDSP.lcg((Math.random() * 1e9) | 0);
      for (var j = q.length - 1; j > 0; j--) {
        var k = Math.floor(rand() * (j + 1));
        var tmp = q[j]; q[j] = q[k]; q[k] = tmp;
      }
    }
    state.queue = q;
    state.queuePos = 0;
  }

  async function startPlayback(pi, mode) {
    var pl = state.playlists[pi];
    if (!pl) return;

    if (M.playbackDuration(pl) <= 0) {
      setStatus('Add a row with a duration above 0 first.', 'warn');
      return;
    }

    pl.seed = (Math.random() * 1e9) | 0;
    state.play = { pi: pi, mode: mode };
    state.active = { pi: pi, ri: -1 };

    try {
      player.setVolume(state.masterVol / 100);
      await player.play(engineRows(pl), engineOpts(pl));
    } catch (err) {
      state.play = null;
      renderAll();
      setStatus('Audio failed: ' + err.message, 'error');
      return;
    }

    requestWakeLock();
    renderAll();
    setStatus('Playing ' + pl.name);
  }

  function stopPlayback(silent) {
    player.stop();
    state.play = null;
    state.active = { pi: -1, ri: -1 };
    releaseWakeLock();
    renderAll();
    if (!silent) setStatus('Stopped');
  }

  function togglePlay(pi) {
    if (state.play && state.play.pi === pi) {
      stopPlayback(false);
      return;
    }
    startPlayback(pi, 'single');
  }

  function onPlayAll() {
    if (state.play) {
      stopPlayback(false);
      return;
    }
    buildQueue();
    if (!state.queue.length) {
      setStatus('No playlists to play.', 'warn');
      return;
    }
    startPlayback(state.queue[0], 'all');
  }

  function navOrder() {
    var out = [];
    for (var i = 0; i < state.playlists.length; i++) {
      if (state.playlists[i].included !== false) out.push(i);
    }
    return out;
  }

  function canStep(dir) {
    if (!state.play) return false;
    if (state.play.mode === 'all') {
      if (!state.queue.length) return false;
      var p = state.queuePos + dir;
      return (p >= 0 && p < state.queue.length) || (state.chain.loop && state.queue.length > 1);
    }
    var order = navOrder();
    var pos = order.indexOf(state.play.pi);
    if (pos < 0) return false;
    var n = pos + dir;
    return (n >= 0 && n < order.length) || (state.chain.loop && order.length > 1);
  }

  function stepPlaylist(dir) {
    if (!state.play) return;

    if (state.play.mode === 'all') {
      if (!state.queue.length) return;
      var p = state.queuePos + dir;
      if (p < 0 || p >= state.queue.length) {
        if (!state.chain.loop || state.queue.length < 2) return;
        p = (p + state.queue.length) % state.queue.length;
      }
      state.queuePos = p;
      startPlayback(state.queue[p], 'all');
      return;
    }

    var order = navOrder();
    var pos = order.indexOf(state.play.pi);
    if (pos < 0) return;
    var n = pos + dir;
    if (n < 0 || n >= order.length) {
      if (!state.chain.loop || order.length < 2) return;
      n = (n + order.length) % order.length;
    }
    startPlayback(order[n], 'single');
  }

  function onStatus(idx, elapsed) {
    if (!state.play) return;
    var pi = state.play.pi;
    var moved = state.active.pi !== pi || state.active.ri !== idx;
    state.active.pi = pi;
    state.active.ri = idx;

    if (moved) {
      var rows = els.list.querySelectorAll('article.row');
      for (var i = 0; i < rows.length; i++) {
        var el = rows[i];
        var isActive = (+el.dataset.pi === pi) && (+el.dataset.ri === idx);
        el.classList.toggle('active', isActive);
        var tl = el.querySelector('[data-time]');
        if (tl) {
          var rpi = +el.dataset.pi;
          var rri = +el.dataset.ri;
          var pl = state.playlists[rpi];
          tl.textContent = fmtTime(isActive ? 0 : (pl && pl.rows[rri] ? pl.rows[rri].duration : 0));
        }
      }
    }

    var curPl = state.playlists[pi];
    var row = idx >= 0 && curPl ? curPl.rows[idx] : null;
    var dur = row ? row.duration : 0;

    if (idx >= 0) {
      var cur = els.list.querySelector('[data-time="' + pi + ':' + idx + '"]');
      if (cur) cur.textContent = fmtTime(elapsed);
    }

    els.dockFill.style.width = dur > 0 ? Math.min(100, (elapsed / dur) * 100) + '%' : '0%';
    els.dockTime.textContent = idx >= 0 ? fmtTime(elapsed) + ' / ' + fmtTime(dur) : '';

    if (Date.now() >= statusHold) {
      var label = 'Playing · ' + curPl.name + (idx >= 0 ? ' · row ' + (idx + 1) : '');
      if (els.dockInfo.textContent !== label) {
        els.dockInfo.textContent = label;
        els.dockInfo.dataset.kind = '';
      }
    }
  }

  function onFinished() {
    if (!state.play) return;

    if (state.play.mode === 'all') {
      state.queuePos += 1;
      if (state.queuePos < state.queue.length) {
        var next = state.queue[state.queuePos];
        if (state.playlists[next]) {
          startPlayback(next, 'all');
          return;
        }
      }
      if (state.chain.loop) {
        buildQueue();
        if (state.queue.length) {
          startPlayback(state.queue[0], 'all');
          return;
        }
      }
    }
    stopPlayback(true);
    setStatus('Finished');
  }

  /* ── wake lock ───────────────────────────────────────────── */

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch (e) {
      wakeLock = null;
    }
  }

  function releaseWakeLock() {
    try {
      if (wakeLock) wakeLock.release();
    } catch (e) { /* already gone */ }
    wakeLock = null;
  }

  /* ── events ──────────────────────────────────────────────── */

  function onHeaderTap(e) {
    if (e.target.closest('input, button, select, textarea, label, a')) return;

    var rowHead = e.target.closest('.row-head');
    if (rowHead) {
      var art = rowHead.closest('article.row');
      var pi = +art.dataset.pi;
      var ri = +art.dataset.ri;
      var pl = state.playlists[pi];
      if (pl && pl.rows[ri]) {
        pl.rows[ri].collapsed = !pl.rows[ri].collapsed;
        saveSoon();
        renderAll();
      }
      return;
    }

    var plHead = e.target.closest('.pl-head');
    if (plHead) {
      var sec = plHead.closest('section.pl');
      var idx = +sec.dataset.pi;
      var target = state.playlists[idx];
      if (target) {
        target.collapsed = !target.collapsed;
        saveSoon();
        renderAll();
      }
    }
  }

  function onClick(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) {
      onHeaderTap(e);
      return;
    }

    var act = btn.dataset.act;
    var pi = Number(btn.dataset.pi);
    var ri = Number(btn.dataset.ri);
    var pl = state.playlists[pi];

    switch (act) {
      case 'pl-more':
        togglePanel(btn.closest('.pl').querySelector('.pl-more'));
        btn.setAttribute('aria-expanded', btn.closest('.pl').querySelector('.pl-more').hidden ? 'false' : 'true');
        break;
      case 'pl-play':
        togglePlay(pi);
        break;
      case 'pl-dup':
        duplicatePlaylist(pi);
        break;
      case 'pl-del':
        removePlaylist(pi);
        break;
      case 'pl-wav':
        exportPlaylist(pi);
        break;
      case 'pl-load':
        beginImport(pi);
        break;
      case 'row-add':
        addRow(pi, btn);
        break;
      case 'row-more':
        togglePanel(btn.closest('.row').querySelector('.row-actions'));
        btn.setAttribute('aria-expanded', btn.closest('.row').querySelector('.row-actions').hidden ? 'false' : 'true');
        break;
      case 'row-dup':
        duplicateRow(pi, ri);
        break;
      case 'row-del':
        removeRow(pi, ri);
        break;
      case 'row-up':
        moveRow(pi, ri, -1);
        break;
      case 'row-down':
        moveRow(pi, ri, 1);
        break;
      case 'row-save':
        saveRowConfig(pi, ri);
        break;
      case 'row-mode':
        setMode(pi, ri, btn.dataset.mode);
        break;
    }
  }

  function onVolume() {
    state.masterVol = clampNum(+els.vol.value, 0, 100);
    els.volOut.textContent = Math.round(state.masterVol) + '%';
    els.volLabel.textContent = Math.round(state.masterVol) + '%';
    player.setVolume(state.masterVol / 100);
    saveSoon();
  }

  function toggleChain(key) {
    state.chain[key] = !state.chain[key];
    setToggle(key === 'loop' ? els.chainLoop : els.chainShuffle, state.chain[key]);
    saveSoon();
  }

  function setMenuOpen(open) {
    els.menu.hidden = !open;
    els.menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function setVolOpen(open) {
    els.volPop.hidden = !open;
    els.volBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function bind() {
    els.list.addEventListener('input', handleEdit);
    els.list.addEventListener('change', handleEdit);
    els.list.addEventListener('click', onClick);

    els.vol.addEventListener('input', onVolume);
    els.dockPlay.addEventListener('click', onPlayAll);
    els.prev.addEventListener('click', function () { stepPlaylist(-1); });
    els.next.addEventListener('click', function () { stepPlaylist(1); });
    els.chainLoop.addEventListener('click', function () { toggleChain('loop'); });
    els.chainShuffle.addEventListener('click', function () { toggleChain('shuffle'); });

    els.menuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      setVolOpen(false);
      setMenuOpen(els.menu.hidden);
    });
    els.volBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      setMenuOpen(false);
      setVolOpen(els.volPop.hidden);
    });
    els.add.addEventListener('click', function () {
      setMenuOpen(false);
      addPlaylist();
    });
    els.importBtn.addEventListener('click', function () {
      setMenuOpen(false);
      beginImport(state.playlists.length - 1);
    });
    els.file.addEventListener('change', onFiles);

    document.addEventListener('click', function (e) {
      if (!e.target.closest('#topMenu') && !e.target.closest('#btnMenu')) setMenuOpen(false);
      if (!e.target.closest('#volPop') && !e.target.closest('#btnVol')) setVolOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        setVolOpen(false);
      }
    });

    player.onStatus = onStatus;
    player.onFinished = onFinished;

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && state.play) requestWakeLock();
    });

    window.addEventListener('beforeunload', saveNow);
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') return;
    navigator.serviceWorker.register('sw.js').catch(function () {
      /* Offline shell is a bonus, not a requirement. */
    });
  }

  function init() {
    els.list = $('playlists');
    els.dockInfo = $('dockInfo');
    els.dockTime = $('dockTime');
    els.dockFill = $('dockFill');
    els.dockPlay = $('btnDockPlay');
    els.prev = $('btnPrev');
    els.next = $('btnNext');
    els.vol = $('vol');
    els.volOut = $('volOut');
    els.volLabel = $('volLabel');
    els.volBtn = $('btnVol');
    els.volPop = $('volPop');
    els.chainLoop = $('btnChainLoop');
    els.chainShuffle = $('btnChainShuffle');
    els.menuBtn = $('btnMenu');
    els.menu = $('topMenu');
    els.add = $('btnAdd');
    els.importBtn = $('btnImport');
    els.file = $('fileInput');

    var saved = M.loadState();
    if (saved) {
      state.playlists = saved.playlists;
      state.masterVol = saved.masterVol;
      state.chain = saved.chain;
    }
    if (!state.playlists.length) {
      state.playlists.push(M.newPlaylist('Playlist 1'));
    }
    saveNow(); /* persist the seeded state so a first-run session is remembered */

    player.setVolume(state.masterVol / 100);
    bind();
    renderAll();
    registerServiceWorker();

    if (!player.supported()) {
      setStatus('This browser has no Web Audio support — playback is unavailable.', 'error');
    } else {
      setStatus('Ready');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

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
    els.status.textContent = msg || '';
    els.status.dataset.kind = kind || '';
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
    return '<label class="field"><span class="lab">' + label + '</span><span class="ctl">' +
      '<input type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + v +
      '" data-unit="' + (unit || '') + '" ' + ctlAttrs(pi, ri, scope, field, side) + '>' +
      '<output>' + txt + '</output></span></label>';
  }

  function waveField(pi, ri, scope, field, side, value, label) {
    return '<label class="field"><span class="lab">' + label + '</span><span class="ctl">' +
      '<select ' + ctlAttrs(pi, ri, scope, field, side) + '>' +
      M.WAVES.map(function (w) {
        return '<option value="' + w + '"' + (w === value ? ' selected' : '') + '>' +
          w.charAt(0).toUpperCase() + w.slice(1) + '</option>';
      }).join('') + '</select></span></label>';
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

  function rowHTML(pi, ri, row) {
    var active = state.active.pi === pi && state.active.ri === ri;
    var name = row.name || ('Row ' + (ri + 1));
    var d = 'data-pi="' + pi + '" data-ri="' + ri + '"';

    if (row.collapsed) {
      return '<article class="row collapsed' + (active ? ' active' : '') + '" data-pi="' + pi + '" data-ri="' + ri + '">' +
        '<div class="row-head">' +
          '<input type="checkbox" class="check" ' + ctlAttrs(pi, ri, 'row', 'include') +
            (row.included !== false ? ' checked' : '') + ' aria-label="Include row">' +
          '<button class="icon" data-act="row-collapse" ' + d + '>▸</button>' +
          '<span class="row-name">' + esc(name) + '</span>' +
          '<span class="row-time" data-time="' + pi + ':' + ri + '">' + fmtTime(row.duration) + '</span>' +
          '<button class="icon" data-act="row-more" ' + d + ' aria-label="Row actions">⋯</button>' +
        '</div>' +
      '</article>';
    }

    return '<article class="row' + (active ? ' active' : '') + '" data-pi="' + pi + '" data-ri="' + ri + '">' +
      '<div class="row-head">' +
        '<input type="checkbox" class="check" ' + ctlAttrs(pi, ri, 'row', 'include') +
          (row.included !== false ? ' checked' : '') + ' aria-label="Include row">' +
        '<button class="icon" data-act="row-collapse" ' + d + '>▾</button>' +
        '<span class="row-name">' + esc(name) + '</span>' +
        '<span class="row-time" data-time="' + pi + ':' + ri + '">' +
          fmtTime(active ? 0 : row.duration) + '</span>' +
        '<button class="icon" data-act="row-more" ' + d + ' aria-label="Row actions">⋯</button>' +
      '</div>' +
      '<div class="row-body">' + rowBodyHTML(pi, ri, row) +
        '<div class="row-actions" hidden>' +
          '<button class="btn small" data-act="row-dup" ' + d + '>Duplicate</button>' +
          '<button class="btn small" data-act="row-up" ' + d + '>↑ Up</button>' +
          '<button class="btn small" data-act="row-down" ' + d + '>↓ Down</button>' +
          '<button class="btn small" data-act="row-save" ' + d + '>Save .hfc</button>' +
          '<button class="btn small danger" data-act="row-del" ' + d + '>Delete</button>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function playlistHTML(pl, pi) {
    var playing = !!(state.play && state.play.pi === pi);
    var total = M.playbackDuration(pl);
    var d = 'data-pi="' + pi + '"';

    return '<section class="pl' + (pl.collapsed ? ' collapsed' : '') + (playing ? ' playing' : '') + '" data-pi="' + pi + '">' +
      '<div class="pl-head">' +
        '<input type="checkbox" class="check" ' + ctlAttrs(pi, 0, 'pl', 'include') +
          (pl.included !== false ? ' checked' : '') + ' aria-label="Include playlist">' +
        '<button class="icon" data-act="pl-collapse" ' + d + '>' + (pl.collapsed ? '▸' : '▾') + '</button>' +
        '<input class="pl-name" type="text" value="' + esc(pl.name) + '" ' +
          ctlAttrs(pi, 0, 'pl', 'name') + ' aria-label="Playlist name">' +
        '<button class="btn play' + (playing ? ' stop' : '') + '" data-act="pl-play" ' + d +
          ' aria-label="' + (playing ? 'Stop playlist' : 'Play playlist') + '">' +
          (playing ? '■' : '▶') + '</button>' +
      '</div>' +
      '<div class="pl-meta">' +
        '<label class="chk"><input type="checkbox" ' + ctlAttrs(pi, 0, 'pl', 'loop') +
          (pl.row_loop ? ' checked' : '') + '> loop</label>' +
        '<label class="chk"><input type="checkbox" ' + ctlAttrs(pi, 0, 'pl', 'shuffle') +
          (pl.row_shuffle ? ' checked' : '') + '> shuffle</label>' +
        '<label class="chk tiny">rows <input class="num" type="number" inputmode="numeric" min="0" max="99" value="' +
          (pl.play_rows | 0) + '" ' + ctlAttrs(pi, 0, 'pl', 'playrows') + '></label>' +
        '<span class="total" data-total="' + pi + '">' + fmtTime(total) + '</span>' +
        '<button class="icon" data-act="pl-more" ' + d + ' aria-label="Playlist actions">⋯</button>' +
      '</div>' +
      (pl.collapsed ? '' :
        '<div class="pl-more" hidden>' +
          '<button class="btn small" data-act="pl-wav" ' + d + '>Export WAV</button>' +
          '<button class="btn small" data-act="pl-dup" ' + d + '>Duplicate</button>' +
          '<button class="btn small" data-act="pl-load" ' + d + '>Load .hfc</button>' +
          '<button class="btn small danger" data-act="pl-del" ' + d + '>Delete</button>' +
        '</div>' +
        '<div class="rows">' + pl.rows.map(function (r, ri) {
          return rowHTML(pi, ri, r);
        }).join('') + '</div>' +
        '<button class="btn add" data-act="row-add" ' + d + '>＋ row</button>') +
      '</section>';
  }

  function renderAll() {
    els.list.innerHTML = state.playlists.map(playlistHTML).join('');
    syncChrome();
  }

  function syncChrome() {
    var playing = !!state.play;
    els.playAll.textContent = playing ? '■' : '▶';
    els.playAll.title = playing ? 'Stop' : 'Play all';
    setToggle(els.chainLoop, state.chain.loop);
    setToggle(els.chainShuffle, state.chain.shuffle);
    els.vol.value = state.masterVol;
    els.volOut.textContent = Math.round(state.masterVol) + '%';
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

  function addRow(pi) {
    var pl = state.playlists[pi];
    pl.rows.push(M.newRow());
    M.renumber(pl);
    saveNow();
    renderAll();
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

    if (idx >= 0) {
      var cur = els.list.querySelector('[data-time="' + pi + ':' + idx + '"]');
      if (cur) cur.textContent = fmtTime(elapsed);
    }

    var label = 'Playing · ' + state.playlists[pi].name +
      (idx >= 0 ? ' · row ' + (idx + 1) : '');
    if (els.status.textContent !== label) setStatus(label);
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

  function onClick(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;

    var act = btn.dataset.act;
    var pi = Number(btn.dataset.pi);
    var ri = Number(btn.dataset.ri);
    var pl = state.playlists[pi];

    switch (act) {
      case 'pl-collapse':
        pl.collapsed = !pl.collapsed;
        saveSoon();
        renderAll();
        break;
      case 'pl-more':
        togglePanel(btn.closest('.pl').querySelector('.pl-more'));
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
        addRow(pi);
        break;
      case 'row-collapse':
        pl.rows[ri].collapsed = !pl.rows[ri].collapsed;
        saveSoon();
        renderAll();
        break;
      case 'row-more':
        togglePanel(btn.closest('.row').querySelector('.row-actions'));
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
    player.setVolume(state.masterVol / 100);
    saveSoon();
  }

  function toggleChain(key) {
    state.chain[key] = !state.chain[key];
    setToggle(key === 'loop' ? els.chainLoop : els.chainShuffle, state.chain[key]);
    saveSoon();
  }

  function bind() {
    els.list.addEventListener('input', handleEdit);
    els.list.addEventListener('change', handleEdit);
    els.list.addEventListener('click', onClick);

    els.vol.addEventListener('input', onVolume);
    els.playAll.addEventListener('click', onPlayAll);
    els.chainLoop.addEventListener('click', function () { toggleChain('loop'); });
    els.chainShuffle.addEventListener('click', function () { toggleChain('shuffle'); });
    els.add.addEventListener('click', addPlaylist);
    els.importBtn.addEventListener('click', function () { beginImport(state.playlists.length - 1); });
    els.file.addEventListener('change', onFiles);

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
    els.status = $('status');
    els.vol = $('vol');
    els.volOut = $('volOut');
    els.playAll = $('btnPlayAll');
    els.chainLoop = $('btnChainLoop');
    els.chainShuffle = $('btnChainShuffle');
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

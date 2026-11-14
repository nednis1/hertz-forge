/* ============================================================
   Hertz Forge — playlist data model
   ------------------------------------------------------------
   Row / playlist defaults match playlist_forge/engine.py, and the
   .hfc save format matches playlist_forge/config.py one-for-one,
   so configs move between phone and desktop unchanged.
   ============================================================ */
(function (global) {
  'use strict';

  var WAVES = ['sine', 'triangle', 'sawtooth', 'square'];
  var STORAGE_KEY = 'hertzforge.mobile.v1';
  var WAVE_SHORT = { sine: 'si', triangle: 'tri', sawtooth: 'saw', square: 'sq' };

  function num(v, dflt) {
    var n = +v;
    return isFinite(n) ? n : dflt;
  }
  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function newChannel() {
    return {
      carrier: 440,
      wave: 'sine',
      bw_freq: 40,
      amp_val: 100,
      bi_val: 0,
      fm_on: false,
      fm_offset_lo: -30,
      fm_offset_hi: 40,
      vol: 100
    };
  }

  function normChannel(src) {
    src = src || {};
    return {
      carrier: clamp(num(src.carrier, 440), 0, 2000),
      wave: WAVES.indexOf(src.wave) >= 0 ? src.wave : 'sine',
      bw_freq: clamp(num(src.bw_freq, 40), 0, 100),
      amp_val: clamp(num(src.amp_val, 100), 0, 100),
      bi_val: clamp(num(src.bi_val, 0), 0, 100),
      fm_on: !!src.fm_on,
      fm_offset_lo: clamp(num(src.fm_offset_lo, -30), -2000, 2000),
      fm_offset_hi: clamp(num(src.fm_offset_hi, 40), -2000, 2000),
      vol: clamp(num(src.vol, 100), 0, 100)
    };
  }

  function newRow(name) {
    var row = normRow({ name: name || '' });
    row.collapsed = true;   /* phone-first: start as a one-line summary */
    return row;
  }

  function normRow(src) {
    src = src || {};
    return {
      name: typeof src.name === 'string' ? src.name : '',
      included: src.included !== false,
      duration: clamp(num(src.duration, 1), 0, 36000),
      binaural_on: !!src.binaural_on,
      bi_carrier: clamp(num(src.bi_carrier, 110), 0, 2000),
      bi_wave: WAVES.indexOf(src.bi_wave) >= 0 ? src.bi_wave : 'sine',
      bi_bw: clamp(num(src.bi_bw, 40), 0, 100),
      bi_left_amp: clamp(num(src.bi_left_amp, 0), 0, 100),
      bi_right_amp: clamp(num(src.bi_right_amp, 0), 0, 100),
      sync_on: src.sync_on !== false,
      adv_on: !!src.adv_on,
      collapsed: !!src.collapsed,
      left: normChannel(src.left),
      right: normChannel(src.right)
    };
  }

  function newPlaylist(name) {
    var pl = {
      name: name || 'Playlist 1',
      rows: [],
      row_loop: false,
      row_shuffle: true,
      play_rows: 0,
      included: true,
      collapsed: false
    };
    pl.rows.push(newRow('Row 1'));
    return pl;
  }

  function renumber(pl) {
    for (var i = 0; i < pl.rows.length; i++) pl.rows[i].name = 'Row ' + (i + 1);
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /* ── duration ─────────────────────────────────────────────── */

  function playbackDuration(pl) {
    var rows = pl.rows.filter(function (r) { return r.included !== false; });
    if (pl.play_rows > 0) rows = rows.slice(0, pl.play_rows);
    var total = 0;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].duration > 0) total += rows[i].duration;
    }
    return total;
  }

  /* ── naming (port of config.generate_row_name) ────────────── */

  function waveTag(w) {
    return WAVE_SHORT[w] || String(w || '').slice(0, 2);
  }

  function fmtNum(v) {
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  }

  function rowName(rc) {
    var parts = [];

    /* 1. brainwave frequency */
    var bw = rc.binaural_on ? rc.bi_bw : rc.left.bw_freq;
    parts.push(fmtNum(bw));

    /* 2. modulation types */
    var mods = [];
    if (rc.binaural_on) mods.push('b');
    if (!rc.binaural_on && (rc.left.bi_val > 0 || rc.right.bi_val > 0)) mods.push('st');
    if (rc.left.fm_on || rc.right.fm_on) mods.push('fm');
    if (!mods.length) mods.push('a');
    parts.push(mods.join('_'));

    /* 3. carrier + waveform */
    if (rc.binaural_on) {
      parts.push(Math.round(rc.bi_carrier) + 'c' + waveTag(rc.bi_wave));
    } else {
      var lc = rc.left.carrier;
      var rvc = rc.right.carrier;
      var lw = waveTag(rc.left.wave);
      var rw = waveTag(rc.right.wave);

      if (lc === rvc && rc.left.wave === rc.right.wave) {
        parts.push(Math.round(lc) + 'c' + lw);
      } else if (lc === rvc) {
        parts.push(Math.round(lc) + 'cL' + lw + 'R' + rw);
      } else if (rc.left.wave === rc.right.wave) {
        if (rvc === 0) parts.push('L' + Math.round(lc) + 'c' + lw);
        else if (lc === 0) parts.push('R' + Math.round(rvc) + 'c' + lw);
        else parts.push('L' + Math.round(lc) + 'R' + Math.round(rvc) + 'c' + lw);
      } else {
        if (rvc === 0) parts.push('L' + Math.round(lc) + 'c' + lw);
        else if (lc === 0) parts.push('R' + Math.round(rvc) + 'c' + rw);
        else parts.push('L' + Math.round(lc) + 'c' + lw + 'R' + Math.round(rvc) + 'c' + rw);
      }
    }

    /* 4. duration */
    parts.push(fmtNum(rc.duration) + 's');

    /* 5. non-default extras */
    var la, ra;
    if (rc.binaural_on) {
      la = rc.bi_left_amp;
      ra = rc.bi_right_amp;
      if (la !== 0 || ra !== 0) {
        if (la === ra) parts.push('amp' + Math.round(la));
        else if (ra === 0) parts.push('Lamp' + Math.round(la));
        else if (la === 0) parts.push('Ramp' + Math.round(ra));
        else parts.push('Lamp' + Math.round(la) + 'Ramp' + Math.round(ra));
      }
    } else {
      la = rc.left.amp_val;
      ra = rc.right.amp_val;
      if (la !== 100 || ra !== 100) {
        if (la === ra) parts.push('amp' + Math.round(la));
        else if (ra === 0) parts.push('Lamp' + Math.round(la));
        else if (la === 0) parts.push('Ramp' + Math.round(ra));
        else parts.push('Lamp' + Math.round(la) + 'Ramp' + Math.round(ra));
      }
    }

    var lv = rc.left.vol;
    var rv = rc.right.vol;
    if (lv !== 100 || rv !== 100) {
      if (lv === rv) parts.push('vol' + Math.round(lv));
      else if (rv === 100) parts.push('Lvol' + Math.round(lv));
      else if (lv === 100) parts.push('Rvol' + Math.round(rv));
      else parts.push('Lvol' + Math.round(lv) + 'Rvol' + Math.round(rv));
    }

    return parts.join('_');
  }

  function suggestedFilename(rc) {
    return rowName(rc).replace(/[^\w\-.]/g, '_') + '.hfc';
  }

  function slug(text) {
    return String(text || 'playlist')
      .toLowerCase()
      .replace(/[^\w\-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'playlist';
  }

  /* ── .hfc serialisation (config.py) ──────────────────────── */

  function channelDict(ch) {
    return {
      carrier: ch.carrier,
      wave: ch.wave,
      bw_freq: ch.bw_freq,
      amp_val: ch.amp_val,
      bi_val: ch.bi_val,
      fm_on: ch.fm_on,
      fm_offset_lo: ch.fm_offset_lo,
      fm_offset_hi: ch.fm_offset_hi,
      vol: ch.vol
    };
  }

  function rowToDict(rc) {
    return {
      hertz_forge_config: 1,
      name: rowName(rc),
      row: {
        duration: rc.duration,
        binaural_on: rc.binaural_on,
        bi_carrier: rc.bi_carrier,
        bi_wave: rc.bi_wave,
        bi_bw: rc.bi_bw,
        bi_left_amp: rc.bi_left_amp,
        bi_right_amp: rc.bi_right_amp,
        sync_on: rc.sync_on,
        adv_on: rc.adv_on,
        left: channelDict(rc.left),
        right: channelDict(rc.right)
      }
    };
  }

  function dictToRow(d) {
    if (!d || typeof d !== 'object' || !d.row || typeof d.row !== 'object') {
      throw new Error('Not a Hertz Forge config (missing "row").');
    }
    var r = d.row;
    var row = newRow(typeof d.name === 'string' ? d.name : '');
    row.duration = r.duration;
    row.binaural_on = r.binaural_on;
    row.bi_carrier = r.bi_carrier;
    row.bi_wave = r.bi_wave;
    row.bi_bw = r.bi_bw;
    row.bi_left_amp = r.bi_left_amp;
    row.bi_right_amp = r.bi_right_amp;
    row.sync_on = r.sync_on;
    row.adv_on = r.adv_on;
    row.left = r.left || {};
    row.right = r.right || {};
    return normRow(row);
  }

  function parseConfig(text) {
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error('File is not valid JSON.');
    }
    return dictToRow(data);
  }

  /* ── persistence ─────────────────────────────────────────── */

  function saveState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        playlists: state.playlists,
        masterVol: state.masterVol,
        chain: state.chain
      }));
    } catch (e) {
      /* Private mode / quota — playback still works, just no memory. */
    }
  }

  function loadState() {
    var raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
    if (!raw) return null;

    var data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return null;
    }
    if (!data || !Array.isArray(data.playlists)) return null;

    var playlists = data.playlists.map(function (p, i) {
      var pl = {
        name: typeof p.name === 'string' ? p.name : 'Playlist ' + (i + 1),
        rows: Array.isArray(p.rows) ? p.rows.map(normRow) : [],
        row_loop: !!p.row_loop,
        row_shuffle: p.row_shuffle !== false,
        play_rows: Math.max(0, num(p.play_rows, 0) | 0),
        included: p.included !== false,
        collapsed: !!p.collapsed
      };
      if (!pl.rows.length) pl.rows.push(newRow('Row 1'));
      renumber(pl);
      return pl;
    });

    return {
      playlists: playlists,
      masterVol: clamp(num(data.masterVol, 50), 0, 100),
      chain: {
        loop: !!(data.chain && data.chain.loop),
        shuffle: !!(data.chain && data.chain.shuffle)
      }
    };
  }

  global.HFModel = {
    WAVES: WAVES,
    newChannel: newChannel,
    newRow: newRow,
    normRow: normRow,
    newPlaylist: newPlaylist,
    renumber: renumber,
    clone: clone,
    playbackDuration: playbackDuration,
    rowName: rowName,
    suggestedFilename: suggestedFilename,
    slug: slug,
    rowToDict: rowToDict,
    dictToRow: dictToRow,
    parseConfig: parseConfig,
    saveState: saveState,
    loadState: loadState
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

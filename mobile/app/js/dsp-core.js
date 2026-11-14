/* ============================================================
   Hertz Forge — shared DSP core
   ------------------------------------------------------------
   Loaded as a plain script by the page, and concatenated with
   js/processor.js into the AudioWorklet module. Live playback,
   the ScriptProcessor fallback and offline WAV rendering all run
   exactly this math, so they cannot drift apart.

   Mirrors playlist_forge/engine.py:
     ChannelConfig.render()  -> channelSample()
     PlaylistEngine._render  -> sampleRow()
     PlaylistEngine row timing -> Scheduler
   ============================================================ */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;
  var WAVES = ['sine', 'triangle', 'sawtooth', 'square'];

  function wrap1(x) { return x - Math.floor(x); }

  /* Oscillators — identical formulas to engine.py::_osc. */
  function osc(t, wave, freq) {
    var p = TAU * freq * t;
    switch (wave) {
      case 'triangle':
        return 2 * Math.abs(2 * wrap1(p / TAU) - 1) - 1;
      case 'sawtooth':
        return 2 * wrap1(p / TAU) - 1;
      case 'square': {
        var s = Math.sin(p);
        return s > 0 ? 1 : (s < 0 ? -1 : 0);
      }
      default:
        return Math.sin(p);
    }
  }

  /* Bilateral panning gains (crossfade at envelope trough). */
  function panGains(biPercent, bp) {
    var ps = 1 + (biPercent / 100) * 9;
    var pn = 0.5 - 0.5 * Math.tanh(ps * Math.cos(bp / 2 - Math.PI / 4));
    if (pn < 0) pn = 0; else if (pn > 1) pn = 1;
    return [Math.cos(pn * Math.PI / 2), Math.sin(pn * Math.PI / 2)];
  }

  /* One channel -> stereo pair.  `ov` overrides carrier/wave/bw/amp,
     which is how binaural rows swap in the centre frequency. */
  function channelSample(ch, t, primary, ov) {
    var carrier = (ov && ov.carrier != null) ? ov.carrier : ch.carrier;
    var wave = (ov && ov.wave != null) ? ov.wave : ch.wave;
    var bw = (ov && ov.bw != null) ? ov.bw : ch.bw_freq;
    var l = 0, r = 0;

    if (bw <= 0) {
      /* No brainwave modulation — constant tone on the primary side. */
      var flat = osc(t, wave, carrier);
      if (primary === 'left') l = flat; else r = flat;
    } else {
      var bp = TAU * bw * t;
      var sb = Math.sin(bp);
      var amp = ((ov && ov.amp != null) ? ov.amp : ch.amp_val) / 100;
      var bi = ch.bi_val / 100;
      var car;

      if (ch.fm_on) {
        var fs = carrier + ch.fm_offset_lo;
        var fe = carrier + ch.fm_offset_hi;
        var c = (fs + fe) / 2;
        var d = Math.abs(fe - fs) / 2;
        car = osc(t, wave, c) * Math.cos((d / Math.max(bw, 0.01)) * Math.sin(bp));
      } else {
        car = osc(t, wave, carrier);
      }

      var sig;
      if (amp > 0) sig = car * (1 - amp * 0.5 * (1 - sb));
      else if (ch.fm_on) sig = car * 0.7;
      else sig = car;

      if (bi > 0) {
        var g = panGains(ch.bi_val, bp);
        if (primary === 'left') { l = sig * g[0]; r = sig * g[1]; }
        else { l = sig * g[1]; r = sig * g[0]; }
      } else if (primary === 'left') {
        l = sig;
      } else {
        r = sig;
      }
    }

    var v = ch.vol / 100;
    return [l * v, r * v];
  }

  /* One playlist row -> clipped stereo sample. */
  function sampleRow(row, t) {
    var a, b;
    if (row.binaural_on) {
      a = channelSample(row.left, t, 'left', {
        carrier: row.bi_carrier - row.bi_bw / 2,
        wave: row.bi_wave,
        bw: row.bi_bw,
        amp: row.bi_left_amp
      });
      b = channelSample(row.right, t, 'right', {
        carrier: row.bi_carrier + row.bi_bw / 2,
        wave: row.bi_wave,
        bw: row.bi_bw,
        amp: row.bi_right_amp
      });
    } else {
      a = channelSample(row.left, t, 'left', null);
      b = channelSample(row.right, t, 'right', null);
    }
    var l = a[0] + b[0];
    var r = a[1] + b[1];
    if (l > 1 || l < -1) l = Math.tanh(l);
    if (r > 1 || r < -1) r = Math.tanh(r);
    return [l, r];
  }

  /* ── small deterministic PRNG so shuffled exports are repeatable ── */
  function lcg(seed) {
    var s = (seed | 0) || 1;
    return function () {
      s = (Math.imul(s, 1664525) + 1013904223) | 0;
      return ((s >>> 0) / 4294967296);
    };
  }

  function shuffled(arr, rand) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function sampleOf(arr, n, rand) {
    return shuffled(arr, rand).slice(0, n);
  }

  /* ── row normalization ── */
  function num(v, dflt) {
    var n = +v;
    return isFinite(n) ? n : dflt;
  }

  function normChannel(src) {
    src = src || {};
    return {
      carrier: num(src.carrier, 440),
      wave: WAVES.indexOf(src.wave) >= 0 ? src.wave : 'sine',
      bw_freq: num(src.bw_freq, 40),
      amp_val: num(src.amp_val, 100),
      bi_val: num(src.bi_val, 0),
      fm_on: !!src.fm_on,
      fm_offset_lo: num(src.fm_offset_lo, -30),
      fm_offset_hi: num(src.fm_offset_hi, 40),
      vol: num(src.vol, 100)
    };
  }

  function normRow(r) {
    r = r || {};
    return {
      included: r.included !== false,
      duration: num(r.duration, 0),
      binaural_on: !!r.binaural_on,
      bi_carrier: num(r.bi_carrier, 110),
      bi_wave: WAVES.indexOf(r.bi_wave) >= 0 ? r.bi_wave : 'sine',
      bi_bw: num(r.bi_bw, 40),
      bi_left_amp: num(r.bi_left_amp, 0),
      bi_right_amp: num(r.bi_right_amp, 0),
      left: normChannel(r.left),
      right: normChannel(r.right)
    };
  }

  /* ============================================================
     Scheduler — sample-accurate row clock.

     Positions are advanced by the render loop, never read from a
     wall clock, so the rendered file and live playback take the
     identical path.  Loop cycles reshuffle here (like the desktop
     engine does per cycle).
     ============================================================ */
  function Scheduler(rows, opts) {
    opts = opts || {};
    this.rows = [] ;
    this.loop = !!opts.loop;
    this.shuffle = !!opts.shuffle;
    this.playRows = Math.max(0, opts.playRows | 0);
    this.rand = lcg(opts.seed == null ? 12345 : opts.seed);
    this.pos = 0;
    this.cursor = 0;
    this.timeline = [];
    this.total = 0;
    this.order = [];
    this.finished = false;
    this.rows = (rows || []).map(normRow);
    this.build();
  }

  Scheduler.prototype.build = function () {
    var included = [];
    for (var i = 0; i < this.rows.length; i++) {
      if (this.rows[i].included !== false) included.push(i);
    }

    var order;
    if (this.shuffle && included.length > 1) {
      if (this.playRows > 0 && this.playRows < included.length) {
        order = sampleOf(included, this.playRows, this.rand);
      } else {
        order = shuffled(included, this.rand);
      }
    } else {
      order = included.slice();
      if (this.playRows > 0 && this.playRows < order.length) {
        order = order.slice(0, this.playRows);
      }
    }

    var timeline = [];
    var acc = 0;
    for (var k = 0; k < order.length; k++) {
      var d = this.rows[order[k]].duration;
      if (!(d > 0)) continue;
      timeline.push({ idx: order[k], start: acc, end: acc + d });
      acc += d;
    }

    this.order = order;
    this.timeline = timeline;
    this.total = acc;
    this.cursor = 0;
    this.finished = acc <= 0;
  };

  /* Returns the row index for the current position, or -1. */
  Scheduler.prototype.step = function () {
    if (this.total <= 0) { this.finished = true; return -1; }

    if (this.pos >= this.total) {
      if (!this.loop) { this.finished = true; return -1; }
      this.pos -= this.total;
      this.build();
      if (this.total <= 0) { this.finished = true; return -1; }
    }

    while (this.cursor < this.timeline.length - 1 &&
           this.pos >= this.timeline[this.cursor].end) {
      this.cursor++;
    }
    return this.timeline[this.cursor] ? this.timeline[this.cursor].idx : -1;
  };

  Scheduler.prototype.advance = function (dt) { this.pos += dt; };

  /* ============================================================
     Runner — owns the scheduler, the oscillator clock and the
     per-block render loop.  Used by the worklet, the
     ScriptProcessor fallback and the JS export path.
     ============================================================ */
  function Runner(sr, rows, opts) {
    this.sr = sr || 44100;
    this.dt = 1 / this.sr;
    this.load(rows, opts);
  }

  Runner.prototype.load = function (rows, opts) {
    this.opts = opts || {};
    this.rows = (rows || []).map(normRow);
    this.sched = new Scheduler(this.rows, this.opts);
    this.t = 0;
    this.finished = false;
    this.active = { idx: -1, elapsed: 0 };
  };

  /* Parameter / structure edit while running: keep the playhead. */
  Runner.prototype.applyUpdate = function (rows, opts) {
    this.opts = opts || this.opts || {};
    this.rows = (rows || []).map(normRow);
    var s = this.sched;
    s.rows = this.rows;
    s.loop = !!this.opts.loop;
    s.shuffle = !!this.opts.shuffle;
    s.playRows = Math.max(0, this.opts.playRows | 0);
    s.build();
    if (s.pos >= s.total) s.pos = 0;
    this.finished = s.total <= 0;
  };

  Runner.prototype.restart = function () {
    this.load(this.rows, this.opts);
  };

  Runner.prototype.process = function (L, R, frames) {
    var sched = this.sched;
    var rows = this.rows;
    var dt = this.dt;

    for (var i = 0; i < frames; i++) {
      var idx = sched.step();
      if (idx >= 0) {
        var s = sampleRow(rows[idx], this.t);
        L[i] = s[0];
        R[i] = s[1];
        var tl = sched.timeline[sched.cursor];
        this.active.idx = idx;
        this.active.elapsed = tl ? sched.pos - tl.start : 0;
      } else {
        L[i] = 0;
        R[i] = 0;
        this.active.idx = -1;
        this.active.elapsed = 0;
        if (sched.finished) this.finished = true;
      }
      sched.advance(dt);
      this.t += dt;
    }
  };

  global.HFDSP = {
    WAVES: WAVES,
    osc: osc,
    channelSample: channelSample,
    sampleRow: sampleRow,
    Scheduler: Scheduler,
    Runner: Runner,
    normRow: normRow,
    lcg: lcg
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

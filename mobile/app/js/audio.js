/* ============================================================
   Hertz Forge — audio transport
   ------------------------------------------------------------
   Live playback runs the shared DSP inside an AudioWorklet.  The
   worklet module is assembled at runtime from js/dsp-core.js and
   js/processor.js, so there is exactly one copy of the math.

   Export renders the same processor in an OfflineAudioContext and
   writes 16-bit PCM WAV, matching the desktop sample rate.
   ============================================================ */
(function (global) {
  'use strict';

  var WORKLET_FILES = ['js/dsp-core.js', 'js/processor.js'];
  var workletPromise = null;

  function loadWorkletUrl() {
    if (workletPromise) return workletPromise;
    workletPromise = Promise.all(WORKLET_FILES.map(function (f) {
      return fetch(f, { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error('Cannot load ' + f + ' (' + r.status + ')');
        return r.text();
      });
    })).then(function (parts) {
      var blob = new Blob([parts.join('\n;\n')], { type: 'application/javascript' });
      return URL.createObjectURL(blob);
    }).catch(function (err) {
      workletPromise = null; /* allow a retry */
      throw err;
    });
    return workletPromise;
  }

  function encodeWav(buffer) {
    var channels = Math.min(2, buffer.numberOfChannels);
    var frames = buffer.length;
    var dataBytes = frames * channels * 2;
    var ab = new ArrayBuffer(44 + dataBytes);
    var view = new DataView(ab);

    function str(off, s) {
      for (var i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
    }

    str(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true);
    view.setUint16(34, 16, true);
    str(36, 'data');
    view.setUint32(40, dataBytes, true);

    var L = buffer.getChannelData(0);
    var R = channels > 1 ? buffer.getChannelData(1) : null;
    var off = 44;
    for (var i = 0; i < frames; i++) {
      var l = L[i];
      l = l > 1 ? 1 : (l < -1 ? -1 : l);
      view.setInt16(off, l < 0 ? l * 0x8000 : l * 0x7fff, true);
      off += 2;
      if (R) {
        var r = R[i];
        r = r > 1 ? 1 : (r < -1 ? -1 : r);
        view.setInt16(off, r < 0 ? r * 0x8000 : r * 0x7fff, true);
        off += 2;
      }
    }
    return new Blob([ab], { type: 'audio/wav' });
  }

  function Player() {
    this.ctx = null;
    this.node = null;
    this.gain = null;
    this.mode = null;
    this.playing = false;
    this.runner = null;
    this.rows = [];
    this.opts = {};
    this.volume = 0.5;
    this.onStatus = null;
    this.onFinished = null;
    this._blocks = 0;
    this._done = true;
  }

  Player.prototype.supported = function () {
    return !!(global.AudioContext || global.webkitAudioContext);
  };

  Player.prototype.ensure = async function () {
    if (this.ctx && this.node) return;
    if (this.ctx && !this.node) {
      /* Context survived but the node was rebuilt — make a new one. */
      return this._makeNode();
    }

    var Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx) throw new Error('Web Audio is not available in this browser.');

    this.ctx = new Ctx({ latencyHint: 'playback' });
    this.gain = this.ctx.createGain();
    this.gain.gain.value = this.volume;
    this.gain.connect(this.ctx.destination);
    await this._makeNode();
  };

  Player.prototype._makeNode = async function () {
    if (this.ctx.audioWorklet && global.AudioWorkletNode) {
      var url = await loadWorkletUrl();
      await this.ctx.audioWorklet.addModule(url);
      this.node = new AudioWorkletNode(this.ctx, 'hf-playlist', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2]
      });
      this.node.port.onmessage = (ev) => this._message(ev.data);
      this.mode = 'worklet';
    } else {
      this.node = this.ctx.createScriptProcessor(2048, 0, 2);
      this.node.onaudioprocess = (ev) => this._legacy(ev);
      this.runner = new global.HFDSP.Runner(this.ctx.sampleRate, this.rows, this.opts);
      this.mode = 'script';
    }
    this.node.connect(this.gain);
  };

  Player.prototype._message = function (m) {
    if (!m) return;
    if (m.type === 'status') {
      if (this.onStatus) this.onStatus(m.idx, m.elapsed);
    } else if (m.type === 'finished') {
      if (this.onFinished) this.onFinished();
    }
  };

  Player.prototype._legacy = function (ev) {
    var L = ev.outputBuffer.getChannelData(0);
    var R = ev.outputBuffer.getChannelData(1);
    if (!this.runner) return;
    this.runner.process(L, R, L.length);
    if (++this._blocks % 4 === 0 && this.onStatus) {
      var a = this.runner.active;
      this.onStatus(a.idx, a.elapsed);
    }
    if (this.runner.finished && !this._done) {
      this._done = true;
      if (this.onFinished) this.onFinished();
    }
  };

  Player.prototype.play = async function (rows, opts) {
    await this.ensure();
    this.rows = rows || [];
    this.opts = opts || {};
    this._done = false;
    this._blocks = 0;

    if (this.mode === 'worklet') {
      this.node.port.postMessage({ type: 'load', rows: this.rows, opts: this.opts });
    } else {
      this.runner = new global.HFDSP.Runner(this.ctx.sampleRate, this.rows, this.opts);
    }

    if (this.ctx.state !== 'running') await this.ctx.resume();
    this.playing = true;
  };

  /* Parameter / structure edit — keeps the playhead position. */
  Player.prototype.update = function (rows, opts) {
    if (!this.node || !this.playing) return;
    this.rows = rows || [];
    this.opts = opts || {};
    if (this.mode === 'worklet') {
      this.node.port.postMessage({ type: 'update', rows: this.rows, opts: this.opts });
    } else if (this.runner) {
      this.runner.applyUpdate(this.rows, this.opts);
    }
  };

  Player.prototype.stop = function () {
    this.playing = false;
    this._done = true;
    this.rows = [];
    if (this.node && this.mode === 'worklet') {
      this.node.port.postMessage({ type: 'load', rows: [], opts: {} });
    } else if (this.runner) {
      this.runner = null;
    }
    if (this.ctx && this.ctx.state === 'running') {
      this.ctx.suspend().catch(function () {});
    }
  };

  Player.prototype.setVolume = function (v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.gain) this.gain.gain.value = this.volume;
  };

  /* ── offline render to WAV ────────────────────────────────── */

  Player.prototype.renderWav = async function (rows, opts, volume) {
    var sr = 44100;
    var exportOpts = Object.assign({}, opts || {}, { loop: false });
    var probe = new global.HFDSP.Scheduler(rows || [], exportOpts);
    var seconds = probe.total;

    if (!(seconds > 0)) {
      throw new Error('Nothing to render — every included row needs a duration above 0.');
    }
    if (seconds > 900) {
      throw new Error('Mobile export is limited to 15 minutes. Shorten the playlist or export from the desktop app.');
    }

    var Ctx = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    if (!Ctx) throw new Error('Offline rendering is not supported here.');

    var ctx = new Ctx(2, Math.ceil(seconds * sr), sr);
    var url = await loadWorkletUrl();
    await ctx.audioWorklet.addModule(url);

    var node = new AudioWorkletNode(ctx, 'hf-playlist', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { rows: rows || [], opts: exportOpts }
    });
    var g = ctx.createGain();
    g.gain.value = Math.max(0, Math.min(1, volume == null ? 1 : volume));
    node.connect(g);
    g.connect(ctx.destination);

    var buffer = await ctx.startRendering();
    return encodeWav(buffer);
  };

  global.HFPlayer = { Player: Player, encodeWav: encodeWav, loadWorkletUrl: loadWorkletUrl };
})(typeof globalThis !== 'undefined' ? globalThis : this);

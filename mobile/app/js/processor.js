/* ============================================================
   AudioWorkletProcessor wrapper.
   Concatenated after js/dsp-core.js into one module, so HFDSP is
   available here exactly as it is in the page.
   ============================================================ */
class HFPlaylistProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    var opts = (options && options.processorOptions) || {};
    this.runner = new HFDSP.Runner(sampleRate, opts.rows || [], opts.opts || {});
    this.blocks = 0;
    this.done = false;
    this.reported = -1;

    this.port.onmessage = (ev) => this.handle(ev.data);
  }

  handle(m) {
    if (!m) return;
    if (m.type === 'load') {
      this.runner.load(m.rows || [], m.opts || {});
      this.done = false;
      this.reported = -1;
    } else if (m.type === 'update') {
      this.runner.applyUpdate(m.rows || [], m.opts || {});
    } else if (m.type === 'restart') {
      this.runner.restart();
      this.done = false;
    }
  }

  process(inputs, outputs) {
    var out = outputs[0];
    if (!out || !out.length) return true;

    var L = out[0];
    var R = out.length > 1 ? out[1] : null;

    if (R) {
      this.runner.process(L, R, L.length);
    } else {
      /* Mono destination: render to scratch, then downmix. */
      if (!this._l || this._l.length !== L.length) {
        this._l = new Float32Array(L.length);
        this._r = new Float32Array(L.length);
      }
      this.runner.process(this._l, this._r, L.length);
      for (var i = 0; i < L.length; i++) {
        L[i] = (this._l[i] + this._r[i]) * 0.5;
      }
    }

    if (++this.blocks % 8 === 0) {
      var a = this.runner.active;
      if (a.idx !== this.reported) this.reported = a.idx;
      this.port.postMessage({
        type: 'status',
        idx: a.idx,
        elapsed: a.elapsed,
        total: this.runner.sched.total
      });
    }

    if (this.runner.finished && !this.done) {
      this.done = true;
      this.port.postMessage({ type: 'finished' });
    }
    return true;
  }
}

registerProcessor('hf-playlist', HFPlaylistProcessor);

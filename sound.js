// Breath sounds, generated live with the Web Audio API — no audio files, and
// they adapt to whatever inhale/exhale lengths the app is using.
//   ocean   — "Distant Swell": a wave gathers on the inhale, breaks and washes
//             back out on the exhale.
//   crystal — "Crystal Bowl": a low crystal bowl blooms in on the inhale and
//             rings out through the exhale, in a big soft room.
//   off     — silent.
(function () {
  'use strict';

  var KINDS = ['ocean', 'crystal', 'off'];
  var STORE_KEY = 'breathe-sound';

  var ctx = null;
  var out = null;        // everything ends here: compressor -> speakers
  var buffers = null;
  var kind = load();
  var active = false;    // a breathing session is running
  var last = null;       // the current phase, so a switch can pick up mid-breath
  var voice = null;      // the live sound for this session

  // ---------- helpers ----------

  function ease(x) { x = Math.min(1, Math.max(0, x)); return 0.5 - 0.5 * Math.cos(Math.PI * x); }
  function lerp(a, b, x) { return a + (b - a) * x; }

  // Automate an AudioParam along fn(x), x in 0..1, across [t, t + dur].
  // If t is before the audio clock began (the very first breath, while the
  // audio was still starting up), join the curve partway through.
  function curve(param, t, dur, fn) {
    var steps = 48, x0 = t < 0 ? Math.min(1, -t / dur) : 0;
    param.setValueAtTime(fn(x0), t + dur * x0);
    for (var k = 1; k <= steps; k++) {
      if (k / steps > x0) param.linearRampToValueAtTime(fn(k / steps), t + dur * k / steps);
    }
  }

  function makeBuffer(sec, fill) {
    var len = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var ch = 0; ch < 2; ch++) fill(b.getChannelData(ch));
    return b;
  }

  function pink(d) {
    var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (var i = 0; i < d.length; i++) {
      var w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;    b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;    b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  }

  function brown(d) {
    var last = 0;
    for (var i = 0; i < d.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
  }

  // Reverb tails: a small bright room, and a big dark hall
  function room(d) {
    for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3.2) * 0.5;
  }
  function hall(d) {
    var y = 0;
    for (var i = 0; i < d.length; i++) {
      y += 0.12 * (Math.random() * 2 - 1 - y);
      d[i] = y * Math.pow(1 - i / d.length, 2.6) * 1.1;
    }
  }

  function filter(type, f, q) {
    var b = ctx.createBiquadFilter();
    b.type = type; b.frequency.value = f; b.Q.value = q;
    return b;
  }

  function gain(v) { var g = ctx.createGain(); g.gain.value = v; return g; }

  function load() {
    try {
      var k = localStorage.getItem(STORE_KEY);
      if (KINDS.indexOf(k) >= 0) return k;
    } catch (e) {}
    return 'ocean';
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, kind); } catch (e) {}
  }

  function init() {
    if (ctx) return true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    // Let iOS play through the silent switch, like a media app
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    ctx = new AC();
    buffers = {
      pink: makeBuffer(6, pink), brown: makeBuffer(8, brown),
      room: makeBuffer(3.5, room), hall: makeBuffer(7, hall)
    };
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.3;
    comp.connect(ctx.destination);
    out = comp;
    return true;
  }

  // A voice's output: mix -> (dry + reverb) -> out. mix fades the voice in and out.
  function voiceBase(type, wet, reverbBuf) {
    var v = { type: type, srcs: [], mix: gain(0) };
    var send = gain(wet), reverb = ctx.createConvolver();
    reverb.buffer = reverbBuf;
    v.mix.connect(out); v.mix.connect(send); send.connect(reverb); reverb.connect(out);
    v.nodes = [v.mix, send, reverb];
    v.tail = reverbBuf.duration;
    return v;
  }

  // ---------- ocean: Distant Swell ----------

  var OCEAN = {
    volume: 0.68,
    bed: 0.09, bedLp: 220,                  // distant surf that never stops
    bodyLp: [160, 550], bodyGain: [0.12, 0.75],
    wash: { lo: 450, hi: 1100, inAmt: 0.04, peak: 0.12, decay: 1.4 }, // the "shhh" as it breaks
    brk: 0.08,                              // how long the wave holds at its crest before draining

    make: function () {
      var v = voiceBase('ocean', 0.5, buffers.room);
      v.wave = 1;
      function layer(buf, offset, filt, g0) {
        var src = ctx.createBufferSource();
        src.buffer = buf; src.loop = true;
        var g = gain(g0);
        src.connect(filt); filt.connect(g); g.connect(v.mix);
        src.start(ctx.currentTime, offset);
        v.srcs.push(src);
        return g;
      }
      layer(buffers.brown, 0, filter('lowpass', OCEAN.bedLp, 0.5), OCEAN.bed);
      v.lp = filter('lowpass', OCEAN.bodyLp[0], 0.5);
      v.body = layer(buffers.pink, 0, v.lp, OCEAN.bodyGain[0]);
      v.bp = filter('bandpass', OCEAN.wash.lo, 0.7);
      v.wash = layer(buffers.pink, 2.5, v.bp, 0);
      return v;
    },

    phase: function (v, k, t, dur) {
      var B = OCEAN.bodyLp, G = OCEAN.bodyGain, W = OCEAN.wash, brk = OCEAN.brk;
      if (k === 'inhale') {
        var w = v.wave = 0.85 + Math.random() * 0.3; // every wave a little different
        curve(v.body.gain, t, dur, function (x) { return lerp(G[0], G[1] * w, Math.pow(ease(x), 1.3)); });
        curve(v.lp.frequency, t, dur, function (x) { return B[0] * Math.pow(B[1] * w / B[0], ease(x)); });
        curve(v.wash.gain, t, dur, function (x) { return W.inAmt * w * ease(x); });
        curve(v.bp.frequency, t, dur, function (x) { return lerp(W.lo, W.hi, ease(x)); });
        return;
      }
      var p = v.wave;
      var after = function (x) { return Math.max(0, (x - brk) / (1 - brk)); };
      curve(v.body.gain, t, dur, function (x) {
        return x < brk ? G[1] * p : G[0] + (G[1] * p - G[0]) * Math.pow(1 - after(x), 1.4);
      });
      curve(v.lp.frequency, t, dur, function (x) { return B[1] * p * Math.pow(B[0] / (B[1] * p), Math.pow(x, 0.7)); });
      curve(v.wash.gain, t, dur, function (x) {
        return x < brk ? lerp(W.inAmt, W.peak, x / brk) * p : W.peak * p * Math.pow(1 - after(x), W.decay);
      });
      curve(v.bp.frequency, t, dur, function (x) { return lerp(W.hi, W.lo, ease(x)); });
    }
  };

  // ---------- crystal: Crystal Bowl ----------

  var CRYSTAL = {
    volume: 0.49,
    f: 220,     // A3
    level: 0.2,
    attack: 0.12, // soft onset of the exhale ring, instead of a hard strike
    // [frequency ratio, amplitude, how long it lasts]; the 0.5 is a soft tone an octave below
    partials: [[1, 1, 1], [2.0, 0.12, 0.5], [3.0, 0.05, 0.3], [0.5, 0.35, 1.3]],

    make: function () {
      return voiceBase('crystal', 0.5, buffers.hall);
    },

    // Inhale: the bowl blooms in, higher partials arriving last.
    // Exhale: it rings out, staying full right to the end of the breath.
    phase: function (v, k, t, dur) {
      var c = CRYSTAL, start = Math.max(0, t), end = t + dur + 0.05;
      if (end <= ctx.currentTime) return;
      c.partials.forEach(function (p) {
        // each partial plus a slightly detuned twin, which gives the slow shimmer
        [[1, -0.3, 1], [1.0028, 0.3, 0.7]].forEach(function (tw) {
          var osc = ctx.createOscillator(), g = ctx.createGain(), pan = ctx.createStereoPanner();
          osc.frequency.value = c.f * p[0] * tw[0];
          pan.pan.value = tw[1];
          var amp = c.level * p[1] * tw[2], dec = p[2];
          curve(g.gain, t, dur, k === 'inhale'
            ? function (x) { return amp * Math.pow(x, 2 + 1 / dec); }
            : function (x) { return amp * Math.pow(1 - x, 0.85 / dec) * Math.min(1, x * dur / c.attack); });
          g.gain.linearRampToValueAtTime(0, end);
          osc.connect(g); g.connect(pan); pan.connect(v.mix);
          osc.start(start); osc.stop(end + 0.02);
        });
      });
    }
  };

  var VOICES = { ocean: OCEAN, crystal: CRYSTAL };

  // ---------- engine ----------

  function schedule(v, p) {
    var t = ctx.currentTime + (p.startedAt - performance.now()) / 1000;
    VOICES[v.type].phase(v, p.kind, t, p.durMs / 1000);
  }

  function open() {
    if (kind === 'off' || !init()) return;
    if (ctx.state !== 'running') ctx.resume();
    var v = voice = VOICES[kind].make(), now = ctx.currentTime;
    v.mix.gain.setValueAtTime(0, now);
    v.mix.gain.linearRampToValueAtTime(VOICES[kind].volume, now + 0.3);
    if (last) schedule(v, last);
  }

  // Fade a voice out over fadeMs, let its reverb ring off, then release it.
  function release(v, fadeMs) {
    var now = ctx.currentTime, end = now + fadeMs / 1000;
    v.mix.gain.cancelScheduledValues(now);
    v.mix.gain.setValueAtTime(v.mix.gain.value, now);
    v.mix.gain.linearRampToValueAtTime(0, end);
    v.srcs.forEach(function (s) { try { s.stop(end + 0.05); } catch (e) {} });
    setTimeout(function () {
      v.nodes.forEach(function (n) { n.disconnect(); });
    }, fadeMs + v.tail * 1000 + 200);
  }

  function start() {
    active = true;
    last = null;
    if (voice) release(voice, 100);
    voice = null;
    open();
  }

  // Schedule one inhale or exhale. startedAt is the phase's performance.now()
  // timestamp, so the sound lines up with the bar even if we're called late.
  function phase(k, durMs, startedAt) {
    last = { kind: k, durMs: durMs, startedAt: startedAt };
    if (voice) schedule(voice, last);
  }

  function stop(fadeMs) {
    active = false;
    if (voice) release(voice, fadeMs || 600);
    voice = null;
  }

  // Switch sound; mid-session it crossfades and picks up the current breath.
  function setKind(k) {
    if (KINDS.indexOf(k) < 0 || k === kind) return;
    kind = k;
    save();
    if (!active) return;
    if (voice) release(voice, 400);
    voice = null;
    open();
  }

  function next() {
    setKind(KINDS[(KINDS.indexOf(kind) + 1) % KINDS.length]);
    return kind;
  }

  // A soft, low bowl to mark the end of a timed session (not when Silent).
  function chime() {
    if (kind === 'off' || !init()) return;
    if (ctx.state !== 'running') ctx.resume();
    var t = ctx.currentTime + 0.7, mix = gain(0.5), send = gain(0.5), reverb = ctx.createConvolver();
    reverb.buffer = buffers.hall;
    mix.connect(out); mix.connect(send); send.connect(reverb); reverb.connect(out);
    // singing-bowl partials: [ratio, amplitude, decay seconds]
    [[1, 1, 7], [2.76, 0.35, 4], [5.4, 0.12, 2], [0.5, 0.25, 8]].forEach(function (p) {
      [[1, -0.25, 1], [1.0035, 0.25, 0.7]].forEach(function (tw) {
        var osc = ctx.createOscillator(), g = ctx.createGain(), pan = ctx.createStereoPanner();
        osc.frequency.value = 196 * p[0] * tw[0];
        pan.pan.value = tw[1];
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.12 * p[1] * tw[2], t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + p[2]);
        osc.connect(g); g.connect(pan); pan.connect(mix);
        osc.start(t); osc.stop(t + p[2] + 0.05);
      });
    });
    setTimeout(function () { [mix, send, reverb].forEach(function (n) { n.disconnect(); }); }, 17000);
  }

  // Browsers may suspend audio while the app is in the background.
  function wake() {
    if (ctx && voice && ctx.state !== 'running') ctx.resume();
  }

  window.BreathSound = {
    start: start, phase: phase, stop: stop, wake: wake, chime: chime,
    next: next, setKind: setKind, getKind: function () { return kind; }
  };
})();

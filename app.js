(function () {
  'use strict';

  var INHALE = 4000; // ms, bar fills bottom -> top
  var EXHALE = 6000; // ms, bar empties top -> bottom
  var PAUSE_EASE = 600; // ms, ease-to-empty on pause

  var root = document.documentElement;
  var wordInhale = document.querySelector('.phase-inhale');
  var wordExhale = document.querySelector('.phase-exhale');

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // state
  var running = false;
  var phase = 'inhale';       // 'inhale' | 'exhale'
  var phaseStart = 0;         // performance.now() at phase start
  var rafId = null;
  var wakeLock = null;

  // pause-decay state
  var decaying = false;
  var decayStart = 0;
  var decayFrom = 0;

  // sine ease-in-out: 0 -> 1
  function easeInOut(t) {
    return 0.5 - 0.5 * Math.cos(Math.PI * t);
  }

  function setFill(v) {
    root.style.setProperty('--fill', v.toFixed(4));
  }

  function setGlow(v) {
    root.style.setProperty('--glow', v.toFixed(4));
  }

  function showWord(name) {
    if (name === 'inhale') {
      wordInhale.classList.add('is-visible');
      wordExhale.classList.remove('is-visible');
    } else {
      wordExhale.classList.add('is-visible');
      wordInhale.classList.remove('is-visible');
    }
  }

  function frame(now) {
    if (!running) return;

    var duration = phase === 'inhale' ? INHALE : EXHALE;
    var elapsed = now - phaseStart;

    // roll any overshoot into the next phase(s) so throttled tabs stay accurate
    while (elapsed >= duration) {
      elapsed -= duration;
      phaseStart += duration;
      phase = phase === 'inhale' ? 'exhale' : 'inhale';
      duration = phase === 'inhale' ? INHALE : EXHALE;
      showWord(phase);
    }

    var t = elapsed / duration;
    var eased = easeInOut(t);
    var fill = phase === 'inhale' ? eased : 1 - eased;

    setFill(fill);
    if (!reduceMotion) setGlow(fill);

    rafId = requestAnimationFrame(frame);
  }

  function decayFrame(now) {
    if (!decaying) return;
    var t = (now - decayStart) / PAUSE_EASE;
    if (t >= 1) {
      decaying = false;
      setFill(0);
      if (!reduceMotion) setGlow(0);
      return;
    }
    var v = decayFrom * (1 - easeInOut(t));
    setFill(v);
    if (!reduceMotion) setGlow(v);
    rafId = requestAnimationFrame(decayFrame);
  }

  function currentFill() {
    var v = parseFloat(getComputedStyle(root).getPropertyValue('--fill'));
    return isNaN(v) ? 0 : v;
  }

  function start() {
    if (running) return;
    if (rafId) cancelAnimationFrame(rafId);
    decaying = false;
    running = true;
    phase = 'inhale';
    phaseStart = performance.now();
    showWord('inhale');
    requestWakeLock();
    rafId = requestAnimationFrame(frame);
  }

  function pause() {
    if (!running) return;
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    releaseWakeLock();

    // ease the bar to empty over ~600ms
    decaying = true;
    decayStart = performance.now();
    decayFrom = currentFill();
    rafId = requestAnimationFrame(decayFrame);
  }

  function toggle() {
    if (running) pause();
    else start();
  }

  // --- wake lock (fail silently if unsupported) ---
  function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(function (lock) {
      wakeLock = lock;
      wakeLock.addEventListener('release', function () {
        wakeLock = null;
      });
    }).catch(function () {});
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(function () {});
      wakeLock = null;
    }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && running && !wakeLock) {
      requestWakeLock();
    }
  });

  // tap anywhere to start/pause
  document.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    toggle();
  });
})();

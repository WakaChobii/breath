(function () {
  'use strict';

  // Descent staircase: [inhaleMs, exhaleMs], slower + more exhale-biased each step.
  // Every level keeps exhale >= 1.5x inhale, so the breath can never invert into
  // something activating. L0 (4:6) is the proven parasympathetic default.
  var LEVELS = [
    [4000, 6000],   // L0  10s, 6.0 bpm  (default start)
    [4000, 7000],   // L1  11s
    [4000, 8000],   // L2  12s, 5.0 bpm
    [5000, 8000],   // L3  13s
    [5000, 9000],   // L4  14s
    [5000, 10000],  // L5  15s, 4.0 bpm
    [6000, 10000],  // L6  16s
    [6000, 12000]   // L7  18s, ~3.3 bpm  (deep floor)
  ];
  var MAX_LEVEL = LEVELS.length - 1;

  var PAUSE_EASE = 600;      // ms, ease-to-empty on pause
  var TAP_MS = 250;          // <= this = a quick tap (pause/resume); longer = a conducted breath
  var SYNC_THRESHOLD = 3;    // consecutive in-sync breaths needed to step deeper
  var DOWN_FILL_MAX = 0.3;   // pressing while bar is below this = a good inhale-start
  var UP_FILL_MIN = 0.7;     // releasing while bar is above this = a good exhale-start
  var PULSE_MS = 800;        // step-deeper glow bloom duration
  var TIMER_MS = 5 * 60 * 1000; // the timer button's session length

  var root = document.documentElement;
  var sound = window.BreathSound;
  var wordInhale = document.querySelector('.phase-inhale');
  var wordExhale = document.querySelector('.phase-exhale');

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // breath model
  var level = 0;
  var curInhale = LEVELS[0][0];
  var curExhale = LEVELS[0][1];
  var pendingLevel = null;    // applied at the next phase boundary

  // run state
  var running = false;
  var phase = 'inhale';       // 'inhale' | 'exhale'
  var phaseStart = 0;         // performance.now() at phase start
  var rafId = null;
  var wakeLock = null;

  // pause-decay state
  var decaying = false;
  var decayStart = 0;
  var decayFrom = 0;

  // gesture / sync state
  var gestureActive = false;
  var downAt = 0;
  var downGood = false;
  var syncStreak = 0;
  var pulseStart = 0;

  // timer state: counts down only while breathing; when it runs out, the
  // session ends gently at the end of the current exhale
  var timerOn = false;
  var timerLeft = 0;          // ms remaining, while paused
  var timerEndAt = 0;         // performance.now() when it runs out, while breathing
  var timerText = '';

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

  function setDepth(idx) {
    root.style.setProperty('--depth', (idx / MAX_LEVEL).toFixed(4));
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

  function applyLevel(idx) {
    level = idx;
    curInhale = LEVELS[idx][0];
    curExhale = LEVELS[idx][1];
    setDepth(idx);
  }

  // decaying glow bump when the app steps you deeper
  function pulseAmt(now) {
    if (!pulseStart) return 0;
    var t = (now - pulseStart) / PULSE_MS;
    if (t >= 1) {
      pulseStart = 0;
      return 0;
    }
    return 0.55 * (1 - easeInOut(t));
  }

  function frame(now) {
    if (!running) return;

    var duration = phase === 'inhale' ? curInhale : curExhale;
    var elapsed = now - phaseStart;

    // roll any overshoot into the next phase(s) so throttled tabs stay accurate
    var crossed = false;
    while (elapsed >= duration) {
      crossed = true;
      elapsed -= duration;
      phaseStart += duration;
      phase = phase === 'inhale' ? 'exhale' : 'inhale';
      // apply a pending descent at the boundary — bar is at 0 or 1 here, so
      // swapping the phase duration is visually seamless
      if (pendingLevel !== null) {
        applyLevel(pendingLevel);
        pendingLevel = null;
      }
      duration = phase === 'inhale' ? curInhale : curExhale;
      showWord(phase);
    }
    // time's up and the exhale just finished: end the session here
    if (crossed && phase === 'inhale' && timerOn && now >= timerEndAt) {
      finishTimer();
      return;
    }
    if (crossed && sound) sound.phase(phase, duration, phaseStart);
    if (timerOn) showTimer(timerEndAt - now);

    var t = elapsed / duration;
    var eased = easeInOut(t);
    var fill = phase === 'inhale' ? eased : 1 - eased;

    setFill(fill);
    if (!reduceMotion) setGlow(Math.min(1, fill + pulseAmt(now)));

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
    if (timerOn) timerEndAt = phaseStart + timerLeft;
    if (sound) {
      sound.start();
      sound.phase('inhale', curInhale, phaseStart);
    }
    requestWakeLock();
    rafId = requestAnimationFrame(frame);
  }

  function pause() {
    if (!running) return;
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    releaseWakeLock();
    if (sound) sound.stop(PAUSE_EASE);
    if (timerOn) timerLeft = Math.max(0, timerEndAt - performance.now());

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

  // A completed conducted breath (press = inhale start, release = exhale start).
  // In sync when you pressed near-empty AND released near-full — proof you're
  // following the bar. Enough in-sync breaths in a row earns one step deeper.
  function scoreBreath(upGood) {
    if (downGood && upGood) {
      syncStreak += 1;
      if (syncStreak >= SYNC_THRESHOLD && level < MAX_LEVEL) {
        pendingLevel = level + 1;
        syncStreak = 0;
        pulseStart = performance.now();
      }
    } else {
      syncStreak = 0;
    }
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
    if (document.visibilityState === 'visible' && running) {
      if (!wakeLock) requestWakeLock();
      if (sound) sound.wake();
    }
  });

  // --- controls: keep taps on them from also starting/pausing the breath ---
  function isolate(btn) {
    btn.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    btn.addEventListener('pointerup', function (e) { e.stopPropagation(); });
  }

  // --- timer: tap to breathe for 5 minutes; tap again to cancel ---
  var timerBtn = document.querySelector('.timer-toggle');

  function showTimer(ms) {
    var text, label;
    if (!timerOn) {
      text = '5 min';
      label = 'Start a 5 minute session';
    } else {
      var secs = Math.max(0, Math.ceil(ms / 1000));
      var m = Math.floor(secs / 60), s = secs % 60;
      text = m + ':' + (s < 10 ? '0' : '') + s;
      label = m + ' min ' + s + ' sec left. Tap to cancel the timer.';
    }
    if (text === timerText) return;
    timerText = text;
    timerBtn.textContent = text;
    timerBtn.setAttribute('aria-label', label);
    timerBtn.classList.toggle('is-on', timerOn);
  }

  function finishTimer() {
    timerOn = false;
    pause();
    if (sound) sound.chime();
    showTimer(0);
  }

  isolate(timerBtn);
  timerBtn.addEventListener('click', function () {
    if (timerOn) {
      timerOn = false;
    } else {
      timerOn = true;
      timerLeft = TIMER_MS;
      if (running) timerEndAt = performance.now() + TIMER_MS;
      else start();
    }
    showTimer(running ? timerEndAt - performance.now() : timerLeft);
  });
  showTimer(0);

  // --- sound picker: tap to cycle Ocean -> Crystal -> Silent ---
  var SOUND_NAMES = { ocean: 'Ocean', crystal: 'Crystal', off: 'Silent' };
  var soundBtn = document.querySelector('.sound-toggle');

  function showSound() {
    var name = SOUND_NAMES[sound.getKind()];
    soundBtn.textContent = name;
    soundBtn.setAttribute('aria-label', 'Sound: ' + name + '. Tap to change.');
  }

  if (sound) {
    showSound();
    isolate(soundBtn);
    soundBtn.addEventListener('click', function () {
      sound.next();
      showSound();
    });
  } else {
    soundBtn.hidden = true;
  }

  // --- input: quick tap = start/pause; press-and-hold = conduct a breath ---
  document.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    gestureActive = true;
    downAt = performance.now();
    // only score sync while actually breathing; a press near-empty at the start
    // of an inhale is a good inhale-start
    downGood = running && phase === 'inhale' && currentFill() < DOWN_FILL_MAX;
  });

  document.addEventListener('pointerup', function () {
    if (!gestureActive) return;
    gestureActive = false;

    var held = performance.now() - downAt;

    if (!running) {
      // paused (or first launch): any release starts the session
      start();
      return;
    }

    if (held <= TAP_MS) {
      // a quick tap pauses
      pause();
      return;
    }

    // a held gesture is a conducted breath — releasing near-full is a good
    // exhale-start
    var upGood = currentFill() > UP_FILL_MIN;
    scoreBreath(upGood);
  });

  document.addEventListener('pointercancel', function () {
    // finger slid off / interrupted — abandon the gesture without scoring
    gestureActive = false;
  });
})();

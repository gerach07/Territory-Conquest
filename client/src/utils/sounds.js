/* ═══════════════════════════════════════════════════════════
   Territory Conquest – Sound Effects (Web Audio API)
   ═══════════════════════════════════════════════════════════ */
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let ctx = null;
let _soundEnabled = false;

export function setSoundEnabled(enabled) { _soundEnabled = !!enabled; }
export function isSoundEnabled()         { return _soundEnabled; }

function getCtx() {
  if (!ctx) {
    try {
      ctx = new AudioCtx();
    } catch (e) {
      return null;
    }
  }
  if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq, duration, type = 'sine', vol = 0.3) {
  const c = getCtx();
  if (!c) return;
  try {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type; osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    osc.connect(gain); gain.connect(c.destination);
    osc.start(); osc.stop(c.currentTime + duration);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  } catch { /* audio not available */ }
}

export function playSound(type) {
  if (!_soundEnabled || document.hidden) return;
  switch (type) {
    case 'kill':
      tone(800, 0.15, 'square', 0.2);
      setTimeout(() => tone(600, 0.1, 'square', 0.15), 80);
      break;
    case 'death':
      tone(300, 0.35, 'sawtooth', 0.2);
      setTimeout(() => tone(200, 0.4, 'sawtooth', 0.25), 200);
      break;
    case 'victory':
      [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.3, 'sine', 0.25), i * 150));
      break;
    case 'defeat':
      [400, 350, 300, 250].forEach((f, i) => setTimeout(() => tone(f, 0.35, 'sine', 0.2), i * 200));
      break;
    case 'turn':
      tone(880, 0.1, 'sine', 0.15);
      setTimeout(() => tone(1100, 0.15, 'sine', 0.15), 100);
      break;
    case 'chat':
      tone(1200, 0.05, 'sine', 0.08);
      break;
    case 'join':
      tone(600, 0.12, 'sine', 0.15);
      break;
    case 'start':
      tone(500, 0.1, 'sine', 0.15);
      setTimeout(() => tone(700, 0.1, 'sine', 0.15), 120);
      setTimeout(() => tone(900, 0.15, 'sine', 0.2), 240);
      break;
    default: break;
  }
}

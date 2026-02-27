/* ═══════════════════════════════════════════════════════════
   Territory Conquest – Background Music
   ═══════════════════════════════════════════════════════════ */
let _audio = null;
let _currentPhase = null;
let _enabled = true;
let _volume = 0.35;
let _fadeInterval = null;

const TRACKS = {
  menu:    { src: '/assets/audio/bgm_menu.ogg',    loop: true },
  waiting: { src: '/assets/audio/bgm_menu.ogg',    loop: true },
  game:    { src: '/assets/audio/bgm_battle.ogg',  loop: true },
  victory: { src: '/assets/audio/bgm_victory.ogg', loop: false },
  defeat:  { src: '/assets/audio/bgm_defeat.ogg',  loop: false },
};

function fadeOut(audio, durationMs = 400) {
  if (!audio) return;
  const step = 30;
  const decrement = (audio.volume || _volume) / (durationMs / step);
  const id = setInterval(() => {
    if (audio.volume > decrement) {
      audio.volume = Math.max(0, audio.volume - decrement);
    } else {
      clearInterval(id);
      audio.pause();
    }
  }, step);
  return id;
}

function stopMusic(fade = true) {
  if (_fadeInterval) clearInterval(_fadeInterval);
  if (_audio) {
    if (fade) { _fadeInterval = fadeOut(_audio); }
    else { _audio.pause(); }
    _audio = null;
  }
}

export function playPhaseMusic(phase) {
  if (!_enabled)       { _currentPhase = phase; stopMusic(false); return; }
  if (_currentPhase === phase && _audio && !_audio.paused && !_audio.ended) return;
  stopMusic(true);
  _currentPhase = phase;
  const track = TRACKS[phase];
  if (!track) return;
  const audio = new Audio();
  audio.src = track.src;
  audio.loop = track.loop;
  audio.volume = 0;
  audio.preload = 'auto';
  audio.play().then(() => {
    const rampStep = 30;
    const rampDuration = 600;
    const increment = _volume / (rampDuration / rampStep);
    const rampId = setInterval(() => {
      if (audio.volume < _volume - increment) {
        audio.volume = Math.min(_volume, audio.volume + increment);
      } else {
        audio.volume = _volume;
        clearInterval(rampId);
      }
    }, rampStep);
  }).catch(() => {
    // Audio play failed (user gesture required) - clean up
    _audio = null;
  });
  _audio = audio;
}

export function stopAllMusic()                  { _currentPhase = null; stopMusic(false); }
export function setMusicEnabled(enabled)        { _enabled = enabled; if (!enabled) stopMusic(false); else if (_currentPhase) playPhaseMusic(_currentPhase); }
export function isMusicEnabled()                { return _enabled; }
export function pauseMusic()                    { if (_audio) _audio.pause(); }
export function resumeMusic()                   { if (_enabled && _audio) _audio.play().catch(() => {}); }

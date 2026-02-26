/* ═══════════════════════════════════════════════════════════
   Territory Conquest – GameTimer (React)
   ═══════════════════════════════════════════════════════════ */
import React, { memo } from 'react';

const fmt = (secs) => {
  const s = Math.max(0, Math.ceil(secs));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
};

const GameTimer = memo(({ timeRemaining }) => {
  if (timeRemaining == null) return null;

  const isCritical = timeRemaining <= 30;
  const isLow      = timeRemaining <= 60;

  return (
    <div className={`px-4 py-1.5 rounded-xl font-mono font-bold text-lg backdrop-blur-md border transition-all ${
      isCritical ? 'bg-red-900/60 border-red-500/50 text-red-300 animate-pulse'
      : isLow    ? 'bg-orange-900/40 border-orange-500/40 text-orange-300'
      :            'bg-slate-900/60 border-slate-600/30 text-slate-200'
    }`}>
      {fmt(timeRemaining)}
    </div>
  );
});

GameTimer.displayName = 'GameTimer';
export default GameTimer;

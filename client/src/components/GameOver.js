/* ═══════════════════════════════════════════════════════════
   Territory Conquest – GameOver (React)
   (Aligned with Battleships design system)
   ═══════════════════════════════════════════════════════════ */
import React, { memo } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { PLAYER_COLORS } from '../constants';

const GameOver = memo(({
  gameOverData, myId, isSpectator,
  playAgainPending, playAgainVotes,
  handlePlayAgain, handleDeclinePlayAgain, handleBackToMenu,
}) => {
  const { t } = useI18n();
  if (!gameOverData) return null;

  const isWinner  = gameOverData.winnerId === myId;
  const standings = gameOverData.players || [];

  return (
    <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" role="status" aria-label={isSpectator ? 'Game over' : (isWinner ? 'Victory' : 'Defeat')}>
      <div className={`glass-card p-7 max-w-md w-full space-y-5 animate-fade-in relative overflow-hidden ${
        isSpectator ? 'border-slate-600/40'
          : isWinner ? 'border-yellow-500/50 shadow-2xl shadow-yellow-900/20'
          : 'border-red-500/30 shadow-xl shadow-red-900/15'
      }`}>

        {/* Winner glow overlay */}
        {isWinner && !isSpectator && (
          <div className="absolute inset-0 bg-gradient-to-br from-yellow-500/10 via-transparent to-amber-500/10 pointer-events-none" />
        )}

        {/* Icon */}
        <div className={`text-8xl text-center ${!isSpectator && isWinner ? 'animate-bounce drop-shadow-2xl' : ''}`}
          style={!isSpectator && isWinner ? { animationDuration: '1.5s', filter: 'drop-shadow(0 0 20px rgba(251,191,36,0.5))' } : {}}>
          {isSpectator ? '🏁' : (isWinner ? '🏆' : '💀')}
        </div>

        {/* Title */}
        <div className="text-center relative">
          <h2 className={`text-4xl sm:text-5xl font-black ${
            isSpectator ? 'text-white'
              : isWinner ? 'bg-gradient-to-r from-yellow-300 via-amber-300 to-yellow-400 bg-clip-text text-transparent drop-shadow-lg'
              : 'text-red-400'
          }`}>
            {isSpectator ? t('gameover.title') : (isWinner ? t('gameover.victory') : t('gameover.defeat') || t('gameover.title'))}
          </h2>
          <p className="text-slate-400 text-sm mt-3 leading-relaxed">
            {isSpectator ? t('gameover.spectatorSubtitle')
              : (isWinner ? t('gameover.winSubtitle')
                : t('gameover.loseSubtitle', gameOverData.winnerName || '?'))}
          </p>
        </div>

        {/* Stars for winner */}
        {isWinner && !isSpectator && (
          <div className="flex justify-center gap-2">
            {['⭐', '⭐', '⭐'].map((s, i) => (
              <span key={i} className="text-3xl animate-bounce"
                style={{ animationDelay: `${i * 150}ms`, animationDuration: '1s', filter: 'drop-shadow(0 0 8px rgba(251,191,36,0.6))' }}>
                {s}
              </span>
            ))}
          </div>
        )}

        {/* Standings */}
        {standings.length > 0 && (
          <div className="space-y-1.5 relative">
            {standings.map((p, i) => {
              const color = PLAYER_COLORS[p.colorIndex] || '#888';
              const isSelf = p.id === myId;
              const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null;
              return (
                <div key={p.id || i} className={`flex items-center gap-2.5 px-3.5 py-2 rounded-xl text-sm transition-colors ${
                  isSelf ? 'bg-cyan-900/30 border border-cyan-500/25 shadow-sm shadow-cyan-900/20' : 'bg-slate-800/40 border border-slate-700/20'
                }`}>
                  <span className="text-base w-6 text-center">{medal || <span className="text-slate-500 font-mono text-xs">#{i + 1}</span>}</span>
                  <span className="w-3.5 h-3.5 rounded-full flex-shrink-0 shadow-sm" style={{ background: color, boxShadow: `0 0 8px ${color}40` }} />
                  <span className="flex-1 truncate font-semibold" style={{ color: isSelf ? '#22d3ee' : '#e2e8f0' }}>{p.name}</span>
                  <span className="text-slate-400 font-mono text-xs font-bold">{p.score || 0}%</span>
                  <span className="text-slate-500 text-xs">🗡️{p.kills || 0}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Actions */}
        {!isSpectator && (
          <div className="space-y-2 relative">
            {playAgainPending && (
              <>
                <div className="flex justify-center gap-2 mb-2">
                  {[0, 150, 300].map(d => <span key={d} className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
                </div>
                <p className="text-sm text-slate-400 text-center">
                  {t('gameover.waitingAccept', playAgainVotes || '')}
                </p>
                <button onClick={handleDeclinePlayAgain}
                  className="w-full py-2.5 rounded-xl bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 font-medium transition-all text-sm">
                  {t('gameover.cancelRequest')}
                </button>
              </>
            )}

            {!playAgainPending && (
              <div className="flex gap-3">
                <button onClick={handlePlayAgain}
                  className="flex-1 py-3 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 text-white font-bold rounded-xl transition-all hover:scale-[1.02] shadow-lg shadow-emerald-900/30 active:scale-95">
                  🎮 {t('gameover.playAgain')}
                </button>
                <button onClick={handleBackToMenu}
                  className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-slate-300 font-semibold rounded-xl transition-all text-sm active:scale-95">
                  {t('gameover.backToMenu')}
                </button>
              </div>
            )}
          </div>
        )}

        {isSpectator && (
          <button onClick={handleBackToMenu}
            className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-slate-300 font-semibold rounded-xl transition-all active:scale-95">
            {t('gameover.backToMenu')}
          </button>
        )}
      </div>
    </div>
  );
});

GameOver.displayName = 'GameOver';
export default GameOver;

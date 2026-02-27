/* ═══════════════════════════════════════════════════════════
   Territory Conquest – WaitingRoom (React)
   (Aligned with Battleships design system)
   ═══════════════════════════════════════════════════════════ */
import React, { useState, memo } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { PLAYER_COLORS } from '../constants';

/** Fallback clipboard copy for non-HTTPS / older browsers */
function fallbackCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  } catch { return false; }
}

const WaitingRoom = memo(({
  roomCode, roomPassword, players, isHost, myId, timeLimit,
  handleStartGame, handleKickPlayer, handleBackToMenu,
}) => {
  const { t }               = useI18n();
  const [copied, setCopied]   = useState(null);
  const [kickOpen, setKickOpen] = useState(false);
  const maxSlots = 6;

  const copyWith = (text, label) => {
    const onSuccess = () => { setCopied(label); setTimeout(() => setCopied(null), 2000); };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(onSuccess).catch(() => {
        fallbackCopy(text) && onSuccess();
      });
    } else {
      fallbackCopy(text) && onSuccess();
    }
  };

  const kickable = players.filter(p => p.id !== myId && !p.isHost);
  const hasEnough = players.length > 1;

  return (
    <div className="max-w-lg mx-auto pt-4 px-2 text-center space-y-6 animate-fade-in">

      {/* ── Room code focal card with corner brackets + scanline ── */}
      <div className="glass-card corner-brackets px-6 py-7 relative overflow-hidden border-yellow-400/50 shadow-2xl shadow-yellow-500/10 hover:shadow-yellow-500/15 transition-all duration-500">
        <div className="scanline-sweep" />
        <div className="absolute inset-0 bg-gradient-to-br from-yellow-500/8 via-transparent to-yellow-500/8 pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(250,204,21,0.1),transparent_50%)] pointer-events-none" />
        <div className="relative space-y-3">
          <p className="text-[0.6rem] text-yellow-400/80 uppercase tracking-[0.35em] font-bold drop-shadow">{t('waiting.roomCode')}</p>
          <p
            className="text-5xl sm:text-6xl font-black font-mono text-yellow-300 tracking-[0.25em] drop-shadow-lg select-all"
            style={{ textShadow: '0 0 32px rgba(253,224,71,0.4), 0 0 16px rgba(253,224,71,0.3)' }}
          >
            {roomCode}
          </p>
          <div className="flex items-center justify-center gap-3 mt-3 flex-wrap">
            {roomPassword && (
              <span className="text-xs text-orange-300 bg-orange-500/15 rounded-full py-1.5 px-3.5 border border-orange-500/30 backdrop-blur-sm shadow-sm transition-transform hover:scale-105">
                🔒 PIN: <span className="font-mono font-bold">{roomPassword}</span>
              </span>
            )}
            {!roomPassword && (
              <span className="text-xs text-green-300 bg-green-500/15 rounded-full py-1.5 px-3.5 border border-green-500/30 backdrop-blur-sm shadow-sm transition-transform hover:scale-105">
                🔓 {t('waiting.open')}
              </span>
            )}
            {timeLimit > 0 ? (
              <span className="text-xs text-blue-300 bg-blue-500/15 rounded-full py-1.5 px-3.5 border border-blue-500/30 backdrop-blur-sm shadow-sm transition-transform hover:scale-105">
                ⏱️ {Math.round(timeLimit / 60)} {t('waiting.minGame')}
              </span>
            ) : (
              <span className="text-xs text-purple-300 bg-purple-500/15 rounded-full py-1.5 px-3.5 border border-purple-500/30 backdrop-blur-sm shadow-sm transition-transform hover:scale-105">
                ♾️ {t('login.noLimit')}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Player slots (3x2 grid) ── */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {Array.from({ length: maxSlots }).map((_, i) => {
          const p = players[i];
          if (p) {
            const color = PLAYER_COLORS[p.colorIndex] || '#64748b';
            const isMe = p.id === myId;
            return (
              <div key={p.id} className="glass-card slot-ready p-3 text-center relative space-y-1.5 cursor-default"
                style={{ borderColor: color + '40' }}>
                {p.isHost && (
                  <div className="absolute -top-1.5 -right-1.5 bg-gradient-to-r from-yellow-500 to-amber-500 text-[0.45rem] font-black text-slate-900 px-1.5 py-0.5 rounded-full shadow-md">
                    👑
                  </div>
                )}
                {isMe && (
                  <div className="absolute -top-1.5 -left-1.5 bg-gradient-to-r from-cyan-500 to-blue-500 text-[0.45rem] font-black text-white px-1.5 py-0.5 rounded-full shadow-md">
                    {t('waiting.you')}
                  </div>
                )}
                <div className="w-10 h-10 mx-auto rounded-full flex items-center justify-center text-lg border-2 shadow-lg"
                  style={{ background: color + '22', borderColor: color + '55', boxShadow: `0 4px 12px ${color}30` }}>
                  <span className="drop-shadow">✓</span>
                </div>
                <p className="text-xs font-bold truncate" style={{ color }}>{p.name}</p>
                <p className="text-[0.55rem] uppercase tracking-widest font-semibold" style={{ color: color + 'aa' }}>{t('waiting.ready')}</p>
              </div>
            );
          }
          return (
            <div key={`empty-${i}`} className="glass-card slot-waiting p-3 text-center space-y-1.5 cursor-default">
              <div className="w-10 h-10 mx-auto rounded-full flex items-center justify-center text-sm bg-gradient-to-br from-blue-500/15 to-blue-600/15 border-2 border-blue-500/30">
                <span className="flex gap-0.5">
                  {[0, 150, 300].map(d => (
                    <span key={d} className="w-1 h-1 bg-blue-400/60 rounded-full animate-bounce" style={{ animationDelay: `${d}ms`, animationDuration: '1s' }} />
                  ))}
                </span>
              </div>
              <p className="text-xs text-slate-500">{t('waiting.empty')}</p>
              <p className="text-[0.55rem] text-slate-600 uppercase tracking-widest font-semibold">{t('waiting.waiting')}</p>
            </div>
          );
        })}
      </div>

      {/* ── Host controls ── */}
      {isHost && hasEnough && (
        <div className="glass-card p-4 space-y-3 border-yellow-500/30 shadow-xl shadow-yellow-900/20">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">👑</span>
            <h3 className="text-sm font-bold text-yellow-300">{t('waiting.hostControls')}</h3>
          </div>
          <div className="flex gap-3">
            <button onClick={handleStartGame}
              className="flex-1 py-3 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 text-white font-bold rounded-xl transition-all hover:scale-105 shadow-lg shadow-emerald-900/30 active:scale-95">
              🎮 {t('waiting.startGame')}
            </button>
            {kickable.length > 0 && (
              <button onClick={() => setKickOpen(true)}
                className="px-4 py-3 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl transition-all hover:scale-105 shadow-lg shadow-red-900/30 active:scale-95"
                title={t('waiting.kickPlayer')}>
                ⛔
              </button>
            )}
          </div>
          <p className="text-[0.6rem] text-slate-400 text-center leading-relaxed">{t('waiting.hostHint')}</p>
        </div>
      )}

      {isHost && !hasEnough && (
        <p className="text-xs text-slate-500">{t('waiting.hostHint')}</p>
      )}

      {/* ── Waiting for host (non-host player) ── */}
      {!isHost && hasEnough && (
        <div className="glass-card p-4 border-blue-500/30 shadow-xl shadow-blue-900/20">
          <div className="flex items-center justify-center gap-3">
            <span className="text-lg animate-pulse">⏳</span>
            <p className="text-sm font-semibold text-blue-300">{t('waiting.waitingForHost')}</p>
          </div>
          <p className="text-[0.6rem] text-slate-400 text-center mt-2 leading-relaxed">
            {t('waiting.waitingHint') || t('waiting.waitingForHostHint')}
          </p>
        </div>
      )}

      {!isHost && !hasEnough && (
        <div className="glass-card p-4 border-blue-500/30">
          <p className="text-sm text-slate-400">{t('waiting.waitingForHost')}</p>
          <p className="text-xs text-slate-500 mt-1">{t('waiting.waitingHint')}</p>
        </div>
      )}

      {/* ── Share section ── */}
      {!hasEnough && (
        <>
          <div className="pt-2">
            <h2 className="text-lg font-bold text-white">{t('waiting.invitePlayers') || t('waiting.title')}</h2>
            <p className="text-slate-400 text-xs mt-1.5 leading-relaxed">{t('waiting.shareHint')}</p>
          </div>

          <div className="flex gap-3 justify-center flex-wrap px-2">
            <button
              onClick={() => copyWith(roomCode, 'code')}
              className={`group px-6 py-3 text-sm rounded-xl transition-all duration-300 font-semibold shadow-lg ${
                copied === 'code'
                ? 'bg-gradient-to-r from-green-600 to-emerald-600 text-white shadow-green-900/40 scale-105'
                : 'glass-card !rounded-xl hover:border-slate-400/40 text-slate-200 hover:scale-105 hover:shadow-xl active:scale-95'
              }`}
            >
              <span className="flex items-center gap-2">
                <span className={copied === 'code' ? '' : 'group-hover:scale-110 transition-transform'}>
                  {copied === 'code' ? '✓' : '📋'}
                </span>
                {copied === 'code' ? t('waiting.copied') : t('waiting.copyCode')}
              </span>
            </button>
            <button
              onClick={() => {
                const path = roomPassword ? `${roomCode}/${roomPassword}` : roomCode;
                const url = `${window.location.origin}/${path}`;
                copyWith(url, 'link');
              }}
              className={`group px-6 py-3 text-sm rounded-xl transition-all duration-300 font-semibold shadow-lg ${
                copied === 'link'
                ? 'bg-gradient-to-r from-green-600 to-emerald-600 text-white shadow-green-900/40 scale-105'
                : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white hover:scale-105 hover:shadow-xl shadow-blue-900/30 active:scale-95'
              }`}
            >
              <span className="flex items-center gap-2">
                <span className={copied === 'link' ? '' : 'group-hover:scale-110 transition-transform'}>
                  {copied === 'link' ? '✓' : '🔗'}
                </span>
                {copied === 'link' ? t('waiting.copied') : `${t('waiting.copyLink')}${roomPassword ? ` ${t('waiting.plusPin') || '+ PIN'}` : ''}`}
              </span>
            </button>
          </div>
        </>
      )}

      {/* ── Leave button ── */}
      <button
        onClick={handleBackToMenu}
        className="mt-3 px-6 py-2.5 text-red-400/80 hover:text-red-300 hover:bg-red-500/10 text-sm font-semibold transition-all rounded-lg active:scale-95"
      >
        ← {t('waiting.leaveRoom')}
      </button>

      {/* ── Kick dialog ── */}
      {kickOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setKickOpen(false)}>
          <div className="glass-card p-5 max-w-xs w-full space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white">{t('waiting.kickTitle')}</h3>
            <div className="space-y-2">
              {kickable.map(p => {
                const color = PLAYER_COLORS[p.colorIndex] || '#64748b';
                return (
                  <button key={p.id} onClick={() => { handleKickPlayer(p.id); setKickOpen(false); }}
                    className="w-full flex items-center gap-3 p-3 rounded-xl bg-slate-800/50 hover:bg-red-900/30 border border-slate-700/30 hover:border-red-500/30 transition-all">
                    <span className="w-5 h-5 rounded-full shadow-sm" style={{ background: color }} />
                    <span className="text-sm text-white font-medium">{p.name}</span>
                  </button>
                );
              })}
            </div>
            <button onClick={() => setKickOpen(false)}
              className="w-full py-2.5 rounded-lg bg-slate-700/50 text-slate-400 text-sm hover:text-white transition-colors font-semibold">
              {t('login.back')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

WaitingRoom.displayName = 'WaitingRoom';
export default WaitingRoom;

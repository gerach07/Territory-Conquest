/* ═══════════════════════════════════════════════════════════
   Territory Conquest – LoginView (React)
   Menu → Create / Join → PIN → Name+Color → emit joinGame
   (Aligned with Battleships design system)
   ═══════════════════════════════════════════════════════════ */
import React, { useState, useEffect, useCallback, memo } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { PLAYER_COLORS, COLOR_NAMES } from '../constants';

const LoginView = memo(({
  loginView, setLoginView,
  onCreateRoom, onJoinRoom, onSpectate, onFinalJoin,
  pendingJoin, setPendingJoin,
  takenColors,
  serverUrl,
  setURLRoom,
}) => {
  const { t } = useI18n();

  /* ── local state ── */
  const [pin, setPin]                 = useState('');
  const [joinCode, setJoinCode]       = useState('');
  const [joinRoomPin, setJoinRoomPin] = useState('');
  const [createPin, setCreatePin]     = useState('');
  const [timeLimit, setTimeLimit]     = useState(180);
  const [playerName, setPlayerName]   = useState(() => localStorage.getItem('tc_playerName') || '');
  const [selectedColor, setSelectedColor] = useState(0);
  const [rooms, setRooms]             = useState([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [isCheckingRoom, setIsCheckingRoom] = useState(false);

  /* ── restore saved name ── */
  useEffect(() => {
    const saved = localStorage.getItem('tc_playerName');
    if (saved) setPlayerName(saved);
  }, []);

  /* ── auto-select available color ── */
  useEffect(() => {
    if (takenColors && takenColors.includes(selectedColor)) {
      const avail = PLAYER_COLORS.findIndex((_, i) => !takenColors.includes(i));
      if (avail >= 0) setSelectedColor(avail);
    }
  }, [takenColors, selectedColor]);

  /* ── fetch rooms list ── */
  const fetchRooms = useCallback(async () => {
    setRoomsLoading(true);
    try {
      const res  = await fetch('/rooms');
      const data = await res.json();
      setRooms(data.rooms || []);
    } catch { setRooms([]); }
    setRoomsLoading(false);
  }, []);

  useEffect(() => { if (loginView === 'join') fetchRooms(); }, [loginView, fetchRooms]);

  /* ── handlers ── */
  const handleCreate = () => {
    if (createPin && createPin.length !== 3) return;
    setPendingJoin({ creating: true, pin: createPin || null, timeLimit, spectate: false });
    setLoginView('enterName');
  };

  const handleJoinByCode = (spectate = false) => {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    setIsCheckingRoom(true);
    onJoinRoom(code, spectate);
    setTimeout(() => setIsCheckingRoom(false), 2000);
  };

  const handlePinSubmit = () => {
    if (pin.length !== 3) return;
    if (!pendingJoin) return;
    const updated = { ...pendingJoin, pin };
    setPendingJoin(updated);
    if (updated.spectate) {
      onSpectate(updated.roomCode, pin);
    } else {
      setLoginView('enterName');
    }
  };

  const handleFinalJoinClick = () => {
    const name = playerName.trim();
    if (!name) return;
    localStorage.setItem('tc_playerName', name);
    onFinalJoin(name, selectedColor);
  };

  const goBack = () => {
    if (loginView === 'enterName' && pendingJoin?.creating) setLoginView('create');
    else if (loginView === 'enterName') setLoginView('join');
    else if (loginView === 'enterPin') setLoginView('join');
    else { setLoginView('menu'); if (setURLRoom) setURLRoom(null); }
    if (loginView !== 'enterName') setPendingJoin(null);
  };

  return (
    <div className="max-w-md mx-auto space-y-5 pt-2 px-2 relative z-10">
      {/* ── HERO ── */}
      <div className="text-center space-y-3 select-none pb-2">
        <div className="relative flex items-end justify-center gap-2 h-24">
          <span className="text-4xl sm:text-5xl opacity-20 animate-float-slow" style={{ transform: 'scaleX(-1) translateY(-6px)', animationDelay: '0s' }}>⚔️</span>
          <div className="relative animate-float-slow" style={{ animationDelay: '0.5s' }}>
            <div className="text-8xl sm:text-9xl" style={{ filter: 'drop-shadow(0 0 24px rgba(6,182,212,0.6)) drop-shadow(0 0 8px rgba(6,182,212,0.4))' }}>🏴</div>
          </div>
          <span className="text-4xl sm:text-5xl opacity-20 animate-float-slow" style={{ transform: 'translateY(-6px)', animationDelay: '1s' }}>⚔️</span>
        </div>
        <h2 className="text-4xl sm:text-5xl font-black bg-gradient-to-r from-cyan-300 via-blue-400 to-purple-400 bg-clip-text text-transparent tracking-wide drop-shadow-lg">{t('app.title')}</h2>
        <div className="flex items-center justify-center gap-3 opacity-80">
          <span className="w-16 h-px bg-gradient-to-r from-transparent via-slate-500 to-slate-600" />
          <span className="text-slate-400 text-sm tracking-wider font-medium">{t('app.subtitle')}</span>
          <span className="w-16 h-px bg-gradient-to-l from-transparent via-slate-500 to-slate-600" />
        </div>
      </div>

      {/* ── MENU VIEW ── */}
      {loginView === 'menu' && (
        <div className="space-y-4 animate-fade-in">
          {/* Create Game — action card */}
          <button
            onClick={() => setLoginView('create')}
            className="group w-full glass-card p-5 flex items-center gap-4 text-left transition-all duration-300 hover:scale-[1.03] hover:border-emerald-500/40 hover:shadow-emerald-900/25 hover:shadow-2xl active:scale-[1.01]"
          >
            <div className="shrink-0 w-16 h-16 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center text-2xl shadow-xl shadow-emerald-900/50 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300">
              <span className="drop-shadow-sm">🏰</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-bold text-white truncate group-hover:text-emerald-200 transition-colors">{t('login.createRoom')}</p>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">{t('login.createDesc')}</p>
            </div>
            <span className="ml-auto text-2xl text-slate-600 group-hover:text-emerald-400 group-hover:translate-x-1 transition-all duration-300">›</span>
          </button>

          {/* Join Game — action card */}
          <button
            onClick={() => setLoginView('join')}
            className="group w-full glass-card p-5 flex items-center gap-4 text-left transition-all duration-300 hover:scale-[1.03] hover:border-blue-500/40 hover:shadow-blue-900/25 hover:shadow-2xl active:scale-[1.01]"
          >
            <div className="shrink-0 w-16 h-16 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-2xl shadow-xl shadow-blue-900/50 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300">
              <span className="drop-shadow-sm">⚔️</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-bold text-white truncate group-hover:text-blue-200 transition-colors">{t('login.joinRoom')}</p>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">{t('login.joinDesc')}</p>
            </div>
            <span className="ml-auto text-2xl text-slate-600 group-hover:text-blue-400 group-hover:translate-x-1 transition-all duration-300">›</span>
          </button>
        </div>
      )}

      {/* ── CREATE VIEW ── */}
      {loginView === 'create' && (
        <div className="space-y-4 animate-fade-in">
          <div className="glass-card p-5 space-y-5 border-emerald-500/15">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/15 flex items-center justify-center text-xl">🏰</div>
              <h3 className="text-lg font-bold text-white">{t('login.createNewRoom')}</h3>
            </div>

            {/* PIN section */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-widest">
                <span className="text-sm">🔒</span> {t('login.pinOptional')}
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={createPin}
                onChange={e => setCreatePin(e.target.value.replace(/\D/g, '').slice(0, 3))}
                maxLength={3}
                placeholder="• • •"
                className="w-full px-4 py-3 bg-slate-800/80 border border-slate-600/60 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 font-mono tracking-[0.5em] text-center text-2xl transition-all"
              />
              <p className="text-[0.65rem] text-slate-500">{t('login.pinHint')}</p>
            </div>

            {/* Time slider */}
            <div className="space-y-2 pt-3 border-t border-slate-700/40">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-widest">
                <span className="text-sm">⏱️</span> {t('login.timeLimit')}
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={Math.round(timeLimit / 60)}
                  onChange={e => setTimeLimit(parseInt(e.target.value) * 60)}
                  className="flex-1 accent-emerald-500 h-2"
                />
                <span className="text-lg font-mono font-bold text-emerald-300 w-16 text-center bg-emerald-500/10 rounded-lg py-1 border border-emerald-500/20">{Math.round(timeLimit / 60)} min</span>
              </div>
              <p className="text-[0.65rem] text-slate-500">{t('login.timeLimitHint')}</p>
            </div>

            <button
              onClick={handleCreate}
              className="w-full py-3.5 bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-400 hover:to-green-400 text-white font-bold rounded-2xl transition-all hover:scale-[1.02] shadow-lg shadow-emerald-900/25 text-base"
            >
              {t('login.createRoomBtn')}
            </button>
          </div>
          <button
            onClick={() => { if (setURLRoom) setURLRoom(null); setLoginView('menu'); }}
            className="w-full py-2.5 text-slate-500 hover:text-slate-300 font-semibold transition text-sm"
          >
            ← {t('login.backToMenu')}
          </button>
        </div>
      )}

      {/* ── JOIN VIEW ── */}
      {loginView === 'join' && (
        <div className="space-y-4 animate-fade-in">
          {/* Direct code entry */}
          <div className="glass-card p-5 space-y-4 border-blue-500/15">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/15 flex items-center justify-center text-xl">🎯</div>
              <h3 className="text-base font-bold text-white">{t('login.roomCode')}</h3>
            </div>
            <input
              type="text"
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              onKeyDown={e => { if (e.key === 'Enter' && joinCode.trim()) handleJoinByCode(); }}
              maxLength={10}
              placeholder={t('login.enterCode')}
              className="w-full px-4 py-3.5 bg-slate-800/90 border-2 border-blue-500/25 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/15 font-mono tracking-[0.35em] text-center text-xl transition-all"
            />
            <div className="flex gap-2">
              <button
                onClick={() => handleJoinByCode(false)}
                disabled={!joinCode.trim() || isCheckingRoom}
                className="flex-1 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all hover:scale-[1.02] text-sm flex items-center justify-center gap-2"
              >
                {isCheckingRoom
                  ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />{t('login.checking') || 'Checking...'}</>
                  : t('login.joinAsPlayer')}
              </button>
              <button
                onClick={() => handleJoinByCode(true)}
                disabled={!joinCode.trim() || isCheckingRoom}
                className="flex-1 py-3 border border-purple-500/40 text-purple-300 hover:bg-purple-500/15 disabled:opacity-40 disabled:cursor-not-allowed font-bold rounded-xl transition-all hover:scale-[1.01] text-sm"
              >
                👁️ {t('login.spectate')}
              </button>
            </div>
          </div>

          {/* Open rooms */}
          <div className="glass-card p-4 space-y-3 border-slate-600/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm">📡</span>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">{t('login.openRooms')}</label>
              </div>
              <button
                onClick={fetchRooms}
                disabled={roomsLoading}
                className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50 transition"
              >
                {roomsLoading ? '⏳' : '🔄'} {t('login.refresh')}
              </button>
            </div>

            {roomsLoading ? (
              <div className="text-center py-6 text-slate-500 text-sm">{t('msg.loading') || 'Loading...'}</div>
            ) : rooms.length === 0 ? (
              <div className="text-center py-6 space-y-1">
                <p className="text-slate-500 text-sm">{t('msg.noRooms') || 'No open rooms'}</p>
                <p className="text-slate-600 text-xs">{t('login.noRoomsHint') || 'Create one to get started!'}</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {rooms.map(room => (
                  <div key={room.roomId} className="bg-slate-800/60 rounded-xl overflow-hidden border border-slate-700/40 transition-colors hover:border-slate-600/50">
                    <button
                      onClick={() => { setSelectedRoom(selectedRoom === room.roomId ? null : room.roomId); setJoinRoomPin(''); }}
                      className="w-full flex items-center justify-between p-3 hover:bg-slate-700/40 transition text-left"
                    >
                      <div className="min-w-0">
                        <span className="font-mono font-bold text-cyan-300 tracking-wider text-sm">{room.roomId}</span>
                        {room.hostName && <span className="text-slate-500 text-xs ml-2">{room.hostName}</span>}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        <span className="text-xs text-slate-400">👥 {room.playerCount}/{room.maxPlayers || 6}</span>
                        {room.hasPassword ? (
                          <span className="text-[0.65rem] bg-orange-500/15 text-orange-300 px-2 py-0.5 rounded-full border border-orange-500/20">🔒</span>
                        ) : (
                          <span className="text-[0.65rem] bg-green-500/15 text-green-300 px-2 py-0.5 rounded-full border border-green-500/20">{t('login.open') || 'Open'}</span>
                        )}
                      </div>
                    </button>
                    {selectedRoom === room.roomId && (
                      <div className="px-3 pb-3 pt-1 bg-slate-700/20 border-t border-slate-700/40 space-y-2">
                        <div className="flex items-center gap-2 text-xs text-slate-400 flex-wrap">
                          <span>👥 {room.playerCount}/{room.maxPlayers || 6}</span>
                          {room.spectatorCount > 0 && <span>👁️ {room.spectatorCount}</span>}
                        </div>
                        {room.hasPassword && (
                          <input
                            type="text"
                            inputMode="numeric"
                            value={joinRoomPin}
                            onChange={e => setJoinRoomPin(e.target.value.replace(/\D/g, '').slice(0, 3))}
                            maxLength={3}
                            placeholder={t('login.3digitPin') || '3-digit PIN'}
                            autoFocus
                            className="w-full px-3 py-2 bg-slate-800/80 border border-slate-600/60 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 font-mono tracking-[0.3em] text-center text-sm"
                          />
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setPendingJoin({ roomCode: room.roomId, pin: room.hasPassword ? joinRoomPin : null, spectate: false });
                              if (room.hasPassword && joinRoomPin.length !== 3) return;
                              onJoinRoom(room.roomId, false);
                            }}
                            disabled={(room.hasPassword && joinRoomPin.length !== 3) || room.playerCount >= (room.maxPlayers || 6)}
                            className="flex-1 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-lg transition text-sm"
                          >
                            {room.playerCount >= (room.maxPlayers || 6) ? (t('login.roomFull') || 'Full') : t('login.joinAsPlayer')}
                          </button>
                          <button
                            onClick={() => {
                              setPendingJoin({ roomCode: room.roomId, pin: room.hasPassword ? joinRoomPin : null, spectate: true });
                              onJoinRoom(room.roomId, true);
                            }}
                            disabled={room.hasPassword && joinRoomPin.length !== 3}
                            className="flex-1 py-2 border border-purple-500/40 text-purple-300 hover:bg-purple-500/15 disabled:opacity-40 disabled:cursor-not-allowed font-bold rounded-lg transition text-sm"
                          >
                            {t('login.spectate')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => { if (setURLRoom) setURLRoom(null); setLoginView('menu'); }}
            className="w-full py-2.5 text-slate-500 hover:text-slate-300 font-semibold transition text-sm"
          >
            ← {t('login.backToMenu')}
          </button>
        </div>
      )}

      {/* ── ENTER PIN VIEW ── */}
      {loginView === 'enterPin' && pendingJoin && (
        <div className="space-y-5 animate-fade-in">
          {/* Room info */}
          <div className="glass-card p-5 text-center space-y-2 border-blue-500/20">
            <p className="text-[0.65rem] uppercase tracking-[0.25em] text-blue-400 font-semibold">{pendingJoin.spectate ? t('login.spectatingRoom') || 'Spectating Room' : t('login.joiningRoom')}</p>
            <p className="text-3xl font-black font-mono text-cyan-300 tracking-widest" style={{ textShadow: '0 0 16px rgba(6,182,212,0.3)' }}>{pendingJoin.roomCode}</p>
          </div>

          {/* PIN entry — large individual-digit style */}
          <div className="glass-card p-6 space-y-5 border-orange-500/20 shadow-xl shadow-orange-900/10">
            <div className="text-center space-y-1.5">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-orange-500/20 to-amber-500/20 flex items-center justify-center text-2xl border border-orange-500/30 shadow-lg shadow-orange-900/20 mb-3">
                🔐
              </div>
              <h3 className="text-base font-bold text-white">{t('login.roomPin')}</h3>
              <p className="text-xs text-slate-400">{t('login.pinEnter')}</p>
            </div>

            {/* 3-digit PIN boxes with overlay input */}
            <div className="relative flex justify-center gap-3">
              {[0, 1, 2].map(i => (
                <div
                  key={i}
                  className={`w-16 h-20 rounded-xl border-2 flex items-center justify-center text-3xl font-black font-mono transition-all duration-300 pointer-events-none ${
                    pin[i]
                      ? 'bg-orange-500/15 border-orange-400/50 text-orange-300 shadow-lg shadow-orange-900/20 scale-105'
                      : i === pin.length
                        ? 'bg-slate-800/60 border-orange-500/30 text-slate-500 animate-pulse'
                        : 'bg-slate-800/40 border-slate-600/40 text-slate-600'
                  }`}
                >
                  {pin[i] || '·'}
                </div>
              ))}
              <input
                type="text"
                inputMode="numeric"
                value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 3))}
                onKeyDown={e => { if (e.key === 'Enter' && pin.length === 3) handlePinSubmit(); }}
                maxLength={3}
                autoFocus
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                aria-label="PIN input"
              />
            </div>

            {/* Progress dots */}
            <div className="flex justify-center gap-2">
              {[0, 1, 2].map(i => (
                <div
                  key={i}
                  className={`h-1 rounded-full transition-all duration-500 ${
                    i < pin.length
                      ? 'w-8 bg-gradient-to-r from-orange-400 to-amber-400'
                      : 'w-4 bg-slate-700'
                  }`}
                />
              ))}
            </div>
          </div>

          <button
            onClick={handlePinSubmit}
            disabled={pin.length !== 3}
            className={`w-full py-3.5 font-bold rounded-2xl transition-all text-base shadow-lg ${
              pin.length === 3
                ? 'bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-white hover:scale-[1.02] shadow-orange-900/30'
                : 'bg-slate-700/60 text-slate-500 cursor-not-allowed'
            }`}
          >
            {pin.length === 3 ? `🔓 ${t('login.continue')}` : `🔒 ${t('login.continue')}`}
          </button>
          <button
            onClick={goBack}
            className="w-full py-2.5 text-slate-500 hover:text-slate-300 font-semibold transition text-sm"
          >
            ← {t('login.back')}
          </button>
        </div>
      )}

      {/* ── ENTER NAME + COLOR VIEW ── */}
      {loginView === 'enterName' && pendingJoin && (
        <div className="space-y-4 animate-fade-in">
          {/* Mission brief header */}
          <div className="glass-card p-5 text-center space-y-3 border-blue-500/15">
            <p className="text-[0.65rem] uppercase tracking-[0.25em] text-blue-400 font-semibold">{pendingJoin.creating ? t('login.creatingRoom') : t('login.joiningRoom')}</p>
            {pendingJoin.roomCode && (
              <p className="text-3xl font-black font-mono text-cyan-300 tracking-widest" style={{ textShadow: '0 0 16px rgba(6,182,212,0.3)' }}>{pendingJoin.roomCode}</p>
            )}
            {pendingJoin.pin && <p className="text-xs text-green-400">🔒 PIN: <span className="font-mono font-bold">{pendingJoin.pin}</span></p>}
          </div>

          {/* Name + Color input */}
          <div className="glass-card p-5 space-y-4 border-cyan-500/15">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-cyan-500/15 flex items-center justify-center text-xl">🎖️</div>
              <div>
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-widest">{t('login.yourNickname')}</label>
                <p className="text-[0.6rem] text-slate-500 mt-0.5">{t('login.nicknameHint')}</p>
              </div>
            </div>
            <input
              type="text"
              value={playerName}
              onChange={e => setPlayerName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && playerName.trim()) handleFinalJoinClick(); }}
              maxLength={16}
              placeholder={t('login.enterNickname')}
              autoFocus
              className="w-full px-4 py-3.5 bg-slate-800/90 border-2 border-cyan-500/20 rounded-xl text-white text-lg placeholder-slate-500 focus:outline-none focus:border-cyan-400/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
            />

            {/* Color picker */}
            <div>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">
                <span className="text-sm">🎨</span> {t('login.yourColor')}
              </label>
              <div className="flex gap-2 flex-wrap">
                {PLAYER_COLORS.map((color, i) => {
                  const taken = takenColors?.includes(i);
                  return (
                    <button key={i} onClick={() => !taken && setSelectedColor(i)}
                      title={COLOR_NAMES[i]}
                      className={`w-9 h-9 rounded-full border-2 transition-all ${
                        i === selectedColor ? 'border-white scale-110 shadow-lg ring-2 ring-white/20' :
                        taken ? 'border-slate-600 opacity-30 cursor-not-allowed' :
                        'border-slate-600 hover:border-slate-400 cursor-pointer hover:scale-105'
                      }`}
                      style={{ background: color }}
                      disabled={taken}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          <button
            onClick={handleFinalJoinClick}
            disabled={!playerName.trim()}
            className="w-full py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-2xl transition-all hover:scale-[1.02] shadow-lg shadow-blue-900/30 text-base flex items-center justify-center gap-2"
          >
            {pendingJoin.creating ? t('login.createAndJoin') : t('login.joinGameBtn')}
          </button>
          <button
            onClick={goBack}
            className="w-full py-2.5 text-slate-500 hover:text-slate-300 font-semibold transition text-sm"
          >
            ← {t('login.back')}
          </button>
        </div>
      )}
    </div>
  );
});

LoginView.displayName = 'LoginView';
export default LoginView;

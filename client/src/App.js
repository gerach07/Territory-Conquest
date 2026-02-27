/* ═══════════════════════════════════════════════════════════
   Territory Conquest – App.js (React)
   Main entry – all state, socket handlers, phase rendering
   (mirrors Battleships client/src/App.js)
   ═══════════════════════════════════════════════════════════ */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import './App.css';
import useSocket from './hooks/useSocket';
import { useI18n } from './i18n/I18nContext';
import { buildWaitingData, processGameState, formatUptime, getRoomFromURL, setURLRoom } from './utils/gameHelpers';
import { TICK_MS } from './constants';
import { playSound, setSoundEnabled } from './utils/sounds';
import { playPhaseMusic } from './utils/music';

import LoginView        from './components/LoginView';
import WaitingRoom      from './components/WaitingRoom';
import GameCanvas       from './components/GameCanvas';
import GameOver         from './components/GameOver';
import ChatBox          from './components/ChatBox';
import ConnectionOverlay from './components/ConnectionOverlay';

/* ── Floating bubble background ───────────────────────────── */
const BUBBLE_COUNT = 14;

function FloatingBubbles() {
  const bubbles = useMemo(() => {
    const palette = [
      'rgba(6,182,212,0.12)',
      'rgba(139,92,246,0.12)',
      'rgba(16,185,129,0.10)',
      'rgba(236,72,153,0.10)',
      'rgba(251,191,36,0.08)',
    ];
    return Array.from({ length: BUBBLE_COUNT }, (_, i) => {
      const size = 18 + Math.random() * 60;
      return {
        key: i,
        size,
        left: `${Math.random() * 100}%`,
        duration: `${12 + Math.random() * 18}s`,
        delay: `${-Math.random() * 20}s`,
        color: palette[i % palette.length],
      };
    });
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {bubbles.map(b => (
        <div
          key={b.key}
          style={{
            position: 'absolute',
            bottom: '-20%',
            left: b.left,
            width: b.size,
            height: b.size,
            borderRadius: '50%',
            background: b.color,
            animation: `floatBubble ${b.duration} ${b.delay} infinite ease-in`,
          }}
        />
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   APP COMPONENT
   ═══════════════════════════════════════════════════════════ */
function App() {
  const { t, lang, setLang } = useI18n();
  const { socket, isConnected, serverUrl }       = useSocket();
  const urlInfo = useMemo(() => getRoomFromURL(), []);

  /* ── Phase: login | waiting | game | gameOver ── */
  const [phase, setPhase] = useState('login');

  /* ── Login sub-views: menu | create | join | enterPin | enterName ── */
  const [loginView, setLoginView] = useState(urlInfo.roomCode ? 'join' : 'menu');

  /* ── Identity & room ── */
  const [myId,         setMyId]         = useState(null);
  const [roomCode,     setRoomCode]     = useState(null);
  const [roomPassword, setRoomPassword] = useState(null);
  const [isHost,       setIsHost]       = useState(false);
  const [isSpectator,  setIsSpectator]  = useState(false);
  const [gameTimeLimit, setGameTimeLimit] = useState(null);
  const [pendingJoin,  setPendingJoin]  = useState(null);

  /* ── Waiting room players ── */
  const [waitingPlayers, setWaitingPlayers] = useState([]);
  const [takenColors,    setTakenColors]    = useState([]);

  /* ── Game state ── */
  const [gameState,      setGameState]      = useState(null);
  const [isDead,         setIsDead]         = useState(false);
  const [timeRemaining,  setTimeRemaining]  = useState(null);
  const [killFeed,       setKillFeed]       = useState([]);

  /* ── Game over ── */
  const [gameOverData,     setGameOverData]     = useState(null);
  const [playAgainPending, setPlayAgainPending] = useState(false);
  const [playAgainVotes,   setPlayAgainVotes]   = useState('');

  /* ── Chat ── */
  const [chatMessages, setChatMessages] = useState([]);
  const [chatOpen,     setChatOpen]     = useState(false);
  const [chatUnread,   setChatUnread]   = useState(0);

  /* ── UI ── */
  const [lightTheme, setLightTheme] = useState(() => localStorage.getItem('tc_theme') === 'light');
  const [soundOn,    setSoundOn]    = useState(() => localStorage.getItem('tc_sound') !== '0');
  const [toast,      setToast]      = useState(null);
  const [serverInfo, setServerInfo] = useState(null);
  const [serverInfoOpen, setServerInfoOpen] = useState(false);

  const toastTimer  = useRef(null);
  const socketRef   = useRef(null);
  const gameStateRef = useRef(null);
  const killFeedId   = useRef(0);

  // Interpolation: store previous player positions + tick timestamp
  const prevPlayersRef = useRef(null);   // positions at tick N-1
  const tickTimeRef    = useRef(0);      // when tick N arrived (performance.now())

  // Keep refs in sync
  useEffect(() => { socketRef.current = socket; }, [socket]);
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

  /* ── Theme ── */
  useEffect(() => {
    document.body.classList.toggle('light-theme', lightTheme);
    localStorage.setItem('tc_theme', lightTheme ? 'light' : 'dark');
  }, [lightTheme]);

  /* ── Sound ── */
  useEffect(() => {
    setSoundEnabled(soundOn);
    localStorage.setItem('tc_sound', soundOn ? '1' : '0');
  }, [soundOn]);

  /* ── Music ── */
  useEffect(() => {
    if (phase === 'login')      playPhaseMusic('menu');
    else if (phase === 'waiting') playPhaseMusic('waiting');
    else if (phase === 'game')    playPhaseMusic('game');
  }, [phase]);

  /* ── Toast ── */
  const showToast = useCallback((msg, icon = 'ℹ️', duration = 4000) => {
    setToast({ msg, icon });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), duration);
  }, []);

  /* ── Server health polling ── */
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/health');
        const data = await res.json();
        setServerInfo(data);
      } catch { setServerInfo(null); }
    };
    poll();
    const id = setInterval(poll, 15000);
    return () => clearInterval(id);
  }, []);

  /* ── URL room code ── */
  useEffect(() => {
    if (!urlInfo.roomCode || !serverUrl) return;
    const ac = new AbortController();
    fetch(`${serverUrl}/rooms/${urlInfo.roomCode}`, { signal: ac.signal })
      .then(r => r.json().catch(() => ({ exists: false })))
      .then(data => {
        if (!data.exists) {
          showToast(t('msg.roomNotFound'), '❌');
          setURLRoom(null);
          setLoginView('menu');
        } else {
          // Room exists – pre-fill join flow
          const pin = urlInfo.password || null;
          setPendingJoin({ roomCode: urlInfo.roomCode, pin, spectate: false });
          if (data.hasPassword && !pin) {
            setLoginView('enterPin');
          } else {
            setLoginView('enterName');
          }
        }
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setURLRoom(null);
          setLoginView('menu');
        }
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl]);

  /* ═══════════════════════════════════════════
     SOCKET HANDLERS
     ═══════════════════════════════════════════ */
  useEffect(() => {
    if (!socket) return;

    const onConnect = () => { setMyId(socket.id); };

    const onGameJoined = (data) => {
      const roomCode = data.roomId;
      const roomPwd  = data.password || null;
      setRoomCode(roomCode);
      setIsHost(data.isHost);
      setMyId(data.playerId);
      setIsSpectator(false);
      setRoomPassword(roomPwd);
      setURLRoom(roomCode, roomPwd);
      setGameTimeLimit(data.timeLimit || 180);
      const wd = buildWaitingData(data, data.roomId, data.timeLimit || 180);
      setWaitingPlayers(wd.players);
      setPhase('waiting');
      showToast(t('msg.joinedRoom', data.roomId), '✅');
      playSound('join');
    };

    const onSpectatorJoined = (data) => {
      setRoomCode(data.roomId);
      setIsSpectator(true);
      if (data.chatHistory) {
        setChatMessages(data.chatHistory);
      }
      if (data.state === 'playing' && data.gameState) {
        const gs = processGameState(data.gameState, data.grid, null);
        setGameState(gs);
        setPhase('game');
        showToast(t('msg.spectating', data.roomId), '👁️');
      } else if (data.state === 'finished' && data.gameOverData) {
        setGameOverData(data.gameOverData);
        setPhase('gameOver');
        showToast(t('msg.spectating', data.roomId), '👁️');
      } else {
        setPhase('waiting');
        showToast(t('msg.spectating', data.roomId), '👁️');
      }
    };

    const onPlayerJoined = (data) => {
      const wd = buildWaitingData(data, roomCode, gameTimeLimit);
      setWaitingPlayers(wd.players);
    };

    const onPlayerLeft = (data) => {
      const wd = buildWaitingData(data, roomCode, gameTimeLimit);
      setWaitingPlayers(wd.players);
      if (data.playerName) showToast(t('msg.leftRoom', data.playerName), '👋', 2500);
    };

    const onPlayerKicked = (data) => {
      const wd = buildWaitingData(data, roomCode, gameTimeLimit);
      setWaitingPlayers(wd.players);
      showToast(t('msg.playerKicked'), '⛔', 2000);
    };

    const onGameStarted = (data) => {
      const gs = processGameState(data.gameState, data.grid, null);
      setGameState(gs);
      setGameTimeLimit(data.timeLimit || 180);
      setPhase('game');
      setIsDead(false);
      setKillFeed([]);
      showToast(t('msg.gameStarted'), '🎮', 2000);
      playSound('start');
    };

    const onGameState = (state) => {
      // Snapshot previous positions for interpolation
      const prevGs = gameStateRef.current;
      if (prevGs?.players) {
        const snap = {};
        prevGs.players.forEach(p => { snap[p.id] = { x: p.x, y: p.y }; });
        prevPlayersRef.current = snap;
      }
      tickTimeRef.current = performance.now();

      const gs = processGameState(state, null, prevGs?.grid);
      setGameState(gs);

      if (state.timeRemaining !== undefined) {
        setTimeRemaining(state.timeRemaining);
      }

      // Events (kills, respawns, forfeits)
      if (state.events) {
        state.events.forEach(evt => {
          if (evt.type === 'kill') {
            const victim = gs.players.find(p => p.id === evt.victim);
            const killer = evt.killer ? gs.players.find(p => p.id === evt.killer) : null;
            const vName = victim?.name || 'Unknown';
            const kName = killer?.name || (evt.reason === 'boundary' ? 'Border' : 'Themselves');
            setKillFeed(prev => {
              const newFeed = [...prev, { id: ++killFeedId.current, killer: kName, victim: vName }];
              return newFeed.slice(-5);
            });
            setTimeout(() => {
              setKillFeed(prev => prev.filter(kf => kf.id !== killFeedId.current));
            }, 5000);

            if (evt.victim === socket.id) {
              setIsDead(true);
              playSound('death');
            } else {
              playSound('kill');
            }
          }
          if (evt.type === 'respawn' && evt.playerId === socket.id) {
            setIsDead(false);
          }
          if (evt.type === 'forfeit') {
            const fName = evt.playerName || 'Player';
            setKillFeed(prev => {
              const newFeed = [...prev, { id: ++killFeedId.current, killer: fName, victim: t('game.surrendered') }];
              return newFeed.slice(-5);
            });
          }
        });
      }
    };

    const onGameOver = (data) => {
      setGameOverData(data);
      setPhase('gameOver');
      setPlayAgainPending(false);
      setPlayAgainVotes('');
      const isWinner = data.winnerId === socket.id;
      playSound(isWinner ? 'victory' : 'defeat');
    };

    const onPlayAgainVote = (data) => {
      showToast(t('gameover.rematchOffer', data.playerName), '🔄', 3000);
      setPlayAgainVotes(`${data.votes?.length || 0}/${data.totalPlayers || '?'}`);
    };

    const onPlayAgainDeclined = (data) => {
      showToast(t('msg.playAgainDeclined', data.playerName), '🚫', 3000);
    };

    const onGameReset = (data) => {
      setGameState(null);
      setGameOverData(null);
      setIsDead(false);
      setKillFeed([]);
      setIsHost(data.hostId === socket.id);
      const wd = buildWaitingData(data, roomCode, gameTimeLimit);
      setWaitingPlayers(wd.players);
      setPhase('waiting');
      showToast(t('msg.newGame'), '🎮');
    };

    const onChatMessage = (msg) => {
      setChatMessages(prev => {
        const updated = [...prev, msg];
        return updated.slice(-100);
      });
      if (!chatOpen) setChatUnread(prev => prev + 1);
      playSound('chat');
    };

    const onRoomClosed = ()  => { resetToMenu(); showToast(t('msg.roomClosed'), '🚪'); };
    const onKicked     = ()  => { resetToMenu(); showToast(t('msg.kicked'), '⛔'); };
    const onLeftRoom   = ()  => { /* silent */ };
    const onError      = (d) => { showToast(d.error || d.message || 'Error', '❌'); };

    socket.on('connect',          onConnect);
    socket.on('gameJoined',       onGameJoined);
    socket.on('spectatorJoined',  onSpectatorJoined);
    socket.on('playerJoined',     onPlayerJoined);
    socket.on('playerLeft',       onPlayerLeft);
    socket.on('playerKicked',     onPlayerKicked);
    socket.on('gameStarted',      onGameStarted);
    socket.on('gameState',        onGameState);
    socket.on('gameOver',         onGameOver);
    socket.on('playAgainVote',    onPlayAgainVote);
    socket.on('playAgainDeclined', onPlayAgainDeclined);
    socket.on('gameReset',        onGameReset);
    socket.on('chatMessage',      onChatMessage);
    socket.on('roomClosed',       onRoomClosed);
    socket.on('kicked',           onKicked);
    socket.on('leftRoom',         onLeftRoom);
    socket.on('error',            onError);

    return () => {
      socket.off('connect',          onConnect);
      socket.off('gameJoined',       onGameJoined);
      socket.off('spectatorJoined',  onSpectatorJoined);
      socket.off('playerJoined',     onPlayerJoined);
      socket.off('playerLeft',       onPlayerLeft);
      socket.off('playerKicked',     onPlayerKicked);
      socket.off('gameStarted',      onGameStarted);
      socket.off('gameState',        onGameState);
      socket.off('gameOver',         onGameOver);
      socket.off('playAgainVote',    onPlayAgainVote);
      socket.off('playAgainDeclined', onPlayAgainDeclined);
      socket.off('gameReset',        onGameReset);
      socket.off('chatMessage',      onChatMessage);
      socket.off('roomClosed',       onRoomClosed);
      socket.off('kicked',           onKicked);
      socket.off('leftRoom',         onLeftRoom);
      socket.off('error',            onError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, showToast, t]);

  /* ═══════════════════════════════════════════
     ACTION HANDLERS
     ═══════════════════════════════════════════ */

  const resetToMenu = useCallback(() => {
    setRoomCode(null);
    setRoomPassword(null);
    setIsHost(false);
    setIsSpectator(false);
    setGameState(null);
    setGameOverData(null);
    setIsDead(false);
    setKillFeed([]);
    setChatMessages([]);
    setChatUnread(0);
    setPlayAgainPending(false);
    setWaitingPlayers([]);
    setPhase('login');
    setLoginView('menu');
    setURLRoom(null);
  }, []);

  /* ── Join / Create ── */
  const handleJoinRoom = useCallback(async (code, spectate) => {
    try {
      const res  = await fetch(`/rooms/${code}`);
      const data = await res.json();
      if (!data.exists) { showToast(t('msg.roomNotFound'), '❌'); return; }

      if (data.hasPassword && !spectate) {
        setPendingJoin(prev => ({ ...prev, roomCode: code, spectate }));
        setLoginView('enterPin');
      } else if (spectate) {
        socketRef.current?.emit('joinGame', { gameId: code, isSpectating: true });
      } else {
        setPendingJoin(prev => ({ ...prev, roomCode: code, spectate }));
        setLoginView('enterName');
        // Fetch taken colors
        if (data.takenColors) setTakenColors(data.takenColors);
      }
    } catch {
      showToast(t('msg.serverUnreachable'), '❌');
    }
  }, [showToast, t]);

  const handleSpectate = useCallback((code, pin) => {
    socketRef.current?.emit('joinGame', { gameId: code, password: pin || undefined, isSpectating: true });
  }, []);

  const handleFinalJoin = useCallback((name, colorIndex) => {
    if (!pendingJoin) return;
    if (pendingJoin.creating) {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code = '';
      for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
      socketRef.current?.emit('joinGame', {
        gameId:     code,
        playerName: name,
        colorIndex,
        isCreating: true,
        password:   pendingJoin.pin || undefined,
        timeLimit:  pendingJoin.timeLimit || undefined,
      });
    } else {
      socketRef.current?.emit('joinGame', {
        gameId:       pendingJoin.roomCode,
        password:     pendingJoin.pin || undefined,
        playerName:   name,
        colorIndex,
        isSpectating: false,
      });
    }
  }, [pendingJoin]);

  /* ── Waiting room actions ── */
  const handleStartGame = useCallback(() => {
    socketRef.current?.emit('hostStartGame');
  }, []);

  const handleKickPlayer = useCallback((targetId) => {
    socketRef.current?.emit('kickPlayer', { targetId });
  }, []);

  const handleBackToMenu = useCallback(() => {
    socketRef.current?.emit('leaveRoom');
    resetToMenu();
  }, [resetToMenu]);

  /* ── Game actions ── */
  const handleDirectionChange = useCallback((dir) => {
    socketRef.current?.emit('changeDirection', { direction: dir });

    // Client-side prediction: immediately update own player direction + position
    const gs = gameStateRef.current;
    if (!gs?.players) return;
    const meIdx = gs.players.findIndex(p => p.id === socketRef.current?.id);
    if (meIdx === -1) return;
    const me = gs.players[meIdx];
    if (!me.alive) return;

    const opposites = { up: 'down', down: 'up', left: 'right', right: 'left' };
    if (opposites[me.direction] === dir) return; // server would reject this

    const dirs = { up: { dx: 0, dy: -1 }, down: { dx: 0, dy: 1 }, left: { dx: -1, dy: 0 }, right: { dx: 1, dy: 0 } };
    const d = dirs[dir];
    if (!d) return;

    const updated = [...gs.players];
    updated[meIdx] = { ...me, direction: dir };
    setGameState({ ...gs, players: updated });
  }, []);

  const handleSurrender = useCallback(() => {
    if (window.confirm(t('game.surrenderConfirm'))) {
      socketRef.current?.emit('forfeit');
    }
  }, [t]);

  /* ── Game over actions ── */
  const handlePlayAgain = useCallback(() => {
    socketRef.current?.emit('requestPlayAgain');
    setPlayAgainPending(true);
  }, []);

  const handleDeclinePlayAgain = useCallback(() => {
    socketRef.current?.emit('declinePlayAgain');
    resetToMenu();
  }, [resetToMenu]);

  /* ── Chat ── */
  const handleSendChat = useCallback((message) => {
    socketRef.current?.emit('sendChat', { message });
  }, []);

  const toggleChat = useCallback(() => {
    setChatOpen(prev => {
      if (!prev) setChatUnread(0);
      return !prev;
    });
  }, []);

  /* ── Derived display name (from localStorage) ── */
  const playerName = localStorage.getItem('tc_playerName') || '';

  /* ═══════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════ */
  const showChat = phase === 'waiting' || phase === 'game' || phase === 'gameOver';

  return (
    <div className={`min-h-screen theme-bg text-white ${lightTheme ? 'light-theme' : ''}`}>
      <FloatingBubbles />
      <ConnectionOverlay isConnected={isConnected} />

      {/* ── Header ── */}
      <header className="theme-header bg-slate-900/80 backdrop-blur-xl border-b border-slate-700/60 shadow-lg relative z-20" role="banner">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 py-2 flex items-center justify-between gap-2 relative">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xl sm:text-2xl drop-shadow-lg">🏴</span>
            <h1 className="text-base sm:text-lg font-black tracking-tight leading-none text-white truncate">{t('app.title')}</h1>
            {phase !== 'login' && roomCode && (
              <span className="hidden sm:inline text-[0.6rem] text-yellow-300 font-mono tracking-wider bg-yellow-500/10 px-2 py-0.5 rounded-full border border-yellow-500/20">{roomCode}</span>
            )}
          </div>
          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            <select
              value={lang}
              onChange={e => setLang(e.target.value)}
              className="bg-white/5 text-white text-[0.65rem] rounded-lg px-1 py-1 border border-white/10 cursor-pointer hover:bg-white/10 transition w-[4.5rem]"
              title={t('app.language')}
              aria-label={t('app.language')}
            >
              <option value="en" className="bg-slate-800">🇬🇧 EN</option>
              <option value="lv" className="bg-slate-800">🇱🇻 LV</option>
              <option value="ru" className="bg-slate-800">🇷🇺 RU</option>
            </select>
            <div className="flex items-center bg-white/5 rounded-lg border border-white/10" role="group" aria-label="Audio and theme controls">
              <button onClick={() => setSoundOn(!soundOn)} className="p-1.5 hover:bg-white/10 rounded-l-lg active:scale-95 transition text-base" title={soundOn ? t('app.muteSound') : t('app.unmuteSound')} aria-label={soundOn ? t('app.muteSound') : t('app.unmuteSound')}>
                {soundOn ? '🔊' : '🔇'}
              </button>
              <button onClick={() => setLightTheme(!lightTheme)} className="p-1.5 hover:bg-white/10 rounded-r-lg active:scale-95 transition text-base" title={t('app.toggleTheme')} aria-label={t('app.toggleTheme')}>
                {lightTheme ? '🌙' : '☀️'}
              </button>
            </div>
            <div className="relative">
              <button
                onClick={() => setServerInfoOpen(o => !o)}
                className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-[0.65rem] font-semibold cursor-pointer transition border ${isConnected ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20' : 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20'}`}
                title={t('serverInfo.title')}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
                <span className="hidden sm:inline">{isConnected ? t('app.online') : t('app.offline')}</span>
              </button>
            </div>
            {phase !== 'login' && playerName && (
              <span className="hidden sm:block text-xs font-bold text-slate-300 max-w-[6rem] truncate" title={playerName}>{playerName}</span>
            )}
          </div>
        </div>
      </header>

      {/* ── Server info dropdown ── */}
      {serverInfoOpen && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setServerInfoOpen(false)} />
          <div className="absolute top-14 right-4 z-30 glass-card p-4 w-64 space-y-2 animate-fade-in">
            <h3 className="text-sm font-bold text-slate-300">{t('serverInfo.title')}</h3>
            {serverInfo ? (
              <div className="text-xs space-y-1 text-slate-400">
                {serverInfo.version  && <p>Version: v{serverInfo.version}</p>}
                {serverInfo.rooms !== undefined    && <p>{t('serverInfo.rooms')}: {serverInfo.rooms}</p>}
                {serverInfo.players !== undefined  && <p>{t('serverInfo.players')}: {serverInfo.players}</p>}
                {serverInfo.uptime !== undefined    && <p>{t('serverInfo.uptime')}: {formatUptime(serverInfo.uptime)}</p>}
                {serverInfo.nodeVersion            && <p>{t('serverInfo.node')}: {serverInfo.nodeVersion}</p>}
                {serverInfo.memoryMB !== undefined  && <p>{t('serverInfo.memory')}: {serverInfo.memoryMB} MB</p>}
              </div>
            ) : (
              <p className="text-xs text-red-400">{t('app.offline')}</p>
            )}
          </div>
        </>
      )}

      {/* ── Main content ── */}
      <main className={`relative z-10 ${phase !== 'game' ? 'flex items-center justify-center min-h-[calc(100vh-56px)]' : ''}`}>

        {/* LOGIN */}
        {phase === 'login' && (
          <LoginView
            loginView={loginView}
            setLoginView={setLoginView}
            onCreateRoom={() => {}}
            onJoinRoom={handleJoinRoom}
            onSpectate={handleSpectate}
            onFinalJoin={handleFinalJoin}
            pendingJoin={pendingJoin}
            setPendingJoin={setPendingJoin}
            takenColors={takenColors}
            serverUrl={serverUrl}
            setURLRoom={setURLRoom}
          />
        )}

        {/* WAITING */}
        {phase === 'waiting' && (
          <WaitingRoom
            roomCode={roomCode}
            roomPassword={roomPassword}
            players={waitingPlayers}
            isHost={isHost}
            myId={myId}
            timeLimit={gameTimeLimit}
            handleStartGame={handleStartGame}
            handleKickPlayer={handleKickPlayer}
            handleBackToMenu={handleBackToMenu}
          />
        )}

        {/* GAME */}
        {phase === 'game' && (
          <GameCanvas
            gameState={gameState}
            myId={myId}
            isSpectator={isSpectator}
            isDead={isDead}
            onDirectionChange={handleDirectionChange}
            onSurrender={handleSurrender}
            timeRemaining={timeRemaining}
            killFeed={killFeed}
            lightTheme={lightTheme}
            prevPlayers={prevPlayersRef}
            tickTime={tickTimeRef}
          />
        )}

        {/* GAME OVER */}
        {phase === 'gameOver' && (
          <GameOver
            gameOverData={gameOverData}
            myId={myId}
            isSpectator={isSpectator}
            playAgainPending={playAgainPending}
            playAgainVotes={playAgainVotes}
            handlePlayAgain={handlePlayAgain}
            handleDeclinePlayAgain={handleDeclinePlayAgain}
            handleBackToMenu={handleBackToMenu}
          />
        )}
      </main>

      {/* ── Chat ── */}
      {showChat && (
        <ChatBox
          messages={chatMessages}
          onSend={handleSendChat}
          isOpen={chatOpen}
          onToggle={toggleChat}
          unread={chatUnread}
          myId={myId}
        />
      )}

      {/* ── Toast ── */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl glass-card border-slate-600/40 shadow-xl flex items-center gap-2 animate-slide-up"
          onClick={() => setToast(null)}>
          <span className="text-lg">{toast.icon}</span>
          <span className="text-sm text-white font-medium">{toast.msg}</span>
        </div>
      )}

      {/* ── Footer ── */}
      <footer className="max-w-5xl mx-auto px-3 sm:px-6 py-2.5 text-center mt-auto relative z-10" role="contentinfo">
        <p className="text-[0.55rem] text-slate-600">{t('app.footer')}</p>
      </footer>
    </div>
  );
}

export default App;

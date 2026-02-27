/* ═══════════════════════════════════════════════════════════
   Territory Conquest – App.js (React)
   Main entry – all state, socket handlers, phase rendering
   (mirrors Battleships client/src/App.js)
   ═══════════════════════════════════════════════════════════ */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import './App.css';
import useSocket from './hooks/useSocket';
import { useI18n } from './i18n/I18nContext';
import { buildWaitingData, processGameState, formatUptime, getRoomFromURL, setURLRoom } from './utils/gameHelpers';
import { playSound, setSoundEnabled } from './utils/sounds';
import { playPhaseMusic } from './utils/music';
import { TICK_MS, GRID_SIZE } from './constants';

import LoginView        from './components/LoginView';
import WaitingRoom      from './components/WaitingRoom';
import GameCanvas       from './components/GameCanvas';
import GameOver         from './components/GameOver';
import ChatBox          from './components/ChatBox';
import ConnectionOverlay from './components/ConnectionOverlay';

// Direction vectors for local simulation
const DIR_V = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

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
  const [allowSpectators, setAllowSpectators] = useState(true);
  const [gameTimeLimit, setGameTimeLimit] = useState(null);
  const [pendingJoin,  setPendingJoin]  = useState(null);
  const [playerNameDisplay, setPlayerNameDisplay] = useState(() => localStorage.getItem('tc_playerName') || '');

  /* ── Waiting room players ── */
  const [waitingPlayers, setWaitingPlayers] = useState([]);
  const [takenColors,    setTakenColors]    = useState([]);

  /* ── Game state ── */
  const [gameState,      setGameState]      = useState(null);
  const [isDead,         setIsDead]         = useState(false);
  const [deathTime,      setDeathTime]      = useState(null);
  const [timeRemaining,  setTimeRemaining]  = useState(null);
  const [killFeed,       setKillFeed]       = useState([]);

  /* ── Game over ── */
  const [gameOverData,     setGameOverData]     = useState(null);
  const [playAgainPending, setPlayAgainPending] = useState(false);
  const [playAgainStatus,  setPlayAgainStatus]  = useState(null); // { players: [{id, name, colorIndex, status}], votedCount, totalPlayers }

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
  const serverInfoBtnRef = useRef(null);

  const toastTimer  = useRef(null);
  const socketRef   = useRef(null);
  const gameStateRef = useRef(null);
  const killFeedId   = useRef(0);
  const roomCodeRef     = useRef(null);
  const gameTimeLimitRef = useRef(null);
  const phaseRef        = useRef('login');
  const chatOpenRef     = useRef(false);
  const roomPasswordRef = useRef(null);

  // Interpolation: store previous player positions + tick timestamp
  const prevPlayersRef = useRef(null);   // positions at tick N-1
  const tickTimeRef    = useRef(0);      // when tick N arrived (performance.now())
  const lastServerSeqRef = useRef(0);

  // ── Local simulation for own player ──
  // Runs at the same 10Hz tick rate as the server, moving 1 cell per tick.
  // This produces discrete positions that exactly match server movement,
  // eliminating drift from continuous time-based extrapolation.
  // GameCanvas interpolates between localSim.prevX/Y and localSim.x/y
  // at 60fps for smooth visuals.
  const localSimRef = useRef({
    x: 0, y: 0,         // current sim position (integer cells)
    prevX: 0, prevY: 0, // position at previous local tick
    direction: 'right',  // current direction
    pendingDir: null,    // direction change server hasn't confirmed yet
    tickTime: 0,        // performance.now() of last local tick
    alive: false,
    active: false,
  });

  // Keep refs in sync (consolidated into fewer effects)
  useEffect(() => { socketRef.current = socket; }, [socket]);
  useEffect(() => {
    gameStateRef.current = gameState;
    roomCodeRef.current = roomCode;
    gameTimeLimitRef.current = gameTimeLimit;
    phaseRef.current = phase;
    chatOpenRef.current = chatOpen;
    roomPasswordRef.current = roomPassword;
  }, [gameState, roomCode, gameTimeLimit, phase, chatOpen, roomPassword]);

  /* ── Kill feed cleanup interval (only active during game phase) ── */
  useEffect(() => {
    if (phase !== 'game') return;
    const killFeedCleanup = setInterval(() => {
      const now = Date.now();
      setKillFeed(prev => prev.filter(kf => now - kf.timestamp < 5000));
    }, 1000);
    return () => clearInterval(killFeedCleanup);
  }, [phase]);

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

  /* ── Local simulation loop (10Hz, matching server tick rate) ── */
  useEffect(() => {
    const sim = localSimRef.current;
    if (phase !== 'game' || isSpectator) {
      sim.active = false;
      return;
    }
    // Initialize sim from current gameState
    const gs = gameStateRef.current;
    const myId = socketRef.current?.id;
    if (gs?.players && myId) {
      const me = gs.players.find(p => p.id === myId);
      if (me) {
        sim.x = me.x; sim.y = me.y;
        sim.prevX = me.x; sim.prevY = me.y;
        sim.direction = me.direction || 'right';
        sim.alive = me.alive;
        sim.tickTime = performance.now();
      }
    }
    sim.active = true;
    sim.pendingDir = null;

    const interval = setInterval(() => {
      if (!sim.active || !sim.alive) return;
      // Save previous position for interpolation
      sim.prevX = sim.x;
      sim.prevY = sim.y;
      sim.tickTime = performance.now();
      // Advance 1 cell in current direction (matches server exactly)
      const dv = DIR_V[sim.direction];
      if (dv) {
        sim.x = clamp(sim.x + dv[0], 0, GRID_SIZE - 1);
        sim.y = clamp(sim.y + dv[1], 0, GRID_SIZE - 1);
      }
    }, TICK_MS);

    return () => clearInterval(interval);
  }, [phase, isSpectator]);

  /* ── Server health polling (pauses when tab is hidden) ── */
  useEffect(() => {
    if (!serverUrl) return;
    let intervalId;
    const poll = async () => {
      try {
        const res = await fetch(`${serverUrl}/health`);
        const data = await res.json();
        setServerInfo(data);
      } catch { setServerInfo(null); }
    };
    const startPolling = () => { poll(); intervalId = setInterval(poll, phase === 'game' ? 60000 : 15000); };
    const stopPolling = () => { clearInterval(intervalId); };
    const onVisibility = () => { document.hidden ? stopPolling() : startPolling(); };
    startPolling();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stopPolling(); document.removeEventListener('visibilitychange', onVisibility); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl]);

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
        } else if (data.state === 'finished') {
          // Game already ended
          showToast(t('msg.gameEnded') || 'Game has ended', '🏁');
          setURLRoom(null);
          setLoginView('menu');
        } else if (data.state === 'playing') {
          // Game in progress — spectate only
          if (!data.allowSpectators) {
            showToast(t('msg.spectatorsDisabled') || 'Spectators not allowed', '🚫');
            setURLRoom(null);
            setLoginView('menu');
            return;
          }
          const pin = urlInfo.password || null;
          if (data.hasPassword && !pin) {
            setPendingJoin({ roomCode: urlInfo.roomCode, pin: null, spectate: true });
            setLoginView('enterPin');
            showToast(t('msg.gameInProgressSpectate') || 'Game in progress — joining as spectator', '👁️');
          } else {
            // No password or PIN provided in URL — auto spectate
            showToast(t('msg.gameInProgressSpectate') || 'Game in progress — joining as spectator', '👁️');
            socketRef.current?.emit('joinGame', {
              gameId: urlInfo.roomCode,
              password: pin || undefined,
              isSpectating: true,
            });
          }
        } else {
          // WAITING — normal join flow
          if (data.takenColors) setTakenColors(data.takenColors);
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
      setAllowSpectators(data.allowSpectators !== false);
      const wd = buildWaitingData(data, data.roomId, data.timeLimit || 180);
      setWaitingPlayers(wd.players);
      setPhase('waiting');
      showToast(t('msg.joinedRoom', data.roomId), '✅');
      playSound('join');
    };

    const onSpectatorJoined = (data) => {
      setRoomCode(data.roomId);
      setIsSpectator(true);
      setAllowSpectators(data.allowSpectators !== false);
      if (data.chatHistory) {
        setChatMessages(data.chatHistory);
      }
      if (data.state === 'playing' && data.gameState) {
        const gs = processGameState(data.gameState, data.grid, null);
        gameStateRef.current = gs;
        setGameState(gs);
        setPhase('game');
        showToast(t('msg.spectating', data.roomId), '👁️');
      } else if (data.state === 'finished' && data.gameOverData) {
        setGameOverData(data.gameOverData);
        setPhase('gameOver');
        showToast(t('msg.spectating', data.roomId), '👁️');
      } else {
        // WAITING — populate player list so slots render correctly
        if (data.players) {
          const wd = buildWaitingData(data, data.roomId, data.timeLimit);
          setWaitingPlayers(wd.players);
        }
        setPhase('waiting');
        showToast(t('msg.spectating', data.roomId), '👁️');
      }
    };

    const onPlayerJoined = (data) => {
      const wd = buildWaitingData(data, roomCodeRef.current, gameTimeLimitRef.current);
      setWaitingPlayers(wd.players);
      if (data.takenColors) setTakenColors(data.takenColors);
    };

    const onPlayerLeft = (data) => {
      const wd = buildWaitingData(data, roomCodeRef.current, gameTimeLimitRef.current);
      setWaitingPlayers(wd.players);
      if (data.hostId) setIsHost(data.hostId === socket.id);
      if (data.playerName) showToast(t('msg.leftRoom', data.playerName), '👋', 2500);
    };

    const onPlayerKicked = (data) => {
      const wd = buildWaitingData(data, roomCodeRef.current, gameTimeLimitRef.current);
      setWaitingPlayers(wd.players);
      if (data.takenColors) setTakenColors(data.takenColors);
      showToast(t('msg.playerKicked'), '⛔', 2000);
    };

    const onGameStarted = (data) => {
      const gs = processGameState(data.gameState, data.grid, null);
      gameStateRef.current = gs;
      setGameState(gs);
      lastServerSeqRef.current = 0;
      // Initialize local sim from game start positions
      const sim = localSimRef.current;
      const myId = socketRef.current?.id;
      if (gs?.players && myId) {
        const me = gs.players.find(p => p.id === myId);
        if (me) {
          sim.x = me.x; sim.y = me.y;
          sim.prevX = me.x; sim.prevY = me.y;
          sim.direction = me.direction || 'right';
          sim.alive = me.alive;
          sim.tickTime = performance.now();
          sim.pendingDir = null;
          sim.active = true;
        }
      }
      setGameTimeLimit(data.timeLimit || 180);
      setPhase('game');
      setIsDead(false);
      setKillFeed([]);
      showToast(t('msg.gameStarted'), '🎮', 2000);
      playSound('start');
    };

    const onGameState = (state) => {
      const seq = Number.isFinite(state?.seq) ? state.seq : null;
      if (seq !== null && seq <= lastServerSeqRef.current) {
        return;
      }
      if (seq !== null) {
        lastServerSeqRef.current = seq;
      }

      const prevGs = gameStateRef.current;
      const myId = socketRef.current?.id;
      const now = performance.now();

      // Snapshot previous positions for OTHER players' interpolation
      if (prevGs?.players) {
        const snap = {};
        prevGs.players.forEach(p => { snap[p.id] = { x: p.x, y: p.y }; });
        prevPlayersRef.current = snap;
      }
      tickTimeRef.current = now;

      const gs = processGameState(state, null, prevGs?.grid);

      // ── Reconcile local simulation with server authority ──
      const sim = localSimRef.current;
      if (gs.players && myId && sim.active) {
        const meIdx = gs.players.findIndex(p => p.id === myId);
        if (meIdx !== -1) {
          const serverMe = gs.players[meIdx];

          if (!serverMe.alive) {
            // Server says we're dead
            sim.alive = false;
          } else {
            sim.alive = true;
            const dist = Math.abs(serverMe.x - sim.x) + Math.abs(serverMe.y - sim.y);

            if (sim.pendingDir) {
              // We have a pending direction change
              if (serverMe.direction === sim.pendingDir) {
                // Server confirmed! Clear pending flag.
                sim.pendingDir = null;
                // If within 2 cells, nudge toward server. Otherwise snap.
                if (dist <= 2) {
                  // Blend: move halfway toward server position
                  sim.x = Math.round(sim.x + (serverMe.x - sim.x) * 0.5);
                  sim.y = Math.round(sim.y + (serverMe.y - sim.y) * 0.5);
                } else {
                  sim.x = serverMe.x; sim.y = serverMe.y;
                  sim.prevX = serverMe.x; sim.prevY = serverMe.y;
                }
              }
              // else: stale tick, server still shows old direction — ignore position
            } else {
              // No pending change — adopt server direction always
              sim.direction = serverMe.direction;
              if (dist > 3) {
                // Large discrepancy (respawn/teleport) — snap immediately
                sim.x = serverMe.x; sim.y = serverMe.y;
                sim.prevX = serverMe.x; sim.prevY = serverMe.y;
              } else if (dist > 0) {
                // Small drift — blend toward server (1 cell per tick max)
                const dx = serverMe.x - sim.x;
                const dy = serverMe.y - sim.y;
                if (Math.abs(dx) > Math.abs(dy)) {
                  sim.x += Math.sign(dx);
                } else if (dy !== 0) {
                  sim.y += Math.sign(dy);
                }
              }
            }
          }
        }
      }

      gameStateRef.current = gs;
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
              const newFeed = [...prev, { id: ++killFeedId.current, killer: kName, victim: vName, timestamp: Date.now() }];
              return newFeed.slice(-5);
            });

            if (evt.victim === socket.id) {
              setIsDead(true);
              setDeathTime(Date.now());
              localSimRef.current.alive = false;
              playSound('death');
            } else {
              playSound('kill');
            }
          }
          if (evt.type === 'respawn' && evt.playerId === socket.id) {
            setIsDead(false);
            setDeathTime(null);
            // Sim will be re-initialized by next server tick (alive=true path)
          }
          if (evt.type === 'forfeit' || evt.type === 'leave') {
            const fName = evt.playerName || 'Player';
            setKillFeed(prev => {
              const newFeed = [...prev, { id: ++killFeedId.current, killer: fName, victim: t('game.leftGame'), timestamp: Date.now() }];
              return newFeed.slice(-5);
            });
          }
        });
      }
    };

    const onGameOver = (data) => {
      localSimRef.current.active = false;
      setGameOverData(data);
      setPhase('gameOver');
      setPlayAgainPending(false);
      setPlayAgainStatus(null);
      const isWinner = data.winnerId === socket.id;
      playSound(isWinner ? 'victory' : 'defeat');
    };

    const onPlayAgainVote = (data) => {
      // data: { players: [{id, name, colorIndex, status}], votedCount, totalPlayers, leftPlayer? }
      setPlayAgainStatus(data);
      // Show toast for the player who just voted/declined
      if (data.leftPlayer) {
        showToast(t('gameover.playerLeft', data.leftPlayer.name), '👋', 3000);
      }
    };

    const onPlayerDisconnected = (data) => {
      // During game over, update play-again status when someone leaves
      if (data.playAgainStatus) {
        setPlayAgainStatus(data.playAgainStatus);
        showToast(t('gameover.playerLeft', data.playerName), '👋', 3000);
      } else if (data.playerName) {
        showToast(t('msg.playerDisconnected', data.playerName), '📡', 3000);
      }
    };

    const onGameReset = (data) => {
      gameStateRef.current = null;
      setGameState(null);
      lastServerSeqRef.current = 0;
      localSimRef.current.active = false;
      localSimRef.current.pendingDir = null;
      setGameOverData(null);
      setIsDead(false);
      setKillFeed([]);
      setIsHost(data.hostId === socket.id);
      setAllowSpectators(data.allowSpectators !== false);
      const wd = buildWaitingData(data, roomCodeRef.current, gameTimeLimitRef.current);
      setWaitingPlayers(wd.players);
      setPhase('waiting');
      showToast(t('msg.newGame'), '🎮');
    };

    const onSpectatorsToggled = (data) => {
      setAllowSpectators(data.allowSpectators);
    };

    const onHostChanged = (data) => {
      const amNewHost = data.hostId === socket.id;
      setIsHost(amNewHost);
      if (amNewHost) showToast(t('msg.youAreHost'), '👑', 3000);
    };

    const onChatMessage = (msg) => {
      setChatMessages(prev => {
        const updated = [...prev, msg];
        return updated.slice(-100);
      });
      if (!chatOpenRef.current) setChatUnread(prev => prev + 1);
      playSound('chat');
    };

    const onRoomClosed = ()  => { resetToMenu(); showToast(t('msg.roomClosed'), '🚪'); };
    const onKicked = (data) => {
      resetToMenu();
      if (data?.reason === 'spectators_disabled') {
        showToast(t('msg.spectatorsDisabled'), '🚫');
      } else {
        showToast(t('msg.kicked'), '⛔');
      }
    };
    const onLeftRoom   = ()  => { /* silent */ };
    const onError      = (d) => { showToast(d.error || d.message || 'Error', '❌'); };
    const onPlayerDisconnecting = (data) => {
      if (data.playerName) {
        showToast(t('msg.playerDisconnecting', data.playerName), '📡', 4000);
      }
    };

    // Reconnection recovery — re-request current room state
    const onReconnect = () => {
      const currentPhase = phaseRef.current;
      const currentRoom = roomCodeRef.current;
      if (currentRoom && (currentPhase === 'game' || currentPhase === 'waiting')) {
        const storedName = localStorage.getItem('tc_playerName') || '';
        const storedPin = roomPasswordRef.current || undefined;
        socket.emit('rejoinRoom', { gameId: currentRoom, playerName: storedName, password: storedPin });
      }
    };

    // Handle full grid sync (server sends periodically or on request)
    const onFullGridSync = (data) => {
      if (!data?.grid) return;
      const prevGs = gameStateRef.current;
      if (!prevGs) return;
      // Rebuild complete grid from server's authoritative flat array
      const newGrid = [];
      const GRID = 80; // GRID_SIZE
      for (let y = 0; y < GRID; y++) {
        newGrid[y] = [];
        for (let x = 0; x < GRID; x++) {
          newGrid[y][x] = data.grid[y * GRID + x];
        }
      }
      const gs = { ...prevGs, grid: newGrid };
      gameStateRef.current = gs;
      setGameState(gs);
    };

    // Request full grid when tab regains visibility (prevents drift when backgrounded)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && phaseRef.current === 'game') {
        socket.emit('requestFullGrid');
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

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
    socket.on('playerDisconnected', onPlayerDisconnected);
    socket.on('playerDisconnecting', onPlayerDisconnecting);
    socket.on('gameReset',        onGameReset);
    socket.on('spectatorsToggled', onSpectatorsToggled);
    socket.on('hostChanged',       onHostChanged);
    socket.on('chatMessage',      onChatMessage);
    socket.on('roomClosed',       onRoomClosed);
    socket.on('kicked',           onKicked);
    socket.on('leftRoom',         onLeftRoom);
    socket.on('error',            onError);
    socket.on('fullGridSync',     onFullGridSync);
    socket.io.on('reconnect',     onReconnect);

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
      socket.off('playerDisconnected', onPlayerDisconnected);
      socket.off('playerDisconnecting', onPlayerDisconnecting);
      socket.off('gameReset',        onGameReset);
      socket.off('spectatorsToggled', onSpectatorsToggled);
      socket.off('hostChanged',       onHostChanged);
      socket.off('chatMessage',      onChatMessage);
      socket.off('roomClosed',       onRoomClosed);
      socket.off('kicked',           onKicked);
      socket.off('leftRoom',         onLeftRoom);
      socket.off('error',            onError);
      socket.off('fullGridSync',     onFullGridSync);
      socket.io.off('reconnect',     onReconnect);
      document.removeEventListener('visibilitychange', onVisibilityChange);
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
    gameStateRef.current = null;
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
    if (!serverUrl) { showToast(t('msg.serverUnreachable'), '❌'); return; }
    try {
      const res  = await fetch(`${serverUrl}/rooms/${code}`);
      const data = await res.json();
      if (!data.exists) { showToast(t('msg.roomNotFound'), '❌'); return; }

      if (data.hasPassword) {
        setPendingJoin(prev => ({ ...prev, roomCode: code, spectate: spectate || data.state === 'playing' }));
        if (data.takenColors) setTakenColors(data.takenColors);
        setLoginView('enterPin');
      } else if (spectate) {
        if (!data.allowSpectators) { showToast(t('msg.spectatorsDisabled') || 'Spectators not allowed', '🚫'); return; }
        socketRef.current?.emit('joinGame', { gameId: code, isSpectating: true });
      } else {
        if (data.state === 'playing') {
          if (!data.allowSpectators) { showToast(t('msg.spectatorsDisabled') || 'Spectators not allowed', '🚫'); return; }
          // Room is in progress and no password — auto-spectate
          socketRef.current?.emit('joinGame', { gameId: code, isSpectating: true });
        } else {
          setPendingJoin(prev => ({ ...prev, roomCode: code, spectate }));
          setLoginView('enterName');
          if (data.takenColors) setTakenColors(data.takenColors);
        }
      }
    } catch {
      showToast(t('msg.serverUnreachable'), '❌');
    }
  }, [showToast, t, serverUrl]);

  const handleSpectate = useCallback((code, pin) => {
    socketRef.current?.emit('joinGame', { gameId: code, password: pin || undefined, isSpectating: true });
  }, []);

  const handleFinalJoin = useCallback((name, colorIndex) => {
    if (!pendingJoin) return;
    // Update display name when player actually joins
    setPlayerNameDisplay(name);
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

  const handleToggleSpectators = useCallback((allow) => {
    socketRef.current?.emit('toggleSpectators', { allow });
  }, []);

  const handleBackToMenu = useCallback(() => {
    socketRef.current?.emit('leaveRoom');
    resetToMenu();
  }, [resetToMenu]);

  /* ── Game actions ── */
  const handleDirectionChange = useCallback((dir) => {
    socketRef.current?.emit('changeDirection', { direction: dir });

    const gs = gameStateRef.current;
    if (!gs?.players) return;
    const meIdx = gs.players.findIndex(p => p.id === socketRef.current?.id);
    if (meIdx === -1) return;
    const me = gs.players[meIdx];
    if (!me.alive) return;

    const opposites = { up: 'down', down: 'up', left: 'right', right: 'left' };
    if (opposites[me.direction] === dir) return; // server would reject this
    if (me.direction === dir) return; // already heading that way

    // Update game state direction locally
    const updated = [...gs.players];
    updated[meIdx] = { ...me, direction: dir };
    const newGs = { ...gs, players: updated };
    gameStateRef.current = newGs;
    setGameState(newGs);

    // Update local simulation immediately
    const sim = localSimRef.current;
    sim.direction = dir;
    sim.pendingDir = dir; // mark as pending until server confirms
  }, []);

  const handleLeaveGame = useCallback(() => {
    if (window.confirm(t('game.leaveConfirm'))) {
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

  /* ── Close server info dropdown on Escape key ── */
  useEffect(() => {
    if (!serverInfoOpen) return;
    const handler = (e) => {
      if (e.key === 'Escape') setServerInfoOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [serverInfoOpen]);

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
            <button
              ref={serverInfoBtnRef}
              onClick={() => setServerInfoOpen(o => !o)}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-[0.65rem] font-semibold cursor-pointer transition border ${isConnected ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20' : 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20'}`}
              title={t('serverInfo.title')}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
              <span className="hidden sm:inline">{isConnected ? t('app.online') : t('app.offline')}</span>
            </button>
            {phase !== 'login' && playerNameDisplay && (
              <span className="hidden sm:block text-xs font-bold text-slate-300 max-w-[6rem] truncate" title={playerNameDisplay}>{playerNameDisplay}</span>
            )}
          </div>
        </div>
      </header>

      {/* Server info dropdown — portalled to document.body, positioned under the button */}
      {serverInfoOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setServerInfoOpen(false)} />
          <div
            className="fixed z-[9999] w-72 rounded-2xl overflow-hidden shadow-2xl border border-slate-500/20"
            style={{
              background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.97), rgba(30, 41, 59, 0.97))',
              backdropFilter: 'blur(24px)',
              top: serverInfoBtnRef.current
                ? serverInfoBtnRef.current.getBoundingClientRect().bottom + 8 + 'px'
                : '48px',
              right: serverInfoBtnRef.current
                ? (window.innerWidth - serverInfoBtnRef.current.getBoundingClientRect().right) + 'px'
                : '12px',
              animation: 'serverInfoSlideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards',
              transformOrigin: 'top right',
            }}
          >
            {/* Header with connection status */}
            <div className={`px-4 py-3 flex items-center gap-2.5 ${isConnected ? 'bg-gradient-to-r from-emerald-500/15 to-emerald-500/5' : 'bg-gradient-to-r from-red-500/15 to-red-500/5'}`}>
              <span className={`relative w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-red-400'}`}>
                {isConnected && <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-50" />}
              </span>
              <span className={`text-sm font-bold ${isConnected ? 'text-emerald-300' : 'text-red-300'}`}>
                {isConnected ? t('app.online') : t('app.offline')}
              </span>
              <span className="ml-auto text-[0.6rem] text-slate-500 font-mono">
                {serverInfo ? `v${serverInfo.version}` : ''}
              </span>
            </div>

            {serverInfo && (
              <div className="p-4 space-y-3 text-xs">
                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-slate-800/50 rounded-xl p-3 text-center border border-slate-700/30">
                    <p className="text-blue-400 text-2xl font-black">{serverInfo.rooms}</p>
                    <p className="text-slate-500 text-[0.6rem] mt-0.5 uppercase tracking-wider font-semibold">{t('serverInfo.rooms')}</p>
                  </div>
                  <div className="bg-slate-800/50 rounded-xl p-3 text-center border border-slate-700/30">
                    <p className="text-blue-400 text-2xl font-black">{serverInfo.players}</p>
                    <p className="text-slate-500 text-[0.6rem] mt-0.5 uppercase tracking-wider font-semibold">{t('serverInfo.players')}</p>
                  </div>
                </div>

                {/* Divider */}
                <div className="h-px bg-gradient-to-r from-transparent via-slate-600/50 to-transparent" />

                {/* Detail rows */}
                <div className="space-y-2">
                  {serverInfo.uptime != null && (
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">{t('serverInfo.uptime')}</span>
                    <span className="text-slate-300 font-mono bg-slate-800/50 px-2 py-0.5 rounded-md">{formatUptime(serverInfo.uptime)}</span>
                  </div>
                  )}
                  {serverInfo.nodeVersion && (
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">{t('serverInfo.node')}</span>
                    <span className="text-slate-300 font-mono bg-slate-800/50 px-2 py-0.5 rounded-md">{serverInfo.nodeVersion}</span>
                  </div>
                  )}
                  {serverInfo.memoryMB != null && (
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">{t('serverInfo.memory')}</span>
                    <span className="text-slate-300 font-mono bg-slate-800/50 px-2 py-0.5 rounded-md">{serverInfo.memoryMB}MB</span>
                  </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </>,
        document.body
      )}

      {/* ── Main content ── */}
      <main className={`relative z-10 ${phase !== 'game' ? 'flex items-center justify-center min-h-[calc(100vh-56px)]' : ''}`}>

        {/* LOGIN */}
        {phase === 'login' && (
          <LoginView
            loginView={loginView}
            setLoginView={setLoginView}
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
            isSpectator={isSpectator}
            myId={myId}
            timeLimit={gameTimeLimit}
            allowSpectators={allowSpectators}
            handleStartGame={handleStartGame}
            handleKickPlayer={handleKickPlayer}
            handleToggleSpectators={handleToggleSpectators}
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
            deathTime={deathTime}
            onDirectionChange={handleDirectionChange}
            onLeaveGame={handleLeaveGame}
            timeRemaining={timeRemaining}
            killFeed={killFeed}
            lightTheme={lightTheme}
            prevPlayers={prevPlayersRef}
            tickTime={tickTimeRef}
            localSim={localSimRef}
          />
        )}

        {/* GAME OVER */}
        {phase === 'gameOver' && (
          <GameOver
            gameOverData={gameOverData}
            myId={myId}
            isSpectator={isSpectator}
            playAgainPending={playAgainPending}
            playAgainStatus={playAgainStatus}
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
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl glass-card border-slate-600/40 shadow-xl flex items-center gap-2 animate-slide-up"
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

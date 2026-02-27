/* ═══════════════════════════════════════════════════════════
   Territory Conquest – GameCanvas (React)
   Full-screen canvas rendering, minimap, leaderboard, input
   ═══════════════════════════════════════════════════════════ */
import React, { useRef, useEffect, useCallback, memo, useState, useMemo } from 'react';
import { GRID_SIZE, PLAYER_COLORS, TICK_MS } from '../constants';
import { useI18n } from '../i18n/I18nContext';

// Must match server RESPAWN_DELAY_MS (3000) / 1000
const RESPAWN_SECONDS = 3;

// Spectator camera limits
const SPEC_ZOOM_MIN = 30 / (GRID_SIZE + 100); // allow seeing full grid square
const SPEC_ZOOM_MAX = 1.5;
const clampSpecCam = (cam) => {
  cam.zoom = Math.max(SPEC_ZOOM_MIN, Math.min(SPEC_ZOOM_MAX, cam.zoom));
  cam.x   = Math.max(0, Math.min(GRID_SIZE, cam.x));
  cam.y   = Math.max(0, Math.min(GRID_SIZE, cam.y));
};

// Pre-computed color strings to avoid per-frame string concatenation
const PLAYER_COLORS_ALPHA40 = PLAYER_COLORS.map(c => c + '40');
const PLAYER_COLORS_ALPHA80 = PLAYER_COLORS.map(c => c + '80');

// Direction vectors for client-side extrapolation
const DIR_VECTORS = { up: { dx: 0, dy: -1 }, down: { dx: 0, dy: 1 }, left: { dx: -1, dy: 0 }, right: { dx: 1, dy: 0 } };

// Stable interpolation + extrapolation helper
// When t_lerp < 1: interpolate between previous and current server positions
// When t_lerp >= 1: extrapolate forward in the player's current direction
// This eliminates the visual "freeze" while waiting for the next server tick
function getInterpPos(p, prev, t_lerp) {
  const pp = prev[p.id];
  if (!pp || !p.alive) {
    // No previous position — extrapolate from current position if past tick time
    if (p.alive && t_lerp > 1 && p.direction) {
      const dv = DIR_VECTORS[p.direction];
      if (dv) {
        const extra = t_lerp - 1;
        const ex = p.x + dv.dx * extra;
        const ey = p.y + dv.dy * extra;
        return { ix: Math.max(0, Math.min(GRID_SIZE - 1, ex)), iy: Math.max(0, Math.min(GRID_SIZE - 1, ey)) };
      }
    }
    return { ix: p.x, iy: p.y };
  }
  const dx = Math.abs(p.x - pp.x), dy = Math.abs(p.y - pp.y);
  if (dx > 1 || dy > 1) {
    // Teleport / respawn — no interpolation, but still extrapolate past t=1
    if (t_lerp > 1 && p.direction) {
      const dv = DIR_VECTORS[p.direction];
      if (dv) {
        const extra = t_lerp - 1;
        const ex = p.x + dv.dx * extra;
        const ey = p.y + dv.dy * extra;
        return { ix: Math.max(0, Math.min(GRID_SIZE - 1, ex)), iy: Math.max(0, Math.min(GRID_SIZE - 1, ey)) };
      }
    }
    return { ix: p.x, iy: p.y };
  }
  if (t_lerp <= 1) {
    return { ix: pp.x + (p.x - pp.x) * t_lerp, iy: pp.y + (p.y - pp.y) * t_lerp };
  }
  // Extrapolate beyond current tick in the player's direction
  if (p.direction) {
    const dv = DIR_VECTORS[p.direction];
    if (dv) {
      const extra = t_lerp - 1;
      const ex = p.x + dv.dx * extra;
      const ey = p.y + dv.dy * extra;
      return { ix: Math.max(0, Math.min(GRID_SIZE - 1, ex)), iy: Math.max(0, Math.min(GRID_SIZE - 1, ey)) };
    }
  }
  return { ix: p.x, iy: p.y };
}

/* ── Death overlay with countdown (memoized) ── */
const DeathOverlay = memo(function DeathOverlay({ deathTime, t }) {
  const [countdown, setCountdown] = useState(RESPAWN_SECONDS);
  useEffect(() => {
    if (!deathTime) return;
    const update = () => {
      const elapsed = (Date.now() - deathTime) / 1000;
      setCountdown(Math.max(0, Math.ceil(RESPAWN_SECONDS - elapsed)));
    };
    update();
    const id = setInterval(update, 100);
    return () => clearInterval(id);
  }, [deathTime]);
  return (
    <div className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm flex items-center justify-center pointer-events-none">
      <div className="text-center animate-fade-in">
        <div className="text-6xl mb-3">{t('game.youDied')}</div>
        <p className="text-slate-400 text-sm">
          {t('game.respawning')} <span className="text-white font-bold ml-1">{countdown}s</span>
        </p>
      </div>
    </div>
  );
});

const GameCanvas = memo(({
  gameState, myId, isSpectator, isDead, deathTime,
  onDirectionChange, onLeaveGame,
  timeRemaining, killFeed,
  lightTheme,
  prevPlayers, tickTime,
  localSim,
}) => {
  const { t }       = useI18n();
  const canvasRef    = useRef(null);
  const animFrameRef = useRef(null);
  const gameStateRef = useRef(gameState);
  const myIdRef      = useRef(myId);
  const isSpectatorRef = useRef(isSpectator);

  // Cache canvas 2D context
  const ctxRef = useRef(null);

  // Offscreen canvas for territory grid (updated only on grid changes)
  const gridCanvasRef = useRef(null);
  const gridCtxRef = useRef(null);
  const gridDirtyRef = useRef(true); // flag: needs full redraw

  // Offscreen canvas for minimap (updated only on grid changes)
  const mmCanvasRef = useRef(null);
  const mmCtxRef = useRef(null);

  // Last font size to avoid redundant ctx.font changes
  const lastFontSizeRef = useRef(0);

  // Previous frame time for visual offset decay computation
  const prevFrameTimeRef = useRef(0);

  // Spectator camera state
  const [followPlayer, setFollowPlayer] = useState(null); // null = overview, playerId = follow
  const specCamRef = useRef({ x: GRID_SIZE / 2, y: GRID_SIZE / 2, zoom: 1 }); // free camera
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, camX: 0, camY: 0 });
  const followPlayerRef = useRef(null);

  // Keep refs current (combined into fewer effects)
  useEffect(() => {
    gameStateRef.current = gameState;
    // Mark grid dirty when gameState changes with grid changes
    gridDirtyRef.current = true;
  }, [gameState]);
  useEffect(() => { myIdRef.current = myId; }, [myId]);
  useEffect(() => { followPlayerRef.current = followPlayer; }, [followPlayer]);
  useEffect(() => { isSpectatorRef.current = isSpectator; }, [isSpectator]);

  // Initialize spectator zoom to fit full grid
  useEffect(() => {
    if (!isSpectator) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Fit entire grid: we need viewCells >= GRID_SIZE, zoom = 30 / viewCells
    // viewCells = GRID_SIZE + margin, so zoom = 30 / (GRID_SIZE + 4)
    specCamRef.current.zoom = SPEC_ZOOM_MIN;
    specCamRef.current.x = GRID_SIZE / 2;
    specCamRef.current.y = GRID_SIZE / 2;
  }, [isSpectator]);

  /* ── Spectator mouse/touch controls: drag to pan, wheel to zoom ── */
  useEffect(() => {
    if (!isSpectator) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e) => {
      e.preventDefault();
      const cam = specCamRef.current;
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      cam.zoom *= delta;
      clampSpecCam(cam);
    };

    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      isDraggingRef.current = true;
      const cam = specCamRef.current;
      dragStartRef.current = { x: e.clientX, y: e.clientY, camX: cam.x, camY: cam.y };
      canvas.style.cursor = 'grabbing';
    };

    const onMouseMove = (e) => {
      if (!isDraggingRef.current) return;
      const cam = specCamRef.current;
      const viewCells = 30;
      const cellSize = Math.max(canvas.width, canvas.height) / viewCells * cam.zoom;
      const dx = (e.clientX - dragStartRef.current.x) / cellSize;
      const dy = (e.clientY - dragStartRef.current.y) / cellSize;
      cam.x = dragStartRef.current.camX - dx;
      cam.y = dragStartRef.current.camY - dy;
      clampSpecCam(cam);
      // Unfollow when dragging
      if (followPlayerRef.current !== null) {
        setFollowPlayer(null);
      }
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      canvas.style.cursor = 'grab';
    };

    // Touch: pinch to zoom, single finger to pan
    let touchStartDist = 0;
    let touchStartZoom = 1;
    let touchPanStart = null;

    const onTouchStart = (e) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        touchStartDist = Math.sqrt(dx * dx + dy * dy);
        touchStartZoom = specCamRef.current.zoom;
      } else if (e.touches.length === 1) {
        const cam = specCamRef.current;
        touchPanStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, camX: cam.x, camY: cam.y };
      }
    };

    const onTouchMove = (e) => {
      e.preventDefault();
      if (e.touches.length === 2 && touchStartDist > 0) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const scale = dist / touchStartDist;
        specCamRef.current.zoom = touchStartZoom * scale;
        clampSpecCam(specCamRef.current);
      } else if (e.touches.length === 1 && touchPanStart) {
        const cam = specCamRef.current;
        const viewCells = 30;
        const cellSize = Math.max(canvas.width, canvas.height) / viewCells * cam.zoom;
        const dx = (e.touches[0].clientX - touchPanStart.x) / cellSize;
        const dy = (e.touches[0].clientY - touchPanStart.y) / cellSize;
        cam.x = touchPanStart.camX - dx;
        cam.y = touchPanStart.camY - dy;
        clampSpecCam(cam);
        if (followPlayerRef.current !== null) setFollowPlayer(null);
      }
    };

    const onTouchEnd = () => {
      touchStartDist = 0;
      touchPanStart = null;
    };

    canvas.style.cursor = 'grab';
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
    };
  }, [isSpectator]);

  /* ── Keyboard input (players only) ── */
  useEffect(() => {
    if (isSpectator) return;
    let lastDir = null;
    const keyMap = {
      ArrowUp: 'up', w: 'up', W: 'up',
      ArrowDown: 'down', s: 'down', S: 'down',
      ArrowLeft: 'left', a: 'left', A: 'left',
      ArrowRight: 'right', d: 'right', D: 'right',
    };
    const handler = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      const dir = keyMap[e.key];
      if (dir) {
        e.preventDefault();
        if (dir !== lastDir) {
          lastDir = dir;
          onDirectionChange(dir);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onDirectionChange, isSpectator]);

  /* ── Touch / swipe input (mobile, players only) ── */
  useEffect(() => {
    if (isSpectator) return;
    let startX = 0, startY = 0;
    const MIN_SWIPE = 35; // min px distance to register swipe (increased from 20)

    const onTouchStart = (e) => {
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
    };

    const onTouchEnd = (e) => {
      const touch = e.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      const absDx = Math.abs(dx), absDy = Math.abs(dy);
      if (Math.max(absDx, absDy) < MIN_SWIPE) return;

      let dir;
      if (absDx > absDy) {
        dir = dx > 0 ? 'right' : 'left';
      } else {
        dir = dy > 0 ? 'down' : 'up';
      }
      onDirectionChange(dir);
      // Haptic feedback on mobile if available
      if (navigator.vibrate) navigator.vibrate(10);
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [onDirectionChange, isSpectator]);

  /* ── Canvas resize ── */
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }, []);

  useEffect(() => {
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [resize]);

  /* ── Render loop ── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!ctxRef.current) ctxRef.current = canvas.getContext('2d');
    const ctx = ctxRef.current;

    // Initialize offscreen canvases for territory grid caching
    if (!gridCanvasRef.current) {
      gridCanvasRef.current = document.createElement('canvas');
      gridCanvasRef.current.width = GRID_SIZE;
      gridCanvasRef.current.height = GRID_SIZE;
      gridCtxRef.current = gridCanvasRef.current.getContext('2d');
    }
    // Initialize offscreen canvas for minimap caching
    if (!mmCanvasRef.current) {
      mmCanvasRef.current = document.createElement('canvas');
      mmCanvasRef.current.width = GRID_SIZE;
      mmCanvasRef.current.height = GRID_SIZE;
      mmCtxRef.current = mmCanvasRef.current.getContext('2d');
    }

    const render = () => {
      const gs = gameStateRef.current;
      if (!gs) { animFrameRef.current = requestAnimationFrame(render); return; }

      const w = canvas.width;
      const h = canvas.height;

      // Interpolation factor for OTHER players (local player uses local sim)
      const now = performance.now();
      const tickT = tickTime?.current || now;
      const elapsed = now - tickT;
      const t_lerp = Math.min(elapsed / TICK_MS, 3.5);
      const prev = prevPlayers?.current || {};

      const me = gs.players?.find(p => p.id === myIdRef.current);

      // ── Local simulation rendering for own player ──
      // The local sim ticks at 10Hz (same as server), so we interpolate
      // between sim.prevX/Y and sim.x/y at 60fps for smooth movement.
      // Visual offset decays exponentially to smooth out server corrections.
      const sim = localSim?.current;
      let meInterp;
      if (me && sim && sim.active && sim.alive) {
        // Decay visual offset (exponential decay, ~200ms to clear)
        const prevFrame = prevFrameTimeRef.current || now;
        const dt = Math.min((now - prevFrame) / 1000, 0.05); // cap at 50ms
        if (dt > 0) {
          const decay = Math.exp(-15 * dt); // rate 15 → ~200ms to clear 95%
          sim.visualOffsetX *= decay;
          sim.visualOffsetY *= decay;
          if (Math.abs(sim.visualOffsetX) < 0.01) sim.visualOffsetX = 0;
          if (Math.abs(sim.visualOffsetY) < 0.01) sim.visualOffsetY = 0;
        }
        prevFrameTimeRef.current = now;

        const simElapsed = now - (sim.tickTime || now);
        const t = Math.min(simElapsed / TICK_MS, 1.0); // clamp to [0,1] — no extrapolation past sim tick
        meInterp = {
          ix: sim.prevX + (sim.x - sim.prevX) * t + sim.visualOffsetX,
          iy: sim.prevY + (sim.y - sim.prevY) * t + sim.visualOffsetY,
        };
      } else if (me) {
        // Fallback: normal interpolation (spectator, dead, or sim not active)
        meInterp = getInterpPos(me, prev, t_lerp);
      } else {
        meInterp = null;
      }

      // Camera: spectator uses free cam or follows a player
      let camX, camY, viewCells, cellSize;
      const specCam = specCamRef.current;
      const followId = followPlayerRef.current;
      // Use the isSpectator prop (captured via closure) — not socket ID heuristics
      const isSpecMode = isSpectatorRef.current;

      if (isSpecMode) {
        // Spectator mode camera
        if (followId) {
          const followed = gs.players?.find(p => p.id === followId);
          if (followed && followed.alive) {
            const fi = getInterpPos(followed, prev, t_lerp);
            camX = fi.ix;
            camY = fi.iy;
          } else {
            camX = specCam.x;
            camY = specCam.y;
          }
        } else {
          camX = specCam.x;
          camY = specCam.y;
        }
        viewCells = 30 / specCam.zoom;
        cellSize = Math.max(w, h) / viewCells;
      } else {
        // Player mode camera
        camX = meInterp ? meInterp.ix : GRID_SIZE / 2;
        camY = meInterp ? meInterp.iy : GRID_SIZE / 2;
        viewCells = 30;
        cellSize  = Math.max(w, h) / viewCells;
      }

      const ox = w / 2 - camX * cellSize;
      const oy = h / 2 - camY * cellSize;

      // Background
      ctx.fillStyle = lightTheme ? '#e2e8f0' : '#0a1628';
      ctx.fillRect(0, 0, w, h);

      // Grid lines
      ctx.strokeStyle = lightTheme ? 'rgba(148,163,184,0.15)' : 'rgba(51,65,85,0.15)';
      ctx.lineWidth = 0.5;
      const startCol = Math.max(0, Math.floor(-ox / cellSize));
      const endCol   = Math.min(GRID_SIZE, Math.ceil((w - ox) / cellSize));
      const startRow = Math.max(0, Math.floor(-oy / cellSize));
      const endRow   = Math.min(GRID_SIZE, Math.ceil((h - oy) / cellSize));
      ctx.beginPath();
      for (let c = startCol; c <= endCol; c++) { const x = c * cellSize + ox; ctx.moveTo(x, startRow * cellSize + oy); ctx.lineTo(x, endRow * cellSize + oy); }
      for (let r = startRow; r <= endRow; r++) { const y = r * cellSize + oy; ctx.moveTo(startCol * cellSize + ox, y); ctx.lineTo(endCol * cellSize + ox, y); }
      ctx.stroke();

      // Border
      ctx.strokeStyle = 'rgba(239,68,68,0.3)';
      ctx.lineWidth = 2;
      ctx.strokeRect(ox, oy, GRID_SIZE * cellSize, GRID_SIZE * cellSize);

      // Territory — rendered via offscreen canvas cache
      if (gs.grid && gridDirtyRef.current) {
        const gridCtx = gridCtxRef.current;
        const colorMap = gs.playerColorMap || {};
        gridCtx.clearRect(0, 0, GRID_SIZE, GRID_SIZE);
        for (let y = 0; y < gs.grid.length; y++) {
          const row = gs.grid[y];
          if (!row) continue;
          for (let x = 0; x < row.length; x++) {
            const owner = row[x];
            if (owner > 0) {
              const cIdx = colorMap[owner];
              if (cIdx !== undefined && cIdx < PLAYER_COLORS.length) {
                gridCtx.fillStyle = PLAYER_COLORS_ALPHA40[cIdx];
                gridCtx.fillRect(x, y, 1, 1);
              }
            }
          }
        }
        // Also update minimap offscreen canvas
        const mmCtx = mmCtxRef.current;
        mmCtx.clearRect(0, 0, GRID_SIZE, GRID_SIZE);
        for (let y = 0; y < gs.grid.length; y += 2) {
          const row = gs.grid[y];
          if (!row) continue;
          for (let x = 0; x < row.length; x += 2) {
            const owner = row[x];
            if (owner > 0) {
              const cIdx = colorMap[owner];
              if (cIdx !== undefined && cIdx < PLAYER_COLORS.length) {
                mmCtx.fillStyle = PLAYER_COLORS_ALPHA80[cIdx];
                mmCtx.fillRect(x, y, 2, 2);
              }
            }
          }
        }
        gridDirtyRef.current = false;
      }

      // Blit territory offscreen canvas to main canvas
      if (gs.grid) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(gridCanvasRef.current, ox, oy, GRID_SIZE * cellSize, GRID_SIZE * cellSize);
        ctx.imageSmoothingEnabled = true;
      }

      // Trails
      if (gs.players) {
        gs.players.forEach(p => {
          if (p.trail?.length > 0) {
            ctx.fillStyle = PLAYER_COLORS_ALPHA80[p.colorIndex] || 'rgba(255,255,255,0.5)';
            p.trail.forEach(([tx, ty]) => {
              ctx.fillRect(tx * cellSize + ox + 1, ty * cellSize + oy + 1, cellSize - 2, cellSize - 2);
            });
          }
        });
      }

      // Players (interpolated)
      if (gs.players) {
        const myCurrentId = myIdRef.current;
        gs.players.forEach(p => {
          if (!p.alive) return;
          const color = PLAYER_COLORS[p.colorIndex] || '#ffffff';
          const isSelf = p.id === myCurrentId;
          // Use predicted position for local player, normal interpolation for others
          const { ix, iy } = (isSelf && meInterp) ? meInterp : getInterpPos(p, prev, t_lerp);
          const px = ix * cellSize + ox;
          const py = iy * cellSize + oy;
          const s = cellSize;

          if (isSelf) { ctx.shadowColor = color; ctx.shadowBlur = 12; }
          ctx.fillStyle = color;
          ctx.fillRect(px + 1, py + 1, s - 2, s - 2);
          ctx.fillStyle = 'rgba(255,255,255,0.25)';
          ctx.fillRect(px + s * 0.2, py + s * 0.2, s * 0.3, s * 0.3);
          if (isSelf) ctx.shadowBlur = 0;

          // Name tag (only change font when size changes)
          const fontSize = Math.max(10, cellSize * 0.35);
          if (fontSize !== lastFontSizeRef.current) {
            ctx.font = `bold ${fontSize}px 'Rajdhani', sans-serif`;
            lastFontSizeRef.current = fontSize;
          }
          ctx.fillStyle = 'white';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(p.name, px + s / 2, py - 4);
        });
      }

      // Minimap — blit from cached offscreen canvas
      const mmSize = 100, margin = 12;
      const mx = margin, my = h - mmSize - margin - 40;
      ctx.fillStyle = 'rgba(15,23,42,0.8)';
      ctx.fillRect(mx, my, mmSize, mmSize);
      ctx.strokeStyle = 'rgba(51,65,85,0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(mx, my, mmSize, mmSize);
      const scale = mmSize / GRID_SIZE;

      // Blit minimap territory from cached offscreen canvas
      if (gs.grid) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(mmCanvasRef.current, mx, my, mmSize, mmSize);
        ctx.imageSmoothingEnabled = true;
      }

      // Draw player positions on top
      if (gs.players) {
        gs.players.forEach(p => {
          if (!p.alive) return;
          const isSelf = p.id === myIdRef.current;
          const { ix, iy } = (isSelf && meInterp) ? meInterp : getInterpPos(p, prev, t_lerp);
          ctx.fillStyle = isSelf ? '#ffffff' : (PLAYER_COLORS[p.colorIndex] || '#ffffff');
          ctx.beginPath();
          ctx.arc(mx + ix * scale, my + iy * scale, isSelf ? 3 : 2, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightTheme]);

  /* ── Leaderboard data (memoized with stable key to avoid re-sorting every frame) ── */
  const playersKey = useMemo(() => {
    if (!gameState?.players) return '';
    return gameState.players
      .filter(p => !p.spectator)
      .map(p => `${p.id}:${p.score || 0}`)
      .join(',');
  }, [gameState?.players]);

  const sorted = useMemo(() => 
    (gameState?.players || [])
      .filter(p => !p.spectator)
      .sort((a, b) => (b.score || 0) - (a.score || 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [playersKey]
  );

  return (
    <div className="fixed inset-0 z-0">
      <canvas ref={canvasRef} className="block w-full h-full" />

      {/* ── Timer ── */}
      {timeRemaining != null && (
        <div className={`fixed top-14 left-1/2 -translate-x-1/2 z-20 px-4 py-1.5 rounded-xl font-mono font-bold text-lg backdrop-blur-md border ${
          timeRemaining <= 30 ? 'bg-red-900/60 border-red-500/50 text-red-300 animate-pulse' :
          timeRemaining <= 60 ? 'bg-orange-900/40 border-orange-500/40 text-orange-300' :
          'bg-slate-900/60 border-slate-600/30 text-slate-200'
        }`}>
          {Math.floor(timeRemaining / 60)}:{(timeRemaining % 60).toString().padStart(2, '0')}
        </div>
      )}

      {/* ── Leaderboard ── */}
      <div className="fixed top-14 right-3 z-20 w-44">
        <div className="glass-card p-2 space-y-0.5">
          <h3 className="text-[0.65rem] font-bold text-slate-400 mb-1">{t('game.leaderboard')}</h3>
          {sorted.map((p, i) => {
            const color = PLAYER_COLORS[p.colorIndex] || '#888';
            const isSelf = p.id === myId;
            return (
              <div key={p.id} className={`flex items-center gap-1.5 text-[0.65rem] px-1 py-0.5 rounded ${isSelf ? 'bg-cyan-900/30' : ''}`}>
                <span className="text-slate-500 w-3 text-right">{i + 1}</span>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                <span className="truncate flex-1" style={{ color: isSelf ? '#22d3ee' : '#e2e8f0' }}>{p.name}</span>
                <span className="text-slate-400 font-mono">{p.score || 0}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Kill feed ── */}
      <div className="fixed top-24 left-1/2 -translate-x-1/2 z-20 space-y-1 w-72 pointer-events-none" aria-live="polite" aria-atomic="false">
        {(killFeed || []).map((kf, i) => (
          <div key={kf.id || i} className="text-center text-xs py-1 px-3 rounded-lg bg-black/50 backdrop-blur-sm text-slate-300 animate-fade-in">
            <span className="text-red-400 font-bold">{kf.killer}</span>
            {' '}{t('game.eliminated')}{' '}
            <span className="text-cyan-400 font-bold">{kf.victim}</span>
          </div>
        ))}
      </div>

      {/* ── Death overlay ── */}
      {isDead && (
        <DeathOverlay deathTime={deathTime} t={t} />
      )}

      {/* ── Leave Game button ── */}
      {!isSpectator && (
        <button onClick={onLeaveGame}
          aria-label={t('game.leaveGame')}
          className="fixed bottom-4 left-4 z-20 px-3 py-2 rounded-xl bg-red-900/40 hover:bg-red-800/50 border border-red-500/20 text-red-400 text-xs font-medium transition-all backdrop-blur-sm">
          🚪 {t('game.leaveGame')}
        </button>
      )}

      {/* ── Spectator controls ── */}
      {isSpectator && (
        <>
          {/* Spectator badge */}
          <div className="fixed top-14 left-3 z-20">
            <div className="glass-card px-3 py-1.5 flex items-center gap-2">
              <span className="text-sm">👁️</span>
              <span className="text-xs font-bold text-purple-300">{t('spectator.watching')}</span>
            </div>
          </div>

          {/* Player switcher */}
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20">
            <div className="glass-card px-3 py-2 flex items-center gap-2 max-w-[90vw] overflow-x-auto">
              <button
                onClick={() => {
                  setFollowPlayer(null);
                  specCamRef.current = { x: GRID_SIZE / 2, y: GRID_SIZE / 2, zoom: SPEC_ZOOM_MIN };
                }}
                className={`shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  followPlayer === null
                    ? 'bg-purple-500/30 text-purple-200 border border-purple-400/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                }`}
              >
                🗺️ {t('spectator.overview')}
              </button>
              {sorted.filter(p => p.alive).map(p => {
                const color = PLAYER_COLORS[p.colorIndex] || '#888';
                return (
                  <button
                    key={p.id}
                    onClick={() => { setFollowPlayer(p.id); specCamRef.current.zoom = 1; }}
                    className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      followPlayer === p.id
                        ? 'bg-slate-700/60 text-white border border-slate-500/40'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                    <span className="truncate max-w-[5rem]">{p.name}</span>
                    <span className="text-slate-500 font-mono text-[0.6rem]">{p.score || 0}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Zoom controls */}
          <div className="fixed bottom-20 right-3 z-20 flex flex-col gap-1">
            <button
              onClick={() => { specCamRef.current.zoom *= 1.3; clampSpecCam(specCamRef.current); }}
              className="glass-card w-9 h-9 flex items-center justify-center text-lg font-bold text-slate-300 hover:text-white transition"
            >+</button>
            <button
              onClick={() => { specCamRef.current.zoom *= 0.7; clampSpecCam(specCamRef.current); }}
              className="glass-card w-9 h-9 flex items-center justify-center text-lg font-bold text-slate-300 hover:text-white transition"
            >−</button>
          </div>
        </>
      )}
    </div>
  );
});

GameCanvas.displayName = 'GameCanvas';
export default GameCanvas;

/* ═══════════════════════════════════════════════════════════
   Territory Conquest – useSocket Hook (React)
   Local-first with public fallback, mirrors Battleships
   ═══════════════════════════════════════════════════════════ */
import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import { SOCKET_URL, LOCAL_SERVER_URL, PUBLIC_SERVER_URL } from '../constants';

const LOCAL_TIMEOUT_MS = 2500;

/**
 * Determine whether we're running on localhost (dev) or a remote host (production).
 * When on a remote host, skip the local-server probe entirely to avoid
 * ERR_CONNECTION_REFUSED console errors and wasted time.
 */
const isLocalhost = typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' ||
   window.location.hostname === '127.0.0.1' ||
   window.location.hostname === '[::1]');

const useSocket = () => {
  const [socket,      setSocket]      = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [serverUrl,   setServerUrl]   = useState(
    SOCKET_URL || (isLocalhost ? LOCAL_SERVER_URL : PUBLIC_SERVER_URL)
  );
  const socketRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    /** Helper to connect with full reconnection support */
    const connectDirect = (url) => {
      const s = io(url, {
        transports: ['websocket'],   // Skip HTTP polling — go straight to WebSocket
        upgrade: false,              // Don't fall back to polling
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: Infinity,
      });
      // receive binary packets as ArrayBuffer for msgpack decoder
      if (s.io && s.io.engine) s.io.engine.binaryType = 'arraybuffer';
      s.on('connect',    () => { if (!cancelled) { setIsConnected(true);  } });
      s.on('disconnect', () => { if (!cancelled) { setIsConnected(false); } });
      socketRef.current = s;
      setSocket(s);
      setServerUrl(url);
      return s;
    };

    // 1) Explicit build-time URL — use it directly
    if (SOCKET_URL) {
      const s = connectDirect(SOCKET_URL);
      return () => { cancelled = true; s.disconnect(); };
    }

    // 2) Remote host — go straight to public Railway server (no localhost probe)
    if (!isLocalhost) {
      const s = connectDirect(PUBLIC_SERVER_URL);
      return () => { cancelled = true; s.disconnect(); };
    }

    // 3) Localhost — try local first, then fall back to public
    let fallbackTimer;
    let localConnected = false;
    let switchedToPublic = false;

    const switchToPublic = () => {
      if (cancelled || switchedToPublic) return;
      switchedToPublic = true;
      local.disconnect();
      connectDirect(PUBLIC_SERVER_URL);
    };

    const local = io(LOCAL_SERVER_URL, {
      reconnection: false,
      timeout: LOCAL_TIMEOUT_MS,
    });

    local.on('connect', () => {
      if (cancelled) { local.disconnect(); return; }
      clearTimeout(fallbackTimer);
      localConnected = true;
      local.io.reconnection(true);
      local.io.reconnectionDelay(1000);
      local.io.reconnectionDelayMax(5000);
      local.io.reconnectionAttempts(Infinity);
      setIsConnected(true);
      setServerUrl(LOCAL_SERVER_URL);
      socketRef.current = local;
      setSocket(local);
    });
    local.on('disconnect', () => { if (!cancelled) setIsConnected(false); });
    local.on('connect_error', () => {
      if (!localConnected && !cancelled) switchToPublic();
    });

    fallbackTimer = setTimeout(() => {
      if (!localConnected && !cancelled) switchToPublic();
    }, LOCAL_TIMEOUT_MS + 500);

    return () => {
      cancelled = true;
      clearTimeout(fallbackTimer);
      local.disconnect();
      if (socketRef.current && socketRef.current !== local) socketRef.current.disconnect();
    };
  }, []);

  return { socket, isConnected, serverUrl };
};

export default useSocket;

/* ═══════════════════════════════════════════════════════════
   Territory Conquest – useSocket Hook (React)
   Local-first with public fallback, mirrors Battleships
   ═══════════════════════════════════════════════════════════ */
import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import { SOCKET_URL, LOCAL_SERVER_URL, PUBLIC_SERVER_URL } from '../constants';

const LOCAL_TIMEOUT_MS = 2500;

const useSocket = () => {
  const [socket,      setSocket]      = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [serverUrl,   setServerUrl]   = useState(SOCKET_URL || LOCAL_SERVER_URL);
  const socketRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    // If a URL was explicitly set at build time, use it directly — no fallback logic
    if (SOCKET_URL) {
      const s = io(SOCKET_URL, {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: Infinity,
      });
      s.on('connect', () => !cancelled && setIsConnected(true));
      s.on('disconnect', () => !cancelled && setIsConnected(false));
      socketRef.current = s;
      setSocket(s);
      return () => { cancelled = true; s.disconnect(); };
    }

    // --- Local-first, then public fallback ---
    let localConnected = false;

    const switchToPublic = () => {
      if (cancelled) return;
      const pub = io(PUBLIC_SERVER_URL, {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: Infinity,
      });
      pub.on('connect', () => {
        if (!cancelled) {
          setServerUrl(PUBLIC_SERVER_URL);
          setIsConnected(true);
          socketRef.current = pub;
          setSocket(pub);
        }
      });
      pub.on('disconnect', () => { if (!cancelled) setIsConnected(false); });
    };

    /* Try local first */
    const local = io(LOCAL_SERVER_URL, {
      reconnection: false,
      timeout: LOCAL_TIMEOUT_MS,
    });

    let fallbackTimer;

    local.on('connect', () => {
      localConnected = true;
      if (cancelled) return;
      setServerUrl(LOCAL_SERVER_URL);
      local.io.reconnection(true);
      local.io.reconnectionDelay(1000);
      local.io.reconnectionDelayMax(5000);
      local.io.reconnectionAttempts(Infinity);
      setIsConnected(true);
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

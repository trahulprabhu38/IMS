import { useEffect, useRef, useCallback } from 'react';

export function useWebSocket(onMessage, { onOpen, onClose } = {}) {
  const wsRef      = useRef(null);
  const retryRef   = useRef(null);
  const onOpenRef  = useRef(onOpen);
  const onCloseRef = useRef(onClose);

  useEffect(() => { onOpenRef.current  = onOpen;  }, [onOpen]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  const connect = useCallback(() => {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://localhost:8000/ws`;
    const ws  = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      onOpenRef.current?.();
    };

    ws.onmessage = (e) => {
      try { onMessage(JSON.parse(e.data)); } catch { /* ignore malformed */ }
    };

    ws.onclose = () => {
      onCloseRef.current?.();
      retryRef.current = setTimeout(connect, 2000);
    };

    ws.onerror = () => ws.close();
  }, [onMessage]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, [connect]);
}

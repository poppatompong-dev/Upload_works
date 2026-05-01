import { useCallback, useEffect, useRef } from "react";

export function useRealtime(onChange: () => void) {
  const saved = useRef(onChange);
  saved.current = onChange;

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
    socket.onmessage = () => saved.current();
    socket.onclose = () => {
      window.setTimeout(connect, 2500);
    };
    return socket;
  }, []);

  useEffect(() => {
    const socket = connect();
    return () => socket.close();
  }, [connect]);
}

// Wrapper TS del módulo nativo `InfolapWs`: WebSocket TLS que acepta el
// certificado autofirmado del servidor InfoLap del TicTac nuevo
// (`wss://<pc>:12543/`, CN=InfoLapServer). El WebSocket de React Native lo
// rechaza por no ser de confianza.
//
// Sin el módulo nativo (build antigua, Expo Go) cae al WebSocket estándar,
// que solo conectará si el certificado fuese de confianza.

import { requireOptionalNativeModule } from 'expo-modules-core';

interface Subscription { remove(): void }

interface InfolapWsNative {
  connect(id: number, url: string): void;
  close(id: number): void;
  addListener(event: 'onOpen', cb: (e: { id: number }) => void): Subscription;
  addListener(event: 'onMessage', cb: (e: { id: number; data: string }) => void): Subscription;
  addListener(event: 'onClose', cb: (e: { id: number; code: number; reason: string }) => void): Subscription;
  addListener(event: 'onError', cb: (e: { id: number; message: string }) => void): Subscription;
}

const native = requireOptionalNativeModule<InfolapWsNative>('InfolapWs');

export interface InfolapWsHandlers {
  onOpen: () => void;
  onMessage: (data: string) => void;
  /** Cierre o error: la conexión ya no sirve. Se llama una sola vez. */
  onClose: (reason: string) => void;
}

export interface InfolapWsConnection {
  close(): void;
}

let nextId = 1;

export function isNativeAvailable(): boolean {
  return !!native;
}

export function openInfolapWs(url: string, h: InfolapWsHandlers): InfolapWsConnection {
  let done = false;
  let cleanup = () => {};
  const finish = (reason: string) => {
    if (done) return;
    done = true;
    cleanup();
    h.onClose(reason);
  };

  if (native) {
    const id = nextId++;
    const subs = [
      native.addListener('onOpen', e => { if (e.id === id && !done) h.onOpen(); }),
      native.addListener('onMessage', e => { if (e.id === id && !done) h.onMessage(e.data); }),
      native.addListener('onClose', e => { if (e.id === id) finish(`close ${e.code}`); }),
      native.addListener('onError', e => { if (e.id === id) finish(e.message); }),
    ];
    cleanup = () => { for (const s of subs) s.remove(); };
    native.connect(id, url);
    return {
      close() {
        if (done) return;
        done = true;
        cleanup();
        try { native.close(id); } catch { /* ignore */ }
      },
    };
  }

  const ws = new WebSocket(url);
  cleanup = () => {
    ws.onopen = null; ws.onmessage = null; ws.onclose = null; ws.onerror = null;
  };
  ws.onopen = () => { if (!done) h.onOpen(); };
  ws.onmessage = e => { if (!done && typeof e.data === 'string') h.onMessage(e.data); };
  ws.onclose = e => finish(`close ${e.code}`);
  ws.onerror = () => finish('error');
  return {
    close() {
      if (done) return;
      done = true;
      cleanup();
      try { ws.close(); } catch { /* ignore */ }
    },
  };
}

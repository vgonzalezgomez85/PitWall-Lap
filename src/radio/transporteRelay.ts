// Transporte de Radio por internet: en vez del servidor TCP del móvil que crea
// la sala (modo local), todos se conectan al relé de Cloudflare (relay/) con
// el código de sala. Cumple la misma interfaz `TransporteRadio`, así que el
// protocolo, la malla de voz y las pantallas no cambian entre modos.
//
//   • Anfitrión (`escuchar`): un WebSocket a /sala/<código>/anfitrion por el
//     que llegan multiplexados todos los invitados: {abre}, {c,t}, {cierra}.
//     Si se cae, se vuelve a conectar solo (los invitados se reconectan por su
//     cuenta, ver RadioContext).
//   • Invitado (`conectar`): un WebSocket a /sala/<código>/invitado; las
//     líneas van tal cual.

import type { Canal, TransporteRadio } from './transporte';

/** Dirección del relé desplegado (relay/README.md). */
export const RELAY_URL = 'wss://pitwall-radio-relay.victorggomez.workers.dev';
/** La misma, por HTTPS (credenciales TURN). */
export const RELAY_HTTP = RELAY_URL.replace(/^wss:/, 'https:');

/** Lo mínimo de un WebSocket que usamos (el de React Native o uno de test). */
export interface SocketMin {
  send(texto: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: { code?: number; reason?: string }) => void) | null;
  onerror: (() => void) | null;
}

export type CrearSocket = (url: string) => SocketMin;

const socketReal: CrearSocket = url => new WebSocket(url) as unknown as SocketMin;

/** Códigos de cierre del relé, traducidos a un error legible. */
export function motivoCierre(code: number | undefined): string {
  switch (code) {
    case 4404: return 'no existe la sala (código incorrecto o sala cerrada)';
    case 4409: return 'ese código de sala ya está en uso';
    case 4429: return 'la sala está llena';
    case 4000: return 'la sala se ha cerrado';
    default: return `conexión con el relé cerrada${code ? ` (${code})` : ''}`;
  }
}

/** Esperas para reconectar al anfitrión si se cae su conexión con el relé. */
const ESPERAS_ANFITRION_MS = [1000, 2000, 4000, 8000, 15000];

/** Canal sencillo: oyentes de mensajes y de cierre, cierre idempotente. */
function crearCanal(enviar: (t: string) => void, alCerrarLocal: () => void) {
  const oyentes = new Set<(t: string) => void>();
  const cierres = new Set<() => void>();
  let cerrado = false;
  const cerrarYAvisar = () => {
    if (cerrado) return;
    cerrado = true;
    for (const cb of [...cierres]) cb();
  };
  const canal: Canal = {
    enviar(t) { if (!cerrado) enviar(t); },
    onMensaje(cb) { oyentes.add(cb); return () => oyentes.delete(cb); },
    onCerrar(cb) { cierres.add(cb); return () => cierres.delete(cb); },
    cerrar() {
      if (cerrado) return;
      alCerrarLocal();
      cerrarYAvisar();
    },
  };
  return {
    canal,
    entregar(t: string) { if (!cerrado) for (const cb of [...oyentes]) cb(t); },
    cerradoRemoto: cerrarYAvisar,
  };
}

export function crearTransporteRelay(codigo: string, crearSocket: CrearSocket = socketReal): TransporteRadio {
  const sala = encodeURIComponent(codigo.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  let anfitrion: SocketMin | null = null;
  let cerradoAdrede = false;
  let espera: ReturnType<typeof setTimeout> | null = null;
  const invitados = new Map<string, ReturnType<typeof crearCanal>>();

  return {
    escuchar(onConexion) {
      return new Promise<void>((resolve, reject) => {
        let primera = true;
        let intento = 0;

        const abrir = () => {
          const ws = crearSocket(`${RELAY_URL}/sala/${sala}/anfitrion`);
          anfitrion = ws;
          let abierto = false;

          ws.onopen = () => {
            abierto = true;
            intento = 0;
            if (primera) {
              primera = false;
              resolve();
            }
          };

          ws.onmessage = (e) => {
            let m: { abre?: unknown; c?: unknown; t?: unknown; cierra?: unknown };
            try { m = JSON.parse(String(e.data)); } catch { return; }
            if (typeof m.abre === 'string') {
              const id = m.abre;
              const c = crearCanal(
                t => ws.send(JSON.stringify({ c: id, t })),
                () => { try { anfitrion?.send(JSON.stringify({ cerrar: id })); } catch { /* ignore */ } invitados.delete(id); },
              );
              invitados.set(id, c);
              onConexion(c.canal);
            } else if (typeof m.c === 'string' && typeof m.t === 'string') {
              invitados.get(m.c)?.entregar(m.t);
            } else if (typeof m.cierra === 'string') {
              invitados.get(m.cierra)?.cerradoRemoto();
              invitados.delete(m.cierra);
            }
          };

          ws.onclose = (e) => {
            if (anfitrion !== ws) return;
            anfitrion = null;
            // Sin anfitrión el relé echa a todos: se avisa a cada canal.
            for (const c of invitados.values()) c.cerradoRemoto();
            invitados.clear();
            if (cerradoAdrede) return;
            if (primera && (!abierto || e.code === 4409)) {
              primera = false;
              reject(new Error(motivoCierre(e.code)));
              return;
            }
            // Caída inesperada: volver a conectar como anfitrión.
            const ms = ESPERAS_ANFITRION_MS[Math.min(intento, ESPERAS_ANFITRION_MS.length - 1)]!;
            intento += 1;
            espera = setTimeout(abrir, ms);
          };

          ws.onerror = () => { /* llega también onclose */ };
        };

        abrir();
      });
    },

    conectar() {
      return new Promise<Canal>((resolve, reject) => {
        const ws = crearSocket(`${RELAY_URL}/sala/${sala}/invitado`);
        let asentado = false;
        const c = crearCanal(t => ws.send(t), () => { try { ws.close(1000); } catch { /* ignore */ } });
        ws.onopen = () => {
          if (asentado) return;
          asentado = true;
          resolve(c.canal);
        };
        ws.onmessage = (e) => c.entregar(String(e.data));
        ws.onclose = (e) => {
          if (!asentado) {
            asentado = true;
            reject(new Error(motivoCierre(e.code)));
            return;
          }
          c.cerradoRemoto();
        };
        ws.onerror = () => { /* llega también onclose */ };
      });
    },

    cerrar() {
      cerradoAdrede = true;
      if (espera) clearTimeout(espera);
      for (const c of invitados.values()) c.cerradoRemoto();
      invitados.clear();
      try { anfitrion?.close(1000); } catch { /* ignore */ }
      anfitrion = null;
    },
  };
}

/** Pide al relé credenciales TURN temporales para la voz. Lista vacía si no
 *  hay (sin TURN la voz solo funcionará cuando haya conexión directa). */
export async function obtenerServidoresIce(): Promise<RTCIceServerLike[]> {
  try {
    const r = await fetch(`${RELAY_HTTP}/turn`);
    if (!r.ok) return [];
    const datos = (await r.json()) as { iceServers?: unknown };
    return Array.isArray(datos.iceServers) ? (datos.iceServers as RTCIceServerLike[]) : [];
  } catch {
    return [];
  }
}

export interface RTCIceServerLike {
  urls: string | string[];
  username?: string;
  credential?: string;
}

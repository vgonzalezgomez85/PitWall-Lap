// Transporte TCP real de Radio (Fase 1). El móvil del asistente abre un
// pequeño servidor en `PUERTO_RADIO`; los participantes se conectan a su
// dirección. Sobre el TCP viaja primero la señalización (unirse/bienvenido) y
// luego los mensajes de datos, cada uno como una línea JSON terminada en '\n'.
//
// Nota: react-native-tcp-socket aún no está instalado. Este módulo compila
// gracias a tcp-socket.d.ts, pero en un dispositivo hay que `npm install
// react-native-tcp-socket` + `expo prebuild` (ver radio.md §5).

import TcpSocket from 'react-native-tcp-socket';
import type { Canal, TransporteRadio } from './transporte';

/** Puerto por defecto del servidor del asistente. */
export const PUERTO_RADIO = 7080;

/** Tiempo máximo para establecer la conexión TCP antes de rendirse. */
const CONEXION_TIMEOUT_MS = 8000;

/**
 * Envuelve un socket TCP en un `Canal`, partiendo el flujo en líneas JSON.
 * Los fragmentos pueden llegar a trozos: se acumulan en `pendiente` y se
 * procesan solo las líneas completas.
 *
 * El socket entrega el texto ya decodificado (`setEncoding('utf8')`). No
 * convertimos bytes con `Buffer`: en Hermes no es un global, y antes
 * `Buffer.from` fallaba en silencio y cada mensaje llegaba vacío (el asistente
 * aceptaba la conexión pero nunca veía el `unirse`).
 */
export function crearCanalTcp(socket: import('react-native-tcp-socket').TcpSocket): Canal {
  socket.setEncoding('utf8');
  let pendiente = '';
  const oyentesMensaje = new Set<(t: string) => void>();
  const oyentesCierre = new Set<() => void>();

  const emitirMensajes = (texto: string) => {
    pendiente += texto;
    let idx: number;
    while ((idx = pendiente.indexOf('\n')) >= 0) {
      const linea = pendiente.slice(0, idx).trim();
      pendiente = pendiente.slice(idx + 1);
      if (!linea) continue;
      for (const cb of [...oyentesMensaje]) cb(linea);
    }
  };

  const emitirCierre = () => {
    for (const cb of [...oyentesCierre]) cb();
  };

  socket.on('data', (data) => {
    if (typeof data === 'string') emitirMensajes(data);
  });
  socket.on('close', emitirCierre);
  socket.on('error', emitirCierre);

  return {
    enviar(texto) {
      try {
        socket.write(`${texto}\n`);
      } catch {
        emitirCierre();
      }
    },
    onMensaje(cb) {
      oyentesMensaje.add(cb);
      return () => oyentesMensaje.delete(cb);
    },
    onCerrar(cb) {
      oyentesCierre.add(cb);
      return () => oyentesCierre.delete(cb);
    },
    cerrar() {
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
    },
  };
}

/** Crea el transporte de red real (servidor + conexiones salientes). */
export function crearTransporteTcp(): TransporteRadio {
  let server: import('react-native-tcp-socket').TcpServer | null = null;

  return {
    async escuchar(onConexion) {
      server = TcpSocket.createServer((socket) => {
        onConexion(crearCanalTcp(socket));
      });
      // Resolvemos cuando el servidor escucha de verdad, o rechazamos si no
      // pudo abrirse (puerto ocupado, permiso de red local…). Así el creador
      // de la sala no anuncia un servidor que en realidad no acepta conexiones.
      await new Promise<void>((resolve, reject) => {
        server!.once('listening', () => resolve());
        server!.once('error', (err) => reject(err instanceof Error ? err : new Error(String(err))));
        server!.listen({ port: PUERTO_RADIO, host: '0.0.0.0' });
      });
    },

    async conectar(host, puerto) {
      return new Promise<Canal>((resolve, reject) => {
        let asentado = false;
        let temporizador: ReturnType<typeof setTimeout> | null = null;
        const parar = () => { if (temporizador) clearTimeout(temporizador); };

        const socket = TcpSocket.createConnection({ port: puerto, host }, () => {
          if (asentado) return;
          asentado = true;
          parar();
          resolve(crearCanalTcp(socket));
        });
        socket.on('error', (err) => {
          if (asentado) return;
          asentado = true;
          parar();
          reject(err);
        });
        temporizador = setTimeout(() => {
          if (asentado) return;
          asentado = true;
          try { socket.destroy(); } catch { /* ignore */ }
          reject(new Error('timeout de conexión TCP'));
        }, CONEXION_TIMEOUT_MS);
      });
    },

    cerrar() {
      try {
        server?.close();
      } catch {
        /* ignore */
      }
      server = null;
    },
  };
}

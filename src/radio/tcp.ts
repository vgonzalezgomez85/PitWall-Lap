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

/** Convierte un fragmento de bytes en su texto UTF-8. */
function aTexto(data: Uint8Array): string {
  try {
    return Buffer.from(data).toString('utf8');
  } catch {
    return '';
  }
}

/**
 * Envuelve un socket TCP en un `Canal`, partiendo el flujo en líneas JSON.
 * Los fragmentos pueden llegar a trozos: se acumulan en `pendiente` y se
 * procesan solo las líneas completas.
 */
function crearCanalTcp(socket: import('react-native-tcp-socket').TcpSocket): Canal {
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

  socket.on('data', (data) => emitirMensajes(aTexto(data)));
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
      // 0.0.0.0 para aceptar conexiones por la red local (el móvil del
      // asistente es el punto de acceso).
      server.listen({ port: PUERTO_RADIO, host: '0.0.0.0' });
    },

    async conectar(host, puerto) {
      return new Promise<Canal>((resolve, reject) => {
        const socket = TcpSocket.createConnection({ port: puerto, host }, () => {
          resolve(crearCanalTcp(socket));
        });
        socket.on('error', (err) => reject(err));
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

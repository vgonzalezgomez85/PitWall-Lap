// Relé de Radio por internet. Sustituye al servidor TCP del móvil que crea la
// sala cuando no hay WiFi compartida: el anfitrión y los invitados se
// conectan aquí por WebSocket con el código de sala, y el relé solo reenvía
// líneas de texto entre ellos (no entiende el protocolo de la sala, que sigue
// viviendo en la app). Así el protocolo, la malla de voz y las pantallas son
// los mismos en modo local y por internet.
//
//   GET /sala/:codigo/anfitrion  (WebSocket) — quien crea la sala. Uno por sala.
//   GET /sala/:codigo/invitado   (WebSocket) — el resto.
//   GET /turn                    — credenciales TURN de corta duración para la
//                                  voz (WebRTC) cuando no hay conexión directa.
//
// Anfitrión ↔ relé (JSON por mensaje):
//   relé → anfitrión: {abre: id} · {c: id, t: línea} · {cierra: id}
//   anfitrión → relé: {c: id, t: línea} · {cerrar: id}
// Invitado ↔ relé: la línea tal cual, en los dos sentidos.

export interface Env {
  SALAS: DurableObjectNamespace;
  TURN_KEY_ID: string;
  TURN_TOKEN: string;
}

/** Códigos de sala: 6 caracteres alfanuméricos (con o sin guion). */
const CODIGO = /^[A-Z0-9]{6}$/;
const MAX_INVITADOS = 12;
const MAX_LINEA = 64 * 1024;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/turn') return credencialesTurn(env);

    const m = /^\/sala\/([^/]+)\/(anfitrion|invitado)$/.exec(url.pathname);
    if (m) {
      const codigo = decodeURIComponent(m[1]!).toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!CODIGO.test(codigo)) return new Response('código no válido', { status: 400 });
      if (req.headers.get('Upgrade') !== 'websocket') {
        return new Response('se esperaba WebSocket', { status: 426 });
      }
      const sala = env.SALAS.get(env.SALAS.idFromName(codigo));
      return sala.fetch(req);
    }

    if (url.pathname === '/') return new Response('PitWall Radio relay');
    return new Response('no encontrado', { status: 404 });
  },
};

/** Pide a Cloudflare Realtime credenciales TURN válidas 48 h. La app
 *  nunca ve el token: solo usuario y contraseña temporales. */
async function credencialesTurn(env: Env): Promise<Response> {
  if (!env.TURN_TOKEN) return Response.json({ iceServers: [] });
  const base = `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials`;
  const init: RequestInit = {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.TURN_TOKEN}`, 'Content-Type': 'application/json' },
    // 48 h: el TURN renueva su reserva con estas mismas credenciales, así que
    // deben durar más que la sesión más larga (carreras de 24 h). Con 6 h la
    // voz por TURN se habría cortado a mitad de carrera.
    body: JSON.stringify({ ttl: 48 * 3600 }),
  };
  // Endpoint nuevo (devuelve la lista lista para WebRTC) y, si no, el clásico.
  let r = await fetch(`${base}/generate-ice-servers`, init);
  if (r.ok) return Response.json(await r.json(), { headers: { 'Cache-Control': 'no-store' } });
  r = await fetch(`${base}/generate`, init);
  if (!r.ok) return Response.json({ iceServers: [], error: r.status }, { status: 502 });
  const datos = (await r.json()) as { iceServers?: unknown };
  const lista = Array.isArray(datos.iceServers) ? datos.iceServers : datos.iceServers ? [datos.iceServers] : [];
  return Response.json({ iceServers: lista }, { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Una sala: un anfitrión y sus invitados. Usa la API de WebSockets con
 * hibernación (el objeto no cuesta nada mientras nadie habla). Las etiquetas
 * identifican cada conexión: `anfitrion` o `invitado:<id>`.
 */
export class Sala {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(req: Request): Promise<Response> {
    const anfitrion = new URL(req.url).pathname.endsWith('/anfitrion');
    const par = new WebSocketPair();
    const [cliente, servidor] = [par[0], par[1]];

    if (anfitrion) {
      // Un anfitrión por sala: si ya hay uno vivo, el código está en uso.
      if (this.state.getWebSockets('anfitrion').length > 0) {
        return rechazar(par, 4409, 'sala en uso');
      }
      this.state.acceptWebSocket(servidor, ['anfitrion']);
      return new Response(null, { status: 101, webSocket: cliente });
    }

    const host = this.anfitrion();
    if (!host) {
      return rechazar(par, 4404, 'no existe la sala');
    }
    if (this.invitados().length >= MAX_INVITADOS) {
      return rechazar(par, 4429, 'sala llena');
    }
    const id = crypto.randomUUID().slice(0, 8);
    this.state.acceptWebSocket(servidor, ['invitado', `invitado:${id}`]);
    enviar(host, { abre: id });
    return new Response(null, { status: 101, webSocket: cliente });
  }

  async webSocketMessage(ws: WebSocket, mensaje: string | ArrayBuffer): Promise<void> {
    if (typeof mensaje !== 'string' || mensaje.length > MAX_LINEA) return;
    const etiquetas = this.state.getTags(ws);

    if (etiquetas.includes('anfitrion')) {
      let m: { c?: unknown; t?: unknown; cerrar?: unknown };
      try { m = JSON.parse(mensaje); } catch { return; }
      if (typeof m.c === 'string' && typeof m.t === 'string') {
        const destino = this.invitado(m.c);
        if (destino) try { destino.send(m.t); } catch { /* cerrado */ }
      } else if (typeof m.cerrar === 'string') {
        try { this.invitado(m.cerrar)?.close(1000, 'cerrado por la sala'); } catch { /* ignore */ }
      }
      return;
    }

    const id = idInvitado(etiquetas);
    const host = this.anfitrion();
    if (id && host) enviar(host, { c: id, t: mensaje });
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.alCerrar(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.alCerrar(ws);
  }

  private alCerrar(ws: WebSocket): void {
    const etiquetas = this.state.getTags(ws);
    if (etiquetas.includes('anfitrion')) {
      // Sin anfitrión no hay sala: se echa a todos.
      for (const inv of this.invitados()) {
        try { inv.close(4000, 'sala cerrada'); } catch { /* ignore */ }
      }
      return;
    }
    const id = idInvitado(etiquetas);
    const host = this.anfitrion();
    if (id && host) enviar(host, { cierra: id });
  }

  private anfitrion(): WebSocket | undefined {
    return this.state.getWebSockets('anfitrion')[0];
  }

  private invitados(): WebSocket[] {
    return this.state.getWebSockets('invitado');
  }

  private invitado(id: string): WebSocket | undefined {
    return this.state.getWebSockets(`invitado:${id}`)[0];
  }
}

/** Acepta y cierra en el acto con un código propio, para que la app sepa por
 *  qué (código en uso, sala inexistente…). Se acepta SIN hibernación: con
 *  `acceptWebSocket` + `close` inmediato el cierre no llegaba al cliente y la
 *  conexión se quedaba colgada. */
function rechazar(par: WebSocketPair, codigo: number, motivo: string): Response {
  const [cliente, servidor] = [par[0], par[1]];
  servidor.accept();
  servidor.close(codigo, motivo);
  return new Response(null, { status: 101, webSocket: cliente });
}

function idInvitado(etiquetas: string[]): string | null {
  const e = etiquetas.find(t => t.startsWith('invitado:'));
  return e ? e.slice('invitado:'.length) : null;
}

function enviar(ws: WebSocket, m: unknown): void {
  try { ws.send(JSON.stringify(m)); } catch { /* cerrado */ }
}

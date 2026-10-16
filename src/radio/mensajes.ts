// Tipos y (de)serialización de los mensajes de Radio. Puro (sin React ni
// nativos) para poder testearlo.
//
// Hay dos flujos distintos:
//  1. La **señalización** (presentarse, validar el código y pasar las ofertas/
//     respuestas/candidatos de WebRTC) viaja por el servidor TCP del asistente.
//  2. Los **mensajes de datos** (vueltas, estado de habla, participantes…)
//     viajan por el `RTCDataChannel` de cada conexión, ya con WebRTC levantado.

export type Rol = 'piloto' | 'asistente' | 'seguidor';

export interface Participante {
  id: string;
  nombre: string;
  rol: Rol;
}

/** Quién está hablando ahora (para las reglas de prioridad locución ↔ voz). */
export type Hablando = 'piloto' | 'asistente' | null;

/** Motivos por los que el asistente rechaza a un participante al unirse. */
export type MotivoRechazo = 'codigo' | 'rol-ocupado' | 'sala-llena';

// ── Mensajes del canal de datos (asistente ↔ cada participante) ────────────
//
// El asistente es la fuente de verdad de las vueltas: calcula el tiempo en su
// móvil (diferencia entre pulsaciones) y lo envía ya resuelto.

export type MensajeRadio =
  // Vueltas: n = número de vuelta, ms = tiempo de vuelta, ts = instante del
  // cruce (epoch ms, reloj del asistente).
  | { tipo: 'vuelta'; n: number; ms: number; ts: number }
  // Borra la vuelta n (pulsación por error).
  | { tipo: 'deshacer'; n: number }
  // Estado de habla (para que la locución sepa cuándo esperar, §6).
  | { tipo: 'estado'; hablando: Hablando }
  // Lista actual de participantes (el asistente la reenvía a todos).
  | { tipo: 'participantes'; lista: Participante[] }
  // Ciclo de vida de la tanda de vueltas.
  | { tipo: 'inicio' }
  | { tipo: 'fin' }
  // El asistente empuja su configuración de audio (locutar tiempos sí/no).
  | { tipo: 'ajustes'; locutarTiempos: boolean }
  // La sala se ha cerrado; todos cuelgan.
  | { tipo: 'salaCerrada' };

// ── Mensajes de señalización (sobre el socket TCP del asistente) ───────────

export type MensajeSenalizacion =
  // Alta de un participante. El asistente responde `bienvenido` o `rechazado`.
  | { tipo: 'unirse'; nombre: string; rol: Rol; codigo: string }
  | { tipo: 'bienvenido'; tuId: string; lista: Participante[] }
  | { tipo: 'rechazado'; motivo: MotivoRechazo }
  // Intercambio SDP/ICE de WebRTC entre el asistente y un participante.
  // `de` identifica al emisor (el `id` asignado en `bienvenido`, o `asistente`).
  | { tipo: 'oferta'; de: string; sdp: string }
  | { tipo: 'respuesta'; de: string; sdp: string }
  | { tipo: 'candidato'; de: string; candidate: string }
  // Un participante se va (o el asistente lo expulsa).
  | { tipo: 'salir'; id: string };

const TIPOS_MENSAJE: string[] = [
  'vuelta',
  'deshacer',
  'estado',
  'participantes',
  'inicio',
  'fin',
  'ajustes',
  'salaCerrada',
];

const TIPOS_SENALIZACION: string[] = [
  'unirse',
  'bienvenido',
  'rechazado',
  'oferta',
  'respuesta',
  'candidato',
  'salir',
];

const ROLES: Rol[] = ['piloto', 'asistente', 'seguidor'];

function esRol(v: unknown): v is Rol {
  return typeof v === 'string' && (ROLES as string[]).includes(v);
}

function esParticipante(v: unknown): v is Participante {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.nombre === 'string' &&
    esRol(o.rol)
  );
}

/** Valida un objeto ya parseado y devuelve un `MensajeRadio` tipado. */
export function validarMensaje(v: unknown): MensajeRadio | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.tipo !== 'string') return null;
  switch (o.tipo) {
    case 'vuelta':
      return typeof o.n === 'number' &&
        typeof o.ms === 'number' &&
        typeof o.ts === 'number'
        ? { tipo: 'vuelta', n: o.n, ms: o.ms, ts: o.ts }
        : null;
    case 'deshacer':
      return typeof o.n === 'number' ? { tipo: 'deshacer', n: o.n } : null;
    case 'estado':
      return o.hablando === null || esRolHablando(o.hablando)
        ? { tipo: 'estado', hablando: o.hablando as Hablando }
        : null;
    case 'participantes':
      return Array.isArray(o.lista) && o.lista.every(esParticipante)
        ? { tipo: 'participantes', lista: o.lista as Participante[] }
        : null;
    case 'inicio':
      return { tipo: 'inicio' };
    case 'fin':
      return { tipo: 'fin' };
    case 'ajustes':
      return typeof o.locutarTiempos === 'boolean'
        ? { tipo: 'ajustes', locutarTiempos: o.locutarTiempos }
        : null;
    case 'salaCerrada':
      return { tipo: 'salaCerrada' };
    default:
      return null;
  }
}

function esRolHablando(v: unknown): v is 'piloto' | 'asistente' {
  return v === 'piloto' || v === 'asistente';
}

/** Valida un objeto parseado como `MensajeSenalizacion`. */
export function validarSenalizacion(v: unknown): MensajeSenalizacion | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.tipo !== 'string') return null;
  switch (o.tipo) {
    case 'unirse':
      return typeof o.nombre === 'string' &&
        esRol(o.rol) &&
        typeof o.codigo === 'string'
        ? { tipo: 'unirse', nombre: o.nombre, rol: o.rol, codigo: o.codigo }
        : null;
    case 'bienvenido':
      return typeof o.tuId === 'string' &&
        Array.isArray(o.lista) &&
        o.lista.every(esParticipante)
        ? { tipo: 'bienvenido', tuId: o.tuId, lista: o.lista as Participante[] }
        : null;
    case 'rechazado':
      return typeof o.motivo === 'string' &&
        (['codigo', 'rol-ocupado', 'sala-llena'] as string[]).includes(o.motivo)
        ? { tipo: 'rechazado', motivo: o.motivo as MotivoRechazo }
        : null;
    case 'oferta':
      return typeof o.de === 'string' && typeof o.sdp === 'string'
        ? { tipo: 'oferta', de: o.de, sdp: o.sdp }
        : null;
    case 'respuesta':
      return typeof o.de === 'string' && typeof o.sdp === 'string'
        ? { tipo: 'respuesta', de: o.de, sdp: o.sdp }
        : null;
    case 'candidato':
      return typeof o.de === 'string' && typeof o.candidate === 'string'
        ? { tipo: 'candidato', de: o.de, candidate: o.candidate }
        : null;
    case 'salir':
      return typeof o.id === 'string' ? { tipo: 'salir', id: o.id } : null;
    default:
      return null;
  }
}

/** Serializa un mensaje de datos a JSON de una línea. */
export function serializar(m: MensajeRadio): string {
  return JSON.stringify(m);
}

/** Serializa un mensaje de señalización a JSON de una línea. */
export function serializarSenalizacion(m: MensajeSenalizacion): string {
  return JSON.stringify(m);
}

/**
 * Deserializa una línea JSON a `MensajeRadio` o `null` si no es válida.
 * Nunca lanza: la entrada viene de la red y hay que ignorar lo malformado.
 */
export function deserializar(texto: string): MensajeRadio | null {
  let v: unknown;
  try {
    v = JSON.parse(texto);
  } catch {
    return null;
  }
  return validarMensaje(v);
}

/** Igual que `deserializar`, para `MensajeSenalizacion`. */
export function deserializarSenalizacion(
  texto: string,
): MensajeSenalizacion | null {
  let v: unknown;
  try {
    v = JSON.parse(texto);
  } catch {
    return null;
  }
  return validarSenalizacion(v);
}

// Uso en tiempo de ejecución para que el bundler no elimine las listas de tipos
// válidos (que solo se usan en las validaciones internas).
void TIPOS_MENSAJE;
void TIPOS_SENALIZACION;

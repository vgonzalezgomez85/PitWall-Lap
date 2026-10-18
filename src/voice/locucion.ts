// Estado global «la app está locutando». Lo alimentan los eventos del motor
// de voz (iOS: módulo nativo BackgroundTts; Android: react-native-tts) y lo
// consume Radio para silenciar el micro abierto mientras suena la locución:
// la locución no pasa por WebRTC, así que su cancelación de eco no la quita y
// el asistente oiría de vuelta los tiempos que se le cantan al piloto.

type Oyente = (locutando: boolean) => void;

const oyentes = new Set<Oyente>();
let locutando = false;

/** Notifica un cambio (lo llaman los adaptadores de cada plataforma). */
export function notificarLocucion(activo: boolean): void {
  if (activo === locutando) return;
  locutando = activo;
  for (const cb of [...oyentes]) cb(activo);
}

export function estaLocutando(): boolean {
  return locutando;
}

/** Se suscribe a los cambios. Devuelve la cancelación. */
export function onLocucion(cb: Oyente): () => void {
  oyentes.add(cb);
  return () => { oyentes.delete(cb); };
}

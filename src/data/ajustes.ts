// Ajustes generales de la app que no son de voz ni de idioma (esos tienen su
// propio almacén). Lógica pura, sin React ni módulos nativos.

export interface Ajustes {
  /** Estrategia de neumáticos en Lap: plan de cambios, avisos y su acceso. */
  estrategiaNeumaticos: boolean;
}

export const AJUSTES_POR_DEFECTO: Ajustes = {
  estrategiaNeumaticos: true,
};

/** Lee lo guardado y rellena con los valores por defecto lo que falte o sea raro. */
export function normalizarAjustes(raw: unknown): Ajustes {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    estrategiaNeumaticos: typeof o.estrategiaNeumaticos === 'boolean'
      ? o.estrategiaNeumaticos
      : AJUSTES_POR_DEFECTO.estrategiaNeumaticos,
  };
}

// Tokens de diseño de la app: colores, tipografía, espaciados y radios.
//
// Las pantallas nuevas (y las que se vayan rediseñando) toman de aquí sus
// valores en lugar de repetir hex sueltos. Los colores coinciden con los que
// ya usaba la app, así que migrar una pantalla no cambia su aspecto.

import type { TextStyle } from 'react-native';

export const colors = {
  bg: '#0a0d13',
  surface: '#141923',
  surfaceRaised: '#1c2330',
  border: '#3a4350',
  borderSoft: '#1f2633',

  text: '#ffffff',
  textSoft: '#cfd5dc',
  textMuted: '#9aa3ad',
  textFaint: '#6b7480',

  accent: '#f6c90e',
  onAccent: '#0a0d13',
  accentSoft: '#1f1804',

  // Semáforo de vueltas, estilo cronometraje de F1.
  best: '#c084fc',      // morado: mejor vuelta propia
  good: '#4ade80',      // verde: cerca de la mejor
  slow: '#fb923c',      // ámbar: claramente más lento

  danger: '#ff6b6b',
  dangerSoft: '#7a2230',
  success: '#1f5f2a',
  info: '#2c5cdd',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  pill: 999,
} as const;

// Cifras de ancho fijo: los tiempos no "bailan" al cambiar los dígitos.
const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

export const type = {
  // Etiqueta pequeña en mayúsculas (encabezados de dato y de sección).
  label: {
    color: colors.textMuted, fontSize: 12, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  caption: { color: colors.textFaint, fontSize: 12, lineHeight: 17 },
  body: { color: colors.textSoft, fontSize: 15, lineHeight: 21 },
  bodyStrong: { color: colors.text, fontSize: 16, fontWeight: '600' },
  title: { color: colors.accent, fontSize: 26, fontWeight: '700' },
  heading: { color: colors.text, fontSize: 22, fontWeight: '700' },

  // Números.
  hero: { color: colors.text, fontSize: 76, fontWeight: '800', letterSpacing: -1, ...tabular },
  stat: { color: colors.text, fontSize: 26, fontWeight: '700', ...tabular },
  statSmall: { color: colors.text, fontSize: 20, fontWeight: '700', ...tabular },
  tabular,
} satisfies Record<string, TextStyle>;

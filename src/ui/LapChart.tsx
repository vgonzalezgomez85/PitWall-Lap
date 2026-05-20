// Gráfica de tiempos de vuelta para stints de entrenamiento.
//
// Cada serie se dibuja con dos líneas:
//   • línea sólida  → tiempo de cada vuelta
//   • línea punteada → media móvil (ventana 3) que suaviza el ruido
//
// Acepta varias series para poder superponer stints y compararlos.

import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Polyline, Text as SvgText } from 'react-native-svg';

export interface ChartSeries {
  label: string;
  color: string;
  laps: number[];   // ms
}

const H = 220;
const PAD = { top: 16, right: 12, bottom: 26, left: 44 };
const MA_WINDOW = 3;

function movingAverage(laps: number[], win: number): number[] {
  return laps.map((_, i) => {
    const from = Math.max(0, i - win + 1);
    const slice = laps.slice(from, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

function fmt(ms: number): string {
  const cs = Math.round(ms / 10);
  return `${Math.floor(cs / 100)}.${String(cs % 100).padStart(2, '0')}`;
}

export default function LapChart({ series }: { series: ChartSeries[] }) {
  const [w, setW] = useState(0);

  const all = series.flatMap(s => s.laps);
  const maxLaps = Math.max(1, ...series.map(s => s.laps.length));
  if (all.length === 0 || w === 0) {
    return (
      <View style={styles.box} onLayout={e => setW(e.nativeEvent.layout.width)}>
        {w > 0 && <Text style={styles.empty}>Sin vueltas que mostrar</Text>}
      </View>
    );
  }

  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (hi === lo) { hi += 1; lo -= 1; }
  const span = hi - lo;
  lo -= span * 0.08;
  hi += span * 0.08;

  const plotW = w - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // x: vuelta 1..maxLaps  →  PAD.left..PAD.left+plotW
  const xAt = (i: number) =>
    PAD.left + (maxLaps === 1 ? plotW / 2 : (i / (maxLaps - 1)) * plotW);
  // y: tiempo (más rápido = arriba)
  const yAt = (ms: number) => PAD.top + ((hi - ms) / (hi - lo)) * plotH;

  const points = (vals: number[]) =>
    vals.map((v, i) => `${xAt(i)},${yAt(v)}`).join(' ');

  // Tres líneas de rejilla horizontales (mín, medio, máx).
  const gridVals = [hi, (hi + lo) / 2, lo];

  return (
    <View style={styles.box} onLayout={e => setW(e.nativeEvent.layout.width)}>
      <Svg width={w} height={H}>
        {gridVals.map((g, idx) => (
          <Line
            key={`g${idx}`}
            x1={PAD.left} y1={yAt(g)} x2={w - PAD.right} y2={yAt(g)}
            stroke="#222a36" strokeWidth={1}
          />
        ))}
        {gridVals.map((g, idx) => (
          <SvgText
            key={`gl${idx}`}
            x={PAD.left - 6} y={yAt(g) + 4}
            fontSize={10} fill="#6b7480" textAnchor="end"
          >
            {fmt(g)}
          </SvgText>
        ))}

        {series.map((s, si) => (
          <Polyline
            key={`ma${si}`}
            points={points(movingAverage(s.laps, MA_WINDOW))}
            fill="none" stroke={s.color} strokeWidth={1.5}
            strokeDasharray="4 4" opacity={0.55}
          />
        ))}
        {series.map((s, si) => (
          <Polyline
            key={`lt${si}`}
            points={points(s.laps)}
            fill="none" stroke={s.color} strokeWidth={2.5}
            strokeLinejoin="round" strokeLinecap="round"
          />
        ))}

        <SvgText
          x={PAD.left} y={H - 8} fontSize={10} fill="#6b7480"
        >
          vuelta 1
        </SvgText>
        <SvgText
          x={w - PAD.right} y={H - 8} fontSize={10} fill="#6b7480" textAnchor="end"
        >
          vuelta {maxLaps}
        </SvgText>
      </Svg>

      <View style={styles.legend}>
        {series.map((s, si) => (
          <View key={`leg${si}`} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: s.color }]} />
            <Text style={styles.legendText} numberOfLines={1}>{s.label}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.note}>Línea sólida: vuelta · punteada: media móvil (3)</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: '#141923', borderRadius: 8, padding: 8, marginTop: 12 },
  empty: { color: '#6b7480', fontSize: 13, textAlign: 'center', paddingVertical: 40 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 6, marginTop: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' },
  swatch: { width: 12, height: 12, borderRadius: 3 },
  legendText: { color: '#cfd5dc', fontSize: 12, flexShrink: 1 },
  note: { color: '#6b7480', fontSize: 10, paddingHorizontal: 6, marginTop: 6 },
});

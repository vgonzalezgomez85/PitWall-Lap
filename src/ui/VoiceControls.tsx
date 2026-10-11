// Avisos de voz: chips de avisos y de avisos periódicos. Lo usan «Mi turno»
// (en vivo, durante la sesión) y Ajustes (los valores con los que arranca cada
// sesión). El interruptor general de la voz va aparte.
// `full`: PitWall o TicTac nuevo (todos los avisos); TicTac antiguo, solo vueltas.

import { StyleSheet, Text, View } from 'react-native';

import type { VoiceSettings } from '../voice/settings';
import { useIdioma } from '../i18n/IdiomaContext';
import Card from './Card';
import Chip from './Chip';
import { spacing, type } from './theme';

// Cicla por 0 (off) → 1 → 2 → 3 → 5 → 0 cada vez que se pulsa el chip.
const MINUTE_CYCLE = [0, 1, 2, 3, 5];
export function cycleMinutes(current: number): number {
  const i = MINUTE_CYCLE.indexOf(current);
  return MINUTE_CYCLE[(i + 1) % MINUTE_CYCLE.length] ?? 0;
}

interface Props {
  settings: VoiceSettings;
  toggle: (k: keyof VoiceSettings) => void;
  update: (p: Partial<VoiceSettings>) => void;
  full: boolean;
}

export default function VoiceControls({ settings, toggle, update, full }: Props) {
  const { t } = useIdioma();
  const c = t.turno;
  return (
    <Card style={[styles.card, !settings.enabled && styles.dimmed]}>
      <Text style={type.label}>{c.avisosVoz}</Text>
      <View style={styles.togglesRow}>
        <Chip label={c.chipVueltas} active={settings.sayLaps} onPress={() => toggle('sayLaps')} />
        {full && (
          <>
            <Chip label={c.chipPosicion}   active={settings.sayPositionChange} onPress={() => toggle('sayPositionChange')} />
            <Chip label={c.chipMitadManga} active={settings.sayHalfManga}      onPress={() => toggle('sayHalfManga')} />
            <Chip label={c.chipUltimoMin}  active={settings.sayLastMinute}     onPress={() => toggle('sayLastMinute')} />
            <Chip label={c.chip30s}        active={settings.sayLast30s}        onPress={() => toggle('sayLast30s')} />
          </>
        )}
      </View>
      {full && (
        <>
          <Text style={[type.label, styles.subLabel]}>{c.periodicos}</Text>
          <View style={styles.togglesRow}>
            <Chip
              label={settings.sayAveragesEveryMin > 0 ? c.cadaMin(c.chipMediaCarril, settings.sayAveragesEveryMin) : c.chipMediaCarril}
              active={settings.sayAveragesEveryMin > 0}
              onPress={() => update({ sayAveragesEveryMin: cycleMinutes(settings.sayAveragesEveryMin) })}
            />
            <Chip
              label={settings.sayRaceAvgEveryMin > 0 ? c.cadaMin(c.chipMediaCarrera, settings.sayRaceAvgEveryMin) : c.chipMediaCarrera}
              active={settings.sayRaceAvgEveryMin > 0}
              onPress={() => update({ sayRaceAvgEveryMin: cycleMinutes(settings.sayRaceAvgEveryMin) })}
            />
            <Chip
              label={settings.sayGapsEveryMin > 0 ? c.cadaMin(c.chipGaps, settings.sayGapsEveryMin) : c.chipGaps}
              active={settings.sayGapsEveryMin > 0}
              onPress={() => update({ sayGapsEveryMin: cycleMinutes(settings.sayGapsEveryMin) })}
            />
            <Chip
              label={settings.sayCatchUpEveryMin > 0 ? c.cadaMin(c.chipParaSubir, settings.sayCatchUpEveryMin) : c.chipParaSubir}
              active={settings.sayCatchUpEveryMin > 0}
              onPress={() => update({ sayCatchUpEveryMin: cycleMinutes(settings.sayCatchUpEveryMin) })}
            />
          </View>
        </>
      )}
      {!settings.enabled && (
        <Text style={[type.caption, styles.subLabel]}>{c.vozApagada}</Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md },
  dimmed: { opacity: 0.5 },
  subLabel: { marginTop: spacing.lg },
  togglesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
});

// Pantalla "Novedades": historial de versiones de la app. El contenido sale
// de CHANGELOG.md (embebido en build por scripts/sync-changelog.js) y la
// versión actual del propio binario (expo-constants). Mismo formato y
// convención que PitWall Manager y PitWall Control.

import type { StyleProp, TextStyle } from 'react-native';
import { FlatList, Platform, StyleSheet, Text, View } from 'react-native';

import { getCurrentVersion } from '../data/appVersion';
import {
  CHANGELOG_VERSIONS,
  type ChangeSection,
  type ChangeSpan,
  type ChangeVersion,
} from '../data/changelog';
import { useIdioma } from '../i18n/IdiomaContext';
import BackButton from '../ui/BackButton';

/** Color de la sección según su título (Añadido / Mejorado / Corregido). */
function sectionColor(title: string): string {
  if (/a[ñn]adido/i.test(title)) return '#4ade80';
  if (/mejorado/i.test(title)) return '#60a5fa';
  if (/corregido/i.test(title)) return '#fb923c';
  return '#9aa3ad';
}

/** Texto con spans: **negrita** y `código` como <Text> anidados. */
function InlineText({ spans, style }: { spans: ChangeSpan[]; style: StyleProp<TextStyle> }) {
  return (
    <Text style={style}>
      {spans.map((s, i) => (
        <Text
          key={i}
          style={s.bold ? styles.bold : s.code ? styles.code : undefined}
        >
          {s.text}
        </Text>
      ))}
    </Text>
  );
}

function SectionBlock({ section }: { section: ChangeSection }) {
  const color = sectionColor(section.title);
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color }]}>{section.title}</Text>
      {section.items.map((spans, i) => (
        <View key={i} style={styles.itemRow}>
          <Text style={[styles.itemDot, { color }]}>·</Text>
          <InlineText spans={spans} style={styles.itemText} />
        </View>
      ))}
    </View>
  );
}

function VersionCard({ v, current }: { v: ChangeVersion; current: boolean }) {
  const { t } = useIdioma();
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={[styles.pill, current && styles.pillCurrent]}>
          <Text style={[styles.pillText, current && styles.pillTextCurrent]}>v{v.version}</Text>
        </View>
        {v.date !== '' && <Text style={styles.date}>{v.date}</Text>}
        {current && <Text style={styles.currentBadge}>{t.novedades.actual}</Text>}
      </View>
      {v.notes.map((spans, i) => (
        <InlineText key={i} spans={spans} style={styles.noteText} />
      ))}
      {v.sections.map((s, i) => (
        <SectionBlock key={i} section={s} />
      ))}
    </View>
  );
}

export default function ChangelogScreen() {
  const { t } = useIdioma();
  return (
    <View style={styles.root}>
      <BackButton />
      <Text style={styles.title}>{t.novedades.titulo}</Text>
      <Text style={styles.subtitle}>{t.novedades.versionActual(getCurrentVersion())}</Text>
      {!!t.novedades.notaIdioma && <Text style={styles.subtitle}>{t.novedades.notaIdioma}</Text>}
      <FlatList
        data={CHANGELOG_VERSIONS}
        keyExtractor={v => v.version}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.empty}>{t.novedades.vacio}</Text>}
        renderItem={({ item, index }) => <VersionCard v={item} current={index === 0} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 20, backgroundColor: '#0a0d13' },
  title: { color: '#f6c90e', fontSize: 26, fontWeight: '700', marginTop: 4 },
  subtitle: { color: '#9aa3ad', fontSize: 13, marginTop: 4, marginBottom: 4 },
  listContent: { paddingVertical: 12, paddingBottom: 32 },
  empty: {
    color: '#9aa3ad', fontSize: 14, textAlign: 'center',
    marginTop: 48, lineHeight: 22,
  },

  card: {
    backgroundColor: '#141923', borderRadius: 8,
    padding: 16, marginVertical: 6,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  pill: {
    borderColor: '#3a4350', borderWidth: 1, borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 3,
  },
  pillCurrent: { backgroundColor: '#f6c90e', borderColor: '#f6c90e' },
  pillText: { color: '#cfd5dc', fontSize: 13, fontWeight: '700' },
  pillTextCurrent: { color: '#0a0d13' },
  date: { color: '#9aa3ad', fontSize: 12, marginLeft: 10 },
  currentBadge: {
    color: '#f6c90e', fontSize: 11, fontWeight: '700',
    marginLeft: 'auto', textTransform: 'uppercase',
  },

  section: { marginTop: 10 },
  sectionTitle: {
    fontSize: 12, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.5, marginBottom: 6,
  },
  itemRow: { flexDirection: 'row', marginBottom: 8 },
  itemDot: { fontSize: 14, lineHeight: 21, marginRight: 8 },
  itemText: { flex: 1, color: '#cfd5dc', fontSize: 13.5, lineHeight: 21 },
  noteText: { color: '#cfd5dc', fontSize: 13.5, lineHeight: 21, marginBottom: 8 },

  bold: { fontWeight: '700', color: '#e6edf3' },
  code: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    color: '#79c0ff', backgroundColor: '#161b22',
  },
});

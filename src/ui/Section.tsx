// Bloque con encabezado de sección. Con `collapsible` el encabezado se pulsa
// para plegar/desplegar el contenido y `summary` resume lo que hay dentro
// mientras está plegado.

import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, spacing, type } from './theme';

interface Props {
  title: string;
  children: ReactNode;
  collapsible?: boolean;
  initiallyOpen?: boolean;
  summary?: string;
}

export default function Section({
  title, children, collapsible, initiallyOpen = true, summary,
}: Props) {
  const [open, setOpen] = useState(!collapsible || initiallyOpen);

  const header = (
    <View style={styles.header}>
      <Text style={type.label}>{title}</Text>
      {collapsible && (
        <View style={styles.headerRight}>
          {!open && !!summary && <Text style={styles.summary} numberOfLines={1}>{summary}</Text>}
          <Text style={styles.toggle}>{open ? 'Ocultar' : 'Mostrar'}</Text>
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.root}>
      {collapsible ? (
        <Pressable onPress={() => setOpen(o => !o)} hitSlop={8}>{header}</Pressable>
      ) : header}
      {open && <View style={styles.body}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { marginTop: spacing.xxl },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 24, gap: spacing.md,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
  summary: { color: colors.textFaint, fontSize: 12, flexShrink: 1 },
  toggle: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  body: { marginTop: spacing.md },
});

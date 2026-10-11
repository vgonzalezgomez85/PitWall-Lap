// Almacén local de las carreras del calendario (AsyncStorage). Son pocas, así
// que viven en una sola clave con la lista completa.

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Evento } from './calendario';

const KEY = '@pitwall/calendario/v1';

export async function listEventos(): Promise<Evento[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Evento[]) : [];
  } catch {
    return [];
  }
}

export async function getEvento(id: string): Promise<Evento | null> {
  return (await listEventos()).find(e => e.id === id) ?? null;
}

/** Crea el evento o, si ya existe su id, lo reemplaza. */
export async function saveEvento(evento: Evento): Promise<void> {
  const lista = (await listEventos()).filter(e => e.id !== evento.id);
  lista.push(evento);
  await AsyncStorage.setItem(KEY, JSON.stringify(lista));
}

export async function deleteEvento(id: string): Promise<void> {
  const lista = (await listEventos()).filter(e => e.id !== id);
  await AsyncStorage.setItem(KEY, JSON.stringify(lista));
}

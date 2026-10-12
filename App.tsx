import { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { setAudioModeAsync } from 'expo-audio';

import { SourceProvider } from './src/data/sourceContext';
import { TireStrategyProvider } from './src/strategy/useTireStrategy';
import { useAutoSaveHistory } from './src/data/useAutoSaveHistory';
import { migrateLegacyStorage } from './src/data/migrateStorage';
import { prewarmLocalNetworkPermission } from './src/data/discovery';
import HomeScreen        from './src/screens/HomeScreen';
import CalendarioScreen from './src/screens/CalendarioScreen';
import EventoScreen     from './src/screens/EventoScreen';
import CarrerasWebScreen from './src/screens/CarrerasWebScreen';
import ArchivoResultadoScreen from './src/screens/ArchivoResultadoScreen';
import EntrenosCompeticionScreen from './src/screens/EntrenosCompeticionScreen';
import EntrenoCompeticionScreen  from './src/screens/EntrenoCompeticionScreen';
import DiscoveryScreen   from './src/screens/DiscoveryScreen';
import RacePickerScreen  from './src/screens/RacePickerScreen';
import TandaPickerScreen from './src/screens/TandaPickerScreen';
import TrainingLanePickerScreen from './src/screens/TrainingLanePickerScreen';
import PoleScreen          from './src/screens/PoleScreen';
import SelectScreen      from './src/screens/SelectScreen';
import MyTurnScreen      from './src/screens/MyTurnScreen';
import StrategyScreen    from './src/screens/StrategyScreen';
import TrackingScreen    from './src/screens/TrackingScreen';
import HistoryScreen     from './src/screens/HistoryScreen';
import HistoryDetailScreen from './src/screens/HistoryDetailScreen';
import ChangelogScreen from './src/screens/ChangelogScreen';
import IdiomaScreen from './src/screens/IdiomaScreen';
import { IdiomaProvider } from './src/i18n/IdiomaContext';
import { AjustesProvider } from './src/data/AjustesContext';
import AjustesScreen from './src/screens/AjustesScreen';
import TrainingScreen     from './src/screens/TrainingScreen';
import StintDetailScreen  from './src/screens/StintDetailScreen';
import type { RootStackParamList } from './src/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

function AppInner() {
  // Hook que escucha snapshots de fin de carrera y los persiste localmente.
  // Tiene que ir DENTRO de SourceProvider para acceder al subscribe.
  useAutoSaveHistory();
  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#0a0d13' },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="Home"          component={HomeScreen} />
        <Stack.Screen name="Calendario"    component={CalendarioScreen} />
        <Stack.Screen name="Evento"        component={EventoScreen} />
        <Stack.Screen name="CarrerasWeb"   component={CarrerasWebScreen} />
        <Stack.Screen name="ArchivoResultado" component={ArchivoResultadoScreen} />
        <Stack.Screen name="EntrenosCompeticion" component={EntrenosCompeticionScreen} />
        <Stack.Screen name="EntrenoCompeticion"  component={EntrenoCompeticionScreen} />
        <Stack.Screen name="Discovery"     component={DiscoveryScreen} />
        <Stack.Screen name="RacePicker"    component={RacePickerScreen} />
        <Stack.Screen name="TandaPicker"   component={TandaPickerScreen} />
        <Stack.Screen name="TrainingLanePicker" component={TrainingLanePickerScreen} />
        <Stack.Screen name="Pole"          component={PoleScreen} />
        <Stack.Screen name="Select"        component={SelectScreen} />
        <Stack.Screen name="MyTurn"        component={MyTurnScreen} />
        <Stack.Screen name="Strategy"      component={StrategyScreen} />
        <Stack.Screen name="Tracking"      component={TrackingScreen} />
        <Stack.Screen name="History"       component={HistoryScreen} />
        <Stack.Screen name="HistoryDetail" component={HistoryDetailScreen} />
        <Stack.Screen name="Changelog"     component={ChangelogScreen} />
        <Stack.Screen name="Idioma"        component={IdiomaScreen} />
        <Stack.Screen name="Ajustes"       component={AjustesScreen} />
        <Stack.Screen name="Training"      component={TrainingScreen} />
        <Stack.Screen name="StintDetail"   component={StintDetailScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  // Migración de claves AsyncStorage legadas (@slotime/, @voltrace/ →
  // @pitwall/) antes de montar ninguna pantalla: Discovery/History/etc.
  // leen su storage en el primer render y no deben ver la clave nueva
  // vacía mientras la vieja todavía tiene los datos.
  const [migrated, setMigrated] = useState(false);

  useEffect(() => {
    migrateLegacyStorage().finally(() => setMigrated(true));
  }, []);

  useEffect(() => {
    prewarmLocalNetworkPermission();
  }, []);

  useEffect(() => {
    // Sesión de audio que permite locución por TTS:
    //   • con la pantalla bloqueada (shouldPlayInBackground)
    //   • con el silencio físico activado (playsInSilentMode)
    //   • sin matar audio externo, como música/podcast en marcha
    //     (interruptionMode: mixWithOthers).
    setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'mixWithOthers',
    }).catch((e) => console.warn('[Audio] setAudioModeAsync failed:', e));
  }, []);

  if (!migrated) return null;

  return (
    <SafeAreaProvider>
      <IdiomaProvider>
        <AjustesProvider>
          <SourceProvider>
            <TireStrategyProvider>
              <AppInner />
            </TireStrategyProvider>
          </SourceProvider>
        </AjustesProvider>
      </IdiomaProvider>
    </SafeAreaProvider>
  );
}

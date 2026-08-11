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
import DiscoveryScreen   from './src/screens/DiscoveryScreen';
import RacePickerScreen  from './src/screens/RacePickerScreen';
import TandaPickerScreen from './src/screens/TandaPickerScreen';
import TrainingLanePickerScreen from './src/screens/TrainingLanePickerScreen';
import PoleScreen          from './src/screens/PoleScreen';
import SelectScreen      from './src/screens/SelectScreen';
import MyTurnScreen      from './src/screens/MyTurnScreen';
import StrategyScreen    from './src/screens/StrategyScreen';
import HistoryScreen     from './src/screens/HistoryScreen';
import HistoryDetailScreen from './src/screens/HistoryDetailScreen';
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
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#0a0d13' },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="Discovery"     component={DiscoveryScreen} />
        <Stack.Screen name="RacePicker"    component={RacePickerScreen} />
        <Stack.Screen name="TandaPicker"   component={TandaPickerScreen} />
        <Stack.Screen name="TrainingLanePicker" component={TrainingLanePickerScreen} />
        <Stack.Screen name="Pole"          component={PoleScreen} />
        <Stack.Screen name="Select"        component={SelectScreen} />
        <Stack.Screen name="MyTurn"        component={MyTurnScreen} />
        <Stack.Screen name="Strategy"      component={StrategyScreen} />
        <Stack.Screen name="History"       component={HistoryScreen} />
        <Stack.Screen name="HistoryDetail" component={HistoryDetailScreen} />
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
      <SourceProvider>
        <TireStrategyProvider>
          <AppInner />
        </TireStrategyProvider>
      </SourceProvider>
    </SafeAreaProvider>
  );
}

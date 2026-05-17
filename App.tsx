import { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { setAudioModeAsync } from 'expo-audio';

import { SourceProvider } from './src/data/sourceContext';
import { useAutoSaveHistory } from './src/data/useAutoSaveHistory';
import DiscoveryScreen   from './src/screens/DiscoveryScreen';
import RacePickerScreen  from './src/screens/RacePickerScreen';
import TandaPickerScreen from './src/screens/TandaPickerScreen';
import TrainingLanePickerScreen from './src/screens/TrainingLanePickerScreen';
import SelectScreen      from './src/screens/SelectScreen';
import MyTurnScreen      from './src/screens/MyTurnScreen';
import HistoryScreen     from './src/screens/HistoryScreen';
import HistoryDetailScreen from './src/screens/HistoryDetailScreen';
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
        <Stack.Screen name="Select"        component={SelectScreen} />
        <Stack.Screen name="MyTurn"        component={MyTurnScreen} />
        <Stack.Screen name="History"       component={HistoryScreen} />
        <Stack.Screen name="HistoryDetail" component={HistoryDetailScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
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

  return (
    <SafeAreaProvider>
      <SourceProvider>
        <AppInner />
      </SourceProvider>
    </SafeAreaProvider>
  );
}

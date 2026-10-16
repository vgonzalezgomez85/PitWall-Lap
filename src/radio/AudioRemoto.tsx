// Reproduce los flujos de audio remotos montando un `RTCView` (invisible) por
// cada uno. En iOS, aunque sea audio sin vídeo, hay que montar el `RTCView`
// para que se reproduzca la voz entrante. El view se deja a 1×1 px: no hay
// vídeo que enseñar.

import { View } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import type { MediaStream } from 'react-native-webrtc';

export function AudioRemoto({ pistas }: { pistas: MediaStream[] }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', width: 0, height: 0, opacity: 0 }}>
      {pistas.map(flujo => (
        <RTCView
          key={flujo.toURL()}
          streamURL={flujo.toURL()}
          style={{ width: 1, height: 1 }}
        />
      ))}
    </View>
  );
}

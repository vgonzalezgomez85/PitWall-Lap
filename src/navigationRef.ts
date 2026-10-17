// Ref del contenedor de navegación, compartido con componentes que viven fuera
// del árbol de pantallas (p. ej. el overlay flotante de Radio), que necesitan
// navegar y conocer la ruta actual sin estar dentro de un screen.

import { createNavigationContainerRef } from '@react-navigation/native';

import type { RootStackParamList } from './navigation';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

// Tipos compartidos del stack de navegación.
//
// Sirven para que `useNavigation` / `useRoute` / props de screens estén
// totalmente tipados. La rutas se declaran en App.tsx.

export type RootStackParamList = {
  Home: undefined;
  Calendario: undefined;
  Evento: { id?: string } | undefined;
  CarrerasWeb: undefined;
  ArchivoResultado: { id: string };
  Discovery: undefined;
  RacePicker: { host: string; port: number };
  TandaPicker: { host: string; port: number; raceId: number };
  TrainingLanePicker: { host: string; port: number };
  Pole: { host: string; port: number; raceId: number };
  Select: { tandaNum?: number } | undefined;
  MyTurn: undefined;
  Strategy: undefined;
  Tracking: undefined;
  History: undefined;
  HistoryDetail: { raceId: number | string };
  Changelog: undefined;
  Idioma: undefined;
  Ajustes: undefined;
  Training: undefined;
  EntrenosCompeticion: undefined;
  EntrenoCompeticion: { id: string };
  StintDetail: { id: string; compareIds?: string[] };
  Radio: undefined;
  RadioSala: undefined;
};

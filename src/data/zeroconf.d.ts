// Tipos mínimos para react-native-zeroconf v0.14. El paquete no envía
// declarations propias.
declare module 'react-native-zeroconf' {
  export interface ResolvedService {
    name: string;
    fullName?: string;
    host: string;
    port: number;
    addresses?: string[];
    txt?: Record<string, string>;
  }

  type ServiceEvent = 'resolved' | 'found' | 'remove' | 'update';
  type ScanEvent = 'start' | 'stop' | 'error';

  export default class Zeroconf {
    constructor();
    scan(type: string, protocol: string, domain?: string): void;
    stop(): void;
    removeDeviceListeners(): void;
    publishService(
      type: string,
      protocol: string,
      domain: string,
      name: string,
      port: number,
      txt?: Record<string, string>,
    ): void;
    on(event: 'resolved', cb: (svc: ResolvedService) => void): this;
    on(event: 'found', cb: (name: string) => void): this;
    on(event: 'remove', cb: (name: string) => void): this;
    on(event: 'update', cb: () => void): this;
    on(event: 'error', cb: (err: Error) => void): this;
    on(event: ScanEvent | ServiceEvent, cb: (...args: unknown[]) => void): this;
  }
}

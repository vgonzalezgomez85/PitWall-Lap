// Tipos mínimos para react-native-tcp-socket (Fase 1 de Radio). El paquete
// aún no está en package.json: esta declaración permite que `tcp.ts`
// compile; para usarlo en un dispositivo hay que `npm install
// react-native-tcp-socket` y hacer `expo prebuild` (ver radio.md §5, "a
// validar en la prueba de concepto").

declare module 'react-native-tcp-socket' {
  export interface TcpSocket {
    write(data: string | Uint8Array): void;
    end(): void;
    destroy(): void;
    on(event: 'data', cb: (data: Uint8Array) => void): this;
    on(event: 'close', cb: () => void): this;
    on(event: 'error', cb: (err: Error) => void): this;
    on(event: string, cb: (...args: unknown[]) => void): this;
  }

  export interface TcpServer {
    listen(opts: { port: number; host: string }, cb?: () => void): void;
    close(cb?: () => void): void;
    on(event: 'listening' | 'error' | 'connection' | 'close', cb: (arg?: unknown) => void): this;
    once(event: 'listening' | 'error' | 'connection' | 'close', cb: (arg?: unknown) => void): this;
  }

  const TcpSocket: {
    createServer(onConnection: (socket: TcpSocket) => void): TcpServer;
    createConnection(
      opts: { port: number; host: string },
      cb?: () => void,
    ): TcpSocket;
  };

  export default TcpSocket;
}

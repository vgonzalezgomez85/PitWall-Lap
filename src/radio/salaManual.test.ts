jest.mock('react-native-zeroconf', () => ({}));
jest.mock('react-native-tcp-socket', () => ({}));

import { generarCodigo } from './codigo';
import { ipValida, salaInternet, salaManual } from './salaManual';

describe('ipValida', () => {
  it('acepta IPv4 normales y de zona WiFi de iPhone', () => {
    expect(ipValida('192.168.1.34')).toBe(true);
    expect(ipValida(' 172.20.10.1 ')).toBe(true);
  });

  it('rechaza lo que no es una IPv4', () => {
    expect(ipValida('')).toBe(false);
    expect(ipValida('192.168.1')).toBe(false);
    expect(ipValida('192.168.1.256')).toBe(false);
    expect(ipValida('iphone.local')).toBe(false);
    expect(ipValida('1.2.3.4.5')).toBe(false);
  });
});

describe('salaManual', () => {
  const codigo = generarCodigo(() => 0.5);

  it('construye la sala con el código formateado', () => {
    const sala = salaManual('172.20.10.1', codigo.toLowerCase().replace('-', ''), 7080);
    expect(sala).toEqual({
      host: '172.20.10.1', puerto: 7080, codigo, nombre: `Radio ${codigo}`,
    });
  });

  it('devuelve null si falta la IP o el código', () => {
    expect(salaManual('', codigo, 7080)).toBeNull();
    expect(salaManual('172.20.10.1', 'ABC', 7080)).toBeNull();
  });
});

describe('salaInternet', () => {
  it('solo necesita el código y marca el modo internet', () => {
    const codigo = generarCodigo(() => 0.3);
    expect(salaInternet(codigo.replace('-', '').toLowerCase())).toMatchObject({ codigo, modo: 'internet' });
    expect(salaInternet('ABC')).toBeNull();
  });
});

jest.mock('react-native-tts', () => ({}));
jest.mock('../../modules/backgroundtts', () => ({}));

import { speakTime } from './speak';

describe('speakTime', () => {
  it('segundos y centésimas, sin "con"', () => {
    expect(speakTime(12_450)).toBe('12 45');
    expect(speakTime(10_050)).toBe('10 05');
  });

  it('las centésimas exactas se dicen "cero cero", no "segundos"', () => {
    expect(speakTime(10_000)).toBe('10 cero cero');
    expect(speakTime(10_009)).toBe('10 cero cero');   // truncado, no redondeado
  });

  it('sin tiempo', () => {
    expect(speakTime(null)).toBe('sin tiempo');
  });
});

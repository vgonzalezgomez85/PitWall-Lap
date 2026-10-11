import { extension, tipoDeArchivo, tituloDeFichero } from './archivosResultados';

describe('tipoDeArchivo', () => {
  it('reconoce Excel por MIME o por extensión', () => {
    expect(tipoDeArchivo('r.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('excel');
    expect(tipoDeArchivo('24h_Modena_resultados (3).xlsx')).toBe('excel');
    expect(tipoDeArchivo('datos.CSV')).toBe('excel');
  });

  it('reconoce PDF e imágenes', () => {
    expect(tipoDeArchivo('clasificacion.pdf', 'application/pdf')).toBe('pdf');
    expect(tipoDeArchivo('x.PDF')).toBe('pdf');
    expect(tipoDeArchivo('foto.HEIC')).toBe('imagen');
    expect(tipoDeArchivo('sin-extension', 'image/jpeg')).toBe('imagen');
  });

  it('lo demás es "otro"', () => {
    expect(tipoDeArchivo('notas.txt', 'text/plain')).toBe('otro');
    expect(tipoDeArchivo('sin-extension')).toBe('otro');
  });
});

describe('extension y tituloDeFichero', () => {
  it('extrae la extensión en minúsculas', () => {
    expect(extension('a.b.XLSX')).toBe('xlsx');
    expect(extension('sin')).toBe('');
  });

  it('el título es el nombre sin extensión', () => {
    expect(tituloDeFichero('24h_Modena_resultados (3).xlsx')).toBe('24h_Modena_resultados (3)');
    expect(tituloDeFichero('sin-extension')).toBe('sin-extension');
  });
});

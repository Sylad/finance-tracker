import { BadRequestException } from '@nestjs/common';
import { decodeUploadFilename, pdfFileFilter } from './pdf-upload-filter';

type Cb = (err: Error | null, accept: boolean) => void;

function run(file: { originalname: string; mimetype: string }) {
  let err: Error | null = null;
  let accepted: boolean | undefined;
  const cb: Cb = (e, a) => { err = e; accepted = a; };
  pdfFileFilter({}, file as Express.Multer.File, cb);
  return { err, accepted };
}

describe('Nom de fichier téléversé (L113)', () => {
  it('R1 — un nom UTF-8 relu en latin1 par multer est rétabli', () => {
    const mangled = Buffer.from('relevé_août.pdf', 'utf8').toString('latin1');
    expect(mangled).toBe('relevÃ©_aoÃ»t.pdf');
    expect(decodeUploadFilename(mangled)).toBe('relevé_août.pdf');
  });

  it('R1 — un nom déjà correct, ASCII ou accentué en latin1 pur, reste tel quel', () => {
    expect(decodeUploadFilename('releve.pdf')).toBe('releve.pdf');
    expect(decodeUploadFilename('relevé.pdf')).toBe('relevé.pdf');
  });

  it('R1 — un nom avec un caractère hors latin1 reste tel quel', () => {
    expect(decodeUploadFilename('relevé€.pdf')).toBe('relevé€.pdf');
  });

  it('R1 — le filtre corrige originalname avant le stockage et accepte un PDF', () => {
    const file = { originalname: Buffer.from('août.pdf', 'utf8').toString('latin1'), mimetype: 'application/pdf' };
    const { err, accepted } = run(file);
    expect(err).toBeNull();
    expect(accepted).toBe(true);
    expect(file.originalname).toBe('août.pdf');
  });

  it('R1 — le filtre refuse un fichier qui n’est pas un PDF', () => {
    const { err, accepted } = run({ originalname: 'a.txt', mimetype: 'text/plain' });
    expect(err).toBeInstanceOf(BadRequestException);
    expect(accepted).toBe(false);
  });
});

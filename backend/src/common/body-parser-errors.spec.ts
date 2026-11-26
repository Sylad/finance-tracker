import {
  DEFAULT_BODY_LIMIT,
  parseBodyLimit,
  toHttpException,
} from './body-parser-errors';

describe('parseBodyLimit (BODY_LIMIT, L186)', () => {
  it.each([undefined, '', '   '])('« %s » → repli sur 100kb', (raw) => {
    expect(parseBodyLimit(raw)).toEqual({
      bytes: 100 * 1024,
      label: DEFAULT_BODY_LIMIT,
    });
  });

  it.each([
    ['102400', 102400],
    ['512b', 512],
    ['1kb', 1024],
    ['100kb', 102400],
    ['2mb', 2 * 1024 ** 2],
    ['1.5MB', 1.5 * 1024 ** 2],
    ['1gb', 1024 ** 3],
    [' 2mb ', 2 * 1024 ** 2],
  ])('« %s » → %d octets', (raw, bytes) => {
    expect(parseBodyLimit(raw)).toEqual({ bytes, label: raw.trim() });
  });

  it.each(['2m', 'abc', '0', '0kb', '-1kb', '1.5', '10 tb', 'kb'])(
    '« %s » → refus de démarrer, message qui cite la valeur',
    (raw) => {
      expect(() => parseBodyLimit(raw)).toThrow(
        `BODY_LIMIT invalide : « ${raw} »`,
      );
    },
  );
});

describe('toHttpException', () => {
  const body = (e: ReturnType<typeof toHttpException>) => e.getResponse();

  it('trop de champs de formulaire → 413 qui ne parle pas de taille', () => {
    const e = toHttpException(
      { type: 'parameters.too.many', status: 413 },
      '100kb',
    );
    expect(e.getStatus()).toBe(413);
    expect(body(e)).toMatchObject({
      message: 'Le formulaire contient trop de champs (1000 au plus).',
    });
    expect(JSON.stringify(body(e))).not.toContain('100kb');
  });

  it.each(['encoding.unsupported', 'charset.unsupported'])(
    '%s → 415',
    (type) => {
      const e = toHttpException({ type, status: 415 }, '100kb');
      expect(e.getStatus()).toBe(415);
      expect(body(e)).toMatchObject({ error: 'Unsupported Media Type' });
    },
  );

  it('autre erreur du parseur → son statut, message générique', () => {
    const e = toHttpException({ type: 'request.aborted', status: 400 }, 'x');
    expect(e.getStatus()).toBe(400);
    expect(body(e)).toEqual({
      statusCode: 400,
      message: 'Corps de la requête illisible.',
    });
  });

  it('statut hors 4xx/5xx → 400', () => {
    const e = toHttpException(
      { type: 'stream.encoding.set', status: 200 },
      'x',
    );
    expect(e.getStatus()).toBe(400);
  });
});

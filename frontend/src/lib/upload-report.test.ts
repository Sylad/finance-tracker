import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { failuresFromUploadError, skippedMonthLabel } from './upload-report';

const names = ['a.pdf', 'b.pdf'];

describe('failuresFromUploadError (L109)', () => {
  it('R1 — le 422 rend les raisons par fichier du serveur, sans nom « upload »', () => {
    const body = { message: "Aucun relevé n'a pu être analysé", errors: [
      { filename: 'a.pdf', error: 'Document non reconnu' },
      { filename: 'b.pdf', error: 'Analyse échouée : JSON tronqué' },
    ] };
    const r = failuresFromUploadError(new ApiError(422, body.message, body), names);
    expect(r).toEqual(body.errors);
    expect(r.some((f) => f.filename === 'upload')).toBe(false);
  });

  it('R2 — une erreur 500 est dite en français et attribuée à chaque fichier envoyé', () => {
    const r = failuresFromUploadError(new ApiError(500, 'Internal server error'), names);
    expect(r.map((f) => f.filename)).toEqual(names);
    for (const f of r) {
      expect(f.error).not.toMatch(/internal|HTTP|server error/i);
      expect(f.error).toMatch(/serveur/);
    }
  });

  it('R3 — toute autre erreur garde son message, par fichier', () => {
    const r = failuresFromUploadError(new ApiError(400, 'Seuls les fichiers PDF sont acceptés'), ['a.pdf']);
    expect(r).toEqual([{ filename: 'a.pdf', error: 'Seuls les fichiers PDF sont acceptés' }]);
  });

  it('R3 — un 422 sans errors[] exploitable retombe sur le message, par fichier', () => {
    const r = failuresFromUploadError(new ApiError(422, 'Refusé', { message: 'Refusé' }), ['a.pdf']);
    expect(r).toEqual([{ filename: 'a.pdf', error: 'Refusé' }]);
  });
});

describe('failuresFromUploadError — messages d’erreur honnêtes et en français (L113)', () => {
  it('R3 — un 502 ou 503 ne dit pas « non importé » : le traitement a pu continuer côté serveur', () => {
    for (const status of [502, 503]) {
      const [f] = failuresFromUploadError(new ApiError(status, `HTTP ${status}`), ['a.pdf']);
      expect(f.error).not.toMatch(/n'a pas été importé|HTTP/i);
      expect(f.error).toMatch(/historique/);
    }
  });

  it('R3 — un 500 garde « n’a pas été importé » (le serveur a répondu lui-même)', () => {
    const [f] = failuresFromUploadError(new ApiError(500, 'Internal server error'), ['a.pdf']);
    expect(f.error).toMatch(/n'a pas été importé/);
  });

  it('R4 — un 413 sans corps est dit en français, avec la limite de 20 Mo', () => {
    const [f] = failuresFromUploadError(new ApiError(413, 'HTTP 413'), ['a.pdf']);
    expect(f.error).not.toMatch(/HTTP/);
    expect(f.error).toMatch(/20 Mo/);
  });

  it('R4 — tout autre « HTTP n » brut est remplacé par une phrase française', () => {
    const [f] = failuresFromUploadError(new ApiError(418, 'HTTP 418'), ['a.pdf']);
    expect(f.error).not.toMatch(/HTTP/);
    expect(f.error).toMatch(/418/);
  });
});

describe('skippedMonthLabel (L109)', () => {
  it('R4 — l’identifiant AAAA-MM devient « Mars 2026 »', () => {
    expect(skippedMonthLabel('2026-03')).toBe('Mars 2026');
  });
  it('R4 — un identifiant illisible est rendu tel quel', () => {
    expect(skippedMonthLabel('abc')).toBe('abc');
  });
});

import { BadRequestException } from '@nestjs/common';

/**
 * multer relit le nom de fichier multipart en latin1 alors que le navigateur l'envoie en UTF-8 :
 * « é » arrive en « Ã© ». Rétablit l'UTF-8 quand les octets en sont un (sinon le nom est rendu tel quel).
 */
export function decodeUploadFilename(name: string): string {
  if ([...name].some((c) => c.charCodeAt(0) > 255)) return name;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(name, 'latin1'));
  } catch {
    return name;
  }
}

/** `fileFilter` multer commun : corrige le nom au stockage (`originalname`) et n'accepte que les PDF. */
export function pdfFileFilter(
  _req: unknown,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile: boolean) => void,
): void {
  file.originalname = decodeUploadFilename(file.originalname);
  if (file.mimetype !== 'application/pdf') {
    return cb(new BadRequestException('Seuls les fichiers PDF sont acceptés'), false);
  }
  cb(null, true);
}

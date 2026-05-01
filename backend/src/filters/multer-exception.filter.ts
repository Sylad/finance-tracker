import { ExceptionFilter, Catch, ArgumentsHost } from '@nestjs/common';
import { Response } from 'express';
import { MulterError } from 'multer';

@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(error: MulterError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const message =
      error.code === 'LIMIT_FILE_SIZE'
        ? 'Le fichier dépasse la limite de 20 MB'
        : error.code === 'LIMIT_UNEXPECTED_FILE'
          ? 'Champ de fichier invalide, utilisez "file"'
          : `Erreur upload : ${error.message}`;
    res.status(400).json({ statusCode: 400, message });
  }
}

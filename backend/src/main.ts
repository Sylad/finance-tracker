import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { PinGuard } from './guards/pin.guard';
import { DemoWriteGuard } from './guards/demo-write.guard';
import { RequestDataDirService } from './modules/demo/request-data-dir.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');
  app.useGlobalGuards(
    new PinGuard(app.get(ConfigService)),
    new DemoWriteGuard(app.get(RequestDataDirService)),
  );

  app.enableCors({
    origin: config.get<string>('corsOrigin'),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Accept', 'Authorization', 'X-Demo-Mode'],
  });

  const port = config.get<number>('port') ?? 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`Backend running on http://localhost:${port}/api`);
}
bootstrap();

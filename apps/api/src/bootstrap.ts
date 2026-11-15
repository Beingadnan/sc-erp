import { VersioningType } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import type { ApiConfig } from './config/api-config.js';

/** Builds the configured Nest application (used by main.ts and the e2e tests). */
export const createApp = async (config: ApiConfig): Promise<INestApplication> => {
  const app = await NestFactory.create(AppModule.forRoot(config), {
    logger: config.NODE_ENV === 'test' ? false : ['log', 'warn', 'error'],
  });

  app.use(helmet());
  app.use(cookieParser());
  if (config.TRUST_PROXY_HOPS > 0) {
    app.getHttpAdapter().getInstance().set('trust proxy', config.TRUST_PROXY_HOPS);
  }
  app.enableCors({
    origin: config.API_CORS_ORIGINS,
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-Id'],
  });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();

  if (config.NODE_ENV !== 'production') {
    const doc = new DocumentBuilder()
      .setTitle('School ERP API')
      .setVersion('1')
      .addCookieAuth('sid')
      .build();
    SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, doc));
  }
  return app;
};

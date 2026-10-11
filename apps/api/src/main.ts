import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RawBodyMiddleware } from './middleware/raw-body.middleware';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Request, Response, NextFunction } from 'express';
import { RedisStore } from 'connect-redis';
import Redis from 'ioredis';
import { assertProductionConfig } from './config/production-config';

async function bootstrap() {
  assertProductionConfig();
  const app = await NestFactory.create(AppModule, { rawBody: true });
  // Behind Caddy/a load balancer: use X-Forwarded-For for client IPs (rate limits)
  // and X-Forwarded-Proto so secure session cookies are issued over HTTPS.
  app.getHttpAdapter().getInstance().set('trust proxy', process.env.TRUST_PROXY ?? 'loopback, linklocal, uniquelocal');
  app.setGlobalPrefix('api');
  app.use(helmet({ contentSecurityPolicy: false }));
  const origins = (process.env.ORIGIN ?? 'https://localhost:5174,http://localhost:5173').split(',').map((o) => o.trim());
  app.enableCors({ origin: origins, credentials: true });

  app.use(cookieParser());

  const sessionStore = process.env.REDIS_URL
    ? new RedisStore({ client: new Redis(process.env.REDIS_URL), prefix: 'sess:' })
    : undefined;

  app.use(
    session({
      store: sessionStore,
      secret: process.env.SESSION_SECRET || 'ripple-session-secret',
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    }),
  );
  
  const rawBodyMiddleware = new RawBodyMiddleware();
  app.use((req: Request, res: Response, next: NextFunction) => rawBodyMiddleware.use(req, res, next));
  
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Ripple API')
    .setDescription('Liquid democracy voting platform API')
    .setVersion('1.0')
    .addCookieAuth('connect.sid')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(process.env.API_PORT ?? 3001);
}

bootstrap();

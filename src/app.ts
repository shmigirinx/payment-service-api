import 'reflect-metadata';
import { Module, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth';
import { RequestLogInterceptor } from './common';
import { PaymentsModule } from './payments';
import { PrismaModule } from './prisma';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    PaymentsModule,
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}

export async function createApp() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32 || secret.startsWith('replace-')) {
    throw new Error('Set JWT_SECRET to a random secret of at least 32 characters');
  }

  const app = await NestFactory.create(AppModule, {
    logger: process.env.NODE_ENV === 'test' ? false : undefined,
  });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));
  app.useGlobalInterceptors(new RequestLogInterceptor());
  app.enableShutdownHooks();

  const config = new DocumentBuilder()
    .setTitle('Payment Service API')
    .setDescription('Educational portfolio project. Amounts are strings in kopecks.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  return app;
}

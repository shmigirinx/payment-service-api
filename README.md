name: Create and check Payment Service API

on:
  push:
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: payment-project-${{ github.ref }}
  cancel-in-progress: false

jobs:
  project:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    permissions:
      contents: write

    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: payments_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres -d payments_test"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 20

    env:
      NODE_ENV: test
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/payments_test?schema=public
      JWT_SECRET: github-actions-test-only-secret-at-least-32-characters

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "22"

      - name: Create project files if absent
        id: generate
        shell: bash
        run: |
          python3 - <<'PY'
          import os
          from pathlib import Path

          if Path("package.json").exists():
              with open(os.environ["GITHUB_OUTPUT"], "a") as output:
                  output.write("created=false\n")
              raise SystemExit(0)

          files = {
          "package.json": r'''
          {
            "name": "payment-service-api",
            "version": "1.0.0",
            "private": true,
            "description": "Educational NestJS payment service",
            "engines": { "node": ">=22" },
            "scripts": {
              "build": "tsc -p tsconfig.json",
              "start": "node dist/main.js",
              "prisma:generate": "prisma generate",
              "db:deploy": "prisma migrate deploy",
              "db:dev": "prisma migrate dev",
              "seed": "node dist/seed.js",
              "test": "jest --runInBand"
            },
            "dependencies": {
              "@nestjs/common": "^11.1.0",
              "@nestjs/core": "^11.1.0",
              "@nestjs/jwt": "^11.0.0",
              "@nestjs/platform-express": "^11.1.0",
              "@nestjs/swagger": "^11.0.0",
              "@nestjs/throttler": "^6.0.0",
              "@prisma/client": "^6.19.0",
              "bcryptjs": "^3.0.2",
              "class-transformer": "^0.5.1",
              "class-validator": "^0.14.2",
              "dotenv": "^16.4.7",
              "prisma": "^6.19.0",
              "reflect-metadata": "^0.2.2",
              "rxjs": "^7.8.1"
            },
            "devDependencies": {
              "@types/express": "^5.0.0",
              "@types/jest": "^29.5.14",
              "@types/node": "^22.0.0",
              "@types/supertest": "^6.0.2",
              "jest": "^29.7.0",
              "supertest": "^7.0.0",
              "ts-jest": "^29.2.5",
              "typescript": "^5.7.3"
            }
          }
          ''',

          "tsconfig.json": r'''
          {
            "compilerOptions": {
              "target": "ES2022",
              "module": "CommonJS",
              "moduleResolution": "node",
              "rootDir": "src",
              "outDir": "dist",
              "strict": true,
              "experimentalDecorators": true,
              "emitDecoratorMetadata": true,
              "esModuleInterop": true,
              "skipLibCheck": true,
              "forceConsistentCasingInFileNames": true,
              "sourceMap": true
            },
            "include": ["src/**/*.ts"],
            "exclude": ["node_modules", "dist", "test"]
          }
          ''',

          "tsconfig.test.json": r'''
          {
            "extends": "./tsconfig.json",
            "compilerOptions": {
              "rootDir": ".",
              "noEmit": true,
              "types": ["node", "jest"]
            },
            "include": ["src/**/*.ts", "test/**/*.ts"],
            "exclude": ["node_modules", "dist"]
          }
          ''',

          "jest.config.cjs": r'''
          module.exports = {
            testEnvironment: 'node',
            testMatch: ['**/test/**/*.e2e-spec.ts'],
            transform: {
              '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
            },
            testTimeout: 45000,
            maxWorkers: 1,
          };
          ''',

          ".gitignore": r'''
          node_modules/
          dist/
          coverage/
          .env
          .env.*
          !.env.example
          *.log
          .DS_Store
          ''',

          ".dockerignore": r'''
          node_modules
          dist
          coverage
          .git
          .github
          .env
          .env.*
          !.env.example
          *.log
          ''',

          ".env.example": r'''
          DATABASE_URL=postgresql://payment:local-dev-only@localhost:5432/payments?schema=public
          JWT_SECRET=replace-with-a-random-secret-before-starting
          DEMO_PASSWORD=learning-only-change-me
          PORT=3000
          ''',

          "prisma/schema.prisma": r'''
          generator client {
            provider = "prisma-client-js"
          }

          datasource db {
            provider = "postgresql"
            url      = env("DATABASE_URL")
          }

          model User {
            id           String   @id @default(uuid()) @db.Uuid
            email        String   @unique @db.VarChar(254)
            passwordHash String
            createdAt    DateTime @default(now())
            account      Account?
          }

          model Account {
            id        String   @id @default(uuid()) @db.Uuid
            ownerId   String   @unique @db.Uuid
            owner     User     @relation(fields: [ownerId], references: [id], onDelete: Restrict)
            balance   BigInt   @default(0)
            currency  String   @default("RUB") @db.Char(3)
            createdAt DateTime @default(now())
            outgoing  Transfer[] @relation("Sender")
            incoming  Transfer[] @relation("Recipient")
          }

          model Transfer {
            id             String   @id @default(uuid()) @db.Uuid
            senderId       String   @db.Uuid
            recipientId    String   @db.Uuid
            sender         Account  @relation("Sender", fields: [senderId], references: [id], onDelete: Restrict)
            recipient      Account  @relation("Recipient", fields: [recipientId], references: [id], onDelete: Restrict)
            amount         BigInt
            currency       String   @default("RUB") @db.Char(3)
            idempotencyKey String   @db.VarChar(128)
            requestHash    String   @db.Char(64)
            createdAt      DateTime @default(now())

            @@unique([senderId, idempotencyKey])
            @@index([senderId, createdAt, id])
            @@index([recipientId, createdAt, id])
          }
          ''',

          "prisma/migrations/migration_lock.toml": r'''
          provider = "postgresql"
          ''',

          "prisma/migrations/20260101000000_initial/migration.sql": r'''
          CREATE TABLE "User" (
            "id" UUID NOT NULL,
            "email" VARCHAR(254) NOT NULL,
            "passwordHash" TEXT NOT NULL,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "User_pkey" PRIMARY KEY ("id")
          );

          CREATE TABLE "Account" (
            "id" UUID NOT NULL,
            "ownerId" UUID NOT NULL,
            "balance" BIGINT NOT NULL DEFAULT 0,
            "currency" CHAR(3) NOT NULL DEFAULT 'RUB',
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "Account_pkey" PRIMARY KEY ("id"),
            CONSTRAINT "Account_balance_nonnegative" CHECK ("balance" >= 0),
            CONSTRAINT "Account_currency_rub" CHECK ("currency" = 'RUB')
          );

          CREATE TABLE "Transfer" (
            "id" UUID NOT NULL,
            "senderId" UUID NOT NULL,
            "recipientId" UUID NOT NULL,
            "amount" BIGINT NOT NULL,
            "currency" CHAR(3) NOT NULL DEFAULT 'RUB',
            "idempotencyKey" VARCHAR(128) NOT NULL,
            "requestHash" CHAR(64) NOT NULL,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id"),
            CONSTRAINT "Transfer_amount_positive" CHECK ("amount" > 0),
            CONSTRAINT "Transfer_different_accounts" CHECK ("senderId" <> "recipientId"),
            CONSTRAINT "Transfer_currency_rub" CHECK ("currency" = 'RUB')
          );

          CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
          CREATE UNIQUE INDEX "Account_ownerId_key" ON "Account"("ownerId");
          CREATE UNIQUE INDEX "Transfer_senderId_idempotencyKey_key"
            ON "Transfer"("senderId", "idempotencyKey");
          CREATE INDEX "Transfer_senderId_createdAt_id_idx"
            ON "Transfer"("senderId", "createdAt", "id");
          CREATE INDEX "Transfer_recipientId_createdAt_id_idx"
            ON "Transfer"("recipientId", "createdAt", "id");

          ALTER TABLE "Account" ADD CONSTRAINT "Account_ownerId_fkey"
            FOREIGN KEY ("ownerId") REFERENCES "User"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
          ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_senderId_fkey"
            FOREIGN KEY ("senderId") REFERENCES "Account"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
          ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_recipientId_fkey"
            FOREIGN KEY ("recipientId") REFERENCES "Account"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
          ''',

          "src/prisma.ts": r'''
          import { Global, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
          import { PrismaClient } from '@prisma/client';

          @Injectable()
          export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
            async onModuleInit() {
              await this.$connect();
            }

            async onModuleDestroy() {
              await this.$disconnect();
            }
          }

          @Global()
          @Module({ providers: [PrismaService], exports: [PrismaService] })
          export class PrismaModule {}
          ''',

          "src/common.ts": r'''
          import {
            CallHandler, CanActivate, createParamDecorator, ExecutionContext,
            HttpException, Injectable, Logger, NestInterceptor, UnauthorizedException,
          } from '@nestjs/common';
          import { JwtService } from '@nestjs/jwt';
          import { Request, Response } from 'express';
          import { randomUUID } from 'node:crypto';
          import { finalize, tap } from 'rxjs';

          interface AuthRequest extends Request {
            userId?: string;
          }

          @Injectable()
          export class JwtGuard implements CanActivate {
            constructor(private readonly jwt: JwtService) {}

            async canActivate(context: ExecutionContext): Promise<boolean> {
              const req = context.switchToHttp().getRequest<AuthRequest>();
              const match = /^Bearer (.+)$/i.exec(req.headers.authorization ?? '');
              if (!match) throw new UnauthorizedException('Bearer token required');

              try {
                const payload = await this.jwt.verifyAsync<{ sub: string }>(match[1]);
                if (typeof payload.sub !== 'string') throw new Error('Missing subject');
                req.userId = payload.sub;
                return true;
              } catch {
                throw new UnauthorizedException('Invalid or expired token');
              }
            }
          }

          export const CurrentUser = createParamDecorator(
            (_data: unknown, context: ExecutionContext): string =>
              context.switchToHttp().getRequest<AuthRequest>().userId!,
          );

          @Injectable()
          export class RequestLogInterceptor implements NestInterceptor {
            private readonly logger = new Logger('HTTP');

            intercept(context: ExecutionContext, next: CallHandler) {
              const req = context.switchToHttp().getRequest<Request>();
              const res = context.switchToHttp().getResponse<Response>();
              const requestId = randomUUID();
              const started = Date.now();
              let errorStatus: number | undefined;
              res.setHeader('X-Request-Id', requestId);

              return next.handle().pipe(
                tap({
                  error: (error: unknown) => {
                    errorStatus = error instanceof HttpException ? error.getStatus() : 500;
                  },
                }),
                finalize(() => {
                  this.logger.log(JSON.stringify({
                    requestId,
                    method: req.method,
                    path: req.path,
                    status: errorStatus ?? res.statusCode,
                    durationMs: Date.now() - started,
                  }));
                }),
              );
            }
          }
          ''',

          "src/auth.ts": r'''
          import {
            BadRequestException, Body, ConflictException, Controller, HttpCode,
            Injectable, Module, Post, UnauthorizedException,
          } from '@nestjs/common';
          import { JwtModule, JwtService } from '@nestjs/jwt';
          import { ApiProperty, ApiTags } from '@nestjs/swagger';
          import { Prisma } from '@prisma/client';
          import { compare, hash } from 'bcryptjs';
          import { Transform } from 'class-transformer';
          import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
          import { JwtGuard } from './common';
          import { PrismaService } from './prisma';

          class CredentialsDto {
            @ApiProperty({ example: 'alice@example.com' })
            @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
            @IsEmail()
            @MaxLength(254)
            email!: string;

            @ApiProperty({ minLength: 12, maxLength: 72, format: 'password' })
            @IsString()
            @Length(12, 72)
            password!: string;
          }

          @Injectable()
          export class AuthService {
            constructor(private readonly db: PrismaService, private readonly jwt: JwtService) {}

            private async token(userId: string, accountId: string) {
              return { accessToken: await this.jwt.signAsync({ sub: userId }), accountId };
            }

            async register(dto: CredentialsDto) {
              if (Buffer.byteLength(dto.password, 'utf8') > 72) {
                throw new BadRequestException('Password must not exceed 72 UTF-8 bytes');
              }

              const passwordHash = await hash(dto.password, 12);
              try {
                const user = await this.db.user.create({
                  data: {
                    email: dto.email,
                    passwordHash,
                    account: { create: {} },
                  },
                  include: { account: true },
                });
                return this.token(user.id, user.account!.id);
              } catch (error) {
                if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                  throw new ConflictException('Email is already registered');
                }
                throw error;
              }
            }

            async login(dto: CredentialsDto) {
              const user = await this.db.user.findUnique({
                where: { email: dto.email },
                include: { account: true },
              });
              if (!user || !await compare(dto.password, user.passwordHash)) {
                throw new UnauthorizedException('Invalid email or password');
              }
              return this.token(user.id, user.account!.id);
            }
          }

          @ApiTags('Authentication')
          @Controller('auth')
          class AuthController {
            constructor(private readonly auth: AuthService) {}

            @Post('register')
            register(@Body() dto: CredentialsDto) {
              return this.auth.register(dto);
            }

            @Post('login')
            @HttpCode(200)
            login(@Body() dto: CredentialsDto) {
              return this.auth.login(dto);
            }
          }

          @Module({
            imports: [
              JwtModule.register({
                secret: process.env.JWT_SECRET,
                signOptions: { expiresIn: '1h', algorithm: 'HS256' },
                verifyOptions: { algorithms: ['HS256'] },
              }),
            ],
            controllers: [AuthController],
            providers: [AuthService, JwtGuard],
            exports: [JwtGuard, JwtModule],
          })
          export class AuthModule {}
          ''',

          "src/payments.ts": r'''
          import {
            BadRequestException, Body, ConflictException, Controller, Get, Headers,
            Injectable, Module, NotFoundException, Post, Query,
            ServiceUnavailableException, UseGuards,
          } from '@nestjs/common';
          import {
            ApiBearerAuth, ApiHeader, ApiProperty, ApiPropertyOptional, ApiTags,
          } from '@nestjs/swagger';
          import { Prisma, Transfer } from '@prisma/client';
          import { Transform, Type } from 'class-transformer';
          import { IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';
          import { createHash } from 'node:crypto';
          import { setTimeout as pause } from 'node:timers/promises';
          import { AuthModule } from './auth';
          import { CurrentUser, JwtGuard } from './common';
          import { PrismaService } from './prisma';

          const MAX_MONEY = 9223372036854775807n;

          class CreateTransferDto {
            @ApiProperty({ format: 'uuid', description: 'Recipient account ID' })
            @Transform(({ value }) => typeof value === 'string' ? value.toLowerCase() : value)
            @IsUUID()
            recipientAccountId!: string;

            @ApiProperty({ example: '1000', description: 'Positive integer string in kopecks' })
            @IsString()
            @Matches(/^[1-9][0-9]{0,18}$/)
            amount!: string;
          }

          class HistoryQuery {
            @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
            @Type(() => Number)
            @IsInt()
            @Min(1)
            @Max(100)
            limit = 20;

            @ApiPropertyOptional({ format: 'uuid' })
            @IsOptional()
            @IsUUID()
            cursor?: string;
          }

          function view(transfer: Transfer) {
            return {
              id: transfer.id,
              senderId: transfer.senderId,
              recipientId: transfer.recipientId,
              amount: transfer.amount.toString(),
              currency: transfer.currency,
              createdAt: transfer.createdAt,
            };
          }

          @Injectable()
          export class TransfersService {
            constructor(private readonly db: PrismaService) {}

            async create(ownerId: string, dto: CreateTransferDto, key?: string) {
              if (!key || !/^[A-Za-z0-9_.:-]{1,128}$/.test(key)) {
                throw new BadRequestException('A valid Idempotency-Key header is required');
              }

              const amount = BigInt(dto.amount);
              if (amount > MAX_MONEY) throw new BadRequestException('Amount exceeds BIGINT range');

              const requestHash = createHash('sha256')
                .update(JSON.stringify([dto.recipientAccountId, dto.amount, 'RUB']))
                .digest('hex');

              const replay = (transfer: Transfer) => {
                if (transfer.requestHash !== requestHash) {
                  throw new ConflictException('Idempotency key was used with another request');
                }
                return view(transfer);
              };

              for (let attempt = 0; attempt < 3; attempt++) {
                try {
                  return await this.db.$transaction(async (tx) => {
                    const sender = await tx.account.findUnique({ where: { ownerId } });
                    if (!sender) throw new NotFoundException('Sender account not found');

                    const uniqueKey = {
                      senderId_idempotencyKey: { senderId: sender.id, idempotencyKey: key },
                    };
                    const previous = await tx.transfer.findUnique({ where: uniqueKey });
                    if (previous) return replay(previous);

                    if (sender.id === dto.recipientAccountId) {
                      throw new BadRequestException('Self-transfer is not allowed');
                    }

                    // Lock BOTH accounts in the same order for every transfer.
                    const rows = await tx.$queryRaw<Array<{ id: string }>>`
                      SELECT "id" FROM "Account"
                      WHERE "id" IN (${sender.id}::uuid, ${dto.recipientAccountId}::uuid)
                      ORDER BY "id"
                      FOR UPDATE
                    `;

                    // A concurrent request may have committed while we waited.
                    const committed = await tx.transfer.findUnique({ where: uniqueKey });
                    if (committed) return replay(committed);

                    if (rows.length !== 2) throw new NotFoundException('Recipient account not found');

                    const debit = await tx.account.updateMany({
                      where: { id: sender.id, balance: { gte: amount } },
                      data: { balance: { decrement: amount } },
                    });
                    if (debit.count !== 1) throw new BadRequestException('Insufficient funds');

                    const credit = await tx.account.updateMany({
                      where: {
                        id: dto.recipientAccountId,
                        balance: { lte: MAX_MONEY - amount },
                      },
                      data: { balance: { increment: amount } },
                    });
                    if (credit.count !== 1) {
                      throw new ConflictException('Recipient balance limit exceeded');
                    }

                    const transfer = await tx.transfer.create({
                      data: {
                        senderId: sender.id,
                        recipientId: dto.recipientAccountId,
                        amount,
                        idempotencyKey: key,
                        requestHash,
                      },
                    });
                    return view(transfer);
                  }, {
                    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
                    maxWait: 10000,
                    timeout: 10000,
                  });
                } catch (error) {
                  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
                    if (attempt < 2) {
                      await pause(25 * (attempt + 1));
                      continue;
                    }
                    throw new ServiceUnavailableException('Transaction conflict; retry with the same key');
                  }
                  throw error;
                }
              }
              throw new ServiceUnavailableException('Transfer could not be committed');
            }

            async history(ownerId: string, query: HistoryQuery) {
              const account = await this.db.account.findUnique({ where: { ownerId } });
              if (!account) throw new NotFoundException('Account not found');

              const where: Prisma.TransferWhereInput = {
                OR: [{ senderId: account.id }, { recipientId: account.id }],
              };

              if (query.cursor) {
                const cursor = await this.db.transfer.findFirst({
                  where: { AND: [where, { id: query.cursor }] },
                });
                if (!cursor) throw new BadRequestException('Invalid history cursor');
              }

              const rows = await this.db.transfer.findMany({
                where,
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                take: query.limit + 1,
                ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
              });

              return {
                items: rows.slice(0, query.limit).map(view),
                nextCursor: rows.length > query.limit ? rows[query.limit - 1].id : null,
              };
            }
          }

          @ApiTags('Accounts')
          @ApiBearerAuth()
          @UseGuards(JwtGuard)
          @Controller('accounts')
          class AccountsController {
            constructor(private readonly db: PrismaService) {}

            @Get('me')
            async me(@CurrentUser() ownerId: string) {
              const account = await this.db.account.findUnique({ where: { ownerId } });
              if (!account) throw new NotFoundException('Account not found');
              return {
                id: account.id,
                balance: account.balance.toString(),
                currency: account.currency,
              };
            }
          }

          @ApiTags('Transfers')
          @ApiBearerAuth()
          @UseGuards(JwtGuard)
          @Controller('transfers')
          class TransfersController {
            constructor(private readonly transfers: TransfersService) {}

            @Post()
            @ApiHeader({ name: 'Idempotency-Key', required: true, example: 'transfer-001' })
            create(
              @CurrentUser() ownerId: string,
              @Body() dto: CreateTransferDto,
              @Headers('idempotency-key') key?: string,
            ) {
              return this.transfers.create(ownerId, dto, key);
            }

            @Get()
            history(@CurrentUser() ownerId: string, @Query() query: HistoryQuery) {
              return this.transfers.history(ownerId, query);
            }
          }

          @Module({
            imports: [AuthModule],
            controllers: [AccountsController, TransfersController],
            providers: [TransfersService],
          })
          export class PaymentsModule {}
          ''',

          "src/app.ts": r'''
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
          ''',

          "src/main.ts": r'''
          import 'dotenv/config';
          import { createApp } from './app';

          async function main() {
            const app = await createApp();
            const port = Number(process.env.PORT ?? 3000);
            if (!Number.isInteger(port) || port < 1 || port > 65535) {
              throw new Error('PORT must be an integer between 1 and 65535');
            }
            await app.listen(port, '0.0.0.0');
          }

          main().catch((error: unknown) => {
            console.error(error);
            process.exit(1);
          });
          ''',

          "src/seed.ts": r'''
          import 'dotenv/config';
          import { PrismaClient } from '@prisma/client';
          import { hash } from 'bcryptjs';

          async function main() {
            if (process.env.ALLOW_DEMO_SEED !== 'true') {
              throw new Error('Demo seed requires ALLOW_DEMO_SEED=true');
            }

            const password = process.env.DEMO_PASSWORD;
            if (!password || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
              throw new Error('Set DEMO_PASSWORD: at least 12 characters, at most 72 UTF-8 bytes');
            }

            const db = new PrismaClient();
            try {
              const passwordHash = await hash(password, 12);
              for (const email of ['alice@example.com', 'bob@example.com']) {
                await db.user.upsert({
                  where: { email },
                  update: {},
                  data: {
                    email,
                    passwordHash,
                    account: { create: { balance: 100000n } },
                  },
                });
              }
              console.log('Demo users are available: alice@example.com, bob@example.com');
              console.log('Existing users, passwords and balances were not reset.');
            } finally {
              await db.$disconnect();
            }
          }

          main().catch((error: unknown) => {
            console.error(error);
            process.exit(1);
          });
          ''',

          "test/payments.e2e-spec.ts": r'''
          import { INestApplication } from '@nestjs/common';
          import request from 'supertest';
          import { createApp } from '../src/app';
          import { PrismaService } from '../src/prisma';

          describe('Payment API with real PostgreSQL', () => {
            let app: INestApplication;
            let db: PrismaService;
            let alice: { accessToken: string; accountId: string };
            let bob: { accessToken: string; accountId: string };
            const password = 'test-password-12345';

            const send = (key: string, amount: unknown = '100') =>
              request(app.getHttpServer())
                .post('/transfers')
                .auth(alice.accessToken, { type: 'bearer' })
                .set('Idempotency-Key', key)
                .send({ recipientAccountId: bob.accountId, amount });

            const balance = async (id: string) =>
              (await db.account.findUniqueOrThrow({ where: { id } })).balance;

            beforeAll(async () => {
              const url = new URL(process.env.DATABASE_URL ?? '');
              const name = decodeURIComponent(url.pathname.slice(1));
              if (!name.endsWith('_test')) {
                throw new Error('Tests require a dedicated database ending in _test');
              }
              app = await createApp();
              await app.init();
              db = app.get(PrismaService);
            });

            beforeEach(async () => {
              await db.transfer.deleteMany();
              await db.account.deleteMany();
              await db.user.deleteMany();

              const a = await request(app.getHttpServer())
                .post('/auth/register')
                .send({ email: 'alice@example.com', password })
                .expect(201);
              const b = await request(app.getHttpServer())
                .post('/auth/register')
                .send({ email: 'bob@example.com', password })
                .expect(201);

              alice = a.body;
              bob = b.body;
              await db.account.update({
                where: { id: alice.accountId },
                data: { balance: 1000n },
              });
            });

            afterAll(async () => {
              if (app) await app.close();
            });

            it('registers an empty account, normalizes email and supports login', async () => {
              const registration = await request(app.getHttpServer())
                .post('/auth/register')
                .send({ email: ' Carol@Example.com ', password })
                .expect(201);

              expect(await balance(registration.body.accountId)).toBe(0n);

              await request(app.getHttpServer())
                .post('/auth/register')
                .send({ email: 'carol@example.com', password })
                .expect(409);

              await request(app.getHttpServer())
                .post('/auth/login')
                .send({ email: 'carol@example.com', password })
                .expect(200);

              await request(app.getHttpServer())
                .post('/auth/login')
                .send({ email: 'carol@example.com', password: 'incorrect-password' })
                .expect(401);
            });

            it('requires JWT and returns only the current account', async () => {
              await request(app.getHttpServer()).get('/accounts/me').expect(401);
              const own = await request(app.getHttpServer())
                .get('/accounts/me')
                .auth(alice.accessToken, { type: 'bearer' })
                .expect(200);
              expect(own.body).toEqual({
                id: alice.accountId, balance: '1000', currency: 'RUB',
              });
            });

            it('transfers funds and preserves the total balance', async () => {
              const result = await send('success').expect(201);
              expect(result.body.amount).toBe('100');
              expect(await balance(alice.accountId)).toBe(900n);
              expect(await balance(bob.accountId)).toBe(100n);
              expect(await db.transfer.count()).toBe(1);
            });

            it('rolls back insufficient funds', async () => {
              await send('insufficient', '1001').expect(400);
              expect(await balance(alice.accountId)).toBe(1000n);
              expect(await balance(bob.accountId)).toBe(0n);
              expect(await db.transfer.count()).toBe(0);
            });

            it('replays a key and rejects changed content', async () => {
              const first = await send('repeat').expect(201);
              const second = await send('repeat').expect(201);
              expect(second.body).toEqual(first.body);
              await send('repeat', '200').expect(409);
              expect(await balance(alice.accountId)).toBe(900n);
              expect(await db.transfer.count()).toBe(1);
            });

            it('creates one transfer for simultaneous identical requests', async () => {
              const responses = await Promise.all(
                Array.from({ length: 8 }, () => send('parallel-repeat')),
              );
              expect(responses.every(r => r.status === 201)).toBe(true);
              expect(new Set(responses.map(r => r.body.id)).size).toBe(1);
              expect(await balance(alice.accountId)).toBe(900n);
              expect(await db.transfer.count()).toBe(1);
            });

            it('does not overspend during concurrent transfers', async () => {
              const responses = await Promise.all(
                Array.from({ length: 20 }, (_, i) => send(`parallel-${i}`)),
              );
              expect(responses.filter(r => r.status === 201)).toHaveLength(10);
              expect(responses.filter(r => r.status === 400)).toHaveLength(10);
              expect(await balance(alice.accountId)).toBe(0n);
              expect(await balance(bob.accountId)).toBe(1000n);
              expect(await db.transfer.count()).toBe(10);
            });

            it('rolls back a debit if the recipient cannot receive funds', async () => {
              const max = 9223372036854775807n;
              await db.account.update({
                where: { id: bob.accountId },
                data: { balance: max },
              });

              await send('recipient-limit').expect(409);
              expect(await balance(alice.accountId)).toBe(1000n);
              expect(await balance(bob.accountId)).toBe(max);
              expect(await db.transfer.count()).toBe(0);

              await db.account.update({
                where: { id: bob.accountId },
                data: { balance: 0n },
              });
              await send('recipient-limit').expect(201);
            });

            it('rejects invalid amounts, missing keys and sender injection', async () => {
              for (const amount of ['0', '-1', '1.5', '01', '9223372036854775808', 100]) {
                await send('invalid', amount).expect(400);
              }

              await request(app.getHttpServer())
                .post('/transfers')
                .auth(alice.accessToken, { type: 'bearer' })
                .send({ recipientAccountId: bob.accountId, amount: '100' })
                .expect(400);

              await request(app.getHttpServer())
                .post('/transfers')
                .auth(alice.accessToken, { type: 'bearer' })
                .set('Idempotency-Key', 'injected-sender')
                .send({
                  recipientAccountId: bob.accountId,
                  amount: '100',
                  senderId: bob.accountId,
                })
                .expect(400);

              expect(await db.transfer.count()).toBe(0);
            });

            it('rejects self-transfers and nonexistent recipients', async () => {
              await request(app.getHttpServer())
                .post('/transfers')
                .auth(alice.accessToken, { type: 'bearer' })
                .set('Idempotency-Key', 'self')
                .send({ recipientAccountId: alice.accountId, amount: '100' })
                .expect(400);

              await request(app.getHttpServer())
                .post('/transfers')
                .auth(alice.accessToken, { type: 'bearer' })
                .set('Idempotency-Key', 'missing')
                .send({
                  recipientAccountId: '00000000-0000-4000-8000-000000000001',
                  amount: '100',
                })
                .expect(404);
            });

            it('paginates history and does not disclose another user history', async () => {
              await send('history-one').expect(201);
              await send('history-two').expect(201);

              const first = await request(app.getHttpServer())
                .get('/transfers?limit=1')
                .auth(alice.accessToken, { type: 'bearer' })
                .expect(200);

              expect(first.body.items).toHaveLength(1);
              expect(first.body.nextCursor).toBeTruthy();

              const second = await request(app.getHttpServer())
                .get(`/transfers?limit=1&cursor=${first.body.nextCursor}`)
                .auth(alice.accessToken, { type: 'bearer' })
                .expect(200);

              expect(second.body.items).toHaveLength(1);
              expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
              expect(second.body.nextCursor).toBeNull();

              const outsider = await request(app.getHttpServer())
                .post('/auth/register')
                .send({ email: 'outsider@example.com', password })
                .expect(201);

              const history = await request(app.getHttpServer())
                .get('/transfers')
                .auth(outsider.body.accessToken, { type: 'bearer' })
                .expect(200);
              expect(history.body.items).toEqual([]);

              await request(app.getHttpServer())
                .get(`/transfers?cursor=${first.body.items[0].id}`)
                .auth(outsider.body.accessToken, { type: 'bearer' })
                .expect(400);
            });
          });
          ''',

          "Dockerfile": r'''
          FROM node:22-bookworm-slim AS base
          WORKDIR /app
          RUN apt-get update \
              && apt-get install -y --no-install-recommends openssl \
              && rm -rf /var/lib/apt/lists/*

          FROM base AS build
          COPY package*.json ./
          COPY prisma ./prisma
          RUN npm ci
          RUN npm run prisma:generate
          COPY tsconfig*.json ./
          COPY jest.config.cjs ./
          COPY src ./src
          COPY test ./test
          RUN npm run build

          FROM build AS production-deps
          RUN npm prune --omit=dev

          FROM base AS runtime
          ENV NODE_ENV=production
          COPY --from=production-deps /app/node_modules ./node_modules
          COPY --from=build /app/package*.json ./
          COPY --from=build /app/dist ./dist
          COPY --from=build /app/prisma ./prisma
          USER node
          EXPOSE 3000
          CMD ["sh", "-c", "npm run db:deploy && npm start"]
          ''',

          "docker-compose.yml": r'''
          services:
            db:
              image: postgres:16-bookworm
              environment:
                POSTGRES_USER: payment
                POSTGRES_PASSWORD: local-dev-only
                POSTGRES_DB: payments
              ports:
                - "127.0.0.1:5432:5432"
              volumes:
                - payment-data:/var/lib/postgresql/data
              healthcheck:
                test: ["CMD-SHELL", "pg_isready -U payment -d payments"]
                interval: 3s
                timeout: 3s
                retries: 20

            app:
              build:
                context: .
                target: runtime
              environment:
                PORT: "3000"
                DATABASE_URL: postgresql://payment:local-dev-only@db:5432/payments?schema=public
                JWT_SECRET: ${JWT_SECRET:?Set JWT_SECRET in .env}
                DEMO_PASSWORD: ${DEMO_PASSWORD:-}
              ports:
                - "127.0.0.1:3000:3000"
              depends_on:
                db:
                  condition: service_healthy

            test-db:
              image: postgres:16-bookworm
              profiles: ["test"]
              environment:
                POSTGRES_USER: payment
                POSTGRES_PASSWORD: local-test-only
                POSTGRES_DB: payments_test
              tmpfs:
                - /var/lib/postgresql/data
              healthcheck:
                test: ["CMD-SHELL", "pg_isready -U payment -d payments_test"]
                interval: 3s
                timeout: 3s
                retries: 20

            tests:
              profiles: ["test"]
              build:
                context: .
                target: build
              environment:
                NODE_ENV: test
                DATABASE_URL: postgresql://payment:local-test-only@test-db:5432/payments_test?schema=public
                JWT_SECRET: test-only-secret-for-isolated-integration-tests-123456
              depends_on:
                test-db:
                  condition: service_healthy
              command: ["sh", "-c", "npm run db:deploy && npm test"]

          volumes:
            payment-data:
          ''',

          "README.md": r'''
          # Payment Service API

          Учебный проект для портфолио: TypeScript, NestJS, REST, PostgreSQL,
          Prisma, JWT, Guards, Pipes, Interceptors, Jest, Docker Compose и Swagger.

          Проект демонстрирует работу backend-сервиса и не подтверждает
          коммерческий опыт в финтехе.

          ## Возможности

          - Регистрация и вход; JWT на один час.
          - Один счёт RUB на пользователя, начальный баланс 0.
          - Атомарные переводы, идемпотентность и собственная история.
          - Валидация запросов и ограничения PostgreSQL.
          - Логирование обработанных запросов без паролей, токенов и тела.
          - Ограничение частоты запросов в памяти одного процесса.
          - Интеграционные тесты с настоящим PostgreSQL.

          Деньги в API передаются строками в копейках: `"1000"` = 10 рублей.
          В БД используется BIGINT, а не числа с плавающей точкой.

          ## Проверки

          Во время подготовки кода локальная среда была недоступна.
          Локальный запуск не объявляется проверенным.

          Workflow `.github/workflows/project.yml` устанавливает зависимости,
          генерирует Prisma Client, применяет миграции, собирает TypeScript,
          запускает тесты с PostgreSQL и собирает Docker-образ.
          Первый запуск сохраняет сгенерированные файлы только после успеха.

          Фактический результат смотрите в Actions. Сборка образа не доказывает
          отдельный успешный запуск всего Docker Compose.
          При последующих push существующий проект проверяется без перезаписи.

          ## Запуск на Windows

          Нужны Git и запущенный Docker Desktop с Linux containers.

          В PowerShell:

          ```powershell
          git clone https://github.com/shmigirinx/payment-service-api.git
          cd payment-service-api
          Copy-Item .env.example .env

          $secret = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
          $envText = (Get-Content .env -Raw) -replace '(?m)^JWT_SECRET=.*$', "JWT_SECRET=$secret"
          [System.IO.File]::WriteAllText((Join-Path $PWD '.env'), $envText, [System.Text.UTF8Encoding]::new($false))

          docker compose up --build -d
          docker compose logs app
          ```

          Swagger: http://localhost:3000/docs

          JWT_SECRET обязателен, без запасного значения.
          Смените DEMO_PASSWORD в `.env` перед созданием демонстрационных пользователей.

          Остановка с сохранением данных:

          ```powershell
          docker compose down
          ```

          ## Демонстрационные деньги

          Обычная регистрация создаёт нулевой баланс.
          Публичного API пополнения нет.

          Для локальной демонстрации:

          ```powershell
          docker compose exec -e ALLOW_DEMO_SEED=true app npm run seed
          ```

          Seed создаёт `alice@example.com` и `bob@example.com`,
          каждому по 100000 копеек. Пароль берётся из DEMO_PASSWORD.
          Повторный запуск не сбрасывает существующие балансы и пароли.

          ## Проверка через Swagger

          1. Выполните POST `/auth/login` с email и DEMO_PASSWORD.
          2. В Authorize вставьте accessToken.
          3. GET `/accounts/me` возвращает идентификатор собственного счёта.
          4. Войдите вторым пользователем и получите идентификатор его счёта.
          5. От первого пользователя отправьте перевод:

          ```json
          {
            "recipientAccountId": "UUID-счёта-получателя",
            "amount": "1000"
          }
          ```

          В поле Idempotency-Key укажите, например, `demo-transfer-001`.
          Повтор успешного запроса с тем же ключом и телом возвращает тот же
          перевод без повторного списания. Другое тело с тем же ключом — 409.
          Неуспешные операции ключ не резервируют.
          Для новой операции нужен новый ключ.

          ## API

          | Метод | Путь | Назначение |
          |---|---|---|
          | POST | /auth/register | Регистрация и создание счёта |
          | POST | /auth/login | Получение JWT |
          | GET | /accounts/me | Собственный счёт и баланс |
          | POST | /transfers | Перевод |
          | GET | /transfers?limit=20&cursor=UUID | Собственная история |

          Защищённые методы требуют `Authorization: Bearer <token>`.
          Отправитель определяется по JWT.
          Пароль: минимум 12 символов, максимум 72 UTF-8 байта.

          ## Атомарность и конкурентность

          Оба счёта блокируются SELECT FOR UPDATE в одинаковом порядке UUID.
          После ожидания блокировок ключ идемпотентности проверяется повторно.
          Списание, зачисление и запись перевода выполняются в одной транзакции
          Read Committed. Условное списание исключает отрицательный баланс.
          Ошибка зачисления откатывает уже выполненное списание.

          Уникальный ключ `(senderId, idempotencyKey)` ограничивает повтор.
          Хеш связывает ключ с нормализованными параметрами запроса.
          Временный конфликт транзакции повторяется ограниченное число раз.
          История содержит успешные входящие и исходящие переводы.

          ## Тесты

          ```powershell
          docker compose --profile test run --build --rm tests
          ```

          Используется отдельная БД `payments_test`. Тесты проверяют:
          регистрацию, авторизацию, валидацию, перевод, нехватку средств,
          повтор ключа, конкурентное списание, откат после списания,
          пагинацию и отсутствие доступа к чужой истории.

          При ручном запуске тесты разрешают очистку только БД,
          имя которой заканчивается на `_test`.
          Эту БД следует использовать исключительно для тестов.

          ## Разработка без Docker для приложения

          Нужны Node.js 22 и PostgreSQL. Заполните `.env`:

          ```powershell
          npm ci
          npm run prisma:generate
          npm run db:deploy
          npm run build
          npm start
          ```

          В `.env.example` DATABASE_URL предназначен для PostgreSQL на localhost.
          В Compose адрес БД заменяется на имя сервиса `db`.

          Для тестов задайте DATABASE_URL отдельной БД с окончанием `_test`,
          примените миграции и выполните `npm test`.

          ## Загрузка изменений на GitHub

          ```powershell
          git status
          git add .
          git commit -m "Describe your change"
          git push
          ```

          `.env`, node_modules и dist исключены из Git.

          ## Ограничения

          Только RUB и один счёт на пользователя.
          Нет платёжного провайдера, возвратов, обмена валют,
          двойной бухгалтерской записи, refresh-токенов и отзыва JWT.
          Лимит запросов хранится в памяти и не распределяется между экземплярами.
          Interceptor не записывает запросы, отклонённые до его вызова Guards.
          Настройки Compose предназначены для локальной демонстрации.
          Проект не заявляет готовность к обработке реальных денег.
          '''
          }

          # Remove the common YAML indentation from generated text.
          import textwrap
          for name, content in files.items():
              path = Path(name)
              path.parent.mkdir(parents=True, exist_ok=True)
              path.write_text(textwrap.dedent(content).lstrip("\n"), encoding="utf-8")

          with open(os.environ["GITHUB_OUTPUT"], "a") as output:
              output.write("created=true\n")
          PY

      - name: Install dependencies
        shell: bash
        run: |
          if [ -f package-lock.json ]; then
            npm ci
          else
            npm install
          fi

      - name: Generate Prisma client
        run: npm run prisma:generate

      - name: Validate Prisma schema
        run: npx --no-install prisma validate

      - name: Apply migrations to test database
        run: npm run db:deploy

      - name: Build TypeScript
        run: npm run build

      - name: Run PostgreSQL integration tests
        run: npm test

      - name: Validate Docker Compose configuration
        run: docker compose config --quiet

      - name: Build Docker image
        run: docker build --target runtime -t payment-service-api:ci .

      - name: Save generated project after successful checks
        if: steps.generate.outputs.created == 'true'
        shell: bash
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add --all
          if git diff --cached --quiet; then
            exit 0
          fi
          git commit -m "Create educational Payment Service API"
          git push origin "HEAD:${GITHUB_REF_NAME}"
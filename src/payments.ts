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

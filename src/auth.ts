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

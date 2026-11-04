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

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      requestId?: string;
      headers: Record<string, string | undefined>;
    }>();
    const requestId =
      req.headers['x-request-id'] || req.requestId || randomUUID();
    req.requestId = requestId;

    const res = context.switchToHttp().getResponse<{
      setHeader: (k: string, v: string) => void;
    }>();
    res.setHeader('x-request-id', requestId);

    return next.handle().pipe(
      map((data) => ({
        code: 0,
        message: 'ok',
        data: data ?? null,
        requestId,
      })),
    );
  }
}

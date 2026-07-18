import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { requestId?: string }>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let code: number = status;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = status;
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const obj = body as { message?: string | string[]; error?: string };
        message = Array.isArray(obj.message)
          ? obj.message.join('; ')
          : obj.message || obj.error || message;
      }
    } else if (exception instanceof Error) {
      // 未知错误：生产不回传内部细节，仅打日志
      console.error('[unhandled]', exception);
      message =
        process.env.NODE_ENV === 'production'
          ? '服务器内部错误'
          : exception.message || message;
    }

    res.status(status).json({
      code,
      message,
      data: null,
      requestId: req.requestId || req.headers['x-request-id'] || null,
    });
  }
}

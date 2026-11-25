import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import type { ApiErrorBody, ApiFieldError } from '@matilda/types';
import { ApiException } from './api-exception';

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'UNPROCESSABLE',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

/**
 * Converts every thrown error into the standard ApiErrorBody (docs/API.md).
 * Unknown errors are logged with full detail but never leaked to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(AllExceptionsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { id?: string | number }>();
    const res = http.getResponse<Response>();

    const requestId = String(req.id ?? 'unknown');
    const { statusCode, code, message, errors } = this.normalize(exception);

    if (statusCode >= 500) {
      this.logger.error({ err: exception, requestId }, 'Unhandled server error');
    }

    const body: ApiErrorBody = {
      statusCode,
      code,
      message,
      ...(errors ? { errors } : {}),
      requestId,
      timestamp: new Date().toISOString(),
      path: req.originalUrl ?? req.url,
    };
    res.status(statusCode).json(body);
  }

  private normalize(exception: unknown): {
    statusCode: number;
    code: string;
    message: string;
    errors?: ApiFieldError[];
  } {
    if (exception instanceof ApiException) {
      return {
        statusCode: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        ...(exception.errors ? { errors: exception.errors } : {}),
      };
    }
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : typeof (response as { message?: unknown }).message === 'string'
            ? (response as { message: string }).message
            : exception.message;
      return { statusCode, code: STATUS_CODES[statusCode] ?? 'HTTP_ERROR', message };
    }
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    };
  }
}

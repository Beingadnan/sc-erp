import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from '@school-erp/shared';
import type { AppErrorCode } from '@school-erp/shared';
import { getRequestId } from './request-id.middleware.js';

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  VALIDATION_FAILED: HttpStatus.UNPROCESSABLE_ENTITY,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  TENANT_CONTEXT_MISSING: HttpStatus.UNAUTHORIZED,
  MFA_REQUIRED: HttpStatus.UNAUTHORIZED,
  MFA_SETUP_REQUIRED: HttpStatus.FORBIDDEN,
  INTERNAL: HttpStatus.INTERNAL_SERVER_ERROR,
};

const CODE_BY_STATUS: Record<number, AppErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
};

/**
 * Every error leaves the API in one envelope:
 *   { "error": { "code", "message", "requestId", "details"? } }
 * Unexpected errors never expose stack traces, SQL or personal data to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const requestId = getRequestId(req);

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: AppErrorCode = 'INTERNAL';
    let message = 'Something went wrong. Quote the request id when contacting support.';
    let details: Record<string, unknown> | undefined;

    if (exception instanceof AppError) {
      status = STATUS_BY_CODE[exception.code];
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = CODE_BY_STATUS[status] ?? (status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED');
      message = status >= 500 ? message : exception.message;
    }

    if (status >= 500) {
      // Log the class and message only; request bodies may contain personal data.
      const err = exception instanceof Error ? exception : new Error(String(exception));
      // Also log the underlying causes (e.g. the Postgres error under Drizzle's "Failed query"):
      // code and message only, never parameters or details, which can hold personal data.
      const causes: string[] = [];
      let c: unknown = (err as { cause?: unknown }).cause;
      for (let i = 0; i < 4 && c; i++) {
        const x = c as { code?: unknown; message?: unknown; name?: unknown };
        causes.push(
          `${String(x.name ?? 'cause')}${x.code ? ` ${String(x.code)}` : ''}: ${String(x.message ?? c)}`,
        );
        c = (c as { cause?: unknown }).cause;
      }
      this.logger.error(
        `[${requestId}] ${err.name}: ${err.message.split('\n')[0]}${causes.length ? ` <- ${causes.join(' <- ')}` : ''}`,
        err.stack,
      );
    }

    res
      .status(status)
      .json({ error: { code, message, requestId, ...(details ? { details } : {}) } });
  }
}

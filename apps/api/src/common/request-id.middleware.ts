import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { newId } from '@school-erp/shared';

const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Accepts a well-formed incoming X-Request-Id (from a proxy) or generates one.
 * The id flows into logs, audit entries, tenant context and job payloads.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('x-request-id');
    const requestId = incoming && SAFE_ID.test(incoming) ? incoming : newId();
    (req as Request & { requestId: string }).requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  }
}

export const getRequestId = (req: Request): string =>
  (req as Request & { requestId?: string }).requestId ?? 'unknown';

import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { ErrorCode, type Problem } from '@perspice/shared';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from './app-error';

const STATUS_CODES: Record<number, ErrorCode> = {
  400: ErrorCode.VALIDATION,
  401: ErrorCode.UNAUTHENTICATED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  413: ErrorCode.VALIDATION,
  429: ErrorCode.RATE_LIMITED,
};

export function toProblem(err: unknown): { status: number; body: Problem } {
  if (err instanceof AppError) {
    const body: Problem = { code: err.code, message: err.message };
    if (err.details !== undefined) body.details = err.details;
    return { status: err.status, body };
  }
  if (err instanceof ZodError) {
    return { status: 400, body: { code: ErrorCode.VALIDATION, message: 'Validation failed', details: err.issues } };
  }
  if (err instanceof HttpException) {
    const status = err.getStatus();
    const code = STATUS_CODES[status] ?? (status >= 500 ? ErrorCode.INTERNAL : ErrorCode.VALIDATION);
    const message = status >= 500 ? 'Internal error' : err.message;
    return { status, body: { code, message } };
  }
  return { status: 500, body: { code: ErrorCode.INTERNAL, message: 'Internal error' } };
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const { status, body } = toProblem(exception);
    if (status >= 500) {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    }
    if (host.getType() !== 'http') return;
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;
    res.status(status).json(body);
  }
}

import { ErrorCode } from '@perspice/shared';

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (message = 'Not found') => new AppError(ErrorCode.NOT_FOUND, message, 404);

export const forbidden = (message = 'Forbidden') => new AppError(ErrorCode.FORBIDDEN, message, 403);

export const conflict = (message: string) => new AppError(ErrorCode.CONFLICT, message, 409);

export const validation = (details: unknown, message = 'Validation failed') =>
  new AppError(ErrorCode.VALIDATION, message, 400, details);

export const unauthenticated = (message = 'Authentication required') =>
  new AppError(ErrorCode.UNAUTHENTICATED, message, 401);

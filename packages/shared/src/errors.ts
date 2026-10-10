export enum ErrorCode {
  VALIDATION = 'VALIDATION',
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  TOTP_REQUIRED = 'TOTP_REQUIRED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  /** An upload over the size limit. */
  TOO_LARGE = 'TOO_LARGE',
  RATE_LIMITED = 'RATE_LIMITED',
  TOKEN_INVALID = 'TOKEN_INVALID',
  /** The platform is being restored from a backup. */
  MAINTENANCE = 'MAINTENANCE',
  INTERNAL = 'INTERNAL',
}

export interface Problem {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

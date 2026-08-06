import { FrameType, FrameTuple, RawFrameTuple } from '@bxios/wire';

export interface ValidationDetail {
  field: string;
  path: (string | number)[];
  message: string;
  code: string;
}

export interface ErrorPayload {
  statusCode: number;
  error: string;
  message: string;
  details?: ValidationDetail[];
}

export interface ErrorTupleFrame extends FrameTuple {
  rawTuple: RawFrameTuple;
  payload: ErrorPayload;
}

export class ValidationError extends Error {
  public readonly statusCode: number = 400;
  public readonly details: ValidationDetail[];

  constructor(message: string = 'Validation failed', details: ValidationDetail[] = []) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }
}

export class HttpError extends Error {
  public readonly statusCode: number;
  public readonly details?: ValidationDetail[];

  constructor(statusCode: number, message: string, details?: ValidationDetail[]) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * Format Zod issues into standard ValidationDetail objects
 */
export function formatZodIssues(issues: Array<{ path: (string | number)[]; message: string; code: string }>): ValidationDetail[] {
  return issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : '_root',
    path: issue.path,
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Check if an object is a Zod schema or duck-typed Zod validator
 */
export function isZodSchema(obj: any): boolean {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    (typeof obj.safeParse === 'function' ||
      typeof obj.parse === 'function' ||
      typeof obj.safeParseAsync === 'function' ||
      '_def' in obj)
  );
}

/**
 * Creates a standard HTTP status tuple frame compatible with @bxios/wire FrameTuple
 */
export function createErrorTupleFrame(
  statusCode: number,
  message: string,
  details?: ValidationDetail[],
  reqId?: string,
  metadata?: Record<string, unknown>
): ErrorTupleFrame {
  let errorTitle = 'Error';
  if (statusCode === 400) {
    errorTitle = 'Bad Request';
  } else if (statusCode === 500) {
    errorTitle = 'Internal Server Error';
  } else if (statusCode === 404) {
    errorTitle = 'Not Found';
  } else if (statusCode === 401) {
    errorTitle = 'Unauthorized';
  } else if (statusCode === 403) {
    errorTitle = 'Forbidden';
  }

  const payload: ErrorPayload = {
    statusCode,
    error: errorTitle,
    message,
    ...(details && details.length > 0 ? { details } : {})
  };

  const id = reqId || `err-${Math.random().toString(36).substring(2, 9)}`;
  const jsonString = JSON.stringify(payload);
  const jsonBytes = new TextEncoder().encode(jsonString);
  const meta = metadata || { 'content-type': 'application/json' };

  const frame: FrameTuple = {
    type: FrameType.Unary,
    id,
    data: jsonBytes,
    metadata: meta,
    code: statusCode
  };

  const rawTuple: RawFrameTuple = [
    FrameType.Unary,
    id,
    null,
    jsonBytes,
    meta,
    statusCode
  ];

  return {
    ...frame,
    payload,
    rawTuple
  };
}

/**
 * Type guard for ErrorTupleFrame
 */
export function isErrorTupleFrame(obj: any): obj is ErrorTupleFrame {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof obj.code === 'number' &&
    obj.payload !== undefined &&
    typeof obj.payload.statusCode === 'number' &&
    Array.isArray(obj.rawTuple)
  );
}

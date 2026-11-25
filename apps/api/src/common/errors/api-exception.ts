import { HttpException } from '@nestjs/common';
import type { ApiFieldError } from '@matilda/types';

/** Application error with a stable machine-readable code. Prefer this over bare HttpException. */
export class ApiException extends HttpException {
  constructor(
    status: number,
    public readonly code: string,
    message: string,
    public readonly errors?: ApiFieldError[],
  ) {
    super({ code, message, errors }, status);
  }
}

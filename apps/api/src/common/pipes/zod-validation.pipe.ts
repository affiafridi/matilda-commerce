import { PipeTransform } from '@nestjs/common';
import type { ZodType } from '@matilda/validation';
import { ApiException } from '../errors/api-exception';

/** Validates request input against a shared Zod schema (docs/API.md). */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new ApiException(
      400,
      'VALIDATION_FAILED',
      'Request validation failed.',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
}

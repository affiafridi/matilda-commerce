import { paginationQuerySchema } from '@matilda/validation';
import { ApiException } from '../errors/api-exception';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(paginationQuerySchema);

  it('returns parsed data with defaults', () => {
    expect(pipe.transform({})).toEqual({ page: 1, pageSize: 20 });
  });

  it('throws a VALIDATION_FAILED ApiException with field errors', () => {
    try {
      pipe.transform({ pageSize: 1000 });
      throw new Error('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiException);
      const e = err as ApiException;
      expect(e.getStatus()).toBe(400);
      expect(e.code).toBe('VALIDATION_FAILED');
      expect(e.errors?.[0]?.path).toBe('pageSize');
    }
  });
});

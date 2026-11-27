import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api-exception';
import { isUniqueViolation } from '../admin/admin-common';
import { BrandScopedAccess } from '../admin/brand-access';

/** Brand-scoped entry point of every inventory service call (see `BrandScopedAccess`). */
@Injectable()
export class InventoryAccess extends BrandScopedAccess {}

/**
 * Turns database errors that mean "the caller asked for something invalid" into API errors; the
 * stock-shape and branch triggers raise check violations with readable messages. Anything not
 * recognised is returned unchanged so it surfaces as a server error.
 */
export function mapInventoryError(err: unknown): Error {
  if (err instanceof ApiException) return err;
  if (isUniqueViolation(err)) {
    return new ApiException(
      409,
      'STOCK_ROW_EXISTS',
      'That branch already tracks stock for this item',
    );
  }
  const text = err instanceof Error ? `${err.message} ${String(err.cause ?? '')}` : '';
  if (/bundle has no stock|stocked per variation|stocked on the product/i.test(text)) {
    return new ApiException(
      422,
      'STOCK_SHAPE_INVALID',
      'Stock is kept on a simple product or a variation, not on a bundle or a variable product',
    );
  }
  if (/branch does not serve this brand/i.test(text)) {
    return new ApiException(422, 'BRANCH_NOT_AVAILABLE', 'The branch does not serve this brand');
  }
  return err instanceof Error ? err : new Error(String(err));
}

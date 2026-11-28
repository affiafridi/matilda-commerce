import { cartLineInputSchema } from '@matilda/validation';
import { FIXTURE_CARTS } from './fixtures';

describe('commerce fixtures', () => {
  it('only hold lines the shared cart contract accepts, and never a price', () => {
    for (const cart of FIXTURE_CARTS) {
      expect(cart.lines.length).toBeGreaterThan(0);
      for (const line of cart.lines) {
        expect(cartLineInputSchema.safeParse(line).success).toBe(true);
        expect(line).not.toHaveProperty('price');
      }
    }
  });
});

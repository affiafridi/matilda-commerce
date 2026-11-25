import type { PrismaClient } from '../generated/prisma/client';
import { withScope } from './scope';

describe('withScope', () => {
  it('rejects a non-uuid brand id before touching the database', async () => {
    const client = { $transaction: jest.fn() } as unknown as PrismaClient;
    await expect(withScope(client, { brandIds: ['not-a-uuid'] }, async () => 1)).rejects.toThrow(
      'Invalid brand id',
    );
    expect(client.$transaction).not.toHaveBeenCalled();
  });
});

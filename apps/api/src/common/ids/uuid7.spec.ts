import { uuidv7 } from './uuid7';

describe('uuidv7', () => {
  it('produces RFC 9562 version-7 ids', () => {
    expect(uuidv7()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('is time-ordered', () => {
    const earlier = uuidv7(1_700_000_000_000);
    const later = uuidv7(1_700_000_001_000);
    expect(earlier < later).toBe(true);
  });

  it('is unique', () => {
    expect(new Set(Array.from({ length: 1000 }, () => uuidv7())).size).toBe(1000);
  });
});

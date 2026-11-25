import { isPermissionKey, permissionKey } from './permission-key';

describe('permission keys', () => {
  it.each(['products.view', 'settings.manage_payments', 'seo.publish', 'refunds.approve'])(
    'accepts %s',
    (key) => expect(isPermissionKey(key)).toBe(true),
  );

  it.each(['Products.View', 'products', 'products.', '.view', 'a.b.c', 'products view', ''])(
    'rejects "%s"',
    (key) => {
      expect(isPermissionKey(key)).toBe(false);
      expect(() => permissionKey(key)).toThrow(/Invalid permission key/);
    },
  );
});

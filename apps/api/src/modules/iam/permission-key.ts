/** Permission keys use `resource.action`, e.g. `products.publish`, `settings.manage_payments`. */
export type PermissionKey = string & { readonly __brand: 'PermissionKey' };

const PERMISSION_KEY = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export function isPermissionKey(value: string): value is PermissionKey {
  return PERMISSION_KEY.test(value);
}

export function permissionKey(value: string): PermissionKey {
  if (!isPermissionKey(value)) throw new Error(`Invalid permission key: "${value}"`);
  return value;
}

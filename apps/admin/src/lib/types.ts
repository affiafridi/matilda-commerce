/** Response shapes of the admin management API (docs/API.md). The server stays the authority. */

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export type ActiveStatus = 'ACTIVE' | 'INACTIVE';
export type MarketStatus = 'DRAFT' | 'ACTIVE' | 'SUSPENDED';
export type StaffStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
export type CustomerStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETION_REQUESTED';

export interface Domain {
  id: string;
  brandId: string;
  hostname: string;
  marketId: string | null;
  defaultLanguageCode: string | null;
  isPrimary: boolean;
  redirectToPrimary: boolean;
}

export interface Brand {
  id: string;
  slug: string;
  name: string;
  legalEntityName: string | null;
  status: ActiveStatus;
  createdAt: string;
  domains: Domain[];
}

export interface Market {
  id: string;
  brandId: string;
  code: string;
  status: MarketStatus;
  timezone: string;
  country: { iso2: string; name: string };
  currencies: Array<{ currencyCode: string; isDefault: boolean }>;
  languages: Array<{ languageCode: string; isDefault: boolean }>;
}

export interface Branch {
  id: string;
  code: string;
  name: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  area: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
  phone: string | null;
  email: string | null;
  timezone: string;
  status: ActiveStatus;
  country: { iso2: string; name: string };
  markets: Array<{ marketId: string; status: ActiveStatus; market: { brandId: string } }>;
}

export interface StaffAssignment {
  id: string;
  roleId: string;
  brandId: string | null;
  marketId: string | null;
  branchId: string | null;
  expiresAt: string | null;
  role: { id: string; name: string; kind: string };
}

export interface StaffMember {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  status: StaffStatus;
  mfaEnrolledAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  assignments: StaffAssignment[];
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  editable: boolean;
  permissions: string[];
}

export interface PermissionDef {
  key: string;
  group: string;
  description: string;
  sensitive: boolean;
}

export interface AuditRow {
  id: string;
  occurredAt: string;
  actorType: 'STAFF' | 'CUSTOMER' | 'GUEST' | 'SYSTEM';
  actorId: string | null;
  brandId: string | null;
  marketId: string | null;
  branchId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  outcome: 'SUCCESS' | 'DENIED' | 'FAILED';
  before: unknown;
  after: unknown;
  requestId: string | null;
}

export interface AuditPage {
  items: AuditRow[];
  nextBefore: string | null;
}

export interface Customer {
  id: string;
  brandId: string;
  email: string;
  emailVerifiedAt: string | null;
  phone: string | null;
  fullName: string;
  status: CustomerStatus;
  marketingConsent: boolean;
  deletionRequestedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

'use client';

import { PageTitle } from '@/components/ui/primitives';
import { type AdminContext, useAdminContext, useAuthSession } from '@/lib/auth';

function scopeText(a: AdminContext['assignments'][number]): string {
  if (a.branch) return `Branch: ${a.branch.name}`;
  if (a.market) return `Market: ${a.market.code}${a.brand ? ` · ${a.brand.name}` : ''}`;
  if (a.brand) return `Brand: ${a.brand.name}`;
  return 'All brands';
}

export default function HomePage() {
  const session = useAuthSession();
  const context = useAdminContext(session.data?.stage === 'VERIFIED');

  return (
    <div>
      <PageTitle
        title={`Welcome, ${session.data?.fullName ?? ''}`}
        lede="Your access to Matilda Commerce. More areas appear here as they are built."
      />
      <section aria-labelledby="access-h">
        <h2 id="access-h" className="mb-2 text-[13px] font-semibold">
          Your roles
        </h2>
        <div className="overflow-x-auto rounded-md border border-line bg-surface">
          <table className="w-full text-start text-[13px]">
            <thead>
              <tr className="border-b border-line bg-sunken text-xs text-ink-2">
                <th scope="col" className="px-3 py-2 text-start font-semibold">
                  Role
                </th>
                <th scope="col" className="px-3 py-2 text-start font-semibold">
                  Scope
                </th>
                <th scope="col" className="px-3 py-2 text-start font-semibold">
                  Expires
                </th>
              </tr>
            </thead>
            <tbody>
              {context.isPending && (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-muted">
                    Loading your access…
                  </td>
                </tr>
              )}
              {context.isError && (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-danger">
                    We could not load your access. Reload the page to try again.
                  </td>
                </tr>
              )}
              {context.data?.assignments.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-muted">
                    No roles are assigned to your account. Ask an administrator for access.
                  </td>
                </tr>
              )}
              {context.data?.assignments.map((a) => (
                <tr key={a.id} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-2 font-medium">{a.role.name}</td>
                  <td className="px-3 py-2">{scopeText(a)}</td>
                  <td className="px-3 py-2 text-muted">
                    {a.expiresAt ? new Date(a.expiresAt).toLocaleDateString('en-GB') : 'No expiry'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

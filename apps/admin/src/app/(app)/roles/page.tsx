'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Fragment } from 'react';
import { Alert, Button, cx } from '@/components/ui/primitives';
import { PageHeader, StatusTag } from '@/components/ui/kit';
import { errorMessage, useCan } from '@/lib/auth';
import { http } from '@/lib/http';
import type { PermissionDef, Role } from '@/lib/types';

const GROUP_LABEL = (group: string) =>
  group.charAt(0).toUpperCase() + group.slice(1).replaceAll('_', ' ');

export default function RolesPage() {
  const canManage = useCan('roles.manage');
  const roles = useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: () => http.get<Role[]>('/admin/roles'),
  });
  const permissions = useQuery({
    queryKey: ['admin', 'permissions'],
    queryFn: () => http.get<PermissionDef[]>('/admin/permissions'),
  });

  const groups = new Map<string, PermissionDef[]>();
  for (const p of permissions.data ?? []) groups.set(p.group, [...(groups.get(p.group) ?? []), p]);

  return (
    <>
      <PageHeader
        title="Roles and permissions"
        actions={
          canManage && (
            <Link
              href="/roles/new"
              className="inline-flex h-9 items-center rounded-md border border-action bg-action px-3.5 text-sm font-medium text-action-ink hover:bg-action-hover"
            >
              New role
            </Link>
          )
        }
      />
      {(roles.isError || permissions.isError) && (
        <Alert tone="danger" className="mb-4">
          {errorMessage(roles.error ?? permissions.error, 'We could not load roles.')}{' '}
          <Button
            className="ms-2"
            onClick={() => {
              void roles.refetch();
              void permissions.refetch();
            }}
          >
            Try again
          </Button>
        </Alert>
      )}
      {(roles.isPending || permissions.isPending) && (
        <p role="status" className="text-[13px] text-muted">
          Loading roles…
        </p>
      )}
      {roles.data && permissions.data && (
        <>
          <p className="mb-3 max-w-2xl text-[13px] text-ink-2">
            Each column is a role and each row a permission. A filled square means the role grants
            it. System roles are fixed; clone one to adjust it. Permissions marked sensitive ask for
            a fresh two-factor code before they are used.
          </p>
          <div className="max-h-[70vh] overflow-auto rounded-md border border-line bg-surface">
            <table className="w-full border-collapse text-[13px]">
              <caption className="sr-only">Permissions granted by each role</caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="sticky start-0 top-0 z-20 min-w-64 border-b border-e border-line bg-sunken px-3 py-2 text-start align-bottom text-xs font-semibold text-ink-2"
                  >
                    Permission
                  </th>
                  {roles.data.map((r) => (
                    <th
                      key={r.id}
                      scope="col"
                      className="sticky top-0 z-10 min-w-24 border-b border-line bg-sunken px-1.5 py-2 align-bottom"
                    >
                      <Link
                        href={`/roles/${r.id}`}
                        title={`${r.name}${r.kind === 'CUSTOM' ? ' (custom)' : ''}`}
                        className="block text-center text-xs font-semibold leading-snug text-ink-2 hover:text-ink hover:underline"
                      >
                        {r.name}
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...groups.entries()].map(([group, defs]) => (
                  <Fragment key={group}>
                    <tr>
                      <th
                        scope="rowgroup"
                        colSpan={roles.data.length + 1}
                        className="sticky start-0 border-b border-line bg-canvas px-3 py-1.5 text-start text-[11px] font-semibold uppercase tracking-wide text-muted"
                      >
                        {GROUP_LABEL(group)}
                      </th>
                    </tr>
                    {defs.map((p) => (
                      <tr key={p.key} className="border-b border-line last:border-b-0">
                        <th
                          scope="row"
                          className="sticky start-0 z-10 border-e border-line bg-surface px-3 py-1.5 text-start font-normal"
                        >
                          {p.description}
                          {p.sensitive && (
                            <span className="ms-2 align-middle">
                              <StatusTag value="DRAFT" label="Sensitive" />
                            </span>
                          )}
                        </th>
                        {roles.data.map((r) => {
                          const granted = r.permissions.includes(p.key);
                          return (
                            <td key={r.id} className="h-8 text-center">
                              <span
                                role="img"
                                aria-label={`${r.name}: ${granted ? 'granted' : 'not granted'}`}
                                className={cx(
                                  'inline-block size-2.5',
                                  granted ? 'bg-ink' : 'border border-line-strong',
                                )}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

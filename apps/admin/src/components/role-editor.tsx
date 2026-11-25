'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Checkbox, Drawer, PageHeader, StatusTag } from '@/components/ui/kit';
import { Alert, Button, TextField } from '@/components/ui/primitives';
import { errorMessage, useCan } from '@/lib/auth';
import { http } from '@/lib/http';
import type { PermissionDef, Role } from '@/lib/types';

/** Create, edit, clone and delete a role. System roles are read-only here by design. */
export function RoleEditor({ roleId }: { roleId: string | 'new' }) {
  const creating = roleId === 'new';
  const canManage = useCan('roles.manage');
  const role = useQuery({
    queryKey: ['admin', 'roles', roleId],
    queryFn: () => http.get<Role>(`/admin/roles/${roleId}`),
    enabled: !creating,
  });
  const permissions = useQuery({
    queryKey: ['admin', 'permissions'],
    queryFn: () => http.get<PermissionDef[]>('/admin/permissions'),
  });

  if ((!creating && role.isPending) || permissions.isPending) {
    return (
      <p role="status" className="text-[13px] text-muted">
        Loading role…
      </p>
    );
  }
  if ((!creating && (role.isError || !role.data)) || !permissions.data) {
    return (
      <>
        <PageHeader title="Role" crumbs={[{ label: 'Roles and permissions', href: '/roles' }]} />
        <Alert tone="danger">That role was not found, or you do not have access to it.</Alert>
      </>
    );
  }
  return (
    <Form key={roleId} role={role.data ?? null} defs={permissions.data} canManage={canManage} />
  );
}

function Form({
  role,
  defs,
  canManage,
}: {
  role: Role | null;
  defs: PermissionDef[];
  canManage: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const readOnly = !canManage || (role !== null && !role.editable);
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [granted, setGranted] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [cloneName, setCloneName] = useState('');

  const groups = new Map<string, PermissionDef[]>();
  for (const p of defs) groups.set(p.group, [...(groups.get(p.group) ?? []), p]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        description: description.trim() || undefined,
        permissions: [...granted].sort(),
      };
      return role
        ? http.patch<Role>(`/admin/roles/${role.id}`, body)
        : http.post<Role>('/admin/roles', body);
    },
    onSuccess: async (result) => {
      await refresh();
      if (!role) router.replace(`/roles/${result.id}`);
      else setSaved(true);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => http.delete(`/admin/roles/${role?.id}`),
    onSuccess: async () => {
      await refresh();
      router.replace('/roles');
    },
    onError: (e) => {
      setConfirmDelete(false);
      setError(errorMessage(e));
    },
  });
  const clone = useMutation({
    mutationFn: () => http.post<Role>(`/admin/roles/${role?.id}/clone`, { name: cloneName.trim() }),
    onSuccess: async (result) => {
      await refresh();
      setCloning(false);
      router.push(`/roles/${result.id}`);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const toggle = (key: string, on: boolean) => {
    setSaved(false);
    setGranted((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  return (
    <>
      <PageHeader
        title={role ? role.name : 'New role'}
        crumbs={[
          { label: 'Roles and permissions', href: '/roles' },
          { label: role ? role.name : 'New role' },
        ]}
        status={
          role && (
            <StatusTag
              value={role.editable ? 'ACTIVE' : 'INACTIVE'}
              label={role.editable ? 'Custom' : 'System'}
            />
          )
        }
        actions={
          role &&
          canManage && (
            <>
              <Button
                onClick={() => {
                  setCloneName(`${role.name} copy`);
                  setCloning(true);
                }}
              >
                Clone
              </Button>
              {role.editable && (
                <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              )}
            </>
          )
        }
      />
      <div>
        {error && (
          <Alert tone="danger" className="mb-4">
            {error}
          </Alert>
        )}
        {saved && (
          <Alert tone="ok" className="mb-4">
            Saved. People holding this role get the change immediately.
          </Alert>
        )}
        {role && !role.editable && (
          <Alert tone="info" className="mb-4">
            System roles are fixed so that access stays predictable. Clone this role to make an
            adjusted copy.
          </Alert>
        )}
        <div className="rounded-md border border-line bg-surface p-4">
          <TextField
            label="Name"
            value={name}
            disabled={readOnly}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
          />
          <TextField
            label="Description (optional)"
            value={description}
            disabled={readOnly}
            onChange={(e) => {
              setDescription(e.target.value);
              setSaved(false);
            }}
          />
        </div>
        <h2 className="mb-2 mt-8 text-[13px] font-semibold">
          Permissions ({granted.size} selected)
        </h2>
        <div className="rounded-md border border-line bg-surface">
          {[...groups.entries()].map(([group, items]) => (
            <fieldset key={group} className="border-b border-line px-4 pb-3 last:border-b-0">
              <legend className="float-left w-full pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">
                {group.charAt(0).toUpperCase() + group.slice(1).replaceAll('_', ' ')}
              </legend>
              <div className="clear-both">
                {items.map((p) => (
                  <Checkbox
                    key={p.key}
                    label={p.description}
                    help={
                      p.sensitive
                        ? 'Sensitive: asks for a fresh two-factor code when used.'
                        : undefined
                    }
                    checked={granted.has(p.key)}
                    disabled={readOnly}
                    onChange={(e) => toggle(p.key, e.target.checked)}
                  />
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        {!readOnly && (
          <div className="mt-5 flex gap-2">
            <Button
              variant="primary"
              busy={save.isPending}
              disabled={name.trim().length < 2}
              onClick={() => {
                setError(null);
                save.mutate();
              }}
            >
              {role ? 'Save changes' : 'Create role'}
            </Button>
            <Button onClick={() => router.push('/roles')}>Cancel</Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${role?.name ?? 'role'}?`}
        confirmLabel="Delete role"
        danger
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirmDelete(false)}
      >
        The role is removed. A role that is still assigned to someone cannot be deleted; revoke
        those assignments first.
      </ConfirmDialog>
      <Drawer
        open={cloning}
        title="Clone role"
        onClose={() => setCloning(false)}
        footer={
          <>
            <Button onClick={() => setCloning(false)}>Cancel</Button>
            <Button
              variant="primary"
              busy={clone.isPending}
              disabled={cloneName.trim().length < 2}
              onClick={() => clone.mutate()}
            >
              Create copy
            </Button>
          </>
        }
      >
        <TextField
          label="Name of the copy"
          value={cloneName}
          onChange={(e) => setCloneName(e.target.value)}
          help="The copy starts with the same permissions and is fully editable."
        />
      </Drawer>
    </>
  );
}

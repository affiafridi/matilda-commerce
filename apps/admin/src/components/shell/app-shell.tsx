'use client';

import {
  Building2,
  ChevronDown,
  ClipboardList,
  Globe2,
  Home,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Store,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  type ComponentType,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  heldPermissions,
  stageRoute,
  useAdminContext,
  useAuthSession,
  useResetAuth,
} from '@/lib/auth';
import { http } from '@/lib/http';
import { type NavGroup, type NavIcon, visibleNav } from '@/lib/nav';
import { Wordmark } from '../auth-card';
import { ScopeProvider, useScope } from '../scope-context';
import { Alert, cx } from '../ui/primitives';

const ICONS: Record<NavIcon, ComponentType<{ size?: number; 'aria-hidden'?: boolean }>> = {
  home: Home,
  brands: Building2,
  markets: Globe2,
  branches: Store,
  customers: Users,
  employees: UserRound,
  roles: ShieldCheck,
  audit: ClipboardList,
};

const COLLAPSE_KEY = 'matilda-admin-nav-collapsed';

const collapseListeners = new Set<() => void>();

/** Remembered sidebar state: a tiny external store over localStorage (server renders expanded). */
function useNavCollapsed(): [boolean, () => void] {
  const collapsed = useSyncExternalStore(
    (listener) => {
      collapseListeners.add(listener);
      return () => collapseListeners.delete(listener);
    },
    () => {
      try {
        return window.localStorage.getItem(COLLAPSE_KEY) === '1';
      } catch {
        return false;
      }
    },
    () => false,
  );
  const toggle = useCallback(() => {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? '0' : '1');
    } catch {
      // Remembering the choice is a convenience only.
    }
    collapseListeners.forEach((listener) => listener());
  }, [collapsed]);
  return [collapsed, toggle];
}

/** Gate + frame for every signed-in screen: session check, navigation, scope, account menu. */
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const session = useAuthSession();
  const verified = session.data?.stage === 'VERIFIED';
  const context = useAdminContext(verified);
  const [collapsed, toggleCollapsed] = useNavCollapsed();
  const [mobileNav, setMobileNav] = useState(false);

  useEffect(() => {
    if (session.isPending) return;
    const route = stageRoute(session.data ?? null);
    if (route) router.replace(`${route}?next=${encodeURIComponent(pathname)}`);
  }, [session.isPending, session.data, router, pathname]);

  if (session.isError) {
    return (
      <div className="mx-auto max-w-md p-8">
        <Alert tone="danger">
          We could not reach the server. Check your connection and reload.
        </Alert>
      </div>
    );
  }
  if (!verified || !session.data || !context.data) {
    return (
      <div className="flex min-h-dvh items-center justify-center" role="status">
        <span className="text-[13px] text-muted">Loading…</span>
      </div>
    );
  }

  const groups = visibleNav(heldPermissions(context.data));

  return (
    <ScopeProvider context={context.data}>
      <div className="min-h-dvh md:flex">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:rounded-md focus:border focus:border-line-strong focus:bg-surface focus:px-3 focus:py-2"
        >
          Skip to content
        </a>

        <aside
          className={cx(
            'sticky top-0 hidden h-dvh shrink-0 flex-col border-e border-line bg-surface md:flex',
            collapsed ? 'w-14' : 'w-60',
          )}
        >
          <div className="flex h-12 items-center border-b border-line px-4">
            {collapsed ? (
              <span className="text-sm font-semibold" aria-label="Matilda Commerce">
                M
              </span>
            ) : (
              <Wordmark />
            )}
          </div>
          <NavList groups={groups} collapsed={collapsed} pathname={pathname} />
        </aside>

        <MobileNav open={mobileNav} onClose={() => setMobileNav(false)}>
          <NavList
            groups={groups}
            collapsed={false}
            pathname={pathname}
            onNavigate={() => setMobileNav(false)}
          />
        </MobileNav>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b border-line bg-surface px-3">
            <button
              type="button"
              onClick={() => setMobileNav(true)}
              aria-label="Open navigation"
              className="flex size-8 items-center justify-center rounded-md hover:bg-sunken md:hidden"
            >
              <Menu size={18} aria-hidden />
            </button>
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
              aria-expanded={!collapsed}
              className="hidden size-8 items-center justify-center rounded-md hover:bg-sunken md:flex"
            >
              {collapsed ? (
                <PanelLeftOpen size={18} aria-hidden />
              ) : (
                <PanelLeftClose size={18} aria-hidden />
              )}
            </button>
            <ScopeSwitchers />
            <div className="flex-1" />
            <AccountMenu name={session.data.fullName} email={session.data.email} />
          </header>

          <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 md:px-8">
            {children}
          </main>
        </div>
      </div>
    </ScopeProvider>
  );
}

function NavList({
  groups,
  collapsed,
  pathname,
  onNavigate,
}: {
  groups: NavGroup[];
  collapsed: boolean;
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto py-2">
      {groups.map((group) => (
        <div key={group.id} className="mb-1">
          {group.label && !collapsed && (
            <p className="px-4 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wide text-muted">
              {group.label}
            </p>
          )}
          <ul>
            {group.items.map((item) => {
              const Icon = ICONS[item.icon];
              const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                    className={cx(
                      'flex h-9 items-center gap-3 border-s-2 px-4 text-[13px]',
                      active
                        ? 'border-ink bg-sunken font-medium text-ink'
                        : 'border-transparent text-ink-2 hover:bg-sunken',
                    )}
                  >
                    <Icon size={16} aria-hidden />
                    <span className={collapsed ? 'sr-only' : undefined}>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function MobileNav({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-label="Navigation"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-0 h-dvh max-h-dvh w-72 max-w-[85vw] border-e border-line bg-surface p-0 text-ink md:hidden"
    >
      <div className="flex h-12 items-center justify-between border-b border-line px-4">
        <Wordmark />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close navigation"
          className="flex size-8 items-center justify-center rounded-md hover:bg-sunken"
        >
          <X size={18} aria-hidden />
        </button>
      </div>
      {children}
    </dialog>
  );
}

/** Brand → market → branch. Each level narrows the next; locked when there is nothing to choose. */
function ScopeSwitchers() {
  const { scope, choices, ready, selectBrand, selectMarket, selectBranch } = useScope();
  if (!ready) return <span className="text-[13px] text-muted">Loading access…</span>;
  return (
    <div role="group" aria-label="Working scope" className="flex min-w-0 items-center gap-2">
      <ScopeSelect
        label="Brand"
        value={scope.brandId ?? ''}
        locked={choices.brandLocked}
        allLabel={choices.allowAllBrands ? 'All brands' : null}
        options={choices.brands.map((b) => ({ id: b.id, name: b.name }))}
        onChange={(v) => void selectBrand(v || null)}
      />
      <div className="hidden items-center gap-2 sm:flex">
        <ScopeSelect
          label="Market"
          value={scope.marketId ?? ''}
          locked={choices.marketLocked}
          allLabel="All markets"
          options={choices.markets.map((m) => ({ id: m.id, name: m.code.toUpperCase() }))}
          onChange={(v) => selectMarket(v || null)}
        />
        <ScopeSelect
          label="Branch"
          value={scope.branchId ?? ''}
          locked={choices.branchLocked}
          allLabel="All branches"
          options={choices.branches.map((b) => ({ id: b.id, name: b.name }))}
          onChange={(v) => selectBranch(v || null)}
        />
      </div>
    </div>
  );
}

function ScopeSelect({
  label,
  value,
  locked,
  allLabel,
  options,
  onChange,
}: {
  label: string;
  value: string;
  locked: boolean;
  allLabel: string | null;
  options: Array<{ id: string; name: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
      {label}
      <span className="relative flex items-center">
        <select
          value={value}
          disabled={locked || options.length === 0}
          title={locked ? 'Your access is limited to this selection' : undefined}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 max-w-[11rem] appearance-none truncate rounded-md border border-line-strong bg-surface ps-2 pe-7 text-[13px] text-ink disabled:bg-sunken disabled:text-ink-2"
        >
          {allLabel && <option value="">{allLabel}</option>}
          {!allLabel && value === '' && <option value="">Select…</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          size={14}
          className="pointer-events-none absolute end-2 text-muted"
        />
      </span>
    </label>
  );
}

function AccountMenu({ name, email }: { name: string; email: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const resetAuth = useResetAuth();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function signOut() {
    try {
      await http.post('/admin/auth/logout', {}, { redirectOn401: false });
    } catch {
      // Already signed out is fine.
    }
    resetAuth('/sign-in');
  }

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 items-center gap-2 rounded-md px-2 text-[13px] hover:bg-sunken"
      >
        <span className="max-w-[10rem] truncate">{name}</span>
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div className="absolute end-0 top-9 z-20 w-60 rounded-md border border-line-strong bg-surface py-1">
          <div className="border-b border-line px-3 pb-2 pt-1">
            <p className="truncate text-[13px] font-medium">{name}</p>
            <p className="truncate text-xs text-muted">{email}</p>
          </div>
          <Link
            href="/account/security"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-[13px] hover:bg-sunken"
          >
            Security
          </Link>
          <button
            type="button"
            onClick={signOut}
            className="block w-full px-3 py-2 text-start text-[13px] hover:bg-sunken"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

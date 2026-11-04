import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Popover from '@radix-ui/react-popover';
import {
  Activity, AlarmClock, Bell, Building2, Check, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, FolderKanban, Gauge, KeyRound, LayoutDashboard, Layers, LogOut, Moon, Network, ShieldAlert, ShieldCheck, Sun,
} from 'lucide-react';
import { api } from '../lib/api';
import { fmtDateTime, ROLE_LABEL } from '../lib/format';
import { CARRIED_KEYS, useCarry, useMe, usePrefs } from '../lib/hooks';
import { Button, EmptyState, ErrorState, Loader } from './ui';

export function applyTheme(theme: string) {
  document.documentElement.dataset.theme = theme;
}

export function RoleIndicator({ role, approval }: { role: string; approval: boolean }) {
  return (
    <span className="hidden items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[11px] sm:inline-flex" title="Your active role">
      <ShieldCheck size={12} className="text-primary" aria-hidden />
      {ROLE_LABEL[role]}
      {approval && <span className="rounded bg-accent-bg px-1 text-primary">Risk approver</span>}
    </span>
  );
}

/** Only rendered for administrators. The server also refuses this switch for anyone else. */
export function PortfolioScopeSwitcher({ mode }: { mode: 'own' | 'all' }) {
  const client = useQueryClient();
  const [, setParams] = useSearchParams();
  const change = useMutation({
    mutationFn: (next: string) => api.post('/api/me/portfolio-mode', { mode: next }),
    onSuccess: async () => {
      // A customer chosen in the previous mode may be out of scope in the next one.
      setParams((prev) => {
        const next = new URLSearchParams();
        const tab = prev.get('tab');
        if (tab) next.set('tab', tab);
        return next;
      });
      await client.invalidateQueries();
    },
  });
  return (
    <div role="group" aria-label="Portfolio scope" className="inline-flex overflow-hidden rounded border border-line text-[11px]">
      {[['own', 'Own portfolio'], ['all', 'All customers']].map(([value, label]) => (
        <button key={value} type="button" aria-pressed={mode === value} disabled={change.isPending} onClick={() => mode !== value && change.mutate(value)} className={`px-2 py-1 ${mode === value ? 'bg-primary-strong text-on-primary' : 'bg-surface-2 hover:text-primary'}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function CustomerSelector({ customers }: { customers: { id: string; name: string; code: string }[] }) {
  const [params, setParams] = useSearchParams();
  const { save } = usePrefs();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const current = customers.find((c) => c.id === params.get('customerId'));
  const matches = customers.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));
  const select = (id: string | null) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set('customerId', id);
      else next.delete('customerId');
      for (const k of ['serviceId', 'systemId', 'objectId', 'record', 'page']) next.delete(k);
      return next;
    });
    save({ customerId: id ?? '' });
    setOpen(false);
    setSearch('');
  };
  const single = customers.length === 1;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button aria-label={`Customer scope: ${current?.name ?? (single ? customers[0].name : 'All customers in scope')}`}>
          <Building2 size={12} aria-hidden />
          <span className="max-w-40 truncate">{current?.name ?? (single ? customers[0].name : `All in scope (${customers.length})`)}</span>
          {!single && <ChevronDown size={12} aria-hidden />}
        </Button>
      </Popover.Trigger>
      {!single && (
        <Popover.Portal>
          <Popover.Content align="start" sideOffset={4} className="z-50 w-64 rounded border border-line bg-surface-2 p-2 text-xs shadow-lg">
            <label>
              <span className="sr-only">Search customers</span>
              <input autoFocus type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customers" className="mb-1 w-full" />
            </label>
            <ul className="flex flex-col">
              <li>
                <button type="button" onClick={() => select(null)} className="flex w-full items-center justify-between rounded px-1.5 py-1 text-left hover:bg-surface">
                  All customers in scope {!current && <Check size={12} aria-hidden />}
                </button>
              </li>
              {matches.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => select(c.id)} className="flex w-full items-center justify-between rounded px-1.5 py-1 text-left hover:bg-surface">
                    {c.name} {current?.id === c.id && <Check size={12} aria-hidden />}
                  </button>
                </li>
              ))}
              {matches.length === 0 && <li className="px-1.5 py-1 text-muted">No customer matches.</li>}
            </ul>
          </Popover.Content>
        </Popover.Portal>
      )}
    </Popover.Root>
  );
}

export function NotificationCenter() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const query = useQuery({ queryKey: ['notifications'], queryFn: () => api.get('/api/notifications'), refetchInterval: 60_000 });
  const read = useMutation({
    mutationFn: (id?: string) => api.post('/api/notifications/read', id ? { id } : {}),
    onSuccess: () => client.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unread = query.data?.unread ?? 0;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button variant="ghost" aria-label={`Notifications, ${unread} unread`} className="relative">
          <Bell size={15} aria-hidden />
          {unread > 0 && <span className="num absolute -right-1 -top-1 rounded-full bg-primary-strong px-1 text-[10px] text-on-primary">{unread > 99 ? '99+' : unread}</span>}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={4} className="z-50 max-h-[70vh] w-96 max-w-[95vw] overflow-y-auto rounded border border-line bg-surface-2 text-xs shadow-lg">
          <div className="flex items-center justify-between border-b border-line px-2.5 py-1.5">
            <strong>Notifications</strong>
            <Button variant="ghost" disabled={unread === 0} onClick={() => read.mutate(undefined)}>Mark all read</Button>
          </div>
          {query.isLoading && <Loader />}
          {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
          {query.data?.rows.length === 0 && <EmptyState title="No notifications" />}
          <ul>
            {query.data?.rows.map((n: any) => (
              <li key={n.id} className="border-b border-line/60">
                <button
                  type="button"
                  className="block w-full px-2.5 py-1.5 text-left hover:bg-surface"
                  onClick={() => {
                    if (!n.read_at) read.mutate(n.id);
                    setOpen(false);
                    navigate(n.link);
                  }}
                >
                  <span className="flex items-center gap-1 font-medium">
                    {!n.read_at && <span className="rounded bg-accent-bg px-1 text-[10px] text-primary">New</span>}
                    {n.title}
                  </span>
                  <span className="block text-muted">{n.body}</span>
                  <span className="num block text-[11px] text-muted">{n.customer_name} · {fmtDateTime(n.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function NavBar({ me }: { me: any }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { prefs, save } = usePrefs();
  const theme = prefs.theme ?? 'dark';
  const logout = useMutation({
    mutationFn: () => api.post('/api/auth/logout'),
    onSuccess: () => {
      client.clear();
      navigate('/login');
    },
  });
  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-1.5">
      <Link to="/" className="mr-1 flex items-baseline gap-1.5" aria-label="ProIT home">
        <span className="text-[15px] font-bold tracking-tight">Pro<span className="text-primary">IT</span></span>
        <span className="hidden text-[11px] text-muted lg:inline">Operations Service Dashboard</span>
      </Link>
      <RoleIndicator role={me.user.role} approval={me.riskAuthority.length > 0} />
      {me.canSwitchPortfolio && <PortfolioScopeSwitcher mode={me.mode} />}
      <CustomerSelector customers={me.customers} />
      <div className="ml-auto flex items-center gap-1">
        <NotificationCenter />
        <Button
          variant="ghost"
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={() => {
            const next = theme === 'dark' ? 'light' : 'dark';
            applyTheme(next);
            save({ theme: next });
          }}
        >
          {theme === 'dark' ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />}
        </Button>
        <Popover.Root>
          <Popover.Trigger asChild>
            <Button variant="ghost" aria-label={`User profile: ${me.user.name}`}>
              <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-bg text-[10px] font-semibold text-primary">{me.user.name.split(' ').map((p: string) => p[0]).join('')}</span>
              <span className="hidden sm:inline">{me.user.name}</span>
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content align="end" sideOffset={4} className="z-50 w-64 rounded border border-line bg-surface-2 p-2.5 text-xs shadow-lg">
              <strong className="block">{me.user.name}</strong>
              <span className="block text-muted">{me.user.title}</span>
              <span className="block text-muted">{me.user.email}</span>
              <p className="mt-1.5">Role: {ROLE_LABEL[me.user.role]}</p>
              <p>Scope: {me.customers.map((c: any) => c.name).join(', ')}</p>
              {me.riskAuthority.length > 0 && <p>Risk approval: {me.riskAuthority.map((r: any) => `${me.customers.find((c: any) => c.id === r.customer_id)?.name} (${r.kind})`).join(', ')}</p>}
              <Button className="mt-2 w-full justify-center" disabled={logout.isPending} onClick={() => logout.mutate()}>
                <LogOut size={12} aria-hidden /> Sign out
              </Button>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </header>
  );
}

const NAV = [
  ['/', 'Overview', LayoutDashboard],
  ['/portfolio', 'Portfolio', Network],
  ['/requests', 'Requests & Incidents', ClipboardList],
  ['/projects', 'Projects & Tasks', FolderKanban],
  ['/alarms', 'Alarms', AlarmClock],
  ['/vulnerabilities', 'Vulnerabilities', ShieldAlert],
  ['/hardening', 'Hardening', ShieldCheck],
  ['/availability', 'Availability & SLA', Activity],
  ['/lifecycle', 'Lifecycle', Layers],
  ['/licenses', 'Licenses', KeyRound],
  ['/risk-acceptances', 'Risk Acceptances', Gauge],
] as const;

export function Sidebar() {
  const { prefs, save } = usePrefs();
  const carry = useCarry();
  const collapsed = prefs.sidebarCollapsed === true;
  return (
    <nav aria-label="Main views" className={`flex shrink-0 flex-col border-r border-line bg-surface py-1 ${collapsed ? 'w-11' : 'w-11 md:w-48'}`}>
      <ul className="flex-1 space-y-0.5 px-1">
        {NAV.map(([path, label, Icon]) => (
          <li key={path}>
            <NavLink
              to={carry(path)}
              end={path === '/'}
              title={label}
              aria-label={label}
              className={({ isActive }) => `flex items-center gap-2 rounded px-2 py-1.5 text-xs ${isActive ? 'bg-accent-bg font-semibold text-primary' : 'text-fg hover:bg-surface-2'}`}
            >
              <Icon size={15} aria-hidden className="shrink-0" />
              {!collapsed && <span className="hidden truncate md:inline">{label}</span>}
            </NavLink>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => save({ sidebarCollapsed: !collapsed })} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} className="mx-1 mt-1 hidden items-center justify-center rounded p-1.5 text-muted hover:bg-surface-2 md:flex">
        {collapsed ? <ChevronRight size={14} aria-hidden /> : <ChevronLeft size={14} aria-hidden />}
      </button>
    </nav>
  );
}

export function Shell() {
  const me = useMe();
  const navigate = useNavigate();
  const { prefs, loaded } = usePrefs();
  const [params, setParams] = useSearchParams();
  const appliedCustomer = useRef(false);

  useEffect(() => {
    if ((me.error as any)?.status === 401) navigate('/login');
  }, [me.error, navigate]);

  useEffect(() => {
    if (loaded) applyTheme(prefs.theme ?? 'dark');
  }, [loaded, prefs.theme]);

  const customerIds = useMemo(() => (me.data?.customers ?? []).map((c: any) => c.id) as string[], [me.data]);

  // Restores the saved customer once, and drops any customer that is outside the scope.
  useEffect(() => {
    if (!me.data || !loaded) return;
    const current = params.get('customerId');
    if (current && !customerIds.includes(current)) {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const k of CARRIED_KEYS.slice(0, 4)) next.delete(k);
        return next;
      }, { replace: true });
    } else if (!current && !appliedCustomer.current && prefs.customerId && customerIds.includes(prefs.customerId)) {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('customerId', prefs.customerId);
        return next;
      }, { replace: true });
    }
    appliedCustomer.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.data, loaded, customerIds]);

  if (me.isLoading) return <Loader label="Checking your session" />;
  if (me.isError) {
    if ((me.error as any)?.status === 401) return <Loader label="Redirecting to sign in" />;
    return <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  }
  return (
    <div className="flex h-full flex-col">
      <NavBar me={me.data} />
      <div className="bg-accent-bg px-3 py-0.5 text-[11px] text-primary">Demo prototype. All companies, people and records are fictional, and integrations are simulated.</div>
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto p-3">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

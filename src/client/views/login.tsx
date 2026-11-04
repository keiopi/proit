import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { LogIn, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { ROLE_LABEL } from '../lib/format';
import { applyTheme } from '../components/shell';
import { ErrorState, Loader } from '../components/ui';

export function LoginView() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const accounts = useQuery<any[]>({ queryKey: ['accounts'], queryFn: () => api.get('/api/auth/accounts') });
  const login = useMutation({
    mutationFn: (userId: string) => api.post('/api/auth/login', { userId }),
    onSuccess: () => {
      client.clear();
      navigate('/');
    },
  });

  useEffect(() => applyTheme('dark'), []);

  return (
    <main className="mx-auto max-w-3xl p-4 md:p-8">
      <h1 className="text-2xl font-bold tracking-tight">Pro<span className="text-primary">IT</span></h1>
      <p className="text-muted">Operations Service Dashboard for IT Services & Management</p>
      <div className="mt-4 rounded border border-line bg-surface p-3">
        <h2 className="font-semibold">Simulated single sign-on</h2>
        <p className="text-xs text-muted">Choose a demo account to continue. There are no passwords. All companies, people and records are fictional, and any change you make is visible to everyone using this demo.</p>
        {accounts.isLoading && <Loader />}
        {accounts.isError && <ErrorState error={accounts.error} onRetry={() => accounts.refetch()} />}
        {login.isError && <ErrorState error={login.error} />}
        <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {accounts.data?.map((a) => (
            <li key={a.id}>
              <button type="button" disabled={login.isPending} onClick={() => login.mutate(a.id)} className="flex h-full w-full flex-col gap-0.5 rounded border border-line bg-surface-2 p-2 text-left text-xs hover:border-primary">
                <span className="flex items-center justify-between gap-2 font-semibold">
                  {a.name} <LogIn size={13} aria-hidden className="text-muted" />
                </span>
                <span className="text-muted">{a.title}</span>
                <span>{ROLE_LABEL[a.role]}</span>
                <span className="text-muted">
                  Scope: {a.scope.join(', ')}
                  {a.canSwitchToAll && '. Can switch to all customers'}
                </span>
                {a.riskApproval.map((r: any) => (
                  <span key={r.customer} className="inline-flex items-center gap-1 text-primary">
                    <ShieldCheck size={12} aria-hidden /> Risk approval, {r.customer} ({r.kind})
                  </span>
                ))}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}

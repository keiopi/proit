import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles.css';
import { ApiError } from './lib/api';
import { Shell } from './components/shell';
import { LoginView } from './views/login';
import { OverviewView, PortfolioView } from './views/overview';
import { AlarmsView, ProjectsView, RequestsView, VulnerabilitiesView } from './views/operational';
import { HardeningView } from './views/hardening';
import { AvailabilityView } from './views/availability';
import { LifecycleView } from './views/lifecycle';
import { LicensesView } from './views/licenses';
import { RiskView } from './views/risk';
import { SourceView } from './views/source';

const client = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginView />} />
          <Route element={<Shell />}>
            <Route index element={<OverviewView />} />
            <Route path="portfolio" element={<PortfolioView />} />
            <Route path="requests" element={<RequestsView />} />
            <Route path="projects" element={<ProjectsView />} />
            <Route path="alarms" element={<AlarmsView />} />
            <Route path="vulnerabilities" element={<VulnerabilitiesView />} />
            <Route path="hardening" element={<HardeningView />} />
            <Route path="availability" element={<AvailabilityView />} />
            <Route path="lifecycle" element={<LifecycleView />} />
            <Route path="licenses" element={<LicensesView />} />
            <Route path="risk-acceptances" element={<RiskView />} />
            <Route path="source/:integration/:id" element={<SourceView />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

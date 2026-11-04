# ProIT

Operations Service Dashboard for IT Services & Management. A prototype that gives customers, customer managers and system administrators one overview of service requests, incidents, projects, tasks, monitoring, vulnerabilities, hardening, availability, lifecycle and licensing.

All companies, people and records are fictional. The integrations are simulated.

## Where it runs

The app runs on Railway, not on a local computer. There is no local database or server.

1. Create a Railway service linked to this GitHub repository, on the `main` branch.
2. Add a PostgreSQL database and reference its `DATABASE_URL` on the service.
3. Generate a public domain for the service.

Each push to `main` deploys. `railway.json` holds the build command, the start command and the `/api/health` healthcheck.

## Commands

Install dependencies with:

```bash
npm install
```

| Command | What it does | Where |
| --- | --- | --- |
| `npm run build` | Type-checks, then builds the client and server. Run before every push. | Anywhere |
| `npm test` | Runs the automated tests on PGlite, an in-process Postgres engine. | Anywhere |
| `npm start` | Starts the built server. Requires `DATABASE_URL`. | Railway |
| `npm run db:migrate` | Applies pending migrations. | Railway |
| `npm run db:seed` | Seeds demo data if the database is empty. | Railway |
| `CONFIRM_RESET=yes npm run db:reset` | **Deletes all data**, then migrates and reseeds. | Railway |

The server applies migrations at startup, and seeds the demo data when the database is empty. The `db:*` commands need a build and `DATABASE_URL`, so run them in the Railway environment, for example with `railway run`.

The server binds to `0.0.0.0` on Railway and to `127.0.0.1` anywhere else.

## Demo accounts

The login page is a simulated single sign-on. Choose an account; there are no passwords.

| Name | Role | Scope | Risk approval |
| --- | --- | --- | --- |
| Nora Lind | Customer | Northbridge Finance | None |
| Nina Vance | Customer | Northbridge Finance | Owner |
| Nate Cole | Customer | Northbridge Finance | Delegate |
| Ivan Holt | Customer | Ironvale Manufacturing | None |
| Isla Renn | Customer | Ironvale Manufacturing | Owner |
| Cara Mills | Customer | Cedar Retail | None |
| Cole Dorn | Customer | Cedar Retail | Owner |
| Maya Trent | Customer Manager | Northbridge Finance, Ironvale Manufacturing | None |
| Marek Stone | Customer Manager | Cedar Retail | None |
| Alex Quinn | System Administrator | Own portfolio: Ironvale Manufacturing, Cedar Retail. Can switch to all customers | None |

## Architecture

One npm package deployed as one service. Express serves `/api` and the built React client.

```
src/domain/      Pure calculations and state machines, with no I/O
src/server/      Sessions, scope, API routes, repositories, simulated adapters
src/server/db/   Database interface, migration runner, seed, reset command
src/client/      React app: shell, shared components, the 11 views
migrations/      SQL migrations
tests/           Domain tests and API tests
```

**Stack:** React, TypeScript, Vite, Tailwind CSS, Radix UI, TanStack Query, Recharts, Express, PostgreSQL, Vitest.

**Authorization:** the session cookie is HTTP-only and maps to a row in the `sessions` table. The server works out the user, role and customer scope from that row. It never reads them from the request. Every data function takes a required `Scope`, and a requested customer can only narrow it. A record outside the scope returns 404. Risk approval comes from the `risk_approvers` table and has nothing to do with role, so administrators cannot approve.

**Adapters:** `src/server/adapters/index.ts` has a separate interface for OpenText ServiceManager, Atlassian Jira, GitLab and Zabbix. Each simulated adapter reads seeded data. A real client can replace one adapter without touching the others.

## Calculations

Reporting periods use half-open boundaries, `[start, end)`, in UTC. Results are calculated up to the current time.

**Hardening score:** Passed / (Passed + Failed + Warning). Not applicable is excluded, and Not checked is reported as a coverage gap. With a denominator of 0, the app shows "No evaluated controls". Risk acceptances are not an input, so they cannot change a result or improve the score. Accepted exceptions are reported separately.

**Object availability:** (eligible monitored duration - counted downtime) / eligible monitored duration x 100. Overlapping outages are merged first. By default, planned maintenance leaves both the eligible duration and the downtime. If an administrator turns that rule off, maintenance counts as downtime. An object is Unknown when under 80% of the period has monitoring data.

**Service and customer SLA:** weighted means of included members. If an included member is Unknown, the aggregate is Incomplete with no value. Its weight stays reported as missing and is never redistributed. A result is At risk when it is less than 0.05 percentage points above target.

**Lifecycle:** status follows only a verified end-of-support date. Approaching means within 180 days. A missing or unverified date gives Unknown. End of life and extended support are shown separately.

**Licenses:** balance is entitlement minus measured consumption. Quantities are only compared within one unit and contractual scope, so no total crosses units. Use above entitlement is a potential shortfall, not a compliance finding. A missing measurement is flagged and never treated as zero.

**Attention list:** adds points for severity (up to 40), service criticality (up to 30) and the customer's SLA status (up to 30). The drawer shows each factor.

## Known prototype limitations

- **No access gate:** anyone with the URL can sign in as any demo account and change data. Use fictional data only.
- **Shared demo data:** every visitor sees edits made by others, until the database is reset.
- **Dates drift:** sample dates are relative to the seed time. Upcoming examples pass over time until the database is reset.
- **Simulated integrations:** adapters read seeded data, and a refresh only updates sync timestamps and health.
- **Simplified control scans:** a new control version comes from an administrator's demo action rather than a real scan, and results do not change when it runs.
- **Calculation scale:** lists and SLA results are computed in memory per request, which suits this data volume but not a large production one.
- **In-app notifications only:** no email is sent.

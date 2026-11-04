import type { Db } from './db';
import { insertRows } from './db';
import { emptyTally, tally, type ControlResult } from '../../domain/hardening';

const DAY = 86_400_000;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Profile = 'healthy' | 'at_risk' | 'breach' | 'down' | 'nodata' | 'gap';
type ObjectType = 'windows' | 'linux' | 'database' | 'network';
type ObjDef = [name: string, type: ObjectType, os: string, profile?: Profile];

interface SystemDef { key: string; name: string; objects: ObjDef[] }
interface ServiceDef { key: string; name: string; desc: string; crit: string; target: number; weight: number; systems: SystemDef[] }
interface CustomerDef {
  id: string; name: string; code: string; desc: string; target: number;
  customerUser: string; riskOwner: string; manager: string; owner: string;
  services: ServiceDef[];
}

const WIN22 = 'Windows Server 2022';
const WIN12 = 'Windows Server 2012 R2';
const RHEL9 = 'Red Hat Enterprise Linux 9';
const RHEL7 = 'Red Hat Enterprise Linux 7';
const UBU22 = 'Ubuntu 22.04 LTS';
const IOS = 'Cisco IOS XE 17.9';
const APPLIANCE = 'Vendor Appliance OS 4';

const CATALOG: CustomerDef[] = [
  {
    id: 'northbridge', name: 'Northbridge Finance', code: 'NBF', desc: 'Regional finance group with core banking and payments services.', target: 99.9,
    customerUser: 'u-nora', riskOwner: 'u-nina', manager: 'u-maya', owner: 'Nora Lind',
    services: [
      { key: 'core', name: 'Core Banking Platform', desc: 'Accounts and ledger processing for retail banking.', crit: 'critical', target: 99.9, weight: 3, systems: [
        { key: 'app', name: 'Core Banking Application', objects: [['nb-core-app01', 'windows', WIN22], ['nb-core-app02', 'linux', RHEL9]] },
        { key: 'db', name: 'Core Banking Database', objects: [['nb-core-db01', 'database', RHEL9], ['nb-core-db02', 'database', RHEL9, 'at_risk']] },
      ] },
      { key: 'pay', name: 'Payments Gateway', desc: 'Card and instant payment routing.', crit: 'critical', target: 99.9, weight: 2, systems: [
        { key: 'gw', name: 'Gateway Cluster', objects: [['nb-pay-gw01', 'linux', UBU22], ['nb-pay-gw02', 'linux', UBU22]] },
        { key: 'edge', name: 'Payment Network Edge', objects: [['nb-pay-fw01', 'network', IOS], ['nb-pay-sw01', 'network', IOS]] },
      ] },
      { key: 'work', name: 'Employee Workplace', desc: 'File, identity and collaboration services for staff.', crit: 'medium', target: 99.5, weight: 1, systems: [
        { key: 'id', name: 'Identity Services', objects: [['nb-work-dc01', 'windows', WIN12], ['nb-work-dc02', 'windows', WIN22]] },
        { key: 'file', name: 'File Services', objects: [['nb-work-fs01', 'windows', WIN22, 'gap']] },
      ] },
    ],
  },
  {
    id: 'ironvale', name: 'Ironvale Manufacturing', code: 'IVM', desc: 'Industrial manufacturer running plant execution and ERP services.', target: 99.5,
    customerUser: 'u-ivan', riskOwner: 'u-isla', manager: 'u-maya', owner: 'Ivan Holt',
    services: [
      { key: 'mes', name: 'Manufacturing Execution', desc: 'Shop floor order execution and traceability.', crit: 'critical', target: 99.9, weight: 3, systems: [
        { key: 'app', name: 'MES Application', objects: [['iv-mes-app01', 'windows', WIN22, 'breach'], ['iv-mes-app02', 'windows', WIN12]] },
        { key: 'db', name: 'MES Database', objects: [['iv-mes-db01', 'database', RHEL7], ['iv-mes-db02', 'database', RHEL9]] },
      ] },
      { key: 'erp', name: 'ERP Production', desc: 'Finance, supply chain and production planning.', crit: 'high', target: 99.5, weight: 2, systems: [
        { key: 'app', name: 'ERP Application Tier', objects: [['iv-erp-app01', 'linux', RHEL9], ['iv-erp-app02', 'linux', RHEL9, 'at_risk']] },
        { key: 'db', name: 'ERP Database Tier', objects: [['iv-erp-db01', 'database', RHEL9]] },
      ] },
      { key: 'net', name: 'Plant Network', desc: 'Connectivity between plant floors and data centre.', crit: 'high', target: 99.5, weight: 2, systems: [
        { key: 'core', name: 'Plant Core Network', objects: [['iv-net-core01', 'network', IOS, 'down'], ['iv-net-core02', 'network', IOS]] },
        { key: 'ot', name: 'OT Gateway', objects: [['iv-net-ot01', 'network', APPLIANCE]] },
      ] },
    ],
  },
  {
    id: 'cedar', name: 'Cedar Retail', code: 'CDR', desc: 'Omnichannel retailer with online storefront and store systems.', target: 99.5,
    customerUser: 'u-cara', riskOwner: 'u-cole', manager: 'u-marek', owner: 'Cara Mills',
    services: [
      { key: 'shop', name: 'E-commerce Storefront', desc: 'Public web shop and checkout.', crit: 'critical', target: 99.9, weight: 3, systems: [
        { key: 'web', name: 'Web Tier', objects: [['cd-shop-web01', 'linux', UBU22], ['cd-shop-web02', 'linux', UBU22]] },
        { key: 'db', name: 'Order Database', objects: [['cd-shop-db01', 'database', RHEL9]] },
      ] },
      { key: 'pos', name: 'POS Backend', desc: 'Store point-of-sale transactions and pricing.', crit: 'high', target: 99.5, weight: 2, systems: [
        { key: 'app', name: 'POS Application', objects: [['cd-pos-app01', 'windows', WIN22], ['cd-pos-app02', 'windows', WIN12, 'at_risk']] },
        { key: 'net', name: 'Store WAN', objects: [['cd-pos-wan01', 'network', IOS]] },
      ] },
      { key: 'loy', name: 'Loyalty Analytics', desc: 'Customer loyalty reporting and campaign data.', crit: 'low', target: 99, weight: 1, systems: [
        { key: 'dw', name: 'Analytics Warehouse', objects: [['cd-loy-dw01', 'database', RHEL9], ['cd-loy-etl01', 'linux', APPLIANCE, 'nodata']] },
      ] },
    ],
  },
];

const USERS = [
  ['u-nora', 'Nora Lind', 'nora.lind@northbridge.example', 'IT Service Coordinator', 'customer'],
  ['u-nina', 'Nina Vance', 'nina.vance@northbridge.example', 'Head of IT Risk', 'customer'],
  ['u-nate', 'Nate Cole', 'nate.cole@northbridge.example', 'Deputy IT Risk Officer', 'customer'],
  ['u-ivan', 'Ivan Holt', 'ivan.holt@ironvale.example', 'Plant IT Lead', 'customer'],
  ['u-isla', 'Isla Renn', 'isla.renn@ironvale.example', 'Risk & Compliance Lead', 'customer'],
  ['u-cara', 'Cara Mills', 'cara.mills@cedar.example', 'Retail IT Manager', 'customer'],
  ['u-cole', 'Cole Dorn', 'cole.dorn@cedar.example', 'Information Security Lead', 'customer'],
  ['u-maya', 'Maya Trent', 'maya.trent@proit.example', 'Customer Manager', 'manager'],
  ['u-marek', 'Marek Stone', 'marek.stone@proit.example', 'Customer Manager', 'manager'],
  ['u-alex', 'Alex Quinn', 'alex.quinn@proit.example', 'System Administrator', 'admin'],
] as const;

const ASSIGNMENTS: [string, string][] = [
  ['u-nora', 'northbridge'], ['u-nina', 'northbridge'], ['u-nate', 'northbridge'],
  ['u-ivan', 'ironvale'], ['u-isla', 'ironvale'],
  ['u-cara', 'cedar'], ['u-cole', 'cedar'],
  ['u-maya', 'northbridge'], ['u-maya', 'ironvale'],
  ['u-marek', 'cedar'],
  ['u-alex', 'ironvale'], ['u-alex', 'cedar'],
];

const APPROVERS: [string, string, string][] = [
  ['u-nina', 'northbridge', 'owner'],
  ['u-nate', 'northbridge', 'delegate'],
  ['u-isla', 'ironvale', 'owner'],
  ['u-cole', 'cedar', 'owner'],
];

const REQUEST_TITLES = [
  ['Add service account for reporting job', 'Create a least-privilege service account for the nightly reporting job.'],
  ['Open firewall path for vendor support', 'Time-limited firewall rule so the vendor can reach the support endpoint.'],
  ['Increase disk allocation', 'Extend the data volume before the forecast growth threshold is reached.'],
  ['Renew internal TLS certificate', 'Replace the internal certificate ahead of its expiry date.'],
  ['Schedule patch window', 'Agree a patch window with the service owner for the next cycle.'],
  ['Restore test copy of database', 'Restore the latest backup into the test environment for validation.'],
  ['Grant read access to monitoring', 'Give the application team read access to the monitoring dashboards.'],
];

const INCIDENT_TITLES = [
  ['Application response time degraded', 'Users report slow responses. Latency alarms confirm elevated response time.'],
  ['Disk space exhausted on data volume', 'A data volume filled up and write operations started failing.'],
  ['Failed overnight batch', 'The overnight batch stopped early and the output needs to be reprocessed.'],
  ['Cluster node unreachable', 'One node stopped answering health checks and traffic moved to its peer.'],
  ['Authentication failures for service users', 'Service users intermittently fail to authenticate against the directory.'],
];

const ALARM_TITLES = [
  ['CPU utilisation above 95% for 15 minutes', 'Sustained CPU saturation reported by the Zabbix agent.'],
  ['Free disk space below threshold', 'The monitored volume dropped below the configured free space trigger.'],
  ['Service health check failing', 'The application health endpoint returned errors on consecutive checks.'],
  ['Memory pressure detected', 'Available memory dropped below the trigger and swap activity increased.'],
  ['Interface packet loss above 2%', 'Packet loss on the monitored interface exceeded the trigger.'],
  ['Replication lag above threshold', 'The replica is behind the primary by more than the allowed time.'],
];

const VULN_TITLES = [
  ['Remote code execution in TLS library', 'Crafted handshake messages can lead to remote code execution.', 'critical', 9.8],
  ['Privilege escalation in kernel subsystem', 'A local user can gain elevated privileges through a race condition.', 'high', 7.8],
  ['SQL injection in admin console', 'Unsanitised input in the admin console allows arbitrary queries.', 'critical', 9.1],
  ['Denial of service in web server module', 'Malformed requests can exhaust worker processes.', 'medium', 5.9],
  ['Information disclosure in management API', 'An unauthenticated endpoint exposes configuration metadata.', 'medium', 5.3],
  ['Outdated cipher suites enabled', 'Legacy cipher suites remain negotiable on the listener.', 'low', 3.7],
] as const;

const BASELINES: Record<ObjectType, { id: string; name: string; version: string }> = {
  windows: { id: 'bl-win', name: 'CIS Windows Server Benchmark (demo)', version: '3.0' },
  linux: { id: 'bl-linux', name: 'CIS Linux Benchmark (demo)', version: '2.1' },
  database: { id: 'bl-db', name: 'Database Hardening Standard (demo)', version: '1.4' },
  network: { id: 'bl-net', name: 'Network Device Hardening Standard (demo)', version: '1.2' },
};

const CONTROLS: Record<ObjectType, [string, string, string, string][]> = {
  windows: [
    ['WIN-1.1', 'Password policy enforces 14+ characters', 'high', 'Set the minimum password length to 14 through group policy.'],
    ['WIN-2.3', 'SMBv1 protocol disabled', 'critical', 'Disable SMBv1 with Disable-WindowsOptionalFeature and reboot.'],
    ['WIN-3.2', 'Audit logon events enabled', 'medium', 'Enable success and failure auditing for logon events.'],
    ['WIN-4.1', 'RDP requires network level authentication', 'high', 'Enable NLA in the Remote Desktop host configuration.'],
    ['WIN-5.5', 'Guest account disabled', 'medium', 'Disable the built-in Guest account.'],
    ['WIN-6.1', 'Print spooler stopped when not required', 'low', 'Stop and disable the Print Spooler service where unused.'],
  ],
  linux: [
    ['LNX-1.4', 'SSH root login disabled', 'critical', 'Set PermitRootLogin no in sshd_config and reload sshd.'],
    ['LNX-2.2', 'Filesystem permissions on /etc/shadow', 'high', 'Set /etc/shadow to mode 0640 owned by root:shadow.'],
    ['LNX-3.1', 'Audit daemon running', 'medium', 'Enable and start the auditd service.'],
    ['LNX-4.6', 'Unused kernel modules disabled', 'low', 'Blacklist unused filesystem modules via modprobe.d.'],
    ['LNX-5.3', 'Time synchronization configured', 'medium', 'Configure chrony against the approved time sources.'],
    ['LNX-6.2', 'Local firewall enabled', 'high', 'Enable the host firewall with a default deny inbound policy.'],
  ],
  database: [
    ['DB-1.1', 'Default accounts removed or locked', 'critical', 'Lock or remove default accounts and rotate credentials.'],
    ['DB-2.1', 'Encryption in transit enforced', 'high', 'Require TLS for all client connections.'],
    ['DB-3.4', 'Audit logging enabled', 'medium', 'Enable audit logging for privileged operations.'],
    ['DB-4.2', 'Backups encrypted', 'high', 'Enable encryption on the backup target.'],
    ['DB-5.1', 'Public role privileges minimised', 'medium', 'Revoke unnecessary grants from the public role.'],
  ],
  network: [
    ['NET-1.2', 'Telnet disabled on management plane', 'critical', 'Remove telnet from the VTY transport input.'],
    ['NET-2.1', 'SNMPv3 only', 'high', 'Remove SNMP v1/v2c communities and configure SNMPv3 users.'],
    ['NET-3.3', 'Login banner configured', 'low', 'Configure the approved login banner.'],
    ['NET-4.1', 'Central AAA enabled', 'medium', 'Point device administration to the central AAA service.'],
  ],
};

const OS_LIFECYCLE: Record<string, { vendor: string; product: string; version: string; eol: number | null; eos: number | null; ext: number | null; verified: boolean; source: string | null }> = {
  [WIN22]: { vendor: 'Microsoft', product: 'Windows Server', version: '2022', eol: 1800, eos: 1000, ext: 1800, verified: true, source: 'Vendor lifecycle page (demo)' },
  [WIN12]: { vendor: 'Microsoft', product: 'Windows Server', version: '2012 R2', eol: -300, eos: -400, ext: 250, verified: true, source: 'Vendor lifecycle page (demo)' },
  [RHEL9]: { vendor: 'Red Hat', product: 'Red Hat Enterprise Linux', version: '9', eol: 2200, eos: 1500, ext: 2200, verified: true, source: 'Vendor lifecycle page (demo)' },
  [RHEL7]: { vendor: 'Red Hat', product: 'Red Hat Enterprise Linux', version: '7', eol: 300, eos: -200, ext: 300, verified: true, source: 'Vendor lifecycle page (demo)' },
  [UBU22]: { vendor: 'Canonical', product: 'Ubuntu', version: '22.04 LTS', eol: 1200, eos: 120, ext: 1200, verified: true, source: 'Vendor release notes (demo)' },
  [IOS]: { vendor: 'Cisco', product: 'IOS XE', version: '17.9', eol: 400, eos: 60, ext: null, verified: true, source: 'Vendor bulletin (demo)' },
  [APPLIANCE]: { vendor: 'Unconfirmed vendor', product: 'Vendor Appliance OS', version: '4', eol: null, eos: null, ext: null, verified: false, source: null },
};

const COMPONENTS: Record<ObjectType, { vendor: string; product: string; version: string; eol: number | null; eos: number | null; ext: number | null; verified: boolean; source: string | null }> = {
  windows: { vendor: 'Microsoft', product: '.NET Runtime', version: '6.0', eol: 25, eos: 25, ext: null, verified: true, source: 'Vendor support policy (demo)' },
  linux: { vendor: 'Apache', product: 'Tomcat', version: '9.0', eol: 700, eos: 700, ext: null, verified: true, source: 'Project release page (demo)' },
  database: { vendor: 'PostgreSQL Global Development Group', product: 'PostgreSQL', version: '13', eol: 150, eos: 150, ext: null, verified: false, source: 'Internal record, not yet verified (demo)' },
  network: { vendor: 'Cisco', product: 'AnyConnect Module', version: '4.10', eol: null, eos: null, ext: null, verified: false, source: null },
};

const OUTAGE_FRACTION: Record<Exclude<Profile, 'nodata'>, number> = {
  healthy: 0.0001,
  at_risk: 0.0008,
  breach: 0.006,
  down: 0.0005,
  gap: 0.0001,
};

export async function isSeeded(db: Db): Promise<boolean> {
  const rows = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM users');
  return rows[0].n > 0;
}

export async function seed(db: Db, now: Date = new Date()): Promise<void> {
  const rand = mulberry32(20260401);
  const nowMs = now.getTime();
  const ago = (days: number) => new Date(nowMs - days * DAY);
  const ahead = (days: number) => new Date(nowMs + days * DAY);
  const offset = (days: number | null) => (days === null ? null : new Date(nowMs + days * DAY));
  const pick = <T,>(items: readonly T[], i: number) => items[i % items.length];

  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const elapsedDays = Math.max(0.02, (nowMs - monthStart) / DAY);
  // Keeps roughly a third of the records inside the current month whenever seeding happens.
  const recent = (i: number) => (i % 3 === 0 ? new Date(monthStart + ((i % 9) / 10 + 0.05) * elapsedDays * DAY) : ago(5 + (i * 7) % 110));

  await db.tx(async (tx) => {
    await insertRows(tx, 'users', USERS.map(([id, name, email, title, role]) => ({ id, name, email, title, role })));
    await insertRows(tx, 'customers', CATALOG.map((c) => ({ id: c.id, name: c.name, code: c.code, description: c.desc, sla_target: c.target })));
    await insertRows(tx, 'customer_assignments', ASSIGNMENTS.map(([user_id, customer_id]) => ({ user_id, customer_id })));
    await insertRows(tx, 'risk_approvers', APPROVERS.map(([user_id, customer_id, kind]) => ({ user_id, customer_id, kind })));
    await insertRows(tx, 'reminder_settings', CATALOG.map((c) => ({ customer_id: c.id })));

    await insertRows(tx, 'integrations', [
      { id: 'servicemanager', name: 'OpenText ServiceManager', description: 'Simulated adapter for requests and incidents.', status: 'healthy', message: 'Simulated connection OK', last_success_at: ago(0.02), last_attempt_at: ago(0.02) },
      { id: 'jira', name: 'Atlassian Jira', description: 'Simulated adapter for projects and tasks.', status: 'healthy', message: 'Simulated connection OK', last_success_at: ago(0.04), last_attempt_at: ago(0.04) },
      { id: 'gitlab', name: 'GitLab', description: 'Simulated adapter for tasks, activity and dependency scanning.', status: 'degraded', message: 'Simulated: the last scheduled sync timed out. Run a refresh to retry.', last_success_at: ago(0.8), last_attempt_at: ago(0.1) },
      { id: 'zabbix', name: 'Zabbix', description: 'Simulated adapter for critical and warning alarms.', status: 'healthy', message: 'Simulated connection OK', last_success_at: ago(0.01), last_attempt_at: ago(0.01) },
    ]);

    const baselineRows = Object.entries(BASELINES).map(([platform, b]) => ({ id: b.id, name: b.name, version: b.version, platform }));
    await insertRows(tx, 'baselines', baselineRows);
    const controlRows = (Object.keys(CONTROLS) as ObjectType[]).flatMap((type) =>
      CONTROLS[type].map(([code, title, severity, remediation]) => ({
        id: `ctl-${code}`,
        baseline_id: BASELINES[type].id,
        code,
        title,
        description: `${title}. Part of ${BASELINES[type].name}.`,
        version: BASELINES[type].version,
        severity,
        remediation,
      })),
    );
    await insertRows(tx, 'controls', controlRows);

    interface Obj { id: string; name: string; customer_id: string; service_id: string; system_id: string; type: ObjectType; os: string; profile: Profile; owner: string }
    const allObjects: Obj[] = [];
    const serviceRows: Record<string, unknown>[] = [];
    const systemRows: Record<string, unknown>[] = [];
    const objectRows: Record<string, unknown>[] = [];

    for (const c of CATALOG) {
      for (const s of c.services) {
        const service_id = `svc-${c.id}-${s.key}`;
        serviceRows.push({ id: service_id, customer_id: c.id, name: s.name, description: s.desc, criticality: s.crit, owner: c.owner, sla_target: s.target, sla_weight: s.weight });
        for (const sys of s.systems) {
          const system_id = `sys-${c.id}-${s.key}-${sys.key}`;
          systemRows.push({ id: system_id, customer_id: c.id, service_id, name: sys.name, description: `${sys.name} for ${s.name}.`, owner: c.owner });
          for (const [name, type, os, profile = 'healthy'] of sys.objects) {
            const id = `obj-${name}`;
            objectRows.push({ id, customer_id: c.id, service_id, system_id, name, object_type: type, os, description: `${type === 'network' ? 'Network device' : type === 'database' ? 'Database server' : 'Server'} in ${sys.name}.`, owner: c.owner, sla_target: s.target, sla_weight: 1, sla_included: profile !== 'gap' });
            allObjects.push({ id, name, customer_id: c.id, service_id, system_id, type, os, profile, owner: c.owner });
          }
        }
      }
    }
    await insertRows(tx, 'services', serviceRows);
    await insertRows(tx, 'systems', systemRows);
    await insertRows(tx, 'objects', objectRows);

    // Availability: durations scale with the month so every SLA state holds at any seeding date.
    const outages: Record<string, unknown>[] = [];
    const maintenance: Record<string, unknown>[] = [];
    const coverage: Record<string, unknown>[] = [];
    for (const o of allObjects) {
      if (o.profile === 'nodata') continue;
      const base = { customer_id: o.customer_id, object_id: o.id };
      if (o.profile === 'gap') {
        // Monitoring stopped part-way through each recent period, so the object reports Unknown.
        coverage.push({ id: `cov-${o.name}-1`, ...base, started_at: ago(400), ended_at: new Date(monthStart - 40 * DAY) });
      } else {
        coverage.push({ id: `cov-${o.name}-1`, ...base, started_at: ago(400), ended_at: null });
      }
      const fraction = OUTAGE_FRACTION[o.profile];
      for (let back = 0; back < 12; back++) {
        const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1);
        const end = back === 0 ? nowMs : Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back + 1, 1);
        const span = end - start;
        const historicalJitter = back === 0 ? 1 : 0.6 + rand() * 0.6;
        const duration = span * fraction * historicalJitter;
        const a = start + span * 0.3;
        outages.push({ id: `out-${o.name}-${back}-a`, ...base, started_at: new Date(a), ended_at: new Date(a + duration * 0.7), description: 'Service unavailable, restored by the on-call engineer.' });
        // This second interval overlaps the first, to exercise outage merging.
        outages.push({ id: `out-${o.name}-${back}-b`, ...base, started_at: new Date(a + duration * 0.5), ended_at: new Date(a + duration), description: 'Follow-on failure recorded by a second monitoring trigger.' });
        maintenance.push({ id: `mnt-${o.name}-${back}`, ...base, started_at: new Date(start + span * 0.6), ended_at: new Date(start + span * 0.6 + span * 0.002), description: 'Planned patch window.' });
      }
      if (o.profile === 'down') {
        outages.push({ id: `out-${o.name}-open`, ...base, started_at: ago(0.03), ended_at: null, description: 'Device not responding. Outage is still open.' });
      }
    }
    await insertRows(tx, 'outages', outages);
    await insertRows(tx, 'maintenance_windows', maintenance);
    await insertRows(tx, 'monitoring_coverage', coverage);

    const requests: Record<string, unknown>[] = [];
    const projects: Record<string, unknown>[] = [];
    const tasks: Record<string, unknown>[] = [];
    const activities: Record<string, unknown>[] = [];
    const alarms: Record<string, unknown>[] = [];
    const vulns: Record<string, unknown>[] = [];
    const lifecycle: Record<string, unknown>[] = [];
    const results: { row: Record<string, unknown>; obj: Obj; control: string; result: ControlResult; severity: string }[] = [];
    const scans: Record<string, unknown>[] = [];

    const PRIORITIES = ['critical', 'high', 'medium', 'low'];

    for (const c of CATALOG) {
      const objs = allObjects.filter((o) => o.customer_id === c.id);
      const assignees = [c.customerUser, c.manager, 'u-alex', c.riskOwner, null];
      const at = (o: Obj) => ({ customer_id: c.id, service_id: o.service_id, system_id: o.system_id, object_id: o.id });

      for (let i = 0; i < 16; i++) {
        const o = pick(objs, i * 2 + 1);
        const [title, description] = pick(REQUEST_TITLES, i);
        const status = pick(['open', 'in_progress', 'pending_customer', 'open', 'resolved', 'closed'], i);
        const opened = recent(i);
        const done = status === 'resolved' || status === 'closed';
        const priority = pick(['medium', 'low', 'high', 'medium'], i);
        requests.push({ id: `REQ-${c.code}-${1001 + i}`, kind: 'request', ...at(o), title, description, status, priority, severity: priority, assignee_id: pick(assignees, i), opened_at: opened, updated_at: new Date(opened.getTime() + 0.5 * (nowMs - opened.getTime())), resolved_at: done ? new Date(opened.getTime() + 0.8 * (nowMs - opened.getTime())) : null, synced_at: ago(0.02) });
      }
      for (let i = 0; i < 10; i++) {
        const o = pick(objs, i * 3);
        const [title, description] = pick(INCIDENT_TITLES, i);
        const status = pick(['open', 'in_progress', 'open', 'resolved', 'in_progress'], i);
        const opened = recent(i + 1);
        const priority = pick(PRIORITIES, i);
        requests.push({ id: `INC-${c.code}-${2001 + i}`, kind: 'incident', ...at(o), title, description, status, priority, severity: priority, assignee_id: pick(assignees, i + 1), opened_at: opened, updated_at: new Date(opened.getTime() + 0.6 * (nowMs - opened.getTime())), resolved_at: status === 'resolved' ? new Date(opened.getTime() + 0.8 * (nowMs - opened.getTime())) : null, synced_at: ago(0.02) });
      }

      const projectDefs = [
        ['Operating system upgrade programme', 'Move remaining servers off unsupported operating systems.', 'in_progress', 'high', 45],
        ['Monitoring coverage improvement', 'Close monitoring gaps and tune alarm thresholds.', 'in_progress', 'medium', 70],
        ['Disaster recovery rehearsal', 'Plan and run the annual disaster recovery test.', 'planned', 'medium', 10],
        ['Network segmentation rollout', 'Segment management traffic from production networks.', 'done', 'high', 100],
      ] as const;
      projectDefs.forEach(([title, description, status, priority, progress], i) => {
        const o = pick(objs, i * 3);
        const id = `${c.code}-PRJ-${i + 1}`;
        projects.push({ id, customer_id: c.id, service_id: o.service_id, system_id: null, object_id: null, title, description, status, priority, progress, assignee_id: pick([c.manager, 'u-alex', c.customerUser], i), opened_at: ago(120 - i * 20), due_at: status === 'done' ? ago(7) : ahead(30 + i * 40), updated_at: ago(i + 1), synced_at: ago(0.04) });
        for (let t = 0; t < 5; t++) {
          const to = pick(objs, i + t * 2);
          const tStatus = status === 'done' ? 'done' : pick(['todo', 'in_progress', 'in_review', 'done', 'todo'], t);
          const opened = recent(i + t);
          tasks.push({ id: `${c.code}-${100 + i * 10 + t}`, source: 'jira', project_id: id, ...at(to), title: `${pick(['Assess', 'Plan', 'Implement', 'Validate', 'Document'], t)} ${title.toLowerCase()} on ${to.name}`, description: `Work item for "${title}" covering ${to.name}.`, status: tStatus, priority: pick(PRIORITIES, t + 1), assignee_id: pick(assignees, t + i), opened_at: opened, updated_at: new Date(opened.getTime() + 0.5 * (nowMs - opened.getTime())), due_at: ahead(5 + t * 9 - 10), synced_at: ago(0.04) });
        }
      });

      for (let i = 0; i < 8; i++) {
        const o = pick(objs, i * 2);
        const opened = recent(i);
        tasks.push({ id: `GL-${c.code}-${300 + i}`, source: 'gitlab', project_id: null, ...at(o), title: `${pick(['Automate hardening role', 'Fix deployment pipeline', 'Update Ansible inventory', 'Add alert rule as code'], i)} for ${o.name}`, description: 'Infrastructure-as-code work item tracked in GitLab.', status: pick(['opened', 'in_progress', 'closed'], i), priority: pick(['medium', 'high', 'low'], i), assignee_id: pick(assignees, i), opened_at: opened, updated_at: new Date(opened.getTime() + 0.5 * (nowMs - opened.getTime())), due_at: null, synced_at: ago(0.8) });
        activities.push({ id: `GLA-${c.code}-${500 + i}`, activity_type: pick(['merge_request', 'pipeline', 'commit'], i), ...at(o), title: `${pick(['Merged configuration change', 'Pipeline run', 'Commit to infrastructure repo'], i)} for ${o.name}`, description: 'Activity recorded by the simulated GitLab adapter.', status: pick(['merged', 'failed', 'success', 'merged', 'success'], i), assignee_id: pick(assignees, i + 2), opened_at: opened, updated_at: opened, synced_at: ago(0.8) });
      }

      for (let i = 0; i < 12; i++) {
        const stressed = objs.filter((o) => o.profile === 'breach' || o.profile === 'down' || o.profile === 'at_risk');
        const o = i < 3 && stressed.length ? pick(stressed, i) : pick(objs, i * 2 + 1);
        const [title, description] = pick(ALARM_TITLES, i);
        const severity = i % 3 === 0 ? 'critical' : 'warning';
        const status = i < 8 ? (i % 4 === 3 ? 'acknowledged' : 'active') : 'resolved';
        const opened = recent(i);
        alarms.push({ id: `ZBX-${c.code}-${7000 + i}`, ...at(o), title, description, severity, status, priority: severity === 'critical' ? 'high' : 'medium', assignee_id: pick(assignees, i), opened_at: opened, updated_at: opened, resolved_at: status === 'resolved' ? new Date(opened.getTime() + 0.2 * (nowMs - opened.getTime())) : null, synced_at: ago(0.01) });
      }

      for (let i = 0; i < 12; i++) {
        const o = pick(objs, i * 2);
        const [title, description, severity, cvss] = pick(VULN_TITLES, i);
        const opened = recent(i);
        vulns.push({ id: `VUL-${c.code}-${400 + i}`, cve: `DEMO-2026-${10000 + i * 37}`, ...at(o), title, description, severity, cvss, status: pick(['open', 'open', 'mitigating', 'resolved'], i), priority: severity === 'critical' ? 'critical' : 'medium', assignee_id: pick(assignees, i), opened_at: opened, updated_at: opened, synced_at: ago(0.8) });
      }

      for (const o of objs) {
        const def = OS_LIFECYCLE[o.os];
        const record = (kind: string, d: typeof def, n: number) => ({
          id: `LC-${o.name}-${n}`, ...at(o), kind, product: d.product, version: d.version, vendor: d.vendor,
          eol_at: offset(d.eol), eos_at: offset(d.eos), extended_at: offset(d.ext), date_verified: d.verified,
          info_source: d.source, verified_at: d.verified ? ago(30 + n * 5) : null, owner: o.owner,
          plan: d.eos !== null && d.eos < 200 ? `Replace or upgrade ${d.product} ${d.version} in the next maintenance cycle.` : '', updated_at: ago(40),
        });
        lifecycle.push(record('os', def, 1));
        lifecycle.push(record('component', COMPONENTS[o.type], 2));

        // cd-loy-etl01 has no scans at all, so it demonstrates "No evaluated controls".
        const unscanned = o.profile === 'nodata';
        const objResults: ControlResult[] = [];
        for (const [code, title, severity] of CONTROLS[o.type]) {
          const r = rand();
          const result: ControlResult = unscanned ? 'not_checked' : r < 0.6 ? 'passed' : r < 0.76 ? 'failed' : r < 0.88 ? 'warning' : r < 0.95 ? 'not_applicable' : 'not_checked';
          objResults.push(result);
          const scanned = result !== 'not_checked';
          const actual = { passed: 'Compliant with the expected configuration.', failed: `Non-compliant: ${title.toLowerCase()} is not satisfied.`, warning: `Partially compliant: ${title.toLowerCase()} needs review.`, not_applicable: 'Not applicable to this platform role.', not_checked: 'The scanner could not evaluate this control.' }[result];
          results.push({
            obj: o, control: `ctl-${code}`, result, severity,
            row: { id: `CR-${o.name}-${code}`, ...at(o), control_id: `ctl-${code}`, result, actual_result: actual, evidence: scanned ? `Simulated scan output for ${code} on ${o.name}.` : 'No evidence collected.', scanned_at: scanned ? ago(2 + (rand() * 6)) : null },
          });
        }
        const latest = tally(objResults);
        for (let back = 5; back >= 0; back--) {
          const hist = { ...emptyTally(), ...latest };
          // Earlier scans had fewer passes; the final scan equals the current results exactly.
          const moved = Math.min(hist.passed, Math.round(back * 0.4));
          hist.passed -= moved;
          hist.failed += moved;
          scans.push({ id: `SCAN-${o.name}-${back}`, ...at(o), scanned_at: ago(back * 30 + 3), ...hist });
        }
      }
    }

    await insertRows(tx, 'requests_incidents', requests);
    await insertRows(tx, 'projects', projects);
    await insertRows(tx, 'tasks', tasks);
    await insertRows(tx, 'gitlab_activities', activities);
    await insertRows(tx, 'alarms', alarms);
    await insertRows(tx, 'vulnerabilities', vulns);
    await insertRows(tx, 'lifecycle_records', lifecycle);
    await insertRows(tx, 'control_results', results.map((r) => r.row));
    await insertRows(tx, 'hardening_scans', scans);

    const licenseDefs: [string, string, string, string, string, number, number | null, number | null, number | null, number][] = [
      ['Microsoft 365', 'E3', 'Per user subscription', 'user', 'All employees', 500, 470, 455, 100, 200],
      ['Windows Server', 'Datacenter', 'Per core', 'core', 'Production data centre', 256, 256, 288, 100, 75],
      ['SQL Server', 'Enterprise', 'Per core', 'core', 'Production databases', 96, 88, 80, 100, 340],
      ['Endpoint Protection', 'Advanced', 'Per device', 'device', 'Managed endpoints', 800, 760, null, null, 21],
      ['Zabbix Support', 'Enterprise', 'Per instance', 'instance', 'Monitoring platform', 4, 4, 4, 100, 150],
      ['Backup Suite', 'Standard', 'Per instance', 'instance', 'Protected workloads', 60, 52, 58, 70, 60],
      ['Remote Access Gateway', 'Plus', 'Per user subscription', 'user', 'Remote workforce', 150, null, null, null, 400],
    ];
    const licenses = CATALOG.flatMap((c, ci) =>
      licenseDefs.map(([product, edition, model, unit, scope, ent, assigned, cons, complete, renewal], i) => ({
        id: `LIC-${c.code}-${i + 1}`, customer_id: c.id, product, edition, model, unit, contractual_scope: scope,
        entitlement: ent + ci * (unit === 'instance' ? 0 : 8),
        assigned: assigned === null ? null : assigned + ci * (unit === 'instance' ? 0 : 8),
        consumption: cons === null ? null : cons + ci * (unit === 'instance' ? 0 : 8),
        measured_at: cons === null ? null : ago(1 + i), completeness: complete,
        valid_from: ago(365 - renewal), renewal_at: ahead(renewal), owner: c.owner,
        contract_ref: `CTR-${c.code}-${2026}${String(i + 1).padStart(3, '0')}`, updated_at: ago(20),
      })),
    );
    await insertRows(tx, 'licenses', licenses);

    // Risk acceptances. Each customer gets every state, linked to real Failed or Warning results.
    const statusPlan: { suffix: string; status: string; expiry: number; review: number; decidedDaysAgo: number | null; reason?: string; reviewRequired?: boolean; selfApproved?: boolean }[] = [
      { suffix: 'DRF', status: 'draft', expiry: 180, review: 90, decidedDaysAgo: null },
      { suffix: 'PND', status: 'pending', expiry: 180, review: 90, decidedDaysAgo: null },
      { suffix: 'ACC', status: 'accepted', expiry: 200, review: 100, decidedDaysAgo: 60 },
      { suffix: 'EXP', status: 'accepted', expiry: 10, review: 5, decidedDaysAgo: 170 },
      { suffix: 'REJ', status: 'rejected', expiry: 90, review: 45, decidedDaysAgo: 30, reason: 'Compensating controls are not sufficient for this exposure.' },
      { suffix: 'OLD', status: 'expired', expiry: -15, review: -45, decidedDaysAgo: 200 },
      { suffix: 'RVK', status: 'revoked', expiry: 120, review: 60, decidedDaysAgo: 90, reason: 'The compensating firewall rule was removed, so the acceptance no longer holds.' },
      { suffix: 'RVW', status: 'accepted', expiry: 150, review: 75, decidedDaysAgo: 40, reviewRequired: true },
      { suffix: 'SLF', status: 'accepted', expiry: 90, review: 45, decidedDaysAgo: 20, selfApproved: true },
    ];

    const acceptances: Record<string, unknown>[] = [];
    const acceptanceObjects: Record<string, unknown>[] = [];
    const audit: Record<string, unknown>[] = [];
    const userById = new Map<string, (typeof USERS)[number]>(USERS.map((u) => [u[0], u]));
    let auditSeq = 0;
    const log = (actorId: string, customer_id: string, entity_id: string, action: string, at: Date, detail: Record<string, unknown> = {}) => {
      const u = userById.get(actorId)!;
      audit.push({ id: `seed-audit-${++auditSeq}`, at, actor_id: actorId, actor_name: u[1], actor_role: u[4], customer_id, entity: 'risk_acceptance', entity_id, action, detail: JSON.stringify(detail) });
    };

    for (const c of CATALOG) {
      const failing = results.filter((r) => r.obj.customer_id === c.id && (r.result === 'failed' || r.result === 'warning'));
      const usedControls = new Set<string>();
      const candidates = failing.filter((r) => {
        if (usedControls.has(r.control)) return false;
        usedControls.add(r.control);
        return true;
      });
      statusPlan.forEach((plan, i) => {
        const anchor = candidates[i % candidates.length];
        const controlRow = controlRows.find((x) => x.id === anchor.control)!;
        const id = `RA-${c.code}-${plan.suffix}`;
        const requester = plan.selfApproved ? c.riskOwner : c.customerUser;
        const decided = plan.decidedDaysAgo === null ? null : ago(plan.decidedDaysAgo);
        const created = decided ? new Date(decided.getTime() - 3 * DAY) : ago(4);
        const versionOutdated = plan.reviewRequired ? `${controlRow.version}-previous` : controlRow.version;
        acceptances.push({
          id, customer_id: c.id, control_id: anchor.control, baseline_id: controlRow.baseline_id, control_version: versionOutdated,
          title: `${controlRow.code}: ${controlRow.title}`, evidence: `Scan evidence for ${controlRow.code} on ${anchor.obj.name}.`,
          justification: 'The change needs a vendor-certified application release that is scheduled for a later upgrade cycle.',
          severity: anchor.severity, residual_risk: anchor.severity === 'critical' ? 'high' : 'medium',
          compensating_controls: 'Network segmentation, restricted administrator access and enhanced monitoring.',
          risk_owner_id: c.riskOwner, approver_id: c.riskOwner, requester_id: requester, status: plan.status,
          decision_at: decided, decision_by: decided ? c.riskOwner : null, decision_reason: plan.reason ?? null,
          self_approved: plan.selfApproved === true, expiry_at: ahead(plan.expiry), review_at: ahead(plan.review), renewed_from_id: null,
          review_required: plan.reviewRequired === true,
          review_reason: plan.reviewRequired ? `Control version changed from ${versionOutdated} to ${controlRow.version} after the decision.` : null,
          created_at: created, updated_at: decided ?? created,
        });
        acceptanceObjects.push({ acceptance_id: id, object_id: anchor.obj.id, approved_scope: true });

        log(requester, c.id, id, 'created', created, { status: 'draft' });
        if (plan.status !== 'draft') log(requester, c.id, id, 'submitted', new Date(created.getTime() + DAY), { from: 'draft', to: 'pending' });
        if (decided) {
          const firstDecision = plan.status === 'rejected' ? 'rejected' : 'approved';
          log(c.riskOwner, c.id, id, firstDecision, decided, { from: 'pending', to: plan.status === 'rejected' ? 'rejected' : 'accepted', reason: plan.status === 'rejected' ? plan.reason : undefined, self_approved: plan.selfApproved === true });
        }
        if (plan.status === 'revoked') log(c.riskOwner, c.id, id, 'revoked', ago(5), { from: 'accepted', to: 'revoked', reason: plan.reason });
        if (plan.status === 'expired') log(c.riskOwner, c.id, id, 'expired', ahead(plan.expiry), { from: 'accepted', to: 'expired' });
        if (plan.reviewRequired) log(c.riskOwner, c.id, id, 'review_required', ago(3), { reason: `Control version changed from ${versionOutdated} to ${controlRow.version}.` });
      });
    }
    await insertRows(tx, 'risk_acceptances', acceptances);
    await insertRows(tx, 'risk_acceptance_objects', acceptanceObjects);
    await insertRows(tx, 'audit_log', audit);
  });
}

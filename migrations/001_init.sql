-- ProIT core schema. All timestamps are timestamptz and all reporting uses UTC.

CREATE TABLE users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  title text NOT NULL,
  role text NOT NULL CHECK (role IN ('customer', 'manager', 'admin'))
);

CREATE TABLE customers (
  id text PRIMARY KEY,
  name text NOT NULL,
  code text NOT NULL,
  description text NOT NULL,
  sla_target double precision NOT NULL,
  exclude_planned_maintenance boolean NOT NULL DEFAULT true
);

CREATE TABLE customer_assignments (
  user_id text NOT NULL REFERENCES users(id),
  customer_id text NOT NULL REFERENCES customers(id),
  PRIMARY KEY (user_id, customer_id)
);

-- Risk approval authority is deliberately independent of users.role.
CREATE TABLE risk_approvers (
  user_id text NOT NULL REFERENCES users(id),
  customer_id text NOT NULL REFERENCES customers(id),
  kind text NOT NULL CHECK (kind IN ('owner', 'delegate')),
  PRIMARY KEY (user_id, customer_id)
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  portfolio_mode text NOT NULL DEFAULT 'own' CHECK (portfolio_mode IN ('own', 'all')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE user_preferences (
  user_id text PRIMARY KEY REFERENCES users(id),
  prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE saved_views (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  view text NOT NULL,
  name text NOT NULL,
  params jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE services (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id),
  name text NOT NULL,
  description text NOT NULL,
  criticality text NOT NULL CHECK (criticality IN ('critical', 'high', 'medium', 'low')),
  owner text NOT NULL,
  sla_target double precision NOT NULL,
  sla_weight double precision NOT NULL DEFAULT 1,
  sla_included boolean NOT NULL DEFAULT true
);

CREATE TABLE systems (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id),
  service_id text NOT NULL REFERENCES services(id),
  name text NOT NULL,
  description text NOT NULL,
  owner text NOT NULL
);

CREATE TABLE objects (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id),
  service_id text NOT NULL REFERENCES services(id),
  system_id text NOT NULL REFERENCES systems(id),
  name text NOT NULL,
  object_type text NOT NULL CHECK (object_type IN ('windows', 'linux', 'database', 'network')),
  os text NOT NULL,
  description text NOT NULL,
  owner text NOT NULL,
  sla_target double precision NOT NULL,
  sla_weight double precision NOT NULL DEFAULT 1,
  sla_included boolean NOT NULL DEFAULT true
);

CREATE TABLE integrations (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  status text NOT NULL CHECK (status IN ('healthy', 'degraded', 'down')),
  message text NOT NULL,
  last_success_at timestamptz,
  last_attempt_at timestamptz
);

CREATE TABLE integration_runs (
  id text PRIMARY KEY,
  integration_id text NOT NULL REFERENCES integrations(id),
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  status text NOT NULL,
  records integer NOT NULL
);

CREATE TABLE requests_incidents (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('request', 'incident')),
  customer_id text NOT NULL REFERENCES customers(id),
  service_id text REFERENCES services(id),
  system_id text REFERENCES systems(id),
  object_id text REFERENCES objects(id),
  title text NOT NULL,
  description text NOT NULL,
  status text NOT NULL,
  priority text NOT NULL,
  severity text NOT NULL,
  assignee_id text REFERENCES users(id),
  opened_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  resolved_at timestamptz,
  source text NOT NULL DEFAULT 'servicemanager',
  synced_at timestamptz
);

CREATE TABLE projects (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id),
  service_id text REFERENCES services(id),
  system_id text REFERENCES systems(id),
  object_id text REFERENCES objects(id),
  title text NOT NULL,
  description text NOT NULL,
  status text NOT NULL,
  priority text NOT NULL,
  progress integer NOT NULL,
  assignee_id text REFERENCES users(id),
  opened_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  source text NOT NULL DEFAULT 'jira',
  synced_at timestamptz
);

CREATE TABLE tasks (
  id text PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('jira', 'gitlab')),
  project_id text REFERENCES projects(id),
  customer_id text NOT NULL REFERENCES customers(id),
  service_id text REFERENCES services(id),
  system_id text REFERENCES systems(id),
  object_id text REFERENCES objects(id),
  title text NOT NULL,
  description text NOT NULL,
  status text NOT NULL,
  priority text NOT NULL,
  assignee_id text REFERENCES users(id),
  opened_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  due_at timestamptz,
  synced_at timestamptz
);

CREATE TABLE gitlab_activities (
  id text PRIMARY KEY,
  activity_type text NOT NULL,
  customer_id text NOT NULL REFERENCES customers(id),
  service_id text REFERENCES services(id),
  system_id text REFERENCES systems(id),
  object_id text REFERENCES objects(id),
  title text NOT NULL,
  description text NOT NULL,
  status text NOT NULL,
  priority text NOT NULL DEFAULT 'medium',
  assignee_id text REFERENCES users(id),
  opened_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  source text NOT NULL DEFAULT 'gitlab',
  synced_at timestamptz
);

CREATE TABLE alarms (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id),
  service_id text NOT NULL REFERENCES services(id),
  system_id text NOT NULL REFERENCES systems(id),
  object_id text NOT NULL REFERENCES objects(id),
  title text NOT NULL,
  description text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('critical', 'warning')),
  status text NOT NULL CHECK (status IN ('active', 'acknowledged', 'resolved')),
  priority text NOT NULL,
  assignee_id text REFERENCES users(id),
  opened_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  resolved_at timestamptz,
  source text NOT NULL DEFAULT 'zabbix',
  synced_at timestamptz
);

CREATE TABLE vulnerabilities (
  id text PRIMARY KEY,
  cve text NOT NULL,
  customer_id text NOT NULL REFERENCES customers(id),
  service_id text NOT NULL REFERENCES services(id),
  system_id text NOT NULL REFERENCES systems(id),
  object_id text NOT NULL REFERENCES objects(id),
  title text NOT NULL,
  description text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  cvss double precision NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'mitigating', 'resolved')),
  priority text NOT NULL,
  assignee_id text REFERENCES users(id),
  opened_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  source text NOT NULL DEFAULT 'gitlab',
  synced_at timestamptz
);

CREATE TABLE baselines (
  id text PRIMARY KEY,
  name text NOT NULL,
  version text NOT NULL,
  platform text NOT NULL
);

CREATE TABLE controls (
  id text PRIMARY KEY,
  baseline_id text NOT NULL REFERENCES baselines(id),
  code text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  version text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  remediation text NOT NULL
);

CREATE TABLE control_results (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id),
  service_id text NOT NULL REFERENCES services(id),
  system_id text NOT NULL REFERENCES systems(id),
  object_id text NOT NULL REFERENCES objects(id),
  control_id text NOT NULL REFERENCES controls(id),
  result text NOT NULL CHECK (result IN ('passed', 'failed', 'warning', 'not_applicable', 'not_checked')),
  actual_result text NOT NULL,
  evidence text NOT NULL,
  scanned_at timestamptz,
  UNIQUE (object_id, control_id)
);

CREATE TABLE hardening_scans (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id),
  service_id text NOT NULL REFERENCES services(id),
  system_id text NOT NULL REFERENCES systems(id),
  object_id text NOT NULL REFERENCES objects(id),
  scanned_at timestamptz NOT NULL,
  passed integer NOT NULL,
  failed integer NOT NULL,
  warning integer NOT NULL,
  not_applicable integer NOT NULL,
  not_checked integer NOT NULL
);

CREATE TABLE risk_acceptances (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id),
  control_id text NOT NULL REFERENCES controls(id),
  baseline_id text NOT NULL REFERENCES baselines(id),
  control_version text NOT NULL,
  title text NOT NULL,
  evidence text NOT NULL,
  justification text NOT NULL,
  severity text NOT NULL,
  residual_risk text NOT NULL,
  compensating_controls text NOT NULL,
  risk_owner_id text NOT NULL REFERENCES users(id),
  approver_id text NOT NULL REFERENCES users(id),
  requester_id text NOT NULL REFERENCES users(id),
  status text NOT NULL CHECK (status IN ('draft', 'pending', 'accepted', 'rejected', 'expired', 'revoked')),
  decision_at timestamptz,
  decision_by text REFERENCES users(id),
  decision_reason text,
  self_approved boolean NOT NULL DEFAULT false,
  expiry_at timestamptz NOT NULL,
  review_at timestamptz NOT NULL,
  renewed_from_id text REFERENCES risk_acceptances(id),
  review_required boolean NOT NULL DEFAULT false,
  review_reason text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

-- `approved_scope` marks objects covered by the decision. Objects added after a
-- decision are stored with approved_scope = false, so they are never covered silently.
CREATE TABLE risk_acceptance_objects (
  acceptance_id text NOT NULL REFERENCES risk_acceptances(id),
  object_id text NOT NULL REFERENCES objects(id),
  approved_scope boolean NOT NULL DEFAULT true,
  PRIMARY KEY (acceptance_id, object_id)
);

CREATE TABLE outages (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id),
  object_id text NOT NULL REFERENCES objects(id),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  description text NOT NULL
);

CREATE TABLE maintenance_windows (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id),
  object_id text NOT NULL REFERENCES objects(id),
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  description text NOT NULL
);

-- A NULL ended_at means monitoring is still running.
CREATE TABLE monitoring_coverage (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id),
  object_id text NOT NULL REFERENCES objects(id),
  started_at timestamptz NOT NULL,
  ended_at timestamptz
);

CREATE TABLE lifecycle_records (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id),
  service_id text NOT NULL REFERENCES services(id),
  system_id text NOT NULL REFERENCES systems(id),
  object_id text NOT NULL REFERENCES objects(id),
  kind text NOT NULL CHECK (kind IN ('os', 'component')),
  product text NOT NULL,
  version text NOT NULL,
  vendor text NOT NULL,
  eol_at timestamptz,
  eos_at timestamptz,
  extended_at timestamptz,
  date_verified boolean NOT NULL DEFAULT false,
  info_source text,
  verified_at timestamptz,
  owner text NOT NULL,
  plan text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL
);

CREATE TABLE licenses (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id),
  product text NOT NULL,
  edition text NOT NULL,
  model text NOT NULL,
  unit text NOT NULL CHECK (unit IN ('user', 'device', 'core', 'instance')),
  contractual_scope text NOT NULL,
  entitlement integer NOT NULL CHECK (entitlement >= 0),
  assigned integer CHECK (assigned >= 0),
  consumption integer CHECK (consumption >= 0),
  measured_at timestamptz,
  completeness integer CHECK (completeness BETWEEN 0 AND 100),
  valid_from timestamptz NOT NULL,
  renewal_at timestamptz NOT NULL,
  owner text NOT NULL,
  contract_ref text NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE reminder_settings (
  customer_id text PRIMARY KEY REFERENCES customers(id),
  risk_days jsonb NOT NULL DEFAULT '[30, 14, 7]'::jsonb,
  lifecycle_days jsonb NOT NULL DEFAULT '[180, 90, 30]'::jsonb,
  license_days jsonb NOT NULL DEFAULT '[90, 30]'::jsonb
);

CREATE TABLE notifications (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  customer_id text NOT NULL REFERENCES customers(id),
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  link text NOT NULL,
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  UNIQUE (user_id, dedupe_key)
);

CREATE TABLE audit_log (
  id text PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  seq bigserial NOT NULL,
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  actor_role text NOT NULL,
  customer_id text NOT NULL REFERENCES customers(id),
  entity text NOT NULL,
  entity_id text NOT NULL,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_change
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

CREATE INDEX idx_audit_entity ON audit_log (entity, entity_id);
CREATE INDEX idx_notifications_user ON notifications (user_id, created_at DESC);
CREATE INDEX idx_results_customer ON control_results (customer_id);
CREATE INDEX idx_outages_object ON outages (object_id);

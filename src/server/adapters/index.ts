import type { Db } from '../db/db';

export interface SourceRecord {
  id: string;
  customer_id: string;
  source_type: string;
  fields: Record<string, unknown>;
}

interface AdapterBase {
  readonly id: string;
  /** Reads the records this source would return on a sync. */
  fetchRecords(db: Db): Promise<SourceRecord[]>;
  getRecord(db: Db, id: string): Promise<SourceRecord | null>;
  /** Stores the time a fetched record was last synchronized. */
  markSynced(db: Db, ids: string[], at: Date): Promise<void>;
}

// Each source has its own interface so a real client can replace one adapter alone.
export interface ServiceManagerAdapter extends AdapterBase { readonly id: 'servicemanager' }
export interface JiraAdapter extends AdapterBase { readonly id: 'jira' }
export interface GitLabAdapter extends AdapterBase { readonly id: 'gitlab' }
export interface ZabbixAdapter extends AdapterBase { readonly id: 'zabbix' }

export type IntegrationAdapter = ServiceManagerAdapter | JiraAdapter | GitLabAdapter | ZabbixAdapter;

interface SourceTable { table: string; type: string; where?: string }

function simulated<I extends IntegrationAdapter['id']>(id: I, tables: SourceTable[]) {
  const clause = (t: SourceTable, extra: string) => `SELECT * FROM ${t.table} WHERE ${t.where ? `${t.where} AND ` : ''}${extra}`;
  const toRecord = (t: SourceTable, row: Record<string, unknown>): SourceRecord => ({ id: String(row.id), customer_id: String(row.customer_id), source_type: t.type, fields: row });
  return {
    id,
    async fetchRecords(db: Db) {
      const out: SourceRecord[] = [];
      for (const t of tables) out.push(...(await db.query(clause(t, 'true'))).map((row) => toRecord(t, row)));
      return out;
    },
    async getRecord(db: Db, recordId: string) {
      for (const t of tables) {
        const rows = await db.query(clause(t, 'id = $1'), [recordId]);
        if (rows[0]) return toRecord(t, rows[0]);
      }
      return null;
    },
    async markSynced(db: Db, ids: string[], at: Date) {
      for (const t of tables) await db.query(`UPDATE ${t.table} SET synced_at = $1 WHERE id = ANY($2::text[])`, [at, ids]);
    },
  };
}

export const adapters: Record<string, IntegrationAdapter> = {
  servicemanager: simulated('servicemanager', [{ table: 'requests_incidents', type: 'Request or incident' }]) as ServiceManagerAdapter,
  jira: simulated('jira', [{ table: 'projects', type: 'Project' }, { table: 'tasks', type: 'Issue', where: `source = 'jira'` }]) as JiraAdapter,
  gitlab: simulated('gitlab', [
    { table: 'tasks', type: 'Issue', where: `source = 'gitlab'` },
    { table: 'gitlab_activities', type: 'Activity' },
    { table: 'vulnerabilities', type: 'Dependency scan finding' },
  ]) as GitLabAdapter,
  zabbix: simulated('zabbix', [{ table: 'alarms', type: 'Trigger event' }]) as ZabbixAdapter,
};

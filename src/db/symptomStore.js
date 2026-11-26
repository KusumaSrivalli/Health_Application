import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DB_PATH = fileURLToPath(new URL('../../data/healthtrack.db', import.meta.url));
export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 500;
const SCHEMA_VERSION = 1;

/**
 * SQLite-backed repository for patient symptom logs.
 */
export class SymptomStore {
  /**
   * @param {string} [dbPath] File path or ':memory:' for in-memory storage.
   */
  constructor(dbPath = DEFAULT_DB_PATH) {
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }

    this.db = new DatabaseSync(dbPath);
    if (dbPath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    }
    this.#initializeSchema();
  }

  #initializeSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS symptom_logs (
        id TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL,
        symptom_description TEXT NOT NULL,
        severity INTEGER NOT NULL CHECK (severity >= 1 AND severity <= 10),
        timestamp TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_symptom_logs_patient_time
        ON symptom_logs (patient_id, timestamp);

      PRAGMA user_version = ${SCHEMA_VERSION};
    `);

    this.#insertStmt = this.db.prepare(`
      INSERT INTO symptom_logs (id, patient_id, symptom_description, severity, timestamp, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const baseSelect = `
      SELECT
        id,
        patient_id AS patientId,
        symptom_description AS symptomDescription,
        severity,
        timestamp,
        created_at AS createdAt
      FROM symptom_logs
      WHERE patient_id = ?
    `;

    this.#selectAscStmt = this.db.prepare(`
      ${baseSelect}
      ORDER BY timestamp ASC, created_at ASC
      LIMIT ? OFFSET ?
    `);

    this.#selectDescStmt = this.db.prepare(`
      ${baseSelect}
      ORDER BY timestamp DESC, created_at DESC
      LIMIT ? OFFSET ?
    `);

    this.#listPatientsStmt = this.db.prepare(`
      SELECT
        patient_id AS patientId,
        COUNT(*) AS logCount,
        MAX(timestamp) AS latestTimestamp,
        ROUND(AVG(severity), 1) AS averageSeverity
      FROM symptom_logs
      GROUP BY patient_id
      ORDER BY latestTimestamp DESC
      LIMIT ? OFFSET ?
    `);

    this.#summaryStatsStmt = this.db.prepare(`
      SELECT
        COUNT(*) AS totalCount,
        ROUND(AVG(severity), 1) AS averageSeverity,
        MAX(severity) AS peakSeverity
      FROM symptom_logs
      WHERE patient_id = ?
    `);

    this.#latestTwoStmt = this.db.prepare(`
      SELECT severity, timestamp
      FROM symptom_logs
      WHERE patient_id = ?
      ORDER BY timestamp DESC, created_at DESC
      LIMIT 2
    `);

    this.#dailyAveragesStmt = this.db.prepare(`
      SELECT
        substr(timestamp, 1, 10) AS dayKey,
        ROUND(AVG(severity), 1) AS severity,
        COUNT(*) AS count,
        MAX(timestamp) AS timestamp
      FROM symptom_logs
      WHERE patient_id = ? AND timestamp >= ?
      GROUP BY substr(timestamp, 1, 10)
      ORDER BY dayKey ASC
    `);
  }

  #insertStmt;
  #selectAscStmt;
  #selectDescStmt;
  #listPatientsStmt;
  #summaryStatsStmt;
  #latestTwoStmt;
  #dailyAveragesStmt;

  /**
   * Persists a validated symptom log entry.
   * @param {{ patientId: string, symptomDescription: string, severity: number, timestamp: string }} entry
   * @returns {{ id: string, patientId: string, symptomDescription: string, severity: number, timestamp: string, createdAt: string }}
   */
  createLog({ patientId, symptomDescription, severity, timestamp }) {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    this.#insertStmt.run(id, patientId, symptomDescription, severity, timestamp, createdAt);

    return {
      id,
      patientId,
      symptomDescription,
      severity,
      timestamp,
      createdAt
    };
  }

  /**
   * Retrieves symptom logs for a given patient sorted by timestamp with pagination.
   * @param {string} patientId
   * @param {{ sort?: 'asc' | 'desc', limit?: number, offset?: number }} [options]
   * @returns {Array<{ id: string, patientId: string, symptomDescription: string, severity: number, timestamp: string, createdAt: string }>}
   */
  getLogsByPatient(patientId, { sort = 'asc', limit = DEFAULT_LIMIT, offset = 0 } = {}) {
    const safeLimit = Math.min(Math.max(1, Number(limit) || DEFAULT_LIMIT), MAX_LIMIT);
    const safeOffset = Math.max(0, Number(offset) || 0);
    const stmt = sort === 'desc' ? this.#selectDescStmt : this.#selectAscStmt;
    return stmt.all(patientId, safeLimit, safeOffset).map((row) => ({ ...row }));
  }

  /**
   * Computes all-time summary metrics and 30-day daily averages directly in SQL.
   * @param {string} patientId
   * @returns {{
   *   patientId: string,
   *   totalCount: number,
   *   averageSeverity: number | null,
   *   peakSeverity: number | null,
   *   recentDelta: number | null,
   *   dailyAverages30d: Array<{ dayKey: string, severity: number, count: number, timestamp: string }>
   * }}
   */
  getPatientSummary(patientId) {
    const stats = this.#summaryStatsStmt.get(patientId);
    const latestTwo = this.#latestTwoStmt.all(patientId);
    const cutoffIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const dailyAverages30d = this.#dailyAveragesStmt.all(patientId, cutoffIso).map((r) => ({ ...r }));

    let recentDelta = null;
    if (latestTwo.length >= 2) {
      recentDelta = latestTwo[0].severity - latestTwo[1].severity;
    }

    return {
      patientId,
      totalCount: stats?.totalCount || 0,
      averageSeverity: stats?.averageSeverity ?? null,
      peakSeverity: stats?.peakSeverity ?? null,
      recentDelta,
      dailyAverages30d
    };
  }

  /**
   * Lists distinct patients with summary metrics.
   * @param {{ limit?: number, offset?: number }} [options]
   * @returns {Array<{ patientId: string, logCount: number, latestTimestamp: string, averageSeverity: number }>}
   */
  listPatients({ limit = DEFAULT_LIMIT, offset = 0 } = {}) {
    const safeLimit = Math.min(Math.max(1, Number(limit) || DEFAULT_LIMIT), MAX_LIMIT);
    const safeOffset = Math.max(0, Number(offset) || 0);
    return this.#listPatientsStmt.all(safeLimit, safeOffset).map((row) => ({ ...row }));
  }

  /**
   * Closes the underlying SQLite database connection.
   */
  close() {
    this.db.close();
  }
}

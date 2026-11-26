import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'data', 'healthtrack.db');

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
    `);

    this.#insertStmt = this.db.prepare(`
      INSERT INTO symptom_logs (id, patient_id, symptom_description, severity, timestamp, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    this.#selectAscStmt = this.db.prepare(`
      SELECT
        id,
        patient_id AS patientId,
        symptom_description AS symptomDescription,
        severity,
        timestamp,
        created_at AS createdAt
      FROM symptom_logs
      WHERE patient_id = ?
      ORDER BY timestamp ASC, created_at ASC
    `);

    this.#selectDescStmt = this.db.prepare(`
      SELECT
        id,
        patient_id AS patientId,
        symptom_description AS symptomDescription,
        severity,
        timestamp,
        created_at AS createdAt
      FROM symptom_logs
      WHERE patient_id = ?
      ORDER BY timestamp DESC, created_at DESC
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
    `);
  }

  #insertStmt;
  #selectAscStmt;
  #selectDescStmt;
  #listPatientsStmt;

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
   * Retrieves all symptom logs for a given patient sorted by timestamp.
   * @param {string} patientId
   * @param {{ sort?: 'asc' | 'desc' }} [options]
   * @returns {Array<{ id: string, patientId: string, symptomDescription: string, severity: number, timestamp: string, createdAt: string }>}
   */
  getLogsByPatient(patientId, { sort = 'asc' } = {}) {
    const stmt = sort === 'desc' ? this.#selectDescStmt : this.#selectAscStmt;
    return stmt.all(patientId).map((row) => ({ ...row }));
  }

  /**
   * Lists distinct patients with summary metrics.
   * @returns {Array<{ patientId: string, logCount: number, latestTimestamp: string, averageSeverity: number }>}
   */
  listPatients() {
    return this.#listPatientsStmt.all().map((row) => ({ ...row }));
  }

  /**
   * Closes the underlying SQLite database connection.
   */
  close() {
    this.db.close();
  }
}

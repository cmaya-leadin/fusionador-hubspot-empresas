import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'fusionador.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    hubspot_account TEXT NOT NULL DEFAULT '',
    hubspot_token_enc TEXT NOT NULL DEFAULT '',
    project_type TEXT NOT NULL DEFAULT 'merge' CHECK(project_type IN ('merge', 'properties')),
    entity_type TEXT NOT NULL DEFAULT 'companies' CHECK(entity_type IN ('companies', 'contacts')),
    merge_criteria TEXT NOT NULL DEFAULT '{}',
    hs_object_type TEXT NOT NULL DEFAULT '',
    properties_import TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'INFO',
    message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS merge_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dry_run INTEGER NOT NULL DEFAULT 1,
    stats TEXT NOT NULL DEFAULT '{}',
    groups_count INTEGER NOT NULL DEFAULT 0,
    merges_planned INTEGER NOT NULL DEFAULT 0,
    results TEXT NOT NULL DEFAULT '[]',
    simulations TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migrations ligeras para instalaciones existentes (SQLite sin migrador).
function ensureColumn(table, column, sqlTypeAndDefault) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const has = cols.some((c) => c.name === column);
  if (has) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${sqlTypeAndDefault}`);
}

ensureColumn(
  'projects',
  'project_type',
  "TEXT NOT NULL DEFAULT 'merge' CHECK(project_type IN ('merge','properties'))",
);
ensureColumn('projects', 'hs_object_type', "TEXT NOT NULL DEFAULT ''");
ensureColumn('projects', 'properties_import', "TEXT NOT NULL DEFAULT '{}'");

const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get();
if (userCount.c === 0) {
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin';
  const hash = bcrypt.hashSync(adminPassword, 10);
  db.prepare(
    'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
  ).run('admin', hash, 'admin');
  console.log(
    `[db] Usuario admin creado (contraseña: ${adminPassword}). Cambia ADMIN_PASSWORD en .env.`,
  );
}

export { db, DB_PATH };

export function getUserById(id) {
  return db
    .prepare('SELECT id, username, role, created_at FROM users WHERE id = ?')
    .get(id);
}

export function getUserByUsername(username) {
  return db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(username);
}

export function listUsers() {
  return db
    .prepare(`
      SELECT u.id, u.username, u.role, u.created_at,
        (SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id) as project_count
      FROM users u
      ORDER BY u.username
    `)
    .all();
}

export function createUser(username, password, role = 'user') {
  const hash = bcrypt.hashSync(password, 10);
  const result = db
    .prepare(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
    )
    .run(username, hash, role);
  return getUserById(result.lastInsertRowid);
}

export function updateUserPassword(id, password) {
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
}

export function deleteUser(id) {
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

export function listProjectsForUser(userId, isAdmin) {
  if (isAdmin) {
    return db
      .prepare(`
        SELECT p.*, u.username as owner_username
        FROM projects p
        JOIN users u ON u.id = p.user_id
        ORDER BY p.updated_at DESC
      `)
      .all();
  }

  return db
    .prepare(`
      SELECT p.*, u.username as owner_username
      FROM projects p
      JOIN users u ON u.id = p.user_id
      WHERE p.user_id = ?
      ORDER BY p.updated_at DESC
    `)
    .all(userId);
}

export function getProjectById(id) {
  return db
    .prepare(`
      SELECT p.*, u.username as owner_username
      FROM projects p
      JOIN users u ON u.id = p.user_id
      WHERE p.id = ?
    `)
    .get(id);
}

export function createProject(data) {
  const result = db
    .prepare(`
      INSERT INTO projects (
        user_id,
        name,
        hubspot_account,
        hubspot_token_enc,
        project_type,
        entity_type,
        merge_criteria,
        hs_object_type,
        properties_import
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      data.userId,
      data.name,
      data.hubspotAccount || '',
      data.hubspotTokenEnc || '',
      data.projectType || 'merge',
      data.entityType || 'companies',
      typeof data.mergeCriteria === 'string'
        ? data.mergeCriteria
        : JSON.stringify(data.mergeCriteria || {}),
      data.hsObjectType || '',
      typeof data.propertiesImport === 'string'
        ? data.propertiesImport
        : JSON.stringify(data.propertiesImport || {}),
    );
  return getProjectById(result.lastInsertRowid);
}

export function   updateProject(id, data) {
  const fields = [];
  const values = [];

  if (data.name != null) {
    fields.push('name = ?');
    values.push(data.name);
  }
  if (data.hubspotAccount != null) {
    fields.push('hubspot_account = ?');
    values.push(data.hubspotAccount);
  }
  if (data.hubspotTokenEnc != null) {
    fields.push('hubspot_token_enc = ?');
    values.push(data.hubspotTokenEnc);
  }
  if (data.projectType != null) {
    fields.push('project_type = ?');
    values.push(data.projectType);
  }
  if (data.entityType != null) {
    fields.push('entity_type = ?');
    values.push(data.entityType);
  }
  if (data.mergeCriteria != null) {
    fields.push('merge_criteria = ?');
    values.push(
      typeof data.mergeCriteria === 'string'
        ? data.mergeCriteria
        : JSON.stringify(data.mergeCriteria),
    );
  }
  if (data.hsObjectType != null) {
    fields.push('hs_object_type = ?');
    values.push(data.hsObjectType);
  }
  if (data.propertiesImport != null) {
    fields.push('properties_import = ?');
    values.push(
      typeof data.propertiesImport === 'string'
        ? data.propertiesImport
        : JSON.stringify(data.propertiesImport),
    );
  }

  if (fields.length === 0) {
    return getProjectById(id);
  }

  fields.push("updated_at = datetime('now')");
  values.push(id);

  db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(
    ...values,
  );
  return getProjectById(id);
}

export function deleteProject(id) {
  db.prepare('DELETE FROM merge_runs WHERE project_id = ?').run(id);
  db.prepare('UPDATE logs SET project_id = NULL WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}

export function addLog({ userId, projectId, action, status, message }) {
  const result = db
    .prepare(`
      INSERT INTO logs (user_id, project_id, action, status, message)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(userId ?? null, projectId ?? null, action, status || 'INFO', message || '');
  return db.prepare('SELECT * FROM logs WHERE id = ?').get(result.lastInsertRowid);
}

export function listLogs({ limit = 100, projectId, userId } = {}) {
  let sql = `
    SELECT l.*, u.username, p.name as project_name
    FROM logs l
    LEFT JOIN users u ON u.id = l.user_id
    LEFT JOIN projects p ON p.id = l.project_id
    WHERE 1=1
  `;
  const params = [];

  if (projectId) {
    sql += ' AND l.project_id = ?';
    params.push(projectId);
  }
  if (userId) {
    sql += ' AND l.user_id = ?';
    params.push(userId);
  }

  sql += ' ORDER BY l.created_at DESC LIMIT ?';
  params.push(limit);

  return db.prepare(sql).all(...params);
}

export function saveMergeRun(data) {
  const result = db
    .prepare(`
      INSERT INTO merge_runs (project_id, user_id, dry_run, stats, groups_count, merges_planned, results, simulations)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      data.projectId,
      data.userId,
      data.dryRun ? 1 : 0,
      JSON.stringify(data.stats || {}),
      data.groupsCount || 0,
      data.mergesPlanned || 0,
      JSON.stringify(data.results || []),
      JSON.stringify(data.simulations || []),
    );
  return db.prepare('SELECT * FROM merge_runs WHERE id = ?').get(result.lastInsertRowid);
}

export function listMergeRuns(projectId, limit = 20) {
  return db
    .prepare(`
      SELECT mr.*, u.username
      FROM merge_runs mr
      JOIN users u ON u.id = mr.user_id
      WHERE mr.project_id = ?
      ORDER BY mr.created_at DESC
      LIMIT ?
    `)
    .all(projectId, limit);
}

export function getMergeRunById(id) {
  return db.prepare('SELECT * FROM merge_runs WHERE id = ?').get(id);
}

export function getLastApplyRun(projectId) {
  return db
    .prepare(`
      SELECT * FROM merge_runs
      WHERE project_id = ? AND dry_run = 0
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .get(projectId);
}

import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdirSync, existsSync } from "node:fs";

export interface CmdEntry {
  id: number;
  command: string;
  description: string;
  tags: string;
  cwd: string;
  use_count: number;
  last_used: number;
  created_at: number;
}

function dbPath(): string {
  // CM_DB_PATH override exists so tests/CI never touch the real ~/.cm/cm.db.
  const override = process.env.CM_DB_PATH?.trim();
  if (override) {
    const dir = dirname(override);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return override;
  }
  // Use os.homedir() so PowerShell and Git Bash resolve to the SAME file.
  // (Git Bash $HOME and Windows %USERPROFILE% can differ in format but
  // os.homedir() is canonical on Windows.)
  const dir = join(homedir(), ".cm");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "cm.db");
}

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;
  const db = new Database(dbPath(), { create: true });
  db.run(`CREATE TABLE IF NOT EXISTS commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    command TEXT UNIQUE NOT NULL,
    description TEXT DEFAULT '',
    tags TEXT DEFAULT '',
    cwd TEXT DEFAULT '',
    use_count INTEGER DEFAULT 0,
    last_used INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_commands_last_used ON commands(last_used)`);
  _db = db;
  return db;
}

export function addCommand(command: string, description: string, tags: string, cwd: string): { updated: boolean; id: number } {
  const db = getDb();
  const now = Date.now();
  const existing = db.query("SELECT id FROM commands WHERE command = ?").get(command) as { id: number } | null;
  if (existing) {
    db.run("UPDATE commands SET description = ?, tags = ?, cwd = ? WHERE id = ?", [description, tags, cwd, existing.id]);
    return { updated: true, id: existing.id };
  }
  const res = db.run(
    "INSERT INTO commands (command, description, tags, cwd, use_count, last_used, created_at) VALUES (?, ?, ?, ?, 0, 0, ?)",
    [command, description, tags, cwd, now]
  );
  return { updated: false, id: Number(res.lastInsertRowid) };
}

export function listCommands(): CmdEntry[] {
  return getDb().query("SELECT * FROM commands ORDER BY id ASC").all() as CmdEntry[];
}

export function removeCommand(idOrQuery: string): boolean {
  const db = getDb();
  if (/^\d+$/.test(idOrQuery)) {
    const res = db.run("DELETE FROM commands WHERE id = ?", [Number(idOrQuery)]);
    return res.changes > 0;
  }
  const res = db.run("DELETE FROM commands WHERE command = ?", [idOrQuery]);
  return res.changes > 0;
}

function escapeLike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function findCommandsBySubstring(query: string, limit = 5): CmdEntry[] {
  const db = getDb();
  const pattern = `%${escapeLike(query)}%`;
  return db.query("SELECT * FROM commands WHERE command LIKE ? ESCAPE '\\' ORDER BY id ASC LIMIT ?").all(pattern, limit) as CmdEntry[];
}

export function editCommand(id: number, patch: Partial<Pick<CmdEntry, "command" | "description" | "tags" | "cwd">>): boolean {
  const db = getDb();
  const fields: string[] = [];
  const vals: unknown[] = [];
  if (patch.command !== undefined) { fields.push("command = ?"); vals.push(patch.command); }
  if (patch.description !== undefined) { fields.push("description = ?"); vals.push(patch.description); }
  if (patch.tags !== undefined) { fields.push("tags = ?"); vals.push(patch.tags); }
  if (patch.cwd !== undefined) { fields.push("cwd = ?"); vals.push(patch.cwd); }
  if (fields.length === 0) return false;
  vals.push(id);
  try {
    const res = db.run(`UPDATE commands SET ${fields.join(", ")} WHERE id = ?`, vals as any[]);
    return res.changes > 0;
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (msg.includes("UNIQUE") || e?.code === "SQLITE_CONSTRAINT_UNIQUE") {
      throw new Error("Command already exists");
    }
    throw e;
  }
}

export function bumpUsage(id: number): void {
  getDb().run("UPDATE commands SET use_count = use_count + 1, last_used = ? WHERE id = ?", [Date.now(), id]);
}

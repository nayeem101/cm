import { test, expect, beforeAll, afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";

// E2E smoke tests. They run the real CLI in a subprocess against a TEMP
// database (CM_DB_PATH), so the developer's real ~/.cm/cm.db is never touched.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DB = join(tmpdir(), `cm-smoke-${process.pid}.db`);

function cm(...args: string[]) {
  return spawnSync("bun", ["src/index.ts", ...args], {
    cwd: ROOT,
    env: { ...process.env, CM_DB_PATH: DB },
    encoding: "utf8",
  });
}

beforeAll(() => {
  if (existsSync(DB)) unlinkSync(DB);
});

afterAll(() => {
  if (existsSync(DB)) unlinkSync(DB);
});

test("add without a command fails and stores nothing", () => {
  const r = cm("add", "-d", "smoke-no-cmd");
  expect(r.status).not.toBe(0);
  const list = cm("list", "--json");
  expect(list.stdout).not.toContain("smoke-no-cmd");
});

test("edit --command to an existing command fails friendly (no stack trace)", () => {
  expect(cm("add", "smoke-alpha-001", "-d", "a").status).toBe(0);
  expect(cm("add", "smoke-beta-002", "-d", "b").status).toBe(0);
  const list = JSON.parse(cm("list", "--json").stdout) as { id: number; command: string }[];
  const beta = list.find((e) => e.command === "smoke-beta-002")!;
  const r = cm("edit", String(beta.id), "--command", "smoke-alpha-001");
  expect(r.status).not.toBe(0);
  expect(r.stderr).toContain("Command already exists");
  expect(r.stderr).not.toContain("SQLITE_CONSTRAINT");
});

test("rm with a substring refuses and keeps rows; exact command and id delete", () => {
  const refuse = cm("rm", "smoke-alpha");
  expect(refuse.status).not.toBe(0);
  expect(refuse.stderr).toContain("No exact match");

  const before = cm("list", "--json").stdout;
  expect(before).toContain("smoke-alpha-001");
  expect(before).toContain("smoke-beta-002");

  expect(cm("rm", "smoke-alpha-001").stdout).toContain("Deleted.");
  const list = JSON.parse(cm("list", "--json").stdout) as { id: number; command: string }[];
  const beta = list.find((e) => e.command === "smoke-beta-002")!;
  expect(cm("rm", String(beta.id)).stdout).toContain("Deleted.");

  expect(cm("list", "--json").stdout).not.toContain("smoke-");
});

test("rm with LIKE wildcards deletes nothing", () => {
  expect(cm("add", "smoke-wild-003", "-d", "w").status).toBe(0);
  const r = cm("rm", "%");
  const after = cm("list", "--json").stdout;
  expect(after).toContain("smoke-wild-003");
  expect(cm("rm", "smoke-wild-003").stdout).toContain("Deleted.");
});

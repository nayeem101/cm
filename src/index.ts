#!/usr/bin/env bun
import { addCommand, listCommands, removeCommand, findCommandsBySubstring, editCommand, bumpUsage } from "./db";
import { runSearchTui } from "./search";
import { copyToClipboard } from "./clipboard";

const COMMAND_ALIASES: Record<string, string> = {
  s: "search",
  a: "add",
  l: "list",
  ls: "list",
  r: "rm",
  del: "rm",
  d: "rm",
  remove: "rm",
  delete: "rm",
  e: "edit",
  h: "help",
};

function help(): void {
  console.log(`cm — store CLI commands, fuzzy-search, copy on Enter

Usage:
  cm                                   interactive search (default)
  cm search|s [query]                  interactive search with initial query
  cm add|a "<command>" -d "<desc>" [-t tag1,tag2] [--cwd <path>|auto] [-g]
  cm list|ls|l [--json]                list all entries
  cm rm|r|del|d <id|exact-command>     delete entry (substring only lists matches)
  cm edit|e <id> [--command ...] [--desc ...] [--tags ...] [--cwd ...]
  cm help|h                            show this help

Keys in search: type to filter · ↑↓ navigate · Enter copy+quit · Esc/Ctrl+C/Ctrl+X quit
After Enter, paste with Ctrl+V.
DB: ~/.cm/cm.db (shared between PowerShell and Git Bash)`);
}

function getFlag(args: string[], ...names: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (names.includes(args[i])) {
      const next = args[i + 1];
      if (next === undefined || next.startsWith("-")) return undefined;
      return next;
    }
  }
  return undefined;
}
function hasFlag(args: string[], ...names: string[]): boolean {
  return args.some((a) => names.includes(a));
}

async function doSearch(initialQuery: string): Promise<void> {
  const entries = listCommands();
  if (entries.length === 0) {
    console.log('No commands stored yet. Add one:\n  cm add "docker ps -a" -d "list all containers"');
    return;
  }
  const picked = await runSearchTui(entries, initialQuery);
  if (!picked) {
    console.log("Cancelled.");
    return;
  }
  const ok = copyToClipboard(picked.command);
  if (ok) {
    bumpUsage(picked.id);
    console.log(`Copied: ${picked.command}`);
    console.log(`(paste with Ctrl+V)`);
  } else {
    console.log(`Copy FAILED (clipboard unavailable). Command:\n${picked.command}`);
  }
}

async function main(): Promise<void> {
  const [, , rawCmd, ...rest] = process.argv;
  const cmd = rawCmd ? COMMAND_ALIASES[rawCmd] ?? rawCmd : rawCmd;

  if (!cmd || cmd === "search") {
    const q = !cmd ? "" : rest.join(" ");
    await doSearch(q);
    return;
  }

  if (cmd === "--help" || cmd === "-h" || cmd === "help") {
    help();
    return;
  }

  if (cmd === "add") {
    const VALUE_FLAGS = new Set(["-d", "--desc", "--description", "-t", "--tags", "--cwd", "--command"]);
    const BOOL_FLAGS = new Set(["-g", "--global"]);
    let command: string | undefined;
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (VALUE_FLAGS.has(a)) {
        i++; // skip flag AND its value
        continue;
      }
      if (BOOL_FLAGS.has(a)) continue;
      if (a.startsWith("-")) continue;
      if (command === undefined) command = a;
    }
    const desc = getFlag(rest, "-d", "--desc", "--description") ?? "";
    const tags = getFlag(rest, "-t", "--tags") ?? "";
    const cwdFlag = getFlag(rest, "--cwd");
    const global = hasFlag(rest, "-g", "--global");
    if (!command) {
      console.error('Usage: cm add "<command>" -d "<what it does>" [-t tags] [--cwd <path>] [-g]');
      process.exit(1);
    }
    const cwd = global ? "" : cwdFlag === "auto" || cwdFlag === undefined ? process.cwd() : cwdFlag;
    const { updated, id } = addCommand(command, desc, tags, cwd);
    console.log(updated ? `Updated #${id}: ${command}` : `Added #${id}: ${command}`);
    return;
  }

  if (cmd === "list") {
    const entries = listCommands();
    if (hasFlag(rest, "--json")) {
      console.log(JSON.stringify(entries, null, 2));
      return;
    }
    if (entries.length === 0) {
      console.log("No commands stored yet.");
      return;
    }
    for (const e of entries) {
      console.log(`#${e.id}  ${e.command}`);
      if (e.description) console.log(`     ${e.description}`);
      const meta = [`uses:${e.use_count}`, e.tags ? `tags:${e.tags}` : "", e.cwd ? `cwd:${e.cwd}` : ""].filter(Boolean).join("  ");
      if (meta) console.log(`     ${meta}`);
    }
    return;
  }

  if (cmd === "rm") {
    const target = rest[0];
    if (!target) {
      console.error("Usage: cm rm <id|exact-command>");
      process.exit(1);
    }
    if (removeCommand(target)) {
      console.log("Deleted.");
      return;
    }
    // Non-destructive fallback: never delete on substring match.
    // Only numeric id or exact command match deletes (handled above).
    if (!/^\d+$/.test(target)) {
      const matches = findCommandsBySubstring(target, 5);
      if (matches.length > 0) {
        console.error("No exact match. Use the numeric id (see cm list) to delete.");
        for (const m of matches) console.error(`#${m.id}  ${m.command}`);
        process.exit(1);
      }
    }
    console.log("Not found.");
    return;
  }

  if (cmd === "edit") {
    const id = Number(rest[0]);
    if (!id) {
      console.error("Usage: cm edit <id> [--command ...] [--desc ...] [--tags ...] [--cwd ...]");
      process.exit(1);
    }
    const patch: Record<string, string> = {};
    const nc = getFlag(rest, "--command");
    const nd = getFlag(rest, "--desc", "--description");
    const nt = getFlag(rest, "--tags", "-t");
    const nw = getFlag(rest, "--cwd");
    if (nc !== undefined) patch.command = nc;
    if (nd !== undefined) patch.description = nd;
    if (nt !== undefined) patch.tags = nt;
    if (nw !== undefined) patch.cwd = nw;
    if (Object.keys(patch).length === 0) {
      console.error("Nothing to update. Pass --command/--desc/--tags/--cwd.");
      process.exit(1);
    }
    try {
      console.log(editCommand(id, patch) ? "Updated." : "Not found.");
    } catch (e: any) {
      if (e?.message === "Command already exists") {
        console.error("Error: Command already exists.");
        process.exit(1);
      }
      throw e;
    }
    return;
  }

  console.error(`Unknown command: ${rawCmd}\n`);
  help();
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import type { CmdEntry } from "./db";

// --- Fuzzy matching (zero deps, Git Bash safe) ---
function fuzzyScore(query: string, target: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let score = 0;
  let consecutive = 0;
  let lastMatchIdx = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      // bonus for word start / start of string
      const atWordStart = ti === 0 || /[\s\/\\\-_.:]/.test(t[ti - 1]);
      score += atWordStart ? 10 : 1;
      if (ti === lastMatchIdx + 1) {
        consecutive++;
        score += consecutive * 3;
      } else {
        consecutive = 0;
      }
      lastMatchIdx = ti;
      qi++;
    }
  }
  if (qi < q.length) return -1; // not all chars matched in order
  // prefer shorter targets
  score -= Math.floor(t.length / 50);
  return score;
}

export function rankEntries(entries: CmdEntry[], query: string, currentCwd: string): { entry: CmdEntry; score: number }[] {
  const cwdLower = currentCwd.toLowerCase();
  const out: { entry: CmdEntry; score: number }[] = [];
  for (const e of entries) {
    const hay = `${e.command} ${e.description} ${e.tags}`;
    const s = fuzzyScore(query.trim(), hay);
    if (s < 0) continue;
    let total = s;
    if (e.cwd) {
      const ec = e.cwd.toLowerCase();
      if (cwdLower === ec) total += 500;
      else if (cwdLower.startsWith(ec) || ec.startsWith(cwdLower)) total += 200;
    }
    total += Math.min(e.use_count, 50) * 2;
    if (e.last_used && Date.now() - e.last_used < 7 * 24 * 3600 * 1000) total += 10;
    out.push({ entry: e, score: total });
  }
  out.sort((a, b) => b.score - a.score || b.entry.use_count - a.entry.use_count);
  return out;
}

// --- Interactive TUI: pure ANSI + raw stdin (works in PowerShell AND Git Bash) ---
const HIDE = "\x1b[?25l";
const SHOW = "\x1b[?25h";
const CLEAR = "\x1b[2J\x1b[H";
const INV = "\x1b[7m";
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";

export function runSearchTui(entries: CmdEntry[], initialQuery = ""): Promise<CmdEntry | null> {
  return new Promise((resolve) => {
    const stdin = process.stdin as NodeJS.ReadStream;
    const stdout = process.stdout;

    if (!stdin.isTTY) {
      // Non-interactive fallback: print matches, no selection
      const ranked = rankEntries(entries, initialQuery, process.cwd());
      for (const r of ranked.slice(0, 20)) console.log(`${r.entry.command}  # ${r.entry.description}`);
      resolve(null);
      return;
    }

    let query = initialQuery;
    let selected = 0;
    let closed = false;

    const ranked = () => rankEntries(entries, query, process.cwd());
    const visibleCount = () => Math.max(5, Math.min(12, (stdout.rows || 24) - 6));

    function render() {
      try {
        const results = ranked().slice(0, 30);
        if (selected >= results.length) selected = Math.max(0, results.length - 1);
        if (selected < 0) selected = 0;
        const visCount = visibleCount();
        const start = Math.max(0, Math.min(selected - visCount + 1, results.length - visCount));
        const vis = results.slice(start, start + visCount);
        let s = CLEAR + HIDE;
        s += `${CYAN}cm${RESET} ${DIM}— type to filter · ↑↓ navigate · Enter copy+quit · Esc quit${RESET}\n`;
        s += `> ${query}${INV} ${RESET}\n`;
        s += `${DIM}── ${results.length} match${results.length === 1 ? "" : "es"} ──${RESET}\n`;
        if (vis.length === 0) {
          s += `${DIM}No matches. (Ctrl+X / Esc to quit)${RESET}\n`;
        } else {
          vis.forEach((r, i) => {
            const globalIdx = start + i;
            const isSel = globalIdx === selected;
            const prefix = isSel ? `${INV}>` : " ";
            const suffix = isSel ? RESET : "";
            const cmd = r.entry.command.length > 80 ? r.entry.command.slice(0, 77) + "..." : r.entry.command;
            const meta = [r.entry.description, r.entry.tags ? `#${r.entry.tags}` : "", r.entry.cwd].filter(Boolean).join(" · ");
            s += `${prefix} ${cmd}${suffix}\n`;
            if (meta) s += `  ${DIM}${meta.slice(0, 100)}${RESET}\n`;
          });
        }
        stdout.write(s);
      } catch {
        done(null);
      }
    }

    let restored = false;
    function restore() {
      if (restored) return;
      restored = true;
      try { stdin.setRawMode!(false); } catch {}
      try { stdin.pause(); } catch {}
      try { stdout.write(SHOW); } catch {}
    }

    function cleanup() {
      restore();
    }

    function done(val: CmdEntry | null) {
      if (closed) return;
      closed = true;
      stdin.removeListener("data", onData);
      restore();
      // move cursor below TUI so result message is visible
      stdout.write("\n");
      resolve(val);
    }

    process.once("exit", restore);
    process.once("SIGINT", () => done(null));
    process.once("SIGTERM", () => done(null));

    function onData(buf: Buffer) {
      const str = buf.toString("utf8");
      // Ctrl+C, Ctrl+X => quit
      if (str === "\x03" || str === "\x18") return done(null);
      // Enter => select
      if (str === "\r" || str === "\n") {
        const results = ranked();
        if (results.length === 0) return done(null);
        return done(results[Math.min(selected, results.length - 1)]!.entry);
      }
      // Esc alone => quit. Arrow keys arrive as \x1b[A / \x1b[B
      if (str === "\x1b") return done(null);
      if (str === "\x1b[A" || str === "\x1bOA" || str === "\x1b[kA") { // Up
        selected = Math.max(0, selected - 1);
        return render();
      }
      if (str === "\x1b[B" || str === "\x1bOB" || str === "\x1b[kB") { // Down
        const n = ranked().length;
        selected = Math.min(Math.max(0, n - 1), selected + 1);
        return render();
      }
      // Ctrl+U clear line
      if (str === "\x15") { query = ""; selected = 0; return render(); }
      // Ctrl+W delete word
      if (str === "\x17") {
        query = query.replace(/\S+\s*$/, "");
        selected = 0;
        return render();
      }
      // Backspace (DEL or BS, incl. Git Bash variants)
      if (str === "\x7f" || str === "\x08" || str === "\x1b[3~") {
        query = query.slice(0, -1);
        selected = 0;
        return render();
      }
      // Printable input (also handles pasted strings; strip control chars but keep the text)
      const printable = str.replace(/[\x00-\x1f\x7f]/g, "");
      if (printable) {
        query += printable;
        selected = 0;
        return render();
      }
      // ignore other escape sequences
    }

    stdin.on("data", onData);
    try { stdin.setRawMode!(true); } catch {}
    stdin.resume();
    render();
  });
}

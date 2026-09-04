import { spawnSync } from "node:child_process";

const PS_PATHS = [
  "powershell", // PATH (works in PowerShell, CMD, and Git Bash)
  "powershell.exe",
  "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  "/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
];

const CLIP_PATHS = [
  "clip", // reads stdin, works everywhere on Windows incl. Git Bash
  "clip.exe",
  "C:\\Windows\\System32\\clip.exe",
  "/c/Windows/System32/clip.exe",
];

/** Copy text to Windows clipboard. Works from PowerShell, CMD, and Git Bash. Zero npm deps. */
export function copyToClipboard(text: string): boolean {
  // 1) PowerShell Set-Clipboard via stdin (unicode-safe, no quoting issues)
  for (const ps of PS_PATHS) {
    try {
      const r = spawnSync(
        ps,
        ["-NoProfile", "-NonInteractive", "-Command", "$input = [Console]::In.ReadToEnd(); if ($null -ne $input) { Set-Clipboard -Value $input }"],
        { input: text, encoding: "utf8", timeout: 5000, windowsHide: true }
      );
      if (r.status === 0) return true;
    } catch { /* try next */ }
  }
  // 2) Fallback: clip.exe (stdin -> clipboard)
  for (const c of CLIP_PATHS) {
    try {
      const r = spawnSync(c, [], { input: text, encoding: "utf8", timeout: 5000, windowsHide: true });
      if (r.status === 0) return true;
    } catch { /* try next */ }
  }
  return false;
}

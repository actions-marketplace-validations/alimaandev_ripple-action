"use strict";

/**
 * Ripple GitHub Action — dependency impact gate for pull requests.
 *
 * Runs `npx @alimaandev/ripple diff` (JSON contract) in the workspace,
 * emits annotations and a job summary from the JSON, writes outputs, and
 * optionally exports SARIF for Code Scanning. Zero dependencies — only
 * Node builtins and the `npx` on the runner.
 *
 * Inputs arrive as `INPUT_*` env vars (GitHub Actions convention). Changes
 * to this file must be mirrored into dist/index.js (same content).
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function env(key, fallback) {
  return process.env[key] || fallback || "";
}

function setOutput(key, value) {
  const outputFile = env("GITHUB_OUTPUT");
  const line = `${key}=${String(value)}\n`;
  if (outputFile) {
    fs.appendFileSync(outputFile, line);
  }
  console.log(`  ripple: ${key}=${String(value)}`);
}

function appendSummary(text) {
  const summaryFile = env("GITHUB_STEP_SUMMARY");
  if (summaryFile) {
    fs.appendFileSync(summaryFile, text);
  }
}

function runRipple(format) {
  const args = ["--yes", `@alimaandev/ripple@${env("INPUT_VERSION", "latest")}`];
  args.push("diff", "--format", format);
  const base = env("INPUT_BASE");
  if (base) args.push("--base", base);
  const gate = env("INPUT_GATE", "high");
  args.push("--gate", gate);
  for (const pattern of env("INPUT_ALLOW").split(/\r?\n/)) {
    const trimmed = pattern.trim();
    if (trimmed) args.push("--allow", trimmed);
  }
  const command = `npx ${args.map((arg) => `"${String(arg).replace(/"/g, '\\"')}"`).join(" ")}`;
  return spawnSync(command, {
    cwd: env("GITHUB_WORKSPACE", process.cwd()),
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    shell: true,
    timeout: 600_000,
  });
}

const LEVEL_INDEX = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
const GATE_INDEX = { medium: 1, high: 2, critical: 3 };

function blocks(file, gateLevel) {
  return LEVEL_INDEX[file.risk.level] >= GATE_INDEX[gateLevel];
}

function annotation(file, gateLevel) {
  const level = blocks(file, gateLevel) ? "error" : "warning";
  const score = file.risk.score;
  return `::${level} file=${file.file},title=Ripple ${file.risk.level}::${file.risk.level} risk (score ${score}) — ${file.affectedFiles} affected file(s)`;
}

function summaryMarkdown(parsed, blocked) {
  const rows = [];
  for (const file of parsed.files || []) {
    if (!file.analyzed) {
      rows.push(`| \`${file.file}\` | — | — | — | not a source file |`);
      continue;
    }
    const allowed = file.allowed ? " yes " : "";
    const emoji = blocks(file, parsed.gate.level) ? "🔴" : "🟢";
    rows.push(
      `| ${emoji} \`${file.file}\` | **${file.risk.level}** | ${file.risk.score} | ${file.affectedFiles} |${allowed} |`,
    );
  }
  const verdict = blocked
    ? `## 🛑 Ripple gate blocked — do not merge\n\nAt least one changed file is at or above the **${parsed.gate.level}** gate.`
    : `## ✅ Ripple gate passed\n\nNo changed file is at or above the **${parsed.gate.level}** gate.`;
  const counts = parsed.gate.counts || {};
  return `${verdict}\n\nChanged **${parsed.changedFiles}** file(s) against \`${parsed.base}\` · counts: LOW ${counts.low || 0} · MEDIUM ${counts.medium || 0} · HIGH ${counts.high || 0} · CRITICAL ${counts.critical || 0}\n\n| File | Risk | Score | Affected | Allowed |\n| --- | --- | --- | --- | --- |\n${rows.join("\n")}\n`;
}

const report = runRipple("json");

if (report.error) {
  console.error("ripple: failed to spawn npx — is Node/npm on the runner PATH?");
  console.error(report.error.message);
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(report.stdout);
} catch {
  console.error("ripple: the diff gate did not produce a JSON report.");
  if (report.stdout.trim()) console.error(report.stdout.trim());
  if (report.stderr.trim()) console.error(report.stderr.trim());
  process.exit(1);
}

const blocked = Boolean(parsed.gate.blocked);
const gateLevel = parsed.gate.level;
setOutput("blocked", blocked ? "true" : "false");
setOutput("gate-level", gateLevel);
setOutput("verdict", blocked ? "block" : "pass");
setOutput("counts", JSON.stringify(parsed.gate.counts || {}));
setOutput("changed-files", String(parsed.changedFiles || 0));

if (env("INPUT_ANNOTATE", "true").toLowerCase() === "true") {
  for (const file of parsed.files || []) {
    if (file.analyzed) console.log(annotation(file, gateLevel));
  }
  console.log(
    `::notice title=Ripple diff ${gateLevel} gate::${blocked ? "Gate blocked" : "Gate passed"}`,
  );
}

appendSummary(summaryMarkdown(parsed, blocked));

if (env("INPUT_UPLOAD_SARIF", "true").toLowerCase() === "true") {
  const sarif = runRipple("sarif");
  if (sarif.status === 0 && sarif.stdout.trim()) {
    const sarifFile = path.join(env("GITHUB_WORKSPACE", process.cwd()), env("INPUT_SARIF_PATH", "ripple.sarif"));
    fs.writeFileSync(sarifFile, sarif.stdout);
    setOutput("sarif-path", env("INPUT_SARIF_PATH", "ripple.sarif"));
    console.log("ripple: SARIF report written — add actions/upload-sarif to publish it to Code Scanning.");
  } else {
    console.warn("ripple: could not produce the SARIF report — skipping.");
  }
}

process.exitCode = blocked ? 1 : 0;

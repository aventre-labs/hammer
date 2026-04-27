/**
 * GSD Command — `/gsd memory`
 *
 * Subcommands:
 *   list            — show recent active memories
 *   show <id>       — print one memory
 *   ingest <uri>    — persist a source row (file path, URL, or "-" for stdin-piped note)
 *   note "<text>"   — persist an inline note as a source
 *   forget <id>     — supersede a memory (CAP_EXCEEDED sentinel)
 *   stats           — category / scope counts + source count
 *   sources         — list recent memory_sources rows
 *   extract <src>   — dispatch an agent turn that distils a source into memories
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import type { ExtensionAPI, ExtensionCommandContext } from "@gsd/pi-coding-agent";

import { projectRoot } from "./commands/context.js";
import { ingestFile, ingestNote, ingestUrl, summarizeIngest } from "./memory-ingest.js";
import { getMemorySource, listMemorySources } from "./memory-source-store.js";
import {
  createMemory,
  decayStaleMemories,
  enforceMemoryCap,
  getActiveMemories,
  getActiveMemoriesRanked,
  getVolvoxStatus,
  runVolvoxEpoch,
  supersedeMemory,
} from "./memory-store.js";
import { _getAdapter, isDbAvailable } from "./gsd-db.js";
import { createMemoryRelation, listRelationsFor } from "./memory-relations.js";

// ─── Arg parsing ────────────────────────────────────────────────────────────

interface MemoryCmdArgs {
  sub: string;
  positional: string[];
  tags: string[];
  scope?: string;
  extract: boolean;
  flags: string[];
}

function parseArgs(raw: string): MemoryCmdArgs {
  const tokens = splitArgs(raw);
  const sub = (tokens.shift() ?? "list").toLowerCase();
  const positional: string[] = [];
  const tags: string[] = [];
  const flags: string[] = [];
  let scope: string | undefined;
  let extract = false;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === "--tag" && i + 1 < tokens.length) {
      tags.push(...tokens[++i].split(",").map((t) => t.trim()).filter(Boolean));
      continue;
    }
    if (tok.startsWith("--tag=")) {
      tags.push(...tok.slice("--tag=".length).split(",").map((t) => t.trim()).filter(Boolean));
      continue;
    }
    if (tok === "--scope" && i + 1 < tokens.length) {
      scope = tokens[++i];
      continue;
    }
    if (tok.startsWith("--scope=")) {
      scope = tok.slice("--scope=".length);
      continue;
    }
    if (tok === "--extract") {
      extract = true;
      continue;
    }
    if (tok === "--no-extract") {
      extract = false;
      continue;
    }
    if (tok.startsWith("--")) {
      flags.push(tok);
      continue;
    }
    positional.push(tok);
  }
  return { sub, positional, tags, scope, extract, flags };
}

function splitArgs(raw: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

// ─── Handler ────────────────────────────────────────────────────────────────

export async function handleMemory(
  args: string,
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
): Promise<void> {
  const parsed = parseArgs(args);

  // `/gsd memory` or `/gsd memory help`
  if (parsed.sub === "" || parsed.sub === "help") {
    ctx.ui.notify(usage(), "info");
    return;
  }

  // Most subcommands need the DB.
  await ensureDb();

  switch (parsed.sub) {
    case "list":
      handleList(ctx);
      return;
    case "show":
      handleShow(ctx, parsed.positional[0]);
      return;
    case "forget":
      handleForget(ctx, parsed.positional[0]);
      return;
    case "stats":
      handleStats(ctx);
      return;
    case "volvox":
      handleVolvox(ctx, parsed.positional, parsed.flags);
      return;
    case "sources":
      handleSources(ctx);
      return;
    case "note":
      await handleNote(ctx, parsed);
      return;
    case "ingest":
      await handleIngest(ctx, parsed);
      return;
    case "extract":
      handleExtractSource(ctx, pi, parsed.positional[0]);
      return;
    case "export":
      handleExport(ctx, parsed.positional[0]);
      return;
    case "import":
      handleImport(ctx, parsed.positional[0]);
      return;
    case "decay":
      handleDecay(ctx);
      return;
    case "cap":
      handleCap(ctx, parsed.positional[0]);
      return;
    default:
      ctx.ui.notify(`Unknown subcommand "${parsed.sub}". ${usage()}`, "warning");
      return;
  }
}

function usage(): string {
  return [
    "Usage: /hammer memory <subcommand>",
    "  list                    list recent active memories",
    "  show <MEM###>           print one memory",
    "  forget <MEM###>         supersede a memory",
    "  stats                   counts by category / scope / sources / edges / VOLVOX",
    "  volvox status           inspect lifecycle status and latest epoch",
    "  volvox epoch [--dry-run] run or preview a VOLVOX lifecycle epoch",
    "  volvox diagnose [MEM###] inspect lifecycle diagnostics",
    "  sources                 list recent memory_sources",
    '  note "<text>"           ingest an inline note as a source',
    "  ingest <path|url>       ingest a local file path or URL",
    "  extract <SRC-xxx>       dispatch an LLM turn to extract memories from a source",
    "  export <path.json>      dump memories + relations + sources to JSON",
    "  import <path.json>      load a previous export (idempotent)",
    "  decay                   run the stale-memory decay pass immediately",
    "  cap [N]                 enforce the memory cap (default 50)",
    "",
    "Options: --tag a,b   --scope project|global|<custom>   --extract",
  ].join("\n");
}

function volvoxUsage(): string {
  return [
    "Usage: /hammer memory volvox <status|epoch|diagnose>",
    "  status                  inspect current lifecycle counts and latest epoch",
    "  epoch [--dry-run]       run or preview a VOLVOX lifecycle epoch",
    "  diagnose [MEM###]       show structured lifecycle diagnostics",
    "",
    "Next: /hammer memory volvox status",
  ].join("\n");
}

async function ensureDb(): Promise<void> {
  if (isDbAvailable()) return;
  const { ensureDbOpen } = await import("./bootstrap/dynamic-tools.js");
  await ensureDbOpen();
}

function handleList(ctx: ExtensionCommandContext): void {
  if (!isDbAvailable()) {
    ctx.ui.notify("No GSD database available.", "warning");
    return;
  }
  const memories = getActiveMemoriesRanked(50);
  if (memories.length === 0) {
    ctx.ui.notify("No active memories.", "info");
    return;
  }
  const lines = memories.map(
    (m) =>
      `- [${m.id}] (${m.category}, conf ${m.confidence.toFixed(2)}, hits ${m.hit_count}${m.scope && m.scope !== "project" ? `, ${m.scope}` : ""}; ${formatVolvoxInline(m)}) ${truncate(m.content, 100)}`,
  );
  ctx.ui.notify(lines.join("\n"), "info");
}

function handleShow(ctx: ExtensionCommandContext, id: string | undefined): void {
  if (!id) {
    ctx.ui.notify("Usage: /gsd memory show <MEM###>", "warning");
    return;
  }
  const adapter = _getAdapter();
  if (!adapter) {
    ctx.ui.notify("No GSD database available.", "warning");
    return;
  }
  const row = adapter.prepare("SELECT * FROM memories WHERE id = :id").get({ ":id": id });
  if (!row) {
    ctx.ui.notify(`Memory not found: ${id}`, "warning");
    return;
  }
  const tags = row["tags"] ? safeJsonArray(row["tags"] as string) : [];
  const volvox = rowToVolvoxView(row);
  const lines = [
    `ID: ${row["id"]}`,
    `Category: ${row["category"]}`,
    `Scope: ${row["scope"] ?? "project"}`,
    `Confidence: ${Number(row["confidence"]).toFixed(2)}`,
    `Hits: ${row["hit_count"]}`,
    `Created: ${row["created_at"]}`,
    `Updated: ${row["updated_at"]}`,
    tags.length > 0 ? `Tags: ${tags.join(", ")}` : null,
    row["superseded_by"] ? `Superseded by: ${row["superseded_by"]}` : null,
    row["source_unit_type"] ? `Source: ${row["source_unit_type"]}/${row["source_unit_id"]}` : null,
    "",
    "VOLVOX:",
    `  Cell type: ${volvox.cellType}`,
    `  Role stability: ${formatScore(volvox.roleStability)}`,
    `  Lifecycle/Kirk: ${volvox.lifecyclePhase} / ${volvox.kirkStep ?? 0}`,
    `  Dormancy cycles: ${volvox.dormancyCycles}`,
    `  Propagation eligible: ${volvox.propagationEligible}`,
    `  Archived: ${volvox.archivedAt ?? "false"}`,
    volvox.lastEpochId ? `  Last epoch: ${volvox.lastEpochId}${volvox.lastEpochAt ? ` at ${volvox.lastEpochAt}` : ""}` : `  Last epoch: none`,
    "",
    String(row["content"]),
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
  ctx.ui.notify(lines, "info");
}

function handleForget(ctx: ExtensionCommandContext, id: string | undefined): void {
  if (!id) {
    ctx.ui.notify("Usage: /gsd memory forget <MEM###>", "warning");
    return;
  }
  const ok = supersedeMemory(id, "CAP_EXCEEDED");
  if (!ok) {
    ctx.ui.notify(`Failed to forget ${id}.`, "warning");
    return;
  }
  ctx.ui.notify(`Forgot ${id}.`, "info");
}

function handleStats(ctx: ExtensionCommandContext): void {
  const adapter = _getAdapter();
  if (!adapter) {
    ctx.ui.notify("No GSD database available.", "warning");
    return;
  }
  try {
    const activeRow = adapter
      .prepare("SELECT count(*) as cnt FROM memories WHERE superseded_by IS NULL")
      .get();
    const supersededRow = adapter
      .prepare("SELECT count(*) as cnt FROM memories WHERE superseded_by IS NOT NULL")
      .get();
    const byCategory = adapter
      .prepare(
        "SELECT category, count(*) as cnt FROM memories WHERE superseded_by IS NULL GROUP BY category ORDER BY cnt DESC",
      )
      .all();
    const byScope = adapter
      .prepare(
        "SELECT scope, count(*) as cnt FROM memories WHERE superseded_by IS NULL GROUP BY scope ORDER BY cnt DESC",
      )
      .all();
    const sourcesRow = adapter.prepare("SELECT count(*) as cnt FROM memory_sources").get();
    const sourcesByKind = adapter
      .prepare("SELECT kind, count(*) as cnt FROM memory_sources GROUP BY kind ORDER BY cnt DESC")
      .all();
    const relationsRow = adapter.prepare("SELECT count(*) as cnt FROM memory_relations").get();
    const relationsByRel = adapter
      .prepare("SELECT rel, count(*) as cnt FROM memory_relations GROUP BY rel ORDER BY cnt DESC")
      .all();
    const embeddingsRow = adapter.prepare("SELECT count(*) as cnt FROM memory_embeddings").get();
    const embeddedActiveRow = adapter
      .prepare(
        `SELECT count(*) as cnt FROM memory_embeddings e
         JOIN memories m ON m.id = e.memory_id
         WHERE m.superseded_by IS NULL`,
      )
      .get();
    const byVolvoxCell = adapter
      .prepare("SELECT volvox_cell_type as value, count(*) as cnt FROM memories WHERE superseded_by IS NULL GROUP BY volvox_cell_type ORDER BY cnt DESC, value ASC")
      .all();
    const byVolvoxLifecycle = adapter
      .prepare("SELECT volvox_lifecycle_phase as value, count(*) as cnt FROM memories WHERE superseded_by IS NULL GROUP BY volvox_lifecycle_phase ORDER BY cnt DESC, value ASC")
      .all();
    const propagationEligibleRow = adapter
      .prepare("SELECT count(*) as cnt FROM memories WHERE superseded_by IS NULL AND volvox_propagation_eligible = 1")
      .get();
    const dormantRow = adapter
      .prepare("SELECT count(*) as cnt FROM memories WHERE superseded_by IS NULL AND (volvox_cell_type = 'DORMANT' OR volvox_lifecycle_phase = 'dormant')")
      .get();
    const archivedRow = adapter
      .prepare("SELECT count(*) as cnt FROM memories WHERE superseded_by IS NULL AND (volvox_archived_at IS NOT NULL OR volvox_lifecycle_phase = 'archived')")
      .get();
    const latestEpoch = getVolvoxStatus().latestEpoch;
    const activeCount = (activeRow?.["cnt"] as number) ?? 0;
    const embeddedActive = (embeddedActiveRow?.["cnt"] as number) ?? 0;
    const coverage = activeCount > 0 ? `${Math.round((embeddedActive / activeCount) * 100)}%` : "n/a";

    const out = [
      `Active memories: ${activeCount}`,
      `Superseded: ${supersededRow?.["cnt"] ?? 0}`,
      "",
      "By category:",
      ...byCategory.map((row) => `  ${row["category"]}: ${row["cnt"]}`),
      "",
      "By scope:",
      ...byScope.map((row) => `  ${row["scope"]}: ${row["cnt"]}`),
      "",
      `Memory sources: ${sourcesRow?.["cnt"] ?? 0}`,
      ...sourcesByKind.map((row) => `  ${row["kind"]}: ${row["cnt"]}`),
      "",
      `Relations: ${relationsRow?.["cnt"] ?? 0}`,
      ...relationsByRel.map((row) => `  ${row["rel"]}: ${row["cnt"]}`),
      "",
      `Embeddings: ${embeddingsRow?.["cnt"] ?? 0} total, ${embeddedActive} active (coverage ${coverage})`,
      "",
      "VOLVOX:",
      "By VOLVOX cell type:",
      ...byVolvoxCell.map((row) => `  ${row["value"]}: ${row["cnt"]}`),
      "By VOLVOX lifecycle:",
      ...byVolvoxLifecycle.map((row) => `  ${row["value"]}: ${row["cnt"]}`),
      `Propagation eligible: ${propagationEligibleRow?.["cnt"] ?? 0}`,
      `Dormant: ${dormantRow?.["cnt"] ?? 0}`,
      `Archived: ${archivedRow?.["cnt"] ?? 0}`,
      latestEpoch ? `Last VOLVOX epoch: ${latestEpoch.id} status=${latestEpoch.status} trigger=${latestEpoch.trigger} diagnostics=${latestEpoch.diagnostics.length}` : "Last VOLVOX epoch: none",
    ].join("\n");
    ctx.ui.notify(out, "info");
  } catch (err) {
    ctx.ui.notify(`Stats failed: ${(err as Error).message}`, "warning");
  }
}

interface VolvoxView {
  cellType: string;
  roleStability: number;
  lifecyclePhase: string;
  propagationEligible: boolean;
  dormancyCycles: number;
  kirkStep: number | null;
  archivedAt: string | null;
  lastEpochId: string | null;
  lastEpochAt: string | null;
}

function handleVolvox(ctx: ExtensionCommandContext, positional: string[], flags: string[]): void {
  const sub = (positional[0] ?? "status").toLowerCase();
  const args = positional.slice(1);
  const adapter = _getAdapter();
  if (!adapter) {
    ctx.ui.notify(
      "Hammer database unavailable for VOLVOX lifecycle inspection. Next: open the project DB, then run /hammer memory volvox status.",
      "warning",
    );
    return;
  }

  switch (sub) {
    case "status":
      if (flags.length > 0 || args.length > 0) {
        ctx.ui.notify(`Usage: /hammer memory volvox status\n${volvoxUsage()}`, "warning");
        return;
      }
      handleVolvoxStatus(ctx);
      return;
    case "epoch":
      handleVolvoxEpoch(ctx, flags, args);
      return;
    case "diagnose":
      handleVolvoxDiagnose(ctx, args, flags);
      return;
    case "help":
      ctx.ui.notify(volvoxUsage(), "info");
      return;
    default:
      ctx.ui.notify(`Unknown Hammer VOLVOX subcommand "${sub}".\n${volvoxUsage()}`, "warning");
      return;
  }
}

function handleVolvoxStatus(ctx: ExtensionCommandContext): void {
  const adapter = _getAdapter();
  if (!adapter) {
    ctx.ui.notify("Hammer database unavailable. Next: /hammer memory volvox status", "warning");
    return;
  }

  try {
    const activeRow = adapter.prepare("SELECT count(*) as cnt FROM memories WHERE superseded_by IS NULL").get();
    const byCell = adapter.prepare(
      "SELECT volvox_cell_type as value, count(*) as cnt FROM memories WHERE superseded_by IS NULL GROUP BY volvox_cell_type ORDER BY cnt DESC, value ASC",
    ).all();
    const byLifecycle = adapter.prepare(
      "SELECT volvox_lifecycle_phase as value, count(*) as cnt FROM memories WHERE superseded_by IS NULL GROUP BY volvox_lifecycle_phase ORDER BY cnt DESC, value ASC",
    ).all();
    const eligible = adapter.prepare(
      "SELECT count(*) as cnt FROM memories WHERE superseded_by IS NULL AND volvox_propagation_eligible = 1",
    ).get();
    const dormant = adapter.prepare(
      "SELECT count(*) as cnt FROM memories WHERE superseded_by IS NULL AND (volvox_cell_type = 'DORMANT' OR volvox_lifecycle_phase = 'dormant')",
    ).get();
    const archived = adapter.prepare(
      "SELECT count(*) as cnt FROM memories WHERE superseded_by IS NULL AND (volvox_archived_at IS NOT NULL OR volvox_lifecycle_phase = 'archived')",
    ).get();
    const status = getVolvoxStatus();
    const latest = status.latestEpoch;
    const lines = [
      "Hammer VOLVOX Status",
      `Active memories: ${activeRow?.["cnt"] ?? 0}`,
      latest
        ? `Latest epoch: ${latest.id} status=${latest.status} trigger=${latest.trigger} started=${latest.startedAt} completed=${latest.completedAt ?? "running"}`
        : "Latest epoch: none",
      latest ? `Latest counts: ${formatCounts(latest.counts)}` : null,
      latest ? `Diagnostics: ${latest.diagnostics.length}` : null,
      "",
      "By cell type:",
      ...(byCell.length > 0 ? byCell.map((row) => `  ${row["value"]}: ${row["cnt"]}`) : ["  none: 0"]),
      "By lifecycle:",
      ...(byLifecycle.length > 0 ? byLifecycle.map((row) => `  ${row["value"]}: ${row["cnt"]}`) : ["  none: 0"]),
      `Propagation eligible: ${eligible?.["cnt"] ?? 0}`,
      `Dormant: ${dormant?.["cnt"] ?? 0}`,
      `Archived: ${archived?.["cnt"] ?? 0}`,
      "Next: /hammer memory volvox diagnose",
    ].filter((line): line is string => line != null);
    ctx.ui.notify(lines.join("\n"), latest?.status === "failed" ? "warning" : "info");
  } catch (err) {
    ctx.ui.notify(
      `Hammer VOLVOX status failed: ${(err as Error).message}. Next: /hammer memory volvox diagnose`,
      "warning",
    );
  }
}

function handleVolvoxEpoch(ctx: ExtensionCommandContext, flags: string[], args: string[]): void {
  const unknownFlag = flags.find((flag) => flag !== "--dry-run");
  if (unknownFlag || args.length > 0) {
    ctx.ui.notify(
      `${unknownFlag ? `Unknown flag "${unknownFlag}". ` : ""}Usage: /hammer memory volvox epoch [--dry-run]`,
      "warning",
    );
    return;
  }
  const dryRun = flags.includes("--dry-run");
  try {
    const epoch = runVolvoxEpoch({ trigger: dryRun ? "command-dry-run" : "command", dryRun });
    const blockingCodes = epoch.diagnostics
      .filter((diagnostic) => diagnostic.severity === "blocking")
      .slice(0, 5)
      .map((diagnostic) => `${diagnostic.code}${diagnostic.memoryId ? `/${diagnostic.memoryId}` : ""}`);
    const label = dryRun ? "dry-run" : epoch.status;
    const lines = [
      `Hammer VOLVOX epoch ${label}`,
      `Epoch: ${epoch.epochId}`,
      `Persisted: ${dryRun ? "no" : "yes"}`,
      `Processed: ${epoch.counts.processed}`,
      `Changed: ${epoch.counts.changed}`,
      `Propagation eligible: ${epoch.counts.propagationEligible}`,
      `Archived: ${epoch.counts.archived}`,
      `Diagnostics: ${epoch.counts.diagnostics}`,
      `Blocking diagnostics: ${epoch.counts.blockingDiagnostics}`,
      blockingCodes.length > 0 ? `Blocking codes: ${blockingCodes.join(", ")}` : null,
      "Next: /hammer memory volvox diagnose",
    ].filter((line): line is string => line != null);
    ctx.ui.notify(lines.join("\n"), epoch.status === "blocked" ? "warning" : "info");
  } catch (err) {
    ctx.ui.notify(
      `Hammer VOLVOX epoch failed: ${(err as Error).message}. Next: /hammer memory volvox diagnose`,
      "error",
    );
  }
}

function handleVolvoxDiagnose(ctx: ExtensionCommandContext, args: string[], flags: string[]): void {
  if (flags.length > 0 || args.length > 1 || (args[0] && !isMemoryId(args[0]))) {
    ctx.ui.notify("Usage: /hammer memory volvox diagnose [MEM###]", "warning");
    return;
  }

  const memoryId = args[0];
  const adapter = _getAdapter();
  if (!adapter) {
    ctx.ui.notify("Hammer database unavailable. Next: /hammer memory volvox status", "warning");
    return;
  }

  const row = memoryId
    ? adapter.prepare("SELECT * FROM memories WHERE id = :id").get({ ":id": memoryId })
    : undefined;
  if (memoryId && !row) {
    ctx.ui.notify(`No Hammer memory found for ${memoryId}. Next: /hammer memory list`, "warning");
    return;
  }

  const status = getVolvoxStatus();
  const diagnostics = memoryId
    ? status.diagnostics.filter((diagnostic) => diagnostic.memoryId === memoryId)
    : status.diagnostics;
  const level = diagnostics.some((diagnostic) => diagnostic.severity === "blocking") || diagnostics.length === 0
    ? "warning"
    : "info";
  const memoryVolvox = row ? rowToVolvoxView(row) : null;
  const lines = [
    "Hammer VOLVOX Diagnose",
    status.latestEpoch ? `Epoch: ${status.latestEpoch.id} status=${status.latestEpoch.status} trigger=${status.latestEpoch.trigger}` : "Epoch: none",
    memoryId ? `Memory: ${memoryId}` : "Memory: all",
    memoryVolvox ? `Cell: ${memoryVolvox.cellType}` : null,
    memoryVolvox ? `Lifecycle/Kirk: ${memoryVolvox.lifecyclePhase} / ${memoryVolvox.kirkStep ?? 0}` : null,
    memoryVolvox ? `Archived: ${memoryVolvox.archivedAt ?? "false"}` : null,
    diagnostics.length === 0 ? `No diagnostics found${memoryId ? ` for ${memoryId}` : ""}.` : "Diagnostics:",
    ...diagnostics.slice(0, 20).map((diagnostic) =>
      `- ${diagnostic.severity} ${diagnostic.code}${diagnostic.memoryId ? ` ${diagnostic.memoryId}` : ""} phase=${diagnostic.phase}: ${truncate(diagnostic.message, 140)} Remediation: ${truncate(diagnostic.remediation, 160)} (${diagnostic.timestamp})`,
    ),
    diagnostics.length > 20 ? `... ${diagnostics.length - 20} more diagnostics omitted; rerun with a memory id to narrow scope.` : null,
    "Next: /hammer memory volvox epoch --dry-run",
  ].filter((line): line is string => line != null);
  ctx.ui.notify(lines.join("\n"), level);
}

function rowToVolvoxView(row: Record<string, unknown>): VolvoxView {
  return {
    cellType: typeof row["volvox_cell_type"] === "string" ? row["volvox_cell_type"] : "UNDIFFERENTIATED",
    roleStability: clampUnit(row["volvox_role_stability"]),
    lifecyclePhase: typeof row["volvox_lifecycle_phase"] === "string" ? row["volvox_lifecycle_phase"] : "embryonic",
    propagationEligible: row["volvox_propagation_eligible"] === 1 || row["volvox_propagation_eligible"] === true,
    dormancyCycles: nonNegativeInteger(row["volvox_dormancy_cycles"]),
    kirkStep: typeof row["volvox_kirk_step"] === "number" && Number.isFinite(row["volvox_kirk_step"])
      ? Math.floor(row["volvox_kirk_step"])
      : null,
    archivedAt: typeof row["volvox_archived_at"] === "string" && row["volvox_archived_at"].length > 0 ? row["volvox_archived_at"] : null,
    lastEpochId: typeof row["volvox_last_epoch_id"] === "string" && row["volvox_last_epoch_id"].length > 0 ? row["volvox_last_epoch_id"] : null,
    lastEpochAt: typeof row["volvox_last_epoch_at"] === "string" && row["volvox_last_epoch_at"].length > 0 ? row["volvox_last_epoch_at"] : null,
  };
}

function formatVolvoxInline(memory: ReturnType<typeof getActiveMemoriesRanked>[number]): string {
  const volvox = memory.volvox;
  return [
    `VOLVOX cell=${volvox?.cellType ?? "UNDIFFERENTIATED"}`,
    `stability=${formatScore(volvox?.roleStability ?? 0)}`,
    `lifecycle=${volvox?.lifecyclePhase ?? "embryonic"}`,
    `kirk=${volvox?.kirkStep ?? 0}`,
    `dormant=${volvox?.dormancyCycles ?? 0}`,
    `eligible=${volvox?.propagationEligible === true}`,
    `archived=${volvox?.archivedAt ?? "false"}`,
  ].join(" ");
}

function isMemoryId(value: string): boolean {
  return /^MEM\d{3,}$/.test(value);
}

function formatCounts(value: unknown): string {
  if (!value || typeof value !== "object") return "n/a";
  const counts = value as Record<string, unknown>;
  return [
    `processed=${counts.processed ?? 0}`,
    `changed=${counts.changed ?? 0}`,
    `diagnostics=${counts.diagnostics ?? 0}`,
    `blocking=${counts.blockingDiagnostics ?? 0}`,
  ].join(" ");
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function clampUnit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.round(Math.max(0, Math.min(1, value)) * 10_000) / 10_000;
}

function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

function handleExport(ctx: ExtensionCommandContext, target: string | undefined): void {
  if (!target) {
    ctx.ui.notify("Usage: /gsd memory export <path.json>", "warning");
    return;
  }
  try {
    const active = getActiveMemories();
    const relations = active.flatMap((m) =>
      listRelationsFor(m.id).filter((r) => r.from === m.id),
    );
    const sources = listMemorySources(500);
    const payload = {
      version: 1,
      exported_at: new Date().toISOString(),
      memories: active.map((m) => ({
        id: m.id,
        category: m.category,
        content: m.content,
        confidence: m.confidence,
        hit_count: m.hit_count,
        scope: m.scope,
        tags: m.tags,
        source_unit_type: m.source_unit_type,
        source_unit_id: m.source_unit_id,
        created_at: m.created_at,
        updated_at: m.updated_at,
      })),
      relations: relations.map((r) => ({
        from: r.from,
        to: r.to,
        rel: r.rel,
        confidence: r.confidence,
      })),
      sources,
    };
    const abs = resolvePath(process.cwd(), target);
    writeFileSync(abs, JSON.stringify(payload, null, 2), "utf-8");
    ctx.ui.notify(
      `Exported ${payload.memories.length} memories, ${payload.relations.length} relations, ${payload.sources.length} sources → ${abs}`,
      "info",
    );
  } catch (err) {
    ctx.ui.notify(`Export failed: ${(err as Error).message}`, "error");
  }
}

interface ExportedMemory {
  id?: string;
  category: string;
  content: string;
  confidence?: number;
  scope?: string;
  tags?: string[];
}

interface ExportedRelation {
  from: string;
  to: string;
  rel: string;
  confidence?: number;
}

function handleImport(ctx: ExtensionCommandContext, target: string | undefined): void {
  if (!target) {
    ctx.ui.notify("Usage: /gsd memory import <path.json>", "warning");
    return;
  }
  try {
    const abs = resolvePath(process.cwd(), target);
    const raw = readFileSync(abs, "utf-8");
    const parsed = JSON.parse(raw) as { memories?: ExportedMemory[]; relations?: ExportedRelation[] };

    let memoryCount = 0;
    let relationCount = 0;

    for (const mem of parsed.memories ?? []) {
      if (!mem.category || !mem.content) continue;
      // createMemory allocates a fresh seq → new MEM### id; imports replay
      // content rather than preserving the old ID. Relations from the export
      // file still reference the old IDs, so only lossless round-trips into
      // an empty DB preserve the graph.
      const id = createMemory({
        category: mem.category,
        content: mem.content,
        confidence: mem.confidence,
        scope: mem.scope,
        tags: mem.tags,
      });
      if (id) memoryCount++;
    }

    for (const rel of parsed.relations ?? []) {
      if (!rel.from || !rel.to || !rel.rel) continue;
      if (createMemoryRelation(rel.from, rel.to, rel.rel as never, rel.confidence)) {
        relationCount++;
      }
    }

    ctx.ui.notify(`Imported ${memoryCount} memories and ${relationCount} relations.`, "info");
  } catch (err) {
    ctx.ui.notify(`Import failed: ${(err as Error).message}`, "error");
  }
}

function handleDecay(ctx: ExtensionCommandContext): void {
  const decayed = decayStaleMemories(20);
  if (decayed.length === 0) {
    ctx.ui.notify("Decay pass: no stale memories found.", "info");
    return;
  }
  ctx.ui.notify(`Decayed ${decayed.length} stale memor${decayed.length === 1 ? "y" : "ies"}: ${decayed.join(", ")}`, "info");
}

function handleCap(ctx: ExtensionCommandContext, arg: string | undefined): void {
  const max = arg ? Number.parseInt(arg, 10) : 50;
  if (!Number.isFinite(max) || max < 1) {
    ctx.ui.notify("Usage: /gsd memory cap <max>  (default 50)", "warning");
    return;
  }
  enforceMemoryCap(max);
  ctx.ui.notify(`Enforced memory cap of ${max}.`, "info");
}

function handleSources(ctx: ExtensionCommandContext): void {
  const sources = listMemorySources(30);
  if (sources.length === 0) {
    ctx.ui.notify("No memory sources yet. Use `/gsd memory ingest <path|url>` to add one.", "info");
    return;
  }
  const lines = sources.map(
    (s) =>
      `- ${s.id} [${s.kind}${s.scope !== "project" ? `/${s.scope}` : ""}] ${truncate(s.title ?? s.uri ?? s.content, 100)}`,
  );
  ctx.ui.notify(lines.join("\n"), "info");
}

async function handleNote(ctx: ExtensionCommandContext, args: MemoryCmdArgs): Promise<void> {
  const text = args.positional.join(" ").trim();
  if (!text) {
    ctx.ui.notify('Usage: /gsd memory note "your note"', "warning");
    return;
  }
  try {
    const result = await ingestNote(text, null, {
      scope: args.scope,
      tags: args.tags,
      extract: false,
    });
    ctx.ui.notify(summarizeIngest(result), "info");
  } catch (err) {
    ctx.ui.notify(`Note ingest failed: ${(err as Error).message}`, "error");
  }
}

async function handleIngest(ctx: ExtensionCommandContext, args: MemoryCmdArgs): Promise<void> {
  const target = args.positional[0];
  if (!target) {
    ctx.ui.notify("Usage: /gsd memory ingest <path|url> [--tag a,b] [--scope project|global]", "warning");
    return;
  }
  try {
    const isUrl = /^https?:\/\//i.test(target);
    const result = isUrl
      ? await ingestUrl(target, null, { scope: args.scope, tags: args.tags, extract: false })
      : await ingestFile(target, null, { scope: args.scope, tags: args.tags, extract: false });
    ctx.ui.notify(summarizeIngest(result), "info");
    if (args.extract && result.sourceId) {
      // TODO (P3): dispatch agent turn to extract memories once source is stored.
      ctx.ui.notify(
        `(Dispatching extraction turn — use \`/gsd memory extract ${result.sourceId}\` to trigger manually.)`,
        "info",
      );
    }
  } catch (err) {
    ctx.ui.notify(`Ingest failed: ${(err as Error).message}`, "error");
  }
}

function handleExtractSource(
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
  id: string | undefined,
): void {
  if (!id) {
    ctx.ui.notify("Usage: /gsd memory extract <SRC-xxx>", "warning");
    return;
  }
  const source = getMemorySource(id);
  if (!source) {
    ctx.ui.notify(`Source not found: ${id}`, "warning");
    return;
  }

  const prompt = buildExtractPrompt(source);
  ctx.ui.notify(`Dispatching extraction turn for ${id}...`, "info");
  pi.sendMessage(
    { customType: "gsd-memory-extract", content: prompt, display: false },
    { triggerTurn: true },
  );
}

function buildExtractPrompt(source: { id: string; kind: string; title: string | null; uri: string | null; content: string }): string {
  const header = [
    `## Memory extraction request`,
    ``,
    `Source: ${source.id} (${source.kind})`,
    source.title ? `Title: ${source.title}` : null,
    source.uri ? `URI: ${source.uri}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return [
    header,
    "",
    "Read the content below and call the `capture_thought` tool once per durable insight",
    "(architecture, convention, gotcha, preference, environment, pattern). Skip one-off details,",
    "temporary state, and anything secret. Keep each memory to 1–3 sentences.",
    "",
    "---",
    "",
    source.content,
  ].join("\n");
}

function safeJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

// projectRoot is imported so tests can mock it via the same path as other commands.
export const _internals = { projectRoot };

/**
 * Phase handoff anchors — compact structured summaries written between
 * GSD auto-mode phases so downstream agents inherit decisions, blockers,
 * and intent without re-inferring from scratch.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { getOmegaPhaseArtifact } from "./gsd-db.js";
import {
  omegaPhaseRunBaseDir,
  validatePhaseOmegaArtifacts,
  type OmegaPhaseManifest,
  type OmegaPhaseUnitType,
} from "./omega-phase-artifacts.js";
import { gsdRoot } from "./paths.js";

export interface PhaseAnchor {
  phase: string;
  milestoneId: string;
  generatedAt: string;
  intent: string;
  decisions: string[];
  blockers: string[];
  nextSteps: string[];
  /**
   * S01 governed-phase Omega provenance. Populated when the dispatch was
   * gated by `runPhaseSpiral` and the canonical 10-stage spiral completed
   * successfully. Downstream phases inherit the synthesis via these links.
   */
  omegaRunId?: string;
  /** Path to the gating phase-manifest.json. */
  omegaManifestPath?: string;
  /** Path to the aggregate artifact (e.g. S01-PLAN.md) carrying spiral frontmatter. */
  omegaAggregatePath?: string;
}

export interface OmegaPhasePromptReference {
  unitType: OmegaPhaseUnitType;
  unitId: string;
  /** Human-readable label for the prompt section. Defaults to `${unitType} ${unitId}`. */
  label?: string;
  /** Expected phase target artifact path; when supplied validation fails closed on stale manifests. */
  expectedTargetArtifactPath?: string;
}

const SYNTHESIS_PROMPT_CHAR_LIMIT = 2_000;

function anchorsDir(basePath: string, milestoneId: string): string {
  return join(gsdRoot(basePath), "milestones", milestoneId, "anchors");
}

function anchorPath(basePath: string, milestoneId: string, phase: string): string {
  return join(anchorsDir(basePath, milestoneId), `${phase}.json`);
}

export function writePhaseAnchor(basePath: string, milestoneId: string, anchor: PhaseAnchor): void {
  const dir = anchorsDir(basePath, milestoneId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(anchorPath(basePath, milestoneId, anchor.phase), JSON.stringify(anchor, null, 2), "utf-8");
}

export function readPhaseAnchor(basePath: string, milestoneId: string, phase: string): PhaseAnchor | null {
  const path = anchorPath(basePath, milestoneId, phase);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as PhaseAnchor;
  } catch {
    return null;
  }
}

export function formatAnchorForPrompt(anchor: PhaseAnchor): string {
  const lines: string[] = [
    `## Handoff from ${anchor.phase}`,
    "",
    `**Intent:** ${anchor.intent}`,
  ];

  if (anchor.decisions.length > 0) {
    lines.push("", "**Decisions:**");
    for (const d of anchor.decisions) lines.push(`- ${d}`);
  }

  if (anchor.blockers.length > 0) {
    lines.push("", "**Blockers:**");
    for (const b of anchor.blockers) lines.push(`- ${b}`);
  }

  if (anchor.nextSteps.length > 0) {
    lines.push("", "**Next steps:**");
    for (const s of anchor.nextSteps) lines.push(`- ${s}`);
  }

  lines.push("", "---");
  return lines.join("\n");
}

/**
 * Compact Omega routing block for downstream prompts.
 *
 * The block intentionally includes only the phase manifest identity,
 * target artifact, synthesis excerpt, and stage file paths. Full ten-stage
 * bodies remain durable on disk and are referenced on demand to avoid prompt
 * context collapse.
 */
export function formatOmegaPhaseArtifactsForPrompt(
  basePath: string,
  references: readonly OmegaPhasePromptReference[],
): string | null {
  if (references.length === 0) return null;

  const blocks = references.map((ref) => formatOmegaPhaseArtifactReference(basePath, ref));
  return [
    "## Omega Phase Artifact Context",
    "",
    "Compact routing only: this prompt carries run ids, manifest paths, target paths, synthesis, and stage file paths. Full verbose Omega stage bodies are durable on disk and must be read on demand from the listed stage paths, not inlined by default.",
    "",
    ...blocks,
  ].join("\n");
}

function formatOmegaPhaseArtifactReference(basePath: string, ref: OmegaPhasePromptReference): string {
  const label = ref.label ?? `${ref.unitType} ${ref.unitId}`;
  const manifestPath = findOmegaPhaseManifestPath(basePath, ref.unitType, ref.unitId);
  if (!manifestPath) {
    const expected = join(omegaPhaseRunBaseDir(basePath, ref.unitType, ref.unitId), "<runId>", "phase-manifest.json");
    return [
      `### ${label}`,
      "",
      "**Status:** omitted — no upstream Omega phase manifest was found.",
      `**Diagnostic:** expected ${displayPath(basePath, expected)}. Do not treat this phase as Omega-governed until a native \`hammer_canonical_spiral\` run writes a valid manifest.`,
      ref.expectedTargetArtifactPath ? `**Expected target:** ${displayPath(basePath, ref.expectedTargetArtifactPath)}` : null,
      "",
    ].filter((line): line is string => line !== null).join("\n");
  }

  const validation = validatePhaseOmegaArtifacts({
    manifestPath,
    expectedUnitType: ref.unitType,
    expectedUnitId: ref.unitId,
    ...(ref.expectedTargetArtifactPath ? { expectedTargetArtifactPath: ref.expectedTargetArtifactPath } : {}),
  });

  if (!validation.ok) {
    return [
      `### ${label}`,
      "",
      "**Status:** omitted — upstream Omega phase manifest is malformed or stale.",
      `**Manifest path:** ${displayPath(basePath, manifestPath)}`,
      `**Diagnostic:** ${validation.error.validationGap ?? validation.error.remediation}`,
      `**Remediation:** ${validation.error.remediation}`,
      "",
    ].join("\n");
  }

  return formatValidOmegaPhaseManifest(basePath, label, validation.value);
}

function formatValidOmegaPhaseManifest(basePath: string, label: string, manifest: OmegaPhaseManifest): string {
  const synthesis = readSynthesisForPrompt(basePath, manifest);
  const stageLines = Object.entries(manifest.stageFilePaths)
    .sort(([, a], [, b]) => a.localeCompare(b))
    .map(([stage, path]) => `  - ${stage}: \`${displayPath(basePath, path)}\``);

  return [
    `### ${label}`,
    "",
    `- **Status:** ${manifest.status}`,
    `- **Run ID:** \`${manifest.runId}\``,
    `- **Manifest path:** \`${displayPath(basePath, manifest.manifestPath)}\``,
    `- **Run manifest path:** \`${displayPath(basePath, manifest.runManifestPath)}\``,
    `- **Target artifact path:** \`${displayPath(basePath, manifest.targetArtifactPath)}\``,
    `- **Synthesis path:** ${manifest.synthesisPath ? `\`${displayPath(basePath, manifest.synthesisPath)}\`` : "_(missing)_"}`,
    `- **Stage count:** ${manifest.stageCount}`,
    "- **Stage file paths (on demand; bodies not inlined):**",
    ...stageLines,
    "",
    "#### Synthesis",
    synthesis,
    "",
  ].join("\n");
}

function findOmegaPhaseManifestPath(basePath: string, unitType: OmegaPhaseUnitType, unitId: string): string | null {
  try {
    const row = getOmegaPhaseArtifact(unitType, unitId);
    if (row?.manifestPath) return row.manifestPath;
  } catch {
    // DB mapping is optional for prompt construction; fall back to filesystem scan.
  }

  const unitDir = omegaPhaseRunBaseDir(basePath, unitType, unitId);
  if (!existsSync(unitDir)) return null;
  try {
    const candidates = readdirSync(unitDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(unitDir, entry.name, "phase-manifest.json"))
      .filter((candidate) => existsSync(candidate));
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      try {
        return statSync(b).mtimeMs - statSync(a).mtimeMs;
      } catch {
        return b.localeCompare(a);
      }
    });
    return candidates[0] ?? null;
  } catch {
    return null;
  }
}

function readSynthesisForPrompt(basePath: string, manifest: OmegaPhaseManifest): string {
  if (!manifest.synthesisPath) return "_(missing synthesis path — rerun the governed phase)_";
  try {
    const content = readFileSync(manifest.synthesisPath, "utf-8").trim();
    if (content.length <= SYNTHESIS_PROMPT_CHAR_LIMIT) return content;
    return `${content.slice(0, SYNTHESIS_PROMPT_CHAR_LIMIT)}\n\n… (truncated — read \`${displayPath(basePath, manifest.synthesisPath)}\` for the full synthesis)`;
  } catch (error) {
    return `_(unable to read synthesis ${displayPath(basePath, manifest.synthesisPath)}: ${error instanceof Error ? error.message : String(error)})_`;
  }
}

function displayPath(basePath: string, path: string): string {
  const rel = relative(basePath, path);
  if (rel && !rel.startsWith("..") && rel !== ".") return rel;
  return path;
}

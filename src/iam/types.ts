/**
 * src/iam/types.ts
 *
 * Foundational TypeScript types for the IAM awareness kernel.
 * Pure type exports only — zero runtime logic, zero imports from src/iam/
 * or the extension tree.
 */

// ---------------------------------------------------------------------------
// Omega Protocol — ten-stage names
// ---------------------------------------------------------------------------

export type OmegaStageName =
  | "materiality"
  | "vitality"
  | "interiority"
  | "criticality"
  | "connectivity"
  | "lucidity"
  | "necessity"
  | "reciprocity"
  | "totality"
  | "continuity";

// ---------------------------------------------------------------------------
// Omega Protocol — rune symbol names for the ten stages (URUZ → JERA)
// Distinct from the twelve governance RuneNames below.
// ---------------------------------------------------------------------------

export type OmegaRuneName =
  | "URUZ"
  | "THURISAZ"
  | "ANSUZ"
  | "RAIDHO"
  | "KENAZ"
  | "GEBO"
  | "WUNJO"
  | "HAGALAZ"
  | "NAUDHIZ"
  | "JERA";

// ---------------------------------------------------------------------------
// Omega Protocol — stage descriptor
// ---------------------------------------------------------------------------

export interface OmegaStage {
  stageName: OmegaStageName;
  stageNumber: number;
  runeName: string;
  archetypeName: string;
  phaseLabel: string;
  archetypePromptTemplate: string;
}

// ---------------------------------------------------------------------------
// Omega Protocol — result of a single completed stage
// ---------------------------------------------------------------------------

export interface OmegaStageResult {
  stage: OmegaStage;
  prompt: string;
  response: string;
  completedAt: string;
}

// ---------------------------------------------------------------------------
// Omega Protocol — persona lens applied during a run
// ---------------------------------------------------------------------------

export type OmegaPersona = "poet" | "engineer" | "skeptic" | "child";

// ---------------------------------------------------------------------------
// Governance rune names (twelve canonical obligations)
// ---------------------------------------------------------------------------

export type RuneName =
  | "RIGOR"
  | "HUMAN"
  | "FORGE"
  | "IMAGINATION"
  | "RISK"
  | "STEWARDSHIP"
  | "MEANING"
  | "CLARITY"
  | "INSIGHT"
  | "GROUNDING"
  | "CONVERGENCE"
  | "PRAXIS";

// ---------------------------------------------------------------------------
// Omega Protocol — full run record
// ---------------------------------------------------------------------------

export interface OmegaRun {
  id: string;
  query: string;
  persona?: OmegaPersona;
  runes: RuneName[];
  stages: OmegaStageName[];
  stageResults: OmegaStageResult[];
  status: "running" | "complete" | "failed";
  synthesis?: string;
  createdAt: string;
  completedAt?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Omega Protocol — persisted artifact (run + filesystem location)
// ---------------------------------------------------------------------------

export type OmegaArtifact = OmegaRun & { artifactDir: string };

// ---------------------------------------------------------------------------
// Governance rune contract
// ---------------------------------------------------------------------------

export interface RuneContract {
  runeName: RuneName;
  obligation: string;
  primaryArtifact: string;
  requiredSections: string[];
  minimumBar: string;
  exitCriteria: string;
}

// ---------------------------------------------------------------------------
// SAVESUCCESS — positional pillar encoding (white paper)
// s  = Subject clarity
// a  = Audience alignment
// v  = Value articulation
// e  = Evidence grounding
// s2 = Structural coherence
// u  = Utility focus
// c  = Contextual awareness
// c2 = Critical self-assessment
// e2 = Engagement design
// s3 = Synthesis quality
// ---------------------------------------------------------------------------

export type SavesuccessPillar =
  | "s"
  | "a"
  | "v"
  | "e"
  | "s2"
  | "u"
  | "c"
  | "c2"
  | "e2"
  | "s3";

export type SavesuccessScorecard = Record<SavesuccessPillar, number>;

export interface SavesuccessResult {
  scorecard: SavesuccessScorecard;
  blindSpots: SavesuccessPillar[];
  success: boolean;
  validatedAt: string;
}

// ---------------------------------------------------------------------------
// Structured IAM error shape
// ---------------------------------------------------------------------------

export interface IAMError {
  iamErrorKind:
    | "omega-stage-failed"
    | "rune-validation-failed"
    | "savesuccess-blind-spot"
    | "persistence-failed"
    | "invalid-stage-sequence"
    | "unknown-rune"
    | "executor-not-wired";
  stage?: OmegaStageName;
  runeName?: RuneName;
  target?: string;
  persistenceStatus?: "not-attempted" | "partial" | "complete";
  validationGap?: string;
  remediation: string;
  cause?: unknown;
}

// ---------------------------------------------------------------------------
// Result monad — all IAM operations return this
// ---------------------------------------------------------------------------

export type IAMResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: IAMError };

// ---------------------------------------------------------------------------
// Provider-agnostic LLM executor callback
// ---------------------------------------------------------------------------

export type OmegaExecutor = (prompt: string) => Promise<string>;

// ---------------------------------------------------------------------------
// Omega run configuration (input to the engine)
// ---------------------------------------------------------------------------

export interface OmegaRunConfig {
  query: string;
  executor: OmegaExecutor;
  persona?: OmegaPersona;
  runes?: RuneName[];
  stages?: OmegaStageName[];
}

// ---------------------------------------------------------------------------
// IAM public tool layer — pure executor contracts
// ---------------------------------------------------------------------------

export interface GraphNode {
  id: string;
  category: string;
  content: string;
  confidence: number;
}

export interface GraphEdge {
  fromId: string;
  toId: string;
  relation: string;
}

export type IAMToolOutput =
  | { kind: "memory-list"; memories: Array<{ id: string; content: string; score: number; category: string }> }
  | { kind: "memory-created"; id: string; content: string; category: string }
  | { kind: "rune-contract"; rune: RuneContract }
  | { kind: "rune-list"; runes: RuneContract[] }
  | { kind: "savesuccess-report"; scorecard: SavesuccessScorecard; report: string; success: boolean }
  | { kind: "knowledge-map"; categories: Record<string, number>; total: number }
  | { kind: "graph-walk"; nodes: GraphNode[]; edges: GraphEdge[] }
  | { kind: "check-result"; tools: string[]; kernelVersion: string; dbAvailable: boolean }
  | { kind: "spiral-deferred"; reason: string; guidance: string };

export interface IAMToolAdapters {
  queryMemories: (query: string, k?: number, category?: string) => Array<{ id: string; content: string; score: number; category: string }>;
  getActiveMemories: (limit?: number) => Array<{ id: string; content: string; confidence: number; category: string }>;
  createMemory: (fields: { category: string; content: string; confidence?: number; source_unit_type?: string; structuredFields?: Record<string, unknown> | null }) => string | null;
  traverseGraph: (startId: string, depth?: number) => { nodes: Array<{ id: string; category: string; content: string; confidence: number }>; edges: Array<{ fromId: string; toId: string; relation: string }> };
  isDbAvailable: () => boolean;
}

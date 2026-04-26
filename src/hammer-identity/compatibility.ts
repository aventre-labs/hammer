export type HammerLegacyCompatibilityCategory =
  | "legacy-alias"
  | "bootstrap-migration"
  | "historical-docs"
  | "internal-implementation-path"
  | "downstream-follow-up";

export interface HammerLegacyCompatibilityCategoryDetails {
  readonly label: string;
  readonly description: string;
}

export interface HammerIdentityCompatibilityRule {
  readonly id: string;
  readonly category: HammerLegacyCompatibilityCategory;
  readonly description: string;
  readonly pathPattern: string;
  readonly linePattern: string;
  readonly rationale: string;
  readonly allowedUntil: string;
  readonly examples: readonly string[];
}

export const HAMMER_LEGACY_COMPATIBILITY_CATEGORIES = {
  "legacy-alias": {
    label: "Legacy alias",
    description:
      "Explicit backwards-compatible command, env var, state path, or tool aliases that remain accepted while Hammer is canonical.",
  },
  "bootstrap-migration": {
    label: "Bootstrap migration",
    description:
      "Startup and state bootstrap code that may read or import old GSD state before writing canonical Hammer state.",
  },
  "historical-docs": {
    label: "Historical docs",
    description:
      "Archived or migration-oriented prose that names the old product identity as history rather than current UI.",
  },
  "internal-implementation-path": {
    label: "Internal implementation path",
    description:
      "Repository-internal paths or private runtime wiring that still contain legacy directory names while the substrate is renamed.",
  },
  "downstream-follow-up": {
    label: "Downstream follow-up",
    description:
      "Deliberately marked IAM, prompt, workflow, or package-surface references owned by later S01 tasks.",
  },
} as const satisfies Record<HammerLegacyCompatibilityCategory, HammerLegacyCompatibilityCategoryDetails>;

const LEGACY_TOKEN_PATTERN = String.raw`(?:Get Shit Done|GSD_[A-Z0-9_]+|gsd_[A-Za-z0-9_]+|\.gsd(?:-id)?|/gsd\b|@gsd(?:[-/][A-Za-z0-9_.-]+)?|gsd(?:-[A-Za-z0-9_.-]+)?\b|GSD\b)`;

export const HAMMER_LEGACY_COMPATIBILITY_RULES = [
  {
    id: "identity-contract-self-reference",
    category: "internal-implementation-path",
    description: "The identity contract and scanner map may name legacy GSD spellings so they can be detected and classified.",
    pathPattern: String.raw`(?:^|/)src/hammer-identity/(?:index|compatibility)\.ts$|(?:^|/)scripts/check-hammer-identity\.mjs$|(?:^|/)src/tests/hammer-identity-[^/]+\.test\.ts$`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "The scanner cannot guard against old names unless the contract enumerates them. This allowance is constrained to the contract, scanner, and their tests.",
    allowedUntil: "Permanent source-of-truth exception.",
    examples: ["const LEGACY_TOKEN_PATTERN = ...", "assert.match(report, /GSD/)"] as const,
  },
  {
    id: "package-manifest-internal-scopes",
    category: "internal-implementation-path",
    description: "Entries for @gsd-build/* and @gsd/* npm scopes are internal workspace/native package names, not user-visible product identity.",
    pathPattern: String.raw`.*`,
    linePattern: String.raw`(?:@gsd-build|@gsd(?:[-/]|['"]))`,
    rationale:
      "The @gsd-build and @gsd npm scopes are internal build tooling and workspace package identifiers. Renaming npm scope names requires coordinated publish changes and is tracked as downstream work.",
    allowedUntil: "Remove once the internal workspace package scopes are migrated to @hammer-build/.",
    examples: ['"@gsd-build/engine-darwin-arm64": ">=2.10.2"', '"@gsd/pi-coding-agent": "*"', "join(gsdNodeModules, '@gsd')"] as const,
  },
  {
    id: "package-manifest-legacy-bin-aliases",
    category: "legacy-alias",
    description: "Legacy gsd/gsd-cli/gsd-pi bin entries in package manifests kept as backwards-compatible command aliases.",
    pathPattern: String.raw`(?:^|/)package(?:-lock)?\.json$`,
    linePattern: String.raw`"(?:gsd|gsd-cli|gsd-pi|gsd-daemon|gsd-mcp-server)"\s*:`,
    rationale:
      "Users who installed gsd-pi previously still have gsd/gsd-cli on PATH. These bin entries keep those names working while hammer/hammer-cli become canonical.",
    allowedUntil: "Remove in a future major version once gsd binary has been sunset.",
    examples: ['"gsd": "dist/loader.js"', '"gsd-cli": "dist/loader.js"'] as const,
  },
  {
    id: "explicit-legacy-alias-marker",
    category: "legacy-alias",
    description: "Lines that explicitly mark an old GSD spelling as a legacy alias or compatibility shim.",
    pathPattern: String.raw`.*`,
    linePattern: String.raw`(?:(?:alias|compat(?:ible|ibility)?|deprecated|backward[- ]compatible).{0,120}${LEGACY_TOKEN_PATTERN}|${LEGACY_TOKEN_PATTERN}.{0,120}(?:alias|compat(?:ible|ibility)?|deprecated|backward[- ]compatible))`,
    rationale:
      "Aliases must be deliberate and locally documented; bare visible product strings should stay unclassified so the scanner catches regressions.",
    allowedUntil: "Remove when legacy command/env/state aliases are retired.",
    examples: ["const alias = \"/gsd\"; // legacy alias for /hammer"] as const,
  },
  {
    id: "internal-workspace-config-field",
    category: "internal-implementation-path",
    description: "The `gsd.linkable`, `gsd.scope`, `gsd.name` fields are internal workspace package configuration keys, not user-visible product identity.",
    pathPattern: String.raw`.*`,
    linePattern: String.raw`(?:\bpkg\.gsd\b|gsd\.linkable|gsd\.scope\b|gsd\.name\b|const gsd = pkg\.gsd|if \(!gsd\b)`,
    rationale:
      "These are private npm workspace config fields used by link-workspace-packages.cjs and loader.ts. They are not visible in help, CLI output, or package public surface.",
    allowedUntil: "Remove when workspace package.json config fields are migrated to a hammer.* key.",
    examples: ["const gsd = pkg.gsd", "if (!gsd || gsd.linkable !== true) continue"] as const,
  },
  {
    id: "internal-test-env-var",
    category: "internal-implementation-path",
    description: "GSD_LIVE_TESTS and similar test-only env vars used in package.json scripts are internal test harness toggles, not user-facing product identity.",
    pathPattern: String.raw`(?:^|/)package(?:-lock)?\.json$`,
    linePattern: String.raw`GSD_(?:LIVE_TESTS|TEST_[A-Z_]+)`,
    rationale:
      "Test environment variables are internal harness knobs that happen to carry the GSD prefix. They never appear in user-visible output or help text.",
    allowedUntil: "Rename when the test harness env vars are migrated to HAMMER_TEST_* naming.",
    examples: ['"test:live": "node scripts/with-env.mjs GSD_LIVE_TESTS=1 -- ..."'] as const,
  },
  {
    id: "bootstrap-state-migration",
    category: "bootstrap-migration",
    description: "Startup/bootstrap code may mention old state locations or env vars while importing existing local state into Hammer paths.",
    pathPattern: String.raw`(?:^|/)src/(?:loader|cli|app-paths|resource-loader|init-resources|project-state|preferences|config|rtk|bundled-extension-paths|extension-discovery|extension-registry)\.ts$|(?:^|/)src/resources/extensions/gsd/bootstrap/`,
    linePattern: String.raw`(?:(?:bootstrap|migrat|fallback|import|upgrade|first launch|state|home|agent|session|artifact).{0,120}${LEGACY_TOKEN_PATTERN}|${LEGACY_TOKEN_PATTERN}.{0,120}(?:bootstrap|migrat|fallback|import|upgrade|first launch|state|home|agent|session|artifact))`,
    rationale:
      "Existing installations need a bounded bridge from old state into canonical Hammer state without making GSD product language visible.",
    allowedUntil: "After state migration has shipped and telemetry shows old state imports are no longer needed.",
    examples: ["// migrate legacy .gsd state into .hammer on first launch"] as const,
  },
  {
    id: "state-namespace-bridge",
    category: "bootstrap-migration",
    description: "Path resolvers and repo-identity functions that bridge legacy .gsd paths to canonical .hammer paths during the state namespace cutover.",
    pathPattern: String.raw`(?:^|/)src/(?:app-paths|resources/extensions/gsd/(?:paths|repo-identity|detection|gitignore|migrate-external))\.ts$`,
    linePattern: String.raw`(?:(?:legacy|compat|bridge|fallback|migrat|import|probe|detect|exist|symlink|ext(?:ernal)?|worktree|recovery|marker|cleanup|collision|variant).{0,120}${LEGACY_TOKEN_PATTERN}|${LEGACY_TOKEN_PATTERN}.{0,120}(?:legacy|compat|bridge|fallback|migrat|import|probe|detect|exist|symlink|ext(?:ernal)?|worktree|recovery|marker|cleanup|collision|variant))`,
    rationale:
      "The state path layer must retain explicit .gsd detection and bridge functions while new projects use .hammer. Each occurrence in these files is a deliberate compatibility bridge, not an unclassified regression.",
    allowedUntil: "Remove once .gsd import support is fully retired and all users have migrated to .hammer.",
    examples: ["const legacyGsdPath = join(basePath, '.gsd'); // legacy import bridge — state-namespace-bridge"] as const,
  },
  {
    id: "gitignore-baseline-legacy-patterns",
    category: "bootstrap-migration",
    description: "The gitignore baseline array and runtime patterns array include .gsd entries to maintain backwards compatibility for projects that still have .gsd state.",
    pathPattern: String.raw`(?:^|/)src/resources/extensions/gsd/gitignore\.ts$`,
    linePattern: String.raw`\.gsd`,
    rationale:
      "Projects that haven't migrated from .gsd to .hammer still need their .gsd state directory ignored by git. The array also contains new .hammer entries; the .gsd entries are explicit legacy bridge items.",
    allowedUntil: "Remove .gsd entries from baseline once all users have migrated to .hammer.",
    examples: ['"  .gsd", // legacy import bridge — gitignore-baseline-legacy-patterns'] as const,
  },
  {
    id: "state-internal-type-names",
    category: "internal-implementation-path",
    description: "Internal TypeScript type names, constant names, section headers, and inline doc comments in the state path layer that carry legacy GSD naming.",
    pathPattern: String.raw`(?:^|/)src/resources/extensions/gsd/(?:paths|detection|repo-identity|migrate-external|gitignore)\.ts$`,
    linePattern: String.raw`(?:GSD_ROOT_FILES|GSDRootFileKey|LEGACY_GSD_ROOT_FILES|GSD_RUNTIME_PATTERNS|GSD_NUMBERED_VARIANT_RE|v2-gsd|v2-gsd-empty|V2 GSD|GSD Detection|GSD External State|GSD Paths|GSD bootstrappers|GSD Root Discovery|gsd\.db|first time GSD|\.gsd\/milestones|\.gsd\/ tree|\.gsd\/ path|paths under \.gsd|project root|canonical \.gsd|project's \.gsd|~/\.gsd\/|GSD_HOME is used|GSD_PROJECT_ID is used|back-fill|numbered|digit)`,
    rationale:
      "These are internal TypeScript identifiers, section headers, and inline doc-comments describing the bridge behavior. None are user-visible product strings.",
    allowedUntil: "Rename when downstream callers are migrated to hammer-prefixed type names.",
    examples: ["export const GSD_ROOT_FILES = {", "state: 'v2-gsd'"] as const,
  },
  {
    id: "migrate-external-legacy-bridge",
    category: "bootstrap-migration",
    description: "The migrate-external.ts module explicitly migrates legacy .gsd real directories to the external state store. All .gsd references in this file are intentional migration logic.",
    pathPattern: String.raw`(?:^|/)src/resources/extensions/gsd/migrate-external\.ts$`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "This module exists specifically to migrate old .gsd state. Every .gsd reference is a deliberate migration-phase bridge; there is no user-visible product identity here.",
    allowedUntil: "Remove once .gsd-to-.hammer migration is complete and the module is retired.",
    examples: ["const localGsd = join(basePath, '.gsd'); // migration target — migrate-external-legacy-bridge"] as const,
  },
  {
    id: "historical-or-migration-docs",
    category: "historical-docs",
    description: "Historical or migration documents may name the former product identity when clearly presented as history.",
    pathPattern: String.raw`(?:^|/)(?:CHANGELOG(?:\.md)?|docs/(?:history|migration|archive|legacy)[^/]*|pkg/docs/(?:history|migration|archive|legacy)[^/]*)`,
    linePattern: String.raw`(?:(?:histor(?:y|ical)|formerly|legacy|migration|migrated|renamed|archive).{0,120}${LEGACY_TOKEN_PATTERN}|${LEGACY_TOKEN_PATTERN}.{0,120}(?:histor(?:y|ical)|formerly|legacy|migration|migrated|renamed|archive))`,
    rationale:
      "Historical context is useful, but current help and runtime docs must use Hammer language unless they are explicitly migration-oriented.",
    allowedUntil: "Permanent for archive/migration docs only.",
    examples: ["Historically this command was named /gsd before the Hammer rename."] as const,
  },
  {
    id: "private-extension-path-reference",
    category: "internal-implementation-path",
    description: "Private repository/runtime path references may contain the existing extension directory name until that tree is physically renamed.",
    pathPattern: String.raw`.*`,
    linePattern: String.raw`(?:src/)?resources/extensions/gsd(?:/|\b)|(?:^|["'\x60])(?:\.?/)?\.gsd/(?:agent|sessions|milestones|journal|activity|workflow-defs|preferences|captures|backlog|reports|gsd\.db)|GSD_(?:WORKFLOW_PATH|BUNDLED_EXTENSION_PATHS|PKG_ROOT|CODING_AGENT_DIR|BIN_PATH|VERSION|FIRST_RUN_BANNER|RTK_DISABLED(?:_ENV)?|SKIP_RTK_INSTALL|RTK_PATH)\b|GSD-WORKFLOW\.md\b|GSD_RTK_DISABLED\b|(?:the\s+)?gsd\s+(?:extension|workflow)\b`,
    rationale:
      "These strings are implementation addresses or private process wiring, not user-facing product identity. Public commands and help remain out of scope for this rule.",
    allowedUntil: "Remove each path/env allowance as the implementation tree is renamed.",
    examples: ["const entry = \"src/resources/extensions/gsd/index.ts\""] as const,
  },
  {
    id: "extension-command-legacy-registration",
    category: "legacy-alias",
    description: "The commands/index.ts module exports registerGSDCommand, registerGSDLegacyAlias, GSD_COMMAND_DESCRIPTION, and getGsdArgumentCompletions as explicit legacy shims so callers using the old API continue to compile. catalog.ts reads GSD_HOME as a legacy fallback and probes .gsd paths during workflow completion.",
    pathPattern: String.raw`(?:^|/)src/resources/extensions/gsd/(?:index|commands/index|commands/catalog|commands/dispatcher)\.ts$`,
    linePattern: String.raw`(?:(?:registerGSD|GSD_COMMAND|getGsd|legacyAlias|viaLegacy|legacy alias|legacy fallback|deprecated|handleGSDCommand|/gsd\b|fallback|state-namespace-bridge|bootstrap-migration).{0,120}|.{0,120}(?:registerGSD|GSD_COMMAND|getGsd|legacyAlias|viaLegacy|legacy alias|legacy fallback|deprecated|handleGSDCommand|/gsd\b|fallback|state-namespace-bridge|bootstrap-migration))`,
    rationale:
      "The extension's commands/index.ts must keep registerGSDCommand and related exports for any callers that reference the old API. dispatcher.ts accepts a viaLegacyAlias flag and surfaces the canonical /hammer path in diagnostics. catalog.ts retains GSD_HOME and .gsd path probes as explicit state-namespace bridges for existing installations. These are deliberate, documented shims — not unclassified regressions.",
    allowedUntil: "Remove when all callers are updated to registerHammerCommand and the /gsd alias, GSD_HOME fallback, and .gsd path probes are retired.",
    examples: ["export function registerGSDCommand(pi: ExtensionAPI): void { // legacy alias for compatibility", "const gsdHome = process.env.HAMMER_HOME || process.env.GSD_HOME || ... // legacy alias for compatibility — bootstrap-migration"] as const,
  },
  {
    id: "extension-manifest-gsd-id",
    category: "internal-implementation-path",
    description: "The extension directory is physically still named 'gsd' and the previous manifest id 'gsd' may appear in bootstrap code that references this package.json path before the directory is renamed.",
    pathPattern: String.raw`(?:^|/)src/resources/extensions/gsd/(?:extension-manifest\.json|package\.json)$`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "The extension directory retains the 'gsd' name until a physical rename is planned; the manifest and package.json files live inside that directory. Any gsd token in these files is a directory-path artifact, not a user-visible identity regression.",
    allowedUntil: "Remove once the extensions/gsd directory is renamed to extensions/hammer.",
    examples: ['"pi-extension-gsd"'] as const,
  },
  {
    id: "tool-registration-legacy-alias-shims",
    category: "legacy-alias",
    description: "Bootstrap tool registration files that explicitly register gsd_* as legacy aliases for hammer_* canonical tools, including alias call arguments, section headers, internal log labels, and promptGuideline/description lines that explain the alias relationship.",
    pathPattern: String.raw`(?:^|/)src/resources/extensions/gsd/bootstrap/(?:db-tools|memory-tools|query-tools|exec-tools|journal-tools)\.ts$`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "All gsd_* tokens in these files are explicit legacy alias registrations (alias call arguments), section headers documenting the alias mapping, or internal telemetry labels. The canonical tool names are all hammer_*, and gsd_* is registered via registerAlias() as a backwards-compatibility shim. The .gsd/ path strings in descriptions refer to the actual state directory that still uses this name pending the state namespace rename.",
    allowedUntil: "Remove when gsd_* alias registrations are retired and these bootstrap files contain only hammer_* names.",
    examples: ["registerAlias(pi, decisionSaveTool, \"gsd_decision_save\", \"hammer_decision_save\"); // legacy alias for compatibility — legacy-alias"] as const,
  },
  {
    id: "headless-legacy-command-bridge",
    category: "legacy-alias",
    description: "headless.ts, headless-context.ts, headless-query.ts, and headless-ui.ts retain explicit /gsd fallback references, .gsd/ bootstrap bridges, GSD_AGENT_DIR/GSD_BIN_PATH/GSD_HEADLESS env var aliases, GSDState type import, gsd_* tool prefix detection, and gsd-headless client-id as documented legacy compatibility shims.",
    pathPattern: String.raw`(?:^|/)src/headless(?:-context|-events|-query|-ui|-[a-z]+)?\.ts$`,
    linePattern: String.raw`(?:(?:legacy|compat|bridge|fallback|alias|bootstrap|migration|private-extension-path-reference).{0,120}${LEGACY_TOKEN_PATTERN}|${LEGACY_TOKEN_PATTERN}.{0,120}(?:legacy|compat|bridge|fallback|alias|bootstrap|migration|private-extension-path-reference)|GSD_BIN_PATH|GSD_HEADLESS|GSD_AGENT_DIR|gsd-headless|GSDState|gsd_|\.gsd)`,
    rationale:
      "The headless orchestrator retains .gsd/ detection, GSD_BIN_PATH, GSD_HEADLESS, GSD_AGENT_DIR, GSDState type import, gsd_* prefix detection in headless-ui.ts, and gsd-headless client-id as explicit bootstrap-migration and legacy-alias bridges. Every occurrence is annotated inline with its bridge category.",
    allowedUntil: "Remove when GSD_BIN_PATH, GSD_HEADLESS, GSD_AGENT_DIR, GSDState, gsd-headless, and .gsd/ bootstrap bridges are retired.",
    examples: ["const cliPath = process.env.HAMMER_BIN_PATH || process.env.GSD_BIN_PATH || ... // GSD_BIN_PATH is a legacy alias — bootstrap-migration"] as const,
  },
  {
    id: "browser-dispatch-legacy-gsd-alias",
    category: "legacy-alias",
    description: "browser-slash-command-dispatch.ts and command-surface-contract.ts retain /gsd dispatch, gsd-* surface names, and GSD_HELP_TEXT as explicit documented legacy aliases for the canonical /hammer path.",
    pathPattern: String.raw`(?:^|/)web/lib/(?:browser-slash-command-dispatch|command-surface-contract)\.ts$`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "The browser dispatch layer exposes /gsd as a legacy alias for /hammer. The gsd-* surface names remain until S02 renames the extension surfaces. Every occurrence is annotated inline as a legacy alias.",
    allowedUntil: "Remove when /gsd legacy alias and gsd-* surface names are retired in the browser dispatch layer.",
    examples: ["// GSD subcommand dispatch — legacy alias for /hammer — legacy-alias"] as const,
  },
  {
    id: "marked-downstream-follow-up",
    category: "downstream-follow-up",
    description: "Explicit TODO/FIXME notes for IAM, prompt, workflow, or package rename tasks planned later in S01.",
    pathPattern: String.raw`.*`,
    linePattern: String.raw`(?:(?:TODO|FIXME|follow-up|downstream).{0,160}(?:IAM|prompt|workflow|package).{0,160}${LEGACY_TOKEN_PATTERN}|${LEGACY_TOKEN_PATTERN}.{0,160}(?:TODO|FIXME|follow-up|downstream).{0,160}(?:IAM|prompt|workflow|package))`,
    rationale:
      "Downstream tasks need a temporary, searchable handoff marker, but the line must say why it is deferred.",
    allowedUntil: "End of the S01 slice.",
    examples: ["// TODO(S01 prompt follow-up): replace GSD wording in prompt fixtures"] as const,
  },
  {
    id: "mcp-server-legacy-tool-aliases",
    category: "legacy-alias",
    description: "The MCP server registers gsd_* tool names as explicit legacy aliases for hammer_* canonical tools in server.ts and workflow-tools.ts, including WORKFLOW_TOOL_NAMES array entries and tool() registration call arguments.",
    pathPattern: String.raw`(?:^|/)packages/mcp-server/src/(?:server|workflow-tools)\.ts$`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "All gsd_* tokens in server.ts and workflow-tools.ts are either: (a) legacy alias tool registrations annotated with 'legacy alias' descriptions, (b) WORKFLOW_TOOL_NAMES array entries that preserve backwards-compatible tool name constants, or (c) parameter schema strings like 'gsd_execute' in session ID descriptions. Every occurrence is a deliberate compatibility shim.",
    allowedUntil: "Remove when legacy MCP clients have migrated to hammer_* tool names.",
    examples: ["// gsd_execute — legacy alias for hammer_execute for existing MCP clients.", '"gsd_decision_save"'] as const,
  },
  {
    id: "mcp-server-state-path-bridge",
    category: "bootstrap-migration",
    description: "The MCP server's paths.ts resolves .gsd/ as a fallback for projects that haven't migrated to .hammer/. workflow-tools.ts reads GSD_* env vars as legacy fallbacks. validateProjectDir uses .gsd worktree paths for auto-worktree external state layout.",
    pathPattern: String.raw`(?:^|/)packages/mcp-server/src/(?:readers/paths|workflow-tools|server)\.ts$`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "The MCP state reader probes .hammer first and falls back to .gsd for legacy installations. The env var aliases and worktree .gsd path computations are backwards-compatible bridges for existing projects and tool configurations.",
    allowedUntil: "Remove .gsd fallbacks and GSD_* env var aliases once all installations have migrated to .hammer and HAMMER_* env vars.",
    examples: ["const directGsd = join(resolved, '.gsd'); // legacy fallback — bootstrap-migration"] as const,
  },
  {
    id: "mcp-server-package-bin-alias",
    category: "legacy-alias",
    description: "The MCP server package.json keeps gsd-mcp-server bin alias for existing clients that launch the server by that name.",
    pathPattern: String.raw`(?:^|/)packages/mcp-server/package\.json$`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "The bin entry gsd-mcp-server is retained as a backwards-compatible alias alongside the canonical hammer-mcp-server. Existing MCP client configurations reference gsd-mcp-server by name.",
    allowedUntil: "Remove when all MCP client configurations have been migrated to hammer-mcp-server.",
    examples: ['"gsd-mcp-server": "./dist/cli.js"'] as const,
  },
] as const satisfies readonly HammerIdentityCompatibilityRule[];

export type HammerIdentityCompatibilityRuleId = typeof HAMMER_LEGACY_COMPATIBILITY_RULES[number]["id"];

export function getHammerCompatibilityRuleIdsByCategory(
  category: HammerLegacyCompatibilityCategory,
): HammerIdentityCompatibilityRuleId[] {
  return HAMMER_LEGACY_COMPATIBILITY_RULES
    .filter((rule) => rule.category === category)
    .map((rule) => rule.id);
}

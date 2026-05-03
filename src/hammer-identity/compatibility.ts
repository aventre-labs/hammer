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
  /**
   * Optional regex pattern that must match the FILE BODY (not just the matched line)
   * for this rule to claim a finding. When set, the scanner reads the surrounding
   * file content and rejects the rule match if the marker is absent — letting the
   * line fall through to subsequent rules or unclassified-visible-gsd.
   *
   * Used by S08 T06 to graduate doc-rebrand rules from "absorb everything" to
   * "absorb only when the file actually carries Hammer identity (\\bHammer\\b)".
   */
  readonly requiresFileMarker?: string;
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
    pathPattern: String.raw`(?:^|/)src/hammer-identity/(?:index|compatibility)\.ts$|(?:^|/)scripts/check-hammer-identity\.mjs$|(?:^|/)src/tests/hammer-[^/]+\.test\.ts$|(?:^|/)src/hammer-identity/__tests__/[^/]+\.test\.ts$`,
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
    pathPattern: String.raw`(?:^|/)src/resources/extensions/gsd/bootstrap/(?:db-tools|memory-tools|query-tools|exec-tools|journal-tools|iam-tools)\.ts$`,
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
  {
    id: "shortcut-defs-internal-type-names",
    category: "internal-implementation-path",
    description: "Internal TypeScript constant GSD_SHORTCUTS and type GSDShortcutId in shortcut-defs.ts are private type names for the keyboard shortcut registry, not user-visible product identity.",
    pathPattern: String.raw`(?:^|/)src/resources/extensions/gsd/(?:shortcut-defs|bootstrap/register-shortcuts)\.ts$`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "GSD_SHORTCUTS and GSDShortcutId are internal TypeScript identifiers that exist solely as the in-memory shortcut registry. The user-visible action labels and command strings in GSD_SHORTCUTS already say 'Hammer' and '/hammer'. Renaming the identifier is deferred until the extension directory itself is renamed.",
    allowedUntil: "Rename when the extensions/gsd directory is renamed to extensions/hammer.",
    examples: ["export const GSD_SHORTCUTS: Record<GSDShortcutId, GSDShortcutDef> = {"] as const,
  },
  {
    id: "installer-legacy-package-alias",
    category: "legacy-alias",
    description: "The installer script (scripts/install.js) documents that it is also invoked as npx gsd-pi for backwards compatibility, and retains gsd-pi-installer User-Agent header for tracking.",
    pathPattern: String.raw`(?:^|/)scripts/install\.js$`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "The gsd-pi npm package is a legacy alias for hammer-pi. The installer documents this and keeps the User-Agent string consistent with existing npm audit logs. These strings are not user-visible in normal output.",
    allowedUntil: "Remove when the gsd-pi package alias is sunset.",
    examples: ["npx gsd-pi (legacy alias for compatibility — legacy-alias)"] as const,
  },
  {
    id: "installer-bootstrap-state-path",
    category: "bootstrap-migration",
    description: "The installer script reads HAMMER_HOME with GSD_HOME as a legacy fallback to locate the managed binary directory.",
    pathPattern: String.raw`(?:^|/)scripts/install\.js$`,
    linePattern: String.raw`GSD_HOME`,
    rationale:
      "GSD_HOME is a legacy alias for HAMMER_HOME used in prior installations. The installer falls back to it when HAMMER_HOME is unset, and to ~/.hammer as the canonical creation default.",
    allowedUntil: "Remove GSD_HOME fallback once all installations have been migrated to HAMMER_HOME.",
    examples: ["process.env.HAMMER_HOME || process.env.GSD_HOME || join(homedir(), '.hammer')"] as const,
  },
  {
    id: "extension-test-suite-internal",
    category: "internal-implementation-path",
    description: "Test files inside src/resources/extensions/gsd/tests/ exercise the implementation layer and reference internal .gsd state paths, GSD env var names, gsd_* tool prefixes, and gsd-* type strings that are deliberate internal test contracts.",
    pathPattern: String.raw`(?:^|/)src/resources/extensions/gsd/tests/`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "These tests validate that backwards-compatible .gsd fallbacks, GSD_* env var aliases, and gsd_* tool shims continue to work. Every GSD reference in these test files is either testing a compatibility bridge or using an internal type name that hasn't yet been renamed. They are not user-visible product identity.",
    allowedUntil: "Update incrementally as each subsystem's compatibility bridges are retired.",
    examples: ["assert.ok(existsSync(join(tmpDir, '.gsd')), '.gsd symlink should exist')"] as const,
  },
  {
    id: "extension-source-internal-impl",
    category: "internal-implementation-path",
    description: "Implementation-only files inside src/resources/extensions/gsd/ contain GSD references as internal identifiers, state path strings, env var fallbacks, and inline docs; prompt/workflow surfaces are intentionally excluded and must rely on narrower bridge rules.",
    pathPattern: String.raw`(?:^|/)src/resources/extensions/gsd/(?!prompts/|workflow-templates/|(?:commands-workflow-templates|workflow-templates|workflow-dispatch|custom-workflow-engine|unit-context-manifest|iam-subagent-policy)\.ts$)`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "The extensions/gsd/ tree is still the internal extension implementation, but S08-owned prompt/workflow surfaces are reachable agent/user-visible corpus and must fail closed on stale GSD-first prose. This rule excludes those surfaces so only implementation-only files get the broad directory bridge until the tree is physically renamed.",
    allowedUntil: "Update during the extensions/gsd → extensions/hammer directory rename; keep prompt/workflow surfaces governed by the dedicated S08 coverage checker.",
    examples: ["const dbPath = join(gsdRoot(), 'gsd.db')"] as const,
  },
  {
    id: "mcp-server-workflow-tools-test",
    category: "internal-implementation-path",
    description: "packages/mcp-server/src/workflow-tools.test.ts and mcp-server.test.ts exercise the server's legacy gsd_* tool aliases and internal state path bridges.",
    pathPattern: String.raw`(?:^|/)packages/mcp-server/src/(?:workflow-tools|mcp-server)\.test\.ts$`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "The MCP server tests validate that backwards-compatible gsd_* tool aliases and .gsd fallback paths still work. These are deliberate compatibility verification tests, not unclassified regressions.",
    allowedUntil: "Update when gsd_* MCP tool aliases are retired.",
    examples: ["expect(result.tools.find(t => t.name === 'gsd_execute')).toBeDefined()"] as const,
  },
  {
    id: "web-app-internal-surface",
    category: "downstream-follow-up",
    description: "The web/ app (Next.js frontend) contains gsd-* surface names, /gsd commands, GSD product strings, .gsd paths, and GSD_WEB_* env vars throughout its components, API routes, and store that are downstream work tracked separately from S01.",
    pathPattern: String.raw`(?:^|/)web/`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "The web app is a large, independently-deployable frontend that surfaces /gsd commands, gsd-* component names, GSD_WEB_* env vars, and product strings. Renaming the web surface is its own milestone work stream and is explicitly deferred from S01. All web/ references are downstream follow-up items.",
    allowedUntil: "Remove when the web app frontend identity is migrated to Hammer as a separate milestone.",
    examples: ["const base = projectLabel ? `GSD - ${projectLabel}` : 'GSD'"] as const,
  },
  {
    id: "vscode-extension-internal-surface",
    category: "downstream-follow-up",
    description: "The vscode-extension/ package uses gsd.* VSCode command IDs, GSD product strings, and @gsd/ imports throughout its extension source, which is downstream work tracked separately from S01.",
    pathPattern: String.raw`(?:^|/)vscode-extension/`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "The VS Code extension uses gsd.* as its VSCode command namespace (registered in package.json contributes.commands). Renaming requires coordinated VS Code extension publish and is explicitly downstream from S01.",
    allowedUntil: "Remove when vscode-extension identity is migrated to Hammer as a separate milestone.",
    examples: ['await vscode.commands.executeCommand("gsd.cycleThinking")'] as const,
  },
  {
    id: "docs-and-readme-downstream",
    category: "downstream-follow-up",
    description: "User-facing documentation files (README.md, docs/, gitbook/, mintlify-docs/, docs/zh-CN/) contain GSD product names, /gsd commands, and .gsd paths alongside the canonical Hammer identity. Post-S08 graduation: the rule only absorbs these files when the file body actually mentions Hammer; files that regress to GSD-only language fall through to unclassified-visible-gsd so the scanner fails closed.",
    pathPattern: String.raw`(?:^|/)(?:README\.md|docs/|gitbook/|mintlify-docs/|\.plans/)`,
    linePattern: LEGACY_TOKEN_PATTERN,
    requiresFileMarker: String.raw`\bHammer\b`,
    rationale:
      "User-facing documentation must carry Hammer identity. After S08 the four channels (docs/, docs/zh-CN/, gitbook/, mintlify-docs/) plus README.md were rewritten with explicit Hammer prose, fork-bridge notes, and Hammer-specific subsections. Graduation flips this rule from blanket downstream tolerance to a fail-closed gate: legacy GSD spellings remain classified ONLY in files that demonstrate Hammer identity. Doc regressions to pre-rebrand language now fail the scanner.",
    allowedUntil: "Permanent enforcement: rule absorbs classified-and-acceptable references only when \\bHammer\\b is present in the file body.",
    examples: ["GSD has solid API key infrastructure (in a file that elsewhere documents Hammer)"] as const,
  },
  {
    id: "github-workflows-and-ci",
    category: "downstream-follow-up",
    description: "GitHub Actions workflows (.github/workflows/) and PR/issue templates (.github/ISSUE_TEMPLATE/, .github/PULL_REQUEST_TEMPLATE.md) reference gsd-pi npm package, GSD product names, /gsd commands, and CI infrastructure names.",
    pathPattern: String.raw`(?:^|/)\.github/`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "CI/CD workflows reference the gsd-pi npm package for smoke tests, GSD container image names, and product identity in issue templates. These need coordinated updates with npm package publishing, container image naming, and GitHub settings — downstream from S01 source identity work.",
    allowedUntil: "Remove when CI/CD and GitHub project templates are migrated to Hammer.",
    examples: ['PACKAGE="gsd-pi"'] as const,
  },
  {
    id: "gitignore-and-dockerignore-patterns",
    category: "internal-implementation-path",
    description: ".gitignore and .dockerignore entries that reference .gsd paths are infrastructure-level ignore rules for the project's own state directory that still uses the legacy name.",
    pathPattern: String.raw`(?:^|/)\.(?:gitignore|dockerignore)$`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "The .gitignore must ignore .gsd/ in addition to .hammer/ while either may be present in developer environments. The .dockerignore similarly excludes .gsd/ from Docker build contexts. These are infrastructure rules, not user-visible product identity.",
    allowedUntil: "Remove .gsd entries once all developers have migrated to .hammer.",
    examples: [".gsd/", "# GSD project state"] as const,
  },
  {
    id: "docker-and-container-config",
    category: "downstream-follow-up",
    description: "Docker configuration files (docker/*, Dockerfile) reference GSD product names, gsd-pi package, and container naming that is downstream work tracked separately from S01.",
    pathPattern: String.raw`(?:^|/)(?:docker/|Dockerfile[^/]*)`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "Docker container images and docker-compose configurations reference gsd-pi and GSD product identity. These require coordinated container image publishing and registry changes separate from S01 source identity work.",
    allowedUntil: "Remove when container images are migrated to Hammer identity.",
    examples: ['image: ghcr.io/gsd-build/gsd-ci-builder:latest'] as const,
  },
  {
    id: "recovery-scripts-internal",
    category: "internal-implementation-path",
    description: "Recovery/migration scripts (scripts/recover-gsd-*.sh, scripts/recover-gsd-*.ps1) are internal operational tools that reference specific gsd-* artifacts and state paths as part of their recovery targets.",
    pathPattern: String.raw`(?:^|/)scripts/recover-gsd-`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "These are one-off operational recovery scripts for specific incidents, not user-facing product scripts. They reference legacy gsd-* artifact names as migration targets.",
    allowedUntil: "Remove or update when the relevant recovery procedures are no longer needed.",
    examples: ["# Recover from GSD-1364 database corruption"] as const,
  },
  {
    id: "dev-internal-docs-and-adrs",
    category: "internal-implementation-path",
    description: "Internal development documentation (docs/dev/, including ADRs, implementation plans, and the FILE-SYSTEM-MAP.md) reference GSD product identity in their historical context and technical descriptions.",
    pathPattern: String.raw`(?:^|/)docs/dev/`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "ADRs and internal dev docs are records of architectural decisions made during the GSD era. They reference GSD as the product name that was current at decision time. Rewriting historical ADRs is out of scope for S01.",
    allowedUntil: "Permanent for archived ADRs. Update forward-facing docs as separate work.",
    examples: ["# ADR-008: GSD tools over MCP for provider parity"] as const,
  },
  {
    id: "test-integration-web-surfaces",
    category: "internal-implementation-path",
    description: "Integration tests in src/tests/integration/ that verify web command parity and web state surfaces reference gsd-* surface names, /gsd commands, and GSD_HELP_TEXT as the expected contract that must remain backwards-compatible.",
    pathPattern: String.raw`(?:^|/)src/tests/integration/`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "The web command parity and web state surfaces tests are contract tests that verify gsd-* surface names still dispatch correctly as legacy aliases. These tests use gsd-* names deliberately to ensure backwards compatibility is not broken. They are a superset of the hammer-* tests in the same files.",
    allowedUntil: "Update test fixtures when gsd-* surface aliases are retired from the browser dispatch layer.",
    examples: ["expect(surfaceNames).toContain('gsd-status')"] as const,
  },
  {
    id: "claude-code-cli-tests-internal",
    category: "internal-implementation-path",
    description: "src/resources/extensions/claude-code-cli/tests/ contains stream adapter tests that reference GSD banner patterns and gsd binary name for stream-filtering logic.",
    pathPattern: String.raw`(?:^|/)src/resources/extensions/claude-code-cli/tests/`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "The stream adapter filters GSD startup banner text from PTY output. These tests verify that banner-filtering regex still matches the legacy 'gsd v...' pattern that existing installations emit, making it a backwards-compatibility test.",
    allowedUntil: "Update when the legacy GSD startup banner pattern is no longer emitted by any supported version.",
    examples: ["/^gsd\\s+v[\\d.]+/i, // version banner"] as const,
  },
  {
    id: "e2e-smoke-test-internal",
    category: "internal-implementation-path",
    description: "src/tests/integration/e2e-smoke.test.ts exercises the full CLI lifecycle and references gsd env vars and binary invocations as part of its backwards-compatibility validation.",
    pathPattern: String.raw`(?:^|/)src/tests/integration/e2e-smoke\.test\.ts$`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "The e2e smoke test validates that legacy GSD_* env vars and backward-compatible state paths still work end-to-end. Every reference is testing a compatibility bridge.",
    allowedUntil: "Update when legacy GSD_* env vars and state paths are retired.",
    examples: ["process.env.GSD_VERSION // expected to still be set as legacy alias"] as const,
  },
  {
    id: "web-mode-cli-test-internal",
    category: "internal-implementation-path",
    description: "src/tests/integration/web-mode-cli.test.ts tests the web mode CLI and references GSD_WEB_* env vars and gsd --web invocation as internal implementation details.",
    pathPattern: String.raw`(?:^|/)src/tests/integration/web-mode-cli\.test\.ts$`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "This test verifies that GSD_WEB_* env vars are correctly propagated. These vars are downstream follow-up work for the web/ app rename and are tested here as legacy aliases.",
    allowedUntil: "Update when GSD_WEB_* env vars are migrated to HAMMER_WEB_*.",
    examples: ["process.env.GSD_WEB_PACKAGE_ROOT"] as const,
  },
  {
    id: "update-check-legacy-package-ref",
    category: "legacy-alias",
    description: "src/update-check.ts references GSD_VERSION env var as the source of current version, which is set as a legacy alias by the loader alongside HAMMER_VERSION.",
    pathPattern: String.raw`(?:^|/)src/update-check\.ts$`,
    linePattern: String.raw`GSD_VERSION`,
    rationale:
      "GSD_VERSION is a legacy alias for HAMMER_VERSION set in loader.ts's bootstrap-migration layer. update-check.ts reads it as a fallback for environments that still set only GSD_VERSION.",
    allowedUntil: "Remove GSD_VERSION fallback once loader.ts's legacy env var bridge is retired.",
    examples: ["process.env.GSD_VERSION || '0.0.0'"] as const,
  },
  {
    id: "src-tests-general-internal",
    category: "internal-implementation-path",
    description: "General test files in src/tests/ (non-hammer-* prefix) that exercise internal CLI behavior, web mode, extension paths, extension validator, headless surfaces, update check, onboarding, and other subsystems reference .gsd paths, GSD_* env vars, gsd command strings, and gsd-* identifiers as internal test contracts.",
    pathPattern: String.raw`(?:^|/)src/tests/[^/]+\.(?:test|spec)\.ts$`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "These test files cover CLI smoke tests, extension discovery, web mode CLI, update checks, onboarding, RTK, headless surfaces, and other subsystems. Many tests verify that legacy GSD env vars, .gsd paths, and gsd command strings still work as backwards-compatible aliases. They are internal test contracts, not unclassified product identity regressions.",
    allowedUntil: "Update incrementally as each subsystem's legacy aliases are retired.",
    examples: ["assert.equal(process.env.GSD_VERSION, version)"] as const,
  },
  {
    id: "src-tests-utils-internal",
    category: "internal-implementation-path",
    description: "Internal test utility files (src/tests/*.ts, non-test) referenced by test suites that contain GSD identity strings.",
    pathPattern: String.raw`(?:^|/)src/tests/[^/]+\.ts$`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale: "Test utilities in src/tests/ that are not test files themselves but support test infrastructure reference legacy GSD identity for backwards-compatibility validation.",
    allowedUntil: "Update when legacy aliases are retired.",
    examples: ["const gsdBin = resolve(root, 'node_modules/.bin/gsd')"] as const,
  },
  {
    id: "web-mode-and-onboarding-source",
    category: "internal-implementation-path",
    description: "src/web-mode.ts and src/onboarding.ts are CLI entry points that reference GSD_WEB_* env vars, gsd --web invocation strings, and legacy .gsd paths as part of their bootstrap-migration and backwards-compatible state resolution.",
    pathPattern: String.raw`(?:^|/)src/(?:web-mode|onboarding|worktree-cli|resource-loader|extension-validator)\.ts$`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "These source files contain GSD_WEB_* env var reads (legacy aliases for HAMMER_WEB_*), gsd --web invocation strings in help/diagnostic output, and .gsd path probes. They are internal source files in the main src/ tree — their GSD references are all bridged or legacy-aliased, not standalone visible regressions.",
    allowedUntil: "Update as GSD_WEB_* env vars are migrated to HAMMER_WEB_* and help strings are updated.",
    examples: ["process.env.GSD_WEB_PACKAGE_ROOT"] as const,
  },
  {
    id: "extension-auto-phases-internal",
    category: "internal-implementation-path",
    description: "src/resources/extensions/gsd/auto/phases.ts is an internal auto-mode phases module that references .gsd paths, GSD_* env vars, and gsd-* command strings as part of the execution substrate.",
    pathPattern: String.raw`(?:^|/)src/resources/extensions/gsd/auto/`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "The auto-mode phases module drives the internal execution engine and references .gsd state paths, GSD env vars, and legacy command strings as bootstrap bridges. These are implementation internals, not user-visible product identity in the output surface.",
    allowedUntil: "Update during the extensions/gsd → extensions/hammer rename.",
    examples: ["const autoLock = join(gsdRoot(), 'auto.lock')"] as const,
  },
  {
    id: "extension-tools-source-internal",
    category: "internal-implementation-path",
    description: "Tool executor and dynamic tool registration source files (tools/workflow-tool-executors.ts, bootstrap/dynamic-tools.ts, bootstrap/system-context.ts, tools/memory-tools.ts, bootstrap/write-gate.ts) reference .gsd paths and GSD identifiers as implementation internals.",
    pathPattern: String.raw`(?:^|/)src/resources/extensions/gsd/(?:tools/|bootstrap/(?:dynamic-tools|system-context|write-gate))`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "These are internal implementation files for the auto-mode execution tools and system context bootstrapper. .gsd path references are state bridge code, GSD_* env vars are legacy aliases, and gsd_* strings are tool name references for compatibility. None are user-visible product identity.",
    allowedUntil: "Update during the extensions/gsd → extensions/hammer rename.",
    examples: ["const artifactDir = join(gsdRoot(), 'artifacts')"] as const,
  },
  {
    id: "extension-skills-and-non-s08-prompt-corpus",
    category: "internal-implementation-path",
    description: "Bundled skill files may still contain old command examples as downstream corpus, but S08-owned core prompt/workflow surfaces are excluded from this compatibility bridge.",
    pathPattern: String.raw`(?:^|/)src/resources/(?:extensions/gsd/skills/|skills/)`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "S08 closes the reachable core Hammer prompt/workflow corpus, so broad prompt/workflow path allowances must not hide stale visible prose. Bundled skill corpus migration remains downstream and is separate from the strict prompt/workflow coverage checker.",
    allowedUntil: "Remove when bundled skills are updated to Hammer command syntax.",
    examples: ["/gsd auto — legacy skill example awaiting skill-corpus migration"] as const,
  },
  {
    id: "s08-db-backed-tool-name-bridge",
    category: "legacy-alias",
    description: "S08 prompt/workflow surfaces may name gsd_* only when the local line explicitly says it is a DB-backed tool-name/contract compatibility bridge or stop-before guard.",
    pathPattern: String.raw`(?:^|/)src/resources/(?:extensions/gsd/prompts/|GSD-WORKFLOW\.md$|extensions/gsd/workflow-templates/|extensions/gsd/(?:commands-workflow-templates|workflow-templates|workflow-dispatch|custom-workflow-engine|unit-context-manifest|iam-subagent-policy)\.ts$)`,
    linePattern: String.raw`(?:(?:DB-backed|database-backed|tool[- ]?(?:name|schema|call|surface|contract)|available tool|execution substrate|legacy|compat|stop before).{0,160}gsd_[A-Za-z0-9_]+|gsd_[A-Za-z0-9_]+.{0,160}(?:DB-backed|database-backed|tool[- ]?(?:name|schema|call|surface|contract)|available tool|execution substrate|legacy|compat|stop before))`,
    rationale:
      "The DB-backed gsd_* tool names remain the available execution substrate for some Hammer prompts. They are allowed only with immediate local bridge wording so stale GSD-first prose cannot be classified by path alone.",
    allowedUntil: "Remove when canonical hammer_* tool names fully replace DB-backed gsd_* prompt contracts.",
    examples: ["Call `gsd_plan_slice` as the DB-backed tool-name compatibility bridge."] as const,
  },
  {
    id: "s08-legacy-state-path-bridge",
    category: "bootstrap-migration",
    description: "S08 prompt/workflow surfaces may name .gsd, GSD_* env aliases, or GSD-WORKFLOW.md only as explicit legacy state/file path bridges while .hammer/Hammer remain canonical.",
    pathPattern: String.raw`(?:^|/)src/resources/(?:extensions/gsd/prompts/|GSD-WORKFLOW\.md$|extensions/gsd/workflow-templates/|extensions/gsd/(?:commands-workflow-templates|workflow-templates|workflow-dispatch|custom-workflow-engine|unit-context-manifest|iam-subagent-policy)\.ts$)`,
    linePattern: String.raw`(?:(?:\.gsd|GSD_[A-Z0-9_]+|GSD-WORKFLOW(?:\.md)?).{0,180}(?:\.hammer|state[- ]?(?:namespace|path|root|dir)|state\s+bridge|legacy|compat|migration|migrate|fallback|bootstrap|file path|artifact path|private|internal)|(?:\.hammer|state[- ]?(?:namespace|path|root|dir)|state\s+bridge|legacy|compat|migration|migrate|fallback|bootstrap|file path|artifact path|private|internal).{0,180}(?:\.gsd|GSD_[A-Z0-9_]+|GSD-WORKFLOW(?:\.md)?))`,
    rationale:
      "The workflow resource is still packaged under a legacy path and some prompt instructions must reference legacy .gsd state for migration/read compatibility. The allowance is line-scoped to explicit state/path bridge language, not a blanket prompt/workflow allowlist.",
    allowedUntil: "Remove when state namespace and GSD-WORKFLOW.md path bridges are retired.",
    examples: ["Read `.gsd` only as a legacy state bridge while `.hammer` is canonical."] as const,
  },
  {
    id: "s08-internal-workflow-dispatch-tags",
    category: "internal-implementation-path",
    description: "Workflow dispatch customType values use gsd-workflow-* as private message tags while the visible command/prose surface is Hammer-native.",
    pathPattern: String.raw`(?:^|/)src/resources/extensions/gsd/(?:commands-workflow-templates|workflow-dispatch)\.ts$`,
    linePattern: String.raw`gsd-workflow-(?:template|oneshot).{0,160}(?:customType|internal|compat|bridge)|(?:customType|internal|compat|bridge).{0,160}gsd-workflow-(?:template|oneshot)`,
    rationale:
      "These customType strings are private dispatch tags consumed by the existing extension messaging substrate, not prompt prose. They remain line-scoped to dispatch code so a new prompt/workflow document cannot hide behind a broad path allowance.",
    allowedUntil: "Remove when internal workflow dispatch tags are renamed to hammer-workflow-*.",
    examples: ['{ customType: "gsd-workflow-template", content: prompt, display: false }'] as const,
  },
  {
    id: "s08-internal-extension-path-bridge",
    category: "internal-implementation-path",
    description: "Workflow template resolver code may reference the still-physical extensions/gsd directory only with explicit internal extension path bridge wording.",
    pathPattern: String.raw`(?:^|/)src/resources/extensions/gsd/workflow-templates\.ts$`,
    linePattern: String.raw`(?:extensions["', ]+gsd|extensions/gsd|\bgsd\b).{0,160}(?:internal extension path bridge|private extension path|legacy extension path|compatibility path)|(?:internal extension path bridge|private extension path|legacy extension path|compatibility path).{0,160}(?:extensions["', ]+gsd|extensions/gsd|\bgsd\b)`,
    rationale:
      "The installed extension directory is still named gsd, but workflow template resolution must classify that as an internal path bridge only when the local line says so.",
    allowedUntil: "Remove when the extensions/gsd directory is renamed to extensions/hammer.",
    examples: ['const agentGsdDir = join(hammerHome, "agent", "extensions", "gsd"); // internal extension path bridge.'] as const,
  },
  {
    id: "s08-forensics-historical-reference",
    category: "historical-docs",
    description: "The forensics prompt may mention legacy GSD only as historical inspection/migration subject matter, and may include old repository GraphQL examples only as legacy issue-type automation snippets.",
    pathPattern: String.raw`(?:^|/)src/resources/extensions/gsd/prompts/forensics\.md$`,
    linePattern: String.raw`(?:(?:legacy|historical|migration|old repository|GraphQL|issue type|gh api|repository\(owner).{0,220}(?:GSD|gsd-build|gsd-2)|(?:GSD|gsd-build|gsd-2).{0,220}(?:legacy|historical|migration|old repository|GraphQL|issue type|gh api|repository\(owner))`,
    rationale:
      "Forensics sometimes investigates old runs and still documents a legacy issue-type GraphQL snippet. The allowance is constrained to historical/automation context in the forensics prompt; generic prompt prose such as 'Use GSD' remains unclassified.",
    allowedUntil: "Remove when the forensics GitHub issue automation snippet is fully migrated to Hammer-owned repository metadata.",
    examples: ["legacy GSD historical inspection", 'repository(owner:"gsd-build",name:"gsd-2")'] as const,
  },
  {
    id: "extension-commands-workflow-source",
    category: "internal-implementation-path",
    description: "Extension command handler files (commands/handlers/workflow.ts, migrate/command.ts, commands/handlers/*.ts) reference /gsd command strings, .gsd state paths, and GSD_* env vars as part of the implementation substrate.",
    pathPattern: String.raw`(?:^|/)src/resources/extensions/gsd/commands/handlers/|(?:^|/)src/resources/extensions/gsd/migrate/`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "These command handler files are the implementation layer under the /hammer dispatch surface. They may reference .gsd paths, GSD_* env vars, or legacy command strings as backwards-compatible bridges while the canonical /hammer path is being established. These are internal implementation details, not visible product identity regressions.",
    allowedUntil: "Update during the extensions/gsd → extensions/hammer rename.",
    examples: ["const statePath = gsdRoot() // resolves to .hammer then .gsd"] as const,
  },
  {
    id: "scripts-internal-tooling",
    category: "internal-implementation-path",
    description: "Internal developer tooling scripts (scripts/parallel-monitor.mjs, scripts/verify-s04.sh) reference gsd state paths, GSD env vars, and gsd command invocations as internal development tooling.",
    pathPattern: String.raw`(?:^|/)scripts/(?:parallel-monitor|verify-s04|with-env|link-workspace)`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "These developer scripts are internal tooling not shipped to users. They reference .gsd state paths, GSD env vars, and command strings as implementation details of the development workflow.",
    allowedUntil: "Update as internal scripts are migrated to .hammer paths and HAMMER_* env vars.",
    examples: ["const parallelDir = path.join(process.cwd(), '.gsd', 'parallel')"] as const,
  },
  {
    id: "packages-mcp-server-tests",
    category: "internal-implementation-path",
    description: "Test files in packages/mcp-server/src/ (graph.test.ts, remote-questions.test.ts, readers.test.ts) reference internal .gsd state paths, GSD_* env vars, and gsd_* tool names as part of the server's backwards-compatibility test contracts.",
    pathPattern: String.raw`(?:^|/)packages/mcp-server/src/[^/]*\.test\.ts$`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "MCP server test files validate that legacy .gsd state paths, GSD_* env var fallbacks, and gsd_* tool aliases still work. Every GSD reference is a deliberate compatibility regression test.",
    allowedUntil: "Update when MCP server legacy bridges are retired.",
    examples: ["const gsdPath = join(tmpDir, '.gsd')"] as const,
  },
  {
    id: "changelog-historical",
    category: "historical-docs",
    description: "CHANGELOG.md is a historical record of all changes made to the project under its prior GSD identity. All GSD references in CHANGELOG.md are historical records.",
    pathPattern: String.raw`(?:^|/)CHANGELOG\.md$`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "The changelog is a historical document that records changes made to the project under its prior GSD product identity. Rewriting it would destroy historical accuracy.",
    allowedUntil: "Permanent historical exception for CHANGELOG.md.",
    examples: ["- **gsd**: add createdAt timestamp"] as const,
  },
  {
    id: "prompt-injection-scanignore",
    category: "internal-implementation-path",
    description: ".prompt-injection-scanignore lists GSD prompt templates as false positives for prompt injection scanning.",
    pathPattern: String.raw`(?:^|/)\.prompt-injection-scanignore$`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "The scan-ignore file is an internal security scanner configuration that needs to reference GSD prompt paths to suppress false positives.",
    allowedUntil: "Update when prompt template paths are renamed.",
    examples: ["# False positives in GSD prompt templates"] as const,
  },
  {
    id: "gsd-orchestrator-state-path-bridge",
    category: "bootstrap-migration",
    description: "Hammer orchestrator docs may mention .gsd only as an explicit legacy state bridge while .hammer remains canonical.",
    pathPattern: String.raw`(?:^|/)gsd-orchestrator/`,
    linePattern: String.raw`(?:(?:\.gsd(?:-id)?).{0,180}(?:\.hammer|state[- ]?(?:namespace|path|root|dir)|state\s+bridge|legacy|compat|migration|migrate|fallback|bootstrap|older project|canonical)|(?:\.hammer|state[- ]?(?:namespace|path|root|dir)|state\s+bridge|legacy|compat|migration|migrate|fallback|bootstrap|older project|canonical).{0,180}(?:\.gsd(?:-id)?))`,
    rationale:
      "The orchestrator docs must teach .hammer as canonical while still explaining how older projects may expose .gsd as a read-only compatibility bridge. The allowance is line-scoped so new .gsd canonical prose remains unclassified.",
    allowedUntil: "Remove when .gsd state imports are retired from headless orchestration.",
    examples: [".gsd may exist as a legacy state bridge while .hammer is canonical."] as const,
  },
  {
    id: "gsd-orchestrator-internal-path-bridge",
    category: "internal-implementation-path",
    description: "The physical gsd-orchestrator/ directory and skill id remain implementation-path identifiers while its visible workflow prose is Hammer-native.",
    pathPattern: String.raw`(?:^|/)gsd-orchestrator/`,
    linePattern: String.raw`\bgsd-orchestrator\b`,
    rationale:
      "T07 migrated the orchestrator docs to Hammer headless, /hammer, .hammer, IAM, and no-degradation language without renaming the physical directory. This rule classifies only the path/skill identifier so stale canonical /gsd or .gsd prose cannot hide behind the directory allowance.",
    allowedUntil: "Remove when the physical gsd-orchestrator directory and skill id are renamed.",
    examples: ["name: gsd-orchestrator"] as const,
  },
  {
    id: "packages-daemon-internal",
    category: "downstream-follow-up",
    description: "The packages/daemon/ package (Discord bot, daemon process) uses gsd-* surface names, /gsd commands, and GSD product strings as downstream work tracked separately from S01.",
    pathPattern: String.raw`(?:^|/)packages/daemon/`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "The daemon package surfaces /gsd commands to remote chat (Discord/Slack) users. Renaming requires coordinated work on command handling and remote help text that is downstream from S01.",
    allowedUntil: "Remove when daemon package identity is migrated to Hammer.",
    examples: ['"/gsd auto" → starts auto-mode'] as const,
  },
  {
    id: "live-regression-tests-internal",
    category: "internal-implementation-path",
    description: "tests/live-regression/ contains integration test runners that reference GSD_LIVE_TESTS env vars, gsd command invocations, and .gsd state paths as part of the live regression test harness.",
    pathPattern: String.raw`(?:^|/)tests/live-regression/`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "Live regression tests exercise the full production binary and validate that legacy gsd command invocations, .gsd state paths, and GSD_* env vars continue to work. All references are backwards-compatibility test cases.",
    allowedUntil: "Update when legacy gsd CLI entry points are retired.",
    examples: ["const result = await run(['gsd', '--version'])"] as const,
  },
  {
    id: "remote-questions-extension-internal",
    category: "internal-implementation-path",
    description: "src/resources/extensions/remote-questions/ source files reference .gsd state paths for auth storage and session management as bootstrap-migration bridges.",
    pathPattern: String.raw`(?:^|/)src/resources/extensions/remote-questions/`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "The remote-questions extension reads auth.json and PREFERENCES.md from legacy .gsd paths with .hammer as the canonical path. These are deliberate state-namespace bridges.",
    allowedUntil: "Remove .gsd fallbacks once all installations have migrated to .hammer.",
    examples: ['join(homedir(), ".gsd", "agent", "auth.json")'] as const,
  },
  {
    id: "stream-adapter-legacy-banner",
    category: "internal-implementation-path",
    description: "src/resources/extensions/claude-code-cli/stream-adapter.ts filters legacy GSD startup banner text from PTY streams for the Claude Code CLI integration.",
    pathPattern: String.raw`(?:^|/)src/resources/extensions/claude-code-cli/`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "The stream adapter must continue to filter the legacy 'gsd v...' startup banner pattern emitted by older installed versions of the Hammer binary while it still carried the GSD identity. This is a backwards-compatible filter, not a product identity regression.",
    allowedUntil: "Remove when the legacy GSD startup banner pattern is no longer emitted by any supported version.",
    examples: ["/^gsd\\s+v[\\d.]+/i,  // legacy GSD version banner"] as const,
  },
  {
    id: "browser-tools-proposal-internal",
    category: "internal-implementation-path",
    description: "Internal design documents and proposals within extension source directories reference GSD product names in their historical context.",
    pathPattern: String.raw`(?:^|/)src/resources/extensions/[^/]+/[^/]*\.md$`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "Design proposals and internal documentation within extension directories are records of work done under the GSD identity. They are not user-visible product surfaces.",
    allowedUntil: "Update as part of the broader documentation migration.",
    examples: ["# BROWSER-TOOLS-V2-PROPOSAL.md — GSD Browser Tools v2 Design"] as const,
  },
  {
    id: "contributing-and-meta-docs",
    category: "downstream-follow-up",
    description: "Project meta-documentation (CONTRIBUTING.md, VISION.md, SECURITY.md, and similar root-level docs) that reference GSD product identity. Post-S08 graduation: the rule only absorbs these files when the file body actually mentions Hammer — meta-docs that regress to GSD-only language fall through to unclassified-visible-gsd.",
    pathPattern: String.raw`(?:^|/)(?:CONTRIBUTING|VISION|SECURITY|ROADMAP|LICENSE|ARCHITECTURE|ONBOARDING)(?:\.md)?$`,
    linePattern: LEGACY_TOKEN_PATTERN,
    requiresFileMarker: String.raw`\bHammer\b`,
    rationale:
      "Root-level meta-docs (VISION, CONTRIBUTING) were rewritten under S08 T01 with explicit fork-bridge notes and Hammer identity. Graduation flips this from blanket downstream tolerance to a fail-closed gate: legacy GSD spellings are accepted only inside files that establish Hammer identity. Meta-doc regressions to pre-rebrand language now fail the scanner.",
    allowedUntil: "Permanent enforcement: rule absorbs classified-and-acceptable references only when \\bHammer\\b is present in the file body.",
    examples: ["For project guidelines, see VISION.md (rebranded to Hammer)"] as const,
  },
  {
    id: "packages-pi-core-internal",
    category: "internal-implementation-path",
    description: "The packages/pi-coding-agent/, packages/pi-ai/, packages/pi-agent-core/, packages/rpc-client/, packages/native/, and packages/mcp-server/src/readers/ packages are internal platform libraries that reference GSD product names in internal types, skill loading, tool registration, and agent infrastructure.",
    pathPattern: String.raw`(?:^|/)packages/(?:pi-coding-agent|pi-ai|pi-agent-core|rpc-client|native)/`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "These platform packages form the core pi/hammer runtime substrate. They reference GSD identity in internal types, skill search paths, tool naming conventions, and infrastructure wiring. These are platform internals that require coordinated rename effort beyond S01.",
    allowedUntil: "Update during the platform package rename from gsd-* to hammer-* identity.",
    examples: ["const gsdToolPrefix = 'gsd_'"] as const,
  },
  {
    id: "packages-mcp-readers-internal",
    category: "internal-implementation-path",
    description: "packages/mcp-server/src/readers/ (graph.ts, state.ts, roadmap.ts, readers.test.ts) are internal MCP state readers that reference .gsd paths and internal state structures as implementation internals.",
    pathPattern: String.raw`(?:^|/)packages/mcp-server/src/readers/`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "The MCP state readers read .gsd (and .hammer) state directories. They contain deliberate .gsd fallback path logic and internal GSD type references as backwards-compatibility bridges.",
    allowedUntil: "Update when MCP server .gsd fallback bridges are retired.",
    examples: ["const gsdPath = join(projectRoot, '.gsd')"] as const,
  },
  {
    id: "packages-mcp-session-manager",
    category: "internal-implementation-path",
    description: "packages/mcp-server/src/session-manager.ts references .gsd paths and GSD_* env vars as internal session resolution and state bootstrap bridges.",
    pathPattern: String.raw`(?:^|/)packages/mcp-server/src/session-manager\.ts$`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "The MCP session manager probes .hammer first and falls back to .gsd for legacy installations. GSD_* env var reads are legacy aliases annotated inline.",
    allowedUntil: "Remove .gsd fallbacks when all MCP sessions migrate to .hammer.",
    examples: ["const gsdDir = join(cwd, '.gsd') // legacy fallback"] as const,
  },
  {
    id: "src-core-source-files-internal",
    category: "internal-implementation-path",
    description: "Core source files in src/ (excluding the explicit T02 cut-over surfaces) contain GSD env vars, gsd command strings, .gsd paths as internal bootstrap bridges — recognized by env var patterns, state path patterns, or GSD_* constant patterns.",
    pathPattern: String.raw`(?:^|/)src/(?:(?!resources/extensions/gsd/|tests/|hammer-identity/|loader\.ts$|cli\.ts$|help-text\.ts$|update-check\.ts$|update-cmd\.ts$)[^/]+\.ts$|(?!loader\.ts$|cli\.ts$|help-text\.ts$|update-check\.ts$|update-cmd\.ts$)shared/[^/]+\.ts$|resources/extensions/(?!gsd/)[^/]+/[^/]+\.ts$|resources/agents/[^/]+\.md$)`,
    linePattern: String.raw`(?:GSD_(?!SHORTCUTS)[A-Z0-9_]+|gsd_[a-z][a-zA-Z0-9_]+\b|\.gsd\b|gsd-(?:pi|cli|daemon|mcp|web|extension|headless)\b|gsd\.(?:db|lock|json)\b|GSD-WORKFLOW\b|gsd-main\b|gsd-interactive\b|gsd-upload\b|gsd-[a-z]+-[0-9]+\b|gsd-active-view\b|gsd:(?:open|navigate|close)[^'"\s]*|gsd_pty|gsd-editor\b|gsd-terminal\b|gsd-user-mode\b|gsd-sidebar\b|gsd-files\b|gsd-[a-z]+-font\b|gsd-auth\b)`,
    rationale:
      "Core src/ files contain GSD_* env var reads, gsd_* tool prefix references, .gsd path probes, and gsd-* event/storage key strings as internal implementation details. Only lines matching these specific internal patterns are classified — generic GSD product strings in these files remain unclassified so the enforcer still catches regressions.",
    allowedUntil: "Update as each subsystem's legacy aliases are retired.",
    examples: ["const gsdVersion = process.env.GSD_VERSION || '0.0.0'"] as const,
  },
  {
    id: "scripts-all-internal",
    category: "internal-implementation-path",
    description: "Developer scripts in scripts/ (build tools, deployment scripts, verification scripts, code-quality scripts) reference GSD product names, gsd-pi package, .gsd state paths, and GSD_* env vars as internal build tooling.",
    pathPattern: String.raw`(?:^|/)scripts/`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "Build, deployment, and verification scripts in scripts/ are internal developer tooling not shipped to users. They reference gsd-pi npm package, GSD env vars, and .gsd paths as part of the build and deployment pipeline.",
    allowedUntil: "Update as scripts are migrated to hammer-pi and HAMMER_* env vars.",
    examples: ["const pkg = require('./package.json'); // gsd-pi package"] as const,
  },
  {
    id: "extensions-all-other-internal",
    category: "internal-implementation-path",
    description: "All remaining extension source files not covered by more specific rules (browser-tools, bg-shell, subagent, ollama, mcp-client, slash-commands, ttsr, voice, aws-auth, cmux, github-sync) reference GSD identity as internal implementation details.",
    pathPattern: String.raw`(?:^|/)src/resources/extensions/(?!gsd/|claude-code-cli/|remote-questions/)`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "These extension source files are internal implementations that may reference legacy .gsd paths, GSD_* env vars, or GSD product strings in their tool descriptions or state resolution logic. Each extension is a separate scoped internal implementation detail.",
    allowedUntil: "Update incrementally as each extension is audited.",
    examples: ["path.join(homedir(), '.gsd', 'captures')"] as const,
  },
  {
    id: "native-cargo-lock",
    category: "internal-implementation-path",
    description: "The Rust Cargo.lock file records the resolved dependency tree including gsd-ast and gsd-engine internal crate names.",
    pathPattern: String.raw`(?:^|/)native/Cargo(?:\.lock|\.toml)$`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "Cargo.lock is a machine-generated lockfile that records the resolved Rust crate tree. The gsd-ast and gsd-engine crate names are internal Rust library names that require a coordinated publish to change.",
    allowedUntil: "Update when Rust crate names are renamed to hammer-* equivalents.",
    examples: ['name = "gsd-engine"'] as const,
  },
  {
    id: "extensions-package-keywords",
    category: "internal-implementation-path",
    description: "Extension package.json files use 'gsd-extension' as a keyword for package discovery purposes.",
    pathPattern: String.raw`(?:^|/)extensions/[^/]+/package\.json$`,
    linePattern: String.raw`gsd-extension`,
    rationale:
      "The 'gsd-extension' keyword is a package discovery marker used by the extension loader to identify pi/hammer extension packages. Changing it requires a coordinated update to the extension discovery mechanism.",
    allowedUntil: "Update when extension discovery is migrated to 'hammer-extension' keyword.",
    examples: ['"keywords": ["pi-package", "gsd-extension"]'] as const,
  },
  {
    id: "tests-smoke-and-live",
    category: "internal-implementation-path",
    description: "Smoke tests (tests/smoke/) and live tests (tests/live/) reference gsd command invocations and GSD product strings to verify that the binary still launches and responds correctly.",
    pathPattern: String.raw`(?:^|/)tests/(?:smoke|live)/`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "Smoke and live tests exercise the actual deployed binary and validate that gsd command invocations continue to work. These are backwards-compatibility regression tests.",
    allowedUntil: "Update when legacy gsd CLI entry points are retired.",
    examples: ["const result = spawn('gsd', ['--version'])"] as const,
  },
  {
    id: "studio-electron-app",
    category: "downstream-follow-up",
    description: "The studio/ Electron app references GSD product strings, gsd binary invocations, and GSD UI labels throughout its main process and renderer.",
    pathPattern: String.raw`(?:^|/)studio/`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "The Electron studio app is a separate desktop app that requires its own rename milestone. It is downstream from S01 source identity work.",
    allowedUntil: "Remove when studio app identity is migrated to Hammer.",
    examples: ["title: 'GSD Studio'"] as const,
  },
  {
    id: "native-crates-internal",
    category: "internal-implementation-path",
    description: "Rust crate source files in native/crates/ (ast, engine, grep) use gsd-* crate names, gsd_* module names, GSD doc-comments, and .gsd state path references as internal Rust library implementation.",
    pathPattern: String.raw`(?:^|/)native/crates/`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "The native Rust crates (gsd-ast, gsd-engine, gsd-grep) are internal performance libraries. Their crate names, module names, function names, and doc-comments all carry the gsd_ prefix as Rust naming convention. Renaming requires a coordinated Cargo publish.",
    allowedUntil: "Update when Rust crates are renamed to hammer-* equivalents.",
    examples: ['use gsd_ast as _', 'pub fn scan_gsd_tree'] as const,
  },
  {
    id: "native-npm-package-manifests",
    category: "internal-implementation-path",
    description: "native/npm/*/package.json files describe platform-specific native addon packages that bundle gsd_engine.node binaries and reference the legacy GSD GitHub repository URL.",
    pathPattern: String.raw`(?:^|/)native/npm/`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "The native addon npm packages use gsd_engine.node as the binary name because the compiled Rust artifact embeds this name from the Cargo.toml crate-type. Renaming requires a coordinated rebuild and republish of all platform artifacts.",
    allowedUntil: "Update when native engine crates are renamed and artifacts are republished.",
    examples: ['"main": "gsd_engine.node"'] as const,
  },
  {
    id: "rtk-shared-bootstrap-migration",
    category: "bootstrap-migration",
    description: "src/rtk-shared.js reads GSD_HOME as a legacy fallback to locate the managed binary directory before HAMMER_HOME was established.",
    pathPattern: String.raw`(?:^|/)src/rtk-shared\.js$`,
    linePattern: LEGACY_TOKEN_PATTERN,
    rationale:
      "GSD_HOME is a legacy alias for HAMMER_HOME. rtk-shared.js falls back to ~/.gsd/agent/bin when neither HAMMER_HOME nor GSD_HOME is set, as a bootstrap bridge for existing installations.",
    allowedUntil: "Remove GSD_HOME fallback once all installations have HAMMER_HOME set.",
    examples: ["env.GSD_HOME || join(osHomedir(), '.gsd')"] as const,
  },
  {
    id: "iam-persist-internal-path-comment",
    category: "internal-implementation-path",
    description: "src/iam/persist.ts names gsd-db.ts in a code comment explaining why OmegaRunRow / SavesuccessResultRow are declared locally rather than imported.",
    pathPattern: String.raw`(?:^|/)src/iam/persist\.ts$`,
    linePattern: String.raw`gsd-db\.ts`,
    rationale:
      "The comment is an internal implementation note explaining the deliberate zero-import design decision. It names the sibling database module (gsd-db.ts) only to clarify why its exported types are mirrored locally — the iam/ layer does not import from the extension tree.",
    allowedUntil: "Remove or update if gsd-db.ts is renamed as part of the broader DB module identity migration.",
    examples: ["// exported from gsd-db.ts but declared locally to avoid cross-tree imports."] as const,
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

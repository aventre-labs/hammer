export const HAMMER_PRODUCT_NAME = "hammer" as const;
export const HAMMER_DISPLAY_NAME = "Hammer" as const;
export const HAMMER_PACKAGE_NAME = "hammer-pi" as const;

export const HAMMER_CLI_COMMAND = "hammer" as const;
export const HAMMER_CLI_WRAPPER_COMMAND = "hammer-cli" as const;
export const HAMMER_SLASH_COMMAND = "/hammer" as const;

export const HAMMER_LEGACY_CLI_COMMAND = "gsd" as const;
export const HAMMER_LEGACY_CLI_WRAPPER_COMMAND = "gsd-cli" as const;
export const HAMMER_LEGACY_PACKAGE_BIN_COMMAND = "gsd-pi" as const;

export const HAMMER_STATE_DIR_NAME = ".hammer" as const;
export const HAMMER_GLOBAL_HOME_DIR_NAME = ".hammer" as const;
export const HAMMER_PROJECT_MARKER_FILE = ".hammer-id" as const;

export const HAMMER_HOME_ENV = "HAMMER_HOME" as const;
export const HAMMER_STATE_DIR_ENV = "HAMMER_STATE_DIR" as const;
export const HAMMER_PROJECT_ID_ENV = "HAMMER_PROJECT_ID" as const;

export const HAMMER_CODING_AGENT_DIR_ENV = "HAMMER_CODING_AGENT_DIR" as const;
export const HAMMER_PKG_ROOT_ENV = "HAMMER_PKG_ROOT" as const;
export const HAMMER_VERSION_ENV = "HAMMER_VERSION" as const;
export const HAMMER_BIN_PATH_ENV = "HAMMER_BIN_PATH" as const;
export const HAMMER_WORKFLOW_PATH_ENV = "HAMMER_WORKFLOW_PATH" as const;
export const HAMMER_BUNDLED_EXTENSION_PATHS_ENV = "HAMMER_BUNDLED_EXTENSION_PATHS" as const;
export const HAMMER_FIRST_RUN_BANNER_ENV = "HAMMER_FIRST_RUN_BANNER" as const;
export const HAMMER_RTK_DISABLED_ENV = "HAMMER_RTK_DISABLED" as const;
export const HAMMER_RTK_PATH_ENV = "HAMMER_RTK_PATH" as const;
export const HAMMER_SKIP_RTK_INSTALL_ENV = "HAMMER_SKIP_RTK_INSTALL" as const;

export const HAMMER_LEGACY_ENV_ALIASES = {
  home: "GSD_HOME",
  stateDir: "GSD_STATE_DIR",
  projectId: "GSD_PROJECT_ID",
  codingAgentDir: "GSD_CODING_AGENT_DIR",
  pkgRoot: "GSD_PKG_ROOT",
  version: "GSD_VERSION",
  binPath: "GSD_BIN_PATH",
  workflowPath: "GSD_WORKFLOW_PATH",
  bundledExtensionPaths: "GSD_BUNDLED_EXTENSION_PATHS",
  firstRunBanner: "GSD_FIRST_RUN_BANNER",
  rtkDisabled: "GSD_RTK_DISABLED",
  rtkPath: "GSD_RTK_PATH",
  skipRtkInstall: "GSD_SKIP_RTK_INSTALL",
} as const;

export const HAMMER_PUBLIC_TOOL_PREFIX = "hammer_" as const;
export const HAMMER_MCP_SERVER_NAME = "hammer" as const;
export const HAMMER_WORKFLOW_EXTENSION_ID = "hammer" as const;
export const HAMMER_WORKFLOW_EXTENSION_NAME = "Hammer Workflow" as const;

export const HAMMER_ENV_VARS = {
  home: HAMMER_HOME_ENV,
  stateDir: HAMMER_STATE_DIR_ENV,
  projectId: HAMMER_PROJECT_ID_ENV,
} as const;

export const HAMMER_RUNTIME_ENV_VARS = {
  codingAgentDir: HAMMER_CODING_AGENT_DIR_ENV,
  pkgRoot: HAMMER_PKG_ROOT_ENV,
  version: HAMMER_VERSION_ENV,
  binPath: HAMMER_BIN_PATH_ENV,
  workflowPath: HAMMER_WORKFLOW_PATH_ENV,
  bundledExtensionPaths: HAMMER_BUNDLED_EXTENSION_PATHS_ENV,
  firstRunBanner: HAMMER_FIRST_RUN_BANNER_ENV,
  rtkDisabled: HAMMER_RTK_DISABLED_ENV,
  rtkPath: HAMMER_RTK_PATH_ENV,
  skipRtkInstall: HAMMER_SKIP_RTK_INSTALL_ENV,
} as const;

export const HAMMER_STATE_IDENTITY = {
  projectStateDirName: HAMMER_STATE_DIR_NAME,
  globalHomeDirName: HAMMER_GLOBAL_HOME_DIR_NAME,
  projectMarkerFile: HAMMER_PROJECT_MARKER_FILE,
  env: HAMMER_ENV_VARS,
} as const;

export const HAMMER_CANONICAL_IDENTITY = {
  productName: HAMMER_PRODUCT_NAME,
  displayName: HAMMER_DISPLAY_NAME,
  packageName: HAMMER_PACKAGE_NAME,
  cliCommand: HAMMER_CLI_COMMAND,
  cliWrapperCommand: HAMMER_CLI_WRAPPER_COMMAND,
  slashCommand: HAMMER_SLASH_COMMAND,
  legacyCliAliases: [HAMMER_LEGACY_CLI_COMMAND, HAMMER_LEGACY_CLI_WRAPPER_COMMAND, HAMMER_LEGACY_PACKAGE_BIN_COMMAND],
  state: HAMMER_STATE_IDENTITY,
  runtimeEnv: HAMMER_RUNTIME_ENV_VARS,
  legacyEnvAliases: HAMMER_LEGACY_ENV_ALIASES,
  mcpServerName: HAMMER_MCP_SERVER_NAME,
  workflowExtensionId: HAMMER_WORKFLOW_EXTENSION_ID,
  workflowExtensionName: HAMMER_WORKFLOW_EXTENSION_NAME,
  publicToolPrefix: HAMMER_PUBLIC_TOOL_PREFIX,
} as const;

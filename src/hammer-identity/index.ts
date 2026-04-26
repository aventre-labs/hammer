export const HAMMER_PRODUCT_NAME = "hammer" as const;
export const HAMMER_DISPLAY_NAME = "Hammer" as const;
export const HAMMER_PACKAGE_NAME = "hammer-pi" as const;

export const HAMMER_CLI_COMMAND = "hammer" as const;
export const HAMMER_SLASH_COMMAND = "/hammer" as const;

export const HAMMER_STATE_DIR_NAME = ".hammer" as const;
export const HAMMER_GLOBAL_HOME_DIR_NAME = ".hammer" as const;
export const HAMMER_PROJECT_MARKER_FILE = ".hammer-id" as const;

export const HAMMER_HOME_ENV = "HAMMER_HOME" as const;
export const HAMMER_STATE_DIR_ENV = "HAMMER_STATE_DIR" as const;
export const HAMMER_PROJECT_ID_ENV = "HAMMER_PROJECT_ID" as const;

export const HAMMER_PUBLIC_TOOL_PREFIX = "hammer_" as const;
export const HAMMER_MCP_SERVER_NAME = "hammer" as const;
export const HAMMER_WORKFLOW_EXTENSION_ID = "hammer" as const;
export const HAMMER_WORKFLOW_EXTENSION_NAME = "Hammer Workflow" as const;

export const HAMMER_ENV_VARS = {
  home: HAMMER_HOME_ENV,
  stateDir: HAMMER_STATE_DIR_ENV,
  projectId: HAMMER_PROJECT_ID_ENV,
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
  slashCommand: HAMMER_SLASH_COMMAND,
  state: HAMMER_STATE_IDENTITY,
  mcpServerName: HAMMER_MCP_SERVER_NAME,
  workflowExtensionId: HAMMER_WORKFLOW_EXTENSION_ID,
  workflowExtensionName: HAMMER_WORKFLOW_EXTENSION_NAME,
  publicToolPrefix: HAMMER_PUBLIC_TOOL_PREFIX,
} as const;

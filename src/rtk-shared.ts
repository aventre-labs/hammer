import { existsSync } from "node:fs";
import { homedir as osHomedir } from "node:os";
import { delimiter, join } from "node:path";
import {
  HAMMER_HOME_ENV,
  HAMMER_LEGACY_ENV_ALIASES,
  HAMMER_RTK_DISABLED_ENV,
  HAMMER_RTK_PATH_ENV,
} from "./hammer-identity/index.js";

export { HAMMER_RTK_DISABLED_ENV, HAMMER_RTK_PATH_ENV };
export const GSD_RTK_DISABLED_ENV = HAMMER_LEGACY_ENV_ALIASES.rtkDisabled; // legacy alias export for HAMMER_RTK_DISABLED compatibility
export const GSD_RTK_PATH_ENV = HAMMER_LEGACY_ENV_ALIASES.rtkPath; // legacy alias export for HAMMER_RTK_PATH compatibility
export const RTK_TELEMETRY_DISABLED_ENV = "RTK_TELEMETRY_DISABLED";

export function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function readEnvWithLegacyAlias(
  env: NodeJS.ProcessEnv,
  canonicalName: string,
  legacyAliasName: string,
): string | undefined {
  const canonicalValue = env[canonicalName];
  if (canonicalValue) {
    env[legacyAliasName] ??= canonicalValue;
    return canonicalValue;
  }

  const legacyValue = env[legacyAliasName];
  if (legacyValue) {
    env[canonicalName] = legacyValue;
    return legacyValue;
  }

  return undefined;
}

export function isRtkEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !isTruthy(readEnvWithLegacyAlias(env, HAMMER_RTK_DISABLED_ENV, GSD_RTK_DISABLED_ENV));
}

export function getManagedRtkDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = readEnvWithLegacyAlias(env, HAMMER_HOME_ENV, HAMMER_LEGACY_ENV_ALIASES.home) ?? join(osHomedir(), ".hammer");
  return join(home, "agent", "bin");
}

export function getRtkBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "rtk.exe" : "rtk";
}

export function getPathValue(env: NodeJS.ProcessEnv): string | undefined {
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path");
  return pathKey ? env[pathKey] : env.PATH;
}

export function resolvePathCandidates(pathValue: string | undefined): string[] {
  if (!pathValue) return [];
  return pathValue
    .split(delimiter)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function resolveSystemRtkPath(
  pathValue: string | undefined,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const candidates = platform === "win32"
    ? ["rtk.exe", "rtk.cmd", "rtk.bat", "rtk"]
    : ["rtk"];

  for (const dir of resolvePathCandidates(pathValue)) {
    for (const candidate of candidates) {
      const fullPath = join(dir, candidate);
      if (existsSync(fullPath)) {
        return fullPath;
      }
    }
  }

  return null;
}

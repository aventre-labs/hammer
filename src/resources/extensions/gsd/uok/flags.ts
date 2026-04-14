import type { GSDPreferences } from "../preferences.js";
import { loadEffectiveGSDPreferences } from "../preferences.js";

export interface UokFlags {
  enabled: boolean;
  gates: boolean;
  modelPolicy: boolean;
  executionGraph: boolean;
  gitops: boolean;
  gitopsTurnAction: "commit" | "snapshot" | "status-only";
  gitopsTurnPush: boolean;
  auditUnified: boolean;
  planV2: boolean;
}

export function resolveUokFlags(prefs: GSDPreferences | undefined): UokFlags {
  const uok = prefs?.uok;
  return {
    enabled: uok?.enabled === true,
    gates: uok?.gates?.enabled === true,
    modelPolicy: uok?.model_policy?.enabled === true,
    executionGraph: uok?.execution_graph?.enabled === true,
    gitops: uok?.gitops?.enabled === true,
    gitopsTurnAction: uok?.gitops?.turn_action ?? "status-only",
    gitopsTurnPush: uok?.gitops?.turn_push === true,
    auditUnified: uok?.audit_unified?.enabled === true,
    planV2: uok?.plan_v2?.enabled === true,
  };
}

export function loadUokFlags(): UokFlags {
  const prefs = loadEffectiveGSDPreferences()?.preferences;
  return resolveUokFlags(prefs);
}

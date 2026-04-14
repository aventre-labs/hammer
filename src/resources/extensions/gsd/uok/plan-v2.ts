import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { GSDState } from "../types.js";
import { gsdRoot } from "../paths.js";
import { isDbAvailable, getMilestoneSlices, getSliceTasks } from "../gsd-db.js";
import type { UokGraphNode } from "./contracts.js";

export interface PlanV2CompileResult {
  ok: boolean;
  reason?: string;
  graphPath?: string;
  nodeCount?: number;
}

function graphOutputPath(basePath: string): string {
  return join(gsdRoot(basePath), "runtime", "uok-plan-v2-graph.json");
}

export function compileUnitGraphFromState(basePath: string, state: GSDState): PlanV2CompileResult {
  const mid = state.activeMilestone?.id;
  if (!mid) return { ok: false, reason: "no active milestone" };
  if (!isDbAvailable()) return { ok: false, reason: "database not available" };

  const slices = getMilestoneSlices(mid).sort((a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0));
  const nodes: UokGraphNode[] = [];

  for (const slice of slices) {
    const sid = slice.id;
    const tasks = getSliceTasks(mid, sid)
      .sort((a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0));

    let previousTaskNodeId: string | null = null;
    for (const task of tasks) {
      const nodeId = `execute-task:${mid}:${sid}:${task.id}`;
      const dependsOn = previousTaskNodeId ? [previousTaskNodeId] : [];
      nodes.push({
        id: nodeId,
        kind: "unit",
        dependsOn,
        writes: task.key_files,
        metadata: {
          unitType: "execute-task",
          unitId: `${mid}.${sid}.${task.id}`,
          title: task.title,
          status: task.status,
        },
      });
      previousTaskNodeId = nodeId;
    }

    if (previousTaskNodeId) {
      nodes.push({
        id: `complete-slice:${mid}:${sid}`,
        kind: "verification",
        dependsOn: [previousTaskNodeId],
        metadata: {
          unitType: "complete-slice",
          unitId: `${mid}.${sid}`,
          title: slice.title,
          status: slice.status,
        },
      });
    }
  }

  const output = {
    compiledAt: new Date().toISOString(),
    milestoneId: mid,
    nodes,
  };

  const outPath = graphOutputPath(basePath);
  mkdirSync(join(gsdRoot(basePath), "runtime"), { recursive: true });
  writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n", "utf-8");

  return { ok: true, graphPath: outPath, nodeCount: nodes.length };
}

export function ensurePlanV2Graph(basePath: string, state: GSDState): PlanV2CompileResult {
  const compiled = compileUnitGraphFromState(basePath, state);
  if (!compiled.ok) return compiled;
  if ((compiled.nodeCount ?? 0) <= 0) {
    return { ok: false, reason: "compiled graph is empty" };
  }
  return compiled;
}

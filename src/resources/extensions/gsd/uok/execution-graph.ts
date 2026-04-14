import type { UokGraphNode } from "./contracts.js";

export interface ExecutionGraphRunOptions {
  parallel?: boolean;
  maxWorkers?: number;
}

export interface ExecutionGraphResult {
  order: string[];
  conflicts: Array<{ nodeA: string; nodeB: string; file: string }>;
}

export type ExecutionNodeHandler = (node: UokGraphNode) => Promise<void>;

export class ExecutionGraphScheduler {
  private readonly handlers = new Map<string, ExecutionNodeHandler>();

  registerHandler(kind: UokGraphNode["kind"], handler: ExecutionNodeHandler): void {
    this.handlers.set(kind, handler);
  }

  async run(nodes: UokGraphNode[], options?: ExecutionGraphRunOptions): Promise<ExecutionGraphResult> {
    const sorted = topologicalSort(nodes);
    const conflicts = detectFileConflicts(nodes);

    // Default deterministic serial execution remains the reference path.
    if (!options?.parallel) {
      for (const node of sorted) {
        const handler = this.handlers.get(node.kind);
        if (handler) await handler(node);
      }
      return { order: sorted.map((n) => n.id), conflicts };
    }

    // Parallel mode only for nodes whose dependencies are already satisfied.
    const maxWorkers = Math.max(1, Math.min(8, options.maxWorkers ?? 2));
    const remaining = new Map(nodes.map((n) => [n.id, n]));
    const done = new Set<string>();
    const order: string[] = [];

    while (remaining.size > 0) {
      const ready = Array.from(remaining.values()).filter((node) =>
        node.dependsOn.every((dep) => done.has(dep)),
      );
      if (ready.length === 0) {
        throw new Error("Execution graph deadlock detected: no ready nodes and graph not complete");
      }

      const batch = ready.slice(0, maxWorkers);
      await Promise.all(
        batch.map(async (node) => {
          const handler = this.handlers.get(node.kind);
          if (handler) await handler(node);
          done.add(node.id);
          order.push(node.id);
          remaining.delete(node.id);
        }),
      );
    }

    return { order, conflicts };
  }
}

function topologicalSort(nodes: UokGraphNode[]): UokGraphNode[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const inDegree = new Map(nodes.map((n) => [n.id, 0]));

  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (nodeMap.has(dep)) {
        inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1);
      }
    }
  }

  const queue = nodes
    .filter((n) => (inDegree.get(n.id) ?? 0) === 0)
    .sort((a, b) => a.id.localeCompare(b.id));
  const ordered: UokGraphNode[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    ordered.push(current);

    for (const next of nodes) {
      if (!next.dependsOn.includes(current.id)) continue;
      const deg = (inDegree.get(next.id) ?? 0) - 1;
      inDegree.set(next.id, deg);
      if (deg === 0) {
        queue.push(next);
        queue.sort((a, b) => a.id.localeCompare(b.id));
      }
    }
  }

  if (ordered.length !== nodes.length) {
    throw new Error("Execution graph has cyclic dependencies");
  }

  return ordered;
}

function detectFileConflicts(nodes: UokGraphNode[]): Array<{ nodeA: string; nodeB: string; file: string }> {
  const conflicts: Array<{ nodeA: string; nodeB: string; file: string }> = [];
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    const writesA = new Set(a.writes ?? []);
    if (writesA.size === 0) continue;

    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      for (const file of b.writes ?? []) {
        if (writesA.has(file)) {
          conflicts.push({ nodeA: a.id, nodeB: b.id, file });
        }
      }
    }
  }
  return conflicts;
}

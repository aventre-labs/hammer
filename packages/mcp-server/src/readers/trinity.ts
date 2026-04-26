export const TRINITY_LAYERS = ['social', 'knowledge', 'generative'] as const;
export type TrinityLayer = (typeof TRINITY_LAYERS)[number];

export const VALID_TRINITY_VALIDATION_STATES = [
  'unvalidated',
  'validated',
  'contested',
  'deprecated',
] as const;
export type TrinityValidationState = (typeof VALID_TRINITY_VALIDATION_STATES)[number];

export interface TrinitySourceRelation {
  type: string;
  targetId: string;
  targetKind?: string;
  weight?: number;
}

export interface TrinityMetadata {
  layer: TrinityLayer;
  ity: Record<string, number>;
  pathy: Record<string, number>;
  provenance: {
    sourceId?: string;
    artifactPath?: string;
    sourceRelations: TrinitySourceRelation[];
  };
  validation: {
    state: TrinityValidationState;
    score: number;
  };
}

const TYPE_LAYER_DEFAULTS: Record<string, TrinityLayer> = {
  milestone: 'knowledge',
  slice: 'generative',
  task: 'generative',
  rule: 'knowledge',
  pattern: 'generative',
  lesson: 'knowledge',
  concept: 'knowledge',
  surprise: 'knowledge',
};

function layerForType(type: string): TrinityLayer {
  return TYPE_LAYER_DEFAULTS[type] ?? 'knowledge';
}

function scoreForConfidence(confidence: string): number {
  if (confidence === 'EXTRACTED') return 1;
  if (confidence === 'INFERRED') return 0.6;
  return 0.3;
}

export function buildGraphNodeTrinity(input: {
  id: string;
  type: string;
  confidence: string;
  sourceFile?: string;
}): TrinityMetadata {
  return {
    layer: layerForType(input.type),
    ity: {},
    pathy: {},
    provenance: {
      sourceId: input.id,
      ...(input.sourceFile ? { artifactPath: input.sourceFile } : {}),
      sourceRelations: input.sourceFile
        ? [{ type: 'derived_from', targetId: input.sourceFile, targetKind: 'artifact', weight: 1 }]
        : [],
    },
    validation: {
      state: input.confidence === 'AMBIGUOUS' ? 'unvalidated' : 'validated',
      score: scoreForConfidence(input.confidence),
    },
  };
}

export function withGraphNodeTrinity<T extends {
  id: string;
  type: string;
  confidence: string;
  sourceFile?: string;
  trinity?: TrinityMetadata;
}>(node: T): T & { trinity: TrinityMetadata } {
  return {
    ...node,
    trinity: node.trinity ?? buildGraphNodeTrinity(node),
  };
}

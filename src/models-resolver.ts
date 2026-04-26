/**
 * Models.json resolution with fallback to ~/.pi/agent/models.json
 *
 * Hammer uses ~/.hammer/agent/models.json, but for a smooth migration/development
 * experience, this module provides resolution logic that:
 *
 * 1. Reads ~/.hammer/agent/models.json if it exists
 * 2. Falls back to ~/.pi/agent/models.json if Hammer file doesn't exist
 * 3. Merges both files if both exist (Hammer takes precedence)
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { agentDir } from './app-paths.js'

const HAMMER_MODELS_PATH = join(agentDir, 'models.json') // agentDir resolves to .hammer/agent — bootstrap-migration
const GSD_MODELS_PATH = HAMMER_MODELS_PATH // legacy alias for compatibility — legacy-alias
const PI_MODELS_PATH = join(homedir(), '.pi', 'agent', 'models.json')

/**
 * Resolve the path to models.json with fallback logic.
 *
 * Priority:
 * 1. ~/.hammer/agent/models.json (exists) → return this path
 * 2. ~/.pi/agent/models.json (exists) → return this path (fallback)
 * 3. Neither exists → return Hammer path (will be created)
 *
 * @returns The path to use for models.json
 */
export function resolveModelsJsonPath(): string {
  if (existsSync(HAMMER_MODELS_PATH)) {
    return HAMMER_MODELS_PATH
  }
  if (existsSync(PI_MODELS_PATH)) {
    return PI_MODELS_PATH
  }
  return HAMMER_MODELS_PATH
}



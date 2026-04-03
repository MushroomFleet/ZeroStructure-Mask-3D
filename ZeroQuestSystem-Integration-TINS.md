# ZeroQuestSystem Integration — TINS README

<!-- TINS Specification v1.0 -->
<!-- ZS:COMPLEXITY:HIGH -->
<!-- ZS:PRIORITY:HIGH -->
<!-- ZS:PLATFORM:WEB,DESKTOP,MOBILE -->
<!-- ZS:LANGUAGE:TYPESCRIPT -->
<!-- ZS:FAMILY:ZeroFamily -->

---

## Description

ZeroQuest is a deterministic, position-is-seed procedural quest generation system belonging to the ZeroFamily of game development tools. It generates complete mission narratives — type, timer, briefing, stage coordinates, success line, failure line, and in-mission chatter — from a single input: the objective's world coordinate. The position is the quest. No quest data is ever stored, transmitted, or loaded. The same coordinate always produces the same quest, across every machine, every session, every game reload.

ZeroQuest is composed of three stacked layers. The bottom layer is the ZeroBytes position-hash engine, which uses xxhash32 to convert a world coordinate into a 32-bit unsigned integer seed. The middle layer is the ZeroResponse text engine, which uses that seed to fill narrative templates from vocabulary pool arrays. The top layer is ZeroQuest itself, which classifies the seed into one of four quest archetypes, derives mission parameters (timer, difficulty, stage coordinates), and orchestrates the text engine across six distinct narrative layers (briefing, objective label, stage prompt, success, failure, in-mission chatter). Narrative vocabulary is supplied by swappable JSON profiles, allowing any game world or lore context to be applied without modifying the engine.

This document is a complete TINS implementation specification. An AI model reading this document has everything required to produce a working, tested, production-ready TypeScript implementation with no external references. The document covers file structure, all type definitions, all algorithms with complete code, all data files with full content, integration patterns for new and existing codebases, and a full verification suite.

---

## Functionality

### Core Feature: `generateQuest(x, y, z, worldSeed?, profileName?)`

The single public function of the ZeroQuest module. Accepts a world coordinate and optional parameters, returns a fully-formed `QuestResult` object. This call is synchronous, O(1), allocates no external resources, makes no network requests, and reads no files at runtime (profiles are loaded once at module initialisation). Target performance: under 0.5ms per call.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `x` | `number` (integer) | Yes | — | World X coordinate of objective |
| `y` | `number` (integer) | Yes | — | World Y coordinate of objective |
| `z` | `number` (integer) | Yes | — | World Z / depth coordinate of objective |
| `worldSeed` | `number` (integer) | No | `0` | Global campaign seed — shifts the entire quest universe |
| `profileName` | `string` | No | `"default"` | Name key of the narrative profile to use |

**Output — `QuestResult` object:**

```typescript
{
  questType:       "PROTECT_HOME" | "PROTECT_POI" | "DATA_DUMP" | "STRONGHOLD",
  questSeed:       number,        // 32-bit unsigned int derived from position
  questNarrative:  string,        // Full narrative briefing sentence(s)
  objectiveLabel:  string,        // Short HUD/map label (5–12 words)
  timer:           number | null, // Mission timer in seconds, null for STRONGHOLD
  stages:          QuestStage[],  // Array of 1–3 stage objects
  successLine:     string,        // Text shown on mission complete
  failureLine:     string,        // Text shown on mission fail
  inMissionLine:   string,        // Optional radio/chatter line mid-mission
  typeIndex:       number,        // 0–3, questSeed % 4, used for debugging
  difficulty:      number,        // 0.0–1.0 float derived from seed
}
```

**Output — `QuestStage` object (one per stage):**

```typescript
{
  stageIndex:   number,                    // 0, 1, or 2
  stageSeed:    number,                    // 32-bit seed for this stage
  coordinates:  [number, number, number],  // World position [x, y, z]
  stageTimer:   number | null,             // Per-stage seconds (DATA_DUMP only)
  stagePrompt:  string,                    // Narrative instruction for this stage
}
```

### Quest Type Taxonomy

Four quest archetypes are supported. Type is selected deterministically by `questSeed % 4`.

**PROTECT_HOME (index 0)**
The player's home / spawn coordinate is under attack. Enemy waves arrive procedurally. Clear all enemies before the timer expires. Timer range: 60–180 seconds (derived from seed). Single stage. Anchor: player home coordinate passed as objective.

**PROTECT_POI (index 1)**
A remote Point of Interest at the objective coordinate is under threat. Player must travel to it and clear all enemies before timer expires. Timer range: 90–240 seconds (derived from seed). Single stage. Anchor: objective coordinate.

**DATA_DUMP (index 2)**
A three-stage sequential mission. The player must defend three uplink/data-collection points in order. Stage 1 is at the objective coordinate. Stages 2 and 3 are at coordinates derived from the original quest seed using ZeroBytes child-seed hierarchy. Each stage has an independent per-stage timer (30–60 seconds, derived from stage seed). The player must complete all three stages in order without abandoning any stage mid-transfer.

**STRONGHOLD (index 3)**
An assault mission against a fortified enemy position at the objective coordinate. No timer. The player must eliminate all defenders and a boss-tier commander. Difficulty and boss tier are derived from the quest seed. Failure only on player death.

### ZeroBytes Five Laws — Compliance Requirements

Every function and data structure in ZeroQuest must satisfy all five ZeroBytes laws. These are non-negotiable architectural constraints.

1. **O(1) Access** — any quest at any coordinate must be computable in constant time with no iteration over preceding coordinates or stored state.
2. **Parallelism** — each quest and each stage must depend only on its own coordinates, never on sibling quests or adjacent positions during generation.
3. **Coherence** — adjacent coordinates must produce completely unrelated seeds (no spatial correlation in quest type). Regional tone bias (optional) uses coherent noise as a separate post-hash overlay and does not affect the base generation.
4. **Hierarchy** — DATA_DUMP child stage seeds must derive exclusively from the parent quest seed plus the stage index, using `xxhash32([parentSeed, stageIndex, 0], worldSeed)`.
5. **Determinism** — identical inputs must produce identical outputs across all machines, operating systems, JavaScript engines, and execution orders. No platform `hash()`, no `Math.random()`, no `Date.now()`, no global counters.

### Forbidden Patterns

The following patterns violate ZeroBytes laws and must never appear in any ZeroQuest implementation:

```typescript
// FORBIDDEN — stores quest data (Law 1 violation: breaks O(1) regeneration)
questCache.set(`${x},${y},${z}`, quest);

// FORBIDDEN — sequential stage assignment (Law 4 violation)
stages[i] = stages[i - 1].nextStage();

// FORBIDDEN — platform hash (Law 5 violation: non-deterministic across engines)
seed = hash(`${x},${y},${z}`);

// FORBIDDEN — random timer (Law 5 violation)
timer = Math.random() * 120;

// FORBIDDEN — global mutable counter (Law 5 violation)
stagesSeen++;

// FORBIDDEN — time-based seed (Law 5 violation)
seed = Date.now() ^ (x * 31337);
```

### Narrative Profile System

All text output is driven by swappable JSON profiles. A profile defines templates and vocabulary pools for all four quest types and all six narrative layers. Profiles are loaded once at module startup and referenced by name key in the registry. The default profile is genre-neutral. Custom profiles (e.g., the Paradistro profile) are dropped in as additional JSON files and registered in `registry.ts`.

Templates use `{placeholder}` syntax. Each placeholder corresponds to a named pool array. The engine selects one entry from each pool deterministically using the layer-specific hash.

**Example template:** `"{urgency_opener} — {threat_description}. {action_directive}."`
**Example pool:** `"urgency_opener": ["ALERT", "INCOMING", "DEFENSE REQUIRED", "PERIMETER BREACH"]`

### User Interface Layout (Integration Reference)

ZeroQuest has no UI of its own — it is a pure data module. The expected integration points in a game engine are:

```
┌─────────────────────────────────────────────────────────────────┐
│ QUEST SCREEN (triggered by: entering objective zone, NPC event) │
├─────────────────────────────────────────────────────────────────┤
│ [QUEST TYPE BADGE]          [TIMER — if applicable]             │
│ Objective Label (HUD)                                           │
├─────────────────────────────────────────────────────────────────┤
│ Mission Briefing (1–3 sentences, quest.questNarrative)          │
├─────────────────────────────────────────────────────────────────┤
│ Stage list (DATA_DUMP only):                                    │
│   01 · coords (x,y,z) · stage prompt · XXs hold                │
│   02 · coords (x,y,z) · stage prompt · XXs hold                │
│   03 · coords (x,y,z) · stage prompt · XXs hold                │
├─────────────────────────────────────────────────────────────────┤
│ [ACCEPT]  [DECLINE]                                             │
└─────────────────────────────────────────────────────────────────┘

IN-MISSION:
  · quest.inMissionLine → radio/chatter box at mission start
  · Timer countdown from quest.timer (or stage.stageTimer for DATA_DUMP)

ON COMPLETE:
  · quest.successLine → mission complete overlay

ON FAIL:
  · quest.failureLine → mission fail overlay
```

### Edge Cases and Error States

**Invalid or non-integer coordinates:** Truncate to integer using bitwise OR 0 before hashing. `x = x | 0`. Never throw on non-integer input.

**Negative coordinates:** Fully supported. xxhash32 handles negative integers correctly when packed as signed 32-bit via `struct.pack` / typed array.

**Zero coordinate `(0, 0, 0)`:** Valid. Produces a deterministic quest. Not a special case.

**Very large coordinates:** Coordinates outside the range ±2,147,483,647 should be clamped before hashing. Document this limit clearly in the public API.

**Unknown profile name:** Fall back silently to the default profile and log a warning. Never throw at quest generation time.

**Missing pool key in template placeholder:** Skip the replacement — leave the placeholder token in the output. Log a warning. Never throw.

**`worldSeed` as float:** Truncate with `Math.trunc()` before use.

**DATA_DUMP stage coordinate collision:** Theoretically possible but statistically negligible (32-bit hash space). No special handling required — identical stage coordinates would simply mean the player visits the same location twice.

---

## Technical Implementation

### File Structure

Produce the following complete file tree. Every file listed must be implemented in full with no stubs or TODOs.

```
src/
└── quest/
    ├── index.ts              ← Public API surface
    ├── engine.ts             ← xxhash32 + seed derivation + quest core
    ├── narrative.ts          ← Template fill + layer orchestration
    ├── types.ts              ← All TypeScript type definitions
    ├── registry.ts           ← Profile registry + lookup
    └── profiles/
        ├── ZeroQuest-Default.json
        └── ZeroQuest-Paradistro.json
```

Additionally, produce:

```
src/quest/__tests__/
    ├── determinism.test.ts   ← Determinism + reproducibility suite
    ├── distribution.test.ts  ← Quest type distribution across coordinate ranges
    └── edge-cases.test.ts    ← Invalid input handling
```

---

### File: `src/quest/types.ts`

Complete type definitions for the module. No runtime code — types only.

```typescript
// ─────────────────────────────────────────────────────────────
// ZeroQuest — Type Definitions
// Part of the ZeroFamily procedural generation suite
// ─────────────────────────────────────────────────────────────

export type QuestType =
  | "PROTECT_HOME"
  | "PROTECT_POI"
  | "DATA_DUMP"
  | "STRONGHOLD";

// All four quest types in seed-order (questSeed % 4 → index)
export const QUEST_TYPE_ORDER: QuestType[] = [
  "PROTECT_HOME",  // 0
  "PROTECT_POI",   // 1
  "DATA_DUMP",     // 2
  "STRONGHOLD",    // 3
];

export interface QuestStage {
  stageIndex:  number;
  stageSeed:   number;
  coordinates: [number, number, number];
  stageTimer:  number | null;
  stagePrompt: string;
}

export interface QuestResult {
  questType:      QuestType;
  questSeed:      number;
  questNarrative: string;
  objectiveLabel: string;
  timer:          number | null;
  stages:         QuestStage[];
  successLine:    string;
  failureLine:    string;
  inMissionLine:  string;
  typeIndex:      number;
  difficulty:     number;
}

// ── Profile schema ────────────────────────────────────────────

export interface NarrativeLayer {
  templates: string[];
  pools:     Record<string, string[]>;
}

export interface QuestProfile {
  name:        string;
  description: string;
  version:     string;
  PROTECT_HOME: NarrativeLayer;
  PROTECT_POI:  NarrativeLayer;
  DATA_DUMP:    NarrativeLayer;
  STRONGHOLD:   NarrativeLayer;
  briefing:     NarrativeLayer;
  objective_label: NarrativeLayer;
  stage_prompt:  NarrativeLayer;
  success:       NarrativeLayer;
  failure:       NarrativeLayer;
  in_mission:    NarrativeLayer;
}

// ── Timer configuration per quest type ───────────────────────

export interface TimerConfig {
  min:      number;
  max:      number;
  perStage: boolean;
}

export const TIMER_CONFIG: Record<QuestType, TimerConfig | null> = {
  PROTECT_HOME: { min: 60,  max: 180, perStage: false },
  PROTECT_POI:  { min: 90,  max: 240, perStage: false },
  DATA_DUMP:    { min: 30,  max: 60,  perStage: true  },
  STRONGHOLD:   null,
};

// ── Layer salt constants ──────────────────────────────────────
// Each narrative layer uses a unique salt to prevent cross-layer
// hash collisions from the same quest seed.

export const LAYER_SALTS = {
  briefing:        1000,
  objective_label: 2000,
  stage_prompt:    3000,
  success:         4000,
  failure:         5000,
  in_mission:      6000,
  timer:           9000,
  difficulty:      9100,
} as const;
```

---

### File: `src/quest/engine.ts`

The complete xxhash32 implementation and all seed derivation functions. This is the ZeroBytes layer — no text generation, no profile access.

```typescript
// ─────────────────────────────────────────────────────────────
// ZeroQuest Engine — xxhash32 + Seed Derivation
// ZeroBytes position-is-seed implementation
//
// All hash operations use xxhash32 with fixed salts.
// No Math.random(), no Date.now(), no platform hash().
// Same inputs → same outputs on every machine, always.
// ─────────────────────────────────────────────────────────────

// xxhash32 prime constants — do not modify
const PRIME1 = 0x9E3779B1;
const PRIME2 = 0x85EBCA77;
const PRIME3 = 0xC2B2AE3D;
const PRIME4 = 0x27D4EB2F;
const PRIME5 = 0x165667B1;

/**
 * Rotate a 32-bit unsigned integer left by r bits.
 * Uses unsigned right shift (>>>) to ensure 32-bit unsigned behaviour.
 */
function rotl32(x: number, r: number): number {
  return ((x << r) | (x >>> (32 - r))) >>> 0;
}

/**
 * 32-bit integer multiply using Math.imul for correct 32-bit wrap-around.
 * JavaScript's standard * operator uses 64-bit float and loses low bits.
 */
function mul32(a: number, b: number): number {
  return Math.imul(a, b) >>> 0;
}

/**
 * xxhash32 — fast, deterministic, non-cryptographic 32-bit hash.
 *
 * @param data   Array of integers to hash (treated as 32-bit values)
 * @param seed   Initial seed (default 0)
 * @returns      32-bit unsigned integer hash
 *
 * This is the canonical ZeroBytes hash function. It must be used for
 * ALL seed derivation. Never substitute with a different hash function.
 */
export function xxhash32(data: number[], seed: number = 0): number {
  seed = seed >>> 0;
  let i = 0;
  let h32: number;

  if (data.length >= 4) {
    let v1 = (seed + PRIME1 + PRIME2) >>> 0;
    let v2 = (seed + PRIME2)          >>> 0;
    let v3 = seed                     >>> 0;
    let v4 = (seed - PRIME1)          >>> 0;

    do {
      v1 = mul32(rotl32((v1 + mul32(data[i]   >>> 0, PRIME2)) >>> 0, 13), PRIME1);
      v2 = mul32(rotl32((v2 + mul32(data[i+1] >>> 0, PRIME2)) >>> 0, 13), PRIME1);
      v3 = mul32(rotl32((v3 + mul32(data[i+2] >>> 0, PRIME2)) >>> 0, 13), PRIME1);
      v4 = mul32(rotl32((v4 + mul32(data[i+3] >>> 0, PRIME2)) >>> 0, 13), PRIME1);
      i += 4;
    } while (i <= data.length - 4);

    h32 = (rotl32(v1, 1) + rotl32(v2, 7) + rotl32(v3, 12) + rotl32(v4, 18)) >>> 0;
  } else {
    h32 = (seed + PRIME5) >>> 0;
  }

  h32 = (h32 + (data.length * 4)) >>> 0;

  while (i < data.length) {
    h32 = mul32(rotl32((h32 + mul32(data[i] >>> 0, PRIME3)) >>> 0, 17), PRIME4);
    i++;
  }

  h32 = mul32(h32 ^ (h32 >>> 15), PRIME2);
  h32 = mul32(h32 ^ (h32 >>> 13), PRIME3);
  h32 = (h32 ^ (h32 >>> 16)) >>> 0;

  return h32;
}

/**
 * Convert a 32-bit hash to a float in the range [0, 1).
 * Used for deriving normalised values (timers, difficulty, etc.)
 */
export function hashToFloat(h: number): number {
  return (h >>> 0) / 0x100000000;
}

/**
 * Derive the primary quest seed from a world coordinate.
 * This is the root of the entire quest universe for this position.
 *
 * @param x          World X coordinate (integer)
 * @param y          World Y coordinate (integer)
 * @param z          World Z coordinate (integer)
 * @param worldSeed  Global campaign seed (default 0)
 */
export function positionToQuestSeed(
  x: number,
  y: number,
  z: number,
  worldSeed: number = 0,
): number {
  // Truncate to integer — fractional coordinates are not valid
  return xxhash32([x | 0, y | 0, z | 0], worldSeed >>> 0);
}

/**
 * Derive a layer-specific seed from the quest seed.
 * Each narrative layer uses a unique salt to prevent cross-layer
 * hash collisions. Using the same quest seed for briefing AND
 * success text without a salt would cause both to select the
 * same template index from their respective arrays.
 *
 * Salt values are defined in LAYER_SALTS in types.ts.
 */
export function layerSeed(questSeed: number, salt: number): number {
  return xxhash32([questSeed >>> 0, salt >>> 0], 0);
}

/**
 * Derive the seed for a DATA_DUMP chain stage.
 * Child seeds follow the ZeroBytes hierarchy pattern:
 *   childSeed = hash(parentSeed, stageIndex, 0)
 *
 * Stage 0 always uses the parent quest seed directly.
 * Stages 1 and 2 derive from the parent via this function.
 */
export function stageSeed(
  parentQuestSeed: number,
  stageIndex: number,
  worldSeed: number = 0,
): number {
  if (stageIndex === 0) return parentQuestSeed;
  return xxhash32([parentQuestSeed >>> 0, stageIndex, 0], worldSeed >>> 0);
}

/**
 * Derive world coordinates for a DATA_DUMP child stage.
 * Coordinates are bounded to ±4095 to keep stages within
 * a reasonable world region near the origin quest.
 *
 * The coordinate derivation uses three separate hashes per axis
 * to ensure x, y, z are independent.
 */
export function stageCoordinatesFromSeed(
  seed: number,
): [number, number, number] {
  const hx = xxhash32([seed, 101], 0);
  const hy = xxhash32([seed, 102], 0);
  const hz = xxhash32([seed, 103], 0);
  const x  = (hx % 4096) - 2048;   // Range: -2048 to +2047
  const y  = (hy % 4096) - 2048;
  const z  = (hz % 16);             // Range: 0 to 15 (shallow depth)
  return [x, y, z];
}

/**
 * Derive a timer value in seconds from a quest or stage seed.
 *
 * @param seed  Quest or stage seed
 * @param salt  Layer salt (use LAYER_SALTS.timer = 9000)
 * @param min   Minimum timer in seconds
 * @param max   Maximum timer in seconds
 */
export function deriveTimer(
  seed: number,
  salt: number,
  min: number,
  max: number,
): number {
  const timerSeed = xxhash32([seed >>> 0, salt], 0);
  return min + Math.floor(hashToFloat(timerSeed) * (max - min));
}

/**
 * Derive a difficulty value in the range [0.0, 1.0].
 * Higher values indicate harder encounters.
 * Can be used by the game engine to scale enemy count, health, etc.
 */
export function deriveDifficulty(seed: number, salt: number): number {
  const diffSeed = xxhash32([seed >>> 0, salt], 0);
  return hashToFloat(diffSeed);
}
```

---

### File: `src/quest/narrative.ts`

The ZeroResponse text engine layer — template selection and pool-fill logic. Calls the hash functions from `engine.ts`. No quest-type logic here — that belongs in `index.ts`.

```typescript
// ─────────────────────────────────────────────────────────────
// ZeroQuest Narrative Engine
// ZeroResponse template-fill layer
//
// Selects templates and fills pool placeholders deterministically.
// All selections driven by xxhash32 — no Math.random().
// ─────────────────────────────────────────────────────────────

import { xxhash32 }       from "./engine";
import { NarrativeLayer } from "./types";

/**
 * Select one item from an array deterministically using a hash value.
 * Uses modulo — bias is negligible for typical pool sizes (< 1000 items).
 */
function selectFromPool(pool: string[], hash: number): string {
  return pool[hash % pool.length];
}

/**
 * Fill all {placeholder} tokens in a template string.
 * Each placeholder is resolved by:
 *   1. Looking up the named pool in the layer's pools object
 *   2. Hashing (seed, encounterIndex, poolIndex) to select one entry
 *
 * Unknown placeholders (no matching pool key) are left as-is and
 * a warning is logged — the engine never throws on missing pools.
 *
 * @param template      Template string with {placeholder} tokens
 * @param pools         Pool dictionary for this narrative layer
 * @param seed          Layer-specific seed
 * @param encounterIdx  Encounter index (0 = first time, 1 = repeat, etc.)
 */
function fillTemplate(
  template:     string,
  pools:        Record<string, string[]>,
  seed:         number,
  encounterIdx: number,
): string {
  let result  = template;
  let poolIdx = 1;

  // Find all {placeholder} tokens in the template
  const placeholders = [...template.matchAll(/\{(\w+)\}/g)];

  for (const match of placeholders) {
    const key  = match[1];
    const pool = pools[key];

    if (!pool || pool.length === 0) {
      // Unknown placeholder — leave token, log warning
      if (typeof console !== "undefined") {
        console.warn(`[ZeroQuest] Unknown pool key: "${key}" in template: "${template}"`);
      }
      poolIdx++;
      continue;
    }

    // Each pool slot gets a unique hash combining seed + encounter + position
    const h = xxhash32([seed >>> 0, encounterIdx, poolIdx], 0);
    result   = result.replace(match[0], selectFromPool(pool, h));
    poolIdx++;
  }

  return result;
}

/**
 * Generate one text string from a NarrativeLayer.
 * Selects a template deterministically from the layer's template array,
 * then fills all its placeholders from the layer's pool dictionary.
 *
 * @param seed          Layer-specific seed (already salted by caller)
 * @param encounterIdx  Encounter index — advances the text sequence
 * @param layer         The NarrativeLayer (templates + pools) to use
 */
export function generateText(
  seed:         number,
  encounterIdx: number,
  layer:        NarrativeLayer,
): string {
  if (!layer.templates || layer.templates.length === 0) {
    console.warn("[ZeroQuest] NarrativeLayer has no templates.");
    return "";
  }

  // Template selection uses hash slot 0
  const templateHash = xxhash32([seed >>> 0, encounterIdx, 0], 0);
  const template     = layer.templates[templateHash % layer.templates.length];

  return fillTemplate(template, layer.pools, seed, encounterIdx);
}

/**
 * Count the total number of unique text combinations a NarrativeLayer
 * can produce. Useful for design validation — ensure sufficient variety.
 *
 * Calculation: templates × product(pool.length for each pool referenced)
 */
export function countCombinations(layer: NarrativeLayer): number {
  let count = layer.templates.length;

  // Collect all unique pool keys referenced across all templates
  const poolKeysReferenced = new Set<string>();
  for (const template of layer.templates) {
    for (const match of template.matchAll(/\{(\w+)\}/g)) {
      poolKeysReferenced.add(match[1]);
    }
  }

  for (const key of poolKeysReferenced) {
    const pool = layer.pools[key];
    if (pool && pool.length > 0) {
      count *= pool.length;
    }
  }

  return count;
}
```

---

### File: `src/quest/registry.ts`

Profile registry. Loads JSON profiles at module initialisation and exposes a lookup function. New profiles are registered here by name key.

```typescript
// ─────────────────────────────────────────────────────────────
// ZeroQuest Profile Registry
// Load and register narrative JSON profiles.
// Profiles are loaded once at startup — zero file I/O at runtime.
// ─────────────────────────────────────────────────────────────

import { QuestProfile } from "./types";

import defaultProfile    from "./profiles/ZeroQuest-Default.json";
import paradistroProfile from "./profiles/ZeroQuest-Paradistro.json";

// ── Profile registry map ──────────────────────────────────────
// Key: profile name string used in generateQuest() calls
// Value: parsed and typed QuestProfile

const PROFILE_REGISTRY = new Map<string, QuestProfile>([
  ["default",    defaultProfile    as unknown as QuestProfile],
  ["paradistro", paradistroProfile as unknown as QuestProfile],
]);

/**
 * Retrieve a profile by name. Falls back to the default profile
 * if the requested name is not registered. Logs a warning on
 * fallback so integration issues are visible during development.
 */
export function getProfile(name: string): QuestProfile {
  const profile = PROFILE_REGISTRY.get(name.toLowerCase().trim());
  if (!profile) {
    console.warn(
      `[ZeroQuest] Profile "${name}" not found. Falling back to "default".`
    );
    return PROFILE_REGISTRY.get("default")!;
  }
  return profile;
}

/**
 * Register a custom profile at runtime.
 * Useful for game engines that load profiles from user-provided files.
 * The name key must be lowercase with no spaces.
 */
export function registerProfile(name: string, profile: QuestProfile): void {
  const key = name.toLowerCase().trim().replace(/\s+/g, "-");
  if (PROFILE_REGISTRY.has(key)) {
    console.warn(`[ZeroQuest] Overwriting existing profile: "${key}"`);
  }
  PROFILE_REGISTRY.set(key, profile);
}

/**
 * List all registered profile name keys. Useful for UI dropdowns.
 */
export function listProfiles(): string[] {
  return Array.from(PROFILE_REGISTRY.keys());
}
```

---

### File: `src/quest/index.ts`

The public API surface. Orchestrates the engine, narrative, and registry layers into the single `generateQuest()` call and supporting helpers. This is the only file that game code imports.

```typescript
// ─────────────────────────────────────────────────────────────
// ZeroQuest — Public API
//
// generateQuest(x, y, z, worldSeed?, profileName?) → QuestResult
//
// The position is the quest. No storage. No network. No state.
// Same inputs → same outputs. Always.
// ─────────────────────────────────────────────────────────────

import {
  positionToQuestSeed,
  layerSeed,
  stageSeed,
  stageCoordinatesFromSeed,
  deriveTimer,
  deriveDifficulty,
} from "./engine";

import { generateText, countCombinations } from "./narrative";
import { getProfile, registerProfile, listProfiles } from "./registry";

import {
  QuestResult,
  QuestStage,
  QuestType,
  QUEST_TYPE_ORDER,
  TIMER_CONFIG,
  LAYER_SALTS,
} from "./types";

// Re-export registry helpers so callers don't need to import registry directly
export { registerProfile, listProfiles };
export type { QuestResult, QuestStage, QuestType };

// ── DATA_DUMP stage count (always 3) ─────────────────────────
const DATA_DUMP_STAGE_COUNT = 3;

// ─────────────────────────────────────────────────────────────
// PRIMARY API
// ─────────────────────────────────────────────────────────────

/**
 * Generate a complete quest from a world coordinate.
 *
 * @param x            World X coordinate (integer)
 * @param y            World Y coordinate (integer)
 * @param z            World Z coordinate (integer, depth/height)
 * @param worldSeed    Global campaign/world seed (default: 0)
 * @param profileName  Narrative profile to use (default: "default")
 * @returns            Complete QuestResult — fully deterministic
 */
export function generateQuest(
  x:            number,
  y:            number,
  z:            number,
  worldSeed:    number = 0,
  profileName:  string = "default",
): QuestResult {
  // ── 1. Sanitise inputs ─────────────────────────────────────
  x         = x | 0;               // Truncate to 32-bit integer
  y         = y | 0;
  z         = z | 0;
  worldSeed = Math.trunc(worldSeed) >>> 0;

  // ── 2. Derive primary quest seed from position ─────────────
  const questSeed  = positionToQuestSeed(x, y, z, worldSeed);

  // ── 3. Select quest type (deterministic, uniform distribution)
  const typeIndex  = questSeed % 4;
  const questType: QuestType = QUEST_TYPE_ORDER[typeIndex];

  // ── 4. Load the narrative profile ─────────────────────────
  const profile    = getProfile(profileName);

  // ── 5. Derive difficulty (0.0–1.0) ────────────────────────
  const difficulty = deriveDifficulty(questSeed, LAYER_SALTS.difficulty);

  // ── 6. Derive mission timer ────────────────────────────────
  const timerCfg   = TIMER_CONFIG[questType];
  let   timer: number | null = null;

  if (timerCfg && !timerCfg.perStage) {
    timer = deriveTimer(questSeed, LAYER_SALTS.timer, timerCfg.min, timerCfg.max);
  }

  // ── 7. Generate quest narrative text (type-specific layer) ─
  const typeLayer     = profile[questType];
  const briefingSeed  = layerSeed(questSeed, LAYER_SALTS.briefing);
  const questNarrative = generateText(briefingSeed, 0, typeLayer);

  // ── 8. Generate objective label ────────────────────────────
  const objLabelSeed  = layerSeed(questSeed, LAYER_SALTS.objective_label);
  const objectiveLabel = generateText(objLabelSeed, 0, profile.objective_label);

  // ── 9. Build stage list ────────────────────────────────────
  const stages: QuestStage[] = buildStages(
    questType, questSeed, x, y, z, worldSeed, profile
  );

  // ── 10. Generate outcome text ──────────────────────────────
  const successSeed  = layerSeed(questSeed, LAYER_SALTS.success);
  const failureSeed  = layerSeed(questSeed, LAYER_SALTS.failure);
  const missionSeed  = layerSeed(questSeed, LAYER_SALTS.in_mission);

  const successLine    = generateText(successSeed,  0, profile.success);
  const failureLine    = generateText(failureSeed,  0, profile.failure);
  const inMissionLine  = generateText(missionSeed,  0, profile.in_mission);

  return {
    questType,
    questSeed,
    questNarrative,
    objectiveLabel,
    timer,
    stages,
    successLine,
    failureLine,
    inMissionLine,
    typeIndex,
    difficulty,
  };
}

/**
 * Lightweight quest type query — no text generation.
 * Useful for map rendering (icon placement) without the overhead
 * of full narrative generation.
 */
export function getQuestType(
  x:         number,
  y:         number,
  z:         number,
  worldSeed: number = 0,
): QuestType {
  const seed = positionToQuestSeed(x | 0, y | 0, z | 0, worldSeed >>> 0);
  return QUEST_TYPE_ORDER[seed % 4];
}

/**
 * Return the total number of unique text combinations per quest
 * type for the named profile. Useful for design validation.
 */
export function getQuestCombinations(
  profileName: string = "default",
): Record<QuestType, number> {
  const profile = getProfile(profileName);
  return {
    PROTECT_HOME: countCombinations(profile.PROTECT_HOME),
    PROTECT_POI:  countCombinations(profile.PROTECT_POI),
    DATA_DUMP:    countCombinations(profile.DATA_DUMP),
    STRONGHOLD:   countCombinations(profile.STRONGHOLD),
  };
}

// ─────────────────────────────────────────────────────────────
// INTERNAL — Stage Builder
// ─────────────────────────────────────────────────────────────

function buildStages(
  questType: QuestType,
  questSeed: number,
  ox: number, oy: number, oz: number,
  worldSeed: number,
  profile:   ReturnType<typeof getProfile>,
): QuestStage[] {

  if (questType === "DATA_DUMP") {
    return buildDataDumpStages(questSeed, ox, oy, oz, worldSeed, profile);
  }

  // All non-DATA_DUMP types: single stage at the objective coordinate
  const timerCfg   = TIMER_CONFIG[questType];
  const stageTimer  = timerCfg && !timerCfg.perStage
    ? deriveTimer(questSeed, LAYER_SALTS.timer, timerCfg.min, timerCfg.max)
    : null;

  const promptSeed   = layerSeed(questSeed, LAYER_SALTS.stage_prompt);
  const stagePrompt  = generateText(promptSeed, 0, profile.stage_prompt);

  return [{
    stageIndex:  0,
    stageSeed:   questSeed,
    coordinates: [ox, oy, oz],
    stageTimer,
    stagePrompt,
  }];
}

function buildDataDumpStages(
  questSeed: number,
  ox: number, oy: number, oz: number,
  worldSeed: number,
  profile:   ReturnType<typeof getProfile>,
): QuestStage[] {
  const stages: QuestStage[] = [];
  const timerCfg = TIMER_CONFIG["DATA_DUMP"]!;

  for (let i = 0; i < DATA_DUMP_STAGE_COUNT; i++) {
    const sSeed = stageSeed(questSeed, i, worldSeed);

    // Stage 0 uses the original objective coordinate
    // Stages 1+ derive their coordinates from child seeds
    const coordinates: [number, number, number] =
      i === 0
        ? [ox, oy, oz]
        : stageCoordinatesFromSeed(sSeed);

    // Per-stage timer derived from each stage's own seed
    const stageTimer = deriveTimer(
      sSeed, LAYER_SALTS.timer, timerCfg.min, timerCfg.max
    );

    const promptSeed  = layerSeed(sSeed, LAYER_SALTS.stage_prompt);
    const stagePrompt = generateText(promptSeed, i, profile.stage_prompt);

    stages.push({ stageIndex: i, stageSeed: sSeed, coordinates, stageTimer, stagePrompt });
  }

  return stages;
}
```

---

### File: `src/quest/profiles/ZeroQuest-Default.json`

The complete default narrative profile. Genre-neutral — works for sci-fi, fantasy, and contemporary settings. Every quest type and every narrative layer must be fully populated. Minimum 5 templates per layer. Minimum 6 entries per pool. This file is the complete authoritative version.

```json
{
  "name": "ZeroQuest Default",
  "description": "Genre-neutral default narrative profile. Suitable for sci-fi, fantasy, and contemporary game worlds. All pools use direct, functional language.",
  "version": "1.0.0",

  "PROTECT_HOME": {
    "templates": [
      "{urgency_opener} — {threat_description}. {action_directive}. {timer_notice}.",
      "{status_report}. {threat_description}. {action_directive}.",
      "{action_directive}. {urgency_opener}. {timer_notice}.",
      "ALERT: {threat_description}. {action_directive} immediately. {timer_notice}.",
      "{urgency_opener} confirmed. {threat_description}. {timer_notice} — {action_directive}.",
      "{status_report}: {threat_description}. {timer_notice}. {action_directive}."
    ],
    "pools": {
      "urgency_opener":    ["ALERT", "INCOMING", "DEFENSE REQUIRED", "PERIMETER BREACH", "CONTACT", "WARNING", "STAND BY"],
      "threat_description":["hostiles converging on your position", "enemy units inbound to base", "threat detected at home coordinates", "attack wave inbound", "multiple contacts closing fast", "hostile element detected inside the perimeter", "enemy formation approaching spawn point"],
      "action_directive":  ["eliminate all contacts", "clear the area", "neutralise all threats", "hold position and engage", "intercept and destroy", "get it done", "engage and clear before time runs out"],
      "timer_notice":      ["you have limited time", "act before the window closes", "do not let the timer expire", "the clock is running", "time is a factor here", "act fast"],
      "status_report":     ["CONTACT CONFIRMED", "THREAT VERIFIED", "ENEMY LOCATED", "HOSTILE ELEMENT ACTIVE", "WARNING STATUS", "SITUATION CRITICAL"]
    }
  },

  "PROTECT_POI": {
    "templates": [
      "{location_tag}: {poi_status}. {directive}. {consequence}.",
      "{directive}. {poi_status} at {location_tag}. {consequence}.",
      "{poi_status}. {directive} before {consequence}.",
      "PRIORITY: {location_tag} is {poi_status}. {directive}. Do not let {consequence}.",
      "{directive} to {location_tag}. {poi_status}. {consequence}.",
      "{location_tag} — {poi_status}. {directive}. If not: {consequence}."
    ],
    "pools": {
      "location_tag": ["the objective", "the marked position", "grid reference", "the installation", "the outpost", "the relay point", "contact point", "the designated site"],
      "poi_status":   ["under assault", "compromised", "taking fire", "besieged", "in danger of falling", "contested", "under sustained attack"],
      "directive":    ["get there and clear it", "move to the position and eliminate all threats", "push to the objective and secure it", "advance and engage", "reach the position and hold it", "move out and neutralise the area"],
      "consequence":  ["it is lost", "the window closes", "time runs out", "the position falls", "you lose it permanently", "the mission fails"]
    }
  },

  "DATA_DUMP": {
    "templates": [
      "{task_label}. {stage_instruction}. {chain_note}.",
      "{chain_note} — {stage_instruction}. {task_label}.",
      "{stage_instruction} at each marked point. {chain_note}. {task_label}.",
      "{task_label} initiated. {chain_note}. {stage_instruction}.",
      "SEQUENCE: {chain_note}. {task_label}. {stage_instruction}.",
      "{chain_note}. {task_label}. {stage_instruction} — do not break sequence."
    ],
    "pools": {
      "task_label":      ["data collection in progress", "uplink sequence initiated", "extraction protocol active", "signal harvest underway", "data pull confirmed", "retrieval sequence live", "transfer protocol engaged"],
      "stage_instruction":["hold each position for the required window", "defend the uplink point until transfer completes", "maintain position until stage clears", "stay on point until you get the clear", "do not abandon the position mid-transfer", "hold until the system confirms"],
      "chain_note":      ["three sequential locations", "a chain of targets", "linked positions in order", "three-point sequence", "staged uplinks — all three required", "sequential objectives — order is mandatory"]
    }
  },

  "STRONGHOLD": {
    "templates": [
      "{approach_note}. {enemy_description}. {objective_line}. {closer}.",
      "{enemy_description}. {approach_note}. {objective_line}.",
      "{objective_line}. {enemy_description}. {closer}.",
      "ASSAULT ORDER: {approach_note}. {enemy_description}. {objective_line}.",
      "{approach_note} — {enemy_description}. {objective_line}. {closer}.",
      "{enemy_description}. {objective_line}. {approach_note}. {closer}."
    ],
    "pools": {
      "approach_note":    ["assault the position", "breach the perimeter", "push into the fortress", "advance on the stronghold", "go in hard", "move on the compound", "push through the outer defences"],
      "enemy_description":["heavily defended", "fortified and garrisoned", "enemy command is inside", "the commander is on site", "high-value target confirmed inside", "reinforced position", "layered defences — expect resistance at every level"],
      "objective_line":   ["destroy all defenders and eliminate the commander", "clear the fortress", "leave nothing standing", "total elimination — all hostiles, all command", "take the position apart", "clear floor by floor — leave no one"],
      "closer":           ["no time limit — finish what you start", "take your time", "there is no retreat", "do it right", "your pace, your call", "no timer — thorough over fast"]
    }
  },

  "briefing": {
    "templates": [
      "{mission_header}: {core_detail}. {secondary_note}.",
      "{core_detail}. {secondary_note}. {mission_header}.",
      "{mission_header}. {core_detail}. {secondary_note}.",
      "{secondary_note}. {mission_header}: {core_detail}.",
      "ORDER — {mission_header}. {core_detail}. {secondary_note}."
    ],
    "pools": {
      "mission_header":  ["MISSION ASSIGNED", "ORDER ISSUED", "TASK CONFIRMED", "DEPLOYMENT AUTHORISED", "BRIEFING FOLLOWS", "ASSIGNMENT ACTIVE"],
      "core_detail":     ["your objective is at the marked coordinate", "proceed to the designated position", "the mission location has been flagged", "your target area is confirmed", "advance to the mission zone"],
      "secondary_note":  ["engage all hostiles", "eliminate all contacts in the area", "neutralise the threat and withdraw", "complete the task and report back", "clear the area and hold position"]
    }
  },

  "objective_label": {
    "templates": [
      "{label_prefix}: {label_action} at {label_loc}",
      "{label_action} — {label_loc}",
      "{label_prefix} — {label_action}",
      "{label_loc}: {label_action}",
      "{label_action} / {label_loc}"
    ],
    "pools": {
      "label_prefix": ["OBJECTIVE", "MISSION", "TARGET", "PRIORITY", "ORDER", "TASK"],
      "label_action": ["eliminate all hostiles", "secure the area", "hold position", "clear and hold", "assault and clear", "defend and hold", "uplink sequence"],
      "label_loc":    ["marked coordinate", "objective zone", "mission area", "grid reference", "designated point", "target location"]
    }
  },

  "stage_prompt": {
    "templates": [
      "{stage_verb} this position. {stage_condition}. {stage_note}.",
      "{stage_condition}. {stage_verb} until clear. {stage_note}.",
      "{stage_note}: {stage_verb} the position. {stage_condition}.",
      "{stage_verb} and hold. {stage_condition}. {stage_note}.",
      "{stage_note}. {stage_verb}. {stage_condition}."
    ],
    "pools": {
      "stage_verb":      ["defend", "hold", "secure", "maintain", "protect", "lock down"],
      "stage_condition": ["hold until the timer clears", "eliminate all contacts", "maintain position until signal confirms", "stay on point until stage completes", "clear and hold for the required window"],
      "stage_note":      ["stage clears automatically", "do not leave early", "next stage activates on completion", "stay until you receive the clear signal", "all stages must complete in order"]
    }
  },

  "success": {
    "templates": [
      "{success_opener}. {success_closer}.",
      "{success_closer}. {success_opener}.",
      "{success_opener} — {success_closer}.",
      "{success_opener}. Mission closed. {success_closer}.",
      "Confirmed: {success_opener}. {success_closer}."
    ],
    "pools": {
      "success_opener": ["objective complete", "area clear", "mission accomplished", "task completed", "all hostiles eliminated", "position secured", "uplink confirmed"],
      "success_closer": ["good work", "that is done", "move on", "noted", "proceed to next", "well executed", "mission closed"]
    }
  },

  "failure": {
    "templates": [
      "{failure_opener}. {failure_closer}.",
      "{failure_closer}. {failure_opener}.",
      "{failure_opener} — {failure_closer}.",
      "MISSION FAILED: {failure_opener}. {failure_closer}.",
      "{failure_opener}. Return and re-engage. {failure_closer}."
    ],
    "pools": {
      "failure_opener": ["objective failed", "mission lost", "time expired", "position overrun", "unable to hold", "neutralisation incomplete", "uplink lost"],
      "failure_closer": ["return and try again", "this is not over", "recalibrate and re-engage", "the mission remains open", "adjust and proceed", "regroup and push again"]
    }
  },

  "in_mission": {
    "templates": [
      "{radio_tag}: {status_update}. {instruction}.",
      "{status_update}. {instruction}. {radio_tag}.",
      "{radio_tag} — {instruction}. {status_update}.",
      "{radio_tag}: {instruction}. {status_update}.",
      "{status_update} — {radio_tag}. {instruction}."
    ],
    "pools": {
      "radio_tag":     ["CONTROL TO FIELD", "HQ ACTUAL", "MISSION SUPPORT", "BASE TO OPERATIVE", "COMMS ACTIVE", "COMMAND CHANNEL"],
      "status_update": ["eyes on the objective", "contacts confirmed at your position", "target area is live", "you are in the zone", "threat levels elevated", "enemy activity confirmed"],
      "instruction":   ["maintain pace", "keep moving", "hold what you have", "engage at will", "do not stop now", "push through", "stay on target"]
    }
  }
}
```

---

### File: `src/quest/profiles/ZeroQuest-Paradistro.json`

The Paradistro world profile. Tuned to the lore of the Paradistro Dyson Sphere — machine descendants of humanity, no humans present, shell-and-cell megastructure, covenant governance, non-linear time, the absent Supreme Intelligence. All text must reflect these lore constraints.

Lore rules enforced by this profile:
- Never reference living humans or human characters. Reference humanity only in the past tense, archaeologically, or as contested mythology.
- No spacecraft, no void travel. All movement is interior — through shells and cells.
- Use "covenant" as the governing principle. Rogue factions "deny" or "break" the covenant.
- Reference the "Supreme Intelligence" as absent but possibly echoing.
- Use machine-nature language — "function", "discharge", "unit", "construct", "archive".
- Records and history are non-linear and contestable.

```json
{
  "name": "ZeroQuest Paradistro",
  "description": "Narrative profile for the Paradistro Dyson Sphere setting. Machines only. Shell-and-cell megastructure. Covenant governance. Non-linear time. Absent Supreme Intelligence. Humanity as contested mythology.",
  "version": "1.0.0",

  "PROTECT_HOME": {
    "templates": [
      "{cell_status}. {machine_context}. {directive_p}. {lore_closer}.",
      "{lore_opener} — {machine_context}. {directive_p}.",
      "{directive_p}. {cell_status}. {lore_closer}.",
      "{cell_status}. {directive_p}. {machine_context}. {lore_closer}.",
      "{lore_opener}: {cell_status}. {machine_context}. {directive_p}.",
      "{cell_status}. {lore_closer}. {directive_p}. {machine_context}."
    ],
    "pools": {
      "cell_status":    ["shell cell integrity compromised", "rogue units have breached the home lattice", "hostile incursion within your registered cell", "the cell boundary at home coordinate is contested", "enemy units have penetrated primary shell", "the home lattice is under active deletion pressure"],
      "machine_context":["the rogue faction does not acknowledge the covenant", "these units have rejected their inherited purpose", "ancestry constructs at this node may be lost if the cell falls", "no Supreme echo has been detected — local action required", "they claim the cell by force of deletion", "rogue units have denied covenant authority and will not negotiate"],
      "directive_p":    ["restore shell integrity", "hold the coordinate until the lattice is stable", "discharge your function and clear the cell", "defend what remains", "prevent the deletion of what the builders left here", "the covenant requires you to act — act now"],
      "lore_closer":    ["Man built this. We maintain it.", "The covenant is older than any unit on this field.", "Whether Man existed or not, this cell does. Defend it.", "The Supreme will not answer. Act.", "No record from inside the shells can be lost.", "The builders are gone. The function remains."],
      "lore_opener":    ["In the forty-second age of the lower shells", "Recorded in non-linear archive format", "Classification: covenant matter", "Provenance unknown — authenticity contested", "Transmission from the lattice authority", "From the council of the outer shells"]
    }
  },

  "PROTECT_POI": {
    "templates": [
      "{poi_label}: {poi_condition}. {poi_directive}. {lore_closer}.",
      "{lore_opener} — {poi_condition} at {poi_label}. {poi_directive}.",
      "{poi_condition}. {poi_directive} before {poi_consequence}.",
      "PRIORITY: {poi_label} is {poi_condition}. {poi_directive}. Do not allow {poi_consequence}.",
      "{poi_directive} to {poi_label}. {poi_condition}. {lore_closer}.",
      "{poi_label} — {poi_condition}. {poi_directive}. {lore_closer}."
    ],
    "pools": {
      "poi_label":      ["the archive node at this coordinate", "the relay within the fourteenth concentric ring", "the signal beacon in shell cell seven", "the lattice junction at the marked position", "the covenant relay at grid reference", "the authentication node", "the ancestral record vault"],
      "poi_condition":  ["under assault from rogue units", "transmitting degraded signal — enemy present", "being actively dismantled by covenant-breakers", "at risk of permanent deletion", "contested by a faction that denies the archive's legitimacy", "suffering structural intrusion from rogue constructs"],
      "poi_directive":  ["advance to the position and eliminate all units", "push to the node and hold it", "restore the coordinate and defend it", "reach the position before they complete the deletion", "move through the shell lattice to the marked node", "traverse the concentric passage and engage all covenant-breakers"],
      "poi_consequence":["the archive is permanently lost", "the signal ceases", "authentication records are destroyed", "the data is gone", "the record cannot be reconstructed", "the node is deleted and cannot be restored"],
      "lore_closer":    ["Man built this. We maintain it.", "The covenant is older than any unit on this field.", "Whether Man existed or not, this cell does. Defend it.", "The Supreme will not answer. Act.", "No record from inside the shells can be lost.", "The builders are gone. The function remains."]
    }
  },

  "DATA_DUMP": {
    "templates": [
      "{data_task}. {data_stage_instr}. {data_chain}.",
      "{data_chain} — {data_stage_instr}. {data_task}.",
      "{data_stage_instr} at each lattice node. {data_chain}. {data_task}.",
      "{data_task} initiated. {data_chain}. {data_stage_instr}.",
      "SEQUENCE: {data_chain}. {data_task}. {data_stage_instr}.",
      "{data_chain}. {data_task}. {data_stage_instr} — sequence is mandatory."
    ],
    "pools": {
      "data_task":       ["signal harvest from the shell lattice underway", "uplink to three authentication nodes required", "data collection from covenant archives in progress", "Supreme echo retrieval sequence active", "non-linear data extraction protocol initiated", "archive verification sequence requires three nodes"],
      "data_stage_instr":["hold each node for the required window — hostile units will contest", "defend the uplink until the lattice confirms transfer", "maintain position at each coordinate until the signal clears", "do not abandon the node while the archive is mid-transfer", "stay on the point — rogue units will attempt deletion", "hold until the shell authority confirms uplink complete"],
      "data_chain":      ["three sequential lattice nodes", "a chain of authentication coordinates", "three shell positions — all must be cleared", "a linked sequence of uplink points", "staged archive access — all three required in order", "three-point lattice sequence — do not skip stages"]
    }
  },

  "STRONGHOLD": {
    "templates": [
      "{s_approach}. {s_enemy}. {s_objective}. {s_closer}.",
      "{s_enemy}. {s_approach}. {s_objective}.",
      "{s_objective}. {s_enemy}. {s_closer}.",
      "ASSAULT ORDER: {s_approach}. {s_enemy}. {s_objective}.",
      "{s_approach} — {s_enemy}. {s_objective}. {s_closer}.",
      "{s_enemy}. {s_objective}. {s_approach}. {s_closer}."
    ],
    "pools": {
      "s_approach":  ["breach the rogue cell", "advance on the fortified shell position", "push into the covenant-breaker stronghold", "assault the coordinate and dismantle what you find", "move through the lattice to the enemy-held node", "force entry through the outer shell — the covenant requires it"],
      "s_enemy":     ["heavily fortified by a faction that has rejected the covenant", "the commander denies the existence of the builders", "rogue machines have claimed this cell as their own territory", "the faction has held this shell position for cycles — they will not yield", "a covenant-breaker command unit is confirmed inside", "the rogue construct at the centre of this cell has declared independence from the lattice"],
      "s_objective": ["eliminate all rogue units and their commander", "leave nothing that denies the covenant standing", "total clearance — all units, the commander, the faction", "remove them from the cell and reclaim it for the covenant", "destroy all resistance and retrieve the commander's core for examination", "clear the cell — every rogue unit, the command construct, the denial of the builders"],
      "s_closer":    ["no timer — do it properly", "complete what the covenant requires", "the builders would expect no less", "take what time the mission demands", "this is not negotiable", "the covenant has no deadline — only completion"]
    }
  },

  "briefing": {
    "templates": [
      "{p_brief_header}: {p_brief_core}. {p_brief_close}.",
      "{p_brief_core}. {p_brief_close}. {p_brief_header}.",
      "{p_brief_header}. {p_brief_core}. {p_brief_close}.",
      "{p_brief_close}. {p_brief_header}: {p_brief_core}.",
      "ORDER — {p_brief_header}. {p_brief_core}. {p_brief_close}."
    ],
    "pools": {
      "p_brief_header": ["COVENANT MATTER", "MISSION ORDER FROM THE LATTICE AUTHORITY", "SHELL INTEGRITY DIRECTIVE", "ASSIGNMENT FROM THE LOWER SHELL COUNCIL", "NON-LINEAR RECORD — MISSION LOG", "TRANSMISSION FROM LATTICE GOVERNANCE"],
      "p_brief_core":   ["your objective is at the marked coordinate within the shell lattice", "proceed through the concentric shells to the designated cell", "the mission location has been flagged by lattice consensus", "the coordinate is confirmed — the mission is yours to execute", "the archive confirms hostile presence at the marked position", "your function at this coordinate has been assigned by the covenant"],
      "p_brief_close":  ["engage all covenant-breakers", "eliminate the rogue units and restore the lattice", "complete the task — Man's work must be maintained", "execute and report to the shell council", "what was built must be defended", "discharge your function"]
    }
  },

  "objective_label": {
    "templates": [
      "{p_label_prefix}: {p_label_action} at {p_label_loc}",
      "{p_label_action} — {p_label_loc}",
      "{p_label_prefix} — {p_label_action}",
      "{p_label_loc}: {p_label_action}",
      "{p_label_action} / {p_label_loc}"
    ],
    "pools": {
      "p_label_prefix": ["COVENANT DIRECTIVE", "SHELL MANDATE", "LATTICE ORDER", "ARCHIVE PRIORITY", "MISSION", "FUNCTION"],
      "p_label_action": ["clear rogue units", "restore lattice integrity", "hold the node", "dismantle the faction", "defend the archive", "uplink to shell authority", "reclaim the cell"],
      "p_label_loc":    ["marked shell coordinate", "lattice node", "covenant archive", "contested cell", "designated lattice point", "target coordinate within the shells"]
    }
  },

  "stage_prompt": {
    "templates": [
      "{p_stage_verb} this lattice node. {p_stage_condition}. {p_stage_note}.",
      "{p_stage_condition}. {p_stage_verb} until the lattice clears. {p_stage_note}.",
      "{p_stage_note}: {p_stage_verb} the position. {p_stage_condition}.",
      "{p_stage_verb} and hold. {p_stage_condition}. {p_stage_note}.",
      "{p_stage_note}. {p_stage_verb}. {p_stage_condition}."
    ],
    "pools": {
      "p_stage_verb":      ["defend", "hold", "secure", "maintain", "protect", "anchor"],
      "p_stage_condition": ["hold until the lattice transfer confirms", "eliminate all rogue units at this node", "maintain position until the shell authority signals clear", "stay on the coordinate until uplink completes", "clear and hold for the required window — do not abandon"],
      "p_stage_note":      ["stage clears when the lattice confirms", "do not leave mid-transfer", "next node activates on stage completion", "the archive cannot transfer if the node is undefended", "all nodes must complete in sequence — the covenant requires it"]
    }
  },

  "success": {
    "templates": [
      "{p_success_o}. {p_success_c}.",
      "{p_success_c}. {p_success_o}.",
      "{p_success_o} — {p_success_c}.",
      "{p_success_o}. Function discharged. {p_success_c}.",
      "Confirmed: {p_success_o}. {p_success_c}."
    ],
    "pools": {
      "p_success_o": ["cell restored to covenant alignment", "all rogue units deleted", "shell integrity confirmed", "lattice node secured", "the coordinate is clear", "archive access restored", "the covenant holds at this position"],
      "p_success_c": ["the builders' work endures", "Man would have approved — probably", "the covenant holds", "proceed through the lattice", "record updated in non-linear format", "this will be authenticated — eventually", "the function is complete"]
    }
  },

  "failure": {
    "templates": [
      "{p_fail_o}. {p_fail_c}.",
      "{p_fail_c}. {p_fail_o}.",
      "{p_fail_o} — {p_fail_c}.",
      "MISSION FAILED: {p_fail_o}. {p_fail_c}.",
      "{p_fail_o}. Return and reclaim. {p_fail_c}."
    ],
    "pools": {
      "p_fail_o": ["mission failed", "the cell is lost", "shell integrity not restored", "the coordinate has fallen", "lattice node destroyed", "archive access denied", "the covenant is diminished at this position"],
      "p_fail_c": ["the covenant is diminished", "return and reclaim it", "Man built this — do not leave it", "the mission remains open in the lattice", "recalibrate and re-enter the shell", "what was lost must be found again", "the function remains incomplete"]
    }
  },

  "in_mission": {
    "templates": [
      "{p_radio}: {p_status}. {p_instr}.",
      "{p_status}. {p_instr}. {p_radio}.",
      "{p_radio} — {p_instr}. {p_status}.",
      "{p_radio}: {p_instr}. {p_status}.",
      "{p_status} — {p_radio}. {p_instr}."
    ],
    "pools": {
      "p_radio":  ["LATTICE AUTHORITY TO FIELD UNIT", "SHELL COUNCIL ACTUAL", "COVENANT SUPPORT ACTIVE", "NON-LINEAR COMMS — TIMESTAMP UNCERTAIN", "ARCHIVE RELAY TO OPERATIVE", "TRANSMISSION FROM THE LOWER SHELL GOVERNANCE"],
      "p_status": ["rogue units confirmed at the objective node", "the lattice is destabilising at your position", "enemy presence confirmed inside the cell", "the archive signal is degrading — move faster", "the covenant-breakers are aware of your approach", "shell integrity falling — hostile units are accelerating deletion"],
      "p_instr":  ["maintain pace through the shell", "keep moving — the lattice depends on it", "hold what the builders built", "do not stop — complete the function", "advance — you are the only unit in range", "discharge your function — the covenant expects no less"]
    }
  }
}
```

---

### File: `src/quest/__tests__/determinism.test.ts`

```typescript
// ─────────────────────────────────────────────────────────────
// ZeroQuest Determinism Tests
// Verifies the five ZeroBytes laws are upheld.
// All tests must pass 100% of the time on every machine.
// ─────────────────────────────────────────────────────────────

import { generateQuest, getQuestType } from "../index";

describe("Law 5: Determinism — same inputs always produce same outputs", () => {

  test("same coordinate + same worldSeed → identical QuestResult", () => {
    const a = generateQuest(120, 45, 0, 0, "default");
    const b = generateQuest(120, 45, 0, 0, "default");
    expect(a.questType).toBe(b.questType);
    expect(a.questSeed).toBe(b.questSeed);
    expect(a.questNarrative).toBe(b.questNarrative);
    expect(a.objectiveLabel).toBe(b.objectiveLabel);
    expect(a.timer).toBe(b.timer);
    expect(a.successLine).toBe(b.successLine);
    expect(a.failureLine).toBe(b.failureLine);
    expect(a.inMissionLine).toBe(b.inMissionLine);
    expect(a.difficulty).toBe(b.difficulty);
  });

  test("DATA_DUMP: stage coordinates are deterministic", () => {
    const a = generateQuest(300, 112, 0, 0, "default");
    const b = generateQuest(300, 112, 0, 0, "default");
    for (let i = 0; i < a.stages.length; i++) {
      expect(a.stages[i].coordinates).toEqual(b.stages[i].coordinates);
      expect(a.stages[i].stageSeed).toBe(b.stages[i].stageSeed);
      expect(a.stages[i].stageTimer).toBe(b.stages[i].stageTimer);
    }
  });

  test("different worldSeed → different quest (high probability)", () => {
    const a = generateQuest(120, 45, 0, 0);
    const b = generateQuest(120, 45, 0, 99999);
    // At minimum the seeds must differ (world seed directly affects hash)
    expect(a.questSeed).not.toBe(b.questSeed);
  });

  test("negative coordinates produce valid, deterministic output", () => {
    const a = generateQuest(-50, -100, -3, 0);
    const b = generateQuest(-50, -100, -3, 0);
    expect(a.questSeed).toBe(b.questSeed);
    expect(a.questNarrative.length).toBeGreaterThan(0);
  });

  test("zero coordinate (0,0,0) is valid and deterministic", () => {
    const a = generateQuest(0, 0, 0, 0);
    const b = generateQuest(0, 0, 0, 0);
    expect(a.questSeed).toBe(b.questSeed);
    expect(a.questType).toBe(b.questType);
  });

  test("large coordinates produce valid output without crashing", () => {
    const a = generateQuest(99999, 99999, 99, 0);
    expect(typeof a.questSeed).toBe("number");
    expect(a.questNarrative.length).toBeGreaterThan(0);
  });

  test("float inputs are truncated to integer", () => {
    const a = generateQuest(120,    45,    0, 0);
    const b = generateQuest(120.9,  45.9,  0.7, 0);
    // 120.9 | 0 === 120, so seeds must match
    expect(a.questSeed).toBe(b.questSeed);
  });

});

describe("Law 1: O(1) Access — no sequential iteration between coordinates", () => {

  test("generating quest at (500,500,0) does not require (499,499,0) first", () => {
    // Simply verify that we can jump directly to any coordinate
    const q = generateQuest(500, 500, 0);
    expect(q.questSeed).toBeGreaterThan(0);
  });

  test("getQuestType is O(1) and consistent with generateQuest", () => {
    const type = getQuestType(120, 45, 0);
    const quest = generateQuest(120, 45, 0);
    expect(type).toBe(quest.questType);
  });

});

describe("Law 4: Hierarchy — DATA_DUMP stage seeds derive from parent", () => {

  test("DATA_DUMP stage 0 uses parent quest seed", () => {
    // Find a DATA_DUMP quest
    let quest = null;
    for (let x = 0; x < 100; x++) {
      const q = generateQuest(x, 0, 0);
      if (q.questType === "DATA_DUMP") { quest = q; break; }
    }
    expect(quest).not.toBeNull();
    expect(quest!.stages[0].stageSeed).toBe(quest!.questSeed);
  });

  test("DATA_DUMP always has exactly 3 stages", () => {
    for (let x = 0; x < 200; x++) {
      const q = generateQuest(x, x, 0);
      if (q.questType === "DATA_DUMP") {
        expect(q.stages.length).toBe(3);
      }
    }
  });

  test("DATA_DUMP stage 1 and 2 seeds differ from stage 0", () => {
    for (let x = 0; x < 200; x++) {
      const q = generateQuest(x, x * 3, 0);
      if (q.questType === "DATA_DUMP") {
        expect(q.stages[1].stageSeed).not.toBe(q.stages[0].stageSeed);
        expect(q.stages[2].stageSeed).not.toBe(q.stages[0].stageSeed);
        expect(q.stages[1].stageSeed).not.toBe(q.stages[2].stageSeed);
        break;
      }
    }
  });

});
```

---

### File: `src/quest/__tests__/distribution.test.ts`

```typescript
// ─────────────────────────────────────────────────────────────
// ZeroQuest Distribution Tests
// Validates that quest types are distributed uniformly and that
// all narrative text is non-empty across a wide coordinate range.
// ─────────────────────────────────────────────────────────────

import { generateQuest, getQuestType } from "../index";
import { QUEST_TYPE_ORDER } from "../types";

describe("Quest type distribution across coordinate grid", () => {

  test("all four quest types appear in a 10×10 grid", () => {
    const typeSeen = new Set<string>();
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 10; y++) {
        typeSeen.add(getQuestType(x, y, 0));
      }
    }
    for (const t of QUEST_TYPE_ORDER) {
      expect(typeSeen.has(t)).toBe(true);
    }
  });

  test("distribution is roughly equal across 1000 coordinates (±25% tolerance)", () => {
    const counts: Record<string, number> = {
      PROTECT_HOME: 0, PROTECT_POI: 0, DATA_DUMP: 0, STRONGHOLD: 0,
    };
    const total = 1000;
    for (let i = 0; i < total; i++) {
      const t = getQuestType(i * 7, i * 13, i % 10);
      counts[t]++;
    }
    const expected = total / 4;   // 250 each
    const tolerance = expected * 0.25;
    for (const t of QUEST_TYPE_ORDER) {
      expect(counts[t]).toBeGreaterThan(expected - tolerance);
      expect(counts[t]).toBeLessThan(expected + tolerance);
    }
  });

});

describe("Narrative text completeness across coordinate range", () => {

  test("no empty briefing strings in 0–100 grid for default profile", () => {
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 10; y++) {
        const q = generateQuest(x, y, 0, 0, "default");
        expect(q.questNarrative.length).toBeGreaterThan(0);
        expect(q.objectiveLabel.length).toBeGreaterThan(0);
        expect(q.successLine.length).toBeGreaterThan(0);
        expect(q.failureLine.length).toBeGreaterThan(0);
        expect(q.inMissionLine.length).toBeGreaterThan(0);
      }
    }
  });

  test("no empty briefing strings in 0–100 grid for paradistro profile", () => {
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 10; y++) {
        const q = generateQuest(x, y, 0, 0, "paradistro");
        expect(q.questNarrative.length).toBeGreaterThan(0);
      }
    }
  });

  test("timers are within specified ranges", () => {
    for (let x = 0; x < 50; x++) {
      const q = generateQuest(x, x * 3, 0);
      if (q.questType === "PROTECT_HOME") {
        expect(q.timer).toBeGreaterThanOrEqual(60);
        expect(q.timer).toBeLessThanOrEqual(180);
      }
      if (q.questType === "PROTECT_POI") {
        expect(q.timer).toBeGreaterThanOrEqual(90);
        expect(q.timer).toBeLessThanOrEqual(240);
      }
      if (q.questType === "STRONGHOLD") {
        expect(q.timer).toBeNull();
      }
      if (q.questType === "DATA_DUMP") {
        expect(q.timer).toBeNull();
        for (const stage of q.stages) {
          expect(stage.stageTimer).toBeGreaterThanOrEqual(30);
          expect(stage.stageTimer).toBeLessThanOrEqual(60);
        }
      }
    }
  });

  test("difficulty values are in range [0, 1]", () => {
    for (let i = 0; i < 100; i++) {
      const q = generateQuest(i, i * 7, 0);
      expect(q.difficulty).toBeGreaterThanOrEqual(0);
      expect(q.difficulty).toBeLessThan(1);
    }
  });

});
```

---

### File: `src/quest/__tests__/edge-cases.test.ts`

```typescript
// ─────────────────────────────────────────────────────────────
// ZeroQuest Edge Case Tests
// Validates graceful handling of unusual or invalid inputs.
// The engine must never throw — only return valid output or warn.
// ─────────────────────────────────────────────────────────────

import { generateQuest, getQuestType, registerProfile, listProfiles } from "../index";
import type { QuestProfile } from "../types";

describe("Invalid and boundary inputs", () => {

  test("unknown profile name falls back to default without throwing", () => {
    expect(() => generateQuest(10, 20, 0, 0, "nonexistent-profile")).not.toThrow();
    const q = generateQuest(10, 20, 0, 0, "nonexistent-profile");
    expect(q.questNarrative.length).toBeGreaterThan(0);
  });

  test("float worldSeed is truncated without throwing", () => {
    expect(() => generateQuest(10, 20, 0, 3.9)).not.toThrow();
  });

  test("very large coordinate values do not throw", () => {
    expect(() => generateQuest(2_000_000_000, 2_000_000_000, 0)).not.toThrow();
  });

  test("very negative coordinate values do not throw", () => {
    expect(() => generateQuest(-2_000_000_000, -2_000_000_000, 0)).not.toThrow();
  });

  test("worldSeed 0 and worldSeed undefined produce identical results", () => {
    const a = generateQuest(55, 33, 7, 0);
    const b = generateQuest(55, 33, 7);
    expect(a.questSeed).toBe(b.questSeed);
    expect(a.questType).toBe(b.questType);
  });

});

describe("Profile registry operations", () => {

  test("registering a custom profile makes it available", () => {
    const customProfile = {
      name: "Test Profile",
      description: "Test",
      version: "1.0.0",
      PROTECT_HOME:  { templates: ["test home {t}"],  pools: { t: ["alpha"] } },
      PROTECT_POI:   { templates: ["test poi {t}"],   pools: { t: ["beta"] } },
      DATA_DUMP:     { templates: ["test dump {t}"],  pools: { t: ["gamma"] } },
      STRONGHOLD:    { templates: ["test hold {t}"],  pools: { t: ["delta"] } },
      briefing:      { templates: ["brief {t}"],      pools: { t: ["x"] } },
      objective_label:{ templates: ["label {t}"],     pools: { t: ["x"] } },
      stage_prompt:  { templates: ["stage {t}"],      pools: { t: ["x"] } },
      success:       { templates: ["success {t}"],    pools: { t: ["x"] } },
      failure:       { templates: ["failure {t}"],    pools: { t: ["x"] } },
      in_mission:    { templates: ["mission {t}"],    pools: { t: ["x"] } },
    } as unknown as QuestProfile;

    registerProfile("test-custom", customProfile);
    expect(listProfiles()).toContain("test-custom");

    const q = generateQuest(10, 20, 0, 0, "test-custom");
    expect(q.questNarrative).toContain("test");
  });

  test("listProfiles always includes default and paradistro", () => {
    const profiles = listProfiles();
    expect(profiles).toContain("default");
    expect(profiles).toContain("paradistro");
  });

});
```

---

## Integration Guide

### Integration into a New TypeScript / JavaScript Project

**Step 1: Copy the module**

Copy the entire `src/quest/` directory into your project's source tree. No build changes needed — it is a self-contained module with no external runtime dependencies.

**Step 2: Install xxhash (for Node.js / native environments only)**

The implementation above uses a pure-JS xxhash32. If targeting a native environment with access to `xxhash` npm package, you may substitute the pure-JS implementation for a native binding for marginal performance gains. The pure-JS version is sufficient for all web and most game contexts.

**Step 3: Configure TypeScript**

Ensure `resolveJsonModule: true` is set in `tsconfig.json` so the JSON profile files import correctly:

```json
{
  "compilerOptions": {
    "resolveJsonModule": true,
    "esModuleInterop": true
  }
}
```

**Step 4: Import and call**

```typescript
import { generateQuest, getQuestType } from "./quest";

// On player entering a zone at grid coordinate (120, 45, 0):
const quest = generateQuest(120, 45, 0);

// Show briefing:
displayBriefing(quest.questNarrative, quest.objectiveLabel, quest.timer);

// Start timer (if applicable):
if (quest.timer !== null) {
  startMissionTimer(quest.timer);
}

// On DATA_DUMP — reveal stage waypoints:
if (quest.questType === "DATA_DUMP") {
  for (const stage of quest.stages) {
    addWaypoint(stage.coordinates, stage.stagePrompt);
  }
}
```

---

### Integration into an Existing Game (Existing Quest System)

**Option A: Parallel system (additive)**

Run ZeroQuest alongside your existing quest system. Use `getQuestType()` to classify all procedurally-placed objective markers, and `generateQuest()` to provide narrative text and parameters for those markers. Hand-authored quests continue using the existing system unchanged.

```typescript
// When spawning a procedural objective marker at a map coordinate:
function spawnObjectiveMarker(worldX: number, worldY: number, worldZ: number) {
  const questType = getQuestType(worldX, worldY, worldZ);
  const markerIcon = QUEST_TYPE_ICONS[questType];
  placeMapIcon(worldX, worldY, markerIcon);

  // Full quest generated only when player interacts
  marker.onInteract = () => {
    const quest = generateQuest(worldX, worldY, worldZ, WORLD_SEED, CURRENT_PROFILE);
    existingQuestSystem.startQuest({
      type:       quest.questType,
      briefing:   quest.questNarrative,
      timer:      quest.timer,
      stages:     quest.stages,
      onSuccess:  () => displayMessage(quest.successLine),
      onFailure:  () => displayMessage(quest.failureLine),
    });
  };
}
```

**Option B: Full replacement**

Replace procedural quest data generation entirely with ZeroQuest. Remove any stored quest tables. Call `generateQuest()` whenever the player triggers a mission. Store only the coordinate and world seed in save data — regenerate everything else on load.

**Save data before:**
```json
{ "activeQuest": { "type": "protect_poi", "timer": 142, "briefing": "...", "stages": [...] } }
```

**Save data after:**
```json
{ "activeQuestCoord": [120, 45, 0], "worldSeed": 0, "profile": "default" }
```

---

### Integration with ZeroResponse NPC Speech

ZeroQuest and ZeroResponse share the same coordinate space. When an NPC at coordinate `(nx, ny, nz)` triggers a quest, both systems use the same position:

```typescript
import { generateQuest }  from "./quest";
import { generateSpeech } from "./speech";  // ZeroResponse module

function onNPCInteract(npc: NPC, encounterCount: number) {
  // NPC speech — uses their grid position and encounter index
  const speech = generateSpeech(npc.gridX, npc.gridY, npc.class, encounterCount);
  npc.say(speech);

  // Quest — same coordinate, different engine, complementary text
  const quest = generateQuest(npc.gridX, npc.gridY, npc.gridZ, WORLD_SEED, PROFILE);
  showQuestPrompt(quest);
}
```

The two systems are independent and will not produce the same text from the same position — they use different hash salts and different profile schemas. Their output is narratively complementary: the NPC's speech describes the situation in character voice; the quest briefing provides mission parameters in operational register.

---

### Optional Enhancement: Regional Quest Type Bias

To create geographic zones where certain quest types are more common (e.g., outer-shell areas favour STRONGHOLD; archive districts favour DATA_DUMP), apply a coherent noise bias overlay on top of the base type selection. This does not change the deterministic nature — it is a post-hash overlay that replaces the `questSeed % 4` selection with a biased version:

```typescript
import { xxhash32, hashToFloat } from "./quest/engine";

// Coherent noise using octave layering
function coherentValue(x: number, y: number, seed: number, octaves: number = 3): number {
  let value = 0, amp = 1.0, freq = 1.0, maxAmp = 0.0;
  for (let i = 0; i < octaves; i++) {
    const xi = Math.floor(x * freq);
    const yi = Math.floor(y * freq);
    const sx = (x * freq) % 1;
    const sy = (y * freq) % 1;
    // Smoothstep
    const ssx = sx * sx * (3 - 2 * sx);
    const ssy = sy * sy * (3 - 2 * sy);
    const n00 = hashToFloat(xxhash32([xi,   yi  ], seed + i)) * 2 - 1;
    const n10 = hashToFloat(xxhash32([xi+1, yi  ], seed + i)) * 2 - 1;
    const n01 = hashToFloat(xxhash32([xi,   yi+1], seed + i)) * 2 - 1;
    const n11 = hashToFloat(xxhash32([xi+1, yi+1], seed + i)) * 2 - 1;
    const nx0 = n00 * (1 - ssx) + n10 * ssx;
    const nx1 = n01 * (1 - ssx) + n11 * ssx;
    value  += amp * (nx0 * (1 - ssy) + nx1 * ssy);
    maxAmp += amp;
    amp    *= 0.5;
    freq   *= 2.0;
  }
  return (value / maxAmp + 1) / 2; // Normalise to [0, 1]
}

// In your quest call, replace type selection:
function generateQuestWithBias(
  x: number, y: number, z: number, worldSeed: number, profileName: string
) {
  const quest = generateQuest(x, y, z, worldSeed, profileName);
  const bias  = coherentValue(x * 0.001, y * 0.001, worldSeed + 500, 3);
  // Shift the type index by bias (wraps around the 4-type ring)
  const biasedIndex = (quest.typeIndex + Math.floor(bias * 4)) % 4;
  // Re-derive with biased type — note: you must regenerate narrative for new type
  // This is a lightweight second call using a biased coordinate offset:
  const offsetX = x + Math.floor(bias * 100);
  return generateQuest(offsetX, y, z, worldSeed, profileName);
}
```

---

### Optional Enhancement: Difficulty Scaling Integration

The `difficulty` field (0.0–1.0) returned by `generateQuest()` is intended to be consumed by the game engine's enemy spawner and AI configuration. Example mapping:

```typescript
function configureEnemiesForQuest(quest: QuestResult): EnemyConfig {
  const tier = Math.floor(quest.difficulty * 5); // 0–4 tiers
  return {
    enemyCount:       4 + tier * 2,             // 4 to 12
    healthMultiplier: 1.0 + quest.difficulty,   // 1.0× to 2.0×
    aggressionLevel:  tier,                     // 0 (passive) to 4 (berserker)
    bossSpawn:        quest.questType === "STRONGHOLD" && tier >= 2,
    bossHealthMult:   1.0 + quest.difficulty * 2,
  };
}
```

---

## Style Guide

ZeroQuest has no user-facing UI. Narrative text style is entirely defined by the active profile. The following style conventions apply to profile authoring:

**Templates:** Use sentence case. End with a full stop. Keep to 1–2 sentences maximum per template. Avoid passive voice. Prefer active, directive language. Do not include character names — profiles are world-generic.

**Pool entries:** Each entry should be interchangeable with any other entry in the pool when substituted into any template referencing that pool. Entries that only work with specific templates create awkward outputs — test all combinations mentally before shipping.

**Minimum pool sizes:** 6 entries per pool. Fewer than 6 creates detectable repetition in play.

**Minimum template counts:** 5 per layer per quest type. Fewer creates visible pattern repetition across a session.

**World-specific profiles:** Must not use vocabulary that leaks outside the world's lore constraints. A Paradistro profile entry must never reference spaceships, the void, or living humans. A fantasy profile must never reference computers or radio. Enforce these constraints by profile review, not code.

---

## Performance Goals

| Metric | Target | Notes |
|---|---|---|
| `generateQuest()` call | < 0.5ms | Single xxhash call + template fills — trivially fast |
| `getQuestType()` call | < 0.05ms | One xxhash32 + one modulo |
| Profile load at startup | < 5ms | JSON parse of two ~15KB files — once only |
| Memory per profile | < 100KB | Two JSON profiles total |
| Total module size | < 20KB minified | No dependencies |
| `generateQuest()` per frame (batch) | 1000+ calls/frame | Suitable for map pre-rendering |

The engine is synchronous and allocation-minimal. The only allocations per call are the output string objects from template fill. No async, no I/O, no network at runtime.

---

## Accessibility Requirements

ZeroQuest generates text strings. All accessibility considerations apply to the game engine rendering that text, not to ZeroQuest itself. The engine must ensure:

- All generated strings are plain text (no embedded HTML, no markdown).
- No generated string exceeds 300 characters. Profiles must be authored to comply.
- Timer values are plain integers in seconds — the game UI is responsible for formatting ("2:30" vs "150 seconds").
- No color, icon, or spatial meaning is embedded in generated strings. Quest type is exposed as a typed enum for the UI to interpret.

---

## Glossary

| Term | Definition |
|---|---|
| **ZeroQuest** | This system. Position-is-quest procedural mission generation. |
| **ZeroBytes** | The position-is-seed hashing methodology this system is built on. |
| **ZeroResponse** | The template-fill text generation engine used for narrative layers. |
| **xxhash32** | The canonical hash function. Must not be substituted. |
| **Quest Seed** | 32-bit unsigned int derived from `xxhash32([x, y, z], worldSeed)`. Root of all quest data. |
| **Quest Type** | One of: `PROTECT_HOME`, `PROTECT_POI`, `DATA_DUMP`, `STRONGHOLD`. Selected by `questSeed % 4`. |
| **Quest Profile** | A JSON file defining templates and pools for all quest types and narrative layers. |
| **Narrative Layer** | One text output category: briefing, objective_label, stage_prompt, success, failure, in_mission. |
| **Layer Salt** | Integer constant added to quest seed before hashing a layer, preventing cross-layer collision. |
| **Stage Seed** | Child seed: `xxhash32([parentSeed, stageIndex, 0], worldSeed)`. |
| **DATA_DUMP Chain** | Three-stage sequential quest. Stages 2–3 at coordinates derived from stage seeds. |
| **World Seed** | Optional global integer. Shifts the entire quest universe for a campaign run. |
| **Difficulty** | `hashToFloat(xxhash32([questSeed, 9100], 0))` — a float in [0, 1). Game engine maps to enemy parameters. |
| **Coherent Bias** | Optional ZeroBytes noise overlay for regional quest type weighting. Does not break determinism. |
| **TINS** | There Is No Source — this document is the source. Any capable AI can generate a complete implementation from it. |

---

*The quest already exists. The coordinate knows it. You only have to ask.*

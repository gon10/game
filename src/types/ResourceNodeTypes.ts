/**
 * Resource Node Types - Defines farmable resource nodes
 * 
 * Node Types:
 * - Tree (green) - Drops wood on hit
 * - Gold Vein (golden glow) - Drops gold on hit  
 * - Stone Rock (gray) - Drops stone on hit
 * - Metin Stone (purple glow) - Drops random element talismans on death
 * 
 * Each node has:
 * - Health (must be depleted to destroy)
 * - Drop chance per hit (% chance to drop resource)
 * - Respawn time after depletion
 */

import { ElementType, ResourceType } from './ItemTypes';

/**
 * Types of resource nodes
 */
export type ResourceNodeType = 'tree' | 'gold_vein' | 'stone_rock' | 'metin_stone';

/**
 * Visual shape types for nodes
 */
export type NodeShape = 'tree' | 'rock' | 'crystal' | 'pillar' | 'vein';

/**
 * Resource node definition
 */
export interface ResourceNodeDefinition {
  id: ResourceNodeType;
  name: string;
  health: number;
  
  // What drops on each hit (chance-based)
  hitDropChance: number; // 0-1 probability
  hitDropType: ResourceType | 'talisman';
  hitDropMin: number;
  hitDropMax: number;
  
  // What drops when destroyed (guaranteed)
  deathDropType: ResourceType | 'talisman' | null;
  deathDropMin: number;
  deathDropMax: number;
  
  // For metin stones - random element talisman on death
  dropsTalisman: boolean;
  
  // Respawn time in milliseconds
  respawnTime: number;
  
  // Visual properties
  color: number;
  glowColor: number;
  scale: number;
  shape: NodeShape;
}

/**
 * Resource node instance in the world
 */
export interface ResourceNodeInstance {
  id: string;
  typeId: ResourceNodeType;
  x: number;
  z: number;
  health: number;
  maxHealth: number;
  isAlive: boolean;
  respawnAt: number | null;
}

/**
 * Network event for node spawn
 */
export interface ResourceNodeSpawnEvent {
  id: string;
  typeId: ResourceNodeType;
  name: string;
  x: number;
  z: number;
  health: number;
  maxHealth: number;
  color: number;
  glowColor: number;
  scale: number;
  shape: NodeShape;
}

/**
 * Network event for node damage
 */
export interface ResourceNodeDamageEvent {
  nodeId: string;
  damage: number;
  health: number;
  maxHealth: number;
  attackerId: string;
}

/**
 * Network event for node destroyed
 */
export interface ResourceNodeDestroyedEvent {
  nodeId: string;
  respawnTime: number;
}

/**
 * Resource node definitions
 */
export const RESOURCE_NODE_TYPES: Record<ResourceNodeType, ResourceNodeDefinition> = {
  tree: {
    id: 'tree',
    name: 'Tree',
    health: 150,
    hitDropChance: 0.5, // 50% chance to drop on each hit
    hitDropType: 'wood',
    hitDropMin: 2,
    hitDropMax: 5,
    deathDropType: 'wood',
    deathDropMin: 8,
    deathDropMax: 15,
    dropsTalisman: false,
    respawnTime: 45000, // 45 seconds
    color: 0x228b22, // Forest green (trunk is brown)
    glowColor: 0x44ff44,
    scale: 2.0,
    shape: 'tree',
  },
  
  gold_vein: {
    id: 'gold_vein',
    name: 'Gold Vein',
    health: 200,
    hitDropChance: 0.4, // 40% chance
    hitDropType: 'gold',
    hitDropMin: 3,
    hitDropMax: 8,
    deathDropType: 'gold',
    deathDropMin: 15,
    deathDropMax: 30,
    dropsTalisman: false,
    respawnTime: 60000, // 60 seconds
    color: 0xffd700, // Gold
    glowColor: 0xffee88,
    scale: 1.5,
    shape: 'vein',
  },
  
  stone_rock: {
    id: 'stone_rock',
    name: 'Stone Rock',
    health: 250,
    hitDropChance: 0.55, // 55% chance
    hitDropType: 'stone',
    hitDropMin: 3,
    hitDropMax: 6,
    deathDropType: 'stone',
    deathDropMin: 12,
    deathDropMax: 20,
    dropsTalisman: false,
    respawnTime: 50000, // 50 seconds
    color: 0x696969, // Dim gray
    glowColor: 0x888888,
    scale: 1.8,
    shape: 'rock',
  },
  
  metin_stone: {
    id: 'metin_stone',
    name: 'Metin Stone',
    health: 400,
    hitDropChance: 0.2, // 20% chance for mixed resources
    hitDropType: 'gold', // Drops gold on hit
    hitDropMin: 2,
    hitDropMax: 5,
    deathDropType: 'talisman', // Guaranteed talisman on death
    deathDropMin: 1,
    deathDropMax: 2,
    dropsTalisman: true, // Random element
    respawnTime: 120000, // 2 minutes
    color: 0x8b008b, // Dark magenta
    glowColor: 0xff44ff,
    scale: 2.5,
    shape: 'pillar',
  },
};

/**
 * Spawn configuration for resource nodes
 */
export const NODE_SPAWN_CONFIG = {
  // Total nodes of each type across the entire map (increased for 350 radius map)
  nodesPerType: {
    tree: 50, // Trees scattered throughout - most common
    gold_vein: 25, // Gold veins spread around mid zones
    stone_rock: 40, // Rocks fairly common everywhere
    metin_stone: 15, // Metin stones are rare but still findable
  },
  
  // Radius ranges for different node types (spread across larger map)
  spawnZones: {
    tree: { minRadius: 50, maxRadius: 330 }, // Trees everywhere
    gold_vein: { minRadius: 80, maxRadius: 300 }, // Gold in mid-outer zones
    stone_rock: { minRadius: 40, maxRadius: 320 }, // Rocks everywhere  
    metin_stone: { minRadius: 100, maxRadius: 280 }, // Metin in mid zones
  },
  
  // Minimum distance between nodes of same type (slightly reduced for density)
  minSpacing: 25,
  
  // Safe zone around player spawns (no nodes)
  safeZoneRadius: 35,
};

/**
 * Get all element types for random talisman drops
 */
export const ALL_ELEMENTS: ElementType[] = ['fire', 'water', 'grass', 'rock', 'psychic'];

/**
 * Get random element for talisman drop
 */
export function getRandomElement(): ElementType {
  return ALL_ELEMENTS[Math.floor(Math.random() * ALL_ELEMENTS.length)]!;
}

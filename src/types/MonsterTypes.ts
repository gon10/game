/**
 * Monster Types - Metin2-inspired monster definitions
 * Monsters are organized into tiers with increasing difficulty
 * Each monster has unique visuals, stats, and pack behaviors
 */

import { ElementType } from './CharacterTypes';

/**
 * Monster visual shape types for distinct appearances
 */
export type MonsterShape = 'sphere' | 'cone' | 'cylinder' | 'box' | 'ellipsoid' | 'spike';

/**
 * Monster body part configuration for composite meshes
 */
export interface MonsterBodyParts {
  hasLegs?: boolean;
  legCount?: number;
  hasTail?: boolean;
  hasHorns?: boolean;
  hasWings?: boolean;
  hasArms?: boolean;
  armStyle?: 'thin' | 'thick' | 'tentacle';
  hasSpikes?: boolean;
  spikeCount?: number;
}

/**
 * Pack behavior configuration
 */
export interface PackConfig {
  packSize: { min: number; max: number };
  spacing: number; // Distance between pack members
  formation: 'tight' | 'loose' | 'circle' | 'line';
  isSolitary: boolean; // Overrides pack spawning
}

/**
 * Monster definition with all stats and visuals
 */
export interface MonsterType {
  id: string;
  name: string;
  tier: 1 | 2 | 3 | 4 | 5; // 5 = world boss
  level: number;
  elementType: ElementType;
  
  // Visual properties
  shape: MonsterShape;
  color: number;
  glowColor: number;
  scale: number;
  bodyParts: MonsterBodyParts;
  
  // Combat stats
  stats: {
    health: number;
    attackDamage: number;
    attackSpeed: number; // attacks per second
    attackRange: number;
    moveSpeed: number;
  };
  
  // AI behavior
  aggroRadius: number;
  leashDistance: number;
  
  // Pack behavior
  packConfig: PackConfig;
  
  // Rewards
  xpReward: number;
}

/**
 * Spawn zone definition for wedge-based spawning
 */
export interface SpawnZone {
  id: string;
  name: string;
  minRadius: number;
  maxRadius: number;
  levelRange: { min: number; max: number };
  monsterTypes: string[]; // Monster type IDs
  maxMonsters: number;
  respawnTime: number; // in milliseconds
}

/**
 * Map configuration constants
 */
export const MAP_CONFIG = {
  RADIUS: 200,
  CENTER_RADIUS: 25,
  PLAYER_SPAWN_RADIUS: 35,
  CORRIDOR_WIDTH: 8,
  NUM_PLAYERS: 5,
  WEDGE_ANGLE: (2 * Math.PI) / 5,
};

/**
 * Monster type definitions organized by tier
 * 
 * Tier 1 (L1-5): Near spawn, wolves in packs of 3
 * Tier 2 (L6-10): Mid zone, solitary bears
 * Tier 3 (L11-15): Outer zone, archers in loose groups of 4
 * Tier 4 (L16-20): Edge zone, elites in dense packs of 5-6
 * Tier 5: World Boss at center
 */
export const MONSTER_TYPES: Record<string, MonsterType> = {
  // ==================== TIER 1 (Level 1-5) - Wolves in tight packs ====================
  wolfPup: {
    id: 'wolfPup',
    name: 'Wolf Pup',
    tier: 1,
    level: 1,
    elementType: 'rock',
    shape: 'ellipsoid',
    color: 0x665544,
    glowColor: 0x443322,
    scale: 0.6,
    bodyParts: { hasLegs: true, legCount: 4, hasTail: true },
    stats: {
      health: 45,
      attackDamage: 5,
      attackSpeed: 1.0,
      attackRange: 1.5,
      moveSpeed: 5,
    },
    aggroRadius: 8,
    leashDistance: 12,
    packConfig: { packSize: { min: 3, max: 3 }, spacing: 2, formation: 'tight', isSolitary: false },
    xpReward: 10,
  },
  
  youngWolf: {
    id: 'youngWolf',
    name: 'Young Wolf',
    tier: 1,
    level: 2,
    elementType: 'rock',
    shape: 'ellipsoid',
    color: 0x776655,
    glowColor: 0x554433,
    scale: 0.7,
    bodyParts: { hasLegs: true, legCount: 4, hasTail: true },
    stats: {
      health: 55,
      attackDamage: 7,
      attackSpeed: 1.1,
      attackRange: 1.6,
      moveSpeed: 5.5,
    },
    aggroRadius: 8,
    leashDistance: 12,
    packConfig: { packSize: { min: 3, max: 3 }, spacing: 2, formation: 'tight', isSolitary: false },
    xpReward: 14,
  },
  
  wolf: {
    id: 'wolf',
    name: 'Gray Wolf',
    tier: 1,
    level: 3,
    elementType: 'rock',
    shape: 'ellipsoid',
    color: 0x888877,
    glowColor: 0x666655,
    scale: 0.8,
    bodyParts: { hasLegs: true, legCount: 4, hasTail: true },
    stats: {
      health: 70,
      attackDamage: 9,
      attackSpeed: 1.2,
      attackRange: 1.7,
      moveSpeed: 6,
    },
    aggroRadius: 9,
    leashDistance: 13.5,
    packConfig: { packSize: { min: 3, max: 3 }, spacing: 2, formation: 'tight', isSolitary: false },
    xpReward: 18,
  },
  
  alphaWolf: {
    id: 'alphaWolf',
    name: 'Alpha Wolf',
    tier: 1,
    level: 4,
    elementType: 'psychic',
    shape: 'ellipsoid',
    color: 0x444455,
    glowColor: 0x333344,
    scale: 0.9,
    bodyParts: { hasLegs: true, legCount: 4, hasTail: true },
    stats: {
      health: 90,
      attackDamage: 11,
      attackSpeed: 1.3,
      attackRange: 1.8,
      moveSpeed: 6.5,
    },
    aggroRadius: 10,
    leashDistance: 15,
    packConfig: { packSize: { min: 3, max: 3 }, spacing: 2.5, formation: 'tight', isSolitary: false },
    xpReward: 22,
  },
  
  shadowWolf: {
    id: 'shadowWolf',
    name: 'Shadow Wolf',
    tier: 1,
    level: 5,
    elementType: 'psychic',
    shape: 'ellipsoid',
    color: 0x333344,
    glowColor: 0x222233,
    scale: 1.0,
    bodyParts: { hasLegs: true, legCount: 4, hasTail: true },
    stats: {
      health: 110,
      attackDamage: 14,
      attackSpeed: 1.4,
      attackRange: 1.9,
      moveSpeed: 7,
    },
    aggroRadius: 10,
    leashDistance: 15,
    packConfig: { packSize: { min: 3, max: 3 }, spacing: 2.5, formation: 'tight', isSolitary: false },
    xpReward: 28,
  },
  
  // ==================== TIER 2 (Level 6-10) - Solitary bears ====================
  brownBear: {
    id: 'brownBear',
    name: 'Brown Bear',
    tier: 2,
    level: 6,
    elementType: 'rock',
    shape: 'box',
    color: 0x8b6914,
    glowColor: 0x6b4914,
    scale: 1.3,
    bodyParts: { hasLegs: true, legCount: 4, hasArms: true, armStyle: 'thick' },
    stats: {
      health: 180,
      attackDamage: 20,
      attackSpeed: 0.7,
      attackRange: 2.2,
      moveSpeed: 3.5,
    },
    aggroRadius: 8,
    leashDistance: 12,
    packConfig: { packSize: { min: 1, max: 1 }, spacing: 0, formation: 'tight', isSolitary: true },
    xpReward: 45,
  },
  
  grizzly: {
    id: 'grizzly',
    name: 'Grizzly Bear',
    tier: 2,
    level: 7,
    elementType: 'rock',
    shape: 'box',
    color: 0x7a5a30,
    glowColor: 0x5a3a10,
    scale: 1.4,
    bodyParts: { hasLegs: true, legCount: 4, hasArms: true, armStyle: 'thick' },
    stats: {
      health: 220,
      attackDamage: 24,
      attackSpeed: 0.65,
      attackRange: 2.3,
      moveSpeed: 3.2,
    },
    aggroRadius: 8,
    leashDistance: 12,
    packConfig: { packSize: { min: 1, max: 1 }, spacing: 0, formation: 'tight', isSolitary: true },
    xpReward: 55,
  },
  
  caveBear: {
    id: 'caveBear',
    name: 'Cave Bear',
    tier: 2,
    level: 8,
    elementType: 'rock',
    shape: 'box',
    color: 0x4a4a4a,
    glowColor: 0x3a3a3a,
    scale: 1.5,
    bodyParts: { hasLegs: true, legCount: 4, hasArms: true, armStyle: 'thick' },
    stats: {
      health: 280,
      attackDamage: 28,
      attackSpeed: 0.6,
      attackRange: 2.4,
      moveSpeed: 2.8,
    },
    aggroRadius: 9,
    leashDistance: 13.5,
    packConfig: { packSize: { min: 1, max: 1 }, spacing: 0, formation: 'tight', isSolitary: true },
    xpReward: 65,
  },
  
  direBear: {
    id: 'direBear',
    name: 'Dire Bear',
    tier: 2,
    level: 9,
    elementType: 'fire',
    shape: 'box',
    color: 0x8b2500,
    glowColor: 0x6b0500,
    scale: 1.6,
    bodyParts: { hasLegs: true, legCount: 4, hasArms: true, armStyle: 'thick', hasSpikes: true, spikeCount: 3 },
    stats: {
      health: 340,
      attackDamage: 32,
      attackSpeed: 0.55,
      attackRange: 2.5,
      moveSpeed: 2.5,
    },
    aggroRadius: 9,
    leashDistance: 13.5,
    packConfig: { packSize: { min: 1, max: 1 }, spacing: 0, formation: 'tight', isSolitary: true },
    xpReward: 80,
  },
  
  ancientBear: {
    id: 'ancientBear',
    name: 'Ancient Bear',
    tier: 2,
    level: 10,
    elementType: 'grass',
    shape: 'box',
    color: 0x2d5a27,
    glowColor: 0x1d3a17,
    scale: 1.7,
    bodyParts: { hasLegs: true, legCount: 4, hasArms: true, armStyle: 'thick', hasSpikes: true, spikeCount: 5 },
    stats: {
      health: 400,
      attackDamage: 36,
      attackSpeed: 0.5,
      attackRange: 2.6,
      moveSpeed: 2.2,
    },
    aggroRadius: 10,
    leashDistance: 15,
    packConfig: { packSize: { min: 1, max: 1 }, spacing: 0, formation: 'tight', isSolitary: true },
    xpReward: 95,
  },
  
  // ==================== TIER 3 (Level 11-15) - Archers in loose groups of 4 ====================
  goblinArcher: {
    id: 'goblinArcher',
    name: 'Goblin Archer',
    tier: 3,
    level: 11,
    elementType: 'grass',
    shape: 'cylinder',
    color: 0x4a7a3a,
    glowColor: 0x3a5a2a,
    scale: 0.8,
    bodyParts: { hasLegs: true, legCount: 2, hasArms: true, armStyle: 'thin' },
    stats: {
      health: 150,
      attackDamage: 30,
      attackSpeed: 1.2,
      attackRange: 8,
      moveSpeed: 4,
    },
    aggroRadius: 12,
    leashDistance: 18,
    packConfig: { packSize: { min: 4, max: 4 }, spacing: 5, formation: 'loose', isSolitary: false },
    xpReward: 70,
  },
  
  orcArcher: {
    id: 'orcArcher',
    name: 'Orc Archer',
    tier: 3,
    level: 12,
    elementType: 'fire',
    shape: 'cylinder',
    color: 0x5a8a4a,
    glowColor: 0x4a6a3a,
    scale: 0.95,
    bodyParts: { hasLegs: true, legCount: 2, hasArms: true, armStyle: 'thin' },
    stats: {
      health: 180,
      attackDamage: 35,
      attackSpeed: 1.1,
      attackRange: 9,
      moveSpeed: 3.8,
    },
    aggroRadius: 13,
    leashDistance: 19.5,
    packConfig: { packSize: { min: 4, max: 4 }, spacing: 5, formation: 'loose', isSolitary: false },
    xpReward: 85,
  },
  
  skeletonArcher: {
    id: 'skeletonArcher',
    name: 'Skeleton Archer',
    tier: 3,
    level: 13,
    elementType: 'psychic',
    shape: 'cylinder',
    color: 0xccccaa,
    glowColor: 0xaaaaaa,
    scale: 0.9,
    bodyParts: { hasLegs: true, legCount: 2, hasArms: true, armStyle: 'thin' },
    stats: {
      health: 160,
      attackDamage: 40,
      attackSpeed: 1.3,
      attackRange: 10,
      moveSpeed: 4.5,
    },
    aggroRadius: 14,
    leashDistance: 21,
    packConfig: { packSize: { min: 4, max: 4 }, spacing: 4, formation: 'loose', isSolitary: false },
    xpReward: 100,
  },
  
  darkElf: {
    id: 'darkElf',
    name: 'Dark Elf Ranger',
    tier: 3,
    level: 14,
    elementType: 'psychic',
    shape: 'cylinder',
    color: 0x4a3a6a,
    glowColor: 0x3a2a5a,
    scale: 1.0,
    bodyParts: { hasLegs: true, legCount: 2, hasArms: true, armStyle: 'thin' },
    stats: {
      health: 200,
      attackDamage: 45,
      attackSpeed: 1.4,
      attackRange: 11,
      moveSpeed: 5,
    },
    aggroRadius: 15,
    leashDistance: 22.5,
    packConfig: { packSize: { min: 4, max: 4 }, spacing: 5, formation: 'loose', isSolitary: false },
    xpReward: 120,
  },
  
  deathRanger: {
    id: 'deathRanger',
    name: 'Death Ranger',
    tier: 3,
    level: 15,
    elementType: 'water',
    shape: 'cylinder',
    color: 0x2a4a6a,
    glowColor: 0x1a3a5a,
    scale: 1.1,
    bodyParts: { hasLegs: true, legCount: 2, hasArms: true, armStyle: 'thin' },
    stats: {
      health: 240,
      attackDamage: 50,
      attackSpeed: 1.5,
      attackRange: 12,
      moveSpeed: 5.5,
    },
    aggroRadius: 16,
    leashDistance: 24,
    packConfig: { packSize: { min: 4, max: 4 }, spacing: 5, formation: 'loose', isSolitary: false },
    xpReward: 140,
  },
  
  // ==================== TIER 4 (Level 16-20) - Elites in dense packs of 5-6 ====================
  demonImp: {
    id: 'demonImp',
    name: 'Demon Imp',
    tier: 4,
    level: 16,
    elementType: 'fire',
    shape: 'spike',
    color: 0xcc3300,
    glowColor: 0xaa1100,
    scale: 0.9,
    bodyParts: { hasLegs: true, legCount: 2, hasWings: true, hasHorns: true, hasTail: true },
    stats: {
      health: 350,
      attackDamage: 55,
      attackSpeed: 1.3,
      attackRange: 2.5,
      moveSpeed: 6,
    },
    aggroRadius: 14,
    leashDistance: 21,
    packConfig: { packSize: { min: 5, max: 6 }, spacing: 1.5, formation: 'tight', isSolitary: false },
    xpReward: 160,
  },
  
  hellhound: {
    id: 'hellhound',
    name: 'Hellhound',
    tier: 4,
    level: 17,
    elementType: 'fire',
    shape: 'ellipsoid',
    color: 0x8b0000,
    glowColor: 0x6b0000,
    scale: 1.2,
    bodyParts: { hasLegs: true, legCount: 4, hasTail: true, hasSpikes: true, spikeCount: 3 },
    stats: {
      health: 420,
      attackDamage: 60,
      attackSpeed: 1.4,
      attackRange: 2.2,
      moveSpeed: 7,
    },
    aggroRadius: 15,
    leashDistance: 22.5,
    packConfig: { packSize: { min: 5, max: 6 }, spacing: 1.5, formation: 'tight', isSolitary: false },
    xpReward: 185,
  },
  
  voidWraith: {
    id: 'voidWraith',
    name: 'Void Wraith',
    tier: 4,
    level: 18,
    elementType: 'psychic',
    shape: 'cone',
    color: 0x440066,
    glowColor: 0x220044,
    scale: 1.1,
    bodyParts: { hasArms: true, armStyle: 'tentacle', hasTail: true },
    stats: {
      health: 380,
      attackDamage: 70,
      attackSpeed: 1.2,
      attackRange: 4,
      moveSpeed: 5,
    },
    aggroRadius: 16,
    leashDistance: 24,
    packConfig: { packSize: { min: 5, max: 6 }, spacing: 2, formation: 'tight', isSolitary: false },
    xpReward: 210,
  },
  
  frostDemon: {
    id: 'frostDemon',
    name: 'Frost Demon',
    tier: 4,
    level: 19,
    elementType: 'water',
    shape: 'spike',
    color: 0x4488cc,
    glowColor: 0x2266aa,
    scale: 1.3,
    bodyParts: { hasLegs: true, legCount: 2, hasWings: true, hasHorns: true, hasSpikes: true, spikeCount: 4 },
    stats: {
      health: 500,
      attackDamage: 75,
      attackSpeed: 1.0,
      attackRange: 3,
      moveSpeed: 4.5,
    },
    aggroRadius: 16,
    leashDistance: 24,
    packConfig: { packSize: { min: 5, max: 6 }, spacing: 1.5, formation: 'tight', isSolitary: false },
    xpReward: 240,
  },
  
  shadowLord: {
    id: 'shadowLord',
    name: 'Shadow Lord',
    tier: 4,
    level: 20,
    elementType: 'psychic',
    shape: 'spike',
    color: 0x220033,
    glowColor: 0x110022,
    scale: 1.5,
    bodyParts: { hasLegs: true, legCount: 2, hasWings: true, hasHorns: true, hasArms: true, armStyle: 'tentacle', hasTail: true },
    stats: {
      health: 600,
      attackDamage: 85,
      attackSpeed: 1.1,
      attackRange: 4,
      moveSpeed: 5,
    },
    aggroRadius: 18,
    leashDistance: 27,
    packConfig: { packSize: { min: 5, max: 6 }, spacing: 1.5, formation: 'tight', isSolitary: false },
    xpReward: 280,
  },
  
  // ==================== TIER 5 - World Boss ====================
  abyssalTitan: {
    id: 'abyssalTitan',
    name: 'Abyssal Titan',
    tier: 5,
    level: 25,
    elementType: 'psychic',
    shape: 'spike',
    color: 0x110022,
    glowColor: 0xff0044,
    scale: 4.0,
    bodyParts: { 
      hasLegs: true, 
      legCount: 4, 
      hasWings: true, 
      hasHorns: true, 
      hasArms: true, 
      armStyle: 'tentacle',
      hasTail: true,
      hasSpikes: true,
      spikeCount: 8,
    },
    stats: {
      health: 10000,
      attackDamage: 150,
      attackSpeed: 0.8,
      attackRange: 6,
      moveSpeed: 3,
    },
    aggroRadius: 25,
    leashDistance: 25, // Stays in center arena
    packConfig: { packSize: { min: 1, max: 1 }, spacing: 0, formation: 'tight', isSolitary: true },
    xpReward: 2000,
  },
};

/**
 * Spawn zone definitions for wedge-based spawning
 * Each wedge has the same zones at the same distances from center
 * 
 * Center (0-25): World Boss arena
 * Inner Ring (35-60): Level 1-5, wolf packs
 * Mid Ring (60-100): Level 6-10, solitary bears
 * Outer Ring (100-150): Level 11-15, archer groups
 * Edge Ring (150-200): Level 16-20, elite packs
 */
export const SPAWN_ZONES: SpawnZone[] = [
  {
    id: 'boss',
    name: 'Titan Arena',
    minRadius: 0,
    maxRadius: MAP_CONFIG.CENTER_RADIUS,
    levelRange: { min: 25, max: 25 },
    monsterTypes: ['abyssalTitan'],
    maxMonsters: 1, // One world boss
    respawnTime: 300000, // 5 minutes
  },
  {
    id: 'inner',
    name: 'Wolf Den',
    minRadius: MAP_CONFIG.PLAYER_SPAWN_RADIUS + 5, // 40
    maxRadius: 60,
    levelRange: { min: 1, max: 5 },
    monsterTypes: ['wolfPup', 'youngWolf', 'wolf', 'alphaWolf', 'shadowWolf'],
    maxMonsters: 8, // Per wedge, will be multiplied by 5
    respawnTime: 5000,
  },
  {
    id: 'mid',
    name: 'Bear Territory',
    minRadius: 60,
    maxRadius: 100,
    levelRange: { min: 6, max: 10 },
    monsterTypes: ['brownBear', 'grizzly', 'caveBear', 'direBear', 'ancientBear'],
    maxMonsters: 5, // Per wedge, solitary bears
    respawnTime: 8000,
  },
  {
    id: 'outer',
    name: 'Archer Outpost',
    minRadius: 100,
    maxRadius: 150,
    levelRange: { min: 11, max: 15 },
    monsterTypes: ['goblinArcher', 'orcArcher', 'skeletonArcher', 'darkElf', 'deathRanger'],
    maxMonsters: 6, // Per wedge, in groups of 4
    respawnTime: 12000,
  },
  {
    id: 'edge',
    name: 'Demon Realm',
    minRadius: 150,
    maxRadius: MAP_CONFIG.RADIUS - 5, // Leave buffer at edge
    levelRange: { min: 16, max: 20 },
    monsterTypes: ['demonImp', 'hellhound', 'voidWraith', 'frostDemon', 'shadowLord'],
    maxMonsters: 5, // Per wedge, in packs of 5-6
    respawnTime: 15000,
  },
];

/**
 * Get monster type by ID
 */
export function getMonsterType(id: string): MonsterType | undefined {
  return MONSTER_TYPES[id];
}

/**
 * Get all monster types for a specific tier
 */
export function getMonstersByTier(tier: 1 | 2 | 3 | 4 | 5): MonsterType[] {
  return Object.values(MONSTER_TYPES).filter(m => m.tier === tier);
}

/**
 * Get spawn zone by position (distance from origin)
 */
export function getZoneAtPosition(x: number, z: number): SpawnZone | undefined {
  const distance = Math.sqrt(x * x + z * z);
  return SPAWN_ZONES.find(zone => distance >= zone.minRadius && distance < zone.maxRadius);
}

/**
 * Get a random spawn position within a zone and wedge
 * @param zone The spawn zone
 * @param wedgeIndex The wedge index (0-4), -1 for center boss
 */
export function getRandomSpawnInZone(zone: SpawnZone, wedgeIndex: number = -1): { x: number; z: number } {
  if (zone.id === 'boss') {
    // World boss spawns at center
    return { x: 0, z: 0 };
  }
  
  // Calculate wedge angle bounds
  const wedgeAngle = MAP_CONFIG.WEDGE_ANGLE;
  const wedgeStart = wedgeAngle * wedgeIndex - wedgeAngle / 2 + MAP_CONFIG.CORRIDOR_WIDTH / (zone.minRadius + zone.maxRadius);
  const wedgeEnd = wedgeAngle * wedgeIndex + wedgeAngle / 2 - MAP_CONFIG.CORRIDOR_WIDTH / (zone.minRadius + zone.maxRadius);
  
  // Random angle within wedge
  const angle = wedgeStart + Math.random() * (wedgeEnd - wedgeStart);
  const radius = zone.minRadius + Math.random() * (zone.maxRadius - zone.minRadius);
  
  return {
    x: Math.cos(angle) * radius,
    z: Math.sin(angle) * radius,
  };
}

/**
 * Get a random monster type for a zone based on level range
 */
export function getRandomMonsterForZone(zone: SpawnZone): MonsterType | undefined {
  if (zone.monsterTypes.length === 0) return undefined;
  const typeId = zone.monsterTypes[Math.floor(Math.random() * zone.monsterTypes.length)]!;
  return MONSTER_TYPES[typeId];
}

/**
 * Calculate XP required for a level (exponential curve)
 * Level 1 → 2: 100 XP
 * Each subsequent level requires 50% more
 */
export function getXPForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.floor(100 * Math.pow(1.5, level - 2));
}

/**
 * Calculate total XP required to reach a level from level 1
 */
export function getTotalXPForLevel(level: number): number {
  let total = 0;
  for (let i = 2; i <= level; i++) {
    total += getXPForLevel(i);
  }
  return total;
}

/**
 * Get player stats multiplier based on level
 * +5% to all stats per level
 */
export function getLevelStatMultiplier(level: number): number {
  return 1 + (level - 1) * 0.05;
}

/**
 * Calculate death respawn timer (like LoL)
 * Base: 5 seconds, +0.5s per level, max 30s
 */
export function getDeathRespawnTime(level: number): number {
  return Math.min(5000 + level * 500, 30000);
}

/**
 * Get pack spawn positions around a center point
 */
export function getPackPositions(
  centerX: number,
  centerZ: number,
  packConfig: PackConfig
): { x: number; z: number }[] {
  if (packConfig.isSolitary) {
    return [{ x: centerX, z: centerZ }];
  }
  
  const packSize = packConfig.packSize.min + 
    Math.floor(Math.random() * (packConfig.packSize.max - packConfig.packSize.min + 1));
  
  const positions: { x: number; z: number }[] = [];
  
  switch (packConfig.formation) {
    case 'tight':
      // Cluster tightly around center
      for (let i = 0; i < packSize; i++) {
        const angle = (Math.PI * 2 / packSize) * i + Math.random() * 0.3;
        const dist = packConfig.spacing * (0.5 + Math.random() * 0.5);
        positions.push({
          x: centerX + Math.cos(angle) * dist,
          z: centerZ + Math.sin(angle) * dist,
        });
      }
      break;
      
    case 'loose':
      // Spread out more
      for (let i = 0; i < packSize; i++) {
        const angle = (Math.PI * 2 / packSize) * i + Math.random() * 0.5;
        const dist = packConfig.spacing * (0.8 + Math.random() * 0.4);
        positions.push({
          x: centerX + Math.cos(angle) * dist,
          z: centerZ + Math.sin(angle) * dist,
        });
      }
      break;
      
    case 'circle':
      // Perfect circle formation
      for (let i = 0; i < packSize; i++) {
        const angle = (Math.PI * 2 / packSize) * i;
        positions.push({
          x: centerX + Math.cos(angle) * packConfig.spacing,
          z: centerZ + Math.sin(angle) * packConfig.spacing,
        });
      }
      break;
      
    case 'line':
      // Line formation
      for (let i = 0; i < packSize; i++) {
        positions.push({
          x: centerX + (i - packSize / 2) * packConfig.spacing,
          z: centerZ,
        });
      }
      break;
  }
  
  return positions;
}

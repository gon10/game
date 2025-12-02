/**
 * Monster Manager - Server-side monster spawning, AI, and respawning
 * Handles all monster logic in an authoritative manner
 * 
 * Features:
 * - Hexagonal map with 5 wedge sectors for balanced player spawning
 * - Pack-based spawning (wolves in tight packs of 3, bears solitary, archers in loose groups)
 * - Tiered zones: inner (L1-5), mid (L6-10), outer (L11-15), edge (L16-20)
 * - World boss at center arena
 * - Monsters stay at home until aggro, leash at 1.5x aggro range
 */

import { WorldState, ElementType } from './WorldState';

/**
 * Monster shape types for visual variety
 */
export type MonsterShape = 'sphere' | 'cone' | 'cylinder' | 'box' | 'ellipsoid' | 'spike';

/**
 * Monster body parts for composite mesh rendering
 */
interface MonsterBodyParts {
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
 * Pack configuration
 */
interface PackConfig {
  packSize: { min: number; max: number };
  spacing: number;
  formation: 'tight' | 'loose' | 'circle' | 'line';
  isSolitary: boolean;
}

/**
 * Monster type definition
 */
interface MonsterType {
  id: string;
  name: string;
  tier: 1 | 2 | 3 | 4 | 5;
  level: number;
  elementType: ElementType;
  shape: MonsterShape;
  color: number;
  glowColor: number;
  scale: number;
  bodyParts: MonsterBodyParts;
  stats: {
    health: number;
    attackDamage: number;
    attackSpeed: number;
    attackRange: number;
    moveSpeed: number;
  };
  aggroRadius: number;
  packConfig: PackConfig;
  xpReward: number;
}

/**
 * Spawn zone definition
 */
interface SpawnZone {
  id: string;
  name: string;
  minRadius: number;
  maxRadius: number;
  levelRange: { min: number; max: number };
  monsterTypes: string[];
  maxMonsters: number;
  respawnTime: number;
}

/**
 * Active monster instance tracked by server
 */
interface MonsterInstance {
  id: string;
  typeId: string;
  zoneId: string;
  wedgeIndex: number; // -1 for center boss
  packId: string | null; // Pack identifier for grouped monsters
  spawnX: number;
  spawnZ: number;
  currentX: number;
  currentZ: number;
  health: number;
  maxHealth: number;
  isAlive: boolean;
  respawnAt: number | null;
  
  // AI state
  aggroTarget: string | null;
  lastAttackTime: number;
  isReturning: boolean;
  homeX: number; // Position to return to (may differ from spawn for pack members)
  homeZ: number;
}

/**
 * Map configuration - Expanded map with more spread
 */
const MAP_CONFIG = {
  RADIUS: 350, // Increased from 200 for larger map
  CENTER_RADIUS: 35, // Slightly larger boss arena
  PLAYER_SPAWN_RADIUS: 280, // Players spawn at outer edge (was 160)
  SAFE_ZONE_RADIUS: 30, // Larger safe zones around spawns
  CORRIDOR_WIDTH: 12, // Wider corridors
  NUM_PLAYERS: 5,
  WEDGE_ANGLE: (2 * Math.PI) / 5,
};

// Export spawn position calculator for WorldState to use
export function getPlayerSpawnPosition(playerIndex: number): { x: number; z: number } {
  const angle = MAP_CONFIG.WEDGE_ANGLE * playerIndex;
  return {
    x: Math.cos(angle) * MAP_CONFIG.PLAYER_SPAWN_RADIUS,
    z: Math.sin(angle) * MAP_CONFIG.PLAYER_SPAWN_RADIUS,
  };
}

// Check if a position is in a safe zone (near any player spawn)
export function isInSafeZone(x: number, z: number): boolean {
  for (let i = 0; i < MAP_CONFIG.NUM_PLAYERS; i++) {
    const spawn = getPlayerSpawnPosition(i);
    const dx = x - spawn.x;
    const dz = z - spawn.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < MAP_CONFIG.SAFE_ZONE_RADIUS * MAP_CONFIG.SAFE_ZONE_RADIUS) {
      return true;
    }
  }
  return false;
}

// Monster type definitions
const MONSTER_TYPES: Record<string, MonsterType> = {
  // ==================== TIER 1 (Level 1-5) - Wolves in tight packs ====================
  wolfPup: {
    id: 'wolfPup', name: 'Wolf Pup', tier: 1, level: 1, elementType: 'rock',
    shape: 'ellipsoid', color: 0x665544, glowColor: 0x443322, scale: 0.6,
    bodyParts: { hasLegs: true, legCount: 4, hasTail: true },
    stats: { health: 45, attackDamage: 5, attackSpeed: 1.0, attackRange: 1.5, moveSpeed: 5 },
    aggroRadius: 8,
    packConfig: { packSize: { min: 3, max: 3 }, spacing: 4, formation: 'tight', isSolitary: false }, // Increased spacing from 2 to 4
    xpReward: 10,
  },
  youngWolf: {
    id: 'youngWolf', name: 'Young Wolf', tier: 1, level: 2, elementType: 'rock',
    shape: 'ellipsoid', color: 0x776655, glowColor: 0x554433, scale: 0.7,
    bodyParts: { hasLegs: true, legCount: 4, hasTail: true },
    stats: { health: 55, attackDamage: 7, attackSpeed: 1.1, attackRange: 1.6, moveSpeed: 5.5 },
    aggroRadius: 8,
    packConfig: { packSize: { min: 3, max: 3 }, spacing: 4, formation: 'tight', isSolitary: false }, // Increased spacing from 2 to 4
    xpReward: 14,
  },
  wolf: {
    id: 'wolf', name: 'Gray Wolf', tier: 1, level: 3, elementType: 'rock',
    shape: 'ellipsoid', color: 0x888877, glowColor: 0x666655, scale: 0.8,
    bodyParts: { hasLegs: true, legCount: 4, hasTail: true },
    stats: { health: 70, attackDamage: 9, attackSpeed: 1.2, attackRange: 1.7, moveSpeed: 6 },
    aggroRadius: 9,
    packConfig: { packSize: { min: 3, max: 3 }, spacing: 5, formation: 'tight', isSolitary: false }, // Increased spacing from 2 to 5
    xpReward: 18,
  },
  alphaWolf: {
    id: 'alphaWolf', name: 'Alpha Wolf', tier: 1, level: 4, elementType: 'psychic',
    shape: 'ellipsoid', color: 0x444455, glowColor: 0x333344, scale: 0.9,
    bodyParts: { hasLegs: true, legCount: 4, hasTail: true },
    stats: { health: 90, attackDamage: 11, attackSpeed: 1.3, attackRange: 1.8, moveSpeed: 6.5 },
    aggroRadius: 10,
    packConfig: { packSize: { min: 3, max: 3 }, spacing: 5, formation: 'tight', isSolitary: false }, // Increased spacing from 2.5 to 5
    xpReward: 22,
  },
  shadowWolf: {
    id: 'shadowWolf', name: 'Shadow Wolf', tier: 1, level: 5, elementType: 'psychic',
    shape: 'ellipsoid', color: 0x333344, glowColor: 0x222233, scale: 1.0,
    bodyParts: { hasLegs: true, legCount: 4, hasTail: true },
    stats: { health: 110, attackDamage: 14, attackSpeed: 1.4, attackRange: 1.9, moveSpeed: 7 },
    aggroRadius: 10,
    packConfig: { packSize: { min: 3, max: 3 }, spacing: 5, formation: 'tight', isSolitary: false }, // Increased spacing from 2.5 to 5
    xpReward: 28,
  },
  
  // ==================== TIER 2 (Level 6-10) - Solitary bears ====================
  brownBear: {
    id: 'brownBear', name: 'Brown Bear', tier: 2, level: 6, elementType: 'rock',
    shape: 'box', color: 0x8b6914, glowColor: 0x6b4914, scale: 1.3,
    bodyParts: { hasLegs: true, legCount: 4, hasArms: true, armStyle: 'thick' },
    stats: { health: 180, attackDamage: 20, attackSpeed: 0.7, attackRange: 2.2, moveSpeed: 3.5 },
    aggroRadius: 8,
    packConfig: { packSize: { min: 1, max: 1 }, spacing: 0, formation: 'tight', isSolitary: true },
    xpReward: 45,
  },
  grizzly: {
    id: 'grizzly', name: 'Grizzly Bear', tier: 2, level: 7, elementType: 'rock',
    shape: 'box', color: 0x7a5a30, glowColor: 0x5a3a10, scale: 1.4,
    bodyParts: { hasLegs: true, legCount: 4, hasArms: true, armStyle: 'thick' },
    stats: { health: 220, attackDamage: 24, attackSpeed: 0.65, attackRange: 2.3, moveSpeed: 3.2 },
    aggroRadius: 8,
    packConfig: { packSize: { min: 1, max: 1 }, spacing: 0, formation: 'tight', isSolitary: true },
    xpReward: 55,
  },
  caveBear: {
    id: 'caveBear', name: 'Cave Bear', tier: 2, level: 8, elementType: 'rock',
    shape: 'box', color: 0x4a4a4a, glowColor: 0x3a3a3a, scale: 1.5,
    bodyParts: { hasLegs: true, legCount: 4, hasArms: true, armStyle: 'thick' },
    stats: { health: 280, attackDamage: 28, attackSpeed: 0.6, attackRange: 2.4, moveSpeed: 2.8 },
    aggroRadius: 9,
    packConfig: { packSize: { min: 1, max: 1 }, spacing: 0, formation: 'tight', isSolitary: true },
    xpReward: 65,
  },
  direBear: {
    id: 'direBear', name: 'Dire Bear', tier: 2, level: 9, elementType: 'fire',
    shape: 'box', color: 0x8b2500, glowColor: 0x6b0500, scale: 1.6,
    bodyParts: { hasLegs: true, legCount: 4, hasArms: true, armStyle: 'thick', hasSpikes: true, spikeCount: 3 },
    stats: { health: 340, attackDamage: 32, attackSpeed: 0.55, attackRange: 2.5, moveSpeed: 2.5 },
    aggroRadius: 9,
    packConfig: { packSize: { min: 1, max: 1 }, spacing: 0, formation: 'tight', isSolitary: true },
    xpReward: 80,
  },
  ancientBear: {
    id: 'ancientBear', name: 'Ancient Bear', tier: 2, level: 10, elementType: 'grass',
    shape: 'box', color: 0x2d5a27, glowColor: 0x1d3a17, scale: 1.7,
    bodyParts: { hasLegs: true, legCount: 4, hasArms: true, armStyle: 'thick', hasSpikes: true, spikeCount: 5 },
    stats: { health: 400, attackDamage: 36, attackSpeed: 0.5, attackRange: 2.6, moveSpeed: 2.2 },
    aggroRadius: 10,
    packConfig: { packSize: { min: 1, max: 1 }, spacing: 0, formation: 'tight', isSolitary: true },
    xpReward: 95,
  },
  
  // ==================== TIER 3 (Level 11-15) - Archers in loose groups ====================
  goblinArcher: {
    id: 'goblinArcher', name: 'Goblin Archer', tier: 3, level: 11, elementType: 'grass',
    shape: 'cylinder', color: 0x4a7a3a, glowColor: 0x3a5a2a, scale: 0.8,
    bodyParts: { hasLegs: true, legCount: 2, hasArms: true, armStyle: 'thin' },
    stats: { health: 150, attackDamage: 30, attackSpeed: 1.2, attackRange: 8, moveSpeed: 4 },
    aggroRadius: 12,
    packConfig: { packSize: { min: 3, max: 4 }, spacing: 8, formation: 'loose', isSolitary: false }, // Reduced pack size, increased spacing from 5 to 8
    xpReward: 70,
  },
  orcArcher: {
    id: 'orcArcher', name: 'Orc Archer', tier: 3, level: 12, elementType: 'fire',
    shape: 'cylinder', color: 0x5a8a4a, glowColor: 0x4a6a3a, scale: 0.95,
    bodyParts: { hasLegs: true, legCount: 2, hasArms: true, armStyle: 'thin' },
    stats: { health: 180, attackDamage: 35, attackSpeed: 1.1, attackRange: 9, moveSpeed: 3.8 },
    aggroRadius: 13,
    packConfig: { packSize: { min: 3, max: 4 }, spacing: 8, formation: 'loose', isSolitary: false }, // Reduced pack size, increased spacing from 5 to 8
    xpReward: 85,
  },
  skeletonArcher: {
    id: 'skeletonArcher', name: 'Skeleton Archer', tier: 3, level: 13, elementType: 'psychic',
    shape: 'cylinder', color: 0xccccaa, glowColor: 0xaaaaaa, scale: 0.9,
    bodyParts: { hasLegs: true, legCount: 2, hasArms: true, armStyle: 'thin' },
    stats: { health: 160, attackDamage: 40, attackSpeed: 1.3, attackRange: 10, moveSpeed: 4.5 },
    aggroRadius: 14,
    packConfig: { packSize: { min: 3, max: 4 }, spacing: 7, formation: 'loose', isSolitary: false }, // Reduced pack size, increased spacing from 4 to 7
    xpReward: 100,
  },
  darkElf: {
    id: 'darkElf', name: 'Dark Elf Ranger', tier: 3, level: 14, elementType: 'psychic',
    shape: 'cylinder', color: 0x4a3a6a, glowColor: 0x3a2a5a, scale: 1.0,
    bodyParts: { hasLegs: true, legCount: 2, hasArms: true, armStyle: 'thin' },
    stats: { health: 200, attackDamage: 45, attackSpeed: 1.4, attackRange: 11, moveSpeed: 5 },
    aggroRadius: 15,
    packConfig: { packSize: { min: 3, max: 4 }, spacing: 8, formation: 'loose', isSolitary: false }, // Reduced pack size, increased spacing from 5 to 8
    xpReward: 120,
  },
  deathRanger: {
    id: 'deathRanger', name: 'Death Ranger', tier: 3, level: 15, elementType: 'water',
    shape: 'cylinder', color: 0x2a4a6a, glowColor: 0x1a3a5a, scale: 1.1,
    bodyParts: { hasLegs: true, legCount: 2, hasArms: true, armStyle: 'thin' },
    stats: { health: 240, attackDamage: 50, attackSpeed: 1.5, attackRange: 12, moveSpeed: 5.5 },
    aggroRadius: 16,
    packConfig: { packSize: { min: 3, max: 4 }, spacing: 8, formation: 'loose', isSolitary: false }, // Reduced pack size, increased spacing from 5 to 8
    xpReward: 140,
  },
  
  // ==================== TIER 4 (Level 16-20) - Elites in dense packs ====================
  demonImp: {
    id: 'demonImp', name: 'Demon Imp', tier: 4, level: 16, elementType: 'fire',
    shape: 'spike', color: 0xcc3300, glowColor: 0xaa1100, scale: 0.9,
    bodyParts: { hasLegs: true, legCount: 2, hasWings: true, hasHorns: true, hasTail: true },
    stats: { health: 350, attackDamage: 55, attackSpeed: 1.3, attackRange: 2.5, moveSpeed: 6 },
    aggroRadius: 14,
    packConfig: { packSize: { min: 3, max: 4 }, spacing: 3, formation: 'tight', isSolitary: false }, // Reduced from 5-6 to 3-4, increased spacing from 1.5 to 3
    xpReward: 160,
  },
  hellhound: {
    id: 'hellhound', name: 'Hellhound', tier: 4, level: 17, elementType: 'fire',
    shape: 'ellipsoid', color: 0x8b0000, glowColor: 0x6b0000, scale: 1.2,
    bodyParts: { hasLegs: true, legCount: 4, hasTail: true, hasSpikes: true, spikeCount: 3 },
    stats: { health: 420, attackDamage: 60, attackSpeed: 1.4, attackRange: 2.2, moveSpeed: 7 },
    aggroRadius: 15,
    packConfig: { packSize: { min: 3, max: 4 }, spacing: 3, formation: 'tight', isSolitary: false }, // Reduced from 5-6 to 3-4, increased spacing from 1.5 to 3
    xpReward: 185,
  },
  voidWraith: {
    id: 'voidWraith', name: 'Void Wraith', tier: 4, level: 18, elementType: 'psychic',
    shape: 'cone', color: 0x440066, glowColor: 0x220044, scale: 1.1,
    bodyParts: { hasArms: true, armStyle: 'tentacle', hasTail: true },
    stats: { health: 380, attackDamage: 70, attackSpeed: 1.2, attackRange: 4, moveSpeed: 5 },
    aggroRadius: 16,
    packConfig: { packSize: { min: 3, max: 4 }, spacing: 4, formation: 'tight', isSolitary: false }, // Reduced from 5-6 to 3-4, increased spacing from 2 to 4
    xpReward: 210,
  },
  frostDemon: {
    id: 'frostDemon', name: 'Frost Demon', tier: 4, level: 19, elementType: 'water',
    shape: 'spike', color: 0x4488cc, glowColor: 0x2266aa, scale: 1.3,
    bodyParts: { hasLegs: true, legCount: 2, hasWings: true, hasHorns: true, hasSpikes: true, spikeCount: 4 },
    stats: { health: 500, attackDamage: 75, attackSpeed: 1.0, attackRange: 3, moveSpeed: 4.5 },
    aggroRadius: 16,
    packConfig: { packSize: { min: 3, max: 4 }, spacing: 3, formation: 'tight', isSolitary: false }, // Reduced from 5-6 to 3-4, increased spacing from 1.5 to 3
    xpReward: 240,
  },
  shadowLord: {
    id: 'shadowLord', name: 'Shadow Lord', tier: 4, level: 20, elementType: 'psychic',
    shape: 'spike', color: 0x220033, glowColor: 0x110022, scale: 1.5,
    bodyParts: { hasLegs: true, legCount: 2, hasWings: true, hasHorns: true, hasArms: true, armStyle: 'tentacle', hasTail: true },
    stats: { health: 600, attackDamage: 85, attackSpeed: 1.1, attackRange: 4, moveSpeed: 5 },
    aggroRadius: 18,
    packConfig: { packSize: { min: 3, max: 4 }, spacing: 3, formation: 'tight', isSolitary: false }, // Reduced from 5-6 to 3-4, increased spacing from 1.5 to 3
    xpReward: 280,
  },
  
  // ==================== TIER 5 - World Boss ====================
  abyssalTitan: {
    id: 'abyssalTitan', name: 'Abyssal Titan', tier: 5, level: 25, elementType: 'psychic',
    shape: 'spike', color: 0x110022, glowColor: 0xff0044, scale: 4.0,
    bodyParts: { 
      hasLegs: true, legCount: 4, hasWings: true, hasHorns: true, 
      hasArms: true, armStyle: 'tentacle', hasTail: true, hasSpikes: true, spikeCount: 8,
    },
    stats: { health: 10000, attackDamage: 150, attackSpeed: 0.8, attackRange: 6, moveSpeed: 3 },
    aggroRadius: 25,
    packConfig: { packSize: { min: 1, max: 1 }, spacing: 0, formation: 'tight', isSolitary: true },
    xpReward: 2000,
  },
};

// Spawn zones for wedge-based spawning
// Spawn zones - EASIER monsters on outer edge (where players spawn), HARDER toward center
// Expanded radii for larger map (350 radius)
const SPAWN_ZONES: SpawnZone[] = [
  {
    id: 'boss', name: 'Titan Arena',
    minRadius: 0, maxRadius: MAP_CONFIG.CENTER_RADIUS,
    levelRange: { min: 25, max: 25 },
    monsterTypes: ['abyssalTitan'],
    maxMonsters: 1,
    respawnTime: 300000, // 5 minutes
  },
  {
    id: 'inner', name: 'Demon Realm', // Hardest non-boss zone near center
    minRadius: MAP_CONFIG.CENTER_RADIUS + 15, maxRadius: 100, // Expanded from 60 to 100
    levelRange: { min: 16, max: 20 },
    monsterTypes: ['demonImp', 'hellhound', 'voidWraith', 'frostDemon', 'shadowLord'],
    maxMonsters: 6, // Increased for larger map
    respawnTime: 15000,
  },
  {
    id: 'mid-inner', name: 'Elite Grounds', // Elites 
    minRadius: 100, maxRadius: 170, // Expanded from 60-100 to 100-170
    levelRange: { min: 11, max: 15 },
    monsterTypes: ['goblinArcher', 'orcArcher', 'skeletonArcher', 'darkElf', 'deathRanger'],
    maxMonsters: 10, // Increased for larger map
    respawnTime: 12000,
  },
  {
    id: 'mid-outer', name: 'Bear Territory', // Medium difficulty
    minRadius: 170, maxRadius: 240, // Expanded from 100-140 to 170-240
    levelRange: { min: 6, max: 10 },
    monsterTypes: ['brownBear', 'grizzly', 'caveBear', 'direBear', 'ancientBear'],
    maxMonsters: 8, // Increased for larger map
    respawnTime: 8000,
  },
  {
    id: 'edge', name: 'Wolf Den', // Easiest zone near player spawns
    minRadius: 240, maxRadius: MAP_CONFIG.RADIUS - MAP_CONFIG.SAFE_ZONE_RADIUS - 15, // Expanded from 140-~190 to 240-~305
    levelRange: { min: 1, max: 5 },
    monsterTypes: ['wolfPup', 'youngWolf', 'wolf', 'alphaWolf', 'shadowWolf'],
    maxMonsters: 12, // Increased for larger map
    respawnTime: 5000,
  },
];

export class MonsterManager {
  private worldState: WorldState;
  private monsters: Map<string, MonsterInstance> = new Map();
  private nextMonsterId = 0;
  private nextPackId = 0;
  
  // Lazy spawning system - only spawn monsters when players approach
  private spawnQueue: Array<{ zone: SpawnZone; wedgeIndex: number; count: number }> = [];
  private spawnedZones: Set<string> = new Set();
  private readonly SPAWN_TRIGGER_DISTANCE = 70; // Spawn when player within this distance
  
  // Callbacks for broadcasting events
  private onMonsterSpawn: ((monster: MonsterSpawnEvent) => void) | null = null;
  private onMonsterDeath: ((data: MonsterDeathEvent) => void) | null = null;
  private onMonsterAttack: ((data: MonsterAttackEvent) => void) | null = null;
  private onPlayerXPGain: ((data: XPGainEvent) => void) | null = null;

  constructor(worldState: WorldState) {
    this.worldState = worldState;
  }

  public setOnMonsterSpawn(callback: (monster: MonsterSpawnEvent) => void): void {
    this.onMonsterSpawn = callback;
  }

  public setOnMonsterDeath(callback: (data: MonsterDeathEvent) => void): void {
    this.onMonsterDeath = callback;
  }

  public setOnMonsterAttack(callback: (data: MonsterAttackEvent) => void): void {
    this.onMonsterAttack = callback;
  }

  public setOnPlayerXPGain(callback: (data: XPGainEvent) => void): void {
    this.onPlayerXPGain = callback;
  }

  /**
   * Initialize lazy spawn system - only spawns boss immediately
   * Other monsters spawn when players get close (performance optimization)
   */
  public initializeSpawns(): void {
    console.log('[MonsterManager] Initializing lazy spawn system for hexagonal map...');
    
    // Only spawn world boss immediately (it's at center, visible from spawn)
    const bossZone = SPAWN_ZONES.find(z => z.id === 'boss');
    if (bossZone) {
      this.spawnMonsterInZone(bossZone, -1); // -1 = center
      this.spawnedZones.add('boss_-1');
    }
    
    // Also spawn inner zone (wolves near player spawns) immediately
    // since players start at radius 35 and wolves are at 40-60
    const innerZone = SPAWN_ZONES.find(z => z.id === 'inner');
    if (innerZone) {
      for (let wedgeIndex = 0; wedgeIndex < 5; wedgeIndex++) {
        const zoneKey = `inner_${wedgeIndex}`;
        this.spawnedZones.add(zoneKey);
        let monstersInZone = 0;
        while (monstersInZone < innerZone.maxMonsters) {
          const spawned = this.spawnPackInZone(innerZone, wedgeIndex);
          if (spawned === 0) break;
          monstersInZone += spawned;
        }
      }
    }
    
    // Queue other zones for lazy spawning (mid, outer, edge)
    for (let wedgeIndex = 0; wedgeIndex < 5; wedgeIndex++) {
      for (const zone of SPAWN_ZONES) {
        if (zone.id === 'boss' || zone.id === 'inner') continue; // Already handled
        this.spawnQueue.push({ zone, wedgeIndex, count: zone.maxMonsters });
      }
    }
    
    console.log(`[MonsterManager] Spawned ${this.monsters.size} monsters initially, ${this.spawnQueue.length} zone-wedges queued for lazy spawn`);
  }

  /**
   * Check if players are near queued zones and spawn monsters accordingly
   * Call this from the game loop
   */
  public checkLazySpawns(playerPositions: Array<{ x: number; z: number }>): void {
    if (this.spawnQueue.length === 0) return;
    
    const toSpawn: Array<{ zone: SpawnZone; wedgeIndex: number; count: number }> = [];
    const remaining: typeof this.spawnQueue = [];
    
    for (const queued of this.spawnQueue) {
      const zoneKey = `${queued.zone.id}_${queued.wedgeIndex}`;
      if (this.spawnedZones.has(zoneKey)) continue;
      
      // Check if any player is near this zone
      const zoneCenter = this.getZoneCenter(queued.zone, queued.wedgeIndex);
      let shouldSpawn = false;
      
      for (const player of playerPositions) {
        const dx = player.x - zoneCenter.x;
        const dz = player.z - zoneCenter.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        
        if (dist < this.SPAWN_TRIGGER_DISTANCE) {
          shouldSpawn = true;
          break;
        }
      }
      
      if (shouldSpawn) {
        toSpawn.push(queued);
        this.spawnedZones.add(zoneKey);
      } else {
        remaining.push(queued);
      }
    }
    
    this.spawnQueue = remaining;
    
    // Spawn monsters for triggered zones
    for (const { zone, wedgeIndex, count } of toSpawn) {
      let spawned = 0;
      while (spawned < count) {
        const added = this.spawnPackInZone(zone, wedgeIndex);
        if (added === 0) break;
        spawned += added;
      }
      console.log(`[MonsterManager] Lazy spawned ${spawned} monsters in ${zone.name} wedge ${wedgeIndex}`);
    }
  }

  /**
   * Get center position of a zone in a specific wedge
   */
  private getZoneCenter(zone: SpawnZone, wedgeIndex: number): { x: number; z: number } {
    if (zone.id === 'boss') return { x: 0, z: 0 };
    
    const avgRadius = (zone.minRadius + zone.maxRadius) / 2;
    const angle = MAP_CONFIG.WEDGE_ANGLE * wedgeIndex;
    
    return {
      x: Math.cos(angle) * avgRadius,
      z: Math.sin(angle) * avgRadius,
    };
  }

  /**
   * Spawn a pack of monsters in a zone/wedge
   * Returns number of monsters spawned
   */
  private spawnPackInZone(zone: SpawnZone, wedgeIndex: number): number {
    if (zone.monsterTypes.length === 0) return 0;
    
    // Pick random monster type for this zone
    const typeId = zone.monsterTypes[Math.floor(Math.random() * zone.monsterTypes.length)]!;
    const monsterType = MONSTER_TYPES[typeId];
    if (!monsterType) return 0;
    
    // Get pack center position
    const packCenter = this.getRandomPositionInZone(zone, wedgeIndex);
    
    // Get pack positions based on pack config
    const positions = this.getPackPositions(packCenter.x, packCenter.z, monsterType.packConfig);
    const packId = `pack_${this.nextPackId++}`;
    
    let spawnedCount = 0;
    for (const pos of positions) {
      // Verify position is valid (inside hexagon and in correct wedge)
      if (!this.isValidSpawnPosition(pos.x, pos.z, wedgeIndex)) continue;
      
      const monsterId = `monster_${this.nextMonsterId++}`;
      
      const instance: MonsterInstance = {
        id: monsterId,
        typeId,
        zoneId: zone.id,
        wedgeIndex,
        packId: monsterType.packConfig.isSolitary ? null : packId,
        spawnX: pos.x,
        spawnZ: pos.z,
        currentX: pos.x,
        currentZ: pos.z,
        health: monsterType.stats.health,
        maxHealth: monsterType.stats.health,
        isAlive: true,
        respawnAt: null,
        aggroTarget: null,
        lastAttackTime: 0,
        isReturning: false,
        homeX: pos.x,
        homeZ: pos.z,
      };
      
      this.monsters.set(monsterId, instance);
      this.worldState.spawnMonster(monsterId, pos.x, pos.z, typeId, monsterType.stats);
      
      // Broadcast spawn event
      if (this.onMonsterSpawn) {
        this.onMonsterSpawn({
          id: monsterId,
          typeId,
          name: monsterType.name,
          x: pos.x,
          z: pos.z,
          health: monsterType.stats.health,
          maxHealth: monsterType.stats.health,
          level: monsterType.level,
          elementType: monsterType.elementType,
          shape: monsterType.shape,
          color: monsterType.color,
          glowColor: monsterType.glowColor,
          scale: monsterType.scale,
          bodyParts: monsterType.bodyParts,
        });
      }
      
      spawnedCount++;
    }
    
    return spawnedCount;
  }

  /**
   * Spawn a single monster in a zone (for boss or respawn)
   */
  private spawnMonsterInZone(zone: SpawnZone, wedgeIndex: number): MonsterInstance | null {
    if (zone.monsterTypes.length === 0) return null;
    
    const typeId = zone.monsterTypes[Math.floor(Math.random() * zone.monsterTypes.length)]!;
    const monsterType = MONSTER_TYPES[typeId];
    if (!monsterType) return null;
    
    let x: number, z: number;
    if (zone.id === 'boss') {
      x = 0;
      z = 0;
    } else {
      const pos = this.getRandomPositionInZone(zone, wedgeIndex);
      x = pos.x;
      z = pos.z;
    }
    
    const monsterId = `monster_${this.nextMonsterId++}`;
    
    const instance: MonsterInstance = {
      id: monsterId,
      typeId,
      zoneId: zone.id,
      wedgeIndex,
      packId: null,
      spawnX: x,
      spawnZ: z,
      currentX: x,
      currentZ: z,
      health: monsterType.stats.health,
      maxHealth: monsterType.stats.health,
      isAlive: true,
      respawnAt: null,
      aggroTarget: null,
      lastAttackTime: 0,
      isReturning: false,
      homeX: x,
      homeZ: z,
    };
    
    this.monsters.set(monsterId, instance);
    this.worldState.spawnMonster(monsterId, x, z, typeId, monsterType.stats);
    
    if (this.onMonsterSpawn) {
      this.onMonsterSpawn({
        id: monsterId,
        typeId,
        name: monsterType.name,
        x,
        z,
        health: monsterType.stats.health,
        maxHealth: monsterType.stats.health,
        level: monsterType.level,
        elementType: monsterType.elementType,
        shape: monsterType.shape,
        color: monsterType.color,
        glowColor: monsterType.glowColor,
        scale: monsterType.scale,
        bodyParts: monsterType.bodyParts,
      });
    }
    
    return instance;
  }

  /**
   * Get random position within a zone and wedge, avoiding safe zones
   */
  private getRandomPositionInZone(zone: SpawnZone, wedgeIndex: number): { x: number; z: number } {
    if (zone.id === 'boss') {
      return { x: 0, z: 0 };
    }
    
    // Calculate wedge angle bounds (avoid corridors)
    const wedgeAngle = MAP_CONFIG.WEDGE_ANGLE;
    const avgRadius = (zone.minRadius + zone.maxRadius) / 2;
    const corridorAngleOffset = (MAP_CONFIG.CORRIDOR_WIDTH / avgRadius) / 2;
    
    const wedgeCenter = wedgeAngle * wedgeIndex;
    const wedgeStart = wedgeCenter - wedgeAngle / 2 + corridorAngleOffset;
    const wedgeEnd = wedgeCenter + wedgeAngle / 2 - corridorAngleOffset;
    
    // Try to find a valid position (not in safe zone)
    for (let attempt = 0; attempt < 10; attempt++) {
      // Random angle within wedge
      const angle = wedgeStart + Math.random() * (wedgeEnd - wedgeStart);
      const radius = zone.minRadius + Math.random() * (zone.maxRadius - zone.minRadius);
      
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      
      // Check if position is in a safe zone
      if (!isInSafeZone(x, z)) {
        return { x, z };
      }
    }
    
    // Fallback: just return a position (shouldn't happen often)
    const angle = wedgeStart + Math.random() * (wedgeEnd - wedgeStart);
    const radius = zone.minRadius + Math.random() * (zone.maxRadius - zone.minRadius);
    return {
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
    };
  }

  /**
   * Get pack positions based on formation
   */
  private getPackPositions(centerX: number, centerZ: number, config: PackConfig): { x: number; z: number }[] {
    if (config.isSolitary) {
      return [{ x: centerX, z: centerZ }];
    }
    
    const packSize = config.packSize.min + 
      Math.floor(Math.random() * (config.packSize.max - config.packSize.min + 1));
    
    const positions: { x: number; z: number }[] = [];
    
    switch (config.formation) {
      case 'tight':
        for (let i = 0; i < packSize; i++) {
          const angle = (Math.PI * 2 / packSize) * i + Math.random() * 0.3;
          const dist = config.spacing * (0.5 + Math.random() * 0.5);
          positions.push({
            x: centerX + Math.cos(angle) * dist,
            z: centerZ + Math.sin(angle) * dist,
          });
        }
        break;
        
      case 'loose':
        for (let i = 0; i < packSize; i++) {
          const angle = (Math.PI * 2 / packSize) * i + Math.random() * 0.5;
          const dist = config.spacing * (0.8 + Math.random() * 0.4);
          positions.push({
            x: centerX + Math.cos(angle) * dist,
            z: centerZ + Math.sin(angle) * dist,
          });
        }
        break;
        
      case 'circle':
        for (let i = 0; i < packSize; i++) {
          const angle = (Math.PI * 2 / packSize) * i;
          positions.push({
            x: centerX + Math.cos(angle) * config.spacing,
            z: centerZ + Math.sin(angle) * config.spacing,
          });
        }
        break;
        
      case 'line':
        for (let i = 0; i < packSize; i++) {
          positions.push({
            x: centerX + (i - packSize / 2) * config.spacing,
            z: centerZ,
          });
        }
        break;
    }
    
    return positions;
  }

  /**
   * Check if position is valid for spawning
   */
  private isValidSpawnPosition(x: number, z: number, _wedgeIndex: number): boolean {
    const distance = Math.sqrt(x * x + z * z);
    return distance < MAP_CONFIG.RADIUS && this.isInsideHexagon(x, z);
  }

  /**
   * Check if point is inside hexagon
   */
  private isInsideHexagon(x: number, z: number): boolean {
    const vertices: { x: number; z: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6;
      vertices.push({
        x: Math.cos(angle) * MAP_CONFIG.RADIUS,
        z: Math.sin(angle) * MAP_CONFIG.RADIUS,
      });
    }
    
    let inside = false;
    for (let i = 0, j = 5; i < 6; j = i++) {
      const vi = vertices[i]!;
      const vj = vertices[j]!;
      
      if (((vi.z > z) !== (vj.z > z)) &&
          (x < (vj.x - vi.x) * (z - vi.z) / (vj.z - vi.z) + vi.x)) {
        inside = !inside;
      }
    }
    return inside;
  }

  /**
   * Update monster AI and respawns
   */
  public update(dt: number): void {
    const now = Date.now();
    const players = this.worldState.getEntities().filter(e => e.type === 'champion' && e.health > 0);
    
    for (const [monsterId, monster] of this.monsters) {
      // Handle respawn timer
      if (!monster.isAlive) {
        if (monster.respawnAt && now >= monster.respawnAt) {
          this.respawnMonster(monster);
        }
        continue;
      }
      
      const monsterType = MONSTER_TYPES[monster.typeId];
      if (!monsterType) continue;
      
      // Calculate distance from home
      const distFromHome = Math.sqrt(
        Math.pow(monster.currentX - monster.homeX, 2) +
        Math.pow(monster.currentZ - monster.homeZ, 2)
      );
      
      // Leash check - 1.5x aggro range
      const leashDistance = monsterType.aggroRadius * 1.5;
      if (distFromHome > leashDistance) {
        monster.aggroTarget = null;
        monster.isReturning = true;
      }
      
      // If returning to home position
      if (monster.isReturning) {
        const reachedHome = this.moveTowards(
          monster,
          monster.homeX,
          monster.homeZ,
          monsterType.stats.moveSpeed * 1.5, // Move faster when returning
          dt
        );
        
        if (reachedHome) {
          monster.isReturning = false;
          // Regenerate health when reaching home
          monster.health = monster.maxHealth;
          this.worldState.setMonsterHealth(monsterId, monster.health);
        }
        continue;
      }
      
      // Find closest player in aggro range
      let nearestPlayer: { id: string; distance: number } | null = null;
      
      for (const player of players) {
        const dx = player.x - monster.currentX;
        const dz = player.z - monster.currentZ;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        if (distance <= monsterType.aggroRadius) {
          if (!nearestPlayer || distance < nearestPlayer.distance) {
            nearestPlayer = { id: player.id, distance };
          }
        }
      }
      
      // Update aggro target
      if (nearestPlayer) {
        monster.aggroTarget = nearestPlayer.id;
      } else {
        monster.aggroTarget = null;
      }
      
      // If has aggro target, chase and attack
      if (monster.aggroTarget) {
        const target = players.find(p => p.id === monster.aggroTarget);
        
        if (!target || target.health <= 0) {
          monster.aggroTarget = null;
          continue;
        }
        
        const dx = target.x - monster.currentX;
        const dz = target.z - monster.currentZ;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        // If in attack range, attack
        if (distance <= monsterType.stats.attackRange) {
          this.tryAttack(monster, monsterType, target.id, now);
          
          // Small movement adjustment while attacking
          if (distance > monsterType.stats.attackRange * 0.5) {
            this.moveTowards(monster, target.x, target.z, monsterType.stats.moveSpeed * 0.3, dt);
          }
        } else {
          // Chase target
          this.moveTowards(monster, target.x, target.z, monsterType.stats.moveSpeed, dt);
        }
      }
      
      // Update world state position
      this.worldState.setMonsterPosition(monsterId, monster.currentX, monster.currentZ);
    }
  }

  private moveTowards(monster: MonsterInstance, targetX: number, targetZ: number, speed: number, dt: number): boolean {
    const dx = targetX - monster.currentX;
    const dz = targetZ - monster.currentZ;
    const distance = Math.sqrt(dx * dx + dz * dz);
    
    if (distance < 0.5) return true;
    
    const moveAmount = speed * dt;
    
    if (moveAmount >= distance) {
      monster.currentX = targetX;
      monster.currentZ = targetZ;
      return true;
    }
    
    monster.currentX += (dx / distance) * moveAmount;
    monster.currentZ += (dz / distance) * moveAmount;
    return false;
  }

  private tryAttack(monster: MonsterInstance, monsterType: MonsterType, targetId: string, now: number): void {
    const attackInterval = 1000 / monsterType.stats.attackSpeed;
    
    if (now - monster.lastAttackTime < attackInterval) return;
    
    monster.lastAttackTime = now;
    
    const result = this.worldState.monsterAttack(monster.id, targetId, monsterType.stats.attackDamage);
    
    if (result && this.onMonsterAttack) {
      this.onMonsterAttack({
        monsterId: monster.id,
        targetId,
        damage: result.damage,
        targetHealth: result.targetHealth,
      });
    }
  }

  public damageMonster(monsterId: string, damage: number, attackerId: string): { killed: boolean; xpReward: number } | null {
    const monster = this.monsters.get(monsterId);
    if (!monster || !monster.isAlive) return null;
    
    const monsterType = MONSTER_TYPES[monster.typeId];
    if (!monsterType) return null;
    
    monster.health = Math.max(0, monster.health - damage);
    
    if (!monster.aggroTarget) {
      monster.aggroTarget = attackerId;
    }
    
    this.worldState.setMonsterHealth(monsterId, monster.health);
    
    if (monster.health <= 0) {
      return this.killMonster(monster, monsterType, attackerId);
    }
    
    return { killed: false, xpReward: 0 };
  }

  /**
   * Sync monster health from WorldState (called after ability damage)
   * This keeps MonsterManager's internal state in sync with WorldState
   */
  public syncMonsterHealthFromWorldState(monsterId: string): void {
    const monster = this.monsters.get(monsterId);
    if (!monster || !monster.isAlive) return;
    
    const entity = this.worldState.getEntity(monsterId);
    if (entity) {
      monster.health = entity.health;
    }
  }

  public handleAbilityKill(monsterId: string, killerId: string): boolean {
    const monster = this.monsters.get(monsterId);
    if (!monster || !monster.isAlive) return false;
    
    const monsterType = MONSTER_TYPES[monster.typeId];
    if (!monsterType) return false;
    
    monster.health = 0;
    this.killMonster(monster, monsterType, killerId);
    return true;
  }

  private killMonster(monster: MonsterInstance, monsterType: MonsterType, killerId: string): { killed: boolean; xpReward: number } {
    monster.isAlive = false;
    monster.aggroTarget = null;
    
    const zone = SPAWN_ZONES.find(z => z.id === monster.zoneId);
    const respawnTime = zone?.respawnTime || 10000;
    monster.respawnAt = Date.now() + respawnTime;
    
    this.worldState.removeEntity(monster.id);
    
    if (this.onMonsterDeath) {
      this.onMonsterDeath({
        monsterId: monster.id,
        killerId,
        xpReward: monsterType.xpReward,
        respawnTime,
        x: monster.currentX,
        z: monster.currentZ,
        monsterTier: monsterType.tier,
        elementType: monsterType.elementType,
      });
    }
    
    if (this.onPlayerXPGain) {
      this.onPlayerXPGain({
        playerId: killerId,
        xp: monsterType.xpReward,
        source: 'monster_kill',
        monsterId: monster.id,
        monsterName: monsterType.name,
      });
    }
    
    console.log(`[MonsterManager] ${monsterType.name} killed by ${killerId}, XP: ${monsterType.xpReward}`);
    
    return { killed: true, xpReward: monsterType.xpReward };
  }

  private respawnMonster(monster: MonsterInstance): void {
    const monsterType = MONSTER_TYPES[monster.typeId];
    if (!monsterType) return;
    
    monster.isAlive = true;
    monster.health = monster.maxHealth;
    monster.currentX = monster.spawnX;
    monster.currentZ = monster.spawnZ;
    monster.homeX = monster.spawnX;
    monster.homeZ = monster.spawnZ;
    monster.aggroTarget = null;
    monster.isReturning = false;
    monster.respawnAt = null;
    
    this.worldState.spawnMonster(monster.id, monster.spawnX, monster.spawnZ, monster.typeId, monsterType.stats);
    
    if (this.onMonsterSpawn) {
      this.onMonsterSpawn({
        id: monster.id,
        typeId: monster.typeId,
        name: monsterType.name,
        x: monster.spawnX,
        z: monster.spawnZ,
        health: monster.maxHealth,
        maxHealth: monster.maxHealth,
        level: monsterType.level,
        elementType: monsterType.elementType,
        shape: monsterType.shape,
        color: monsterType.color,
        glowColor: monsterType.glowColor,
        scale: monsterType.scale,
        bodyParts: monsterType.bodyParts,
      });
    }
  }

  public getAllMonsterStates(): MonsterSpawnEvent[] {
    const states: MonsterSpawnEvent[] = [];
    
    for (const monster of this.monsters.values()) {
      if (!monster.isAlive) continue;
      
      const monsterType = MONSTER_TYPES[monster.typeId];
      if (!monsterType) continue;
      
      states.push({
        id: monster.id,
        typeId: monster.typeId,
        name: monsterType.name,
        x: monster.currentX,
        z: monster.currentZ,
        health: monster.health,
        maxHealth: monster.maxHealth,
        level: monsterType.level,
        elementType: monsterType.elementType,
        shape: monsterType.shape,
        color: monsterType.color,
        glowColor: monsterType.glowColor,
        scale: monsterType.scale,
        bodyParts: monsterType.bodyParts,
      });
    }
    
    return states;
  }

  public getMonster(monsterId: string): MonsterInstance | undefined {
    return this.monsters.get(monsterId);
  }

  public getMonsterType(typeId: string): MonsterType | undefined {
    return MONSTER_TYPES[typeId];
  }
}

// Event types for broadcasting
export interface MonsterSpawnEvent {
  id: string;
  typeId: string;
  name: string;
  x: number;
  z: number;
  health: number;
  maxHealth: number;
  level: number;
  elementType: ElementType;
  shape: MonsterShape;
  color: number;
  glowColor: number;
  scale: number;
  bodyParts?: MonsterBodyParts;
}

export interface MonsterDeathEvent {
  monsterId: string;
  killerId: string;
  xpReward: number;
  respawnTime: number;
  x: number;
  z: number;
  monsterTier: number;
  elementType: string;
}

export interface MonsterAttackEvent {
  monsterId: string;
  targetId: string;
  damage: number;
  targetHealth: number;
}

export interface XPGainEvent {
  playerId: string;
  xp: number;
  source: 'monster_kill' | 'quest' | 'other';
  monsterId?: string;
  monsterName?: string;
}

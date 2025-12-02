import * as THREE from 'three';

/**
 * Component Types - Pure data containers
 */
export interface TransformComponent {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
  // Previous position for interpolation
  prevPosition: THREE.Vector3;
}

export interface VelocityComponent {
  velocity: THREE.Vector3;
  speed: number;
  maxSpeed: number;
}

export interface HealthComponent {
  current: number;
  max: number;
  isDead: boolean;
}

export interface MovementComponent {
  targetPosition: THREE.Vector3 | null;
  path: THREE.Vector3[];
  pathIndex: number;
  isMoving: boolean;
}

export interface RenderableComponent {
  mesh: THREE.Object3D;
  visible: boolean;
}

export interface NetworkSyncComponent {
  networkId: string;
  isLocal: boolean;
  lastServerPosition: THREE.Vector3;
  lastServerTime: number;
  // For interpolation
  interpolationBuffer: Array<{
    position: THREE.Vector3;
    timestamp: number;
  }>;
}

export interface CombatComponent {
  attackDamage: number;
  attackRange: number;
  attackSpeed: number; // Attacks per second
  lastAttackTime: number;
  targetId: string | null;
  isAttacking: boolean;
}

export interface EntityTypeComponent {
  type: 'champion' | 'monster' | 'projectile' | 'resource_node' | 'ground_item';
  team: number; // 0 = neutral, 1 = team1, 2 = team2
  elementType?: string; // fire, water, grass, etc.
}

/**
 * Animation states for simple transform-based animations
 */
export type AnimationState = 'idle' | 'walking' | 'attacking' | 'hit' | 'death';

export interface AnimationComponent {
  state: AnimationState;
  progress: number; // 0-1 normalized progress
  duration: number; // Duration in seconds
  // Store original transforms for tweening
  baseScale: THREE.Vector3;
  basePosition: THREE.Vector3;
}

/**
 * Projectile component for ranged attacks
 */
export interface ProjectileComponent {
  origin: THREE.Vector3;
  target: THREE.Vector3;
  targetEntityId: string;
  speed: number;
  damage: number;
  attackerId: string;
  progress: number; // 0-1 travel progress
  elementType?: string;
}

/**
 * Mana component for ability resource
 * Characters gain mana on hit, cast ability when full, reset to 0 after cast
 */
export interface ManaComponent {
  current: number;
  max: number;
  gainPerHit: number;
}

/**
 * Ability level tiers (Metin2 inspired)
 * M = Basic, G = Enhanced, P = Perfect/Ultimate
 */
export type AbilityLevel = 'M' | 'G' | 'P';

/**
 * Ability component for special abilities
 */
export interface AbilityComponent {
  abilityId: string;
  level: AbilityLevel;
  elementType: string;
  isReady: boolean; // True when mana is full
  isCasting: boolean;
  castProgress: number; // 0-1 for cast animation
}

/**
 * Talisman inventory for ability upgrades
 * Consume 3 matching-element talismans to upgrade ability level
 */
export interface TalismanInventoryComponent {
  // Count of talismans per element type
  talismans: Record<string, number>;
}

/**
 * Experience/Level component for player progression
 */
export interface ExperienceComponent {
  level: number;
  currentXP: number;
  xpToNextLevel: number;
}

/**
 * Monster-specific data component
 */
export interface MonsterDataComponent {
  typeId: string;
  level: number;
  xpReward: number;
  aggroRadius: number;
  leashDistance: number;
  spawnX: number;
  spawnZ: number;
  isActive: boolean; // For pool reuse - false when dead and waiting respawn
}

/**
 * Component registry type
 */
export interface Components {
  transform: TransformComponent;
  velocity: VelocityComponent;
  health: HealthComponent;
  movement: MovementComponent;
  renderable: RenderableComponent;
  networkSync: NetworkSyncComponent;
  combat: CombatComponent;
  entityType: EntityTypeComponent;
  animation: AnimationComponent;
  projectile: ProjectileComponent;
  mana: ManaComponent;
  ability: AbilityComponent;
  talismanInventory: TalismanInventoryComponent;
  experience: ExperienceComponent;
  monsterData: MonsterDataComponent;
}

export type ComponentType = keyof Components;

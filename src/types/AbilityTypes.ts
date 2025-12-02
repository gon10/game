/**
 * Ability Types - TFT/Metin2 inspired ability system
 * Each element type has a unique ability with 3 upgrade levels (M, G, P)
 */

import { ElementType } from './CharacterTypes';
import { AbilityLevel } from '../ecs/components';

// Re-export ElementType for convenience
export type { ElementType };

/**
 * Combat class determines attack style and base behavior
 */
export type CombatClass = 'mage' | 'healer' | 'druid' | 'assassin' | 'tank' | 'artillery';

/**
 * Combat class configuration
 */
export interface CombatClassInfo {
  id: CombatClass;
  name: string;
  isRanged: boolean;
  attackRange: number;
  description: string;
}

/**
 * Combat classes mapped by element type
 */
export const COMBAT_CLASSES: Record<ElementType, CombatClassInfo> = {
  fire: {
    id: 'mage',
    name: 'Mage',
    isRanged: true,
    attackRange: 6,
    description: 'Ranged fire caster, rains destruction from afar',
  },
  water: {
    id: 'healer',
    name: 'Healer',
    isRanged: true,
    attackRange: 5.5,
    description: 'Support class, heals allies and slows enemies',
  },
  grass: {
    id: 'druid',
    name: 'Druid',
    isRanged: false,
    attackRange: 2,
    description: 'Nature warrior, heals and damages in close range',
  },
  electric: {
    id: 'assassin',
    name: 'Assassin',
    isRanged: false,
    attackRange: 1.8,
    description: 'Fast striker, chains lightning between foes',
  },
  rock: {
    id: 'tank',
    name: 'Tank',
    isRanged: false,
    attackRange: 1.5,
    description: 'Heavy defender, shakes the earth',
  },
  psychic: {
    id: 'artillery',
    name: 'Artillery',
    isRanged: true,
    attackRange: 8,
    description: 'Long-range specialist, devastating single-target',
  },
};

/**
 * Visual effect configuration per ability level
 */
export interface AbilityVisualTier {
  scale: number; // Size multiplier
  particleCount: number;
  hasPurpleParticles: boolean;
  hasOrangeParticles: boolean;
  hasGlow: boolean;
  glowIntensity: number;
  soundId: string;
}

/**
 * Visual tiers for M, G, P levels
 */
export const ABILITY_VISUAL_TIERS: Record<AbilityLevel, AbilityVisualTier> = {
  M: {
    scale: 1.0,
    particleCount: 20,
    hasPurpleParticles: false,
    hasOrangeParticles: false,
    hasGlow: false,
    glowIntensity: 0,
    soundId: 'ability_basic',
  },
  G: {
    scale: 1.3,
    particleCount: 35,
    hasPurpleParticles: true,
    hasOrangeParticles: false,
    hasGlow: false,
    glowIntensity: 0,
    soundId: 'ability_basic',
  },
  P: {
    scale: 1.6,
    particleCount: 50,
    hasPurpleParticles: true,
    hasOrangeParticles: true,
    hasGlow: true,
    glowIntensity: 2.0,
    soundId: 'ability_ultimate',
  },
};

/**
 * Ability targeting type
 */
export type AbilityTargeting = 'target_location' | 'self_centered' | 'single_target' | 'chain';

/**
 * Ability effect type
 */
export type AbilityEffectType = 'damage' | 'heal' | 'slow' | 'stun' | 'confusion' | 'damage_heal';

/**
 * Ability configuration
 */
export interface AbilityInfo {
  id: string;
  name: string;
  elementType: ElementType;
  targeting: AbilityTargeting;
  effects: AbilityEffectType[];
  
  // Base values (scaled by level)
  baseDamage: number;
  baseHeal: number;
  radius: number; // AoE radius (0 for single target)
  duration: number; // Effect duration in seconds (for DoT/slow/stun)
  
  // Scaling per level
  damagePerLevel: number;
  healPerLevel: number;
  radiusPerLevel: number;
  
  // Visual
  castTime: number; // Animation duration
  projectileSpeed: number; // 0 for instant effects
  color: number; // Primary color (Three.js hex)
  
  description: string;
}

/**
 * Mana configuration per element
 */
export interface ManaConfig {
  maxMana: number;
  manaPerHit: number;
}

/**
 * Mana values per element type
 * Balanced based on ability power and attack speed
 */
export const MANA_CONFIG: Record<ElementType, ManaConfig> = {
  fire: { maxMana: 80, manaPerHit: 12 },      // Strong AoE, moderate fill
  water: { maxMana: 70, manaPerHit: 10 },     // Utility heal, faster fill
  grass: { maxMana: 60, manaPerHit: 8 },      // Dual heal/damage, fastest
  electric: { maxMana: 80, manaPerHit: 20 },  // High attack speed compensates
  rock: { maxMana: 100, manaPerHit: 18 },     // Powerful stun, slow fill
  psychic: { maxMana: 90, manaPerHit: 14 },   // High single-target damage
};

/**
 * All ability definitions
 */
export const ABILITIES: Record<ElementType, AbilityInfo> = {
  fire: {
    id: 'fire_meteor',
    name: 'Fire Meteor',
    elementType: 'fire',
    targeting: 'target_location',
    effects: ['damage'],
    baseDamage: 40,
    baseHeal: 0,
    radius: 2.5,
    duration: 0,
    damagePerLevel: 15,
    healPerLevel: 0,
    radiusPerLevel: 0.3,
    castTime: 0.8,
    projectileSpeed: 8,
    color: 0xff4422,
    description: 'Summons a blazing meteor that crashes down on enemies, dealing massive AoE damage',
  },
  water: {
    id: 'tidal_blessing',
    name: 'Tidal Blessing',
    elementType: 'water',
    targeting: 'self_centered',
    effects: ['heal', 'damage'],
    baseDamage: 15,
    baseHeal: 35,
    radius: 4,
    duration: 0,
    damagePerLevel: 8,
    healPerLevel: 12,
    radiusPerLevel: 0.4,
    castTime: 0.6,
    projectileSpeed: 0,
    color: 0x3399ff,
    description: 'Calls upon the tides to heal the lowest HP ally and unleash a wave that damages nearby enemies',
  },
  grass: {
    id: 'leaf_storm',
    name: 'Leaf Storm',
    elementType: 'grass',
    targeting: 'self_centered',
    effects: ['damage_heal'],
    baseDamage: 25,
    baseHeal: 20,
    radius: 2.5,
    duration: 3,
    damagePerLevel: 10,
    healPerLevel: 8,
    radiusPerLevel: 0.3,
    castTime: 0.5,
    projectileSpeed: 0,
    color: 0x44cc44,
    description: 'Conjures a vortex of razor-sharp leaves that damage enemies and heal allies within range',
  },
  electric: {
    id: 'lightning_chain',
    name: 'Lightning Chain',
    elementType: 'electric',
    targeting: 'chain',
    effects: ['damage'],
    baseDamage: 35,
    baseHeal: 0,
    radius: 4, // Chain range
    duration: 0,
    damagePerLevel: 12,
    healPerLevel: 0,
    radiusPerLevel: 0.5,
    castTime: 0.3,
    projectileSpeed: 25,
    color: 0xffdd00,
    description: 'Unleashes lightning that jumps between up to 3 enemies',
  },
  rock: {
    id: 'earthquake',
    name: 'Earthquake',
    elementType: 'rock',
    targeting: 'self_centered',
    effects: ['damage', 'stun'],
    baseDamage: 45,
    baseHeal: 0,
    radius: 3.5,
    duration: 1.5,
    damagePerLevel: 18,
    healPerLevel: 0,
    radiusPerLevel: 0.5,
    castTime: 1.0,
    projectileSpeed: 0,
    color: 0x996633,
    description: 'Slams the ground, creating a shockwave that damages and stuns all nearby enemies',
  },
  psychic: {
    id: 'mind_shatter',
    name: 'Mind Shatter',
    elementType: 'psychic',
    targeting: 'single_target',
    effects: ['damage', 'confusion'],
    baseDamage: 60,
    baseHeal: 0,
    radius: 0,
    duration: 2,
    damagePerLevel: 25,
    healPerLevel: 0,
    radiusPerLevel: 0,
    castTime: 0.7,
    projectileSpeed: 15,
    color: 0xdd66ff,
    description: 'Launches a psychic blast that deals massive damage and confuses the target',
  },
};

/**
 * Get ability scaled values for a given level
 */
export function getAbilityStats(elementType: ElementType, level: AbilityLevel): {
  damage: number;
  heal: number;
  radius: number;
} {
  const ability = ABILITIES[elementType];
  const levelMultiplier = level === 'M' ? 0 : level === 'G' ? 1 : 2;
  
  return {
    damage: ability.baseDamage + (ability.damagePerLevel * levelMultiplier),
    heal: ability.baseHeal + (ability.healPerLevel * levelMultiplier),
    radius: ability.radius + (ability.radiusPerLevel * levelMultiplier),
  };
}

/**
 * Get visual tier configuration for ability level
 */
export function getVisualTier(level: AbilityLevel): AbilityVisualTier {
  return ABILITY_VISUAL_TIERS[level];
}

/**
 * Check if enough talismans to upgrade ability
 */
export function canUpgradeAbility(
  currentLevel: AbilityLevel,
  elementType: string,
  talismans: Record<string, number>
): boolean {
  if (currentLevel === 'P') return false; // Already max level
  const count = talismans[elementType] || 0;
  return count >= 3;
}

/**
 * Get next ability level
 */
export function getNextLevel(currentLevel: AbilityLevel): AbilityLevel | null {
  if (currentLevel === 'M') return 'G';
  if (currentLevel === 'G') return 'P';
  return null; // Already max
}

/**
 * Talisman drop configuration
 */
export const TALISMAN_CONFIG = {
  monsterDropChance: 0.5, // 50% from monsters
  playerDropChance: 1.0,  // 100% from players
  requiredForUpgrade: 3,
};

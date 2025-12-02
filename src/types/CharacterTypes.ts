/**
 * Character Types - Pokemon-inspired elemental types
 * Each type has strengths, weaknesses, and unique stats
 */

export type ElementType = 'fire' | 'water' | 'grass' | 'electric' | 'rock' | 'psychic';

export interface CharacterTypeInfo {
  id: ElementType;
  name: string;
  color: number; // Three.js hex color
  description: string;
  stats: {
    health: number;
    attackDamage: number;
    attackSpeed: number; // attacks per second
    moveSpeed: number;
    attackRange: number;
  };
  // Type effectiveness (multipliers)
  strongAgainst: ElementType[];
  weakAgainst: ElementType[];
}

/**
 * Type effectiveness chart:
 * Fire > Grass, Rock < Water, Rock
 * Water > Fire, Rock < Grass, Electric
 * Grass > Water, Rock < Fire, Psychic
 * Electric > Water < Rock, Grass
 * Rock > Fire, Electric < Water, Grass
 * Psychic > Grass, Electric < Fire, Rock
 */
export const CHARACTER_TYPES: Record<ElementType, CharacterTypeInfo> = {
  fire: {
    id: 'fire',
    name: 'Fire',
    color: 0xff4422,
    description: 'Mage - Ranged fire caster. Strong vs Grass, weak vs Water & Rock.',
    stats: {
      health: 80,
      attackDamage: 15,
      attackSpeed: 1.8,
      moveSpeed: 11,
      attackRange: 4, // Mage - ranged
    },
    strongAgainst: ['grass', 'psychic'],
    weakAgainst: ['water', 'rock'],
  },
  water: {
    id: 'water',
    name: 'Water',
    color: 0x3399ff,
    description: 'Healer - Support class with sustain. Strong vs Fire & Rock, weak vs Grass & Electric.',
    stats: {
      health: 100,
      attackDamage: 10,
      attackSpeed: 1.5,
      moveSpeed: 10,
      attackRange: 3.5, // Healer - ranged support
    },
    strongAgainst: ['fire', 'rock'],
    weakAgainst: ['grass', 'electric'],
  },
  grass: {
    id: 'grass',
    name: 'Grass',
    color: 0x44cc44,
    description: 'Druid - Nature melee warrior with sustain. Strong vs Water & Rock, weak vs Fire & Psychic.',
    stats: {
      health: 120,
      attackDamage: 8,
      attackSpeed: 1.2,
      moveSpeed: 9,
      attackRange: 2, // Druid - melee
    },
    strongAgainst: ['water', 'rock', 'electric'],
    weakAgainst: ['fire', 'psychic'],
  },
  electric: {
    id: 'electric',
    name: 'Electric',
    color: 0xffdd00,
    description: 'Assassin - Fast melee striker with burst. Strong vs Water, weak vs Rock & Grass.',
    stats: {
      health: 70,
      attackDamage: 12,
      attackSpeed: 2.0,
      moveSpeed: 13,
      attackRange: 1.8, // Assassin - close melee
    },
    strongAgainst: ['water'],
    weakAgainst: ['rock', 'grass'],
  },
  rock: {
    id: 'rock',
    name: 'Rock',
    color: 0x996633,
    description: 'Tank - Heavy defender with CC. Strong vs Fire & Electric, weak vs Water & Grass.',
    stats: {
      health: 150,
      attackDamage: 14,
      attackSpeed: 0.8,
      moveSpeed: 7,
      attackRange: 1.5, // Tank - shortest melee
    },
    strongAgainst: ['fire', 'electric', 'psychic'],
    weakAgainst: ['water', 'grass'],
  },
  psychic: {
    id: 'psychic',
    name: 'Psychic',
    color: 0xdd66ff,
    description: 'Artillery - Longest range specialist. Strong vs Grass & Electric, weak vs Fire & Rock.',
    stats: {
      health: 75,
      attackDamage: 11,
      attackSpeed: 1.4,
      moveSpeed: 10,
      attackRange: 5, // Artillery - longest range
    },
    strongAgainst: ['grass', 'electric'],
    weakAgainst: ['fire', 'rock'],
  },
};

/**
 * Get damage multiplier based on attacker and defender types
 */
export function getDamageMultiplier(attackerType: ElementType, defenderType: ElementType): number {
  const attacker = CHARACTER_TYPES[attackerType];
  
  if (attacker.strongAgainst.includes(defenderType)) {
    return 1.5; // Super effective
  }
  if (attacker.weakAgainst.includes(defenderType)) {
    return 0.75; // Not very effective
  }
  return 1.0; // Normal damage
}

/**
 * Get all available character types
 */
export function getAllTypes(): ElementType[] {
  return ['fire', 'water', 'grass', 'electric', 'rock', 'psychic'];
}

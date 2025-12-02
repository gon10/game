/**
 * Shop Types - Defines consumable recipes and costs
 * 
 * Consumables provide powerful temporary effects but cost resources
 * This creates strategic tension: Farm for consumables vs Hunt for XP/talismans
 */

import { ConsumableType } from './ItemTypes';

/**
 * Resource cost for purchasing an item
 */
export interface ResourceCost {
  wood: number;
  gold: number;
  stone: number;
}

/**
 * Consumable effect types
 */
export type EffectType = 
  | 'heal_single'      // Heal one character
  | 'heal_team'        // Heal all characters
  | 'damage_boost'     // Increase damage
  | 'speed_boost'      // Increase movement speed
  | 'revive'           // Revive dead character
  | 'shield';          // Absorb damage

/**
 * Consumable definition
 */
export interface ConsumableDefinition {
  id: ConsumableType;
  name: string;
  description: string;
  icon: string;
  cost: ResourceCost;
  
  // Effect properties
  effectType: EffectType;
  effectValue: number; // % heal, % boost, or flat damage absorb
  effectDuration: number; // In milliseconds (0 for instant effects)
  
  // Targeting
  targetType: 'single' | 'team' | 'dead'; // Who can be targeted
  requiresSelection: boolean; // Does player need to select a character first?
  
  // Cooldown between uses (global for this consumable type)
  cooldown: number;
}

/**
 * All consumable definitions
 */
export const CONSUMABLES: Record<ConsumableType, ConsumableDefinition> = {
  health_potion: {
    id: 'health_potion',
    name: 'Health Potion',
    description: 'Instantly restores 50% HP to one character',
    icon: '🧪',
    cost: { wood: 0, gold: 20, stone: 0 },
    effectType: 'heal_single',
    effectValue: 50, // 50% of max HP
    effectDuration: 0, // Instant
    targetType: 'single',
    requiresSelection: true, // Must select which character
    cooldown: 5000, // 5 second cooldown
  },
  
  team_heal_scroll: {
    id: 'team_heal_scroll',
    name: 'Team Heal Scroll',
    description: 'Heals all 3 characters for 30% HP',
    icon: '📜',
    cost: { wood: 10, gold: 50, stone: 0 },
    effectType: 'heal_team',
    effectValue: 30, // 30% of max HP each
    effectDuration: 0, // Instant
    targetType: 'team',
    requiresSelection: false, // Affects all
    cooldown: 15000, // 15 second cooldown
  },
  
  damage_elixir: {
    id: 'damage_elixir',
    name: 'Damage Elixir',
    description: 'Increases damage by 50% for 30 seconds',
    icon: '⚗️',
    cost: { wood: 0, gold: 30, stone: 20 },
    effectType: 'damage_boost',
    effectValue: 50, // +50% damage
    effectDuration: 30000, // 30 seconds
    targetType: 'single',
    requiresSelection: true,
    cooldown: 60000, // 60 second cooldown
  },
  
  speed_tonic: {
    id: 'speed_tonic',
    name: 'Speed Tonic',
    description: 'Increases movement speed by 30% for 20 seconds',
    icon: '💨',
    cost: { wood: 15, gold: 15, stone: 0 },
    effectType: 'speed_boost',
    effectValue: 30, // +30% speed
    effectDuration: 20000, // 20 seconds
    targetType: 'single',
    requiresSelection: true,
    cooldown: 45000, // 45 second cooldown
  },
  
  revival_scroll: {
    id: 'revival_scroll',
    name: 'Revival Scroll',
    description: 'Revives a dead character at 50% HP',
    icon: '✨',
    cost: { wood: 20, gold: 100, stone: 30 },
    effectType: 'revive',
    effectValue: 50, // Revive at 50% HP
    effectDuration: 0, // Instant
    targetType: 'dead',
    requiresSelection: true, // Must select dead character
    cooldown: 120000, // 2 minute cooldown
  },
  
  shield_crystal: {
    id: 'shield_crystal',
    name: 'Shield Crystal',
    description: 'Absorbs the next 100 damage taken',
    icon: '🛡️',
    cost: { wood: 0, gold: 0, stone: 40 },
    effectType: 'shield',
    effectValue: 100, // Absorbs 100 damage
    effectDuration: 60000, // Lasts 60 seconds or until depleted
    targetType: 'single',
    requiresSelection: true,
    cooldown: 30000, // 30 second cooldown
  },
};

/**
 * Check if player can afford a consumable
 */
export function canAfford(
  playerResources: { wood: number; gold: number; stone: number },
  consumableId: ConsumableType
): boolean {
  const consumable = CONSUMABLES[consumableId];
  return (
    playerResources.wood >= consumable.cost.wood &&
    playerResources.gold >= consumable.cost.gold &&
    playerResources.stone >= consumable.cost.stone
  );
}

/**
 * Calculate total cost of multiple consumables
 */
export function calculateTotalCost(items: { id: ConsumableType; quantity: number }[]): ResourceCost {
  const total: ResourceCost = { wood: 0, gold: 0, stone: 0 };
  
  for (const item of items) {
    const consumable = CONSUMABLES[item.id];
    total.wood += consumable.cost.wood * item.quantity;
    total.gold += consumable.cost.gold * item.quantity;
    total.stone += consumable.cost.stone * item.quantity;
  }
  
  return total;
}

/**
 * Shop categories for UI organization
 */
export const SHOP_CATEGORIES = {
  healing: {
    name: 'Healing',
    items: ['health_potion', 'team_heal_scroll', 'revival_scroll'] as ConsumableType[],
  },
  buffs: {
    name: 'Buffs',
    items: ['damage_elixir', 'speed_tonic', 'shield_crystal'] as ConsumableType[],
  },
};

/**
 * Network event for purchase request
 */
export interface PurchaseRequest {
  playerId: string;
  consumableId: ConsumableType;
  quantity: number;
}

/**
 * Network event for purchase result
 */
export interface PurchaseResult {
  success: boolean;
  consumableId: ConsumableType;
  quantity: number;
  error?: string; // 'insufficient_funds' | 'invalid_item'
  newResources?: { wood: number; gold: number; stone: number };
}

/**
 * Network event for consumable use request
 */
export interface UseConsumableRequest {
  playerId: string;
  consumableId: ConsumableType;
  targetCharId?: string; // For single-target consumables
}

/**
 * Network event for consumable use result
 */
export interface UseConsumableResult {
  success: boolean;
  consumableId: ConsumableType;
  targetCharId?: string;
  effectType: EffectType;
  effectValue: number;
  effectDuration: number;
  error?: string; // 'no_item' | 'on_cooldown' | 'invalid_target' | 'target_not_dead'
}

/**
 * Network event for talisman use request (upgrade ability)
 */
export interface UseTalismanRequest {
  playerId: string;
  targetCharId: string;
  elementType: string;
}

/**
 * Network event for talisman use result
 */
export interface UseTalismanResult {
  success: boolean;
  targetCharId: string;
  elementType: string;
  newAbilityLevel?: string; // 'M' | 'G' | 'P'
  error?: string; // 'no_talisman' | 'wrong_element' | 'max_level'
}

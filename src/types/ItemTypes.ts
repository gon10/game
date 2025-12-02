/**
 * Item Types - Defines all items, resources, and inventory system
 * 
 * Resource Types:
 * - Wood: From Wood Crystals (green glow)
 * - Gold: From Gold Ore Crystals (golden glow)
 * - Stone: From Stone Crystals (blue glow)
 * 
 * Talisman Types:
 * - Element-specific talismans dropped by monsters/Metin Stones
 * - Consumable: Select character, click talisman to upgrade ability
 * 
 * Consumables:
 * - Health Potion, Team Heal, Damage Elixir, Speed Tonic, Revival Scroll, Shield Crystal
 */

// Element types matching the game's existing system
export type ElementType = 'fire' | 'water' | 'grass' | 'electric' | 'rock' | 'psychic';

// Resource types from farming nodes
export type ResourceType = 'wood' | 'gold' | 'stone';

// All item types that can exist in the game
export type ItemType = ResourceType | 'talisman' | ConsumableType;

// Consumable item types purchasable from shop
export type ConsumableType = 
  | 'health_potion'
  | 'team_heal_scroll'
  | 'damage_elixir'
  | 'speed_tonic'
  | 'revival_scroll'
  | 'shield_crystal';

/**
 * Ground item dropped in the world
 * Can be picked up by players (click or auto-collect)
 */
export interface GroundItem {
  id: string;
  itemType: ItemType;
  quantity: number;
  x: number;
  z: number;
  spawnTime: number;
  despawnTime: number; // When this item will disappear
  // For talismans, which element
  elementType?: ElementType;
}

/**
 * Network event for ground item spawn
 */
export interface GroundItemSpawnEvent {
  id: string;
  itemType: ItemType;
  quantity: number;
  x: number;
  z: number;
  elementType?: ElementType;
  despawnIn: number; // Milliseconds until despawn
}

/**
 * Network event for ground item pickup
 */
export interface GroundItemPickupEvent {
  itemId: string;
  playerId: string;
  charId?: string; // Which character picked it up (for proximity check)
}

/**
 * Network event for ground item despawn (timeout)
 */
export interface GroundItemDespawnEvent {
  itemId: string;
}

/**
 * Talisman in player's inventory
 * Consumable: select character + click to upgrade ability
 */
export interface TalismanItem {
  elementType: ElementType;
  count: number;
}

/**
 * Consumable item in player's inventory
 */
export interface ConsumableItem {
  type: ConsumableType;
  count: number;
}

/**
 * Player inventory state
 * Shared between server and client
 */
export interface PlayerInventory {
  // Resources (stackable, no limit)
  resources: {
    wood: number;
    gold: number;
    stone: number;
  };
  
  // Talismans per element (consumable for ability upgrades)
  talismans: Record<ElementType, number>;
  
  // Consumable items
  consumables: Record<ConsumableType, number>;
}

/**
 * Create empty inventory
 */
export function createEmptyInventory(): PlayerInventory {
  return {
    resources: {
      wood: 0,
      gold: 0,
      stone: 0,
    },
    talismans: {
      fire: 0,
      water: 0,
      grass: 0,
      electric: 0,
      rock: 0,
      psychic: 0,
    },
    consumables: {
      health_potion: 0,
      team_heal_scroll: 0,
      damage_elixir: 0,
      speed_tonic: 0,
      revival_scroll: 0,
      shield_crystal: 0,
    },
  };
}

/**
 * Item display information for UI
 */
export const ITEM_DISPLAY: Record<ItemType, { name: string; icon: string; color: number; description: string }> = {
  wood: {
    name: 'Wood',
    icon: '🪵',
    color: 0x8b4513,
    description: 'Building material harvested from Wood Crystals',
  },
  gold: {
    name: 'Gold',
    icon: '🪙',
    color: 0xffd700,
    description: 'Precious currency mined from Gold Ore Crystals',
  },
  stone: {
    name: 'Stone',
    icon: '🪨',
    color: 0x708090,
    description: 'Sturdy material from Stone Crystals',
  },
  talisman: {
    name: 'Talisman',
    icon: '🔮',
    color: 0x9932cc,
    description: 'Magical essence to upgrade abilities',
  },
  health_potion: {
    name: 'Health Potion',
    icon: '🧪',
    color: 0xff4444,
    description: 'Restores 50% HP to one character',
  },
  team_heal_scroll: {
    name: 'Team Heal Scroll',
    icon: '📜',
    color: 0x44ff44,
    description: 'Heals all 3 characters for 30% HP',
  },
  damage_elixir: {
    name: 'Damage Elixir',
    icon: '⚗️',
    color: 0xff8800,
    description: '+50% damage for 30 seconds',
  },
  speed_tonic: {
    name: 'Speed Tonic',
    icon: '💨',
    color: 0x00ffff,
    description: '+30% movement speed for 20 seconds',
  },
  revival_scroll: {
    name: 'Revival Scroll',
    icon: '✨',
    color: 0xffff00,
    description: 'Revive a dead character at 50% HP',
  },
  shield_crystal: {
    name: 'Shield Crystal',
    icon: '🛡️',
    color: 0x4444ff,
    description: 'Absorbs next 100 damage taken',
  },
};

/**
 * Talisman display info per element
 */
export const TALISMAN_DISPLAY: Record<ElementType, { name: string; color: number; glowColor: number }> = {
  fire: { name: 'Fire Talisman', color: 0xff4400, glowColor: 0xff8844 },
  water: { name: 'Water Talisman', color: 0x0088ff, glowColor: 0x44aaff },
  grass: { name: 'Grass Talisman', color: 0x44cc44, glowColor: 0x88ff88 },
  electric: { name: 'Electric Talisman', color: 0xffee00, glowColor: 0xffff88 },
  rock: { name: 'Rock Talisman', color: 0x886644, glowColor: 0xaa8866 },
  psychic: { name: 'Psychic Talisman', color: 0xaa44ff, glowColor: 0xcc88ff },
};

/**
 * Ground item despawn time (30 seconds)
 */
export const GROUND_ITEM_DESPAWN_TIME = 30000;

/**
 * Pickup radius for auto-collect
 */
export const AUTO_COLLECT_RADIUS = 3;

/**
 * Required talismans to upgrade ability (M -> G -> P)
 */
export const TALISMANS_PER_UPGRADE = 3;

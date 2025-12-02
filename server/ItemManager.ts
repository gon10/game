/**
 * Item Manager - Server-side ground item spawning and pickup management
 * 
 * Handles:
 * - Spawning ground items (resources, talismans)
 * - Despawn timers (30 seconds)
 * - Pickup validation (proximity check)
 * - Player inventory updates
 */

import { WorldState, ElementType } from './WorldState';
import {
  GroundItem,
  GroundItemSpawnEvent,
  GroundItemPickupEvent,
  GroundItemDespawnEvent,
  ItemType,
  GROUND_ITEM_DESPAWN_TIME,
  AUTO_COLLECT_RADIUS,
  PlayerInventory,
  createEmptyInventory,
} from '../src/types/ItemTypes';

/**
 * Item Manager - handles ground items and player inventories
 */
export class ItemManager {
  private worldState: WorldState;
  private groundItems: Map<string, GroundItem> = new Map();
  private playerInventories: Map<string, PlayerInventory> = new Map();
  private nextItemId = 0;

  // Callbacks for broadcasting events
  private onItemSpawn: ((item: GroundItemSpawnEvent) => void) | null = null;
  private onItemPickup: ((data: GroundItemPickupEvent & { itemType: ItemType; quantity: number; elementType?: ElementType }) => void) | null = null;
  private onItemDespawn: ((data: GroundItemDespawnEvent) => void) | null = null;
  private onInventoryUpdate: ((playerId: string, inventory: PlayerInventory) => void) | null = null;

  constructor(worldState: WorldState) {
    this.worldState = worldState;
  }

  public setOnItemSpawn(callback: (item: GroundItemSpawnEvent) => void): void {
    this.onItemSpawn = callback;
  }

  public setOnItemPickup(callback: (data: GroundItemPickupEvent & { itemType: ItemType; quantity: number; elementType?: ElementType }) => void): void {
    this.onItemPickup = callback;
  }

  public setOnItemDespawn(callback: (data: GroundItemDespawnEvent) => void): void {
    this.onItemDespawn = callback;
  }

  public setOnInventoryUpdate(callback: (playerId: string, inventory: PlayerInventory) => void): void {
    this.onInventoryUpdate = callback;
  }

  /**
   * Initialize inventory for a player
   */
  public initializePlayerInventory(playerId: string): PlayerInventory {
    const inventory = createEmptyInventory();
    this.playerInventories.set(playerId, inventory);
    return inventory;
  }

  /**
   * Get player inventory
   */
  public getPlayerInventory(playerId: string): PlayerInventory | undefined {
    return this.playerInventories.get(playerId);
  }

  /**
   * Remove player inventory on disconnect
   */
  public removePlayerInventory(playerId: string): void {
    this.playerInventories.delete(playerId);
  }

  /**
   * Spawn a ground item at a position
   */
  public spawnGroundItem(
    itemType: ItemType,
    quantity: number,
    x: number,
    z: number,
    elementType?: ElementType
  ): GroundItem {
    const itemId = `item_${this.nextItemId++}`;
    const now = Date.now();

    const item: GroundItem = {
      id: itemId,
      itemType,
      quantity,
      x,
      z,
      spawnTime: now,
      despawnTime: now + GROUND_ITEM_DESPAWN_TIME,
      elementType,
    };

    this.groundItems.set(itemId, item);

    // Broadcast spawn event
    if (this.onItemSpawn) {
      this.onItemSpawn({
        id: itemId,
        itemType,
        quantity,
        x,
        z,
        elementType,
        despawnIn: GROUND_ITEM_DESPAWN_TIME,
      });
    }

    console.log(`[ItemManager] Spawned ${quantity}x ${itemType}${elementType ? ` (${elementType})` : ''} at (${x.toFixed(1)}, ${z.toFixed(1)})`);

    return item;
  }

  /**
   * Spawn multiple items scattered around a position
   */
  public spawnScatteredItems(
    itemType: ItemType,
    quantity: number,
    centerX: number,
    centerZ: number,
    scatterRadius: number = 2,
    elementType?: ElementType
  ): GroundItem[] {
    const items: GroundItem[] = [];
    
    // If small quantity, spawn as one item
    if (quantity <= 3) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * scatterRadius;
      items.push(this.spawnGroundItem(
        itemType,
        quantity,
        centerX + Math.cos(angle) * dist,
        centerZ + Math.sin(angle) * dist,
        elementType
      ));
    } else {
      // Split into multiple smaller stacks
      const numStacks = Math.min(3, Math.ceil(quantity / 3));
      const perStack = Math.ceil(quantity / numStacks);
      let remaining = quantity;
      
      for (let i = 0; i < numStacks && remaining > 0; i++) {
        const stackAmount = Math.min(perStack, remaining);
        remaining -= stackAmount;
        
        const angle = (Math.PI * 2 / numStacks) * i + Math.random() * 0.5;
        const dist = scatterRadius * (0.5 + Math.random() * 0.5);
        
        items.push(this.spawnGroundItem(
          itemType,
          stackAmount,
          centerX + Math.cos(angle) * dist,
          centerZ + Math.sin(angle) * dist,
          elementType
        ));
      }
    }
    
    return items;
  }

  /**
   * Attempt to pickup an item
   * Returns true if successful
   */
  public tryPickupItem(
    itemId: string,
    playerId: string,
    charId?: string
  ): boolean {
    const item = this.groundItems.get(itemId);
    if (!item) {
      console.log(`[ItemManager] Pickup failed: item ${itemId} not found`);
      return false;
    }

    // Get player inventory - use base player ID
    const basePlayerId = playerId.includes('_char')
      ? playerId.split('_char')[0]!
      : playerId;
    
    let inventory = this.playerInventories.get(basePlayerId);
    if (!inventory) {
      // Auto-initialize if missing
      inventory = this.initializePlayerInventory(basePlayerId);
    }

    // Check proximity if charId provided
    if (charId) {
      const char = this.worldState.getEntity(charId);
      if (char) {
        const dx = item.x - char.x;
        const dz = item.z - char.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        // Allow pickup if within reasonable range (5 units for manual click)
        if (distance > 5) {
          console.log(`[ItemManager] Pickup failed: too far (${distance.toFixed(1)} > 5)`);
          return false;
        }
      }
    }

    // Add to inventory
    this.addToInventory(inventory, item.itemType, item.quantity, item.elementType);

    // Remove ground item
    this.groundItems.delete(itemId);

    // Broadcast pickup event
    if (this.onItemPickup) {
      this.onItemPickup({
        itemId,
        playerId: basePlayerId,
        charId,
        itemType: item.itemType,
        quantity: item.quantity,
        elementType: item.elementType,
      });
    }

    // Broadcast inventory update
    if (this.onInventoryUpdate) {
      this.onInventoryUpdate(basePlayerId, inventory);
    }

    console.log(`[ItemManager] Player ${basePlayerId} picked up ${item.quantity}x ${item.itemType}`);

    return true;
  }

  /**
   * Add item to player inventory
   */
  private addToInventory(
    inventory: PlayerInventory,
    itemType: ItemType,
    quantity: number,
    elementType?: ElementType
  ): void {
    console.log(`[ItemManager] Adding ${quantity}x ${itemType} to inventory. Before:`, JSON.stringify(inventory.resources));
    
    if (itemType === 'wood' || itemType === 'gold' || itemType === 'stone') {
      inventory.resources[itemType] += quantity;
      console.log(`[ItemManager] After adding ${itemType}: ${inventory.resources[itemType]}`);
    } else if (itemType === 'talisman' && elementType) {
      inventory.talismans[elementType] += quantity;
    } else if (
      itemType === 'health_potion' ||
      itemType === 'team_heal_scroll' ||
      itemType === 'damage_elixir' ||
      itemType === 'speed_tonic' ||
      itemType === 'revival_scroll' ||
      itemType === 'shield_crystal'
    ) {
      inventory.consumables[itemType] += quantity;
    }
    
    console.log(`[ItemManager] Inventory after add:`, JSON.stringify(inventory.resources));
  }

  /**
   * Check for auto-collect pickups for a player's characters
   */
  public checkAutoCollect(playerId: string): void {
    const basePlayerId = playerId.includes('_char')
      ? playerId.split('_char')[0]!
      : playerId;

    // Get all characters belonging to this player
    const playerChars = this.worldState.getEntities().filter(
      e => e.type === 'champion' && e.id.startsWith(basePlayerId + '_char')
    );

    if (playerChars.length === 0) return;

    // Check each ground item
    const itemsToPickup: string[] = [];

    for (const item of this.groundItems.values()) {
      // Check if any character is close enough
      for (const char of playerChars) {
        const dx = item.x - char.x;
        const dz = item.z - char.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        if (distance <= AUTO_COLLECT_RADIUS) {
          itemsToPickup.push(item.id);
          break; // Don't need to check other chars
        }
      }
    }

    // Pickup items
    for (const itemId of itemsToPickup) {
      this.tryPickupItem(itemId, basePlayerId);
    }
  }

  /**
   * Update - check for despawns
   */
  public update(_dt: number): void {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [itemId, item] of this.groundItems) {
      if (now >= item.despawnTime) {
        toRemove.push(itemId);
      }
    }

    // Remove expired items
    for (const itemId of toRemove) {
      this.groundItems.delete(itemId);

      if (this.onItemDespawn) {
        this.onItemDespawn({ itemId });
      }

      console.log(`[ItemManager] Item ${itemId} despawned (timeout)`);
    }
  }

  /**
   * Get all ground items for new players
   */
  public getAllGroundItems(): GroundItemSpawnEvent[] {
    const now = Date.now();
    const items: GroundItemSpawnEvent[] = [];

    for (const item of this.groundItems.values()) {
      items.push({
        id: item.id,
        itemType: item.itemType,
        quantity: item.quantity,
        x: item.x,
        z: item.z,
        elementType: item.elementType,
        despawnIn: Math.max(0, item.despawnTime - now),
      });
    }

    return items;
  }

  /**
   * Deduct resources from player inventory (for shop purchases)
   */
  public deductResources(
    playerId: string,
    wood: number,
    gold: number,
    stone: number
  ): boolean {
    const inventory = this.playerInventories.get(playerId);
    if (!inventory) return false;

    // Check if player has enough
    if (
      inventory.resources.wood < wood ||
      inventory.resources.gold < gold ||
      inventory.resources.stone < stone
    ) {
      return false;
    }

    // Deduct
    inventory.resources.wood -= wood;
    inventory.resources.gold -= gold;
    inventory.resources.stone -= stone;

    // Broadcast update
    if (this.onInventoryUpdate) {
      this.onInventoryUpdate(playerId, inventory);
    }

    return true;
  }

  /**
   * Add consumable to player inventory (from shop purchase)
   */
  public addConsumable(
    playerId: string,
    consumableType: string,
    quantity: number
  ): boolean {
    const inventory = this.playerInventories.get(playerId);
    if (!inventory) return false;

    const validTypes = [
      'health_potion',
      'team_heal_scroll',
      'damage_elixir',
      'speed_tonic',
      'revival_scroll',
      'shield_crystal',
    ];

    if (!validTypes.includes(consumableType)) return false;

    inventory.consumables[consumableType as keyof typeof inventory.consumables] += quantity;

    // Broadcast update
    if (this.onInventoryUpdate) {
      this.onInventoryUpdate(playerId, inventory);
    }

    return true;
  }

  /**
   * Use a consumable from inventory
   */
  public useConsumable(
    playerId: string,
    consumableType: string
  ): boolean {
    const inventory = this.playerInventories.get(playerId);
    if (!inventory) return false;

    const validTypes = [
      'health_potion',
      'team_heal_scroll',
      'damage_elixir',
      'speed_tonic',
      'revival_scroll',
      'shield_crystal',
    ];

    if (!validTypes.includes(consumableType)) return false;

    const key = consumableType as keyof typeof inventory.consumables;
    if (inventory.consumables[key] <= 0) return false;

    inventory.consumables[key]--;

    // Broadcast update
    if (this.onInventoryUpdate) {
      this.onInventoryUpdate(playerId, inventory);
    }

    return true;
  }

  /**
   * Use a talisman from inventory (for ability upgrade)
   */
  public useTalisman(
    playerId: string,
    elementType: ElementType,
    count: number = 1
  ): boolean {
    const inventory = this.playerInventories.get(playerId);
    if (!inventory) return false;

    if (inventory.talismans[elementType] < count) return false;

    inventory.talismans[elementType] -= count;

    // Broadcast update
    if (this.onInventoryUpdate) {
      this.onInventoryUpdate(playerId, inventory);
    }

    return true;
  }
}

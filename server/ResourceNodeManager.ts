/**
 * Resource Node Manager - Server-side resource node spawning and management
 * 
 * Handles:
 * - Spawning resource nodes (Wood/Gold/Stone Crystals, Metin Stones)
 * - Processing attacks on nodes
 * - Drop chance calculations per hit
 * - Death drops (guaranteed resources/talismans)
 * - Respawning depleted nodes
 */

import { WorldState, ElementType } from './WorldState';
import {
  ResourceNodeType,
  ResourceNodeDefinition,
  ResourceNodeInstance,
  ResourceNodeSpawnEvent,
  ResourceNodeDamageEvent,
  ResourceNodeDestroyedEvent,
  RESOURCE_NODE_TYPES,
  NODE_SPAWN_CONFIG,
  getRandomElement,
} from '../src/types/ResourceNodeTypes';
import { ResourceType } from '../src/types/ItemTypes';

// Map config must match MonsterManager
const MAP_CONFIG = {
  RADIUS: 350,
  PLAYER_SPAWN_RADIUS: 280,
  SAFE_ZONE_RADIUS: 35, // Updated to match NODE_SPAWN_CONFIG
  NUM_PLAYERS: 5,
  WEDGE_ANGLE: (2 * Math.PI) / 5,
};

// Get player spawn position (same as MonsterManager)
function getPlayerSpawnPosition(playerIndex: number): { x: number; z: number } {
  const angle = MAP_CONFIG.WEDGE_ANGLE * playerIndex;
  return {
    x: Math.cos(angle) * MAP_CONFIG.PLAYER_SPAWN_RADIUS,
    z: Math.sin(angle) * MAP_CONFIG.PLAYER_SPAWN_RADIUS,
  };
}

// Check if position is in safe zone
function isInSafeZone(x: number, z: number): boolean {
  for (let i = 0; i < MAP_CONFIG.NUM_PLAYERS; i++) {
    const spawn = getPlayerSpawnPosition(i);
    const dx = x - spawn.x;
    const dz = z - spawn.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < NODE_SPAWN_CONFIG.safeZoneRadius * NODE_SPAWN_CONFIG.safeZoneRadius) {
      return true;
    }
  }
  return false;
}

// Check if inside hexagon
function isInsideHexagon(x: number, z: number): boolean {
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
 * Drop event from hitting or destroying a node
 */
export interface NodeDropEvent {
  nodeId: string;
  attackerId: string;
  dropType: ResourceType | 'talisman';
  quantity: number;
  x: number;
  z: number;
  elementType?: ElementType; // For talisman drops
}

export class ResourceNodeManager {
  private worldState: WorldState;
  private nodes: Map<string, ResourceNodeInstance> = new Map();
  private nextNodeId = 0;
  
  // Callbacks for broadcasting events
  private onNodeSpawn: ((node: ResourceNodeSpawnEvent) => void) | null = null;
  private onNodeDamage: ((data: ResourceNodeDamageEvent) => void) | null = null;
  private onNodeDestroyed: ((data: ResourceNodeDestroyedEvent) => void) | null = null;
  private onNodeDrop: ((data: NodeDropEvent) => void) | null = null;

  constructor(worldState: WorldState) {
    this.worldState = worldState;
  }

  public setOnNodeSpawn(callback: (node: ResourceNodeSpawnEvent) => void): void {
    this.onNodeSpawn = callback;
  }

  public setOnNodeDamage(callback: (data: ResourceNodeDamageEvent) => void): void {
    this.onNodeDamage = callback;
  }

  public setOnNodeDestroyed(callback: (data: ResourceNodeDestroyedEvent) => void): void {
    this.onNodeDestroyed = callback;
  }

  public setOnNodeDrop(callback: (data: NodeDropEvent) => void): void {
    this.onNodeDrop = callback;
  }

  /**
   * Initialize all resource nodes on the map
   */
  public initializeNodes(): void {
    console.log('[ResourceNodeManager] Initializing resource nodes...');
    
    const nodeTypes: ResourceNodeType[] = ['tree', 'gold_vein', 'stone_rock', 'metin_stone'];
    
    for (const nodeType of nodeTypes) {
      const count = NODE_SPAWN_CONFIG.nodesPerType[nodeType];
      const spawnZone = NODE_SPAWN_CONFIG.spawnZones[nodeType];
      const nodeDef = RESOURCE_NODE_TYPES[nodeType];
      
      let spawned = 0;
      let attempts = 0;
      const maxAttempts = count * 10;
      
      while (spawned < count && attempts < maxAttempts) {
        attempts++;
        
        // Random angle and radius within spawn zone
        const angle = Math.random() * Math.PI * 2;
        const radius = spawnZone.minRadius + Math.random() * (spawnZone.maxRadius - spawnZone.minRadius);
        
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        
        // Validate position
        if (!isInsideHexagon(x, z)) continue;
        if (isInSafeZone(x, z)) continue;
        if (!this.hasMinSpacing(x, z, nodeType)) continue;
        
        // Spawn the node
        this.spawnNode(nodeType, nodeDef, x, z);
        spawned++;
      }
      
      console.log(`[ResourceNodeManager] Spawned ${spawned}/${count} ${nodeDef.name}s`);
    }
    
    console.log(`[ResourceNodeManager] Total nodes spawned: ${this.nodes.size}`);
  }

  /**
   * Check if position has minimum spacing from other nodes of same type
   */
  private hasMinSpacing(x: number, z: number, nodeType: ResourceNodeType): boolean {
    for (const node of this.nodes.values()) {
      if (node.typeId !== nodeType) continue;
      
      const dx = x - node.x;
      const dz = z - node.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      
      if (dist < NODE_SPAWN_CONFIG.minSpacing) {
        return false;
      }
    }
    return true;
  }

  /**
   * Spawn a single resource node
   */
  private spawnNode(typeId: ResourceNodeType, nodeDef: ResourceNodeDefinition, x: number, z: number): ResourceNodeInstance {
    const nodeId = `node_${this.nextNodeId++}`;
    
    const instance: ResourceNodeInstance = {
      id: nodeId,
      typeId,
      x,
      z,
      health: nodeDef.health,
      maxHealth: nodeDef.health,
      isAlive: true,
      respawnAt: null,
    };
    
    this.nodes.set(nodeId, instance);
    
    // Add to world state
    this.worldState.spawnResourceNode(nodeId, x, z, typeId, nodeDef.health);
    
    // Broadcast spawn event
    if (this.onNodeSpawn) {
      this.onNodeSpawn({
        id: nodeId,
        typeId,
        name: nodeDef.name,
        x,
        z,
        health: nodeDef.health,
        maxHealth: nodeDef.health,
        color: nodeDef.color,
        glowColor: nodeDef.glowColor,
        scale: nodeDef.scale,
        shape: nodeDef.shape,
      });
    }
    
    return instance;
  }

  /**
   * Process an attack on a resource node
   * Returns drop info if a drop occurred
   */
  public damageNode(nodeId: string, damage: number, attackerId: string): { 
    hit: boolean; 
    destroyed: boolean;
    drop?: NodeDropEvent;
  } | null {
    const node = this.nodes.get(nodeId);
    if (!node || !node.isAlive) return null;
    
    const nodeDef = RESOURCE_NODE_TYPES[node.typeId];
    if (!nodeDef) return null;
    
    // Apply damage
    node.health = Math.max(0, node.health - damage);
    
    // Update world state
    this.worldState.setNodeHealth(nodeId, node.health);
    
    // Broadcast damage event
    if (this.onNodeDamage) {
      this.onNodeDamage({
        nodeId,
        damage,
        health: node.health,
        maxHealth: node.maxHealth,
        attackerId,
      });
    }
    
    let drop: NodeDropEvent | undefined;
    
    // Check for hit drop (chance-based)
    if (node.health > 0 && Math.random() < nodeDef.hitDropChance) {
      const quantity = nodeDef.hitDropMin + 
        Math.floor(Math.random() * (nodeDef.hitDropMax - nodeDef.hitDropMin + 1));
      
      drop = {
        nodeId,
        attackerId,
        dropType: nodeDef.hitDropType,
        quantity,
        x: node.x + (Math.random() - 0.5) * 3, // Scatter slightly
        z: node.z + (Math.random() - 0.5) * 3,
        elementType: nodeDef.hitDropType === 'talisman' ? getRandomElement() : undefined,
      };
      
      if (this.onNodeDrop) {
        this.onNodeDrop(drop);
      }
    }
    
    // Check if destroyed
    if (node.health <= 0) {
      return this.destroyNode(node, nodeDef, attackerId, drop);
    }
    
    return { hit: true, destroyed: false, drop };
  }

  /**
   * Destroy a node and handle death drops
   */
  private destroyNode(
    node: ResourceNodeInstance, 
    nodeDef: ResourceNodeDefinition, 
    attackerId: string,
    existingDrop?: NodeDropEvent
  ): { hit: boolean; destroyed: boolean; drop?: NodeDropEvent } {
    node.isAlive = false;
    node.respawnAt = Date.now() + nodeDef.respawnTime;
    
    // Remove from world state
    this.worldState.removeEntity(node.id);
    
    // Broadcast destruction
    if (this.onNodeDestroyed) {
      this.onNodeDestroyed({
        nodeId: node.id,
        respawnTime: nodeDef.respawnTime,
      });
    }
    
    // Death drop (guaranteed)
    let drop: NodeDropEvent | undefined = existingDrop;
    
    if (nodeDef.deathDropType) {
      const quantity = nodeDef.deathDropMin + 
        Math.floor(Math.random() * (nodeDef.deathDropMax - nodeDef.deathDropMin + 1));
      
      // If talisman, pick random element
      const elementType = nodeDef.dropsTalisman ? getRandomElement() : undefined;
      
      drop = {
        nodeId: node.id,
        attackerId,
        dropType: nodeDef.deathDropType,
        quantity,
        x: node.x,
        z: node.z,
        elementType,
      };
      
      if (this.onNodeDrop) {
        this.onNodeDrop(drop);
      }
      
      console.log(`[ResourceNodeManager] ${nodeDef.name} destroyed, dropped ${quantity} ${nodeDef.deathDropType}${elementType ? ` (${elementType})` : ''}`);
    }
    
    return { hit: true, destroyed: true, drop };
  }

  /**
   * Update - check for respawns
   */
  public update(_dt: number): void {
    const now = Date.now();
    
    for (const node of this.nodes.values()) {
      if (!node.isAlive && node.respawnAt && now >= node.respawnAt) {
        this.respawnNode(node);
      }
    }
  }

  /**
   * Respawn a depleted node
   */
  private respawnNode(node: ResourceNodeInstance): void {
    const nodeDef = RESOURCE_NODE_TYPES[node.typeId];
    if (!nodeDef) return;
    
    node.isAlive = true;
    node.health = node.maxHealth;
    node.respawnAt = null;
    
    // Add back to world state
    this.worldState.spawnResourceNode(node.id, node.x, node.z, node.typeId, node.health);
    
    // Broadcast spawn event
    if (this.onNodeSpawn) {
      this.onNodeSpawn({
        id: node.id,
        typeId: node.typeId,
        name: nodeDef.name,
        x: node.x,
        z: node.z,
        health: node.health,
        maxHealth: node.maxHealth,
        color: nodeDef.color,
        glowColor: nodeDef.glowColor,
        scale: nodeDef.scale,
        shape: nodeDef.shape,
      });
    }
    
    console.log(`[ResourceNodeManager] ${nodeDef.name} respawned at (${node.x.toFixed(1)}, ${node.z.toFixed(1)})`);
  }

  /**
   * Get all alive node states for new players
   */
  public getAllNodeStates(): ResourceNodeSpawnEvent[] {
    const states: ResourceNodeSpawnEvent[] = [];
    
    for (const node of this.nodes.values()) {
      if (!node.isAlive) continue;
      
      const nodeDef = RESOURCE_NODE_TYPES[node.typeId];
      if (!nodeDef) continue;
      
      states.push({
        id: node.id,
        typeId: node.typeId,
        name: nodeDef.name,
        x: node.x,
        z: node.z,
        health: node.health,
        maxHealth: node.maxHealth,
        color: nodeDef.color,
        glowColor: nodeDef.glowColor,
        scale: nodeDef.scale,
        shape: nodeDef.shape,
      });
    }
    
    return states;
  }

  /**
   * Get a specific node
   */
  public getNode(nodeId: string): ResourceNodeInstance | undefined {
    return this.nodes.get(nodeId);
  }
}

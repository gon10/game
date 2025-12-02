import * as THREE from 'three';
import { World } from '../World';
import { NetworkClient, StateUpdate, SpawnData } from '../../network/Client';
import { EntityFactory } from '../../entities/EntityFactory';

/**
 * Network System - Handles server reconciliation and entity interpolation
 * 
 * INTERPOLATION EXPLAINED (how real games do it):
 * 
 * The "render in the past" delay is NOT a fixed 100ms added to your ping!
 * It's a small buffer (typically 2-3 server ticks) to ensure we always have
 * data to interpolate between.
 * 
 * At 20 tick server (50ms between updates):
 * - Minimum buffer = 2 ticks = 100ms (we need 2 points to interpolate)
 * - But we can be smarter and interpolate towards the LATEST data
 * 
 * Professional games use:
 * - CS2: ~15-30ms buffer at 128 tick
 * - Valorant: ~8-16ms buffer at 128 tick  
 * - LoL: ~33-66ms buffer at 30 tick
 * 
 * Our server runs at 20Hz (50ms ticks), so minimum meaningful buffer is ~50ms
 * We'll use 2 ticks (100ms) as default but this could be tuned lower with
 * better network conditions.
 */
export class NetworkSystem {
  private world: World;
  private network: NetworkClient;
  private entityFactory: EntityFactory;

  // Interpolation: buffer = 2 server ticks at 60Hz = ~33ms
  // This matches LoL's responsiveness (LoL uses 30 tick = 33ms per tick)
  // Higher tick rate = smaller buffer = more responsive
  private readonly SERVER_TICK_RATE = 60; // Hz - matches our server
  private readonly INTERP_TICKS = 2; // Number of ticks to buffer
  private readonly INTERPOLATION_DELAY = (1000 / this.SERVER_TICK_RATE) * this.INTERP_TICKS; // ~33ms

  constructor(world: World, network: NetworkClient, entityFactory: EntityFactory) {
    this.world = world;
    this.network = network;
    this.entityFactory = entityFactory;
    
    console.log(`[Network] Interpolation delay: ${this.INTERPOLATION_DELAY}ms (${this.INTERP_TICKS} ticks at ${this.SERVER_TICK_RATE}Hz)`);
  }

  /**
   * Handle spawn events from server
   */
  public handleSpawn(data: SpawnData): void {
    // CRITICAL: Check if entity already exists to prevent duplicates
    const existingEntity = this.world.getEntityByNetworkId(data.id);
    if (existingEntity) {
      console.log(`[Network] Entity ${data.id} already exists, skipping spawn`);
      return;
    }
    
    const position = new THREE.Vector3(data.x, 0, data.z);
    
    if (data.type === 'champion') {
      // Check if this character belongs to local player
      // Character IDs are like "player_1_char0", ownerId is "player_1"
      const localPlayerId = this.network.getLocalPlayerId();
      const isLocal = data.ownerId === localPlayerId || data.id.startsWith(localPlayerId + '_char');
      
      this.entityFactory.createChampion(data.id, position, isLocal, data.team, data.elementType);
      console.log(`[Network] Spawned ${isLocal ? 'LOCAL' : 'REMOTE'} champion: ${data.id} (owner: ${data.ownerId}, local: ${localPlayerId})`);
    } else if (data.type === 'monster') {
      this.entityFactory.createMonster(data.id, position, data.monsterType || 'redBuff');
      console.log(`[Network] Spawned monster: ${data.id}`);
    }
  }

  /**
   * Handle state updates from server
   */
  public handleStateUpdate(data: StateUpdate): void {
    const now = performance.now();
    
    for (const entityState of data.entities) {
      const entityId = this.world.getEntityByNetworkId(entityState.id);
      if (!entityId) continue;

      const sync = this.world.getComponent(entityId, 'networkSync');
      const transform = this.world.getComponent(entityId, 'transform');
      
      if (!sync || !transform) continue;

      if (sync.isLocal) {
        // LOCAL PLAYER: Trust client prediction 100%
        // LoL/WoW approach: Local player NEVER gets position from server
        // The server is only authoritative for health, damage, etc.
        // Position is purely client-side with occasional reconciliation
        // for major desyncs (cheating, teleports, etc.)
        
        // Only reconcile if the server says we're WAY off (>5 units)
        // This handles edge cases like server teleports or anti-cheat
        const serverPos = new THREE.Vector3(entityState.x, 0, entityState.z);
        const clientPos = transform.position;
        const drift = serverPos.distanceTo(clientPos);
        
        if (drift > 5) {
          console.warn(`[Network] Major desync detected (${drift.toFixed(1)} units), snapping to server`);
          transform.position.copy(serverPos);
          const renderable = this.world.getComponent(entityId, 'renderable');
          if (renderable) {
            renderable.mesh.position.copy(serverPos);
          }
        }
        // Otherwise: DO NOTHING - trust local prediction completely
        
      } else {
        // REMOTE PLAYERS: Add to interpolation buffer
        sync.interpolationBuffer.push({
          position: new THREE.Vector3(entityState.x, 0, entityState.z),
          timestamp: now,
        });

        // Keep buffer size reasonable (about 1 second of data at 60Hz)
        while (sync.interpolationBuffer.length > 60) {
          sync.interpolationBuffer.shift();
        }
      }

      // Update health (both current and max from server)
      const health = this.world.getComponent(entityId, 'health');
      if (health) {
        if (entityState.health !== undefined) {
          health.current = entityState.health;
          health.isDead = health.current <= 0;
        }
        if (entityState.maxHealth !== undefined) {
          health.max = entityState.maxHealth;
        }
      }
      
      // Update experience from server (authoritative)
      const experience = this.world.getComponent(entityId, 'experience');
      if (experience) {
        if (entityState.level !== undefined) {
          experience.level = entityState.level;
        }
        if (entityState.currentXP !== undefined) {
          experience.currentXP = entityState.currentXP;
        }
        if (entityState.xpToNextLevel !== undefined) {
          experience.xpToNextLevel = entityState.xpToNextLevel;
        }
      }
    }
  }

  /**
   * Handle player disconnect
   */
  public handlePlayerLeft(data: { id: string }): void {
    const entityId = this.world.getEntityByNetworkId(data.id);
    if (entityId) {
      const renderable = this.world.getComponent(entityId, 'renderable');
      if (renderable) {
        this.entityFactory.releaseChampion(renderable.mesh);
      }
      this.world.destroyEntity(entityId);
    }
  }

  /**
   * Update remote entity interpolation
   * 
   * WHY INTERPOLATE IN THE PAST?
   * 
   * We receive server updates at 20Hz (every 50ms). To draw smooth movement,
   * we need at least 2 data points to interpolate between. If we tried to
   * render at "now", we'd often have no future data and would have to
   * extrapolate (guess), which causes jitter when we guess wrong.
   * 
   * By rendering 2 ticks in the past (~100ms at 20Hz), we almost always
   * have data on both sides to interpolate between = smooth motion.
   * 
   * THE TRADEOFF:
   * - Higher tick rate = smaller buffer needed = more responsive
   * - Valorant (128 tick): only needs ~16ms buffer
   * - Our game (20 tick): needs ~100ms buffer
   * 
   * To reduce this delay, increase SERVER_TICK_RATE in GameLoop.ts
   */
  public update(_dt: number): void {
    const now = performance.now();
    // Render remote entities at this time (in the past)
    const renderTime = now - this.INTERPOLATION_DELAY;

    for (const entityId of this.world.query('networkSync', 'transform', 'renderable')) {
      const sync = this.world.getComponent(entityId, 'networkSync')!;
      
      // Skip local player - they update themselves in MovementSystem
      if (sync.isLocal) continue;

      const buffer = sync.interpolationBuffer;
      
      // Need at least 2 points to interpolate
      if (buffer.length < 2) {
        // If we only have one point, just use it
        if (buffer.length === 1) {
          const transform = this.world.getComponent(entityId, 'transform')!;
          const renderable = this.world.getComponent(entityId, 'renderable')!;
          transform.position.copy(buffer[0]!.position);
          renderable.mesh.position.copy(buffer[0]!.position);
        }
        continue;
      }

      // Find the two states to interpolate between
      let before = buffer[0]!;
      let after = buffer[1]!;

      // Find the correct pair bracketing renderTime
      for (let i = 0; i < buffer.length - 1; i++) {
        const b = buffer[i]!;
        const a = buffer[i + 1]!;
        
        if (b.timestamp <= renderTime && a.timestamp >= renderTime) {
          before = b;
          after = a;
          break;
        }
        
        // If we're past all buffered data, use the last two points
        if (i === buffer.length - 2) {
          before = buffer[buffer.length - 2]!;
          after = buffer[buffer.length - 1]!;
        }
      }

      // Calculate interpolation factor
      const total = after.timestamp - before.timestamp;
      const elapsed = renderTime - before.timestamp;
      const t = total > 0 ? Math.min(1, Math.max(0, elapsed / total)) : 1;

      // Interpolate and update both transform AND mesh
      const transform = this.world.getComponent(entityId, 'transform')!;
      const renderable = this.world.getComponent(entityId, 'renderable')!;
      const animation = this.world.getComponent(entityId, 'animation');
      
      // Store previous position to calculate movement direction
      const prevPosition = transform.position.clone();
      
      transform.position.lerpVectors(before.position, after.position, t);
      
      // Calculate facing direction based on movement
      const moveDir = transform.position.clone().sub(prevPosition);
      moveDir.y = 0;
      if (moveDir.lengthSq() > 0.0001) { // Only update if actually moving
        const angle = Math.atan2(moveDir.x, moveDir.z);
        transform.rotation.y = angle;
        
        // Update face rotation for remote entity
        const faceGroup = renderable.mesh.getObjectByName('faceGroup');
        if (faceGroup) {
          faceGroup.rotation.y = angle;
        }
      }
      
      // Don't overwrite mesh position if entity is playing an animation
      // (animations like attack lunge modify mesh.position relative to transform.position)
      const isAnimating = animation && 
        animation.state !== 'idle' && 
        animation.state !== 'walking' && 
        animation.progress < 1;
      
      if (!isAnimating) {
        renderable.mesh.position.copy(transform.position);
      }
    }
  }
}

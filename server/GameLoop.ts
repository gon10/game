import { WorldState } from './WorldState';
import { MonsterManager } from './MonsterManager';

/**
 * Server Game Loop - Fixed timestep simulation
 * 
 * TICK RATE vs BROADCAST RATE:
 * 
 * - TICK_RATE (60Hz): How often physics/logic runs. Higher = more accurate simulation.
 * - BROADCAST_RATE: How often we send state to clients. This determines interpolation delay!
 * 
 * Professional games:
 * - Valorant: 128 tick broadcast (best-in-class, ~8ms interpolation buffer)
 * - CS2: 64-128 tick broadcast (~15-30ms buffer)  
 * - Overwatch: 63 tick broadcast (~16-32ms buffer)
 * - LoL: 30 tick broadcast (~33-66ms buffer)
 * 
 * Higher broadcast rate = lower interpolation delay = more responsive remote players
 * BUT uses more bandwidth. For a local game, we can go high!
 */
export class GameLoop {
  private worldState: WorldState;
  private monsterManager: MonsterManager | null = null;
  private broadcast: (data: object) => void;
  
  private isRunning = false;
  private tick = 0;
  
  // Fixed timestep at 60 Hz for physics
  private readonly TICK_RATE = 60;
  private readonly TICK_INTERVAL = 1000 / this.TICK_RATE;
  
  // Broadcast rate - higher = less interpolation delay on clients
  // 60Hz means clients only need ~33ms interpolation buffer (2 ticks)
  // This is similar to what LoL uses
  private readonly BROADCAST_RATE = 60;
  private readonly BROADCAST_INTERVAL = 1000 / this.BROADCAST_RATE;
  private lastBroadcastTime = 0;

  constructor(worldState: WorldState, broadcast: (data: object) => void) {
    this.worldState = worldState;
    this.broadcast = broadcast;
    console.log(`[Server] Running at ${this.TICK_RATE}Hz physics, ${this.BROADCAST_RATE}Hz broadcast`);
  }

  /**
   * Set the monster manager for AI updates
   */
  public setMonsterManager(monsterManager: MonsterManager): void {
    this.monsterManager = monsterManager;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastBroadcastTime = Date.now();
    this.loop();
  }

  public stop(): void {
    this.isRunning = false;
  }

  private loop(): void {
    if (!this.isRunning) return;
    
    const now = Date.now();
    const dt = this.TICK_INTERVAL / 1000;
    
    // Update world state
    this.worldState.update(dt);
    
    // Update duration-based abilities (Leaf Storm ticks)
    this.worldState.updateAbilities();
    
    // Update monster AI
    if (this.monsterManager) {
      this.monsterManager.update(dt);
      
      // Check for lazy spawns when players approach new zones
      const playerPositions = this.worldState.getEntities()
        .filter((e: { type: string; health: number }) => e.type === 'champion' && e.health > 0)
        .map((e: { x: number; z: number }) => ({ x: e.x, z: e.z }));
      this.monsterManager.checkLazySpawns(playerPositions);
    }
    
    // Check for player respawns
    this.worldState.updatePlayerRespawns();
    
    this.tick++;
    
    // Broadcast state at lower rate to save bandwidth
    if (now - this.lastBroadcastTime >= this.BROADCAST_INTERVAL) {
      this.broadcastState();
      this.lastBroadcastTime = now;
    }
    
    // Schedule next tick
    setTimeout(() => this.loop(), this.TICK_INTERVAL);
  }

  private broadcastState(): void {
    const entities = this.worldState.getEntities();
    
    const stateUpdate = {
      type: 'state',
      data: {
        tick: this.tick,
        lastProcessedInput: 0, // Will be set per-player
        entities: entities.map((e: { id: string; x: number; z: number; health: number; maxHealth: number; level?: number; currentXP?: number; xpToNextLevel?: number }) => ({
          id: e.id,
          x: e.x,
          z: e.z,
          health: e.health,
          maxHealth: e.maxHealth,
          level: e.level,
          currentXP: e.currentXP,
          xpToNextLevel: e.xpToNextLevel,
        })),
      },
    };
    
    this.broadcast(stateUpdate);
  }
}

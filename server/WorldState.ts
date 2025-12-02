/**
 * Server World State - Authoritative game state
 */

export type ElementType = 'fire' | 'water' | 'grass' | 'electric' | 'rock' | 'psychic';

// Type effectiveness chart
const TYPE_EFFECTIVENESS: Record<ElementType, { strongAgainst: ElementType[]; weakAgainst: ElementType[] }> = {
  fire: { strongAgainst: ['grass', 'psychic'], weakAgainst: ['water', 'rock'] },
  water: { strongAgainst: ['fire', 'rock'], weakAgainst: ['grass', 'electric'] },
  grass: { strongAgainst: ['water', 'rock', 'electric'], weakAgainst: ['fire', 'psychic'] },
  electric: { strongAgainst: ['water'], weakAgainst: ['rock', 'grass'] },
  rock: { strongAgainst: ['fire', 'electric', 'psychic'], weakAgainst: ['water', 'grass'] },
  psychic: { strongAgainst: ['grass', 'electric'], weakAgainst: ['fire', 'rock'] },
};

// Ability stats per element
// impactDelay: time in seconds before damage is applied (for projectile travel time)
const ABILITY_STATS: Record<ElementType, { baseDamage: number; baseHeal: number; radius: number; damagePerLevel: number; duration: number; tickInterval: number; impactDelay: number }> = {
  fire: { baseDamage: 40, baseHeal: 0, radius: 2.5, damagePerLevel: 15, duration: 0, tickInterval: 0, impactDelay: 0.8 },    // Fire Meteor (0.8s fall time - matches client castTime)
  water: { baseDamage: 15, baseHeal: 35, radius: 4, damagePerLevel: 8, duration: 0, tickInterval: 0, impactDelay: 0 },     // Tidal Blessing (instant)
  grass: { baseDamage: 8, baseHeal: 5, radius: 2.5, damagePerLevel: 3, duration: 3, tickInterval: 0.5, impactDelay: 0 },   // Leaf Storm (DoT over 3s)
  electric: { baseDamage: 35, baseHeal: 0, radius: 4, damagePerLevel: 12, duration: 0, tickInterval: 0, impactDelay: 0 },  // Lightning Chain (instant)
  rock: { baseDamage: 50, baseHeal: 0, radius: 3.5, damagePerLevel: 18, duration: 0, tickInterval: 0, impactDelay: 0 },    // Earthquake (instant)
  psychic: { baseDamage: 60, baseHeal: 0, radius: 1.5, damagePerLevel: 20, duration: 0, tickInterval: 0, impactDelay: 0 }, // Mind Shatter (instant)
};

// Stats for each element type - MUST match client values in AbilityTypes.ts
const ELEMENT_STATS: Record<ElementType, {
  health: number;
  attackDamage: number;
  attackSpeed: number;
  speed: number;
  attackRange: number;
}> = {
  fire: { health: 80, attackDamage: 15, attackSpeed: 1.8, speed: 11, attackRange: 4 },       // Mage - ranged
  water: { health: 100, attackDamage: 10, attackSpeed: 1.5, speed: 10, attackRange: 3.5 },  // Healer - ranged
  grass: { health: 120, attackDamage: 8, attackSpeed: 1.2, speed: 9, attackRange: 2 },      // Druid - melee
  electric: { health: 70, attackDamage: 12, attackSpeed: 2.0, speed: 13, attackRange: 1.8 },// Assassin - melee
  rock: { health: 150, attackDamage: 14, attackSpeed: 0.8, speed: 7, attackRange: 1.5 },    // Tank - melee
  psychic: { health: 75, attackDamage: 11, attackSpeed: 1.4, speed: 10, attackRange: 5 },   // Artillery - long range
};

interface Entity {
  id: string;
  type: 'champion' | 'monster' | 'resource_node';
  elementType?: ElementType;
  x: number;
  z: number;
  targetX: number | null;
  targetZ: number | null;
  health: number;
  maxHealth: number;
  speed: number;
  team: number;
  attackDamage: number;
  attackRange: number;
  attackSpeed: number;
  lastAttackTime: number;
  monsterType?: string;
  nodeType?: string; // For resource nodes
  // Player-specific fields
  level?: number;
  currentXP?: number;
  xpToNextLevel?: number;
  isDead?: boolean;
  respawnAt?: number;
  // Spawn position (for respawning)
  spawnX?: number;
  spawnZ?: number;
}

// Track active duration abilities for tick-based damage
interface ActiveAbility {
  casterId: string;
  elementType: ElementType;
  level: string;
  startTime: number;
  duration: number;
  tickInterval: number;
  lastTickTime: number;
  radius: number;
  damagePerTick: number;
  healPerTick: number;
}

// Track pending delayed abilities (like Fire Meteor falling)
interface PendingAbility {
  casterId: string;
  targetX: number;
  targetZ: number;
  elementType: ElementType;
  level: string;
  impactTime: number; // When damage should be applied
  baseDamage: number;
  baseHeal: number;
  radius: number;
}

export class WorldState {
  private entities: Map<string, Entity> = new Map();
  private activeAbilities: Map<string, ActiveAbility> = new Map();
  private pendingAbilities: PendingAbility[] = []; // Delayed damage abilities (fire meteor)
  private abilityTickCallbacks: Array<(damages: Array<{ targetId: string; damage: number; health: number; effectiveness: 'super' | 'weak' | 'normal' }>, heals: Array<{ targetId: string; heal: number; health: number }>) => void> = [];
  
  // Callbacks for player events
  private onPlayerLevelUp: ((data: { playerId: string; newLevel: number; stats: { health: number; attackDamage: number } }) => void) | null = null;
  private onPlayerDeath: ((data: { playerId: string; respawnTime: number }) => void) | null = null;
  private onPlayerRespawn: ((data: { playerId: string; x: number; z: number; health: number }) => void) | null = null;

  /**
   * Set callback for player level up
   */
  public setOnPlayerLevelUp(callback: (data: { playerId: string; newLevel: number; stats: { health: number; attackDamage: number } }) => void): void {
    this.onPlayerLevelUp = callback;
  }

  /**
   * Set callback for player death
   */
  public setOnPlayerDeath(callback: (data: { playerId: string; respawnTime: number }) => void): void {
    this.onPlayerDeath = callback;
  }

  /**
   * Set callback for player respawn
   */
  public setOnPlayerRespawn(callback: (data: { playerId: string; x: number; z: number; health: number }) => void): void {
    this.onPlayerRespawn = callback;
  }

  /**
   * Set callback for ability tick events
   */
  public onAbilityTick(callback: (damages: Array<{ targetId: string; damage: number; health: number; effectiveness: 'super' | 'weak' | 'normal' }>, heals: Array<{ targetId: string; heal: number; health: number }>) => void): void {
    this.abilityTickCallbacks.push(callback);
  }

  /**
   * Get active abilities (for DoT death checking)
   */
  public getActiveAbilities(): Map<string, ActiveAbility> {
    return this.activeAbilities;
  }

  /**
   * Spawn a player champion with element type
   */
  public spawnPlayer(id: string, x: number, z: number, team: number, elementType?: ElementType): void {
    const stats = elementType ? ELEMENT_STATS[elementType] : {
      health: 100, attackDamage: 10, attackSpeed: 1.5, speed: 10, attackRange: 2
    };
    
    // Starting level 1, XP curve: 100 * 1.5^(level-1)
    const startLevel = 1;
    const xpToNextLevel = this.getXPForLevel(startLevel + 1);
    
    this.entities.set(id, {
      id,
      type: 'champion',
      elementType,
      x,
      z,
      targetX: null,
      targetZ: null,
      health: stats.health,
      maxHealth: stats.health,
      speed: stats.speed,
      team,
      attackDamage: stats.attackDamage,
      attackRange: stats.attackRange,
      attackSpeed: stats.attackSpeed,
      lastAttackTime: 0,
      level: startLevel,
      currentXP: 0,
      xpToNextLevel,
      isDead: false,
      respawnAt: undefined,
      // Store spawn position for respawning
      spawnX: x,
      spawnZ: z,
    });
  }

  /**
   * Calculate XP required for a level (exponential curve)
   */
  private getXPForLevel(level: number): number {
    if (level <= 1) return 0;
    return Math.floor(100 * Math.pow(1.5, level - 2));
  }

  /**
   * Get level stat multiplier (+5% per level)
   */
  private getLevelStatMultiplier(level: number): number {
    return 1 + (level - 1) * 0.05;
  }

  /**
   * Grant XP to a player and all their characters (shared XP)
   * Character IDs follow pattern: player_X_charN
   */
  public grantXP(playerId: string, xp: number): { leveledUp: boolean; newLevel?: number } {
    // Extract base player ID (e.g., "player_1" from "player_1_char0")
    const basePlayerId = playerId.includes('_char') 
      ? playerId.split('_char')[0] 
      : playerId;
    
    // Find all characters belonging to this player
    const playerCharacters: Entity[] = [];
    for (const entity of this.entities.values()) {
      if (entity.type === 'champion' && entity.id.startsWith(basePlayerId + '_char')) {
        playerCharacters.push(entity);
      }
    }
    
    // If no characters found using pattern, fall back to single entity
    if (playerCharacters.length === 0) {
      const singlePlayer = this.entities.get(playerId);
      if (singlePlayer && singlePlayer.type === 'champion') {
        playerCharacters.push(singlePlayer);
      }
    }
    
    if (playerCharacters.length === 0) {
      return { leveledUp: false };
    }
    
    let anyLeveledUp = false;
    let highestNewLevel: number | undefined;
    
    // Grant XP to ALL characters owned by this player
    for (const player of playerCharacters) {
      player.currentXP = (player.currentXP || 0) + xp;
      
      // Check for level up
      if (player.currentXP >= (player.xpToNextLevel || 100)) {
        player.currentXP -= player.xpToNextLevel || 100;
        player.level = (player.level || 1) + 1;
        player.xpToNextLevel = this.getXPForLevel(player.level + 1);
        
        // Update stats based on new level
        const baseStats = player.elementType ? ELEMENT_STATS[player.elementType] : {
          health: 100, attackDamage: 10, attackSpeed: 1.5, speed: 10, attackRange: 2
        };
        const multiplier = this.getLevelStatMultiplier(player.level);
        
        player.maxHealth = Math.floor(baseStats.health * multiplier);
        player.attackDamage = Math.floor(baseStats.attackDamage * multiplier);
        // Heal to full on level up
        player.health = player.maxHealth;
        
        console.log(`[WorldState] Character ${player.id} leveled up to ${player.level}! New max HP: ${player.maxHealth}, Damage: ${player.attackDamage}`);
        
        if (this.onPlayerLevelUp) {
          this.onPlayerLevelUp({
            playerId: player.id,
            newLevel: player.level,
            stats: { health: player.maxHealth, attackDamage: player.attackDamage },
          });
        }
        
        anyLeveledUp = true;
        if (!highestNewLevel || player.level > highestNewLevel) {
          highestNewLevel = player.level;
        }
      }
    }
    
    return { leveledUp: anyLeveledUp, newLevel: highestNewLevel };
  }

  /**
   * Handle player death
   */
  public handlePlayerDeath(playerId: string): void {
    const player = this.entities.get(playerId);
    if (!player || player.type !== 'champion') return;
    
    player.isDead = true;
    player.health = 0;
    
    // Calculate respawn time: 5s + 0.5s per level, max 30s
    const level = player.level || 1;
    const respawnTime = Math.min(5000 + level * 500, 30000);
    player.respawnAt = Date.now() + respawnTime;
    
    console.log(`[WorldState] Player ${playerId} died, respawn in ${respawnTime}ms`);
    
    if (this.onPlayerDeath) {
      this.onPlayerDeath({ playerId, respawnTime });
    }
  }

  /**
   * Check and handle player respawns
   */
  public updatePlayerRespawns(): void {
    const now = Date.now();
    
    for (const entity of this.entities.values()) {
      if (entity.type !== 'champion' || !entity.isDead) continue;
      
      if (entity.respawnAt && now >= entity.respawnAt) {
        // Respawn at original spawn position (safe zone)
        entity.x = entity.spawnX ?? 0;
        entity.z = entity.spawnZ ?? 0;
        entity.targetX = null;
        entity.targetZ = null;
        entity.health = entity.maxHealth;
        entity.isDead = false;
        entity.respawnAt = undefined;
        
        console.log(`[WorldState] Player ${entity.id} respawned at spawn point (${entity.x.toFixed(1)}, ${entity.z.toFixed(1)})`);
        
        if (this.onPlayerRespawn) {
          this.onPlayerRespawn({
            playerId: entity.id,
            x: entity.x,
            z: entity.z,
            health: entity.health,
          });
        }
      }
    }
  }

  /**
   * Get player level info
   */
  public getPlayerLevel(playerId: string): { level: number; currentXP: number; xpToNextLevel: number } | null {
    const player = this.entities.get(playerId);
    if (!player || player.type !== 'champion') return null;
    
    return {
      level: player.level || 1,
      currentXP: player.currentXP || 0,
      xpToNextLevel: player.xpToNextLevel || 100,
    };
  }

  /**
   * Spawn a monster with proper stats from MonsterManager
   */
  public spawnMonster(
    id: string,
    x: number,
    z: number,
    monsterType: string,
    stats?: { health: number; attackDamage: number; attackSpeed: number; attackRange: number; moveSpeed: number }
  ): void {
    // Use provided stats or defaults
    const health = stats?.health ?? 500;
    const maxHealth = stats?.health ?? 500;
    const attackDamage = stats?.attackDamage ?? 25;
    const attackSpeed = stats?.attackSpeed ?? 0.8;
    const attackRange = stats?.attackRange ?? 3;
    const speed = stats?.moveSpeed ?? 3;
    
    this.entities.set(id, {
      id,
      type: 'monster',
      x,
      z,
      targetX: null,
      targetZ: null,
      health,
      maxHealth,
      speed,
      team: 0, // Neutral (attackable by all)
      attackDamage,
      attackRange,
      attackSpeed,
      lastAttackTime: 0,
      monsterType,
    });
  }

  /**
   * Set monster position (called by MonsterManager)
   */
  public setMonsterPosition(monsterId: string, x: number, z: number): void {
    const entity = this.entities.get(monsterId);
    if (entity && entity.type === 'monster') {
      entity.x = x;
      entity.z = z;
    }
  }

  /**
   * Set monster health (called by MonsterManager)
   */
  public setMonsterHealth(monsterId: string, health: number): void {
    const entity = this.entities.get(monsterId);
    if (entity && entity.type === 'monster') {
      entity.health = health;
    }
  }

  /**
   * Spawn a resource node
   */
  public spawnResourceNode(id: string, x: number, z: number, nodeType: string, health: number): void {
    this.entities.set(id, {
      id,
      type: 'resource_node',
      x,
      z,
      targetX: null,
      targetZ: null,
      health,
      maxHealth: health,
      speed: 0,
      team: -1, // Attackable by all (resource node)
      attackDamage: 0,
      attackRange: 0,
      attackSpeed: 0,
      lastAttackTime: 0,
      nodeType,
    });
  }

  /**
   * Set resource node health
   */
  public setNodeHealth(nodeId: string, health: number): void {
    const entity = this.entities.get(nodeId);
    if (entity && entity.type === 'resource_node') {
      entity.health = health;
    }
  }

  /**
   * Monster attacks player (called by MonsterManager)
   */
  public monsterAttack(
    monsterId: string,
    targetId: string,
    damage: number
  ): { damage: number; targetHealth: number } | null {
    const monster = this.entities.get(monsterId);
    const target = this.entities.get(targetId);
    
    if (!monster || !target || target.type !== 'champion') {
      return null;
    }
    
    // Apply damage to player
    target.health = Math.max(0, target.health - damage);
    
    console.log(`[WorldState] Monster ${monsterId} hit ${targetId} for ${damage} (HP: ${target.health}/${target.maxHealth})`);
    
    // Check for player death
    if (target.health <= 0 && !target.isDead) {
      this.handlePlayerDeath(targetId);
    }
    
    return {
      damage,
      targetHealth: target.health,
    };
  }

  /**
   * Remove an entity
   */
  public removeEntity(id: string): void {
    this.entities.delete(id);
  }

  /**
   * Set player position directly (LoL-style client-authoritative movement)
   * Server trusts client position for responsiveness
   */
  public setPlayerPosition(id: string, x: number, z: number): void {
    const entity = this.entities.get(id);
    if (entity && entity.type === 'champion') {
      entity.x = x;
      entity.z = z;
    }
  }

  /**
   * Set move target for an entity (used for monsters and direction hints)
   */
  public setMoveTarget(id: string, x: number, z: number): void {
    const entity = this.entities.get(id);
    if (entity) {
      entity.targetX = x;
      entity.targetZ = z;
    }
  }

  /**
   * Process an attack
   */
  public attack(
    attackerId: string,
    targetId: string
  ): { damage: number; targetHealth: number } | null {
    const attacker = this.entities.get(attackerId);
    const target = this.entities.get(targetId);
    
    if (!attacker || !target) {
      console.log(`[WorldState] Attack failed: attacker=${!!attacker}, target=${!!target}`);
      return null;
    }
    
    // Skip if target is dead
    if (target.health <= 0 || target.isDead) {
      console.log(`[WorldState] Attack failed: target is already dead`);
      return null;
    }
    
    // Skip range check for PvP (client-authoritative movement means server positions may be stale)
    // Client already validates range locally before sending attack
    // Only do range check for PvE (monster attacks) where server has accurate monster positions
    if (target.type === 'monster') {
      const dx = target.x - attacker.x;
      const dz = target.z - attacker.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      
      // Be lenient with range check (add buffer for network latency)
      const effectiveRange = attacker.attackRange + 3.0;
      if (distance > effectiveRange) {
        console.log(`[WorldState] Attack failed: distance ${distance.toFixed(1)} > range ${effectiveRange.toFixed(1)}`);
        return null; // Out of range
      }
    }
    
    // Check attack cooldown - be lenient to account for network latency
    const now = Date.now();
    const attackInterval = 1000 / attacker.attackSpeed;
    const cooldownBuffer = 150; // 150ms buffer for network latency
    
    if (now - attacker.lastAttackTime < attackInterval - cooldownBuffer) {
      // Don't log cooldown failures (too spammy)
      return null; // On cooldown
    }
    
    // Deal damage
    attacker.lastAttackTime = now;
    target.health = Math.max(0, target.health - attacker.attackDamage);
    
    console.log(`[WorldState] Attack success: ${attackerId} hit ${targetId} for ${attacker.attackDamage} (HP: ${target.health}/${target.maxHealth})`);
    
    // Check for player death in PvP
    if (target.health <= 0 && !target.isDead && target.type === 'champion') {
      this.handlePlayerDeath(targetId);
    }
    
    return {
      damage: attacker.attackDamage,
      targetHealth: target.health,
    };
  }

  /**
   * Get damage multiplier based on type effectiveness
   */
  public getDamageMultiplier(attackerType: ElementType | undefined, defenderType: ElementType | undefined): { multiplier: number; effectiveness: 'super' | 'weak' | 'normal' } {
    if (!attackerType || !defenderType) {
      return { multiplier: 1.0, effectiveness: 'normal' };
    }
    
    const typeInfo = TYPE_EFFECTIVENESS[attackerType];
    if (typeInfo.strongAgainst.includes(defenderType)) {
      return { multiplier: 1.5, effectiveness: 'super' };
    }
    if (typeInfo.weakAgainst.includes(defenderType)) {
      return { multiplier: 0.75, effectiveness: 'weak' };
    }
    return { multiplier: 1.0, effectiveness: 'normal' };
  }

  /**
   * Process ability damage/heal
   */
  public processAbility(
    casterId: string,
    targetId: string,
    _abilityId: string,
    level: string
  ): { 
    damages: Array<{ targetId: string; damage: number; health: number; effectiveness: 'super' | 'weak' | 'normal' }>;
    heals: Array<{ targetId: string; heal: number; health: number }>;
  } {
    const caster = this.entities.get(casterId);
    if (!caster) return { damages: [], heals: [] };
    
    const casterElement = caster.elementType;
    if (!casterElement) return { damages: [], heals: [] };
    
    const abilityStats = ABILITY_STATS[casterElement];
    const levelMultiplier = level === 'P' ? 1.6 : level === 'G' ? 1.3 : 1.0;
    const baseDamage = Math.floor((abilityStats.baseDamage + abilityStats.damagePerLevel * (level === 'P' ? 2 : level === 'G' ? 1 : 0)) * levelMultiplier);
    const baseHeal = Math.floor(abilityStats.baseHeal * levelMultiplier);
    const radius = abilityStats.radius * levelMultiplier;
    
    const damages: Array<{ targetId: string; damage: number; health: number; effectiveness: 'super' | 'weak' | 'normal' }> = [];
    const heals: Array<{ targetId: string; heal: number; health: number }> = [];
    
    // Water ability: Tidal Blessing - heals lowest HP ally and damages enemies in range
    if (casterElement === 'water') {
      // Find lowest HP ally (must be a player on same team, team > 0)
      // Monsters are team 0 (neutral) and should NOT be healed
      let lowestHpAlly: Entity | null = null;
      let lowestHpPercent = 1.0;
      
      for (const entity of this.entities.values()) {
        // Only heal players (champions) on same team, NOT monsters (team 0)
        if (entity.type === 'champion' && entity.team === caster.team && entity.team > 0 && entity.health > 0) {
          const hpPercent = entity.health / entity.maxHealth;
          if (hpPercent < lowestHpPercent) {
            lowestHpPercent = hpPercent;
            lowestHpAlly = entity;
          }
        }
      }
      
      // Heal lowest HP ally (big heal)
      if (lowestHpAlly && lowestHpAlly.health < lowestHpAlly.maxHealth) {
        const healAmount = Math.min(baseHeal, lowestHpAlly.maxHealth - lowestHpAlly.health);
        lowestHpAlly.health = Math.min(lowestHpAlly.maxHealth, lowestHpAlly.health + healAmount);
        heals.push({ targetId: lowestHpAlly.id, heal: healAmount, health: lowestHpAlly.health });
        console.log(`[WorldState] Tidal Blessing healed ${lowestHpAlly.id} for ${healAmount}`);
      }
      
      // Damage enemies in radius around caster
      for (const entity of this.entities.values()) {
        const dx = entity.x - caster.x;
        const dz = entity.z - caster.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        if (distance <= radius && entity.team !== caster.team && entity.health > 0) {
          const { multiplier, effectiveness } = this.getDamageMultiplier(casterElement, entity.elementType);
          const finalDamage = Math.floor(baseDamage * multiplier);
          entity.health = Math.max(0, entity.health - finalDamage);
          damages.push({ targetId: entity.id, damage: finalDamage, health: entity.health, effectiveness });
          console.log(`[WorldState] Tidal Blessing hit ${entity.id} for ${finalDamage} (${effectiveness})`);
        }
      }
      
      return { damages, heals };
    }
    
    // Grass ability: Leaf Storm - duration-based, register for tick updates
    if (casterElement === 'grass' && abilityStats.duration > 0) {
      this.activeAbilities.set(casterId, {
        casterId,
        elementType: casterElement,
        level,
        startTime: Date.now(),
        duration: abilityStats.duration * 1000,
        tickInterval: abilityStats.tickInterval * 1000,
        lastTickTime: Date.now(),
        radius,
        damagePerTick: baseDamage,
        healPerTick: baseHeal,
      });
      
      console.log(`[WorldState] Started Leaf Storm for ${casterId}, duration: ${abilityStats.duration}s`);
      
      // Do first tick immediately
      return this.processAbilityTick(casterId);
    }
    
    // Fire ability: Meteor - delayed damage until meteor lands
    if (casterElement === 'fire' && abilityStats.impactDelay && abilityStats.impactDelay > 0) {
      const target = this.entities.get(targetId);
      const centerX = target?.x ?? caster.x;
      const centerZ = target?.z ?? caster.z;
      
      // Queue the delayed damage
      this.pendingAbilities.push({
        casterId,
        targetX: centerX,
        targetZ: centerZ,
        elementType: casterElement,
        level,
        impactTime: Date.now() + abilityStats.impactDelay * 1000,
        baseDamage,
        baseHeal: 0, // Fire doesn't heal
        radius,
      });
      
      console.log(`[WorldState] Queued Fire Meteor for ${casterId}, impact in ${abilityStats.impactDelay}s at (${centerX.toFixed(1)}, ${centerZ.toFixed(1)})`);
      
      // Return empty - damage will be dealt when meteor lands
      return { damages, heals };
    }
    
    // Standard instant abilities (electric, rock, psychic)
    const target = this.entities.get(targetId);
    const centerX = target?.x ?? caster.x;
    const centerZ = target?.z ?? caster.z;
    
    for (const entity of this.entities.values()) {
      const dx = entity.x - centerX;
      const dz = entity.z - centerZ;
      const distance = Math.sqrt(dx * dx + dz * dz);
      
      if (distance > radius) continue;
      
      if (baseDamage > 0 && entity.team !== caster.team && entity.health > 0) {
        const { multiplier, effectiveness } = this.getDamageMultiplier(casterElement, entity.elementType);
        const finalDamage = Math.floor(baseDamage * multiplier);
        entity.health = Math.max(0, entity.health - finalDamage);
        damages.push({ targetId: entity.id, damage: finalDamage, health: entity.health, effectiveness });
        console.log(`[WorldState] Ability hit ${entity.id} for ${finalDamage} (${effectiveness})`);
      }
      
      // Only heal allied players (team > 0), not monsters (team 0)
      if (baseHeal > 0 && entity.type === 'champion' && entity.team === caster.team && entity.team > 0 && entity.health > 0) {
        const healAmount = Math.min(baseHeal, entity.maxHealth - entity.health);
        entity.health = Math.min(entity.maxHealth, entity.health + healAmount);
        heals.push({ targetId: entity.id, heal: healAmount, health: entity.health });
        console.log(`[WorldState] Ability healed ${entity.id} for ${healAmount}`);
      }
    }
    
    return { damages, heals };
  }

  /**
   * Process a tick for duration-based abilities (Leaf Storm)
   */
  private processAbilityTick(casterId: string): { 
    damages: Array<{ targetId: string; damage: number; health: number; effectiveness: 'super' | 'weak' | 'normal' }>;
    heals: Array<{ targetId: string; heal: number; health: number }>;
  } {
    const ability = this.activeAbilities.get(casterId);
    if (!ability) return { damages: [], heals: [] };
    
    const caster = this.entities.get(casterId);
    if (!caster || caster.health <= 0) {
      this.activeAbilities.delete(casterId);
      return { damages: [], heals: [] };
    }
    
    const damages: Array<{ targetId: string; damage: number; health: number; effectiveness: 'super' | 'weak' | 'normal' }> = [];
    const heals: Array<{ targetId: string; heal: number; health: number }> = [];
    
    // Find entities around current caster position
    for (const entity of this.entities.values()) {
      const dx = entity.x - caster.x;
      const dz = entity.z - caster.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      
      if (distance > ability.radius) continue;
      
      // Damage enemies
      if (ability.damagePerTick > 0 && entity.team !== caster.team && entity.health > 0) {
        const { multiplier, effectiveness } = this.getDamageMultiplier(ability.elementType, entity.elementType);
        const finalDamage = Math.floor(ability.damagePerTick * multiplier);
        entity.health = Math.max(0, entity.health - finalDamage);
        damages.push({ targetId: entity.id, damage: finalDamage, health: entity.health, effectiveness });
      }
      
      // Heal allies (only players on same team, not monsters)
      if (ability.healPerTick > 0 && entity.type === 'champion' && entity.team === caster.team && entity.team > 0 && entity.health > 0 && entity.health < entity.maxHealth) {
        const healAmount = Math.min(ability.healPerTick, entity.maxHealth - entity.health);
        entity.health = Math.min(entity.maxHealth, entity.health + healAmount);
        heals.push({ targetId: entity.id, heal: healAmount, health: entity.health });
      }
    }
    
    return { damages, heals };
  }

  /**
   * Update active abilities (call from game loop)
   */
  public updateAbilities(): void {
    const now = Date.now();
    const expiredAbilities: string[] = [];
    
    for (const [casterId, ability] of this.activeAbilities) {
      // Check if ability expired
      if (now - ability.startTime >= ability.duration) {
        expiredAbilities.push(casterId);
        continue;
      }
      
      // Check if it's time for a tick
      if (now - ability.lastTickTime >= ability.tickInterval) {
        ability.lastTickTime = now;
        const result = this.processAbilityTick(casterId);
        
        // Notify callbacks
        if (result.damages.length > 0 || result.heals.length > 0) {
          for (const callback of this.abilityTickCallbacks) {
            callback(result.damages, result.heals);
          }
        }
      }
    }
    
    // Clean up expired abilities
    for (const casterId of expiredAbilities) {
      this.activeAbilities.delete(casterId);
      console.log(`[WorldState] Leaf Storm ended for ${casterId}`);
    }
    
    // Process pending delayed abilities (fire meteor impact)
    this.processPendingAbilities(now);
  }
  
  /**
   * Process pending delayed abilities (like Fire Meteor landing)
   */
  private processPendingAbilities(now: number): void {
    const completedIndices: number[] = [];
    
    for (let i = 0; i < this.pendingAbilities.length; i++) {
      const pending = this.pendingAbilities[i]!;
      
      // Skip if not yet time for impact
      if (now < pending.impactTime) continue;
      
      // Get caster for team check and damage multiplier
      const caster = this.entities.get(pending.casterId);
      if (!caster) {
        completedIndices.push(i);
        continue;
      }
      
      const damages: Array<{ targetId: string; damage: number; health: number; effectiveness: 'super' | 'weak' | 'normal' }> = [];
      const heals: Array<{ targetId: string; heal: number; health: number }> = [];
      
      // Apply damage to all enemies in radius at impact location
      for (const entity of this.entities.values()) {
        const dx = entity.x - pending.targetX;
        const dz = entity.z - pending.targetZ;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        if (distance > pending.radius) continue;
        
        // Damage enemies
        if (pending.baseDamage > 0 && entity.team !== caster.team && entity.health > 0) {
          const { multiplier, effectiveness } = this.getDamageMultiplier(pending.elementType, entity.elementType);
          const finalDamage = Math.floor(pending.baseDamage * multiplier);
          entity.health = Math.max(0, entity.health - finalDamage);
          damages.push({ targetId: entity.id, damage: finalDamage, health: entity.health, effectiveness });
          console.log(`[WorldState] Fire Meteor hit ${entity.id} for ${finalDamage} (${effectiveness})`);
        }
        
        // Heal allies (if applicable - fire doesn't heal but keeping for generality)
        if (pending.baseHeal > 0 && entity.type === 'champion' && entity.team === caster.team && entity.team > 0 && entity.health > 0 && entity.health < entity.maxHealth) {
          const healAmount = Math.min(pending.baseHeal, entity.maxHealth - entity.health);
          entity.health = Math.min(entity.maxHealth, entity.health + healAmount);
          heals.push({ targetId: entity.id, heal: healAmount, health: entity.health });
        }
      }
      
      // Notify callbacks of damage/heals
      if (damages.length > 0 || heals.length > 0) {
        for (const callback of this.abilityTickCallbacks) {
          callback(damages, heals);
        }
      }
      
      console.log(`[WorldState] Fire Meteor landed at (${pending.targetX.toFixed(1)}, ${pending.targetZ.toFixed(1)}), hit ${damages.length} targets`);
      completedIndices.push(i);
    }
    
    // Remove completed pending abilities (in reverse order to preserve indices)
    for (let i = completedIndices.length - 1; i >= 0; i--) {
      const idx = completedIndices[i]!;
      this.pendingAbilities.splice(idx, 1);
    }
  }

  /**
   * Update world state
   */
  public update(dt: number): void {
    for (const entity of this.entities.values()) {
      this.updateEntity(entity, dt);
    }
  }

  private updateEntity(entity: Entity, dt: number): void {
    // Skip if dead
    if (entity.health <= 0) return;
    
    // PLAYERS: Don't simulate movement - they send position directly (LoL-style)
    // Only monsters use server-side movement
    if (entity.type === 'champion') {
      return; // Player position comes from client
    }
    
    // Move towards target (monsters only)
    if (entity.targetX !== null && entity.targetZ !== null) {
      const dx = entity.targetX - entity.x;
      const dz = entity.targetZ - entity.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      
      if (distance > 0.5) {
        // Normalize and apply speed
        const moveX = (dx / distance) * entity.speed * dt;
        const moveZ = (dz / distance) * entity.speed * dt;
        
        entity.x += moveX;
        entity.z += moveZ;
      } else {
        // Reached target
        entity.targetX = null;
        entity.targetZ = null;
      }
    }
  }

  /**
   * Get all entities
   */
  public getEntities(): Entity[] {
    return [...this.entities.values()];
  }

  /**
   * Get entity by ID
   */
  public getEntity(id: string): Entity | undefined {
    return this.entities.get(id);
  }
}

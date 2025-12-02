import * as THREE from 'three';
import { World } from '../World';
import { AbilityLevel } from '../components';
import { EntityFactory } from '../../entities/EntityFactory';
import { AbilityEffectPool } from '../../rendering/AbilityEffectPool';
import { 
  ABILITIES, 
  MANA_CONFIG, 
  canUpgradeAbility, 
  getNextLevel,
  ElementType,
  TALISMAN_CONFIG
} from '../../types/AbilityTypes';
import { AnimationSystem } from './AnimationSystem';

/**
 * Ability System - Handles mana gain, ability casting, and talisman upgrades
 * 
 * TFT-inspired:
 * - Characters gain mana when they hit enemies
 * - When mana is full, they auto-cast their ability on current target
 * - Mana resets to 0 after casting
 * 
 * Metin2-inspired:
 * - 3 ability levels: M (basic), G (enhanced), P (perfect)
 * - Collect 3 matching-element talismans to upgrade
 * - Each level has progressively better visuals
 */
export class AbilitySystem {
  private world: World;
  private entityFactory: EntityFactory;
  private abilityEffectPool: AbilityEffectPool;
  private animationSystem: AnimationSystem;
  
  // Track local characters for network sync
  private localCharIds: Set<string> = new Set();
  
  // Callbacks for network events
  private onAbilityCastCallback: ((casterId: string, targetId: string, abilityId: string, level: AbilityLevel) => void) | null = null;
  private onTalismanPickupCallback: ((charId: string, elementType: string) => void) | null = null;
  private onAbilityUpgradeCallback: ((charId: string, newLevel: AbilityLevel) => void) | null = null;
  
  // Active ability effects (for updating Leaf Storm position, etc.)
  private activeAbilities: Map<string, {
    casterId: string;
    effectId: string;
    elementType: ElementType;
    startTime: number;
    duration: number;
  }> = new Map();

  constructor(
    world: World, 
    entityFactory: EntityFactory, 
    scene: THREE.Scene,
    animationSystem: AnimationSystem
  ) {
    this.world = world;
    this.entityFactory = entityFactory;
    this.abilityEffectPool = new AbilityEffectPool(scene);
    this.animationSystem = animationSystem;
  }

  /**
   * Register a character as locally owned
   */
  public registerLocalChar(networkId: string): void {
    this.localCharIds.add(networkId);
  }

  /**
   * Set callback for ability cast events
   */
  public setAbilityCastCallback(
    callback: (casterId: string, targetId: string, abilityId: string, level: AbilityLevel) => void
  ): void {
    this.onAbilityCastCallback = callback;
  }

  /**
   * Set callback for talisman pickup events
   */
  public setTalismanPickupCallback(callback: (charId: string, elementType: string) => void): void {
    this.onTalismanPickupCallback = callback;
  }

  /**
   * Set callback for ability upgrade events
   */
  public setAbilityUpgradeCallback(callback: (charId: string, newLevel: AbilityLevel) => void): void {
    this.onAbilityUpgradeCallback = callback;
  }

  /**
   * Called when a character lands an attack - add mana
   */
  public onAttackHit(attackerEntityId: string): void {
    const mana = this.world.getComponent(attackerEntityId, 'mana');
    const ability = this.world.getComponent(attackerEntityId, 'ability');
    const entityType = this.world.getComponent(attackerEntityId, 'entityType');
    const combat = this.world.getComponent(attackerEntityId, 'combat');
    
    if (!mana || !ability || !entityType?.elementType) return;
    
    // Add mana from hit
    mana.current = Math.min(mana.current + mana.gainPerHit, mana.max);
    
    console.log(`[Ability] ${entityType.elementType} gained ${mana.gainPerHit} mana: ${mana.current}/${mana.max}`);
    
    // Check if mana is full
    if (mana.current >= mana.max) {
      ability.isReady = true;
      
      // Auto-cast on current target
      if (combat?.targetId) {
        this.castAbility(attackerEntityId, combat.targetId);
      }
    }
  }

  /**
   * Cast an ability from caster to target
   */
  public castAbility(casterEntityId: string, targetNetworkId: string): void {
    // Check if caster is dead - can't cast when dead!
    const health = this.world.getComponent(casterEntityId, 'health');
    if (health?.isDead) {
      console.log(`[Ability] Caster ${casterEntityId} is dead, cannot cast`);
      return;
    }
    
    const ability = this.world.getComponent(casterEntityId, 'ability');
    const mana = this.world.getComponent(casterEntityId, 'mana');
    const entityType = this.world.getComponent(casterEntityId, 'entityType');
    const transform = this.world.getComponent(casterEntityId, 'transform');
    const networkSync = this.world.getComponent(casterEntityId, 'networkSync');
    
    if (!ability || !mana || !entityType?.elementType || !transform) {
      console.warn('[Ability] Missing components for ability cast');
      return;
    }
    
    const elementType = entityType.elementType as ElementType;
    const abilityInfo = ABILITIES[elementType as keyof typeof ABILITIES];
    
    if (!abilityInfo) {
      console.warn(`[Ability] No ability defined for element: ${elementType}`);
      return;
    }
    
    // Get target position
    const targetEntityId = this.world.getEntityByNetworkId(targetNetworkId);
    let targetPosition = transform.position.clone(); // Default to caster position
    
    if (targetEntityId) {
      const targetTransform = this.world.getComponent(targetEntityId, 'transform');
      if (targetTransform) {
        targetPosition = targetTransform.position.clone();
      }
    }
    
    console.log(`[Ability] Casting ${abilityInfo.name} (Level ${ability.level}) at target`);
    
    // Reset mana to 0
    mana.current = 0;
    ability.isReady = false;
    ability.isCasting = true;
    ability.castProgress = 0;
    
    // Spawn visual effect based on ability type
    const effectId = this.spawnAbilityEffect(
      elementType,
      ability.level,
      transform.position,
      targetPosition,
      () => {
        // Effect complete callback
        ability.isCasting = false;
        this.activeAbilities.delete(casterEntityId);
      }
    );
    
    // Track active ability for updates
    this.activeAbilities.set(casterEntityId, {
      casterId: casterEntityId,
      effectId,
      elementType,
      startTime: performance.now(),
      duration: abilityInfo.castTime * 1000 + (abilityInfo.duration * 1000),
    });
    
    // Send to server if local character
    if (networkSync && this.localCharIds.has(networkSync.networkId) && this.onAbilityCastCallback) {
      this.onAbilityCastCallback(
        networkSync.networkId,
        targetNetworkId,
        abilityInfo.id,
        ability.level
      );
    }
  }

  /**
   * Handle ability cast from network (for remote players)
   */
  public handleNetworkAbilityCast(data: {
    casterId: string;
    targetId: string;
    abilityId: string;
    level: AbilityLevel;
  }): void {
    // Don't duplicate for local characters
    if (this.localCharIds.has(data.casterId)) return;
    
    const casterEntityId = this.world.getEntityByNetworkId(data.casterId);
    if (!casterEntityId) return;
    
    const transform = this.world.getComponent(casterEntityId, 'transform');
    const ability = this.world.getComponent(casterEntityId, 'ability');
    const mana = this.world.getComponent(casterEntityId, 'mana');
    
    if (!transform) return;
    
    // Get target position
    const targetEntityId = this.world.getEntityByNetworkId(data.targetId);
    let targetPosition = transform.position.clone();
    
    if (targetEntityId) {
      const targetTransform = this.world.getComponent(targetEntityId, 'transform');
      if (targetTransform) {
        targetPosition = targetTransform.position.clone();
      }
    }
    
    // Determine element type from ability ID
    const elementType = this.getElementFromAbilityId(data.abilityId);
    if (!elementType) return;
    
    console.log(`[Ability] Network cast: ${data.abilityId} (Level ${data.level}) from ${data.casterId}`);
    
    // Update mana display
    if (mana) {
      mana.current = 0;
    }
    if (ability) {
      ability.isCasting = true;
    }
    
    // Spawn visual effect
    const effectId = this.spawnAbilityEffect(
      elementType,
      data.level,
      transform.position,
      targetPosition,
      () => {
        if (ability) ability.isCasting = false;
        this.activeAbilities.delete(casterEntityId);
      }
    );
    
    // Track active ability for position updates (important for grass ability!)
    const abilityInfo = ABILITIES[elementType as keyof typeof ABILITIES];
    this.activeAbilities.set(casterEntityId, {
      casterId: casterEntityId,
      effectId,
      elementType,
      startTime: performance.now(),
      duration: (abilityInfo?.castTime ?? 1) * 1000 + (abilityInfo?.duration ?? 2) * 1000,
    });
  }

  /**
   * Spawn the visual effect for an ability
   */
  private spawnAbilityEffect(
    elementType: ElementType,
    level: AbilityLevel,
    casterPosition: THREE.Vector3,
    targetPosition: THREE.Vector3,
    onComplete?: () => void
  ): string {
    switch (elementType) {
      case 'fire':
        return this.abilityEffectPool.spawnFireMeteor(
          casterPosition,
          targetPosition,
          level,
          onComplete
        );
        
      case 'water':
        return this.abilityEffectPool.spawnTidalBlessing(
          casterPosition,
          level,
          onComplete
        );
        
      case 'grass':
        return this.abilityEffectPool.spawnLeafStorm(
          casterPosition,
          level,
          onComplete
        );
        
      case 'electric':
        // For lightning chain, we need to find nearby targets
        const chainTargets = this.findChainTargets(casterPosition, targetPosition, 3);
        return this.abilityEffectPool.spawnLightningChain(
          casterPosition,
          chainTargets,
          level,
          onComplete
        );
        
      case 'rock':
        return this.abilityEffectPool.spawnEarthquake(
          casterPosition,
          level,
          onComplete
        );
        
      case 'psychic':
        return this.abilityEffectPool.spawnMindShatter(
          casterPosition,
          targetPosition,
          level,
          onComplete
        );
        
      default:
        console.warn(`[Ability] Unknown element type: ${elementType}`);
        return '';
    }
  }

  /**
   * Find chain targets for Lightning Chain ability
   */
  private findChainTargets(
    _casterPosition: THREE.Vector3,
    initialTarget: THREE.Vector3,
    maxTargets: number
  ): THREE.Vector3[] {
    const targets: THREE.Vector3[] = [initialTarget];
    const usedPositions = new Set<string>();
    usedPositions.add(`${initialTarget.x.toFixed(1)},${initialTarget.z.toFixed(1)}`);
    
    let lastTarget = initialTarget;
    const chainRange = ABILITIES.electric.radius;
    
    // Find additional chain targets
    for (let i = 1; i < maxTargets; i++) {
      let closestDistance = Infinity;
      let closestPosition: THREE.Vector3 | null = null;
      
      for (const entityId of this.world.query('health', 'transform', 'entityType')) {
        const transform = this.world.getComponent(entityId, 'transform');
        const health = this.world.getComponent(entityId, 'health');
        
        if (!transform || !health || health.isDead) continue;
        
        const posKey = `${transform.position.x.toFixed(1)},${transform.position.z.toFixed(1)}`;
        if (usedPositions.has(posKey)) continue;
        
        const distance = lastTarget.distanceTo(transform.position);
        
        if (distance <= chainRange && distance < closestDistance) {
          closestDistance = distance;
          closestPosition = transform.position.clone();
        }
      }
      
      if (closestPosition) {
        targets.push(closestPosition);
        usedPositions.add(`${closestPosition.x.toFixed(1)},${closestPosition.z.toFixed(1)}`);
        lastTarget = closestPosition;
      } else {
        break; // No more valid targets
      }
    }
    
    return targets;
  }

  /**
   * Get element type from ability ID
   */
  private getElementFromAbilityId(abilityId: string): ElementType | null {
    for (const [element, ability] of Object.entries(ABILITIES)) {
      if (ability.id === abilityId) {
        return element as ElementType;
      }
    }
    return null;
  }

  /**
   * Add a talisman to a character's inventory
   */
  public addTalisman(entityId: string, elementType: string): void {
    const inventory = this.world.getComponent(entityId, 'talismanInventory');
    const ability = this.world.getComponent(entityId, 'ability');
    const entityTypeComp = this.world.getComponent(entityId, 'entityType');
    const networkSync = this.world.getComponent(entityId, 'networkSync');
    
    if (!inventory || !ability || !entityTypeComp) return;
    
    // Add talisman to inventory
    if (!inventory.talismans[elementType]) {
      inventory.talismans[elementType] = 0;
    }
    inventory.talismans[elementType]++;
    
    console.log(`[Ability] Added ${elementType} talisman. Count: ${inventory.talismans[elementType]}`);
    
    // Send pickup event
    if (networkSync && this.localCharIds.has(networkSync.networkId) && this.onTalismanPickupCallback) {
      this.onTalismanPickupCallback(networkSync.networkId, elementType);
    }
    
    // Check for auto-upgrade
    this.checkAndUpgrade(entityId);
  }

  /**
   * Check if character can upgrade ability and do so automatically
   */
  public checkAndUpgrade(entityId: string): boolean {
    const inventory = this.world.getComponent(entityId, 'talismanInventory');
    const ability = this.world.getComponent(entityId, 'ability');
    const entityType = this.world.getComponent(entityId, 'entityType');
    const networkSync = this.world.getComponent(entityId, 'networkSync');
    
    if (!inventory || !ability || !entityType?.elementType) return false;
    
    const charElement = entityType.elementType;
    
    // Check if can upgrade with matching element talismans
    if (canUpgradeAbility(ability.level, charElement, inventory.talismans)) {
      const nextLevel = getNextLevel(ability.level);
      
      if (nextLevel) {
        // Consume talismans - ensure the count exists
        const currentCount = inventory.talismans[charElement] ?? 0;
        inventory.talismans[charElement] = currentCount - TALISMAN_CONFIG.requiredForUpgrade;
        
        // Upgrade ability
        ability.level = nextLevel;
        
        console.log(`[Ability] Upgraded to level ${nextLevel}! Remaining ${charElement} talismans: ${inventory.talismans[charElement]}`);
        
        // Send upgrade event
        if (networkSync && this.localCharIds.has(networkSync.networkId) && this.onAbilityUpgradeCallback) {
          this.onAbilityUpgradeCallback(networkSync.networkId, nextLevel);
        }
        
        // Spawn visual upgrade effect (flash of color)
        const transform = this.world.getComponent(entityId, 'transform');
        if (transform) {
          this.spawnUpgradeEffect(transform.position, nextLevel);
        }
        
        return true;
      }
    }
    
    return false;
  }

  /**
   * Spawn visual effect for ability upgrade
   */
  private spawnUpgradeEffect(position: THREE.Vector3, newLevel: AbilityLevel): void {
    // Use entity factory's particle effect for upgrade celebration
    const color = newLevel === 'G' ? 0xaa44ff : 0xff8800; // Purple for G, Orange for P
    this.entityFactory.getParticlePool().spawn(position, 30, {
      color,
      speed: 4,
      life: 1.0,
      scale: 0.5,
      spread: 2,
    });
  }

  /**
   * Handle talisman drop from killed entity
   */
  public handleEntityDeath(deadEntityId: string, killerEntityId: string): void {
    const deadEntityType = this.world.getComponent(deadEntityId, 'entityType');
    
    if (!deadEntityType?.elementType) return;
    
    // Determine drop chance
    const dropChance = deadEntityType.type === 'monster' 
      ? TALISMAN_CONFIG.monsterDropChance 
      : TALISMAN_CONFIG.playerDropChance;
    
    if (Math.random() < dropChance) {
      // Add talisman to killer's inventory
      this.addTalisman(killerEntityId, deadEntityType.elementType);
      
      // Spawn visual pickup effect at death location
      const deadTransform = this.world.getComponent(deadEntityId, 'transform');
      if (deadTransform) {
        const color = this.getElementColor(deadEntityType.elementType as ElementType);
        this.entityFactory.getParticlePool().spawn(deadTransform.position, 15, {
          color,
          speed: 2,
          life: 0.8,
          scale: 0.3,
          spread: 1,
        });
      }
    }
  }

  /**
   * Get color for element type
   */
  private getElementColor(elementType: ElementType): number {
    const colors: Record<ElementType, number> = {
      fire: 0xff4422,
      water: 0x3399ff,
      grass: 0x44cc44,
      electric: 0xffdd00,
      rock: 0x996633,
      psychic: 0xdd66ff,
    };
    return colors[elementType] || 0xffffff;
  }

  /**
   * Handle ability damage from server
   */
  public handleAbilityDamage(data: {
    targetId: string;
    damage: number;
    health: number;
    abilityId: string;
    casterId: string;
    effectiveness?: 'super' | 'weak' | 'normal';
  }): void {
    const targetEntityId = this.world.getEntityByNetworkId(data.targetId);
    if (!targetEntityId) return;
    
    const health = this.world.getComponent(targetEntityId, 'health');
    const transform = this.world.getComponent(targetEntityId, 'transform');
    
    if (health) {
      health.current = data.health;
      health.isDead = health.current <= 0;
    }
    
    if (transform) {
      // Spawn damage effect
      this.entityFactory.spawnDamageEffect(transform.position, data.damage);
      
      // Determine damage color based on type effectiveness
      // Yellow = super effective, Red = not very effective, White = normal
      let damageColor: number | undefined;
      if (data.effectiveness === 'super') {
        damageColor = 0xffff00; // Bright yellow for super effective
      } else if (data.effectiveness === 'weak') {
        damageColor = 0xff6666; // Red/pink for not very effective
      } else {
        damageColor = 0xffffff; // White for normal
      }
      
      this.entityFactory.spawnDamageNumber(transform.position, data.damage, { color: damageColor });
      
      // Play hit animation
      this.animationSystem.playAnimation(targetEntityId, 'hit');
      
      if (health?.isDead) {
        this.animationSystem.playAnimation(targetEntityId, 'death');
        
        // Handle talisman drop
        const casterEntityId = this.world.getEntityByNetworkId(data.casterId);
        if (casterEntityId) {
          this.handleEntityDeath(targetEntityId, casterEntityId);
        }
      }
    }
  }

  /**
   * Handle ability heal from server
   */
  public handleAbilityHeal(data: {
    targetId: string;
    heal: number;
    health: number;
  }): void {
    const targetEntityId = this.world.getEntityByNetworkId(data.targetId);
    if (!targetEntityId) return;
    
    const health = this.world.getComponent(targetEntityId, 'health');
    const transform = this.world.getComponent(targetEntityId, 'transform');
    
    if (health) {
      health.current = data.health;
    }
    
    if (transform) {
      // Spawn heal number (green)
      this.entityFactory.spawnDamageNumber(transform.position, data.heal, 'heal');
      
      // Green healing particles
      this.entityFactory.getParticlePool().spawn(transform.position, 10, {
        color: 0x44ff44,
        speed: 2,
        life: 0.6,
        scale: 0.3,
        spread: 1,
      });
    }
  }

  /**
   * Update ability system
   */
  public update(dt: number): void {
    // Update self-centered abilities (like Leaf Storm) to follow caster FIRST
    // This must happen before the effect pool update so effects use current position
    for (const [casterId, activeAbility] of this.activeAbilities) {
      if (activeAbility.elementType === 'grass') {
        // Update effect position to follow caster
        const transform = this.world.getComponent(casterId, 'transform');
        if (transform && activeAbility.effectId) {
          this.abilityEffectPool.updateEffectCasterPosition(
            activeAbility.effectId,
            transform.position
          );
        }
      }
    }
    
    // Update ability effect pool with current positions
    this.abilityEffectPool.update(dt);
    
    // Check all entities with ability components for mana-ready auto-cast
    for (const entityId of this.world.query('ability', 'mana', 'combat')) {
      const ability = this.world.getComponent(entityId, 'ability');
      const mana = this.world.getComponent(entityId, 'mana');
      const combat = this.world.getComponent(entityId, 'combat');
      
      if (!ability || !mana || !combat) continue;
      
      // Update cast progress
      if (ability.isCasting) {
        const entityType = this.world.getComponent(entityId, 'entityType');
        if (entityType?.elementType) {
          const abilityInfo = ABILITIES[entityType.elementType as keyof typeof ABILITIES];
          if (abilityInfo) {
            ability.castProgress += dt / abilityInfo.castTime;
            if (ability.castProgress >= 1) {
              ability.castProgress = 1;
            }
          }
        }
      }
    }
  }

  /**
   * Initialize ability components for an entity
   */
  public static initializeAbilityComponents(
    world: World,
    entityId: string,
    elementType: ElementType
  ): void {
    const manaConfig = MANA_CONFIG[elementType as keyof typeof MANA_CONFIG];
    const abilityInfo = ABILITIES[elementType as keyof typeof ABILITIES];
    
    // Add mana component
    world.addComponent(entityId, 'mana', {
      current: 0,
      max: manaConfig.maxMana,
      gainPerHit: manaConfig.manaPerHit,
    });
    
    // Add ability component
    world.addComponent(entityId, 'ability', {
      abilityId: abilityInfo.id,
      level: 'M' as AbilityLevel,
      elementType,
      isReady: false,
      isCasting: false,
      castProgress: 0,
    });
    
    // Add talisman inventory
    world.addComponent(entityId, 'talismanInventory', {
      talismans: {},
    });
  }

  /**
   * Get the ability effect pool for external use
   */
  public getAbilityEffectPool(): AbilityEffectPool {
    return this.abilityEffectPool;
  }

  /**
   * Dispose of resources
   */
  public dispose(): void {
    this.abilityEffectPool.dispose();
    this.activeAbilities.clear();
  }
}

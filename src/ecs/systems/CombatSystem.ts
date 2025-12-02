import * as THREE from 'three';
import { World } from '../World';
import { EntityFactory } from '../../entities/EntityFactory';
import { AnimationSystem } from './AnimationSystem';
import { ProjectileData } from '../../rendering/ProjectilePool';
import { AbilitySystem } from './AbilitySystem';

/**
 * Combat System - Handles attacks, damage, and combat interactions
 * 
 * ARCHITECTURE: Server-authoritative damage
 * - Local player: Shows attack animation, chases target, sends attack to server
 * - Server: Validates attack, calculates damage, broadcasts to all
 * - All clients: Receive attack event -> show attacker animation
 * - All clients: Receive damage event -> apply damage, show hit animation, damage numbers
 */
export class CombatSystem {
  private world: World;
  private entityFactory: EntityFactory;
  private animationSystem: AnimationSystem;
  private abilitySystem: AbilitySystem | null = null;

  // Reusable vectors
  private tempDirection = new THREE.Vector3();
  
  // Range threshold for ranged vs melee attacks
  private static readonly RANGED_THRESHOLD = 2.5;
  
  // Track which entities are owned by local player (don't apply local damage to avoid double-damage)
  private localCharIds: Set<string> = new Set();
  
  // Callback to send attack to server
  private onAttackCallback: ((attackerId: string, targetId: string, attackerPos: THREE.Vector3) => void) | null = null;

  constructor(world: World, entityFactory: EntityFactory) {
    this.world = world;
    this.entityFactory = entityFactory;
    this.animationSystem = new AnimationSystem(world);
    
    // Projectile hits are now purely visual - damage comes from server
    this.entityFactory.setProjectileHitCallback((p: ProjectileData) => this.onProjectileHit(p));
  }
  
  /**
   * Set callback for when an attack should be sent to server
   */
  public setAttackCallback(callback: (attackerId: string, targetId: string, attackerPos: THREE.Vector3) => void): void {
    this.onAttackCallback = callback;
  }
  
  /**
   * Register a character as locally owned (to prevent double-damage)
   */
  public registerLocalChar(networkId: string): void {
    this.localCharIds.add(networkId);
  }

  /**
   * Get animation system for external use
   */
  public getAnimationSystem(): AnimationSystem {
    return this.animationSystem;
  }

  /**
   * Set ability system reference for mana gain on hits
   */
  public setAbilitySystem(abilitySystem: AbilitySystem): void {
    this.abilitySystem = abilitySystem;
  }

  /**
   * Handle projectile hit - visual effects only (damage comes from server)
   */
  private onProjectileHit(projectile: ProjectileData): void {
    const targetEntityId = this.world.getEntityByNetworkId(projectile.targetEntityId);
    if (!targetEntityId) return;
    
    const targetTransform = this.world.getComponent(targetEntityId, 'transform');
    if (!targetTransform) return;
    
    // Only spawn impact particles - damage/animation comes from server 'damage' event
    this.entityFactory.spawnDamageEffect(targetTransform.position, projectile.damage);
  }

  /**
   * Start an attack from attacker to target
   */
  public startAttack(attackerId: string, targetId: string): void {
    const combat = this.world.getComponent(attackerId, 'combat');
    const movement = this.world.getComponent(attackerId, 'movement');
    
    if (!combat) {
      console.warn(`[Combat] startAttack: No combat component for attacker ${attackerId}`);
      return;
    }

    console.log(`[Combat] Starting attack: ${attackerId} -> ${targetId}`);
    combat.targetId = targetId;
    combat.isAttacking = true;
    
    // Stop movement when attacking
    if (movement) {
      movement.isMoving = false;
      movement.path = [];
    }
  }

  /**
   * Handle attack events from network - trigger attack animation and projectiles
   */
  public handleNetworkAttack(data: { attackerId: string; targetId: string }): void {
    const attackerEntityId = this.world.getEntityByNetworkId(data.attackerId);
    if (!attackerEntityId) return;
    
    // For remote characters, show attack animation AND spawn projectiles
    // (Local characters already triggered these in updateEntity)
    if (!this.localCharIds.has(data.attackerId)) {
      console.log(`[Combat] Network attack from ${data.attackerId} -> playing attack animation`);
      
      // Get target entity ID for animation direction
      const targetEntityId = this.world.getEntityByNetworkId(data.targetId);
      this.animationSystem.playAnimation(attackerEntityId, 'attacking', targetEntityId || undefined);
      
      // Get components for visual effects
      const attackerTransform = this.world.getComponent(attackerEntityId, 'transform');
      const combat = this.world.getComponent(attackerEntityId, 'combat');
      const entityType = this.world.getComponent(attackerEntityId, 'entityType');
      const targetTransform = targetEntityId ? this.world.getComponent(targetEntityId, 'transform') : null;
      
      if (attackerTransform && targetTransform && combat) {
        // Spawn attack effect (particle trail)
        this.entityFactory.spawnAttackEffect(attackerTransform.position, targetTransform.position);
        
        // Spawn projectile for ranged attackers (fire, water, psychic)
        const isRanged = combat.attackRange > CombatSystem.RANGED_THRESHOLD;
        if (isRanged) {
          const elementType = entityType?.elementType || 'neutral';
          console.log(`[Combat] Spawning projectile for remote ranged attacker: ${data.attackerId}`);
          this.entityFactory.spawnProjectile(
            attackerTransform.position,
            targetTransform.position,
            {
              speed: 12 + combat.attackRange * 2,
              damage: combat.attackDamage,
              attackerId: attackerEntityId,
              targetEntityId: data.targetId,
              elementType,
              arcHeight: 0.5 + combat.attackRange * 0.1,
            }
          );
        }
      }
    }
  }

  /**
   * Handle damage events from network - THIS IS THE AUTHORITATIVE DAMAGE
   */
  public handleDamage(data: { targetId: string; damage: number; health: number; attackerId?: string }): void {
    const targetEntityId = this.world.getEntityByNetworkId(data.targetId);
    if (!targetEntityId) {
      console.warn(`[Combat] Damage target not found: ${data.targetId}`);
      return;
    }

    const health = this.world.getComponent(targetEntityId, 'health');
    const transform = this.world.getComponent(targetEntityId, 'transform');
    
    console.log(`[Combat] Server damage: ${data.damage} to ${data.targetId}, new health: ${data.health}`);
    
    // Grant mana to attacker on successful hit (TFT-style)
    if (data.attackerId && this.abilitySystem) {
      const attackerEntityId = this.world.getEntityByNetworkId(data.attackerId);
      if (attackerEntityId && this.localCharIds.has(data.attackerId)) {
        console.log(`[Combat] Granting mana to attacker: ${data.attackerId}`);
        this.abilitySystem.onAttackHit(attackerEntityId);
      }
    }
    
    // Grant mana to target when taking damage (TFT-style - getting hit gives mana)
    if (this.abilitySystem && this.localCharIds.has(data.targetId)) {
      const targetMana = this.world.getComponent(targetEntityId, 'mana');
      if (targetMana) {
        // Gain half of normal mana when taking damage
        const manaGain = Math.ceil(targetMana.gainPerHit * 0.5);
        targetMana.current = Math.min(targetMana.current + manaGain, targetMana.max);
        console.log(`[Combat] Target gained ${manaGain} mana from being hit: ${targetMana.current}/${targetMana.max}`);
        
        // Check for ability cast
        const ability = this.world.getComponent(targetEntityId, 'ability');
        const combat = this.world.getComponent(targetEntityId, 'combat');
        if (ability && targetMana.current >= targetMana.max && combat?.targetId) {
          ability.isReady = true;
          this.abilitySystem.castAbility(targetEntityId, combat.targetId);
        }
      }
    }
    
    // Trigger attacker animation for remote attackers (so defender sees enemy attack)
    if (data.attackerId && !this.localCharIds.has(data.attackerId)) {
      const attackerEntityId = this.world.getEntityByNetworkId(data.attackerId);
      if (attackerEntityId) {
        console.log(`[Combat] Playing attack animation for remote attacker: ${data.attackerId}`);
        this.animationSystem.playAnimation(attackerEntityId, 'attacking', targetEntityId);
        
        // Spawn attack effect
        const attackerTransform = this.world.getComponent(attackerEntityId, 'transform');
        if (attackerTransform && transform) {
          this.entityFactory.spawnAttackEffect(attackerTransform.position, transform.position);
        }
      }
    }
    
    // Apply authoritative health from server
    if (health) {
      health.current = data.health;
      health.isDead = health.current <= 0;
    }

    // Spawn damage particle effect and damage number
    if (transform) {
      this.entityFactory.spawnDamageEffect(transform.position, data.damage);
      this.entityFactory.spawnDamageNumber(transform.position, data.damage);
      
      // Trigger hit animation
      this.animationSystem.playAnimation(targetEntityId, 'hit');
      
      // Handle death - for monsters, remove immediately
      if (health?.isDead) {
        this.animationSystem.playAnimation(targetEntityId, 'death');
        
        // If this is a monster, mark it for removal
        const entityType = this.world.getComponent(targetEntityId, 'entityType');
        if (entityType?.type === 'monster') {
          console.log(`[Combat] Monster ${data.targetId} died, will be removed by monsterDeath event`);
          // Stop any combat targeting this monster
          const combat = this.world.getComponent(targetEntityId, 'combat');
          if (combat) {
            combat.isAttacking = false;
            combat.targetId = null;
          }
        }
      }
    }
  }

  /**
   * Update combat for all entities
   */
  public update(dt: number): void {
    const now = performance.now();

    let combatEntities = 0;
    for (const entityId of this.world.query('combat', 'transform')) {
      combatEntities++;
      this.updateEntity(entityId, now, dt);
    }
    
    // Log combat entity count once per second
    if (!this.lastLogTime || now - this.lastLogTime > 5000) {
      console.log(`[Combat] Update: ${combatEntities} entities with combat+transform`);
      this.lastLogTime = now;
    }
    
    // Update animation system
    this.animationSystem.update(dt);
  }
  
  private lastLogTime: number = 0;
  private lastChaseLog: number = 0;

  private updateEntity(entityId: string, now: number, _dt: number): void {
    const combat = this.world.getComponent(entityId, 'combat')!;
    const transform = this.world.getComponent(entityId, 'transform')!;
    const entityType = this.world.getComponent(entityId, 'entityType');
    const health = this.world.getComponent(entityId, 'health');
    
    // Skip dead entities
    if (health?.isDead) {
      combat.isAttacking = false;
      combat.targetId = null;
      return;
    }
    
    if (!combat.isAttacking || !combat.targetId) return;

    // Get target entity
    const targetEntityId = this.world.getEntityByNetworkId(combat.targetId);
    if (!targetEntityId) {
      console.warn(`[Combat] Target not found: ${combat.targetId}`);
      combat.isAttacking = false;
      combat.targetId = null;
      return;
    }

    const targetTransform = this.world.getComponent(targetEntityId, 'transform');
    const targetHealth = this.world.getComponent(targetEntityId, 'health');
    
    if (!targetTransform || !targetHealth || targetHealth.isDead) {
      console.log(`[Combat] Target invalid or dead: ${combat.targetId}`);
      combat.isAttacking = false;
      combat.targetId = null;
      return;
    }

    // Check if in range
    const distance = transform.position.distanceTo(targetTransform.position);
    
    if (distance > combat.attackRange) {
      // Move towards target - update target position every frame for moving targets
      const movement = this.world.getComponent(entityId, 'movement');
      if (movement) {
        // Always update target position (in case target is moving)
        movement.targetPosition = targetTransform.position.clone();
        movement.path = [targetTransform.position.clone()];
        movement.pathIndex = 0;
        movement.isMoving = true;
        
        // Only log occasionally to avoid spam
        if (!this.lastChaseLog || now - this.lastChaseLog > 1000) {
          console.log(`[Combat] Chasing target, distance: ${distance.toFixed(1)}, range: ${combat.attackRange}`);
          this.lastChaseLog = now;
        }
      }
      return;
    }
    
    // In range - stop moving and prepare to attack
    const movement = this.world.getComponent(entityId, 'movement');
    if (movement?.isMoving) {
      movement.isMoving = false;
      movement.path = [];
      console.log(`[Combat] In range! Stopping movement, preparing attack`);
    }

    // Face target
    this.tempDirection.copy(targetTransform.position).sub(transform.position);
    this.tempDirection.y = 0;
    if (this.tempDirection.length() > 0.01) {
      const angle = Math.atan2(this.tempDirection.x, this.tempDirection.z);
      transform.rotation.y = angle;
      
      // Update face rotation immediately for visual feedback
      const renderable = this.world.getComponent(entityId, 'renderable');
      if (renderable) {
        const faceGroup = renderable.mesh.getObjectByName('faceGroup');
        if (faceGroup) {
          faceGroup.rotation.y = angle;
        }
      }
    }

    // Check attack cooldown
    const attackInterval = 1000 / combat.attackSpeed;
    if (now - combat.lastAttackTime >= attackInterval) {
      // Perform attack
      combat.lastAttackTime = now;
      
      console.log(`[Combat] Attacking! Range: ${combat.attackRange}, Damage: ${combat.attackDamage}`);
      
      // Trigger attack animation with target for proper direction
      this.animationSystem.playAnimation(entityId, 'attacking', targetEntityId);
      
      // If this is a local character, send attack to server
      const networkSync = this.world.getComponent(entityId, 'networkSync');
      if (networkSync && this.localCharIds.has(networkSync.networkId) && this.onAttackCallback) {
        console.log(`[Combat] Sending attack to server: ${networkSync.networkId} -> ${combat.targetId}`);
        this.onAttackCallback(networkSync.networkId, combat.targetId, transform.position);
        
        // Grant mana on hit for ability system
        if (this.abilitySystem) {
          this.abilitySystem.onAttackHit(entityId);
        }
      }
      
      // Determine if ranged or melee based on attack range
      const isRanged = combat.attackRange > CombatSystem.RANGED_THRESHOLD;
      
      if (isRanged) {
        // Spawn projectile for ranged attack (visual only - damage from server)
        const elementType = entityType?.elementType || 'neutral';
        console.log(`[Combat] Spawning projectile (ranged)`);
        this.entityFactory.spawnProjectile(
          transform.position,
          targetTransform.position,
          {
            speed: 12 + combat.attackRange * 2,
            damage: combat.attackDamage,
            attackerId: entityId,
            targetEntityId: combat.targetId,
            elementType,
            arcHeight: 0.5 + combat.attackRange * 0.1,
          }
        );
      }
      // NOTE: Melee damage is NOT applied locally - server sends 'damage' event
      
      // Spawn attack effect (particle trail for visual feedback)
      this.entityFactory.spawnAttackEffect(transform.position, targetTransform.position);
    }
  }

}

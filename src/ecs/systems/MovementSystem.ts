import * as THREE from 'three';
import { World } from '../World';

// Pathfinder disabled for now - using direct movement
// import { Pathfinder } from '../../pathfinding/Pathfinder';

/**
 * Movement System - Handles pathfinding and movement for all entities
 * 
 * KEY INSIGHT from Valorant/LoL netcode:
 * - Local player: Process input IMMEDIATELY, update mesh DIRECTLY (no interpolation)
 * - Remote players: Handled by NetworkSystem with interpolation buffer
 * 
 * The local player should NEVER feel input delay. Their character responds
 * instantly to clicks while we wait for server confirmation.
 */
export class MovementSystem {
  private world: World;
  // private pathfinder: Pathfinder; // Disabled - using direct movement
  
  // Reusable vectors to avoid allocations
  private tempDirection = new THREE.Vector3();

  constructor(world: World) {
    this.world = world;
    // this.pathfinder = new Pathfinder(); // Disabled - using direct movement
  }

  /**
   * Set a move target for an entity - DIRECT movement (no pathfinding)
   */
  public setMoveTarget(entityId: string, target: THREE.Vector3): void {
    const movement = this.world.getComponent(entityId, 'movement');
    const transform = this.world.getComponent(entityId, 'transform');
    
    if (!movement || !transform) return;

    // DIRECT movement - just go straight to target
    movement.targetPosition = target.clone();
    movement.path = [target.clone()];
    movement.pathIndex = 0;
    movement.isMoving = true;
    
    // No artificial boost needed - movement is already client-authoritative
    // The next update() call will start moving at normal speed
  }

  /**
   * Stop movement for an entity
   */
  public stopMovement(entityId: string): void {
    const movement = this.world.getComponent(entityId, 'movement');
    if (movement) {
      movement.targetPosition = null;
      movement.path = [];
      movement.pathIndex = 0;
      movement.isMoving = false;
    }
  }

  /**
   * Update moving entities
   * Only updates LOCAL player - remote players are interpolated by NetworkSystem
   */
  public update(dt: number): void {
    for (const entityId of this.world.query('transform', 'velocity', 'movement')) {
      const networkSync = this.world.getComponent(entityId, 'networkSync');
      
      // Skip remote players - they use interpolation from NetworkSystem
      if (networkSync && !networkSync.isLocal) {
        continue;
      }
      
      this.updateEntity(entityId, dt);
    }
  }

  /**
   * Update a single entity immediately - used for instant input response
   * This is what makes LoL/WoW feel so responsive
   */
  public updateSingleEntity(entityId: string, dt: number): void {
    this.updateEntity(entityId, dt);
  }

  private updateEntity(entityId: string, dt: number): void {
    const transform = this.world.getComponent(entityId, 'transform')!;
    const velocity = this.world.getComponent(entityId, 'velocity')!;
    const movement = this.world.getComponent(entityId, 'movement')!;
    const renderable = this.world.getComponent(entityId, 'renderable');
    const combat = this.world.getComponent(entityId, 'combat');

    // Don't move if attacking AND in range (chasing is allowed)
    // If isAttacking but movement.isMoving is also true, we're chasing the target
    if (combat?.isAttacking && !movement.isMoving) {
      velocity.velocity.set(0, 0, 0);
      return;
    }

    if (!movement.isMoving || movement.path.length === 0) {
      velocity.velocity.set(0, 0, 0);
      return;
    }

    // Get current target in path
    const currentTarget = movement.path[movement.pathIndex];
    if (!currentTarget) {
      movement.isMoving = false;
      velocity.velocity.set(0, 0, 0);
      return;
    }

    // Calculate direction to target
    this.tempDirection.copy(currentTarget).sub(transform.position);
    this.tempDirection.y = 0;
    
    const distance = this.tempDirection.length();
    
    // Check if we've reached the current waypoint
    const waypointThreshold = 0.5;
    if (distance < waypointThreshold) {
      movement.pathIndex++;
      
      if (movement.pathIndex >= movement.path.length) {
        movement.isMoving = false;
        movement.path = [];
        movement.pathIndex = 0;
        velocity.velocity.set(0, 0, 0);
        return;
      }
    }

    // Move towards target
    if (distance > 0.001) {
      this.tempDirection.normalize();
      velocity.velocity.copy(this.tempDirection).multiplyScalar(velocity.speed);
      
      // Apply velocity to position IMMEDIATELY
      transform.position.add(
        this.tempDirection.clone().multiplyScalar(velocity.speed * dt)
      );
      
      // Update facing direction based on movement
      const angle = Math.atan2(this.tempDirection.x, this.tempDirection.z);
      transform.rotation.y = angle;
      
      // KEY: Update the mesh position IMMEDIATELY for local player
      // This is what makes movement feel responsive like in LoL
      if (renderable) {
        renderable.mesh.position.copy(transform.position);
        
        // Also update face rotation immediately for local player
        const faceGroup = renderable.mesh.getObjectByName('faceGroup');
        if (faceGroup) {
          faceGroup.rotation.y = angle;
        }
      }
    }
  }
}

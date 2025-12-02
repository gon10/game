import * as THREE from 'three';
import { World } from '../World';
import { AnimationState } from '../components';

/**
 * Animation System - Handles simple transform-based animations
 * Uses tweening for attack lunges, hit reactions, and death effects
 * Performant: no skeletal animation, just scale/position/rotation tweens
 */
export class AnimationSystem {
  private world: World;

  // Animation durations (seconds)
  private static readonly DURATIONS: Record<AnimationState, number> = {
    idle: 0,
    walking: 0,
    attacking: 0.3,
    hit: 0.2,
    death: 0.5,
  };

  // Reusable vectors
  private tempScale = new THREE.Vector3();
  
  // Store attack direction per entity (since remote entities may not have rotation set)
  private attackDirections: Map<string, THREE.Vector3> = new Map();

  constructor(world: World) {
    this.world = world;
  }

  /**
   * Trigger an animation on an entity
   * For attack animations, pass targetId to calculate proper direction
   */
  public playAnimation(entityId: string, state: AnimationState, targetId?: string): void {
    const animation = this.world.getComponent(entityId, 'animation');
    const transform = this.world.getComponent(entityId, 'transform');
    
    if (!animation || !transform) {
      console.warn(`[Animation] Cannot play ${state} on ${entityId}: missing components (anim: ${!!animation}, transform: ${!!transform})`);
      return;
    }
    
    // Don't interrupt death animation
    if (animation.state === 'death' && state !== 'death') return;
    
    // Don't interrupt attacking with walking
    if (animation.state === 'attacking' && state === 'walking') return;
    
    console.log(`[Animation] Playing ${state} on entity ${entityId}`);
    
    animation.state = state;
    animation.progress = 0;
    animation.duration = AnimationSystem.DURATIONS[state];
    
    // Store base transforms for tweening
    animation.baseScale.copy(transform.scale);
    animation.basePosition.copy(transform.position);
    
    // For attack animation, calculate direction towards target
    if (state === 'attacking' && targetId) {
      const targetTransform = this.world.getComponent(targetId, 'transform');
      if (targetTransform) {
        const direction = new THREE.Vector3()
          .subVectors(targetTransform.position, transform.position)
          .setY(0)
          .normalize();
        this.attackDirections.set(entityId, direction);
      }
    } else if (state === 'attacking') {
      // Fallback: use entity's current facing direction from rotation
      const forward = new THREE.Vector3(0, 0, 1).applyEuler(transform.rotation);
      this.attackDirections.set(entityId, forward);
    }
  }

  /**
   * Update all entity animations
   */
  public update(dt: number): void {
    for (const entityId of this.world.query('animation', 'transform', 'renderable')) {
      this.updateEntity(entityId, dt);
    }
  }

  private updateEntity(entityId: string, dt: number): void {
    const animation = this.world.getComponent(entityId, 'animation')!;
    const transform = this.world.getComponent(entityId, 'transform')!;
    const renderable = this.world.getComponent(entityId, 'renderable')!;
    
    if (animation.state === 'idle' || animation.state === 'walking') {
      // Reset scale for idle/walking
      transform.scale.set(1, 1, 1);
      return;
    }
    
    // Progress the animation
    if (animation.duration > 0) {
      animation.progress += dt / animation.duration;
      
      if (animation.progress >= 1) {
        // Animation complete
        animation.progress = 1;
        this.onAnimationComplete(entityId, animation.state);
        return;
      }
    }
    
    // Apply animation transforms based on state
    const t = animation.progress;
    
    switch (animation.state) {
      case 'attacking':
        this.applyAttackAnimation(entityId, transform, renderable, t);
        break;
      case 'hit':
        this.applyHitAnimation(transform, renderable, t);
        break;
      case 'death':
        this.applyDeathAnimation(transform, renderable, t);
        break;
    }
  }

  /**
   * Attack animation: quick lunge forward + scale up, then return
   */
  private applyAttackAnimation(
    entityId: string,
    transform: { scale: THREE.Vector3; position: THREE.Vector3; rotation: THREE.Euler },
    renderable: { mesh: THREE.Object3D },
    t: number
  ): void {
    // Scale: bulge up at peak (t=0.3-0.5)
    const scalePeak = t < 0.5 
      ? this.easeOutQuad(t * 2) 
      : this.easeOutQuad((1 - t) * 2);
    const scaleMultiplier = 1 + scalePeak * 0.15;
    
    this.tempScale.set(
      scaleMultiplier,
      1 + scalePeak * 0.1, // Less vertical stretch
      scaleMultiplier
    );
    transform.scale.copy(this.tempScale);
    
    // Forward lunge based on stored attack direction (not rotation)
    const lungeDistance = 0.3 * (1 - Math.abs(t * 2 - 1)); // Peak at t=0.5
    const forward = this.attackDirections.get(entityId) || new THREE.Vector3(0, 0, 1);
    renderable.mesh.position.copy(transform.position).addScaledVector(forward, lungeDistance);
  }

  /**
   * Hit animation: quick squash + red flash
   */
  private applyHitAnimation(
    transform: { scale: THREE.Vector3 },
    renderable: { mesh: THREE.Object3D },
    t: number
  ): void {
    // Squash effect: compress vertically, expand horizontally
    const squashT = 1 - this.easeOutElastic(t);
    
    this.tempScale.set(
      1 + squashT * 0.2, // Wider
      1 - squashT * 0.15, // Shorter
      1 + squashT * 0.2
    );
    transform.scale.copy(this.tempScale);
    
    // Red flash on mesh materials
    if (t < 0.5) {
      this.flashMesh(renderable.mesh, 0xff0000, 1 - t * 2);
    }
  }

  /**
   * Death animation: fall over and shrink
   */
  private applyDeathAnimation(
    transform: { scale: THREE.Vector3; rotation: THREE.Euler },
    renderable: { mesh: THREE.Object3D },
    t: number
  ): void {
    // Fall over (rotate on X axis)
    const fallAngle = this.easeOutQuad(t) * (Math.PI / 2);
    renderable.mesh.rotation.x = fallAngle;
    
    // Shrink
    const shrink = 1 - this.easeInQuad(t) * 0.5;
    this.tempScale.set(shrink, shrink, shrink);
    transform.scale.copy(this.tempScale);
    
    // Fade out
    this.fadeMesh(renderable.mesh, 1 - t);
  }

  /**
   * Handle animation completion
   */
  private onAnimationComplete(entityId: string, state: AnimationState): void {
    const animation = this.world.getComponent(entityId, 'animation');
    const transform = this.world.getComponent(entityId, 'transform');
    const renderable = this.world.getComponent(entityId, 'renderable');
    
    if (!animation || !transform || !renderable) return;
    
    // Reset transforms
    transform.scale.set(1, 1, 1);
    renderable.mesh.position.copy(transform.position);
    
    // Reset material colors
    this.resetMeshMaterials(renderable.mesh);
    
    // Transition to next state
    switch (state) {
      case 'attacking':
        // Clean up stored attack direction
        this.attackDirections.delete(entityId);
        animation.state = 'idle';
        animation.progress = 0;
        break;
      case 'hit':
        animation.state = 'idle';
        animation.progress = 0;
        break;
      case 'death':
        // Stay in death state, entity should be removed
        break;
    }
  }

  /**
   * Flash mesh with color
   */
  private flashMesh(mesh: THREE.Object3D, color: number, intensity: number): void {
    mesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = child.material as THREE.MeshLambertMaterial;
        if (mat.emissive) {
          mat.emissive.setHex(color);
          mat.emissiveIntensity = intensity;
        }
      }
    });
  }

  /**
   * Fade mesh opacity
   */
  private fadeMesh(mesh: THREE.Object3D, opacity: number): void {
    mesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = child.material as THREE.Material;
        mat.transparent = true;
        mat.opacity = opacity;
      }
    });
  }

  /**
   * Reset mesh material properties
   */
  private resetMeshMaterials(mesh: THREE.Object3D): void {
    mesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = child.material as THREE.MeshLambertMaterial;
        if (mat.emissive) {
          mat.emissive.setHex(0x000000);
          mat.emissiveIntensity = 0;
        }
        mat.transparent = false;
        mat.opacity = 1;
      }
    });
  }

  // Easing functions
  private easeOutQuad(t: number): number {
    return 1 - (1 - t) * (1 - t);
  }

  private easeInQuad(t: number): number {
    return t * t;
  }

  private easeOutElastic(t: number): number {
    const c4 = (2 * Math.PI) / 3;
    return t === 0
      ? 0
      : t === 1
      ? 1
      : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  }
}

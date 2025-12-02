import * as THREE from 'three';
import { ObjectPool } from './ObjectPool';

/**
 * Particle Pool - Manages reusable particle effects
 * Uses instanced rendering for maximum performance
 */

interface Particle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  scale: number;
  color: THREE.Color;
}

export class ParticlePool {
  private scene: THREE.Scene;
  
  // Instanced mesh for particles
  private instancedMesh: THREE.InstancedMesh;
  private readonly MAX_PARTICLES = 1000;
  
  // Active particles
  private particles: Particle[] = [];
  private activeCount = 0;
  
  // Particle pool
  private particlePool: ObjectPool<Particle>;
  
  // Reusable objects (cached to avoid GC pressure)
  private tempMatrix = new THREE.Matrix4();
  private tempScale = new THREE.Vector3();
  private tempQuaternion = new THREE.Quaternion();
  private tempVelocity = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    
    // Create shared geometry and material
    const geometry = new THREE.SphereGeometry(0.1, 4, 4);
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
    });
    
    // Create instanced mesh
    this.instancedMesh = new THREE.InstancedMesh(geometry, material, this.MAX_PARTICLES);
    this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instancedMesh.frustumCulled = false;
    this.instancedMesh.count = 0;
    this.scene.add(this.instancedMesh);
    
    // Initialize particle pool
    this.particlePool = new ObjectPool<Particle>(
      () => ({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        scale: 1,
        color: new THREE.Color(1, 1, 1),
      }),
      (p) => {
        p.position.set(0, 0, 0);
        p.velocity.set(0, 0, 0);
        p.life = 0;
        p.scale = 1;
      },
      100,
      this.MAX_PARTICLES
    );
  }

  /**
   * Spawn particles at a position
   */
  public spawn(
    position: THREE.Vector3,
    count: number,
    options: {
      color?: THREE.Color | number;
      speed?: number;
      life?: number;
      scale?: number;
      spread?: number;
    } = {}
  ): void {
    const {
      color = 0xffaa00,
      speed = 5,
      life = 0.5,
      scale = 1,
      spread = 1,
    } = options;

    const particleColor = color instanceof THREE.Color 
      ? color 
      : new THREE.Color(color);

    for (let i = 0; i < count && this.activeCount < this.MAX_PARTICLES; i++) {
      const particle = this.particlePool.acquire();
      
      particle.position.copy(position);
      
      // Random direction with spread
      particle.velocity.set(
        (Math.random() - 0.5) * spread,
        Math.random() * spread * 0.5 + 0.5,
        (Math.random() - 0.5) * spread
      ).normalize().multiplyScalar(speed);
      
      particle.life = life;
      particle.maxLife = life;
      particle.scale = scale;
      particle.color.copy(particleColor);
      
      this.particles.push(particle);
      this.activeCount++;
    }
  }

  /**
   * Spawn damage number effect
   */
  public spawnDamageEffect(position: THREE.Vector3, damage: number): void {
    // Scale particle count based on damage
    const count = Math.min(20, Math.floor(damage / 5) + 5);
    
    this.spawn(position, count, {
      color: 0xff4444,
      speed: 3,
      life: 0.8,
      scale: 0.5 + (damage / 100),
      spread: 2,
    });
  }

  /**
   * Spawn attack effect
   */
  public spawnAttackEffect(from: THREE.Vector3, to: THREE.Vector3): void {
    // Spawn particles along the attack line
    const direction = new THREE.Vector3().subVectors(to, from).normalize();
    const distance = from.distanceTo(to);
    
    for (let d = 0; d < distance; d += 0.5) {
      const pos = from.clone().add(direction.clone().multiplyScalar(d));
      pos.y += 1; // Raise above ground
      
      this.spawn(pos, 2, {
        color: 0xffff00,
        speed: 1,
        life: 0.3,
        scale: 0.3,
        spread: 0.3,
      });
    }
  }

  /**
   * Update all particles
   */
  public update(dt: number): void {
    let writeIndex = 0;
    
    for (let i = 0; i < this.particles.length; i++) {
      const particle = this.particles[i]!;
      
      // Update life
      particle.life -= dt;
      
      if (particle.life <= 0) {
        // Return to pool
        this.particlePool.release(particle);
        this.activeCount--;
        continue;
      }
      
      // Update position (reuse cached vector to avoid allocation)
      this.tempVelocity.copy(particle.velocity).multiplyScalar(dt);
      particle.position.add(this.tempVelocity);
      
      // Apply gravity
      particle.velocity.y -= 9.8 * dt;
      
      // Calculate alpha based on remaining life
      const lifeRatio = particle.life / particle.maxLife;
      
      // Update instance (reuse cached objects)
      this.tempScale.set(
        particle.scale * lifeRatio,
        particle.scale * lifeRatio,
        particle.scale * lifeRatio
      );
      
      this.tempMatrix.compose(
        particle.position,
        this.tempQuaternion,
        this.tempScale
      );
      
      this.instancedMesh.setMatrixAt(writeIndex, this.tempMatrix);
      this.instancedMesh.setColorAt(writeIndex, particle.color);
      
      // Keep particle in array
      this.particles[writeIndex] = particle;
      writeIndex++;
    }
    
    // Trim array
    this.particles.length = writeIndex;
    this.instancedMesh.count = writeIndex;
    
    // Mark for update
    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }
  }

  public dispose(): void {
    this.scene.remove(this.instancedMesh);
    this.instancedMesh.geometry.dispose();
    (this.instancedMesh.material as THREE.Material).dispose();
  }
}

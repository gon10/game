import * as THREE from 'three';
import { ObjectPool } from './ObjectPool';

/**
 * Projectile Pool - Manages pooled projectile meshes for ranged attacks
 * Uses instanced rendering where possible for performance
 */

export interface ProjectileData {
  mesh: THREE.Mesh;
  origin: THREE.Vector3;
  target: THREE.Vector3;
  currentPos: THREE.Vector3;
  speed: number;
  damage: number;
  attackerId: string;
  targetEntityId: string;
  elementType: string;
  progress: number; // 0-1 travel progress
  arcHeight: number;
  active: boolean;
}

type ProjectileHitCallback = (projectile: ProjectileData) => void;

export class ProjectilePool {
  private scene: THREE.Scene;
  private pool: ObjectPool<ProjectileData>;
  private active: ProjectileData[] = [];
  
  // Shared geometries and materials by element type
  private geometries: Map<string, THREE.BufferGeometry> = new Map();
  private materials: Map<string, THREE.MeshBasicMaterial> = new Map();
  
  // Hit callback
  private onHit: ProjectileHitCallback | null = null;
  
  // Reusable vectors
  private tempVec = new THREE.Vector3();
  private tempVec2 = new THREE.Vector3();
  
  // Element colors
  private static readonly ELEMENT_COLORS: Record<string, number> = {
    fire: 0xff6600,
    water: 0x4488ff,
    grass: 0x44ff44,
    electric: 0xffff00,
    rock: 0x886644,
    psychic: 0xff44ff,
    neutral: 0xaaaaaa,
  };

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    
    // Initialize shared geometries
    this.initializeSharedAssets();
    
    // Initialize pool
    this.pool = new ObjectPool<ProjectileData>(
      () => this.createProjectile(),
      (p) => this.resetProjectile(p),
      20, // Initial
      100 // Max
    );
  }

  private initializeSharedAssets(): void {
    // Default sphere geometry for most projectiles
    const sphereGeo = new THREE.SphereGeometry(0.2, 8, 6);
    this.geometries.set('default', sphereGeo);
    
    // Elongated for fast projectiles
    const elongatedGeo = new THREE.CapsuleGeometry(0.1, 0.4, 4, 8);
    this.geometries.set('elongated', elongatedGeo);
    
    // Create materials for each element
    for (const [element, color] of Object.entries(ProjectilePool.ELEMENT_COLORS)) {
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
      });
      // Add emissive glow effect
      this.materials.set(element, mat);
    }
  }

  private createProjectile(): ProjectileData {
    // Create mesh with default geometry/material (will be updated on spawn)
    const mesh = new THREE.Mesh(
      this.geometries.get('default')!,
      this.materials.get('neutral')!
    );
    mesh.visible = false;
    
    return {
      mesh,
      origin: new THREE.Vector3(),
      target: new THREE.Vector3(),
      currentPos: new THREE.Vector3(),
      speed: 15,
      damage: 0,
      attackerId: '',
      targetEntityId: '',
      elementType: 'neutral',
      progress: 0,
      arcHeight: 1,
      active: false,
    };
  }

  private resetProjectile(p: ProjectileData): void {
    p.mesh.visible = false;
    p.active = false;
    p.progress = 0;
    this.scene.remove(p.mesh);
  }

  /**
   * Set callback for when projectile hits target
   */
  public setHitCallback(callback: ProjectileHitCallback): void {
    this.onHit = callback;
  }

  /**
   * Spawn a projectile from origin to target
   */
  public spawn(
    origin: THREE.Vector3,
    target: THREE.Vector3,
    options: {
      speed?: number;
      damage?: number;
      attackerId?: string;
      targetEntityId?: string;
      elementType?: string;
      arcHeight?: number;
    } = {}
  ): void {
    const {
      speed = 15,
      damage = 10,
      attackerId = '',
      targetEntityId = '',
      elementType = 'neutral',
      arcHeight = 1,
    } = options;
    
    const projectile = this.pool.acquire();
    
    // Set data
    projectile.origin.copy(origin);
    projectile.origin.y += 1; // Start from entity center height
    projectile.target.copy(target);
    projectile.target.y += 1; // Aim at entity center
    projectile.currentPos.copy(projectile.origin);
    projectile.speed = speed;
    projectile.damage = damage;
    projectile.attackerId = attackerId;
    projectile.targetEntityId = targetEntityId;
    projectile.elementType = elementType;
    projectile.arcHeight = arcHeight;
    projectile.progress = 0;
    projectile.active = true;
    
    // Update material based on element
    const material = this.materials.get(elementType) || this.materials.get('neutral')!;
    projectile.mesh.material = material;
    
    // Position mesh
    projectile.mesh.position.copy(projectile.origin);
    projectile.mesh.visible = true;
    
    this.scene.add(projectile.mesh);
    this.active.push(projectile);
  }

  /**
   * Update all active projectiles
   */
  public update(dt: number): void {
    let writeIndex = 0;
    
    for (let i = 0; i < this.active.length; i++) {
      const projectile = this.active[i]!;
      
      if (!projectile.active) {
        this.pool.release(projectile);
        continue;
      }
      
      // Calculate travel distance
      const totalDistance = projectile.origin.distanceTo(projectile.target);
      const travelSpeed = projectile.speed / totalDistance;
      
      // Update progress
      projectile.progress += travelSpeed * dt;
      
      if (projectile.progress >= 1) {
        // Hit target
        projectile.mesh.position.copy(projectile.target);
        
        // Trigger hit callback
        if (this.onHit) {
          this.onHit(projectile);
        }
        
        // Deactivate
        this.pool.release(projectile);
        continue;
      }
      
      // Interpolate position with arc
      const t = projectile.progress;
      
      // Linear interpolation for X and Z
      this.tempVec.lerpVectors(projectile.origin, projectile.target, t);
      
      // Parabolic arc for Y (peak at t=0.5)
      const arcOffset = 4 * t * (1 - t) * projectile.arcHeight;
      this.tempVec.y += arcOffset;
      
      projectile.currentPos.copy(this.tempVec);
      projectile.mesh.position.copy(this.tempVec);
      
      // Rotate projectile to face direction of travel
      if (t > 0.01) {
        // Calculate velocity direction for rotation
        const prevT = Math.max(0, t - 0.1);
        this.tempVec2.lerpVectors(projectile.origin, projectile.target, prevT);
        const prevArc = 4 * prevT * (1 - prevT) * projectile.arcHeight;
        this.tempVec2.y += prevArc;
        
        projectile.mesh.lookAt(this.tempVec);
      }
      
      // Scale based on speed (stretch effect)
      const stretchFactor = 1 + projectile.speed * 0.02;
      projectile.mesh.scale.set(1, 1, stretchFactor);
      
      // Keep in array
      this.active[writeIndex] = projectile;
      writeIndex++;
    }
    
    // Trim array
    this.active.length = writeIndex;
  }

  /**
   * Get count of active projectiles
   */
  public get activeCount(): number {
    return this.active.length;
  }

  /**
   * Clear all active projectiles
   */
  public clear(): void {
    for (const projectile of this.active) {
      this.pool.release(projectile);
    }
    this.active.length = 0;
  }

  public dispose(): void {
    this.clear();
    
    // Dispose shared assets
    for (const geo of this.geometries.values()) {
      geo.dispose();
    }
    for (const mat of this.materials.values()) {
      mat.dispose();
    }
    
    this.geometries.clear();
    this.materials.clear();
  }
}

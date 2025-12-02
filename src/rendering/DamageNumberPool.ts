import * as THREE from 'three';
import { ObjectPool } from './ObjectPool';

/**
 * Damage Number Pool - Displays floating damage numbers like LoL
 * Uses pooled THREE.Sprite with canvas-rendered text for performance
 */

interface DamageNumber {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

export class DamageNumberPool {
  private scene: THREE.Scene;
  private pool: ObjectPool<DamageNumber>;
  private active: DamageNumber[] = [];
  
  // Shared canvas for rendering text (reused to avoid allocations)
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  
  // Pre-created textures cache for common damage values
  private textureCache: Map<string, THREE.CanvasTexture> = new Map();
  
  // Reusable vector
  private tempVec = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    
    // Create shared canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width = 128;
    this.canvas.height = 64;
    this.ctx = this.canvas.getContext('2d')!;
    
    // Initialize pool
    this.pool = new ObjectPool<DamageNumber>(
      () => this.createDamageNumber(),
      (dn) => this.resetDamageNumber(dn),
      20, // Initial size
      100 // Max size
    );
  }

  private createDamageNumber(): DamageNumber {
    // Create sprite with placeholder texture
    const spriteMaterial = new THREE.SpriteMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(2, 1, 1);
    sprite.visible = false;
    
    return {
      sprite,
      velocity: new THREE.Vector3(),
      life: 0,
      maxLife: 0.8,
    };
  }

  private resetDamageNumber(dn: DamageNumber): void {
    dn.sprite.visible = false;
    dn.life = 0;
    dn.velocity.set(0, 0, 0);
    this.scene.remove(dn.sprite);
  }

  /**
   * Spawn a floating damage number
   */
  public spawn(
    position: THREE.Vector3,
    damage: number,
    options: {
      isCrit?: boolean;
      isHeal?: boolean;
      color?: number;
    } = {}
  ): void {
    const { isCrit = false, isHeal = false, color } = options;
    
    const dn = this.pool.acquire();
    
    // Position above entity
    dn.sprite.position.copy(position);
    dn.sprite.position.y += 2.5;
    
    // Add random horizontal offset to prevent stacking
    dn.sprite.position.x += (Math.random() - 0.5) * 0.5;
    dn.sprite.position.z += (Math.random() - 0.5) * 0.5;
    
    // Set velocity: float up with slight random drift
    dn.velocity.set(
      (Math.random() - 0.5) * 1,
      2 + Math.random() * 0.5,
      (Math.random() - 0.5) * 1
    );
    
    // Reset life
    dn.life = dn.maxLife;
    
    // Create texture for this damage value
    const texture = this.getOrCreateTexture(damage, isCrit, isHeal, color);
    (dn.sprite.material as THREE.SpriteMaterial).map = texture;
    (dn.sprite.material as THREE.SpriteMaterial).needsUpdate = true;
    
    // Scale based on crit
    const baseScale = isCrit ? 2.5 : 2;
    dn.sprite.scale.set(baseScale, baseScale * 0.5, 1);
    
    dn.sprite.visible = true;
    this.scene.add(dn.sprite);
    this.active.push(dn);
  }

  /**
   * Get or create a cached texture for damage value
   */
  private getOrCreateTexture(
    damage: number,
    isCrit: boolean,
    isHeal: boolean,
    customColor?: number
  ): THREE.CanvasTexture {
    const key = `${damage}-${isCrit}-${isHeal}-${customColor || ''}`;
    
    if (this.textureCache.has(key)) {
      return this.textureCache.get(key)!;
    }
    
    // Determine color
    let fillColor: string;
    if (customColor !== undefined) {
      fillColor = `#${customColor.toString(16).padStart(6, '0')}`;
    } else if (isHeal) {
      fillColor = '#44ff44'; // Green for heals
    } else if (isCrit) {
      fillColor = '#ffffff'; // White for crits
    } else {
      fillColor = '#ffdd44'; // Yellow for normal damage
    }
    
    // Render text to canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Font setup
    const fontSize = isCrit ? 48 : 36;
    this.ctx.font = `bold ${fontSize}px Arial`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    
    // Draw outline
    this.ctx.strokeStyle = '#000000';
    this.ctx.lineWidth = 4;
    this.ctx.strokeText(
      isHeal ? `+${damage}` : `${damage}`,
      this.canvas.width / 2,
      this.canvas.height / 2
    );
    
    // Draw fill
    this.ctx.fillStyle = fillColor;
    this.ctx.fillText(
      isHeal ? `+${damage}` : `${damage}`,
      this.canvas.width / 2,
      this.canvas.height / 2
    );
    
    // Add "CRIT!" text for critical hits
    if (isCrit) {
      this.ctx.font = 'bold 16px Arial';
      this.ctx.fillStyle = '#ff4444';
      this.ctx.strokeText('CRIT!', this.canvas.width / 2, 12);
      this.ctx.fillText('CRIT!', this.canvas.width / 2, 12);
    }
    
    // Create texture
    const texture = new THREE.CanvasTexture(this.canvas);
    texture.needsUpdate = true;
    
    // Cache for reuse (limit cache size)
    if (this.textureCache.size < 50) {
      this.textureCache.set(key, texture);
    }
    
    return texture;
  }

  /**
   * Update all active damage numbers
   */
  public update(dt: number): void {
    let writeIndex = 0;
    
    for (let i = 0; i < this.active.length; i++) {
      const dn = this.active[i]!;
      
      // Update life
      dn.life -= dt;
      
      if (dn.life <= 0) {
        // Return to pool
        this.pool.release(dn);
        continue;
      }
      
      // Update position
      this.tempVec.copy(dn.velocity).multiplyScalar(dt);
      dn.sprite.position.add(this.tempVec);
      
      // Apply drag to velocity
      dn.velocity.multiplyScalar(0.95);
      
      // Fade out based on remaining life
      const lifeRatio = dn.life / dn.maxLife;
      (dn.sprite.material as THREE.SpriteMaterial).opacity = lifeRatio;
      
      // Scale up slightly as it fades
      dn.sprite.scale.multiplyScalar(1 + dt * 0.5);
      
      // Keep in array
      this.active[writeIndex] = dn;
      writeIndex++;
    }
    
    // Trim array
    this.active.length = writeIndex;
  }

  /**
   * Clear all active damage numbers
   */
  public clear(): void {
    for (const dn of this.active) {
      this.pool.release(dn);
    }
    this.active.length = 0;
  }

  public dispose(): void {
    this.clear();
    
    // Dispose cached textures
    for (const texture of this.textureCache.values()) {
      texture.dispose();
    }
    this.textureCache.clear();
  }
}

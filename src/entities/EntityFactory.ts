import * as THREE from 'three';
import { World } from '../ecs/World';
import { ObjectPool } from '../rendering/ObjectPool';
import { ParticlePool } from '../rendering/ParticlePool';
import { DamageNumberPool } from '../rendering/DamageNumberPool';
import { ProjectilePool, ProjectileData } from '../rendering/ProjectilePool';
import { ElementType, CHARACTER_TYPES } from '../types/CharacterTypes';
import { MANA_CONFIG, ABILITIES, COMBAT_CLASSES } from '../types/AbilityTypes';
import { AbilityLevel } from '../ecs/components';
import { MonsterShape, MonsterBodyParts } from '../types/MonsterTypes';

/**
 * Element colors for jelly characters
 */
const ELEMENT_COLORS: Record<ElementType, { main: number; glow: number; eye: number }> = {
  fire: { main: 0xff6633, glow: 0xff4400, eye: 0xffff00 },
  water: { main: 0x44aaff, glow: 0x2288ff, eye: 0xaaddff },
  grass: { main: 0x55dd55, glow: 0x33bb33, eye: 0xccffcc },
  electric: { main: 0xffee44, glow: 0xffdd00, eye: 0xffffff },
  rock: { main: 0xaa8866, glow: 0x886644, eye: 0xffddaa },
  psychic: { main: 0xdd77ff, glow: 0xbb44ee, eye: 0xffccff },
};

/**
 * Shared materials and geometries for all entities
 * Reusing these prevents GPU memory issues and reduces draw calls
 */
class SharedAssets {
  // Jelly body geometry - cute blob shape
  public jellyBody: THREE.BufferGeometry;
  
  // Monster geometries by shape type
  public monsterGeometries: Map<string, THREE.BufferGeometry> = new Map();
  
  // Materials cache by element type
  public elementMaterials: Map<string, THREE.MeshLambertMaterial> = new Map();
  public monsterMaterial: THREE.MeshLambertMaterial;
  
  // Selection ring geometry
  public selectionRingGeometry: THREE.RingGeometry;
  
  constructor() {
    // Jelly body - cute rounded blob (sphere stretched slightly)
    this.jellyBody = new THREE.SphereGeometry(0.6, 16, 12);
    
    // Create monster geometries for each shape type
    this.monsterGeometries.set('sphere', new THREE.SphereGeometry(1, 16, 12));
    this.monsterGeometries.set('box', new THREE.BoxGeometry(1.8, 2, 1.4));
    this.monsterGeometries.set('cylinder', new THREE.CylinderGeometry(0.8, 1, 2.2, 12));
    this.monsterGeometries.set('cone', new THREE.ConeGeometry(1, 2.2, 12));
    this.monsterGeometries.set('ellipsoid', new THREE.SphereGeometry(1, 12, 8).scale(1.2, 0.8, 1));
    this.monsterGeometries.set('spike', this.createSpikeGeometry());
    
    // Create materials for each element type
    for (const [elementType, colors] of Object.entries(ELEMENT_COLORS)) {
      const material = new THREE.MeshLambertMaterial({ 
        color: colors.main,
        emissive: colors.glow,
        emissiveIntensity: 0.15,
      });
      this.elementMaterials.set(elementType, material);
    }
    
    // Default material
    this.elementMaterials.set('default', new THREE.MeshLambertMaterial({ color: 0x888888 }));
    
    // Monster material (red buff style - will be overridden per monster)
    this.monsterMaterial = new THREE.MeshLambertMaterial({ color: 0xcc2222 });
    
    // Selection ring
    this.selectionRingGeometry = new THREE.RingGeometry(0.8, 1.0, 32);
  }
  
  /**
   * Create a spike/demon geometry
   */
  private createSpikeGeometry(): THREE.BufferGeometry {
    // Main body - octahedron (demon/spike shape)
    const body = new THREE.OctahedronGeometry(1.2);
    return body;
  }
  
  public dispose(): void {
    this.jellyBody.dispose();
    for (const geom of this.monsterGeometries.values()) {
      geom.dispose();
    }
    this.selectionRingGeometry.dispose();
    
    for (const material of this.elementMaterials.values()) {
      material.dispose();
    }
    this.monsterMaterial.dispose();
  }
}

/**
 * Entity Factory - Creates and manages pooled game entities
 */
export class EntityFactory {
  private scene: THREE.Scene;
  private world: World;
  private assets: SharedAssets;
  
  // Object pools for entity meshes
  private championPool: ObjectPool<THREE.Group>;
  private monsterPool: ObjectPool<THREE.Group>;
  
  // Particle system
  private particlePool: ParticlePool;
  
  // Damage numbers
  private damageNumberPool: DamageNumberPool;
  
  // Projectiles
  private projectilePool: ProjectilePool;
  
  // Projectile hit callback
  private onProjectileHit: ((projectile: ProjectileData) => void) | null = null;
  
  constructor(scene: THREE.Scene, world: World) {
    this.scene = scene;
    this.world = world;
    this.assets = new SharedAssets();
    
    // Initialize particle pool
    this.particlePool = new ParticlePool(scene);
    
    // Initialize damage number pool
    this.damageNumberPool = new DamageNumberPool(scene);
    
    // Initialize projectile pool
    this.projectilePool = new ProjectilePool(scene);
    this.projectilePool.setHitCallback((p) => this.handleProjectileHit(p));
    
    // Initialize champion pool
    this.championPool = new ObjectPool<THREE.Group>(
      () => this.createChampionMesh(),
      (mesh) => {
        mesh.visible = false;
        mesh.position.set(0, 0, 0);
      },
      10,
      50
    );
    
    // Initialize monster pool with default box monsters (will be customized when acquired)
    this.monsterPool = new ObjectPool<THREE.Group>(
      () => this.createMonsterMesh('box', 0xcc2222, 0xaa0000, 1),
      (mesh) => {
        mesh.visible = false;
        mesh.position.set(0, 0, 0);
      },
      20, // Increased initial size for more monsters
      100  // Increased max for multiple zones
    );
  }

  /**
   * Set callback for projectile hits
   */
  public setProjectileHitCallback(callback: (projectile: ProjectileData) => void): void {
    this.onProjectileHit = callback;
  }

  private handleProjectileHit(projectile: ProjectileData): void {
    // Spawn impact particles
    this.particlePool.spawnDamageEffect(projectile.currentPos, projectile.damage);
    
    // Forward to external callback
    if (this.onProjectileHit) {
      this.onProjectileHit(projectile);
    }
  }

  private createChampionMesh(): THREE.Group {
    const group = new THREE.Group();
    
    // Base scale multiplier for champion visibility
    const baseScale = 1.5;
    
    // Face group - contains body, eyes, blush - rotates together
    const faceGroup = new THREE.Group();
    faceGroup.name = 'faceGroup';
    // Initial rotation: face towards camera (isometric view looks from +X, +Z direction)
    faceGroup.rotation.y = Math.PI; // Face towards -Z (towards camera)
    group.add(faceGroup);
    
    // Jelly body - cute blob shape (scaled up)
    const body = new THREE.Mesh(
      this.assets.jellyBody,
      this.assets.elementMaterials.get('default')!.clone() // Clone so each entity can have different color
    );
    body.position.y = 0.6 * baseScale;
    body.scale.set(baseScale, 0.85 * baseScale, baseScale); // Scaled up, slightly squished for cute blob look
    body.name = 'body';
    faceGroup.add(body);
    
    // Cute eyes (two small spheres) - scaled up
    const eyeGeometry = new THREE.SphereGeometry(0.12 * baseScale, 8, 6);
    const eyeWhiteMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const eyePupilMaterial = new THREE.MeshBasicMaterial({ color: 0x222222 });
    
    // Left eye white
    const leftEyeWhite = new THREE.Mesh(eyeGeometry, eyeWhiteMaterial);
    leftEyeWhite.position.set(-0.2 * baseScale, 0.75 * baseScale, 0.45 * baseScale);
    leftEyeWhite.name = 'leftEyeWhite';
    faceGroup.add(leftEyeWhite);
    
    // Left eye pupil
    const leftPupil = new THREE.Mesh(new THREE.SphereGeometry(0.06 * baseScale, 6, 4), eyePupilMaterial);
    leftPupil.position.set(-0.2 * baseScale, 0.75 * baseScale, 0.55 * baseScale);
    leftPupil.name = 'leftPupil';
    faceGroup.add(leftPupil);
    
    // Right eye white
    const rightEyeWhite = new THREE.Mesh(eyeGeometry, eyeWhiteMaterial);
    rightEyeWhite.position.set(0.2 * baseScale, 0.75 * baseScale, 0.45 * baseScale);
    rightEyeWhite.name = 'rightEyeWhite';
    faceGroup.add(rightEyeWhite);
    
    // Right eye pupil
    const rightPupil = new THREE.Mesh(new THREE.SphereGeometry(0.06 * baseScale, 6, 4), eyePupilMaterial);
    rightPupil.position.set(0.2 * baseScale, 0.75 * baseScale, 0.55 * baseScale);
    rightPupil.name = 'rightPupil';
    faceGroup.add(rightPupil);
    
    // Cute blush marks (small pink circles on cheeks) - scaled up
    const blushGeometry = new THREE.CircleGeometry(0.08 * baseScale, 8);
    const blushMaterial = new THREE.MeshBasicMaterial({ color: 0xff9999, transparent: true, opacity: 0.6 });
    
    const leftBlush = new THREE.Mesh(blushGeometry, blushMaterial);
    leftBlush.position.set(-0.35 * baseScale, 0.55 * baseScale, 0.5 * baseScale);
    leftBlush.rotation.y = -0.3;
    faceGroup.add(leftBlush);
    
    const rightBlush = new THREE.Mesh(blushGeometry, blushMaterial);
    rightBlush.position.set(0.35 * baseScale, 0.55 * baseScale, 0.5 * baseScale);
    rightBlush.rotation.y = 0.3;
    faceGroup.add(rightBlush);
    
    // Selection ring (hidden by default) - stays flat, not part of faceGroup - scaled up
    const selectionRing = new THREE.Mesh(
      this.assets.selectionRingGeometry,
      new THREE.MeshBasicMaterial({ 
        color: 0x00ff00, 
        transparent: true, 
        opacity: 0.8,
        side: THREE.DoubleSide 
      })
    );
    selectionRing.rotation.x = -Math.PI / 2; // Lay flat
    selectionRing.position.y = 0.05;
    selectionRing.scale.setScalar(baseScale);
    selectionRing.name = 'selectionRing';
    selectionRing.visible = false;
    group.add(selectionRing);
    
    // LoL-style Health bar using Canvas (auto-billboard sprite) - not part of faceGroup - larger
    const healthBarSprite = this.createLoLHealthBar(160, 20);
    healthBarSprite.position.y = 2.0 * baseScale;
    healthBarSprite.scale.set(1.8, 0.22, 1);
    healthBarSprite.name = 'healthBarSprite';
    healthBarSprite.renderOrder = 1000;
    group.add(healthBarSprite);
    
    // Level indicator above health bar (like LoL) - larger and more visible
    const levelSprite = this.createLevelIndicator(1);
    levelSprite.position.y = 2.5 * baseScale;
    levelSprite.scale.set(1.2, 0.6, 1); // Larger scale
    levelSprite.name = 'levelIndicator';
    levelSprite.renderOrder = 1001;
    group.add(levelSprite);
    
    // Store base scale for reference
    group.userData.baseScale = baseScale;
    
    return group;
  }
  
  /**
   * Create a LoL-style health bar sprite with border and gradient
   */
  private createLoLHealthBar(width = 128, height = 16): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    
    // Draw black border/background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    
    // Draw dark inner background
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(2, 2, width - 4, height - 4);
    
    // Draw health gradient (green to yellow-green)
    const gradient = ctx.createLinearGradient(0, 2, 0, height - 2);
    gradient.addColorStop(0, '#66ff66');
    gradient.addColorStop(0.5, '#44dd44');
    gradient.addColorStop(1, '#22aa22');
    ctx.fillStyle = gradient;
    ctx.fillRect(3, 3, width - 6, height - 6);
    
    // Draw shine/highlight at top
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fillRect(3, 3, width - 6, (height - 6) / 3);
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    
    const material = new THREE.SpriteMaterial({ 
      map: texture, 
      depthTest: false,
      transparent: true,
    });
    
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(1.4, 0.18, 1);
    
    // Store canvas reference for updates
    sprite.userData.canvas = canvas;
    sprite.userData.ctx = ctx;
    sprite.userData.texture = texture;
    sprite.userData.width = width;
    sprite.userData.height = height;
    
    return sprite;
  }
  
  /**
   * Update health bar sprite with current health percentage
   */
  public updateHealthBar(sprite: THREE.Sprite, healthPercent: number, isEnemy: boolean = false): void {
    const { canvas, ctx, texture, width, height } = sprite.userData;
    if (!canvas || !ctx || !texture) return;
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Draw black border/background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    
    // Draw dark inner background (empty health)
    ctx.fillStyle = '#331111';
    ctx.fillRect(2, 2, width - 4, height - 4);
    
    // Calculate fill width
    const fillWidth = Math.max(0, (width - 6) * healthPercent);
    
    if (fillWidth > 0) {
      // Draw health gradient based on enemy/ally
      const gradient = ctx.createLinearGradient(0, 2, 0, height - 2);
      if (isEnemy) {
        // Red gradient for enemies
        gradient.addColorStop(0, '#ff6666');
        gradient.addColorStop(0.5, '#dd3333');
        gradient.addColorStop(1, '#aa1111');
      } else {
        // Green gradient for allies/self
        gradient.addColorStop(0, '#66ff66');
        gradient.addColorStop(0.5, '#44dd44');
        gradient.addColorStop(1, '#22aa22');
      }
      ctx.fillStyle = gradient;
      ctx.fillRect(3, 3, fillWidth, height - 6);
      
      // Draw shine/highlight at top
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.fillRect(3, 3, fillWidth, (height - 6) / 3);
    }
    
    // Draw thin border segments (LoL-style tick marks)
    ctx.fillStyle = '#444444';
    const segmentCount = 4;
    for (let i = 1; i < segmentCount; i++) {
      const x = 3 + ((width - 6) / segmentCount) * i;
      ctx.fillRect(x, 3, 1, height - 6);
    }
    
    texture.needsUpdate = true;
  }

  private createMonsterMesh(
    shape: MonsterShape = 'box',
    color: number = 0xcc2222,
    glowColor: number = 0xaa0000,
    scale: number = 1,
    bodyParts?: MonsterBodyParts
  ): THREE.Group {
    const group = new THREE.Group();
    
    // Base scale multiplier for monster visibility (minimum 1.5x)
    const baseScale = Math.max(1.5, scale * 1.5);
    
    // Get geometry based on shape type
    const geometry = this.assets.monsterGeometries.get(shape) || this.assets.monsterGeometries.get('box')!;
    
    // Create material with monster color
    const material = new THREE.MeshLambertMaterial({
      color: color,
      emissive: glowColor,
      emissiveIntensity: 0.2,
    });
    
    // Main body - scaled up for better visibility
    const body = new THREE.Mesh(geometry.clone(), material);
    body.position.y = 1.25 * baseScale;
    body.scale.setScalar(baseScale);
    body.name = 'body';
    group.add(body);
    
    // Add body parts based on configuration
    if (bodyParts) {
      this.addMonsterBodyParts(group, bodyParts, material, baseScale, color, glowColor);
    }
    
    // Eyes (glowing effect) - scaled up
    const eyeGeometry = new THREE.SphereGeometry(0.15 * baseScale, 6, 4);
    const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    
    const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    leftEye.position.set(-0.35 * baseScale, 1.7 * baseScale, 0.6 * baseScale);
    leftEye.name = 'leftEye';
    group.add(leftEye);
    
    const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    rightEye.position.set(0.35 * baseScale, 1.7 * baseScale, 0.6 * baseScale);
    rightEye.name = 'rightEye';
    group.add(rightEye);
    
    // LoL-style Health bar (larger for monsters)
    const healthBarSprite = this.createLoLHealthBar(192, 24);
    healthBarSprite.position.y = 3.2 * baseScale;
    healthBarSprite.scale.set(2.2 * baseScale, 0.28 * baseScale, 1);
    healthBarSprite.name = 'healthBarSprite';
    healthBarSprite.renderOrder = 1000;
    group.add(healthBarSprite);
    
    // Monster type/level indicator (larger and shows both name and level)
    const monsterInfoSprite = this.createMonsterInfoIndicator(1, 'Monster');
    monsterInfoSprite.position.y = 3.8 * baseScale;
    monsterInfoSprite.name = 'levelIndicator'; // Keep same name for compatibility
    monsterInfoSprite.renderOrder = 1001;
    group.add(monsterInfoSprite);
    
    // Store monster info in userData for later updates
    group.userData.monsterColor = color;
    group.userData.monsterGlowColor = glowColor;
    group.userData.monsterScale = scale;
    group.userData.monsterShape = shape;
    group.userData.baseScale = baseScale;
    
    return group;
  }

  /**
   * Add body parts to monster mesh based on configuration
   */
  private addMonsterBodyParts(
    group: THREE.Group,
    parts: MonsterBodyParts,
    baseMaterial: THREE.MeshLambertMaterial,
    baseScale: number,
    _color: number,
    glowColor: number
  ): void {
    const darkMaterial = new THREE.MeshLambertMaterial({
      color: glowColor,
      emissive: glowColor,
      emissiveIntensity: 0.1,
    });
    
    // Legs
    if (parts.hasLegs && parts.legCount) {
      const legGeometry = new THREE.CylinderGeometry(0.1 * baseScale, 0.15 * baseScale, 0.8 * baseScale, 8);
      
      if (parts.legCount === 4) {
        // Quadruped legs (wolf, bear)
        const legPositions = [
          { x: -0.4, z: 0.3 },  // Front left
          { x: 0.4, z: 0.3 },   // Front right
          { x: -0.4, z: -0.3 }, // Back left
          { x: 0.4, z: -0.3 },  // Back right
        ];
        for (const pos of legPositions) {
          const leg = new THREE.Mesh(legGeometry, darkMaterial);
          leg.position.set(pos.x * baseScale, 0.4 * baseScale, pos.z * baseScale);
          group.add(leg);
        }
      } else if (parts.legCount === 2) {
        // Bipedal legs (archer, humanoid)
        const leg1 = new THREE.Mesh(legGeometry, darkMaterial);
        leg1.position.set(-0.25 * baseScale, 0.4 * baseScale, 0);
        group.add(leg1);
        
        const leg2 = new THREE.Mesh(legGeometry, darkMaterial);
        leg2.position.set(0.25 * baseScale, 0.4 * baseScale, 0);
        group.add(leg2);
      }
    }
    
    // Tail
    if (parts.hasTail) {
      const tailGeometry = new THREE.ConeGeometry(0.12 * baseScale, 0.6 * baseScale, 8);
      const tail = new THREE.Mesh(tailGeometry, darkMaterial);
      tail.position.set(0, 1.0 * baseScale, -0.7 * baseScale);
      tail.rotation.x = Math.PI / 3;
      group.add(tail);
    }
    
    // Horns
    if (parts.hasHorns) {
      const hornGeometry = new THREE.ConeGeometry(0.08 * baseScale, 0.5 * baseScale, 6);
      const hornMaterial = new THREE.MeshLambertMaterial({
        color: 0x444444,
        emissive: 0x222222,
        emissiveIntensity: 0.1,
      });
      
      const leftHorn = new THREE.Mesh(hornGeometry, hornMaterial);
      leftHorn.position.set(-0.3 * baseScale, 2.2 * baseScale, 0.1 * baseScale);
      leftHorn.rotation.z = -0.3;
      leftHorn.rotation.x = -0.2;
      group.add(leftHorn);
      
      const rightHorn = new THREE.Mesh(hornGeometry, hornMaterial);
      rightHorn.position.set(0.3 * baseScale, 2.2 * baseScale, 0.1 * baseScale);
      rightHorn.rotation.z = 0.3;
      rightHorn.rotation.x = -0.2;
      group.add(rightHorn);
    }
    
    // Wings
    if (parts.hasWings) {
      const wingGeometry = new THREE.PlaneGeometry(0.8 * baseScale, 0.6 * baseScale);
      const wingMaterial = new THREE.MeshLambertMaterial({
        color: 0x330022,
        emissive: 0x110011,
        emissiveIntensity: 0.2,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8,
      });
      
      const leftWing = new THREE.Mesh(wingGeometry, wingMaterial);
      leftWing.position.set(-0.6 * baseScale, 1.5 * baseScale, -0.2 * baseScale);
      leftWing.rotation.y = -0.5;
      leftWing.rotation.z = 0.3;
      group.add(leftWing);
      
      const rightWing = new THREE.Mesh(wingGeometry, wingMaterial);
      rightWing.position.set(0.6 * baseScale, 1.5 * baseScale, -0.2 * baseScale);
      rightWing.rotation.y = 0.5;
      rightWing.rotation.z = -0.3;
      group.add(rightWing);
    }
    
    // Arms
    if (parts.hasArms) {
      let armGeometry: THREE.BufferGeometry;
      
      switch (parts.armStyle) {
        case 'thick':
          armGeometry = new THREE.CylinderGeometry(0.15 * baseScale, 0.2 * baseScale, 0.7 * baseScale, 8);
          break;
        case 'tentacle':
          armGeometry = new THREE.ConeGeometry(0.15 * baseScale, 0.8 * baseScale, 8);
          break;
        default: // thin
          armGeometry = new THREE.CylinderGeometry(0.08 * baseScale, 0.1 * baseScale, 0.6 * baseScale, 8);
      }
      
      const leftArm = new THREE.Mesh(armGeometry, baseMaterial);
      leftArm.position.set(-0.6 * baseScale, 1.3 * baseScale, 0.2 * baseScale);
      leftArm.rotation.z = 0.5;
      leftArm.rotation.x = 0.3;
      group.add(leftArm);
      
      const rightArm = new THREE.Mesh(armGeometry, baseMaterial);
      rightArm.position.set(0.6 * baseScale, 1.3 * baseScale, 0.2 * baseScale);
      rightArm.rotation.z = -0.5;
      rightArm.rotation.x = 0.3;
      group.add(rightArm);
    }
    
    // Spikes
    if (parts.hasSpikes && parts.spikeCount) {
      const spikeGeometry = new THREE.ConeGeometry(0.06 * baseScale, 0.4 * baseScale, 6);
      const spikeMaterial = new THREE.MeshLambertMaterial({
        color: 0x222222,
        emissive: 0x111111,
        emissiveIntensity: 0.1,
      });
      
      for (let i = 0; i < parts.spikeCount; i++) {
        const angle = (Math.PI * 2 / parts.spikeCount) * i;
        const spike = new THREE.Mesh(spikeGeometry, spikeMaterial);
        spike.position.set(
          Math.cos(angle) * 0.4 * baseScale,
          2.0 * baseScale,
          Math.sin(angle) * 0.4 * baseScale
        );
        spike.rotation.x = -0.3;
        spike.rotation.z = Math.cos(angle) * 0.3;
        group.add(spike);
      }
    }
  }

  /**
   * Create a level indicator sprite
   */
  private createLevelIndicator(level: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 48;
    const ctx = canvas.getContext('2d')!;
    
    // Draw semi-transparent background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.beginPath();
    ctx.roundRect(8, 8, 112, 32, 8);
    ctx.fill();
    
    // Draw level text (larger)
    ctx.fillStyle = '#ffdd44';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText(`Lv.${level}`, 64, 24);
    ctx.fillText(`Lv.${level}`, 64, 24);
    
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ 
      map: texture, 
      transparent: true,
      depthTest: false,
    });
    
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(1.4, 0.52, 1);
    
    sprite.userData.canvas = canvas;
    sprite.userData.ctx = ctx;
    sprite.userData.texture = texture;
    
    return sprite;
  }

  /**
   * Create a monster info indicator sprite (shows name AND level)
   */
  private createMonsterInfoIndicator(level: number, name: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    
    // Draw semi-transparent background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.beginPath();
    ctx.roundRect(8, 8, 240, 48, 10);
    ctx.fill();
    
    // Draw monster name (top line)
    ctx.fillStyle = '#ff8844';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText(name, 128, 22);
    ctx.fillText(name, 128, 22);
    
    // Draw level (bottom line)
    ctx.fillStyle = '#ffdd44';
    ctx.font = 'bold 16px Arial';
    ctx.strokeText(`Level ${level}`, 128, 42);
    ctx.fillText(`Level ${level}`, 128, 42);
    
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ 
      map: texture, 
      transparent: true,
      depthTest: false,
    });
    
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(3.2, 0.8, 1); // Wide and tall for name + level
    
    sprite.userData.canvas = canvas;
    sprite.userData.ctx = ctx;
    sprite.userData.texture = texture;
    sprite.userData.monsterName = name;
    sprite.userData.monsterLevel = level;
    
    return sprite;
  }

  /**
   * Update level indicator sprite
   */
  public updateLevelIndicator(sprite: THREE.Sprite, level: number): void {
    const { canvas, ctx, texture } = sprite.userData;
    if (!canvas || !ctx || !texture) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw semi-transparent background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.beginPath();
    ctx.roundRect(8, 8, 112, 32, 8);
    ctx.fill();
    
    // Draw level text
    ctx.fillStyle = '#ffdd44';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText(`Lv.${level}`, 64, 24);
    ctx.fillText(`Lv.${level}`, 64, 24);
    
    texture.needsUpdate = true;
  }

  /**
   * Update monster info indicator sprite (name AND level)
   */
  public updateMonsterInfoIndicator(sprite: THREE.Sprite, level: number, name?: string): void {
    const { canvas, ctx, texture, monsterName } = sprite.userData;
    if (!canvas || !ctx || !texture) return;
    
    const displayName = name || monsterName || 'Monster';
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw semi-transparent background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.beginPath();
    ctx.roundRect(8, 8, 240, 48, 10);
    ctx.fill();
    
    // Draw monster name (top line)
    ctx.fillStyle = '#ff8844';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText(displayName, 128, 22);
    ctx.fillText(displayName, 128, 22);
    
    // Draw level (bottom line)
    ctx.fillStyle = '#ffdd44';
    ctx.font = 'bold 16px Arial';
    ctx.strokeText(`Level ${level}`, 128, 42);
    ctx.fillText(`Level ${level}`, 128, 42);
    
    sprite.userData.monsterName = displayName;
    sprite.userData.monsterLevel = level;
    texture.needsUpdate = true;
  }

  /**
   * Create a champion entity with all components
   */
  public createChampion(
    networkId: string,
    position: THREE.Vector3,
    isLocal: boolean,
    team: number = 1,
    elementType?: string
  ): string {
    const entityId = this.world.createEntity(networkId);
    
    // Get element info
    const element = (elementType || 'fire') as ElementType;
    const charTypeInfo = CHARACTER_TYPES[element];
    const manaConfig = MANA_CONFIG[element];
    const abilityInfo = ABILITIES[element];
    const combatClass = COMBAT_CLASSES[element];
    
    // Get mesh from pool
    const mesh = this.championPool.acquire();
    mesh.visible = true;
    mesh.position.copy(position);
    
    // Update material based on element type (Pokemon-style colors)
    const elementColors = ELEMENT_COLORS[element] || ELEMENT_COLORS.fire;
    const body = mesh.getObjectByName('body') as THREE.Mesh;
    
    if (body && body.material instanceof THREE.MeshLambertMaterial) {
      body.material.color.setHex(elementColors.main);
      body.material.emissive.setHex(elementColors.glow);
      body.material.emissiveIntensity = 0.15;
    }
    
    this.scene.add(mesh);
    
    // Add components
    this.world.addComponent(entityId, 'transform', {
      position: position.clone(),
      rotation: new THREE.Euler(),
      scale: new THREE.Vector3(1, 1, 1),
      prevPosition: position.clone(),
    });
    
    this.world.addComponent(entityId, 'velocity', {
      velocity: new THREE.Vector3(),
      speed: charTypeInfo.stats.moveSpeed,
      maxSpeed: charTypeInfo.stats.moveSpeed * 1.5,
    });
    
    this.world.addComponent(entityId, 'health', {
      current: charTypeInfo.stats.health,
      max: charTypeInfo.stats.health,
      isDead: false,
    });
    
    this.world.addComponent(entityId, 'movement', {
      targetPosition: null,
      path: [],
      pathIndex: 0,
      isMoving: false,
    });
    
    this.world.addComponent(entityId, 'renderable', {
      mesh,
      visible: true,
    });
    
    this.world.addComponent(entityId, 'networkSync', {
      networkId,
      isLocal,
      lastServerPosition: position.clone(),
      lastServerTime: performance.now(),
      interpolationBuffer: [],
    });
    
    // Use character type stats for combat
    this.world.addComponent(entityId, 'combat', {
      attackDamage: charTypeInfo.stats.attackDamage,
      attackRange: combatClass.attackRange, // Use combat class range
      attackSpeed: charTypeInfo.stats.attackSpeed,
      lastAttackTime: 0,
      targetId: null,
      isAttacking: false,
    });
    
    this.world.addComponent(entityId, 'entityType', {
      type: 'champion',
      team,
      elementType: elementType || 'fire',
    });
    
    // Animation component for combat animations
    this.world.addComponent(entityId, 'animation', {
      state: 'idle',
      progress: 0,
      duration: 0,
      baseScale: new THREE.Vector3(1, 1, 1),
      basePosition: position.clone(),
    });
    
    // Mana component for ability resource
    this.world.addComponent(entityId, 'mana', {
      current: 0,
      max: manaConfig.maxMana,
      gainPerHit: manaConfig.manaPerHit,
    });
    
    // Ability component
    this.world.addComponent(entityId, 'ability', {
      abilityId: abilityInfo.id,
      level: 'M' as AbilityLevel,
      elementType: element,
      isReady: false,
      isCasting: false,
      castProgress: 0,
    });
    
    // Talisman inventory for ability upgrades
    this.world.addComponent(entityId, 'talismanInventory', {
      talismans: {},
    });
    
    // Experience component for leveling (starts at level 1)
    this.world.addComponent(entityId, 'experience', {
      level: 1,
      currentXP: 0,
      xpToNextLevel: 100,
    });
    
    return entityId;
  }

  /**
   * Format monster typeId to readable name (camelCase -> Title Case)
   */
  private formatMonsterName(typeId: string): string {
    // Convert camelCase to Title Case with spaces
    return typeId
      .replace(/([A-Z])/g, ' $1') // Add space before capitals
      .replace(/^./, str => str.toUpperCase()) // Capitalize first letter
      .trim();
  }

  /**
   * Create a monster entity with full customization from server data
   */
  public createMonsterFromData(data: {
    id: string;
    typeId: string;
    name?: string;
    x: number;
    z: number;
    health: number;
    maxHealth: number;
    level: number;
    elementType: string;
    shape: MonsterShape;
    color: number;
    glowColor: number;
    scale: number;
    aggroRadius?: number;
    leashDistance?: number;
    xpReward?: number;
    bodyParts?: MonsterBodyParts;
  }): string {
    const entityId = this.world.createEntity(data.id);
    const position = new THREE.Vector3(data.x, 0, data.z);
    
    // Create a new mesh with the specific monster appearance including body parts
    const mesh = this.createMonsterMesh(data.shape, data.color, data.glowColor, data.scale, data.bodyParts);
    mesh.visible = true;
    mesh.position.copy(position);
    this.scene.add(mesh);
    
    // Get display name from typeId (convert camelCase to Title Case)
    const displayName = data.name || this.formatMonsterName(data.typeId);
    
    // Update monster info indicator with level AND name
    const levelIndicator = mesh.getObjectByName('levelIndicator') as THREE.Sprite;
    if (levelIndicator) {
      this.updateMonsterInfoIndicator(levelIndicator, data.level, displayName);
    }
    
    // Store monster name in mesh userData
    mesh.userData.monsterName = displayName;
    
    // Add components
    this.world.addComponent(entityId, 'transform', {
      position: position.clone(),
      rotation: new THREE.Euler(),
      scale: new THREE.Vector3(data.scale, data.scale, data.scale),
      prevPosition: position.clone(),
    });
    
    this.world.addComponent(entityId, 'velocity', {
      velocity: new THREE.Vector3(),
      speed: 3,
      maxSpeed: 6,
    });
    
    this.world.addComponent(entityId, 'health', {
      current: data.health,
      max: data.maxHealth,
      isDead: false,
    });
    
    this.world.addComponent(entityId, 'movement', {
      targetPosition: null,
      path: [],
      pathIndex: 0,
      isMoving: false,
    });
    
    this.world.addComponent(entityId, 'renderable', {
      mesh,
      visible: true,
    });
    
    this.world.addComponent(entityId, 'networkSync', {
      networkId: data.id,
      isLocal: false,
      lastServerPosition: position.clone(),
      lastServerTime: performance.now(),
      interpolationBuffer: [],
    });
    
    this.world.addComponent(entityId, 'combat', {
      attackDamage: 25, // Will be updated by server
      attackRange: 3,
      attackSpeed: 0.8,
      lastAttackTime: 0,
      targetId: null,
      isAttacking: false,
    });
    
    this.world.addComponent(entityId, 'entityType', {
      type: 'monster',
      team: 0, // Neutral - attackable by all
      elementType: data.elementType,
    });
    
    // Animation component for combat animations
    this.world.addComponent(entityId, 'animation', {
      state: 'idle',
      progress: 0,
      duration: 0,
      baseScale: new THREE.Vector3(data.scale, data.scale, data.scale),
      basePosition: position.clone(),
    });
    
    // Monster-specific data
    this.world.addComponent(entityId, 'monsterData', {
      typeId: data.typeId,
      level: data.level,
      xpReward: data.xpReward || data.level * 10,
      aggroRadius: data.aggroRadius || 8,
      leashDistance: data.leashDistance || 20,
      spawnX: data.x,
      spawnZ: data.z,
      isActive: true,
    });
    
    return entityId;
  }

  /**
   * Create a monster entity (legacy method for backward compatibility)
   */
  public createMonster(
    networkId: string,
    position: THREE.Vector3,
    _monsterType: string = 'redBuff'
  ): string {
    const entityId = this.world.createEntity(networkId);
    
    // Get mesh from pool (generic monster)
    const mesh = this.monsterPool.acquire();
    mesh.visible = true;
    mesh.position.copy(position);
    this.scene.add(mesh);
    
    // Add components
    this.world.addComponent(entityId, 'transform', {
      position: position.clone(),
      rotation: new THREE.Euler(),
      scale: new THREE.Vector3(1, 1, 1),
      prevPosition: position.clone(),
    });
    
    this.world.addComponent(entityId, 'velocity', {
      velocity: new THREE.Vector3(),
      speed: 3,
      maxSpeed: 5,
    });
    
    this.world.addComponent(entityId, 'health', {
      current: 500,
      max: 500,
      isDead: false,
    });
    
    this.world.addComponent(entityId, 'movement', {
      targetPosition: null,
      path: [],
      pathIndex: 0,
      isMoving: false,
    });
    
    this.world.addComponent(entityId, 'renderable', {
      mesh,
      visible: true,
    });
    
    this.world.addComponent(entityId, 'networkSync', {
      networkId,
      isLocal: false,
      lastServerPosition: position.clone(),
      lastServerTime: performance.now(),
      interpolationBuffer: [],
    });
    
    this.world.addComponent(entityId, 'combat', {
      attackDamage: 25,
      attackRange: 3,
      attackSpeed: 0.8,
      lastAttackTime: 0,
      targetId: null,
      isAttacking: false,
    });
    
    this.world.addComponent(entityId, 'entityType', {
      type: 'monster',
      team: 0, // Neutral
    });
    
    // Animation component for combat animations
    this.world.addComponent(entityId, 'animation', {
      state: 'idle',
      progress: 0,
      duration: 0,
      baseScale: new THREE.Vector3(1, 1, 1),
      basePosition: position.clone(),
    });
    
    return entityId;
  }

  /**
   * Release a champion mesh back to the pool
   */
  public releaseChampion(mesh: THREE.Object3D): void {
    this.scene.remove(mesh);
    this.championPool.release(mesh as THREE.Group);
  }

  /**
   * Release a monster mesh back to the pool
   */
  public releaseMonster(mesh: THREE.Object3D): void {
    this.scene.remove(mesh);
    this.monsterPool.release(mesh as THREE.Group);
  }

  /**
   * Get particle pool for external use (e.g., ability effects)
   */
  public getParticlePool(): ParticlePool {
    return this.particlePool;
  }

  /**
   * Spawn damage effect particles
   */
  public spawnDamageEffect(position: THREE.Vector3, damage: number): void {
    this.particlePool.spawnDamageEffect(position, damage);
  }

  /**
   * Spawn attack effect particles
   */
  public spawnAttackEffect(from: THREE.Vector3, to: THREE.Vector3): void {
    this.particlePool.spawnAttackEffect(from, to);
  }

  /**
   * Spawn a floating damage number
   */
  public spawnDamageNumber(
    position: THREE.Vector3,
    damage: number,
    typeOrOptions?: string | { isCrit?: boolean; isHeal?: boolean; color?: number }
  ): void {
    // Handle string type for backward compatibility
    let options: { isCrit?: boolean; isHeal?: boolean; color?: number } | undefined;
    if (typeof typeOrOptions === 'string') {
      options = { isHeal: typeOrOptions === 'heal' };
    } else {
      options = typeOrOptions;
    }
    this.damageNumberPool.spawn(position, damage, options);
  }

  /**
   * Spawn a projectile for ranged attacks
   */
  public spawnProjectile(
    origin: THREE.Vector3,
    target: THREE.Vector3,
    options?: {
      speed?: number;
      damage?: number;
      attackerId?: string;
      targetEntityId?: string;
      elementType?: string;
      arcHeight?: number;
    }
  ): void {
    this.projectilePool.spawn(origin, target, options);
  }

  /**
   * Update particle systems
   */
  public updateParticles(dt: number): void {
    this.particlePool.update(dt);
    this.damageNumberPool.update(dt);
    this.projectilePool.update(dt);
  }

  /**
   * Create a resource node (tree, rock, gold vein, metin stone)
   */
  public createResourceNode(data: {
    id: string;
    nodeType: string;
    x: number;
    z: number;
    health: number;
    maxHealth: number;
    color: number;
    glowColor: number;
    scale: number;
    shape?: string;
  }): string {
    // Create entity in ECS
    const entityId = this.world.createEntity(data.id);
    
    // Create mesh based on shape
    const group = new THREE.Group();
    const position = new THREE.Vector3(data.x, 0, data.z);
    
    const shape = data.shape || 'crystal';
    
    if (shape === 'tree') {
      // Tree: brown trunk + green foliage
      const trunkGeometry = new THREE.CylinderGeometry(0.3, 0.5, 3, 8);
      const trunkMaterial = new THREE.MeshLambertMaterial({ color: 0x8b4513 }); // Saddle brown
      const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
      trunk.position.y = 1.5;
      group.add(trunk);
      
      // Foliage (multiple layers of cones)
      const foliageMaterial = new THREE.MeshLambertMaterial({ 
        color: data.color,
        emissive: data.glowColor,
        emissiveIntensity: 0.1,
      });
      
      const foliage1 = new THREE.Mesh(new THREE.ConeGeometry(1.8, 2.5, 8), foliageMaterial);
      foliage1.position.y = 4;
      group.add(foliage1);
      
      const foliage2 = new THREE.Mesh(new THREE.ConeGeometry(1.4, 2, 8), foliageMaterial);
      foliage2.position.y = 5.5;
      group.add(foliage2);
      
      const foliage3 = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.5, 8), foliageMaterial);
      foliage3.position.y = 6.8;
      group.add(foliage3);
      
    } else if (shape === 'rock') {
      // Rock: irregular dodecahedron
      const rockGeometry = new THREE.DodecahedronGeometry(1.2, 0);
      const rockMaterial = new THREE.MeshLambertMaterial({ 
        color: data.color,
        emissive: data.glowColor,
        emissiveIntensity: 0.05,
      });
      const rock = new THREE.Mesh(rockGeometry, rockMaterial);
      rock.position.y = 1;
      rock.rotation.set(Math.random() * 0.3, Math.random() * Math.PI, Math.random() * 0.3);
      rock.scale.set(1, 0.7, 1.1); // Flatten slightly
      group.add(rock);
      
      // Add some smaller rocks around
      for (let i = 0; i < 3; i++) {
        const smallRock = new THREE.Mesh(
          new THREE.DodecahedronGeometry(0.4, 0),
          rockMaterial
        );
        const angle = (i / 3) * Math.PI * 2 + Math.random() * 0.5;
        smallRock.position.set(
          Math.cos(angle) * 1.2,
          0.3,
          Math.sin(angle) * 1.2
        );
        smallRock.rotation.set(Math.random(), Math.random(), Math.random());
        group.add(smallRock);
      }
      
    } else if (shape === 'vein') {
      // Gold vein: rocky base with golden crystals
      const baseGeometry = new THREE.DodecahedronGeometry(0.8, 0);
      const baseMaterial = new THREE.MeshLambertMaterial({ color: 0x555555 });
      const base = new THREE.Mesh(baseGeometry, baseMaterial);
      base.position.y = 0.6;
      base.scale.set(1.2, 0.6, 1);
      group.add(base);
      
      // Golden crystals poking out
      const crystalMaterial = new THREE.MeshLambertMaterial({
        color: data.color,
        emissive: data.glowColor,
        emissiveIntensity: 0.4,
      });
      
      for (let i = 0; i < 5; i++) {
        const crystal = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.25 + Math.random() * 0.2, 0),
          crystalMaterial
        );
        const angle = (i / 5) * Math.PI * 2;
        crystal.position.set(
          Math.cos(angle) * 0.6,
          0.8 + Math.random() * 0.5,
          Math.sin(angle) * 0.6
        );
        crystal.rotation.set(Math.random(), Math.random(), Math.random());
        group.add(crystal);
      }
      
    } else if (shape === 'pillar') {
      // Metin stone: tall glowing pillar with runes
      const pillarGeometry = new THREE.CylinderGeometry(0.6, 0.8, 4, 6);
      const pillarMaterial = new THREE.MeshLambertMaterial({
        color: data.color,
        emissive: data.glowColor,
        emissiveIntensity: 0.5,
      });
      const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
      pillar.position.y = 2;
      group.add(pillar);
      
      // Glowing top
      const topGeometry = new THREE.OctahedronGeometry(0.5, 0);
      const topMaterial = new THREE.MeshBasicMaterial({
        color: data.glowColor,
        transparent: true,
        opacity: 0.8,
      });
      const top = new THREE.Mesh(topGeometry, topMaterial);
      top.position.y = 4.3;
      group.add(top);
      
      // Floating rune rings
      const ringGeometry = new THREE.TorusGeometry(1, 0.05, 8, 16);
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: data.glowColor,
        transparent: true,
        opacity: 0.6,
      });
      const ring1 = new THREE.Mesh(ringGeometry, ringMaterial);
      ring1.position.y = 1.5;
      ring1.rotation.x = Math.PI / 2;
      group.add(ring1);
      
      const ring2 = new THREE.Mesh(ringGeometry, ringMaterial);
      ring2.position.y = 3;
      ring2.rotation.x = Math.PI / 2;
      ring2.scale.setScalar(0.8);
      group.add(ring2);
      
    } else {
      // Default crystal shape
      const geometry = new THREE.OctahedronGeometry(1, 0);
      const material = new THREE.MeshLambertMaterial({
        color: data.color,
        emissive: data.glowColor,
        emissiveIntensity: 0.4,
        transparent: true,
        opacity: 0.85,
      });
      const crystal = new THREE.Mesh(geometry, material);
      crystal.position.y = 1.5;
      group.add(crystal);
      
      // Inner glow
      const innerGeometry = new THREE.OctahedronGeometry(0.7, 0);
      const innerMaterial = new THREE.MeshBasicMaterial({
        color: data.glowColor,
        transparent: true,
        opacity: 0.5,
      });
      const innerMesh = new THREE.Mesh(innerGeometry, innerMaterial);
      innerMesh.position.y = 1.5;
      group.add(innerMesh);
    }
    
    group.position.copy(position);
    group.scale.setScalar(data.scale);
    group.userData.entityId = entityId;
    group.userData.networkId = data.id;
    group.userData.type = 'resourceNode';
    group.userData.nodeType = data.nodeType;
    group.userData.baseScale = data.scale;
    
    // Add to scene
    this.scene.add(group);
    
    // Add ECS components
    this.world.addComponent(entityId, 'transform', {
      position: position.clone(),
      rotation: new THREE.Euler(0, 0, 0),
      scale: new THREE.Vector3(data.scale, data.scale, data.scale),
      prevPosition: position.clone(),
    });
    
    this.world.addComponent(entityId, 'renderable', {
      mesh: group,
      visible: true,
    });
    
    this.world.addComponent(entityId, 'health', {
      current: data.health,
      max: data.maxHealth,
      isDead: false,
    });
    
    this.world.addComponent(entityId, 'entityType', {
      type: 'resource_node',
      team: 0, // Neutral
    });
    
    this.world.addComponent(entityId, 'networkSync', {
      networkId: data.id,
      isLocal: false,
      lastServerPosition: position.clone(),
      lastServerTime: performance.now(),
      interpolationBuffer: [],
    });
    
    // Add animation for floating/rotating effect
    this.world.addComponent(entityId, 'animation', {
      state: 'idle',
      progress: Math.random(), // Random start phase for variety
      duration: 2, // Slow rotation cycle
      baseScale: new THREE.Vector3(data.scale, data.scale, data.scale),
      basePosition: position.clone(),
    });
    
    console.log(`[EntityFactory] Created resource node ${data.id} (${data.nodeType}) at (${data.x.toFixed(1)}, ${data.z.toFixed(1)})`);
    
    return entityId;
  }

  /**
   * Create a ground item (floating loot on ground)
   */
  public createGroundItem(data: {
    id: string;
    itemType: string;
    quantity: number;
    x: number;
    z: number;
    elementType?: string;
    despawnIn: number;
  }): string {
    const entityId = this.world.createEntity(data.id);
    
    // Determine color based on item type
    let color = 0xffffff;
    let glowColor = 0xffffff;
    let label = data.itemType;
    
    switch (data.itemType) {
      case 'wood':
        color = 0x44aa44;
        glowColor = 0x22ff22;
        label = `Wood x${data.quantity}`;
        break;
      case 'gold':
        color = 0xffcc00;
        glowColor = 0xffff00;
        label = `Gold x${data.quantity}`;
        break;
      case 'stone':
        color = 0x8888aa;
        glowColor = 0xaaaaff;
        label = `Stone x${data.quantity}`;
        break;
      case 'talisman':
        // Color based on element
        const elementColors: Record<string, { main: number; glow: number }> = {
          fire: { main: 0xff6633, glow: 0xff4400 },
          water: { main: 0x44aaff, glow: 0x2288ff },
          grass: { main: 0x55dd55, glow: 0x33bb33 },
          electric: { main: 0xffee44, glow: 0xffdd00 },
          rock: { main: 0xaa8866, glow: 0x886644 },
        };
        const elemColors = elementColors[data.elementType || 'fire'];
        if (elemColors) {
          color = elemColors.main;
          glowColor = elemColors.glow;
        }
        label = `${data.elementType || 'Unknown'} Talisman`;
        break;
    }
    
    // Create LARGE floating loot mesh (much more visible!)
    const group = new THREE.Group();
    const position = new THREE.Vector3(data.x, 0, data.z);
    
    // Main item mesh - different shapes for different items
    let mainMesh: THREE.Mesh;
    
    if (data.itemType === 'wood') {
      // Wood log shape
      const logGeometry = new THREE.CylinderGeometry(0.3, 0.3, 1.2, 8);
      mainMesh = new THREE.Mesh(logGeometry, new THREE.MeshLambertMaterial({
        color: 0x8b4513,
        emissive: glowColor,
        emissiveIntensity: 0.3,
      }));
      mainMesh.rotation.z = Math.PI / 2;
      mainMesh.position.y = 0.8;
    } else if (data.itemType === 'gold') {
      // Gold coin stack
      const coinGeometry = new THREE.CylinderGeometry(0.5, 0.5, 0.15, 16);
      const coinMaterial = new THREE.MeshLambertMaterial({
        color,
        emissive: glowColor,
        emissiveIntensity: 0.5,
      });
      mainMesh = new THREE.Mesh(coinGeometry, coinMaterial);
      mainMesh.position.y = 0.5;
      
      // Stack more coins
      for (let i = 1; i < Math.min(data.quantity / 5, 4); i++) {
        const extraCoin = new THREE.Mesh(coinGeometry, coinMaterial);
        extraCoin.position.y = 0.5 + i * 0.12;
        extraCoin.rotation.y = Math.random() * 0.3;
        group.add(extraCoin);
      }
    } else if (data.itemType === 'stone') {
      // Stone chunk
      const stoneGeometry = new THREE.DodecahedronGeometry(0.5, 0);
      mainMesh = new THREE.Mesh(stoneGeometry, new THREE.MeshLambertMaterial({
        color,
        emissive: glowColor,
        emissiveIntensity: 0.2,
      }));
      mainMesh.position.y = 0.6;
      mainMesh.scale.set(1, 0.7, 1);
    } else if (data.itemType === 'talisman') {
      // Glowing talisman orb
      const orbGeometry = new THREE.OctahedronGeometry(0.6, 1);
      mainMesh = new THREE.Mesh(orbGeometry, new THREE.MeshLambertMaterial({
        color,
        emissive: glowColor,
        emissiveIntensity: 0.7,
        transparent: true,
        opacity: 0.9,
      }));
      mainMesh.position.y = 1;
      
      // Add outer glow ring
      const ringGeometry = new THREE.TorusGeometry(0.8, 0.05, 8, 16);
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: glowColor,
        transparent: true,
        opacity: 0.6,
      });
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.position.y = 1;
      ring.rotation.x = Math.PI / 2;
      group.add(ring);
    } else {
      // Default gem
      const gemGeometry = new THREE.OctahedronGeometry(0.5, 0);
      mainMesh = new THREE.Mesh(gemGeometry, new THREE.MeshLambertMaterial({
        color,
        emissive: glowColor,
        emissiveIntensity: 0.6,
        transparent: true,
        opacity: 0.9,
      }));
      mainMesh.position.y = 0.8;
    }
    
    group.add(mainMesh);
    
    // Add glowing pillar of light underneath
    const lightPillarGeometry = new THREE.CylinderGeometry(0.1, 0.4, 2, 8);
    const lightPillarMaterial = new THREE.MeshBasicMaterial({
      color: glowColor,
      transparent: true,
      opacity: 0.3,
    });
    const lightPillar = new THREE.Mesh(lightPillarGeometry, lightPillarMaterial);
    lightPillar.position.y = 0;
    group.add(lightPillar);
    
    group.position.copy(position);
    group.userData.entityId = entityId;
    group.userData.networkId = data.id;
    group.userData.type = 'groundItem';
    group.userData.itemType = data.itemType;
    group.userData.quantity = data.quantity;
    group.userData.elementType = data.elementType;
    group.userData.label = label;
    
    // Add floating label sprite (larger and more visible)
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.roundRect(0, 0, 256, 64, 8);
    ctx.fill();
    ctx.strokeStyle = `#${glowColor.toString(16).padStart(6, '0')}`;
    ctx.lineWidth = 3;
    ctx.roundRect(0, 0, 256, 64, 8);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(label, 128, 44);
    
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ 
      map: texture,
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(3, 0.75, 1); // Bigger label
    sprite.position.y = 2.2; // Higher above item
    sprite.name = 'itemLabel';
    group.add(sprite);
    
    this.scene.add(group);
    
    // Add ECS components
    this.world.addComponent(entityId, 'transform', {
      position: position.clone(),
      rotation: new THREE.Euler(0, 0, 0),
      scale: new THREE.Vector3(1, 1, 1),
      prevPosition: position.clone(),
    });
    
    this.world.addComponent(entityId, 'renderable', {
      mesh: group,
      visible: true,
    });
    
    this.world.addComponent(entityId, 'entityType', {
      type: 'ground_item',
      team: 0,
    });
    
    this.world.addComponent(entityId, 'networkSync', {
      networkId: data.id,
      isLocal: false,
      lastServerPosition: position.clone(),
      lastServerTime: performance.now(),
      interpolationBuffer: [],
    });
    
    this.world.addComponent(entityId, 'animation', {
      state: 'idle',
      progress: Math.random(),
      duration: 1.5, // Bobbing cycle
      baseScale: new THREE.Vector3(1, 1, 1),
      basePosition: position.clone(),
    });
    
    console.log(`[EntityFactory] Created ground item ${data.id} (${data.itemType}) at (${data.x.toFixed(1)}, ${data.z.toFixed(1)})`);
    
    return entityId;
  }

  /**
   * Update resource node health display
   */
  public updateNodeHealth(networkId: string, health: number, maxHealth: number): void {
    const entityId = this.world.getEntityByNetworkId(networkId);
    if (!entityId) return;
    
    const healthComp = this.world.getComponent(entityId, 'health');
    if (healthComp) {
      healthComp.current = health;
      healthComp.max = maxHealth;
      
      // Visual feedback for damage - scale down slightly
      const renderable = this.world.getComponent(entityId, 'renderable');
      if (renderable?.mesh) {
        const healthRatio = health / maxHealth;
        const scaleModifier = 0.8 + (0.2 * healthRatio);
        renderable.mesh.scale.setScalar(scaleModifier * (renderable.mesh.userData.baseScale || 1));
      }
    }
  }

  /**
   * Remove a resource node
   */
  public removeResourceNode(networkId: string): void {
    const entityId = this.world.getEntityByNetworkId(networkId);
    if (!entityId) return;
    
    const renderable = this.world.getComponent(entityId, 'renderable');
    if (renderable?.mesh) {
      this.scene.remove(renderable.mesh);
      // Dispose geometry and material if unique
      renderable.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose();
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          }
        }
      });
    }
    
    this.world.destroyEntity(entityId);
    console.log(`[EntityFactory] Removed resource node ${networkId}`);
  }

  /**
   * Remove a ground item
   */
  public removeGroundItem(networkId: string): void {
    const entityId = this.world.getEntityByNetworkId(networkId);
    if (!entityId) return;
    
    const renderable = this.world.getComponent(entityId, 'renderable');
    if (renderable?.mesh) {
      this.scene.remove(renderable.mesh);
      renderable.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose();
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          }
        }
        if (child instanceof THREE.Sprite) {
          child.material.map?.dispose();
          child.material.dispose();
        }
      });
    }
    
    this.world.destroyEntity(entityId);
    console.log(`[EntityFactory] Removed ground item ${networkId}`);
  }

  public dispose(): void {
    this.assets.dispose();
    this.particlePool.dispose();
    this.damageNumberPool.dispose();
    this.projectilePool.dispose();
  }
}

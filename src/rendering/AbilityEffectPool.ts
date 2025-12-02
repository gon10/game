import * as THREE from 'three';
import { AbilityLevel } from '../ecs/components';
import { 
  ABILITIES, 
  ABILITY_VISUAL_TIERS,
  getVisualTier 
} from '../types/AbilityTypes';
import { ElementType } from '../types/CharacterTypes';

/**
 * Ability Effect Pool - Manages visual effects for abilities
 * Supports 3 visual tiers (M, G, P) with progressive enhancements
 */

interface AbilityEffect {
  id: string;
  type: ElementType | 'levelup'; // Added levelup type
  level: AbilityLevel;
  position: THREE.Vector3;
  targetPosition: THREE.Vector3;
  progress: number; // 0-1 for effect lifecycle
  duration: number;
  particles: THREE.Points[];
  meshes: THREE.Object3D[]; // Changed from Mesh to Object3D to support Lines
  glowLight?: THREE.PointLight;
  textSprite?: THREE.Sprite; // For level-up text
  onComplete?: () => void;
}

export class AbilityEffectPool {
  private scene: THREE.Scene;
  private activeEffects: Map<string, AbilityEffect> = new Map();
  private effectIdCounter = 0;
  
  // Shared geometries
  private particleGeometry: THREE.BufferGeometry;
  private sphereGeometry: THREE.SphereGeometry;
  private ringGeometry: THREE.RingGeometry;
  private leafGeometry: THREE.BufferGeometry;
  
  // Shared materials per element
  private materials: Map<string, THREE.Material> = new Map();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    
    // Create shared geometries
    this.particleGeometry = new THREE.BufferGeometry();
    this.sphereGeometry = new THREE.SphereGeometry(0.1, 8, 8);
    this.ringGeometry = new THREE.RingGeometry(0.5, 2, 32);
    this.leafGeometry = this.createLeafGeometry();
    
    // Pre-create materials for each element
    this.createMaterials();
  }

  private createLeafGeometry(): THREE.BufferGeometry {
    // Simple leaf shape (diamond)
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.15);
    shape.lineTo(0.05, 0);
    shape.lineTo(0, -0.15);
    shape.lineTo(-0.05, 0);
    shape.closePath();
    
    return new THREE.ShapeGeometry(shape);
  }

  private createMaterials(): void {
    const elements: ElementType[] = ['fire', 'water', 'grass', 'electric', 'rock', 'psychic'];
    
    for (const element of elements) {
      const ability = ABILITIES[element];
      
      // Base material
      this.materials.set(`${element}_base`, new THREE.MeshBasicMaterial({
        color: ability.color,
        transparent: true,
        opacity: 0.8,
      }));
      
      // Glow material (for P tier)
      this.materials.set(`${element}_glow`, new THREE.MeshBasicMaterial({
        color: ability.color,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
      }));
      
      // Purple particle material (for G+ tier)
      this.materials.set('purple_particle', new THREE.PointsMaterial({
        color: 0xaa44ff,
        size: 0.15,
        transparent: true,
        opacity: 0.7,
      }));
      
      // Orange particle material (for P tier)
      this.materials.set('orange_particle', new THREE.PointsMaterial({
        color: 0xff8800,
        size: 0.2,
        transparent: true,
        opacity: 0.8,
      }));
    }
  }

  /**
   * Spawn a Fire Meteor effect
   */
  public spawnFireMeteor(
    casterPosition: THREE.Vector3,
    targetPosition: THREE.Vector3,
    level: AbilityLevel,
    onComplete?: () => void
  ): string {
    const id = this.generateId('fire_meteor');
    const tier = getVisualTier(level);
    const ability = ABILITIES.fire;
    
    const effect: AbilityEffect = {
      id,
      type: 'fire',
      level,
      position: casterPosition.clone(),
      targetPosition: targetPosition.clone(),
      progress: 0,
      duration: ability.castTime,
      particles: [],
      meshes: [],
      onComplete,
    };
    
    // Create meteor mesh
    const meteorSize = 0.3 * tier.scale;
    const meteorGeom = new THREE.SphereGeometry(meteorSize, 16, 16);
    const meteorMat = new THREE.MeshStandardMaterial({
      color: 0xff4422,
      emissive: tier.hasGlow ? 0xff4422 : 0x000000,
      emissiveIntensity: tier.glowIntensity,
    });
    const meteor = new THREE.Mesh(meteorGeom, meteorMat);
    
    // Start high above target
    meteor.position.copy(targetPosition);
    meteor.position.y += 15;
    meteor.position.x += 5;
    
    this.scene.add(meteor);
    effect.meshes.push(meteor);
    
    // Add trail particles
    const trailParticles = this.createParticleSystem(
      tier.particleCount,
      ability.color,
      0.1 * tier.scale
    );
    this.scene.add(trailParticles);
    effect.particles.push(trailParticles);
    
    // Add purple particles for G+
    if (tier.hasPurpleParticles) {
      const purpleParticles = this.createParticleSystem(
        Math.floor(tier.particleCount * 0.5),
        0xaa44ff,
        0.12 * tier.scale
      );
      this.scene.add(purpleParticles);
      effect.particles.push(purpleParticles);
    }
    
    // Add orange particles for P
    if (tier.hasOrangeParticles) {
      const orangeParticles = this.createParticleSystem(
        Math.floor(tier.particleCount * 0.3),
        0xff8800,
        0.15 * tier.scale
      );
      this.scene.add(orangeParticles);
      effect.particles.push(orangeParticles);
    }
    
    // Add glow light for P tier
    if (tier.hasGlow) {
      const light = new THREE.PointLight(0xff4422, tier.glowIntensity, 8);
      light.position.copy(meteor.position);
      this.scene.add(light);
      effect.glowLight = light;
    }
    
    this.activeEffects.set(id, effect);
    return id;
  }

  /**
   * Spawn a Tidal Blessing effect (water wave around caster + heal beam to lowest HP ally)
   */
  public spawnTidalBlessing(
    casterPosition: THREE.Vector3,
    level: AbilityLevel,
    onComplete?: () => void
  ): string {
    const id = this.generateId('tidal_blessing');
    const tier = getVisualTier(level);
    const ability = ABILITIES.water;
    
    const effect: AbilityEffect = {
      id,
      type: 'water',
      level,
      position: casterPosition.clone(),
      targetPosition: casterPosition.clone(),
      progress: 0,
      duration: 1.5, // Quick burst effect
      particles: [],
      meshes: [],
      onComplete,
    };
    
    // Create expanding water ring (damage wave)
    const ringSize = ability.radius * tier.scale;
    const ringGeom = new THREE.RingGeometry(0.1, ringSize, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x3399ff,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(casterPosition);
    ring.position.y += 0.1;
    ring.scale.set(0.1, 0.1, 0.1); // Start small, will expand
    
    this.scene.add(ring);
    effect.meshes.push(ring);
    
    // Water spray particles expanding outward
    const waterParticles = this.createParticleSystem(
      tier.particleCount * 2,
      ability.color,
      0.1 * tier.scale
    );
    waterParticles.position.copy(casterPosition);
    this.scene.add(waterParticles);
    effect.particles.push(waterParticles);
    
    // Healing sparkles (green-blue)
    const healParticles = this.createParticleSystem(
      Math.floor(tier.particleCount * 0.6),
      0x44ffaa,
      0.08 * tier.scale
    );
    healParticles.position.copy(casterPosition);
    this.scene.add(healParticles);
    effect.particles.push(healParticles);
    
    // Purple particles for G+
    if (tier.hasPurpleParticles) {
      const purpleParticles = this.createParticleSystem(
        Math.floor(tier.particleCount * 0.4),
        0xaa44ff,
        0.1 * tier.scale
      );
      purpleParticles.position.copy(casterPosition);
      this.scene.add(purpleParticles);
      effect.particles.push(purpleParticles);
    }
    
    // Orange particles + glow for P
    if (tier.hasOrangeParticles) {
      const orangeParticles = this.createParticleSystem(
        Math.floor(tier.particleCount * 0.3),
        0xff8800,
        0.12 * tier.scale
      );
      orangeParticles.position.copy(casterPosition);
      this.scene.add(orangeParticles);
      effect.particles.push(orangeParticles);
    }
    
    if (tier.hasGlow) {
      const light = new THREE.PointLight(0x3399ff, tier.glowIntensity, 8);
      light.position.copy(casterPosition);
      light.position.y += 1;
      this.scene.add(light);
      effect.glowLight = light;
    }
    
    this.activeEffects.set(id, effect);
    return id;
  }

  /**
   * Spawn a Leaf Storm effect (spinning leaves around caster)
   */
  public spawnLeafStorm(
    casterPosition: THREE.Vector3,
    level: AbilityLevel,
    onComplete?: () => void
  ): string {
    const id = this.generateId('leaf_storm');
    const tier = getVisualTier(level);
    const ability = ABILITIES.grass;
    
    const effect: AbilityEffect = {
      id,
      type: 'grass',
      level,
      position: casterPosition.clone(),
      targetPosition: casterPosition.clone(),
      progress: 0,
      duration: ability.duration,
      particles: [],
      meshes: [],
      onComplete,
    };
    
    // Create spinning leaf meshes
    const leafCount = Math.floor(12 * tier.scale);
    const radius = ability.radius * tier.scale;
    
    for (let i = 0; i < leafCount; i++) {
      const leafMat = new THREE.MeshBasicMaterial({
        color: 0x44cc44,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      });
      const leaf = new THREE.Mesh(this.leafGeometry.clone(), leafMat);
      leaf.scale.setScalar(tier.scale * 1.5);
      
      // Position in a circle
      const angle = (i / leafCount) * Math.PI * 2;
      leaf.position.set(
        casterPosition.x + Math.cos(angle) * radius,
        casterPosition.y + 1 + (Math.random() * 0.5),
        casterPosition.z + Math.sin(angle) * radius
      );
      leaf.userData.angle = angle;
      leaf.userData.heightOffset = Math.random() * 0.5;
      
      this.scene.add(leaf);
      effect.meshes.push(leaf);
    }
    
    // Green healing particles
    const greenParticles = this.createParticleSystem(
      tier.particleCount,
      0x88ff88,
      0.1 * tier.scale
    );
    greenParticles.position.copy(casterPosition);
    this.scene.add(greenParticles);
    effect.particles.push(greenParticles);
    
    // Purple particles for G+
    if (tier.hasPurpleParticles) {
      const purpleParticles = this.createParticleSystem(
        Math.floor(tier.particleCount * 0.4),
        0xaa44ff,
        0.12 * tier.scale
      );
      purpleParticles.position.copy(casterPosition);
      this.scene.add(purpleParticles);
      effect.particles.push(purpleParticles);
    }
    
    // Orange particles + glow for P
    if (tier.hasOrangeParticles) {
      const orangeParticles = this.createParticleSystem(
        Math.floor(tier.particleCount * 0.3),
        0xff8800,
        0.15 * tier.scale
      );
      orangeParticles.position.copy(casterPosition);
      this.scene.add(orangeParticles);
      effect.particles.push(orangeParticles);
    }
    
    if (tier.hasGlow) {
      const light = new THREE.PointLight(0x44cc44, tier.glowIntensity, 8);
      light.position.copy(casterPosition);
      light.position.y += 1.5;
      this.scene.add(light);
      effect.glowLight = light;
    }
    
    this.activeEffects.set(id, effect);
    return id;
  }

  /**
   * Spawn a Lightning Chain effect
   */
  public spawnLightningChain(
    casterPosition: THREE.Vector3,
    targets: THREE.Vector3[],
    level: AbilityLevel,
    onComplete?: () => void
  ): string {
    const id = this.generateId('lightning_chain');
    const tier = getVisualTier(level);
    const ability = ABILITIES.electric;
    
    const effect: AbilityEffect = {
      id,
      type: 'electric',
      level,
      position: casterPosition.clone(),
      targetPosition: targets[0]?.clone() || casterPosition.clone(),
      progress: 0,
      duration: ability.castTime + (targets.length * 0.15),
      particles: [],
      meshes: [],
      onComplete,
    };
    
    // Create lightning bolts between targets
    let previousPos = casterPosition.clone();
    previousPos.y += 1;
    
    for (const target of targets) {
      const targetPos = target.clone();
      targetPos.y += 1;
      
      const bolt = this.createLightningBolt(previousPos, targetPos, tier.scale);
      this.scene.add(bolt);
      effect.meshes.push(bolt);
      
      // Spark particles at hit point
      const sparkParticles = this.createParticleSystem(
        Math.floor(tier.particleCount * 0.3),
        0xffff00,
        0.08 * tier.scale
      );
      sparkParticles.position.copy(targetPos);
      this.scene.add(sparkParticles);
      effect.particles.push(sparkParticles);
      
      previousPos = targetPos;
    }
    
    // Purple particles for G+
    if (tier.hasPurpleParticles) {
      for (const target of targets) {
        const purpleParticles = this.createParticleSystem(
          8,
          0xaa44ff,
          0.1 * tier.scale
        );
        purpleParticles.position.copy(target);
        purpleParticles.position.y += 1;
        this.scene.add(purpleParticles);
        effect.particles.push(purpleParticles);
      }
    }
    
    // Orange particles + glow for P
    if (tier.hasOrangeParticles) {
      for (const target of targets) {
        const orangeParticles = this.createParticleSystem(
          6,
          0xff8800,
          0.12 * tier.scale
        );
        orangeParticles.position.copy(target);
        orangeParticles.position.y += 1;
        this.scene.add(orangeParticles);
        effect.particles.push(orangeParticles);
      }
    }
    
    if (tier.hasGlow && targets.length > 0) {
      const light = new THREE.PointLight(0xffff00, tier.glowIntensity, 10);
      light.position.copy(targets[0]!);
      light.position.y += 1;
      this.scene.add(light);
      effect.glowLight = light;
    }
    
    this.activeEffects.set(id, effect);
    return id;
  }

  /**
   * Spawn an Earthquake effect
   */
  public spawnEarthquake(
    casterPosition: THREE.Vector3,
    level: AbilityLevel,
    onComplete?: () => void
  ): string {
    const id = this.generateId('earthquake');
    const tier = getVisualTier(level);
    const ability = ABILITIES.rock;
    
    const effect: AbilityEffect = {
      id,
      type: 'rock',
      level,
      position: casterPosition.clone(),
      targetPosition: casterPosition.clone(),
      progress: 0,
      duration: ability.castTime + 0.5,
      particles: [],
      meshes: [],
      onComplete,
    };
    
    // Create expanding shockwave ring
    const ringSize = ability.radius * tier.scale;
    const ringGeom = new THREE.RingGeometry(0.2, ringSize, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x996633,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(casterPosition);
    ring.position.y += 0.05;
    ring.scale.setScalar(0.1); // Start small, expand
    
    this.scene.add(ring);
    effect.meshes.push(ring);
    
    // Rock debris particles
    const rockParticles = this.createParticleSystem(
      tier.particleCount,
      0x886644,
      0.15 * tier.scale
    );
    rockParticles.position.copy(casterPosition);
    this.scene.add(rockParticles);
    effect.particles.push(rockParticles);
    
    // Dust cloud
    const dustParticles = this.createParticleSystem(
      Math.floor(tier.particleCount * 0.6),
      0xccaa88,
      0.2 * tier.scale
    );
    dustParticles.position.copy(casterPosition);
    this.scene.add(dustParticles);
    effect.particles.push(dustParticles);
    
    // Purple particles for G+
    if (tier.hasPurpleParticles) {
      const purpleParticles = this.createParticleSystem(
        Math.floor(tier.particleCount * 0.4),
        0xaa44ff,
        0.12 * tier.scale
      );
      purpleParticles.position.copy(casterPosition);
      this.scene.add(purpleParticles);
      effect.particles.push(purpleParticles);
    }
    
    // Orange particles + glow for P
    if (tier.hasOrangeParticles) {
      const orangeParticles = this.createParticleSystem(
        Math.floor(tier.particleCount * 0.3),
        0xff8800,
        0.15 * tier.scale
      );
      orangeParticles.position.copy(casterPosition);
      this.scene.add(orangeParticles);
      effect.particles.push(orangeParticles);
    }
    
    if (tier.hasGlow) {
      const light = new THREE.PointLight(0x996633, tier.glowIntensity, 10);
      light.position.copy(casterPosition);
      light.position.y += 0.5;
      this.scene.add(light);
      effect.glowLight = light;
    }
    
    this.activeEffects.set(id, effect);
    return id;
  }

  /**
   * Spawn a Mind Shatter effect
   */
  public spawnMindShatter(
    casterPosition: THREE.Vector3,
    targetPosition: THREE.Vector3,
    level: AbilityLevel,
    onComplete?: () => void
  ): string {
    const id = this.generateId('mind_shatter');
    const tier = getVisualTier(level);
    const ability = ABILITIES.psychic;
    
    const effect: AbilityEffect = {
      id,
      type: 'psychic',
      level,
      position: casterPosition.clone(),
      targetPosition: targetPosition.clone(),
      progress: 0,
      duration: ability.castTime,
      particles: [],
      meshes: [],
      onComplete,
    };
    
    // Create psychic projectile
    const orbSize = 0.25 * tier.scale;
    const orbGeom = new THREE.SphereGeometry(orbSize, 16, 16);
    const orbMat = new THREE.MeshBasicMaterial({
      color: 0xdd66ff,
      transparent: true,
      opacity: 0.8,
    });
    const orb = new THREE.Mesh(orbGeom, orbMat);
    orb.position.copy(casterPosition);
    orb.position.y += 1;
    
    this.scene.add(orb);
    effect.meshes.push(orb);
    
    // Inner glow sphere
    const innerGlowGeom = new THREE.SphereGeometry(orbSize * 0.6, 8, 8);
    const innerGlowMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
    });
    const innerGlow = new THREE.Mesh(innerGlowGeom, innerGlowMat);
    orb.add(innerGlow);
    
    // Psychic trail particles
    const psychicParticles = this.createParticleSystem(
      tier.particleCount,
      0xdd66ff,
      0.08 * tier.scale
    );
    this.scene.add(psychicParticles);
    effect.particles.push(psychicParticles);
    
    // Purple particles for G+ (extra prominent for psychic)
    if (tier.hasPurpleParticles) {
      const purpleParticles = this.createParticleSystem(
        Math.floor(tier.particleCount * 0.6),
        0xaa44ff,
        0.12 * tier.scale
      );
      this.scene.add(purpleParticles);
      effect.particles.push(purpleParticles);
    }
    
    // Orange particles + glow for P
    if (tier.hasOrangeParticles) {
      const orangeParticles = this.createParticleSystem(
        Math.floor(tier.particleCount * 0.3),
        0xff8800,
        0.15 * tier.scale
      );
      this.scene.add(orangeParticles);
      effect.particles.push(orangeParticles);
    }
    
    if (tier.hasGlow) {
      const light = new THREE.PointLight(0xdd66ff, tier.glowIntensity, 6);
      orb.add(light);
      effect.glowLight = light;
    }
    
    this.activeEffects.set(id, effect);
    return id;
  }

  /**
   * Spawn a LEVEL UP effect - Metin2 style golden particle ring ascending around player
   * Features: golden particles, bright glow pulse, floating "+1 LEVEL" text
   */
  public spawnLevelUpEffect(
    characterPosition: THREE.Vector3,
    newLevel: number,
    onComplete?: () => void
  ): string {
    const id = this.generateId('level_up');
    
    const effect: AbilityEffect = {
      id,
      type: 'levelup',
      level: 'P', // Use max tier visuals for level up
      position: characterPosition.clone(),
      targetPosition: characterPosition.clone(),
      progress: 0,
      duration: 2.5, // 2.5 second effect
      particles: [],
      meshes: [],
      onComplete,
    };
    
    // 1. Create ascending golden ring particles
    const ringParticleCount = 120;
    const ringPositions = new Float32Array(ringParticleCount * 3);
    for (let i = 0; i < ringParticleCount; i++) {
      const angle = (i / ringParticleCount) * Math.PI * 2;
      const radius = 1.5 + Math.random() * 0.3;
      ringPositions[i * 3] = Math.cos(angle) * radius;
      ringPositions[i * 3 + 1] = Math.random() * 0.5; // Start at ground level
      ringPositions[i * 3 + 2] = Math.sin(angle) * radius;
    }
    const ringGeometry = new THREE.BufferGeometry();
    ringGeometry.setAttribute('position', new THREE.BufferAttribute(ringPositions, 3));
    const ringMaterial = new THREE.PointsMaterial({
      color: 0xffd700, // Gold
      size: 0.25,
      transparent: true,
      opacity: 1,
      sizeAttenuation: true,
    });
    const ringParticles = new THREE.Points(ringGeometry, ringMaterial);
    ringParticles.position.copy(characterPosition);
    this.scene.add(ringParticles);
    effect.particles.push(ringParticles);
    
    // 2. Create sparkle/starburst particles
    const sparkleCount = 60;
    const sparklePositions = new Float32Array(sparkleCount * 3);
    for (let i = 0; i < sparkleCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 0.5 + Math.random() * 1;
      sparklePositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      sparklePositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) + 1;
      sparklePositions[i * 3 + 2] = r * Math.cos(phi);
    }
    const sparkleGeometry = new THREE.BufferGeometry();
    sparkleGeometry.setAttribute('position', new THREE.BufferAttribute(sparklePositions, 3));
    const sparkleMaterial = new THREE.PointsMaterial({
      color: 0xffffaa, // Bright yellow-white
      size: 0.15,
      transparent: true,
      opacity: 1,
      sizeAttenuation: true,
    });
    const sparkleParticles = new THREE.Points(sparkleGeometry, sparkleMaterial);
    sparkleParticles.position.copy(characterPosition);
    this.scene.add(sparkleParticles);
    effect.particles.push(sparkleParticles);
    
    // 3. Create glowing ring mesh at ground level
    const groundRingGeometry = new THREE.RingGeometry(1, 2, 64);
    const groundRingMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd700,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });
    const groundRing = new THREE.Mesh(groundRingGeometry, groundRingMaterial);
    groundRing.rotation.x = -Math.PI / 2;
    groundRing.position.copy(characterPosition);
    groundRing.position.y += 0.1;
    this.scene.add(groundRing);
    effect.meshes.push(groundRing);
    
    // 4. Create floating "LEVEL UP!" text sprite
    const textSprite = this.createLevelUpTextSprite(newLevel);
    textSprite.position.copy(characterPosition);
    textSprite.position.y += 3;
    this.scene.add(textSprite);
    effect.textSprite = textSprite;
    effect.meshes.push(textSprite);
    
    // 5. Add bright golden glow light
    const glowLight = new THREE.PointLight(0xffd700, 3, 15);
    glowLight.position.copy(characterPosition);
    glowLight.position.y += 1.5;
    this.scene.add(glowLight);
    effect.glowLight = glowLight;
    
    // 6. Add secondary white flash light
    const flashLight = new THREE.PointLight(0xffffff, 5, 20);
    flashLight.position.copy(characterPosition);
    flashLight.position.y += 1;
    this.scene.add(flashLight);
    effect.meshes.push(flashLight as unknown as THREE.Object3D); // Store for cleanup
    
    this.activeEffects.set(id, effect);
    return id;
  }

  /**
   * Create a text sprite for level up display
   */
  private createLevelUpTextSprite(level: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    
    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw "LEVEL UP!" text with glow
    ctx.save();
    
    // Glow effect
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 20;
    
    // Main text
    ctx.font = 'bold 64px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Gold gradient
    const gradient = ctx.createLinearGradient(0, 80, 0, 150);
    gradient.addColorStop(0, '#fff8dc');
    gradient.addColorStop(0.5, '#ffd700');
    gradient.addColorStop(1, '#daa520');
    
    ctx.fillStyle = gradient;
    ctx.fillText('LEVEL UP!', canvas.width / 2, 100);
    
    // Level number
    ctx.font = 'bold 48px Arial';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.fillText(`Level ${level}`, canvas.width / 2, 180);
    
    ctx.restore();
    
    // Create sprite
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(4, 2, 1);
    
    return sprite;
  }

  /**
   * Create a lightning bolt mesh between two points
   */
  private createLightningBolt(from: THREE.Vector3, to: THREE.Vector3, scale: number): THREE.Line {
    const points: THREE.Vector3[] = [];
    const segments = 8;
    const direction = to.clone().sub(from);
    const length = direction.length();
    direction.normalize();
    
    // Create jagged lightning path
    const perpendicular = new THREE.Vector3(-direction.z, 0, direction.x).normalize();
    
    points.push(from.clone());
    
    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      const pos = from.clone().add(direction.clone().multiplyScalar(length * t));
      
      // Add random offset perpendicular to direction
      const offset = (Math.random() - 0.5) * 0.5 * scale;
      pos.add(perpendicular.clone().multiplyScalar(offset));
      pos.y += (Math.random() - 0.5) * 0.3 * scale;
      
      points.push(pos);
    }
    
    points.push(to.clone());
    
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: 0xffff00,
      linewidth: 2,
      transparent: true,
      opacity: 0.9,
    });
    
    return new THREE.Line(geometry, material);
  }

  /**
   * Create a particle system
   */
  private createParticleSystem(count: number, color: number, size: number): THREE.Points {
    const positions = new Float32Array(count * 3);
    
    for (let i = 0; i < count; i++) {
      // Random positions in a sphere
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = Math.random() * 2;
      
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }
    
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    const material = new THREE.PointsMaterial({
      color,
      size,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true,
    });
    
    return new THREE.Points(geometry, material);
  }

  /**
   * Update the caster position for an effect (used for effects that follow the caster)
   */
  public updateEffectCasterPosition(effectId: string, newPosition: THREE.Vector3): void {
    const effect = this.activeEffects.get(effectId);
    if (effect) {
      effect.position.copy(newPosition);
    }
  }

  /**
   * Update all active effects
   */
  public update(dt: number): void {
    for (const [id, effect] of this.activeEffects) {
      effect.progress += dt / effect.duration;
      
      if (effect.progress >= 1) {
        // Effect complete - cleanup
        this.removeEffect(id);
        if (effect.onComplete) {
          effect.onComplete();
        }
        continue;
      }
      
      // Update effect based on type
      this.updateEffect(effect, dt);
    }
  }

  /**
   * Update a specific effect
   */
  private updateEffect(effect: AbilityEffect, dt: number): void {
    const tier = getVisualTier(effect.level);
    
    switch (effect.type) {
      case 'fire':
        this.updateFireMeteor(effect, dt, tier);
        break;
      case 'water':
        this.updateTidalBlessing(effect, dt, tier);
        break;
      case 'grass':
        this.updateLeafStorm(effect, dt, tier);
        break;
      case 'electric':
        this.updateLightningChain(effect, dt, tier);
        break;
      case 'rock':
        this.updateEarthquake(effect, dt, tier);
        break;
      case 'psychic':
        this.updateMindShatter(effect, dt, tier);
        break;
      case 'levelup':
        this.updateLevelUpEffect(effect, dt);
        break;
    }
    
    // Update glow light intensity (pulse)
    if (effect.glowLight) {
      const pulse = 0.8 + Math.sin(effect.progress * Math.PI * 4) * 0.2;
      effect.glowLight.intensity = tier.glowIntensity * pulse;
    }
    
    // Fade out particles near end
    if (effect.progress > 0.7) {
      const fadeProgress = (effect.progress - 0.7) / 0.3;
      for (const particles of effect.particles) {
        const material = particles.material as THREE.PointsMaterial;
        material.opacity = 0.8 * (1 - fadeProgress);
      }
    }
  }

  private updateFireMeteor(effect: AbilityEffect, dt: number, tier: typeof ABILITY_VISUAL_TIERS.M): void {
    const meteor = effect.meshes[0] as THREE.Mesh | undefined;
    if (!meteor) return;
    
    // Arc from above to target
    const startY = effect.targetPosition.y + 15;
    const startX = effect.targetPosition.x + 5;
    
    // Parabolic descent
    const t = effect.progress;
    meteor.position.x = startX + (effect.targetPosition.x - startX) * t;
    meteor.position.y = startY + (effect.targetPosition.y - startY) * t - 5 * t * (1 - t);
    meteor.position.z = effect.targetPosition.z;
    
    // Trail particles follow meteor
    for (const particles of effect.particles) {
      particles.position.copy(meteor.position);
      this.animateParticlesOutward(particles, dt);
    }
    
    // Update glow light position
    if (effect.glowLight) {
      effect.glowLight.position.copy(meteor.position);
    }
    
    // Rotation
    meteor.rotation.x += dt * 5;
    meteor.rotation.z += dt * 3;
    
    // Impact flash at end
    if (effect.progress > 0.9 && meteor.material) {
      const impactProgress = (effect.progress - 0.9) / 0.1;
      meteor.scale.setScalar(tier.scale * (1 + impactProgress * 2));
      const mat = meteor.material as THREE.MeshStandardMaterial;
      if (mat.opacity !== undefined) mat.opacity = 1 - impactProgress;
    }
  }

  private updateTidalBlessing(effect: AbilityEffect, dt: number, _tier: typeof ABILITY_VISUAL_TIERS.M): void {
    const ring = effect.meshes[0] as THREE.Mesh | undefined;
    if (!ring) return;
    
    // Expand ring outward (damage wave)
    const expandProgress = Math.min(effect.progress * 1.5, 1);
    ring.scale.setScalar(expandProgress);
    if (ring.material) {
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - effect.progress * 0.8);
    }
    
    // Animate particles outward in a wave pattern
    for (const particles of effect.particles) {
      this.animateParticlesOutward(particles, dt);
    }
  }

  private updateLeafStorm(effect: AbilityEffect, dt: number, tier: typeof ABILITY_VISUAL_TIERS.M): void {
    const ability = ABILITIES.grass;
    const radius = ability.radius * tier.scale;
    
    // Spin leaves around caster (caster position is updated via updateEffectCasterPosition)
    for (let i = 0; i < effect.meshes.length; i++) {
      const leaf = effect.meshes[i]!;
      const baseAngle = leaf.userData.angle as number;
      const heightOffset = leaf.userData.heightOffset as number;
      
      // Rotate around center (effect.position follows caster)
      const spinSpeed = 3;
      const currentAngle = baseAngle + effect.progress * spinSpeed * Math.PI * 2;
      
      leaf.position.x = effect.position.x + Math.cos(currentAngle) * radius;
      leaf.position.z = effect.position.z + Math.sin(currentAngle) * radius;
      leaf.position.y = effect.position.y + 1 + heightOffset + Math.sin(effect.progress * Math.PI * 4) * 0.2;
      
      // Face outward and flutter
      leaf.rotation.y = currentAngle + Math.PI / 2;
      leaf.rotation.z = Math.sin(effect.progress * Math.PI * 8) * 0.3;
    }
    
    // Update particle system positions to follow caster
    for (const particles of effect.particles) {
      particles.position.copy(effect.position);
      this.animateParticlesSwirl(particles, effect.position, dt);
    }
    
    // Update glow light position if present
    if (effect.glowLight) {
      effect.glowLight.position.copy(effect.position);
      effect.glowLight.position.y += 1;
    }
  }

  private updateLightningChain(effect: AbilityEffect, _dt: number, _tier: typeof ABILITY_VISUAL_TIERS.M): void {
    // Flicker lightning bolts
    for (const mesh of effect.meshes) {
      if ((mesh as THREE.Line).isLine) {
        const material = (mesh as THREE.Line).material as THREE.LineBasicMaterial;
        material.opacity = 0.5 + Math.random() * 0.5;
      }
    }
    
    // Spark particles burst outward
    for (const particles of effect.particles) {
      this.animateParticlesOutward(particles, _dt * 2);
    }
  }

  private updateEarthquake(effect: AbilityEffect, dt: number, _tier: typeof ABILITY_VISUAL_TIERS.M): void {
    const ring = effect.meshes[0] as THREE.Mesh | undefined;
    if (!ring) return;
    
    // Expand shockwave
    const expandProgress = Math.min(effect.progress * 1.5, 1);
    ring.scale.setScalar(expandProgress);
    if (ring.material) {
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - effect.progress);
    }
    
    // Debris particles shoot up then fall
    for (const particles of effect.particles) {
      const positions = (particles.geometry as THREE.BufferGeometry).attributes.position;
      if (!positions) continue;
      const array = positions.array as Float32Array;
      
      for (let i = 0; i < array.length; i += 3) {
        // Gravity effect
        array[i + 1] = (array[i + 1] ?? 0) + (1 - effect.progress * 2) * dt * 5;
        // Spread outward
        array[i] = (array[i] ?? 0) * (1 + dt * 0.5);
        array[i + 2] = (array[i + 2] ?? 0) * (1 + dt * 0.5);
      }
      positions.needsUpdate = true;
    }
  }

  private updateMindShatter(effect: AbilityEffect, dt: number, tier: typeof ABILITY_VISUAL_TIERS.M): void {
    const orb = effect.meshes[0] as THREE.Mesh | undefined;
    if (!orb) return;
    
    // Move orb towards target
    const start = effect.position.clone();
    start.y += 1;
    const end = effect.targetPosition.clone();
    end.y += 1;
    
    orb.position.lerpVectors(start, end, effect.progress);
    
    // Pulse size
    const pulse = 1 + Math.sin(effect.progress * Math.PI * 6) * 0.2;
    orb.scale.setScalar(tier.scale * pulse);
    
    // Trail particles
    for (const particles of effect.particles) {
      particles.position.copy(orb.position);
      this.animateParticlesOutward(particles, dt * 0.5);
    }
    
    // Impact effect at end
    if (effect.progress > 0.85 && orb.material) {
      const impactProgress = (effect.progress - 0.85) / 0.15;
      orb.scale.setScalar(tier.scale * (1 + impactProgress * 3));
      (orb.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - impactProgress);
    }
  }

  /**
   * Update the Level Up effect - Metin2 style ascending golden rings
   */
  private updateLevelUpEffect(effect: AbilityEffect, _dt: number): void {
    const progress = effect.progress;
    
    // Phase 1: Initial flash (0-0.1)
    // Phase 2: Rising rings (0.1-0.7)
    // Phase 3: Fade out (0.7-1.0)
    
    // Update ring particles - ascend upward while spinning
    if (effect.particles[0]) {
      const ringParticles = effect.particles[0];
      const positions = (ringParticles.geometry as THREE.BufferGeometry).attributes.position;
      if (positions) {
        const array = positions.array as Float32Array;
        const particleCount = array.length / 3;
        
        for (let i = 0; i < particleCount; i++) {
          const baseAngle = (i / particleCount) * Math.PI * 2;
          const currentAngle = baseAngle + progress * Math.PI * 4; // 2 full rotations
          const radius = 1.5 + Math.sin(progress * Math.PI * 8) * 0.3;
          
          array[i * 3] = Math.cos(currentAngle) * radius;
          array[i * 3 + 1] = progress * 4; // Rise up to 4 units
          array[i * 3 + 2] = Math.sin(currentAngle) * radius;
        }
        positions.needsUpdate = true;
      }
      
      // Fade particles
      const material = ringParticles.material as THREE.PointsMaterial;
      if (progress > 0.7) {
        material.opacity = 1 - ((progress - 0.7) / 0.3);
      }
    }
    
    // Update sparkle particles - expand outward
    if (effect.particles[1]) {
      const sparkleParticles = effect.particles[1];
      const positions = (sparkleParticles.geometry as THREE.BufferGeometry).attributes.position;
      if (positions) {
        const array = positions.array as Float32Array;
        for (let i = 0; i < array.length; i += 3) {
          // Expand outward and upward
          array[i] = (array[i] ?? 0) * (1 + _dt * 0.3);
          array[i + 1] = (array[i + 1] ?? 0) + _dt * 2;
          array[i + 2] = (array[i + 2] ?? 0) * (1 + _dt * 0.3);
        }
        positions.needsUpdate = true;
      }
      
      // Fade sparkles
      const material = sparkleParticles.material as THREE.PointsMaterial;
      if (progress > 0.5) {
        material.opacity = 1 - ((progress - 0.5) / 0.5);
      }
    }
    
    // Update ground ring - expand and fade
    const groundRing = effect.meshes[0] as THREE.Mesh | undefined;
    if (groundRing) {
      const ringScale = 1 + progress * 1.5;
      groundRing.scale.setScalar(ringScale);
      const material = groundRing.material as THREE.MeshBasicMaterial;
      material.opacity = 0.8 * (1 - progress);
    }
    
    // Update text sprite - float up and fade
    if (effect.textSprite) {
      effect.textSprite.position.y = effect.position.y + 3 + progress * 2;
      
      // Scale up at start, then shrink
      const textScale = progress < 0.2 
        ? 1 + progress * 5 // Scale up to 2x in first 20%
        : 2 - (progress - 0.2) * 1.25; // Scale back down
      effect.textSprite.scale.set(4 * textScale, 2 * textScale, 1);
      
      // Fade out at end
      if (progress > 0.7) {
        const material = effect.textSprite.material as THREE.SpriteMaterial;
        material.opacity = 1 - ((progress - 0.7) / 0.3);
      }
    }
    
    // Update glow light - pulse brightly then fade
    if (effect.glowLight) {
      const pulseIntensity = progress < 0.3 
        ? 3 + Math.sin(progress * Math.PI * 20) * 2 // Fast pulse at start
        : 3 * (1 - (progress - 0.3) / 0.7); // Fade out
      effect.glowLight.intensity = pulseIntensity;
    }
    
    // Update flash light (stored as meshes[1])
    const flashLight = effect.meshes[1] as unknown as THREE.PointLight | undefined;
    if (flashLight && flashLight.isLight) {
      // Bright flash at start, then fade quickly
      flashLight.intensity = progress < 0.1 
        ? 5 * (1 - progress * 10) 
        : 0;
    }
  }

  /**
   * Animate particles outward from center
   */
  private animateParticlesOutward(particles: THREE.Points, dt: number): void {
    const positions = (particles.geometry as THREE.BufferGeometry).attributes.position;
    if (!positions) return;
    const array = positions.array as Float32Array;
    
    for (let i = 0; i < array.length; i += 3) {
      const x = array[i] ?? 0;
      const y = array[i + 1] ?? 0;
      const z = array[i + 2] ?? 0;
      const len = Math.sqrt(x * x + y * y + z * z) || 1;
      
      array[i] = x + (x / len) * dt * 2;
      array[i + 1] = y + (y / len) * dt * 2;
      array[i + 2] = z + (z / len) * dt * 2;
    }
    positions.needsUpdate = true;
  }

  /**
   * Animate particles in a swirl pattern
   */
  private animateParticlesSwirl(particles: THREE.Points, _center: THREE.Vector3, dt: number): void {
    const positions = (particles.geometry as THREE.BufferGeometry).attributes.position;
    if (!positions) return;
    const array = positions.array as Float32Array;
    
    for (let i = 0; i < array.length; i += 3) {
      const x = array[i] ?? 0;
      const z = array[i + 2] ?? 0;
      
      // Rotate around Y axis
      const angle = dt * 3;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      
      array[i] = x * cos - z * sin;
      array[i + 2] = x * sin + z * cos;
      
      // Slight upward movement
      array[i + 1] = (array[i + 1] ?? 0) + dt * 0.5;
    }
    positions.needsUpdate = true;
  }

  /**
   * Remove an effect and clean up resources
   */
  private removeEffect(id: string): void {
    const effect = this.activeEffects.get(id);
    if (!effect) return;
    
    // Remove meshes
    for (const mesh of effect.meshes) {
      this.scene.remove(mesh);
      if ((mesh as THREE.Mesh).geometry) {
        (mesh as THREE.Mesh).geometry.dispose();
      }
      if ((mesh as THREE.Mesh).material instanceof THREE.Material) {
        ((mesh as THREE.Mesh).material as THREE.Material).dispose();
      }
    }
    
    // Remove particles
    for (const particles of effect.particles) {
      this.scene.remove(particles);
      particles.geometry?.dispose();
      if (particles.material instanceof THREE.Material) {
        particles.material.dispose();
      }
    }
    
    // Remove glow light
    if (effect.glowLight) {
      this.scene.remove(effect.glowLight);
    }
    
    this.activeEffects.delete(id);
  }

  /**
   * Generate unique effect ID
   */
  private generateId(prefix: string): string {
    return `${prefix}_${++this.effectIdCounter}_${Date.now()}`;
  }

  /**
   * Dispose of all resources
   */
  public dispose(): void {
    // Remove all active effects
    for (const id of this.activeEffects.keys()) {
      this.removeEffect(id);
    }
    
    // Dispose shared geometries
    this.particleGeometry.dispose();
    this.sphereGeometry.dispose();
    this.ringGeometry.dispose();
    this.leafGeometry.dispose();
    
    // Dispose materials
    for (const material of this.materials.values()) {
      material.dispose();
    }
  }
}

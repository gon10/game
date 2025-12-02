import * as THREE from 'three';
import { World } from '../World';
import { EntityFactory } from '../../entities/EntityFactory';

/**
 * Render System - Updates visual representations
 * 
 * KEY INSIGHT from professional games:
 * - Local player: Mesh is updated DIRECTLY by MovementSystem (instant response)
 * - Remote players: Mesh is updated by NetworkSystem interpolation
 * 
 * This system now only handles non-movement rendering updates like rotation,
 * scale, visibility, and entities without network sync.
 * 
 * PERFORMANCE OPTIMIZATIONS:
 * 1. Frustum culling - skip rendering entities outside camera view
 * 2. Distance culling - hide monsters far from player characters (saves GPU + CPU)
 */
export class RenderSystem {
  private world: World;
  private entityFactory: EntityFactory | null = null;
  private localCharIds: Set<string> = new Set(); // Track local character IDs
  private selectedCharIds: Set<string> = new Set(); // Track which local chars are selected
  private localTeam: number = 1; // Track local player's team
  
  // Frustum culling
  private camera: THREE.Camera | null = null;
  private frustum: THREE.Frustum = new THREE.Frustum();
  private projScreenMatrix: THREE.Matrix4 = new THREE.Matrix4();
  private cullCheckCounter: number = 0;
  private readonly CULL_CHECK_INTERVAL = 3; // Check frustum every 3 frames for performance
  
  // Distance culling for monsters
  private readonly MONSTER_RENDER_DISTANCE_SQ = 100 * 100; // 100 units squared for faster comparison
  private localCharPositions: THREE.Vector3[] = []; // Cache local character positions

  constructor(world: World) {
    this.world = world;
  }
  
  /**
   * Set camera reference for frustum culling
   */
  public setCamera(camera: THREE.Camera): void {
    this.camera = camera;
  }
  
  /**
   * Set entity factory reference for health bar updates
   */
  public setEntityFactory(factory: EntityFactory): void {
    this.entityFactory = factory;
  }
  
  /**
   * Register a local character (to hide their HP bar)
   */
  public registerLocalChar(networkId: string): void {
    this.localCharIds.add(networkId);
  }
  
  /**
   * Set the local player's team
   */
  public setLocalTeam(team: number): void {
    this.localTeam = team;
  }
  
  /**
   * Update which characters are selected (for selection ring)
   */
  public setSelectedChars(selectedIds: Set<string>): void {
    this.selectedCharIds = selectedIds;
  }

  /**
   * Update renderable entities
   * Position updates are handled by MovementSystem (local) and NetworkSystem (remote)
   */
  public update(_alpha: number): void {
    // Update frustum for culling (every N frames for performance)
    this.cullCheckCounter++;
    const shouldUpdateFrustum = this.cullCheckCounter >= this.CULL_CHECK_INTERVAL;
    
    if (shouldUpdateFrustum && this.camera) {
      this.cullCheckCounter = 0;
      this.camera.updateMatrixWorld();
      this.projScreenMatrix.multiplyMatrices(
        this.camera.projectionMatrix,
        this.camera.matrixWorldInverse
      );
      this.frustum.setFromProjectionMatrix(this.projScreenMatrix);
      
      // Cache local character positions for distance culling
      this.updateLocalCharPositions();
    }
    
    for (const entityId of this.world.query('transform', 'renderable')) {
      this.updateEntity(entityId, shouldUpdateFrustum);
    }
  }
  
  /**
   * Cache local character positions for distance culling
   */
  private updateLocalCharPositions(): void {
    this.localCharPositions = [];
    
    for (const networkId of this.localCharIds) {
      const entityId = this.world.getEntityByNetworkId(networkId);
      if (entityId) {
        const transform = this.world.getComponent(entityId, 'transform');
        if (transform) {
          this.localCharPositions.push(transform.position.clone());
        }
      }
    }
  }
  
  /**
   * Check if a position is within render distance of any local character
   */
  private isWithinRenderDistance(position: THREE.Vector3): boolean {
    for (const charPos of this.localCharPositions) {
      const dx = position.x - charPos.x;
      const dz = position.z - charPos.z;
      const distSq = dx * dx + dz * dz;
      
      if (distSq <= this.MONSTER_RENDER_DISTANCE_SQ) {
        return true;
      }
    }
    return false;
  }

  private updateEntity(entityId: string, updateCulling: boolean): void {
    const transform = this.world.getComponent(entityId, 'transform')!;
    const renderable = this.world.getComponent(entityId, 'renderable')!;
    const networkSync = this.world.getComponent(entityId, 'networkSync');
    const health = this.world.getComponent(entityId, 'health');
    const entityType = this.world.getComponent(entityId, 'entityType');
    const monsterData = this.world.getComponent(entityId, 'monsterData');
    
    // Don't cull local player characters (always render them)
    const isLocalChar = networkSync && this.localCharIds.has(networkSync.networkId);
    
    if (updateCulling && !isLocalChar) {
      // DISTANCE CULLING for monsters: Hide monsters far from player characters
      // This is more aggressive than frustum culling and saves significant GPU/CPU
      if (monsterData && this.localCharPositions.length > 0) {
        if (!this.isWithinRenderDistance(transform.position)) {
          renderable.mesh.visible = false;
          return; // Skip all updates for distant monsters
        }
      }
      
      // FRUSTUM CULLING: Skip rendering entities outside camera view
      if (this.camera) {
        // Check if entity is inside view frustum with a margin
        // Use a larger bounding sphere for monsters to avoid pop-in
        const cullRadius = monsterData ? 5 : 3;
        const inFrustum = this.frustum.containsPoint(transform.position) || 
          this.isNearFrustum(transform.position, cullRadius);
        
        if (!inFrustum) {
          renderable.mesh.visible = false;
          return; // Skip all other updates for culled entities
        }
      }
    }

    // Position is handled by:
    // - MovementSystem for local player (immediate)
    // - NetworkSystem for remote players (interpolated)
    // Only update position for entities without network sync (static objects, effects)
    if (!networkSync) {
      renderable.mesh.position.copy(transform.position);
    }
    
    // Update face rotation (for facing direction) - rotate the faceGroup, not the whole mesh
    // This keeps HP bar and selection ring upright while the character face rotates
    const faceGroup = renderable.mesh.getObjectByName('faceGroup');
    if (faceGroup) {
      faceGroup.rotation.y = transform.rotation.y;
    } else {
      // Fallback for non-champion entities (monsters)
      renderable.mesh.rotation.copy(transform.rotation);
    }
    
    // Update visibility
    renderable.mesh.visible = renderable.visible;
    
    // Handle selection ring (for local characters)
    const selectionRing = renderable.mesh.getObjectByName('selectionRing') as THREE.Mesh;
    if (selectionRing && networkSync) {
      const isLocalChar = this.localCharIds.has(networkSync.networkId);
      const isSelected = this.selectedCharIds.has(networkSync.networkId);
      
      // Show selection ring only for selected local characters
      selectionRing.visible = isLocalChar && isSelected;
      
      // Animate the selection ring (rotate slowly)
      if (selectionRing.visible) {
        selectionRing.rotation.z += 0.02;
      }
    }
    
    // Handle health bar (LoL-style sprite)
    const healthBarSprite = renderable.mesh.getObjectByName('healthBarSprite') as THREE.Sprite;
    const levelIndicator = renderable.mesh.getObjectByName('levelIndicator') as THREE.Sprite;
    
    if (healthBarSprite) {
      // Determine if this is a local character (hide HP bar for own chars)
      const isLocalChar = networkSync && this.localCharIds.has(networkSync.networkId);
      
      // Hide HP bar for local characters, show for enemies and monsters
      if (isLocalChar) {
        healthBarSprite.visible = false;
        if (levelIndicator) levelIndicator.visible = false;
      } else {
        healthBarSprite.visible = true;
        if (levelIndicator) levelIndicator.visible = true;
        
        // Update health bar with current health
        if (health && this.entityFactory) {
          const healthPercent = Math.max(0, health.current / health.max);
          
          // Determine if enemy based on team
          const isEnemy = entityType && entityType.team !== this.localTeam && entityType.team !== 0;
          
          this.entityFactory.updateHealthBar(healthBarSprite, healthPercent, isEnemy);
        }
      }
    }
  }
  
  /**
   * Check if a point is near the frustum (within margin)
   * Used to avoid pop-in at frustum edges
   */
  private isNearFrustum(point: THREE.Vector3, margin: number): boolean {
    // Check distance to each frustum plane
    const planes = this.frustum.planes;
    for (let i = 0; i < 6; i++) {
      const plane = planes[i];
      if (!plane) continue;
      const distance = plane.distanceToPoint(point);
      // If the point is outside but within margin, consider it "near"
      if (distance < -margin) {
        return false;
      }
    }
    return true;
  }
}

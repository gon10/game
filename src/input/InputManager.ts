import * as THREE from 'three';

type EventCallback = (...args: unknown[]) => void;

/**
 * Targetable entity data for raycasting
 */
interface TargetableEntity {
  mesh: THREE.Object3D;
  entityId: string;
  networkId: string;
  team: number;
}

/**
 * Selected target info for UI display
 */
export interface SelectedTargetInfo {
  entityId: string;
  networkId: string;
  team: number;
  position: THREE.Vector3;
}

/**
 * Input Manager - Handles mouse/keyboard input like LoL
 * - Left-click: Select target (show info)
 * - Right-click on enemy: Attack
 * - Right-click on ground: Move
 */
export class InputManager {
  private canvas: HTMLCanvasElement;
  private camera: THREE.Camera;
  private ground: THREE.Mesh;
  
  // Raycaster for click detection
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  
  // Event emitter
  private listeners: Map<string, EventCallback[]> = new Map();
  
  // Click state for drag-to-move
  private isRightMouseDown = false;
  
  // Targetable entities for combat
  private targetableEntities: TargetableEntity[] = [];
  
  // Pickupable ground items
  private pickupableItems: Map<string, { mesh: THREE.Object3D; networkId: string }> = new Map();
  
  // Hover highlight system
  private targetIndicator: THREE.Mesh | null = null;
  private currentHoveredEntity: TargetableEntity | null = null;
  
  // Selected target (left-click selection)
  private selectedTarget: TargetableEntity | null = null;
  private selectionIndicator: THREE.Mesh | null = null;
  
  private localTeam: number = 0;

  constructor(canvas: HTMLCanvasElement, camera: THREE.Camera, ground: THREE.Mesh) {
    this.canvas = canvas;
    this.camera = camera;
    this.ground = ground;
    
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    
    // Create indicators
    this.createTargetIndicator();
    this.createSelectionIndicator();
    
    this.setupEventListeners();
  }

  /**
   * Create the hover target indicator (ring under enemies)
   */
  private createTargetIndicator(): void {
    const geometry = new THREE.RingGeometry(0.8, 1.0, 32);
    geometry.rotateX(-Math.PI / 2); // Lay flat on ground
    
    const material = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    
    this.targetIndicator = new THREE.Mesh(geometry, material);
    this.targetIndicator.visible = false;
    this.targetIndicator.renderOrder = 1;
  }

  /**
   * Create the selection indicator (brighter ring for selected target)
   */
  private createSelectionIndicator(): void {
    const geometry = new THREE.RingGeometry(0.9, 1.1, 32);
    geometry.rotateX(-Math.PI / 2);
    
    const material = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    
    this.selectionIndicator = new THREE.Mesh(geometry, material);
    this.selectionIndicator.visible = false;
    this.selectionIndicator.renderOrder = 2;
  }

  /**
   * Get the target indicator mesh (to add to scene)
   */
  public getTargetIndicator(): THREE.Mesh | null {
    return this.targetIndicator;
  }

  /**
   * Get the selection indicator mesh (to add to scene)
   */
  public getSelectionIndicator(): THREE.Mesh | null {
    return this.selectionIndicator;
  }

  /**
   * Get currently selected target info for UI
   */
  public getSelectedTarget(): SelectedTargetInfo | null {
    if (!this.selectedTarget) return null;
    
    const worldPos = new THREE.Vector3();
    this.selectedTarget.mesh.getWorldPosition(worldPos);
    
    return {
      entityId: this.selectedTarget.entityId,
      networkId: this.selectedTarget.networkId,
      team: this.selectedTarget.team,
      position: worldPos,
    };
  }

  /**
   * Set the local player's team for determining enemy highlighting
   */
  public setLocalTeam(team: number): void {
    this.localTeam = team;
  }

  /**
   * Register a targetable entity (champion or monster)
   */
  public registerTargetable(
    mesh: THREE.Object3D,
    entityId: string,
    networkId: string,
    team: number
  ): void {
    console.log(`[Input] registerTargetable: entityId=${entityId}, networkId=${networkId}, team=${team}, mesh=${mesh?.type}`);
    
    // Check if already registered
    const existing = this.targetableEntities.find(t => t.entityId === entityId);
    if (existing) {
      existing.mesh = mesh;
      existing.team = team;
      return;
    }
    
    this.targetableEntities.push({ mesh, entityId, networkId, team });
    console.log(`[Input] Total targetables: ${this.targetableEntities.length}`);
  }

  /**
   * Register a pickupable ground item
   */
  public registerPickupable(mesh: THREE.Object3D, networkId: string): void {
    console.log(`[Input] registerPickupable: networkId=${networkId}`);
    this.pickupableItems.set(networkId, { mesh, networkId });
  }

  /**
   * Unregister a pickupable ground item
   */
  public unregisterPickupable(networkId: string): void {
    this.pickupableItems.delete(networkId);
  }

  /**
   * Unregister a targetable entity
   */
  public unregisterTargetable(entityId: string): void {
    const index = this.targetableEntities.findIndex(t => t.entityId === entityId);
    if (index !== -1) {
      this.targetableEntities.splice(index, 1);
    }
    
    // Clear hover if this was the hovered entity
    if (this.currentHoveredEntity?.entityId === entityId) {
      this.clearHover();
    }
    
    // Clear selection if this was the selected entity
    if (this.selectedTarget?.entityId === entityId) {
      this.clearSelection();
    }
  }

  private setupEventListeners(): void {
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    this.canvas.addEventListener('mouseup', this.onMouseUp);
    this.canvas.addEventListener('mousemove', this.onMouseMove);
  }

  private onMouseDown = (event: MouseEvent): void => {
    if (event.button === 2) { // Right click - MOVE or ATTACK
      this.isRightMouseDown = true;
      this.handleRightClick(event);
    } else if (event.button === 0) { // Left click - SELECT only
      this.handleLeftClick(event);
    }
  };

  private onMouseUp = (event: MouseEvent): void => {
    if (event.button === 2) {
      this.isRightMouseDown = false;
    }
  };

  private onMouseMove = (event: MouseEvent): void => {
    // Update hover state
    this.updateHover(event);
    
    // Update selection indicator position if target is selected
    this.updateSelectionPosition();
    
    // Continuous movement while right-click is held (drag to move)
    if (this.isRightMouseDown) {
      this.handleRightClick(event);
    }
  };

  /**
   * Left-click: Pickup item or Select target (show HP/info) - NO movement or attack
   */
  private handleLeftClick(event: MouseEvent): void {
    this.updateMousePosition(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    // First check if clicking on a pickupable ground item
    const itemMeshes = Array.from(this.pickupableItems.values()).map(i => i.mesh);
    if (itemMeshes.length > 0) {
      const itemIntersects = this.raycaster.intersectObjects(itemMeshes, true);
      
      if (itemIntersects.length > 0) {
        const hitMesh = itemIntersects[0]!.object;
        // Find which item was clicked
        for (const [itemId, itemData] of this.pickupableItems) {
          if (itemData.mesh === hitMesh || this.isDescendant(hitMesh, itemData.mesh)) {
            console.log(`[Input] Left-click pickup item: ${itemId}`);
            this.emit('pickupItem', itemId);
            return;
          }
        }
      }
    }
    
    // Check if clicking on a targetable entity
    const meshes = this.targetableEntities.map(t => t.mesh);
    const entityIntersects = this.raycaster.intersectObjects(meshes, true);
    
    if (entityIntersects.length > 0) {
      const hitMesh = entityIntersects[0]!.object;
      const entity = this.targetableEntities.find(t => 
        t.mesh === hitMesh || t.mesh.children.includes(hitMesh) || this.isDescendant(hitMesh, t.mesh)
      );
      
      if (entity) {
        this.selectTarget(entity);
        return;
      }
    }
    
    // Clicked on nothing - deselect
    this.clearSelection();
  }

  /**
   * Right-click: Pickup item, Attack enemy, or Move to ground
   */
  private handleRightClick(event: MouseEvent): void {
    this.updateMousePosition(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    // First check if clicking on a pickupable ground item
    const itemMeshes = Array.from(this.pickupableItems.values()).map(i => i.mesh);
    if (itemMeshes.length > 0) {
      const itemIntersects = this.raycaster.intersectObjects(itemMeshes, true);
      
      if (itemIntersects.length > 0) {
        const hitMesh = itemIntersects[0]!.object;
        // Find which item was clicked
        for (const [itemId, itemData] of this.pickupableItems) {
          if (itemData.mesh === hitMesh || this.isDescendant(hitMesh, itemData.mesh)) {
            console.log(`[Input] Right-click pickup item: ${itemId}`);
            this.emit('pickupItem', itemId);
            return;
          }
        }
      }
    }
    
    // Then check if clicking on a targetable ENEMY entity
    const meshes = this.targetableEntities.map(t => t.mesh);
    const entityIntersects = this.raycaster.intersectObjects(meshes, true);
    
    console.log(`[Input] Right-click raycast: ${entityIntersects.length} hits, ${this.targetableEntities.length} targetables`);
    
    if (entityIntersects.length > 0) {
      const hitMesh = entityIntersects[0]!.object;
      const entity = this.targetableEntities.find(t => 
        t.mesh === hitMesh || t.mesh.children.includes(hitMesh) || this.isDescendant(hitMesh, t.mesh)
      );
      
      console.log(`[Input] Found entity: ${entity?.networkId ?? 'none'}, isValid: ${entity ? this.isValidTarget(entity) : 'N/A'}, localTeam: ${this.localTeam}, entityTeam: ${entity?.team}`);
      
      // Only attack if it's a valid target (enemy or monster)
      if (entity && this.isValidTarget(entity)) {
        console.log(`[Input] Right-click attack on: ${entity.networkId} (team: ${entity.team})`);
        // Select and attack
        this.selectTarget(entity);
        this.emit('attack', entity.networkId);
        return;
      }
    }
    
    // Not clicking on enemy - move to ground position
    const groundIntersection = this.getGroundIntersection(event);
    if (groundIntersection) {
      // Clear selection when right-clicking to move
      this.clearSelection();
      this.emit('move', groundIntersection.point.clone());
    }
  }

  /**
   * Select a target (for UI display)
   */
  private selectTarget(entity: TargetableEntity): void {
    this.selectedTarget = entity;
    
    if (this.selectionIndicator) {
      const worldPos = new THREE.Vector3();
      entity.mesh.getWorldPosition(worldPos);
      this.selectionIndicator.position.set(worldPos.x, 0.05, worldPos.z);
      
      // Color based on target type
      const material = this.selectionIndicator.material as THREE.MeshBasicMaterial;
      if (entity.team === this.localTeam) {
        material.color.setHex(0x00ff00); // Green for allies
      } else if (entity.team === 0) {
        material.color.setHex(0xffaa00); // Orange for monsters
      } else {
        material.color.setHex(0xff0000); // Red for enemies
      }
      
      this.selectionIndicator.visible = true;
    }
    
    // Emit selection event for UI
    this.emit('select', entity.networkId, entity.entityId);
  }

  /**
   * Clear target selection
   */
  private clearSelection(): void {
    this.selectedTarget = null;
    
    if (this.selectionIndicator) {
      this.selectionIndicator.visible = false;
    }
    
    this.emit('deselect');
  }

  /**
   * Update selection indicator position (target might move)
   */
  private updateSelectionPosition(): void {
    if (this.selectedTarget && this.selectionIndicator?.visible) {
      const worldPos = new THREE.Vector3();
      this.selectedTarget.mesh.getWorldPosition(worldPos);
      this.selectionIndicator.position.set(worldPos.x, 0.05, worldPos.z);
    }
  }

  /**
   * Update hover state for target indicator
   */
  private updateHover(event: MouseEvent): void {
    this.updateMousePosition(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    // Raycast against all targetable entities
    const meshes = this.targetableEntities.map(t => t.mesh);
    const intersects = this.raycaster.intersectObjects(meshes, true);
    
    if (intersects.length > 0) {
      const hitMesh = intersects[0]!.object;
      const entity = this.targetableEntities.find(t => 
        t.mesh === hitMesh || t.mesh.children.includes(hitMesh) || this.isDescendant(hitMesh, t.mesh)
      );
      
      if (entity) {
        this.showHover(entity);
        return;
      }
    }
    
    this.clearHover();
  }

  /**
   * Check if child is a descendant of parent
   */
  private isDescendant(child: THREE.Object3D, parent: THREE.Object3D): boolean {
    let current = child.parent;
    while (current) {
      if (current === parent) return true;
      current = current.parent;
    }
    return false;
  }

  /**
   * Check if entity is a valid attack target (enemy or neutral)
   */
  private isValidTarget(entity: TargetableEntity): boolean {
    return entity.team !== this.localTeam || entity.team === 0;
  }

  /**
   * Show hover indicator on entity
   */
  private showHover(entity: TargetableEntity): void {
    // Don't show hover indicator if this entity is already selected
    if (this.selectedTarget?.entityId === entity.entityId) {
      this.clearHover();
      return;
    }
    
    if (this.currentHoveredEntity === entity) return;
    
    this.currentHoveredEntity = entity;
    
    if (this.targetIndicator) {
      const worldPos = new THREE.Vector3();
      entity.mesh.getWorldPosition(worldPos);
      this.targetIndicator.position.set(worldPos.x, 0.05, worldPos.z);
      
      // Color based on team
      const material = this.targetIndicator.material as THREE.MeshBasicMaterial;
      if (entity.team === this.localTeam) {
        material.color.setHex(0x00ff00); // Green for allies
      } else if (entity.team === 0) {
        material.color.setHex(0xffaa00); // Orange for monsters
      } else {
        material.color.setHex(0xff0000); // Red for enemies
      }
      
      this.targetIndicator.visible = true;
    }
    
    // Change cursor based on target type
    if (this.isValidTarget(entity)) {
      this.canvas.style.cursor = 'crosshair'; // Attack cursor for enemies
    } else {
      this.canvas.style.cursor = 'pointer'; // Select cursor for allies
    }
  }

  /**
   * Clear hover state
   */
  private clearHover(): void {
    this.currentHoveredEntity = null;
    
    if (this.targetIndicator) {
      this.targetIndicator.visible = false;
    }
    
    this.canvas.style.cursor = 'default';
  }

  private getGroundIntersection(event: MouseEvent): THREE.Intersection | null {
    this.updateMousePosition(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    const intersects = this.raycaster.intersectObject(this.ground);
    return intersects.length > 0 ? intersects[0]! : null;
  }

  private updateMousePosition(event: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  /**
   * Update - process per-frame updates
   */
  public update(): void {
    // Update selection indicator position each frame
    this.updateSelectionPosition();
  }

  /**
   * Event emitter methods
   */
  public on(event: string, callback: EventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  public off(event: string, callback: EventCallback): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index !== -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  private emit(event: string, ...args: unknown[]): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      for (const callback of callbacks) {
        callback(...args);
      }
    }
  }

  public dispose(): void {
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('mousemove', this.onMouseMove);
    this.listeners.clear();
    this.targetableEntities.length = 0;
    this.pickupableItems.clear();
    
    if (this.targetIndicator) {
      this.targetIndicator.geometry.dispose();
      (this.targetIndicator.material as THREE.Material).dispose();
    }
    
    if (this.selectionIndicator) {
      this.selectionIndicator.geometry.dispose();
      (this.selectionIndicator.material as THREE.Material).dispose();
    }
  }
}

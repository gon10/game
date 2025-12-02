import { Components, ComponentType } from './components';

/**
 * ECS World - Manages all entities and their components
 * Uses a sparse set architecture for cache-friendly iteration
 */
export class World {
  private nextEntityId = 0;
  private entities: Set<string> = new Set();
  
  // Component storage: componentType -> entityId -> component
  private components: Map<ComponentType, Map<string, Components[ComponentType]>> = new Map();
  
  // Entity to components mapping for fast lookups
  private entityComponents: Map<string, Set<ComponentType>> = new Map();

  constructor() {
    // Initialize component stores
    const componentTypes: ComponentType[] = [
      'transform', 'velocity', 'health', 'movement',
      'renderable', 'networkSync', 'combat', 'entityType',
      'animation', 'projectile', 'mana', 'ability', 'talismanInventory',
      'experience', 'monsterData'
    ];
    
    for (const type of componentTypes) {
      this.components.set(type, new Map());
    }
  }

  /**
   * Create a new entity and return its ID
   */
  public createEntity(id?: string): string {
    const entityId = id ?? `entity_${this.nextEntityId++}`;
    this.entities.add(entityId);
    this.entityComponents.set(entityId, new Set());
    return entityId;
  }

  /**
   * Destroy an entity and all its components
   */
  public destroyEntity(entityId: string): void {
    const componentSet = this.entityComponents.get(entityId);
    if (componentSet) {
      for (const componentType of componentSet) {
        this.components.get(componentType)?.delete(entityId);
      }
    }
    this.entityComponents.delete(entityId);
    this.entities.delete(entityId);
  }

  /**
   * Check if an entity exists
   */
  public hasEntity(entityId: string): boolean {
    return this.entities.has(entityId);
  }

  /**
   * Add a component to an entity
   */
  public addComponent<T extends ComponentType>(
    entityId: string,
    type: T,
    component: Components[T]
  ): void {
    const store = this.components.get(type);
    if (store) {
      store.set(entityId, component);
      this.entityComponents.get(entityId)?.add(type);
    }
  }

  /**
   * Get a component from an entity
   */
  public getComponent<T extends ComponentType>(
    entityId: string,
    type: T
  ): Components[T] | undefined {
    return this.components.get(type)?.get(entityId) as Components[T] | undefined;
  }

  /**
   * Check if an entity has a component
   */
  public hasComponent(entityId: string, type: ComponentType): boolean {
    return this.components.get(type)?.has(entityId) ?? false;
  }

  /**
   * Remove a component from an entity
   */
  public removeComponent(entityId: string, type: ComponentType): void {
    this.components.get(type)?.delete(entityId);
    this.entityComponents.get(entityId)?.delete(type);
  }

  /**
   * Query entities that have all specified components
   * Returns an iterator for memory efficiency
   */
  public *query(...componentTypes: ComponentType[]): Generator<string> {
    for (const entityId of this.entities) {
      let hasAll = true;
      for (const type of componentTypes) {
        if (!this.hasComponent(entityId, type)) {
          hasAll = false;
          break;
        }
      }
      if (hasAll) {
        yield entityId;
      }
    }
  }

  /**
   * Get all entities with specific components as an array
   */
  public queryAll(...componentTypes: ComponentType[]): string[] {
    return [...this.query(...componentTypes)];
  }

  /**
   * Get entity by network ID
   */
  public getEntityByNetworkId(networkId: string): string | undefined {
    for (const entityId of this.query('networkSync')) {
      const sync = this.getComponent(entityId, 'networkSync');
      if (sync?.networkId === networkId) {
        return entityId;
      }
    }
    return undefined;
  }

  /**
   * Get all entities
   */
  public getAllEntities(): string[] {
    return [...this.entities];
  }

  /**
   * Clear all entities and components
   */
  public clear(): void {
    for (const store of this.components.values()) {
      store.clear();
    }
    this.entityComponents.clear();
    this.entities.clear();
    this.nextEntityId = 0;
  }
}

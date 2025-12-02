import * as THREE from 'three';
import { Renderer } from './Renderer';
import { GameCamera } from './Camera';
import { World } from '../ecs/World';
import { InputManager } from '../input/InputManager';
import { NetworkClient, SpawnData, StateUpdate } from '../network/Client';
import { MovementSystem } from '../ecs/systems/MovementSystem';
import { RenderSystem } from '../ecs/systems/RenderSystem';
import { NetworkSystem } from '../ecs/systems/NetworkSystem';
import { CombatSystem } from '../ecs/systems/CombatSystem';
import { AbilitySystem } from '../ecs/systems/AbilitySystem';
import { Terrain } from '../entities/Terrain';
import { EntityFactory } from '../entities/EntityFactory';
import { ElementType } from '../types/CharacterTypes';
import { AbilityLevel } from '../ecs/components';

/**
 * Main Game class - orchestrates the entire game with a fixed timestep loop
 * Uses a semi-fixed timestep for physics/logic and variable timestep for rendering
 */
export class Game {
  private renderer: Renderer;
  private camera: GameCamera;
  private scene: THREE.Scene;
  private world: World;
  private inputManager: InputManager;
  private network: NetworkClient;
  private entityFactory: EntityFactory;
  private terrain: Terrain;

  // Systems
  private movementSystem: MovementSystem;
  private renderSystem: RenderSystem;
  private networkSystem: NetworkSystem;
  private combatSystem: CombatSystem;
  private abilitySystem: AbilitySystem;

  // Game loop timing
  private isRunning = false;
  private lastTime = 0;
  private accumulator = 0;
  private readonly FIXED_TIMESTEP = 1000 / 60; // 60 Hz physics/logic
  private readonly MAX_FRAME_TIME = 250; // Prevent spiral of death

  // Performance monitoring
  private frameCount = 0;
  private fpsTime = 0;
  public fps = 0;
  
  // Multi-character selection (each player controls 3 chars)
  private playerId: string;
  public readonly selectedTypes: ElementType[]; // The 3 element types this player chose
  private myCharIds: string[] = []; // IDs of my 3 characters
  private selectedChars: Set<number> = new Set([0, 1, 2]); // Which chars are selected (0, 1, 2 = all by default)
  
  // Track dead characters with respawn times
  private deadCharacters: Map<string, { respawnAt: number }> = new Map();
  
  // Player inventory (resources, talismans, consumables)
  private playerInventory: unknown = null;
  
  // Event emitter for UI updates
  private eventListeners: Map<string, Set<(...args: unknown[]) => void>> = new Map();

  constructor(
    canvas: HTMLCanvasElement, 
    network: NetworkClient,
    playerId?: string,
    selectedTypes?: ElementType[]
  ) {
    this.playerId = playerId || '';
    this.selectedTypes = selectedTypes || [];
    
    // Create scene first
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);

    // Initialize renderer with performance settings
    this.renderer = new Renderer(canvas);

    // Initialize camera (isometric-style for LoL feel)
    this.camera = new GameCamera(canvas);

    // Initialize ECS world
    this.world = new World();

    // Initialize entity factory (manages object pools)
    this.entityFactory = new EntityFactory(this.scene, this.world);

    // Initialize terrain
    this.terrain = new Terrain(this.scene);

    // Initialize input manager
    this.inputManager = new InputManager(canvas, this.camera.camera, this.terrain.ground);

    // Store network reference
    this.network = network;

    // Initialize systems
    this.movementSystem = new MovementSystem(this.world);
    this.renderSystem = new RenderSystem(this.world);
    this.renderSystem.setEntityFactory(this.entityFactory); // For health bar updates
    this.renderSystem.setCamera(this.camera.camera); // For frustum culling
    this.networkSystem = new NetworkSystem(this.world, this.network, this.entityFactory);
    this.combatSystem = new CombatSystem(this.world, this.entityFactory);
    
    // Initialize ability system (needs scene for effects, and animation system for hit effects)
    this.abilitySystem = new AbilitySystem(
      this.world,
      this.entityFactory,
      this.scene,
      this.combatSystem.getAnimationSystem()
    );
    
    // Connect combat system to ability system for mana gain
    this.combatSystem.setAbilitySystem(this.abilitySystem);
    
    // Set up combat attack callback - sends attack to server when local char attacks
    this.combatSystem.setAttackCallback((attackerId: string, targetId: string, attackerPos: THREE.Vector3) => {
      // Check if target is a resource node
      const targetEntityId = this.world.getEntityByNetworkId(targetId);
      if (targetEntityId) {
        const entityType = this.world.getComponent(targetEntityId, 'entityType');
        if (entityType?.type === 'resource_node') {
          // Get attacker damage for node attack
          const attackerEntityId = this.world.getEntityByNetworkId(attackerId);
          const combat = attackerEntityId ? this.world.getComponent(attackerEntityId, 'combat') : null;
          const damage = combat?.attackDamage || 10;
          this.network.sendNodeAttack(targetId, attackerId, damage);
          return;
        }
      }
      // Normal attack
      this.network.sendAttack(targetId, attackerId, attackerPos);
    });
    
    // Set up ability callbacks
    this.abilitySystem.setAbilityCastCallback((casterId, targetId, abilityId, level) => {
      this.network.sendAbilityCast(casterId, targetId, abilityId, level);
    });
    this.abilitySystem.setTalismanPickupCallback((charId, elementType) => {
      this.network.sendTalismanPickup(charId, elementType);
    });
    this.abilitySystem.setAbilityUpgradeCallback((charId, newLevel) => {
      this.network.sendAbilityUpgrade(charId, newLevel);
    });

    // Setup network event handlers
    this.setupNetworkHandlers();

    // Setup input handlers
    this.setupInputHandlers();
    
    // Add target indicator and selection indicator to scene
    const targetIndicator = this.inputManager.getTargetIndicator();
    if (targetIndicator) {
      this.scene.add(targetIndicator);
    }
    const selectionIndicator = this.inputManager.getSelectionIndicator();
    if (selectionIndicator) {
      this.scene.add(selectionIndicator);
    }
    
    // Setup keyboard selection (1, 2, 3, A keys)
    this.setupKeyboardSelection();

    // Add ambient lighting
    this.setupLighting();
  }

  private setupLighting(): void {
    // Ambient light for base illumination
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    // Directional light for shadows and depth
    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(50, 100, 50);
    directional.castShadow = false; // Disable for performance, enable if needed
    this.scene.add(directional);
  }

  private setupNetworkHandlers(): void {
    this.network.on('connected', () => {
      console.log('[Game] Connected to server');
    });

    this.network.on('spawn', (data) => {
      const spawnData = data as SpawnData;
      console.log('[Game] Received spawn:', spawnData.id, spawnData.type, 'owner:', spawnData.ownerId, 'team:', spawnData.team);
      this.networkSystem.handleSpawn(spawnData);
      
      // Track which characters belong to us
      if (spawnData.ownerId === this.playerId || spawnData.id.startsWith(this.playerId + '_char')) {
        this.myCharIds.push(spawnData.id);
        console.log(`[Game] My character spawned: ${spawnData.id}, myCharIds now: [${this.myCharIds.join(', ')}]`);
        
        // Register as local char in combat system (to prevent double damage)
        this.combatSystem.registerLocalChar(spawnData.id);
        
        // Register as local char in ability system
        this.abilitySystem.registerLocalChar(spawnData.id);
        
        // Register in render system (to hide HP bar)
        this.renderSystem.registerLocalChar(spawnData.id);
        
        // Set local team based on first spawned character
        if (this.myCharIds.length === 1 && spawnData.team !== undefined) {
          this.inputManager.setLocalTeam(spawnData.team);
          this.renderSystem.setLocalTeam(spawnData.team);
          console.log(`[Game] Set local team to: ${spawnData.team}`);
        }
        
        // Update selection visuals after spawn
        this.updateSelectionVisuals();
      }
      
      // Register entity as targetable for click-to-attack
      // Since entityFactory.createEntity(networkId) passes networkId as the entity ID,
      // the entityId should equal networkId
      const entityId = this.world.getEntityByNetworkId(spawnData.id);
      console.log(`[Game] Looking up entity for networkId='${spawnData.id}': entityId='${entityId}'`);
      
      if (entityId) {
        const renderable = this.world.getComponent(entityId, 'renderable');
        const entityType = this.world.getComponent(entityId, 'entityType');
        const combat = this.world.getComponent(entityId, 'combat');
        const animation = this.world.getComponent(entityId, 'animation');
        
        console.log(`[Game] Entity ${entityId} components:`, {
          hasRenderable: !!renderable?.mesh,
          entityType: entityType?.type,
          team: entityType?.team,
          hasCombat: !!combat,
          hasAnimation: !!animation,
          animState: animation?.state,
        });
        
        if (renderable?.mesh && entityType) {
          this.inputManager.registerTargetable(
            renderable.mesh,
            entityId,
            spawnData.id,
            entityType.team
          );
          console.log(`[Game] Registered targetable: ${spawnData.id} (team ${entityType.team})`);
        }
      } else {
        console.warn(`[Game] Could not find entity for spawn: ${spawnData.id}`);
      }
    });

    this.network.on('state', (data) => {
      this.networkSystem.handleStateUpdate(data as StateUpdate);
    });

    this.network.on('playerLeft', (data) => {
      const leftData = data as { id: string };
      
      // Unregister from targetables
      const entityId = this.world.getEntityByNetworkId(leftData.id);
      if (entityId) {
        this.inputManager.unregisterTargetable(entityId);
      }
      
      this.networkSystem.handlePlayerLeft(leftData);
    });

    this.network.on('attack', (data) => {
      const attackData = data as { attackerId: string; targetId: string };
      console.log(`[Game] Received network attack: ${attackData.attackerId} -> ${attackData.targetId}`);
      this.combatSystem.handleNetworkAttack(attackData);
    });

    this.network.on('damage', (data) => {
      const damageData = data as { targetId: string; damage: number; health: number; attackerId?: string };
      console.log(`[Game] Received network damage: ${damageData.damage} to ${damageData.targetId} from ${damageData.attackerId}`);
      this.combatSystem.handleDamage(damageData);
    });

    // Ability-related network events
    this.network.on('abilityCast', (data) => {
      const castData = data as { casterId: string; targetId: string; abilityId: string; level: AbilityLevel };
      console.log(`[Game] Received ability cast: ${castData.abilityId} from ${castData.casterId}`);
      this.abilitySystem.handleNetworkAbilityCast(castData);
    });

    this.network.on('abilityDamage', (data) => {
      const damageData = data as { targetId: string; damage: number; health: number; abilityId: string; casterId: string };
      console.log(`[Game] Received ability damage: ${damageData.damage} to ${damageData.targetId}`);
      this.abilitySystem.handleAbilityDamage(damageData);
    });

    this.network.on('abilityHeal', (data) => {
      const healData = data as { targetId: string; heal: number; health: number };
      console.log(`[Game] Received ability heal: ${healData.heal} to ${healData.targetId}`);
      this.abilitySystem.handleAbilityHeal(healData);
    });
    
    // Level-up effect handler
    this.network.on('levelUp', (data) => {
      const levelData = data as { playerId: string; charId?: string; newLevel: number; stats: { health: number; attackDamage: number } };
      console.log(`[Game] Player ${levelData.playerId} leveled up to ${levelData.newLevel}`);
      
      // Find the character entity to play the effect on
      // If charId is provided, use that; otherwise use the first character of the player
      let charNetworkId = levelData.charId;
      if (!charNetworkId && this.myCharIds.length > 0 && levelData.playerId === this.playerId) {
        charNetworkId = this.myCharIds[0];
      }
      
      if (charNetworkId) {
        const entityId = this.world.getEntityByNetworkId(charNetworkId);
        if (entityId) {
          const transform = this.world.getComponent(entityId, 'transform');
          if (transform) {
            // Spawn the level-up effect at the character's position
            this.abilitySystem.getAbilityEffectPool().spawnLevelUpEffect(
              transform.position,
              levelData.newLevel
            );
          }
          
          // Update the experience component if it exists
          const experience = this.world.getComponent(entityId, 'experience');
          if (experience) {
            experience.level = levelData.newLevel;
            experience.currentXP = 0; // Reset XP after level up
            experience.xpToNextLevel = Math.floor(100 * Math.pow(1.5, levelData.newLevel - 1));
          }
          
          // Update health if stats were provided
          const health = this.world.getComponent(entityId, 'health');
          if (health && levelData.stats) {
            health.max = levelData.stats.health;
            health.current = levelData.stats.health; // Full heal on level up
          }
          
          // Update level indicator on the mesh
          const renderable = this.world.getComponent(entityId, 'renderable');
          if (renderable?.mesh) {
            const levelIndicator = renderable.mesh.getObjectByName('levelIndicator') as THREE.Sprite;
            if (levelIndicator) {
              this.entityFactory.updateLevelIndicator(levelIndicator, levelData.newLevel);
            }
          }
        }
      }
    });
    
    // XP gain handler - update experience bar
    this.network.on('xpGain', (data) => {
      const xpData = data as { playerId: string; xp: number; source: string; monsterName?: string };
      console.log(`[Game] XP gained: ${xpData.xp} from ${xpData.source} (${xpData.monsterName || 'unknown'}) for ${xpData.playerId}`);
      
      // Update experience for all our characters (they share XP in this design)
      // playerId from server might be player_2 OR player_2_char0 (the character that got the kill)
      const isOurXP = xpData.playerId === this.playerId || xpData.playerId.startsWith(this.playerId + '_char');
      
      if (isOurXP) {
        console.log(`[Game] This is our XP! Updating ${this.myCharIds.length} characters`);
        for (const charNetworkId of this.myCharIds) {
          const entityId = this.world.getEntityByNetworkId(charNetworkId);
          if (entityId) {
            const experience = this.world.getComponent(entityId, 'experience');
            if (experience) {
              experience.currentXP += xpData.xp;
              console.log(`[Game] Character ${charNetworkId} XP: ${experience.currentXP}/${experience.xpToNextLevel}`);
              
              // Check for level up (client-side prediction - server will send authoritative levelUp)
              if (experience.currentXP >= experience.xpToNextLevel) {
                console.log(`[Game] Character ${charNetworkId} should level up soon!`);
              }
            }
          }
        }
      }
    });
    
    // Player death handler
    this.network.on('playerDeath', (data) => {
      const deathData = data as { playerId: string; respawnTime: number };
      console.log(`[Game] Player ${deathData.playerId} died, respawning in ${deathData.respawnTime}ms`);
      
      const entityId = this.world.getEntityByNetworkId(deathData.playerId);
      if (entityId) {
        // Mark as dead
        const health = this.world.getComponent(entityId, 'health');
        if (health) {
          health.isDead = true;
          health.current = 0;
        }
        
        // Disable controls if this is one of our characters
        if (this.myCharIds.includes(deathData.playerId)) {
          // Track death for UI
          this.deadCharacters.set(deathData.playerId, {
            respawnAt: Date.now() + deathData.respawnTime
          });
          
          const networkSync = this.world.getComponent(entityId, 'networkSync');
          if (networkSync) {
            networkSync.isLocal = false; // Temporarily disable local control
          }
          
          // Completely hide the character mesh
          const renderable = this.world.getComponent(entityId, 'renderable');
          if (renderable?.mesh) {
            renderable.mesh.visible = false;
          }
        }
      }
    });
    
    // Player respawn handler
    this.network.on('playerRespawn', (data) => {
      const respawnData = data as { playerId: string; x: number; z: number; health: number };
      console.log(`[Game] Player ${respawnData.playerId} respawned at (${respawnData.x}, ${respawnData.z})`);
      
      const entityId = this.world.getEntityByNetworkId(respawnData.playerId);
      if (entityId) {
        // Mark as alive
        const health = this.world.getComponent(entityId, 'health');
        if (health) {
          health.isDead = false;
          health.current = respawnData.health;
        }
        
        // Reset transform position, scale, and rotation
        const transform = this.world.getComponent(entityId, 'transform');
        if (transform) {
          transform.position.set(respawnData.x, 0, respawnData.z);
          transform.scale.set(1, 1, 1); // Reset scale from death shrink
          transform.rotation.set(0, 0, 0); // Reset rotation
        }
        
        // Reset animation state
        const animation = this.world.getComponent(entityId, 'animation');
        if (animation) {
          animation.state = 'idle';
          animation.progress = 0;
        }
        
        // Reset the mesh - position, rotation, scale, and opacity
        const renderable = this.world.getComponent(entityId, 'renderable');
        if (renderable?.mesh) {
          renderable.mesh.visible = true;
          renderable.mesh.position.set(respawnData.x, 0, respawnData.z);
          renderable.mesh.rotation.set(0, 0, 0); // Reset rotation from death fall-over
          renderable.mesh.scale.set(1, 1, 1); // Reset scale
          
          // Reset opacity on all materials
          renderable.mesh.traverse((child: THREE.Object3D) => {
            if (child instanceof THREE.Mesh && child.material) {
              const materials = Array.isArray(child.material) ? child.material : [child.material];
              for (const mat of materials) {
                if ('opacity' in mat) {
                  mat.opacity = 1;
                  mat.transparent = mat.opacity < 1;
                }
              }
            }
          });
        }
        
        // Re-enable controls if this is one of our characters
        if (this.myCharIds.includes(respawnData.playerId)) {
          // Clear death tracking
          this.deadCharacters.delete(respawnData.playerId);
          
          const networkSync = this.world.getComponent(entityId, 'networkSync');
          if (networkSync) {
            networkSync.isLocal = true; // Re-enable local control
          }
        }
      }
    });
    
    // Monster spawn handler
    this.network.on('monsterSpawn', (data) => {
      const monsterData = data as {
        id: string;
        typeId: string;
        x: number;
        z: number;
        health: number;
        maxHealth: number;
        level: number;
        elementType: string;
        shape: 'sphere' | 'cone' | 'cylinder' | 'box' | 'ellipsoid' | 'spike';
        color: number;
        glowColor: number;
        scale: number;
      };
      console.log(`[Game] Monster spawned: ${monsterData.id} (${monsterData.typeId}) at (${monsterData.x.toFixed(1)}, ${monsterData.z.toFixed(1)})`);
      
      // Check if already exists
      const existingEntity = this.world.getEntityByNetworkId(monsterData.id);
      if (existingEntity) {
        console.log(`[Game] Monster ${monsterData.id} already exists, skipping`);
        return;
      }
      
      // Create monster using the full data
      this.entityFactory.createMonsterFromData(monsterData);
      
      // Register as targetable
      const entityId = this.world.getEntityByNetworkId(monsterData.id);
      if (entityId) {
        const renderable = this.world.getComponent(entityId, 'renderable');
        const entityType = this.world.getComponent(entityId, 'entityType');
        
        if (renderable?.mesh && entityType) {
          this.inputManager.registerTargetable(
            renderable.mesh,
            entityId,
            monsterData.id,
            entityType.team
          );
          console.log(`[Game] Registered monster targetable: ${monsterData.id}`);
        }
      }
    });
    
    // Monster death handler
    this.network.on('monsterDeath', (data) => {
      const deathData = data as { monsterId: string; killerId: string; xpReward: number };
      console.log(`[Game] Monster ${deathData.monsterId} killed by ${deathData.killerId}, XP: ${deathData.xpReward}`);
      
      const entityId = this.world.getEntityByNetworkId(deathData.monsterId);
      if (entityId) {
        // Unregister from targetables
        this.inputManager.unregisterTargetable(entityId);
        
        // Remove entity
        const renderable = this.world.getComponent(entityId, 'renderable');
        if (renderable?.mesh) {
          this.scene.remove(renderable.mesh);
        }
        this.world.destroyEntity(entityId);
      }
    });
    
    // Monster attack handler - show monster attack animations and damage
    this.network.on('monsterAttack', (data) => {
      const attackData = data as { monsterId: string; targetId: string; damage: number; targetHealth: number };
      console.log(`[Game] Monster ${attackData.monsterId} attacked ${attackData.targetId} for ${attackData.damage} damage`);
      
      // Forward to combat system as a damage event
      this.combatSystem.handleDamage({
        targetId: attackData.targetId,
        damage: attackData.damage,
        health: attackData.targetHealth,
        attackerId: attackData.monsterId,
      });
    });
    
    // Resource node spawn handler
    this.network.on('nodeSpawn', (data) => {
      const nodeData = data as {
        id: string;
        typeId: string;
        name: string;
        x: number;
        z: number;
        health: number;
        maxHealth: number;
        color: number;
        glowColor: number;
        scale: number;
        shape: string;
      };
      console.log(`[Game] Resource node spawned: ${nodeData.id} (${nodeData.name}) at (${nodeData.x.toFixed(1)}, ${nodeData.z.toFixed(1)})`);
      
      // Check if already exists
      const existingEntity = this.world.getEntityByNetworkId(nodeData.id);
      if (existingEntity) {
        console.log(`[Game] Node ${nodeData.id} already exists, skipping`);
        return;
      }
      
      // Create resource node - pass name as nodeType for display
      this.entityFactory.createResourceNode({
        ...nodeData,
        nodeType: nodeData.name, // Use name for display purposes
      });
      
      // Register as targetable
      const entityId = this.world.getEntityByNetworkId(nodeData.id);
      if (entityId) {
        const renderable = this.world.getComponent(entityId, 'renderable');
        const entityType = this.world.getComponent(entityId, 'entityType');
        
        if (renderable?.mesh && entityType) {
          this.inputManager.registerTargetable(
            renderable.mesh,
            entityId,
            nodeData.id,
            0 // Neutral team
          );
          console.log(`[Game] Registered resource node targetable: ${nodeData.id}`);
        }
      }
    });
    
    // Resource node damaged handler
    this.network.on('nodeDamaged', (data) => {
      const damageData = data as { nodeId: string; health: number; maxHealth: number; attackerId: string };
      console.log(`[Game] Node ${damageData.nodeId} damaged, health: ${damageData.health}/${damageData.maxHealth}`);
      
      this.entityFactory.updateNodeHealth(damageData.nodeId, damageData.health, damageData.maxHealth);
    });
    
    // Resource node destroyed handler
    this.network.on('nodeDestroyed', (data) => {
      const destroyData = data as { nodeId: string };
      console.log(`[Game] Resource node ${destroyData.nodeId} destroyed`);
      
      const entityId = this.world.getEntityByNetworkId(destroyData.nodeId);
      if (entityId) {
        this.inputManager.unregisterTargetable(entityId);
        this.entityFactory.removeResourceNode(destroyData.nodeId);
      }
    });
    
    // Ground item spawn handler
    this.network.on('itemSpawn', (data) => {
      const itemData = data as {
        id: string;
        itemType: string;
        quantity: number;
        x: number;
        z: number;
        elementType?: string;
        despawnIn: number;
      };
      console.log(`[Game] Ground item spawned: ${itemData.id} (${itemData.itemType} x${itemData.quantity}) at (${itemData.x.toFixed(1)}, ${itemData.z.toFixed(1)})`);
      
      // Check if already exists
      const existingEntity = this.world.getEntityByNetworkId(itemData.id);
      if (existingEntity) {
        console.log(`[Game] Item ${itemData.id} already exists, skipping`);
        return;
      }
      
      // Create ground item
      this.entityFactory.createGroundItem(itemData);
      
      // Register as pickupable for click detection
      const newEntity = this.world.getEntityByNetworkId(itemData.id);
      if (newEntity) {
        const renderable = this.world.getComponent(newEntity, 'renderable');
        if (renderable?.mesh) {
          this.inputManager.registerPickupable(renderable.mesh, itemData.id);
        }
      }
    });
    
    // Ground item pickup handler
    this.network.on('itemPickup', (data) => {
      const pickupData = data as { itemId: string; playerId: string; charId?: string };
      console.log(`[Game] Item ${pickupData.itemId} picked up by ${pickupData.playerId}`);
      
      // Unregister from pickupable items
      this.inputManager.unregisterPickupable(pickupData.itemId);
      
      this.entityFactory.removeGroundItem(pickupData.itemId);
    });
    
    // Ground item despawn handler
    this.network.on('itemDespawn', (data) => {
      const despawnData = data as { itemId: string };
      console.log(`[Game] Item ${despawnData.itemId} despawned`);
      
      // Unregister from pickupable items
      this.inputManager.unregisterPickupable(despawnData.itemId);
      
      this.entityFactory.removeGroundItem(despawnData.itemId);
    });
    
    // Inventory update handler
    this.network.on('inventoryUpdate', (data) => {
      const invData = data as { playerId: string; inventory: unknown };
      console.log(`[Game] Inventory updated for ${invData.playerId}, my playerId: ${this.playerId}`);
      console.log(`[Game] Inventory data:`, JSON.stringify(invData.inventory));
      
      // Store inventory in game state for UI components to access
      if (invData.playerId === this.playerId) {
        this.playerInventory = invData.inventory;
        // Emit event for UI components
        console.log(`[Game] Emitting inventoryChanged event`);
        this.emit('inventoryChanged', this.playerInventory);
      } else {
        console.log(`[Game] Inventory update ignored - playerId mismatch`);
      }
    });
    
    // Consumable effect handler
    this.network.on('consumableEffect', (data) => {
      const effectData = data as { type: string; targetId: string; amount: number };
      console.log(`[Game] Consumable effect: ${effectData.type} on ${effectData.targetId} for ${effectData.amount}`);
      
      const entityId = this.world.getEntityByNetworkId(effectData.targetId);
      if (entityId) {
        const health = this.world.getComponent(entityId, 'health');
        if (health && effectData.type.includes('heal')) {
          // Apply heal
          health.current = Math.min(health.max, health.current + effectData.amount);
          
          // Show heal number
          const transform = this.world.getComponent(entityId, 'transform');
          if (transform) {
            this.entityFactory.spawnDamageNumber(transform.position, effectData.amount, { isHeal: true });
          }
        }
      }
    });
    
    // Talisman consumed handler (ability upgrade)
    this.network.on('talismanConsumed', (data) => {
      const consumeData = data as { playerId: string; charId: string; elementType: string };
      console.log(`[Game] Talisman consumed: ${consumeData.elementType} on ${consumeData.charId}`);
      
      // Play visual effect on character
      const entityId = this.world.getEntityByNetworkId(consumeData.charId);
      if (entityId) {
        const transform = this.world.getComponent(entityId, 'transform');
        if (transform) {
          // Spawn a glow effect
          this.abilitySystem.getAbilityEffectPool().spawnLevelUpEffect(
            transform.position,
            0 // Level 0 = just a small glow effect
          );
        }
      }
    });
  }

  private setupInputHandlers(): void {
    this.inputManager.on('move', (target) => {
      const targetVec = target as THREE.Vector3;
      
      // Move all selected characters
      for (const charIndex of this.selectedChars) {
        const charNetworkId = this.myCharIds[charIndex];
        if (!charNetworkId) continue;
        
        // Get entity ID from network ID
        const entityId = this.world.getEntityByNetworkId(charNetworkId);
        if (!entityId) continue;
        
        // Check if character is dead - can't move when dead!
        const health = this.world.getComponent(entityId, 'health');
        if (health?.isDead) {
          console.log(`[Game] Character ${charNetworkId} is dead, cannot move`);
          continue;
        }
        
        // Calculate offset for formation (spread chars slightly)
        const offset = new THREE.Vector3(
          (charIndex - 1) * 2, // Horizontal spread
          0,
          0
        );
        const charTarget = targetVec.clone().add(offset);
        
        // Set path and start moving (use entity ID)
        this.movementSystem.setMoveTarget(entityId, charTarget);
        
        // Also stop any ongoing attack when moving
        const combat = this.world.getComponent(entityId, 'combat');
        if (combat) {
          combat.isAttacking = false;
          combat.targetId = null;
        }
        
        // Send to server (use network ID)
        this.network.sendMoveMultiple([charNetworkId], charTarget);
      }
    });

    this.inputManager.on('attack', (targetId) => {
      console.log(`[Game] Attack event received, target: ${targetId}`);
      
      // Attack with all selected characters
      for (const charIndex of this.selectedChars) {
        const charNetworkId = this.myCharIds[charIndex];
        if (!charNetworkId) continue;
        
        // Get entity ID from network ID
        const entityId = this.world.getEntityByNetworkId(charNetworkId);
        if (!entityId) {
          console.warn(`[Game] Could not find entity for network ID: ${charNetworkId}`);
          continue;
        }
        
        // Check if character is dead - can't attack when dead!
        const health = this.world.getComponent(entityId, 'health');
        if (health?.isDead) {
          console.log(`[Game] Character ${charNetworkId} is dead, cannot attack`);
          continue;
        }
        
        console.log(`[Game] Char ${charIndex} (${charNetworkId}) -> entity ${entityId} attacking ${targetId}`);
        
        // Start attack locally for responsiveness
        // CombatSystem will send attacks to server via callback when in range
        this.combatSystem.startAttack(entityId, targetId as string);
      }
    });

    // Handle item pickup from clicking on ground items
    this.inputManager.on('pickupItem', (itemId) => {
      console.log(`[Game] Pickup item event received: ${itemId}`);
      
      // Use the first selected character to pick up the item
      for (const charIndex of this.selectedChars) {
        const charNetworkId = this.myCharIds[charIndex];
        if (!charNetworkId) continue;
        
        // Check if character is dead
        const entityId = this.world.getEntityByNetworkId(charNetworkId);
        if (entityId) {
          const health = this.world.getComponent(entityId, 'health');
          if (health?.isDead) {
            console.log(`[Game] Character ${charNetworkId} is dead, cannot pickup`);
            continue;
          }
        }
        
        // Send pickup request to server
        console.log(`[Game] Sending pickup request: item ${itemId} by char ${charNetworkId}`);
        this.network.sendItemPickup(itemId as string, charNetworkId);
        break; // Only one character picks up the item
      }
    });
  }

  /**
   * Setup keyboard controls for character selection
   * A - Select/deselect all
   * 1 - Toggle character 1
   * 2 - Toggle character 2
   * 3 - Toggle character 3
   */
  private setupKeyboardSelection(): void {
    window.addEventListener('keydown', this.handleKeyDown);
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    switch (event.key.toLowerCase()) {
      case 'a':
        // Toggle all selection
        if (this.selectedChars.size === 3) {
          // All selected - deselect all
          this.selectedChars.clear();
        } else {
          // Not all selected - select all
          this.selectedChars = new Set([0, 1, 2]);
        }
        this.updateSelectionVisuals();
        break;
        
      case '1':
        this.toggleCharSelection(0);
        break;
        
      case '2':
        this.toggleCharSelection(1);
        break;
        
      case '3':
        this.toggleCharSelection(2);
        break;
    }
  };

  private toggleCharSelection(index: number): void {
    if (this.selectedChars.has(index)) {
      // Allow deselecting even if it's the last one
      this.selectedChars.delete(index);
    } else {
      this.selectedChars.add(index);
    }
    this.updateSelectionVisuals();
  }

  private updateSelectionVisuals(): void {
    // Build set of selected character network IDs
    const selectedNetworkIds = new Set<string>();
    
    for (const charIndex of this.selectedChars) {
      const charNetworkId = this.myCharIds[charIndex];
      if (charNetworkId) {
        selectedNetworkIds.add(charNetworkId);
      }
    }
    
    // Update render system with selected chars (for selection ring)
    this.renderSystem.setSelectedChars(selectedNetworkIds);
    
    // Notify server of selection change (send indices as strings)
    this.network.sendCharSelection(Array.from(this.selectedChars).map(i => String(i)));
    
    console.log(`[Game] Selected characters: ${Array.from(this.selectedChars).map(i => i + 1).join(', ')}`);  
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();
    
    // Tell server we're ready to receive game data
    this.network.sendGameReady();
    console.log('[Game] Started and sent gameReady to server');
    
    this.gameLoop();
  }

  public stop(): void {
    this.isRunning = false;
  }

  private gameLoop = (): void => {
    if (!this.isRunning) return;

    const currentTime = performance.now();
    let frameTime = currentTime - this.lastTime;
    this.lastTime = currentTime;

    // Prevent spiral of death
    if (frameTime > this.MAX_FRAME_TIME) {
      frameTime = this.MAX_FRAME_TIME;
    }

    this.accumulator += frameTime;

    // Fixed timestep updates (physics, logic, networking)
    while (this.accumulator >= this.FIXED_TIMESTEP) {
      this.fixedUpdate(this.FIXED_TIMESTEP / 1000); // Convert to seconds
      this.accumulator -= this.FIXED_TIMESTEP;
    }

    // Variable timestep update (rendering, interpolation)
    const alpha = this.accumulator / this.FIXED_TIMESTEP;
    this.render(alpha);

    // FPS counter
    this.frameCount++;
    this.fpsTime += frameTime;
    if (this.fpsTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.fpsTime = 0;
    }

    requestAnimationFrame(this.gameLoop);
  };

  /**
   * Fixed timestep update - runs at exactly 60Hz
   * Used for physics, game logic, and network synchronization
   */
  private fixedUpdate(dt: number): void {
    // Process input buffer
    this.inputManager.update();

    // Update movement with pathfinding
    this.movementSystem.update(dt);

    // Update combat system (includes animations)
    this.combatSystem.update(dt);

    // Update ability system
    this.abilitySystem.update(dt);

    // Process network updates
    this.networkSystem.update(dt);
    
    // Update particle systems, damage numbers, and projectiles
    this.entityFactory.updateParticles(dt);

    // LoL-STYLE: Continuously send our position to server while moving
    // Send positions for all our characters
    this.positionSendCounter = (this.positionSendCounter || 0) + 1;
    if (this.positionSendCounter >= 3) { // Every 3 ticks = 20Hz
      this.positionSendCounter = 0;
      
      for (const charId of this.myCharIds) {
        const transform = this.world.getComponent(charId, 'transform');
        const movement = this.world.getComponent(charId, 'movement');
        
        if (transform && movement?.isMoving) {
          this.network.sendPositionForChar(charId, transform.position);
        }
      }
    }
    
    // Update camera to follow center of selected characters
    this.updateCameraFollow();
  }
  
  private positionSendCounter = 0;

  private updateCameraFollow(): void {
    if (this.myCharIds.length === 0) return;
    
    // Calculate center point of selected characters
    const center = new THREE.Vector3();
    let count = 0;
    
    for (const charIndex of this.selectedChars) {
      const charId = this.myCharIds[charIndex];
      if (!charId) continue;
      
      const transform = this.world.getComponent(charId, 'transform');
      if (transform) {
        center.add(transform.position);
        count++;
      }
    }
    
    if (count > 0) {
      center.divideScalar(count);
      this.camera.follow(center);
    }
  }

  /**
   * Variable timestep render - runs as fast as possible
   * Uses interpolation factor (alpha) for smooth rendering between fixed updates
   */
  private render(alpha: number): void {
    // Update render system with interpolation
    this.renderSystem.update(alpha);

    // Update camera
    this.camera.update();

    // Render scene
    this.renderer.render(this.scene, this.camera.camera);
  }

  /**
   * Get character data for UI display
   */
  public getCharacterData(): Array<{
    id: string;
    index: number;
    elementType: ElementType;
    health: number;
    maxHealth: number;
    isSelected: boolean;
    mana?: number;
    maxMana?: number;
    abilityLevel?: AbilityLevel;
    talismans?: Record<string, number>;
    level?: number;
    currentXP?: number;
    xpToNextLevel?: number;
    isDead?: boolean;
    respawnAt?: number;
  }> {
    // If we have spawned characters, use them
    if (this.myCharIds.length > 0) {
      return this.myCharIds.map((charId, index) => {
        const entityId = this.world.getEntityByNetworkId(charId);
        const health = entityId ? this.world.getComponent(entityId, 'health') : null;
        const entityType = entityId ? this.world.getComponent(entityId, 'entityType') : null;
        const mana = entityId ? this.world.getComponent(entityId, 'mana') : null;
        const ability = entityId ? this.world.getComponent(entityId, 'ability') : null;
        const talismanInventory = entityId ? this.world.getComponent(entityId, 'talismanInventory') : null;
        const experience = entityId ? this.world.getComponent(entityId, 'experience') : null;
        
        // Get death state from our tracking
        const deathInfo = this.deadCharacters.get(charId);
        
        return {
          id: charId,
          index,
          elementType: (entityType?.elementType || this.selectedTypes[index] || 'fire') as ElementType,
          health: health?.current ?? 100,
          maxHealth: health?.max ?? 100,
          isSelected: this.selectedChars.has(index),
          mana: mana?.current ?? 0,
          maxMana: mana?.max ?? 100,
          abilityLevel: ability?.level ?? 'M',
          talismans: talismanInventory?.talismans ?? {},
          level: experience?.level ?? 1,
          currentXP: experience?.currentXP ?? 0,
          xpToNextLevel: experience?.xpToNextLevel ?? 100,
          isDead: !!deathInfo,
          respawnAt: deathInfo?.respawnAt,
        };
      });
    }
    
    // Fallback: show selected types while waiting for spawns
    return this.selectedTypes.map((elementType, index) => ({
      id: `pending_${index}`,
      index,
      elementType,
      health: 100,
      maxHealth: 100,
      isSelected: this.selectedChars.has(index),
    }));
  }

  /**
   * Toggle character selection from UI
   */
  public toggleCharacterSelection(index: number): void {
    this.toggleCharSelection(index);
  }

  /**
   * Select all characters from UI
   */
  public selectAllCharacters(): void {
    if (this.selectedChars.size === 3) {
      // All selected - deselect all
      this.selectedChars.clear();
    } else {
      // Select all
      this.selectedChars = new Set([0, 1, 2]);
    }
    this.updateSelectionVisuals();
  }

  /**
   * Get the current selection set (for external reading)
   */
  public getSelectedChars(): Set<number> {
    return this.selectedChars;
  }

  /**
   * Get selected target info for UI display
   */
  public getSelectedTargetInfo(): {
    networkId: string;
    entityId: string;
    name: string;
    health: number;
    maxHealth: number;
    team: number;
    type: 'champion' | 'monster' | 'resource_node';
    elementType?: string;
    level?: number;
    monsterType?: string;
    nodeType?: string;
  } | null {
    const targetInfo = this.inputManager.getSelectedTarget();
    if (!targetInfo) return null;
    
    // Get entity components
    const health = this.world.getComponent(targetInfo.entityId, 'health');
    const entityType = this.world.getComponent(targetInfo.entityId, 'entityType');
    const experience = this.world.getComponent(targetInfo.entityId, 'experience');
    const monsterData = this.world.getComponent(targetInfo.entityId, 'monsterData');
    
    if (!health || !entityType) return null;
    
    // Generate a display name
    let name = 'Unknown';
    let level: number | undefined;
    let monsterType: string | undefined;
    let nodeType: string | undefined;
    
    if (entityType.type === 'monster') {
      // Format monster name from typeId
      if (monsterData?.typeId) {
        name = monsterData.typeId
          .replace(/([A-Z])/g, ' $1')
          .replace(/^./, (str: string) => str.toUpperCase())
          .trim();
        monsterType = name;
      } else {
        name = 'Monster';
        monsterType = 'Monster';
      }
      level = monsterData?.level;
    } else if (entityType.type === 'champion') {
      name = entityType.elementType 
        ? `${entityType.elementType.charAt(0).toUpperCase() + entityType.elementType.slice(1)} Champion`
        : 'Champion';
      level = experience?.level;
    } else if (entityType.type === 'resource_node') {
      // Resource node - get name from renderable mesh userData
      const renderable = this.world.getComponent(targetInfo.entityId, 'renderable');
      nodeType = renderable?.mesh?.userData?.nodeType || 'Resource Node';
      // Format node type name
      name = (nodeType || 'Resource Node')
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (str: string) => str.toUpperCase())
        .trim();
    }
    
    return {
      networkId: targetInfo.networkId,
      entityId: targetInfo.entityId,
      name,
      health: health.current,
      maxHealth: health.max,
      team: targetInfo.team,
      type: entityType.type as 'champion' | 'monster' | 'resource_node',
      elementType: entityType.elementType,
      level,
      monsterType,
      nodeType,
    };
  }

  /**
   * Get player inventory for UI
   */
  public getInventory(): unknown {
    return this.playerInventory;
  }

  /**
   * Register event listener for game events
   */
  public on(event: string, callback: (...args: unknown[]) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
  }

  /**
   * Remove event listener
   */
  public off(event: string, callback: (...args: unknown[]) => void): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  /**
   * Emit event to listeners
   */
  private emit(event: string, ...args: unknown[]): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      for (const callback of listeners) {
        callback(...args);
      }
    }
  }

  public dispose(): void {
    this.stop();
    window.removeEventListener('keydown', this.handleKeyDown);
    this.inputManager.dispose();
    this.renderer.dispose();
    this.terrain.dispose();
    this.entityFactory.dispose();
    this.abilitySystem.dispose();
    this.world.clear();
  }
}

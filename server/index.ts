import { WebSocketServer, WebSocket } from 'ws';
import { GameLoop } from './GameLoop';
import { PlayerSession } from './PlayerSession';
import { WorldState } from './WorldState';
import { LobbyManager, ElementType, Lobby } from './LobbyManager';
import { MonsterManager, MonsterSpawnEvent, MonsterDeathEvent, MonsterAttackEvent, XPGainEvent, getPlayerSpawnPosition } from './MonsterManager';
import { ResourceNodeManager, NodeDropEvent } from './ResourceNodeManager';
import { ItemManager } from './ItemManager';
import { ResourceNodeSpawnEvent } from '../src/types/ResourceNodeTypes';
import { GroundItemSpawnEvent } from '../src/types/ItemTypes';

const PORT = 3001;

interface PlayerInfo {
  id: string;
  name: string;
  ws: WebSocket;
}

/**
 * Game Server - Handles lobbies and multiplayer game
 */
class GameServer {
  private wss: WebSocketServer;
  private gameLoop: GameLoop;
  private worldState: WorldState;
  private monsterManager: MonsterManager;
  private resourceNodeManager: ResourceNodeManager;
  private itemManager: ItemManager;
  private sessions: Map<string, PlayerSession> = new Map();
  private players: Map<string, PlayerInfo> = new Map();
  private lobbyManager: LobbyManager;
  private nextPlayerId = 1;
  // Active games being played - maps lobbyId to game info
  private activeGames: Map<string, { players: string[], readyPlayers: Set<string>, lobby: Lobby }> = new Map();

  constructor() {
    this.worldState = new WorldState();
    this.monsterManager = new MonsterManager(this.worldState);
    this.resourceNodeManager = new ResourceNodeManager(this.worldState);
    this.itemManager = new ItemManager(this.worldState);
    this.gameLoop = new GameLoop(this.worldState, this.broadcast.bind(this));
    this.gameLoop.setMonsterManager(this.monsterManager);
    this.lobbyManager = new LobbyManager();
    
    // Set up monster manager callbacks
    this.setupMonsterCallbacks();
    
    // Set up player event callbacks
    this.setupPlayerCallbacks();
    
    // Set up resource node callbacks
    this.setupResourceNodeCallbacks();
    
    // Set up item manager callbacks
    this.setupItemCallbacks();
    
    // Set up ability tick callback to broadcast DoT damage/heals
    this.worldState.onAbilityTick((
      damages: Array<{ targetId: string; damage: number; health: number; effectiveness: 'super' | 'weak' | 'normal' }>,
      heals: Array<{ targetId: string; heal: number; health: number }>
    ) => {
      for (const damage of damages) {
        this.broadcast({
          type: 'abilityDamage',
          data: {
            targetId: damage.targetId,
            damage: damage.damage,
            health: damage.health,
            abilityId: 'leaf_storm',
            casterId: '',
            effectiveness: damage.effectiveness,
          },
        });
        
        // Sync monster health with MonsterManager's internal state
        if (damage.targetId.startsWith('monster_')) {
          if (damage.health <= 0) {
            // Find the caster from active abilities
            const activeAbility = this.worldState.getActiveAbilities().entries().next().value;
            const casterId = activeAbility ? activeAbility[0] : '';
            
            const killResult = this.monsterManager.handleAbilityKill(damage.targetId, casterId);
            if (killResult) {
              console.log(`[Server] Monster ${damage.targetId} killed by Leaf Storm DoT from ${casterId}`);
            }
          } else {
            // Sync the reduced health to MonsterManager's internal tracking
            this.monsterManager.syncMonsterHealthFromWorldState(damage.targetId);
          }
        }
      }
      for (const heal of heals) {
        this.broadcast({
          type: 'abilityHeal',
          data: {
            targetId: heal.targetId,
            heal: heal.heal,
            health: heal.health,
          },
        });
      }
    });
    
    this.wss = new WebSocketServer({ port: PORT });
    
    this.wss.on('connection', this.handleConnection.bind(this));
    
    console.log(`[Server] Game server running on port ${PORT}`);
    
    // Initialize monster spawns
    this.monsterManager.initializeSpawns();
    
    // Initialize resource nodes
    this.resourceNodeManager.initializeNodes();
    
    // Start the game loop
    this.gameLoop.start();
    
    // Start item manager update loop (for despawn checking only)
    // Auto-collect is disabled by default - players must click to pick up items
    setInterval(() => {
      this.itemManager.update(1); // 1 second delta for despawn
      
      // Auto-collect disabled by default - uncomment to enable:
      // for (const [playerId] of this.players) {
      //   this.itemManager.checkAutoCollect(playerId);
      // }
    }, 1000); // Check every second for despawns
  }

  /**
   * Set up monster manager event callbacks
   */
  private setupMonsterCallbacks(): void {
    // Monster spawn callback
    this.monsterManager.setOnMonsterSpawn((monster: MonsterSpawnEvent) => {
      this.broadcast({
        type: 'monsterSpawn',
        data: monster,
      });
    });

    // Monster death callback - also spawn drops
    this.monsterManager.setOnMonsterDeath((data: MonsterDeathEvent) => {
      this.broadcast({
        type: 'monsterDeath',
        data,
      });
      
      // Spawn drops based on monster tier
      const dropChance = 0.6 + (data.monsterTier * 0.1); // 70-90% drop chance based on tier
      if (Math.random() < dropChance) {
        // Gold drops (always)
        const goldAmount = 5 + data.monsterTier * 5 + Math.floor(Math.random() * 10);
        this.itemManager.spawnGroundItem('gold', goldAmount, data.x + (Math.random() - 0.5) * 2, data.z + (Math.random() - 0.5) * 2);
        
        // Resource drops based on element type
        if (Math.random() < 0.4 + data.monsterTier * 0.05) {
          const resourceType = data.elementType === 'rock' ? 'stone' : 'wood';
          const resourceAmount = 1 + Math.floor(data.monsterTier / 2);
          this.itemManager.spawnGroundItem(resourceType, resourceAmount, data.x + (Math.random() - 0.5) * 2, data.z + (Math.random() - 0.5) * 2);
        }
        
        // Talisman drop (rare, based on element)
        const talismanChance = 0.05 + data.monsterTier * 0.03; // 8-20% chance
        if (Math.random() < talismanChance) {
          const elementType = data.elementType as 'fire' | 'water' | 'grass' | 'electric' | 'rock' | 'psychic';
          this.itemManager.spawnGroundItem('talisman', 1, data.x + (Math.random() - 0.5) * 2, data.z + (Math.random() - 0.5) * 2, elementType);
        }
      }
    });

    // Monster attack callback
    this.monsterManager.setOnMonsterAttack((data: MonsterAttackEvent) => {
      this.broadcast({
        type: 'monsterAttack',
        data,
      });
    });

    // XP gain callback
    this.monsterManager.setOnPlayerXPGain((data: XPGainEvent) => {
      // Grant XP to player
      const result = this.worldState.grantXP(data.playerId, data.xp);
      
      // Broadcast XP gain
      this.broadcast({
        type: 'xpGain',
        data: {
          playerId: data.playerId,
          xp: data.xp,
          source: data.source,
          monsterName: data.monsterName,
        },
      });
      
      // If leveled up, the WorldState callback will handle it
      if (result.leveledUp) {
        console.log(`[Server] Player ${data.playerId} leveled up to ${result.newLevel}`);
      }
    });
  }

  /**
   * Set up player event callbacks
   */
  private setupPlayerCallbacks(): void {
    // Level up callback
    this.worldState.setOnPlayerLevelUp((data: { playerId: string; newLevel: number; stats: { health: number; attackDamage: number } }) => {
      this.broadcast({
        type: 'levelUp',
        data,
      });
    });

    // Player death callback
    this.worldState.setOnPlayerDeath((data: { playerId: string; respawnTime: number }) => {
      this.broadcast({
        type: 'playerDied',
        data,
      });
    });

    // Player respawn callback
    this.worldState.setOnPlayerRespawn((data: { playerId: string; x: number; z: number; health: number }) => {
      this.broadcast({
        type: 'playerRespawn',
        data,
      });
    });
  }

  /**
   * Set up resource node callbacks
   */
  private setupResourceNodeCallbacks(): void {
    // Node spawn callback
    this.resourceNodeManager.setOnNodeSpawn((node: ResourceNodeSpawnEvent) => {
      this.broadcast({
        type: 'nodeSpawn',
        data: node,
      });
    });

    // Node damaged callback
    this.resourceNodeManager.setOnNodeDamage((data) => {
      this.broadcast({
        type: 'nodeDamaged',
        data,
      });
    });

    // Node destroyed callback
    this.resourceNodeManager.setOnNodeDestroyed((data) => {
      this.broadcast({
        type: 'nodeDestroyed',
        data,
      });
    });

    // Node drop callback - spawn ground items
    this.resourceNodeManager.setOnNodeDrop((drop: NodeDropEvent) => {
      this.itemManager.spawnGroundItem(
        drop.dropType,
        drop.quantity,
        drop.x,
        drop.z,
        drop.elementType
      );
      console.log(`[Server] Spawned ${drop.quantity} ${drop.dropType} at (${drop.x.toFixed(1)}, ${drop.z.toFixed(1)})`);
    });
  }

  /**
   * Set up item manager callbacks
   */
  private setupItemCallbacks(): void {
    // Item spawn callback
    this.itemManager.setOnItemSpawn((item: GroundItemSpawnEvent) => {
      this.broadcast({
        type: 'itemSpawn',
        data: item,
      });
    });

    // Item pickup callback
    this.itemManager.setOnItemPickup((data) => {
      this.broadcast({
        type: 'itemPickup',
        data,
      });
    });

    // Item despawn callback
    this.itemManager.setOnItemDespawn((data) => {
      this.broadcast({
        type: 'itemDespawn',
        data,
      });
    });

    // Inventory update callback
    this.itemManager.setOnInventoryUpdate((playerId, inventory) => {
      // Send inventory update to specific player
      const player = this.players.get(playerId);
      if (player) {
        this.send(player.ws, {
          type: 'inventoryUpdate',
          data: {
            playerId,
            inventory,
          },
        });
      }
    });
  }

  private handleConnection(ws: WebSocket): void {
    const playerId = `player_${this.nextPlayerId++}`;
    
    // Store player connection
    this.players.set(playerId, { id: playerId, name: '', ws });
    
    console.log(`[Server] Player connected: ${playerId}`);
    
    // Send welcome message with player ID
    this.send(ws, {
      type: 'welcome',
      id: playerId,
    });
    
    // Handle messages
    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(playerId, message);
      } catch (error) {
        console.error('[Server] Failed to parse message:', error);
      }
    });
    
    // Handle disconnect
    ws.on('close', () => {
      console.log(`[Server] Player disconnected: ${playerId}`);
      
      // Handle lobby leave
      const { lobby, disbanded } = this.lobbyManager.leaveLobby(playerId);
      if (lobby && !disbanded) {
        this.broadcastToLobby(lobby, {
          type: 'lobbyUpdate',
          lobby: this.lobbyManager.serializeLobby(lobby),
        });
      }
      
      // Clean up all player game state (characters, session, inventory)
      this.cleanupPlayerGameState(playerId);
      
      // Remove from players map
      this.players.delete(playerId);
      
      // Broadcast player left to game
      this.broadcast({
        type: 'playerLeft',
        data: { id: playerId },
      });
    });
  }

  private handleMessage(playerId: string, message: Record<string, unknown>): void {
    const player = this.players.get(playerId);
    if (!player) return;
    
    switch (message.type) {
      // === LOBBY MESSAGES ===
      case 'setName':
        player.name = message.name as string;
        console.log(`[Server] Player ${playerId} set name to: ${player.name}`);
        break;
        
      case 'createLobby':
        this.handleCreateLobby(player, message.playerName as string, message.lobbyName as string);
        break;
        
      case 'joinLobby':
        this.handleJoinLobby(player, message.playerName as string, message.lobbyId as string);
        break;
        
      case 'joinLobbyByCode':
        this.handleJoinLobbyByCode(player, message.joinCode as string);
        break;
        
      case 'leaveLobby':
        this.handleLeaveLobby(playerId);
        break;
        
      case 'getLobbies':
        this.send(player.ws, {
          type: 'lobbyList',
          lobbies: this.lobbyManager.getAvailableLobbies(),
        });
        break;
        
      case 'toggleReady':
        this.handleToggleReady(playerId, message.selectedTypes as ElementType[]);
        break;
        
      case 'startGame':
        this.handleStartGame(playerId);
        break;
        
      // === GAME MESSAGES ===
      case 'gameReady':
        this.handleGameReady(playerId);
        break;
        
      case 'move':
        this.handleGameMove(playerId, message);
        break;
        
      case 'position':
        if (message.x !== undefined && message.z !== undefined) {
          this.worldState.setPlayerPosition(playerId, message.x as number, message.z as number);
        }
        break;
        
      case 'charPosition':
        // Position update for a specific character
        if (message.charId && message.x !== undefined && message.z !== undefined) {
          this.worldState.setPlayerPosition(message.charId as string, message.x as number, message.z as number);
        }
        break;
        
      case 'moveMultiple':
        // Move multiple characters to same target
        this.handleMoveMultiple(message);
        break;
        
      case 'attack':
        this.handleGameAttack(playerId, message);
        break;
        
      case 'abilityCast':
        this.handleAbilityCast(playerId, message);
        break;
        
      case 'talismanPickup':
        this.handleTalismanPickup(playerId, message);
        break;
        
      case 'abilityUpgrade':
        this.handleAbilityUpgrade(playerId, message);
        break;
        
      case 'selectChars':
        // Handle character selection in-game (keys 1, 2, 3, A)
        this.handleCharSelection(playerId, message.selected as number[]);
        break;
        
      // === RESOURCE NODE MESSAGES ===
      case 'attackNode':
        this.handleNodeAttack(playerId, message);
        break;
        
      // === ITEM MESSAGES ===
      case 'pickupItem':
        this.handleItemPickup(playerId, message);
        break;
        
      case 'consumeItem':
        this.handleConsumeItem(playerId, message);
        break;
        
      case 'purchaseConsumable':
        this.handlePurchaseConsumable(playerId, message);
        break;
    }
  }

  private handleCreateLobby(player: PlayerInfo, playerName: string, lobbyName: string): void {
    player.name = playerName;
    const lobby = this.lobbyManager.createLobby(player, lobbyName);
    
    this.send(player.ws, {
      type: 'lobbyCreated',
      lobby: this.lobbyManager.serializeLobby(lobby),
    });
  }

  private handleJoinLobby(player: PlayerInfo, playerName: string, lobbyId: string): void {
    player.name = playerName;
    const lobby = this.lobbyManager.joinLobby(player, lobbyId);
    
    if (lobby) {
      // Send to joining player
      this.send(player.ws, {
        type: 'lobbyJoined',
        lobby: this.lobbyManager.serializeLobby(lobby),
      });
      
      // Notify other players in lobby
      this.broadcastToLobby(lobby, {
        type: 'lobbyUpdate',
        lobby: this.lobbyManager.serializeLobby(lobby),
      }, player.id);
    } else {
      this.send(player.ws, {
        type: 'error',
        error: 'Failed to join lobby',
      });
    }
  }

  private handleJoinLobbyByCode(player: PlayerInfo, joinCode: string): void {
    const lobby = this.lobbyManager.joinLobbyByCode(player, joinCode);
    
    if (lobby) {
      // Send to joining player
      this.send(player.ws, {
        type: 'lobbyJoined',
        lobby: this.lobbyManager.serializeLobby(lobby),
      });
      
      // Notify other players in lobby
      this.broadcastToLobby(lobby, {
        type: 'lobbyUpdate',
        lobby: this.lobbyManager.serializeLobby(lobby),
      }, player.id);
    } else {
      this.send(player.ws, {
        type: 'error',
        error: 'Invalid join code or lobby is full',
      });
    }
  }

  private handleLeaveLobby(playerId: string): void {
    const { lobby, disbanded } = this.lobbyManager.leaveLobby(playerId);
    
    if (lobby && !disbanded) {
      this.broadcastToLobby(lobby, {
        type: 'lobbyUpdate',
        lobby: this.lobbyManager.serializeLobby(lobby),
      });
    }
    
    // Clean up player's game state
    this.cleanupPlayerGameState(playerId);
  }

  private handleToggleReady(playerId: string, selectedTypes: ElementType[]): void {
    const lobby = this.lobbyManager.toggleReady(playerId, selectedTypes);
    
    if (lobby) {
      this.broadcastToLobby(lobby, {
        type: 'lobbyUpdate',
        lobby: this.lobbyManager.serializeLobby(lobby),
      });
    }
  }

  private handleStartGame(playerId: string): void {
    const lobby = this.lobbyManager.startGame(playerId);
    
    if (lobby) {
      console.log(`[Server] Starting game for lobby: ${lobby.name}`);
      
      // Players spawn at outer edge of map in safe zones (no monsters nearby)
      // 5 spawn points at 72° intervals, at radius ~190 (edge of map)
      
      const playerIds: string[] = [];
      
      for (let playerIndex = 0; playerIndex < lobby.players.length; playerIndex++) {
        const lobbyPlayer = lobby.players[playerIndex]!;
        playerIds.push(lobbyPlayer.id);
        
        // Create session for game
        const session = new PlayerSession(lobbyPlayer.id, lobbyPlayer.ws);
        this.sessions.set(lobbyPlayer.id, session);
        
        // Initialize player inventory
        this.itemManager.initializePlayerInventory(lobbyPlayer.id);
        
        // Get spawn position from map config (outer edge safe zone)
        const spawnPos = getPlayerSpawnPosition(playerIndex);
        
        // Team is player index + 1 (1-5)
        const team = playerIndex + 1;
        
        // Spawn characters for each player, spread in small formation
        for (let i = 0; i < lobbyPlayer.selectedTypes.length; i++) {
          const charId = `${lobbyPlayer.id}_char${i}`;
          const charType = lobbyPlayer.selectedTypes[i];
          
          // Spread characters in a small cluster around spawn point
          const offsetAngle = (i - 1) * (Math.PI / 6); // 30 degree spread
          const offsetDist = 2; // Small offset distance
          const charX = spawnPos.x + Math.cos(offsetAngle) * offsetDist * (i === 1 ? 0 : 1);
          const charZ = spawnPos.z + Math.sin(offsetAngle) * offsetDist * (i === 1 ? 0 : 1);
          
          this.worldState.spawnPlayer(charId, charX, charZ, team, charType);
        }
        
        console.log(`[Server] Player ${lobbyPlayer.name} (team ${team}) spawned at safe zone (${spawnPos.x.toFixed(1)}, ${spawnPos.z.toFixed(1)})`);
      }
      
      // Track this active game
      this.activeGames.set(lobby.id, {
        players: playerIds,
        readyPlayers: new Set(),
        lobby: lobby,
      });
      
      // Notify all players to start game
      this.broadcastToLobby(lobby, {
        type: 'gameStart',
        lobbyId: lobby.id,
        players: lobby.players.map((p, idx) => ({
          id: p.id,
          name: p.name,
          selectedTypes: p.selectedTypes,
          team: idx + 1,
        })),
      });
      
      // Spawn data will be sent when all players send gameReady
    }
  }

  private handleGameReady(playerId: string): void {
    console.log(`[Server] Player ${playerId} is game ready`);
    
    // Find which game this player is in
    for (const [lobbyId, game] of this.activeGames) {
      if (game.players.includes(playerId)) {
        game.readyPlayers.add(playerId);
        console.log(`[Server] Game ${lobbyId}: ${game.readyPlayers.size}/${game.players.length} ready`);
        
        // Check if all players are ready
        if (game.readyPlayers.size === game.players.length) {
          console.log(`[Server] All players ready! Sending spawn data for ${this.worldState.getEntities().length} entities`);
          
          // Send spawn data for player characters
          for (const entity of this.worldState.getEntities()) {
            if (entity.type === 'champion') {
              this.broadcastToLobby(game.lobby, {
                type: 'spawn',
                data: {
                  id: entity.id,
                  type: entity.type,
                  x: entity.x,
                  z: entity.z,
                  team: entity.team,
                  elementType: entity.elementType,
                  monsterType: entity.monsterType,
                  ownerId: entity.id.split('_char')[0], // Extract owner from char ID
                },
              });
            }
          }
          
          // Send all existing monster states
          const monsterStates = this.monsterManager.getAllMonsterStates();
          console.log(`[Server] Sending ${monsterStates.length} monster spawns to players`);
          for (const monster of monsterStates) {
            this.broadcastToLobby(game.lobby, {
              type: 'monsterSpawn',
              data: monster,
            });
          }
          
          // Send all existing resource node states
          const nodeStates = this.resourceNodeManager.getAllNodeStates();
          console.log(`[Server] Sending ${nodeStates.length} resource node spawns to players`);
          for (const node of nodeStates) {
            this.broadcastToLobby(game.lobby, {
              type: 'nodeSpawn',
              data: node,
            });
          }
          
          // Send all existing ground items
          const groundItems = this.itemManager.getAllGroundItems();
          console.log(`[Server] Sending ${groundItems.length} ground item spawns to players`);
          for (const item of groundItems) {
            this.broadcastToLobby(game.lobby, {
              type: 'itemSpawn',
              data: item,
            });
          }
          
          // Send initial inventory to each player
          for (const pid of game.players) {
            const player = this.players.get(pid);
            const inventory = this.itemManager.getPlayerInventory(pid);
            if (player && inventory) {
              this.send(player.ws, {
                type: 'inventoryUpdate',
                data: {
                  playerId: pid,
                  inventory,
                },
              });
              console.log(`[Server] Sent initial inventory to ${pid}`);
            }
          }
        }
        return;
      }
    }
    
    console.log(`[Server] Player ${playerId} sent gameReady but not in any active game`);
  }

  private handleGameMove(playerId: string, message: Record<string, unknown>): void {
    const session = this.sessions.get(playerId);
    if (!session) return;
    
    if (message.sequence !== undefined) {
      session.lastProcessedInput = message.sequence as number;
    }
    
    // Get which characters to move (charIds)
    const charIds = message.charIds as string[] | undefined;
    
    if (charIds && charIds.length > 0) {
      // Move specific characters
      for (const charId of charIds) {
        if (message.posX !== undefined && message.posZ !== undefined) {
          this.worldState.setPlayerPosition(charId, message.posX as number, message.posZ as number);
        }
        if (message.x !== undefined && message.z !== undefined) {
          this.worldState.setMoveTarget(charId, message.x as number, message.z as number);
        }
      }
    } else {
      // Legacy: move by player ID
      if (message.posX !== undefined && message.posZ !== undefined) {
        this.worldState.setPlayerPosition(playerId, message.posX as number, message.posZ as number);
      }
      if (message.x !== undefined && message.z !== undefined) {
        this.worldState.setMoveTarget(playerId, message.x as number, message.z as number);
      }
    }
  }

  private handleMoveMultiple(message: Record<string, unknown>): void {
    const charIds = message.charIds as string[] | undefined;
    const x = message.x as number | undefined;
    const z = message.z as number | undefined;
    
    if (!charIds || x === undefined || z === undefined) return;
    
    // Set move target for each character
    for (const charId of charIds) {
      this.worldState.setMoveTarget(charId, x, z);
    }
  }

  private handleGameAttack(playerId: string, message: Record<string, unknown>): void {
    const session = this.sessions.get(playerId);
    if (!session) {
      console.log(`[Server] Attack rejected: no session for ${playerId}`);
      return;
    }
    
    if (message.sequence !== undefined) {
      session.lastProcessedInput = message.sequence as number;
    }
    
    const targetId = message.targetId as string;
    // Use the specific attacker character ID if provided, otherwise fall back to playerId
    const attackerId = (message.attackerId as string) || playerId;
    
    // Update attacker position if provided (client-authoritative movement)
    if (message.attackerX !== undefined && message.attackerZ !== undefined) {
      this.worldState.setPlayerPosition(attackerId, message.attackerX as number, message.attackerZ as number);
    }
    
    console.log(`[Server] Attack from ${attackerId} -> ${targetId}`);
    
    if (targetId) {
      // Check if target is a monster
      if (targetId.startsWith('monster_')) {
        // Route through monster manager for XP rewards
        const damage = message.damage as number || 10; // Use provided damage or default
        const result = this.monsterManager.damageMonster(targetId, damage, attackerId);
        
        if (result) {
          // Broadcast attack animation
          this.broadcast({
            type: 'attack',
            data: {
              attackerId,
              targetId,
            },
          });
          
          // Broadcast damage
          this.broadcast({
            type: 'damage',
            data: {
              targetId,
              damage,
              health: result.killed ? 0 : this.worldState.getEntity(targetId)?.health || 0,
              attackerId,
            },
          });
        }
      } else {
        // Regular player vs player attack
        const result = this.worldState.attack(attackerId, targetId);
        
        if (result) {
          console.log(`[Server] Attack success! Damage: ${result.damage}, Target HP: ${result.targetHealth}`);
        } else {
          console.log(`[Server] Attack failed (out of range or cooldown)`);
        }
        
        // Always broadcast the attack so other clients see the animation
        this.broadcast({
          type: 'attack',
          data: {
            attackerId,
            targetId,
          },
        });
        
        if (result && result.damage > 0) {
          this.broadcast({
            type: 'damage',
            data: {
              targetId,
              damage: result.damage,
              health: result.targetHealth,
              attackerId,
            },
          });
        }
      }
    }
  }

  private handleCharSelection(playerId: string, selected: number[]): void {
    // Broadcast selection state to other clients for visual feedback
    this.broadcast({
      type: 'charSelection',
      playerId,
      selected,
    });
  }

  /**
   * Handle ability cast - broadcast to all players for synchronized effects
   */
  private handleAbilityCast(_playerId: string, message: Record<string, unknown>): void {
    const casterId = message.casterId as string;
    const targetId = message.targetId as string;
    const abilityId = message.abilityId as string;
    const level = message.level as string;
    
    console.log(`[Server] Ability cast: ${abilityId} (${level}) from ${casterId} -> ${targetId}`);
    
    // Broadcast the ability cast to all clients for visual effects
    this.broadcast({
      type: 'abilityCast',
      data: {
        casterId,
        targetId,
        abilityId,
        level,
      },
    });
    
    // Calculate and broadcast ability damage/heal
    const result = this.worldState.processAbility(casterId, targetId, abilityId, level);
    
    // Broadcast damages with type effectiveness
    for (const damage of result.damages) {
      this.broadcast({
        type: 'abilityDamage',
        data: {
          targetId: damage.targetId,
          damage: damage.damage,
          health: damage.health,
          abilityId,
          casterId,
          effectiveness: damage.effectiveness,
        },
      });
      
      // Sync monster health with MonsterManager's internal state
      if (damage.targetId.startsWith('monster_')) {
        if (damage.health <= 0) {
          // Trigger monster death through monster manager
          const killResult = this.monsterManager.handleAbilityKill(damage.targetId, casterId);
          if (killResult) {
            console.log(`[Server] Monster ${damage.targetId} killed by ability from ${casterId}`);
          }
        } else {
          // Sync the reduced health to MonsterManager's internal tracking
          this.monsterManager.syncMonsterHealthFromWorldState(damage.targetId);
        }
      }
    }
    
    // Broadcast heals
    for (const heal of result.heals) {
      this.broadcast({
        type: 'abilityHeal',
        data: {
          targetId: heal.targetId,
          heal: heal.heal,
          health: heal.health,
        },
      });
    }
  }

  /**
   * Handle talisman pickup notification - broadcast to all players
   */
  private handleTalismanPickup(_playerId: string, message: Record<string, unknown>): void {
    const charId = message.charId as string;
    const elementType = message.elementType as string;
    
    console.log(`[Server] Talisman pickup: ${elementType} by ${charId}`);
    
    this.broadcast({
      type: 'talismanPickup',
      data: {
        charId,
        elementType,
      },
    });
  }

  /**
   * Handle ability upgrade notification - broadcast to all players
   */
  private handleAbilityUpgrade(_playerId: string, message: Record<string, unknown>): void {
    const charId = message.charId as string;
    const newLevel = message.newLevel as string;
    
    console.log(`[Server] Ability upgrade: ${charId} -> level ${newLevel}`);
    
    this.broadcast({
      type: 'abilityUpgrade',
      data: {
        charId,
        newLevel,
      },
    });
  }

  /**
   * Handle node attack - player attacking a resource node
   */
  private handleNodeAttack(_playerId: string, message: Record<string, unknown>): void {
    const nodeId = message.nodeId as string;
    const attackerId = message.attackerId as string;
    const damage = (message.damage as number) || 10;
    
    const result = this.resourceNodeManager.damageNode(nodeId, damage, attackerId);
    
    if (result) {
      console.log(`[Server] Node ${nodeId} hit by ${attackerId} for ${damage} damage`);
    }
  }

  /**
   * Handle item pickup - player picking up a ground item
   */
  private handleItemPickup(playerId: string, message: Record<string, unknown>): void {
    const itemId = message.itemId as string;
    const charId = message.charId as string;
    
    const result = this.itemManager.tryPickupItem(itemId, playerId, charId);
    
    if (result) {
      console.log(`[Server] Item ${itemId} picked up by ${playerId}`);
    } else {
      console.log(`[Server] Item pickup failed for ${itemId}`);
    }
  }

  /**
   * Handle consume item - player using a consumable from inventory
   */
  private handleConsumeItem(playerId: string, message: Record<string, unknown>): void {
    const consumableType = message.consumableType as string;
    const targetCharId = message.targetCharId as string | undefined;
    
    // For talismans
    if (message.itemType === 'talisman') {
      const elementType = message.elementType as ElementType;
      const success = this.itemManager.useTalisman(playerId, elementType, 1);
      
      if (success) {
        // Apply talisman effect to character
        console.log(`[Server] Talisman ${elementType} consumed on ${targetCharId}`);
        
        // Broadcast the talisman use
        this.broadcast({
          type: 'talismanConsumed',
          data: {
            playerId,
            charId: targetCharId,
            elementType,
          },
        });
      }
      return;
    }
    
    // For regular consumables
    const used = this.itemManager.useConsumable(playerId, consumableType);
    
    if (used) {
      console.log(`[Server] Consumable ${consumableType} used by ${playerId}`);
      
      // Apply consumable effects
      switch (consumableType) {
        case 'health_potion': {
          // Heal the target character
          if (targetCharId) {
            // Healing should be done via WorldState if needed
            this.broadcast({
              type: 'consumableEffect',
              data: {
                type: 'health_potion',
                targetId: targetCharId,
                amount: 50,
              },
            });
          }
          break;
        }
        case 'team_heal': {
          // Heal all player's characters
          for (const entity of this.worldState.getEntities()) {
            if (entity.id.startsWith(playerId)) {
              this.broadcast({
                type: 'consumableEffect',
                data: {
                  type: 'team_heal',
                  targetId: entity.id,
                  amount: 30,
                },
              });
            }
          }
          break;
        }
        // Other consumables can be added here
      }
    }
  }

  /**
   * Handle purchase consumable - player buying from shop
   */
  private handlePurchaseConsumable(playerId: string, message: Record<string, unknown>): void {
    const consumableType = message.consumableType as string;
    const player = this.players.get(playerId);
    
    if (!player) return;
    
    // Check if player has enough resources
    const inventory = this.itemManager.getPlayerInventory(playerId);
    if (!inventory) {
      this.send(player.ws, {
        type: 'purchaseFailed',
        data: {
          consumableType,
          reason: 'No inventory',
        },
      });
      return;
    }
    
    // Get consumable recipe from ShopTypes
    const { CONSUMABLES } = require('../src/types/ShopTypes');
    const recipe = CONSUMABLES.find((c: any) => c.type === consumableType);
    
    if (!recipe) {
      this.send(player.ws, {
        type: 'purchaseFailed',
        data: {
          consumableType,
          reason: 'Unknown consumable',
        },
      });
      return;
    }
    
    // Check resources
    if (inventory.resources.gold < recipe.cost.gold ||
        inventory.resources.wood < (recipe.cost.wood || 0) ||
        inventory.resources.stone < (recipe.cost.stone || 0)) {
      this.send(player.ws, {
        type: 'purchaseFailed',
        data: {
          consumableType,
          reason: 'Not enough resources',
        },
      });
      return;
    }
    
    // Deduct resources and add consumable
    const deducted = this.itemManager.deductResources(
      playerId,
      recipe.cost.wood || 0,
      recipe.cost.gold,
      recipe.cost.stone || 0
    );
    if (deducted) {
      this.itemManager.addConsumable(playerId, consumableType, 1);
      console.log(`[Server] ${playerId} purchased ${consumableType}`);
      
      this.send(player.ws, {
        type: 'purchaseSuccess',
        data: {
          consumableType,
        },
      });
    }
  }

  /**
   * Clean up all game state for a player (characters, session, inventory, active game)
   */
  private cleanupPlayerGameState(playerId: string): void {
    // Remove session
    this.sessions.delete(playerId);
    
    // Remove all character entities belonging to this player (player_X_char0, player_X_char1, etc.)
    const entities = this.worldState.getEntities();
    for (const entity of entities) {
      if (entity.id.startsWith(playerId + '_char') || entity.id === playerId) {
        this.worldState.removeEntity(entity.id);
        console.log(`[Server] Removed entity: ${entity.id}`);
      }
    }
    
    // Remove from any active games
    for (const [lobbyId, game] of this.activeGames) {
      const playerIndex = game.players.indexOf(playerId);
      if (playerIndex !== -1) {
        game.players.splice(playerIndex, 1);
        game.readyPlayers.delete(playerId);
        console.log(`[Server] Removed ${playerId} from active game ${lobbyId}`);
        
        // If game is empty, clean it up
        if (game.players.length === 0) {
          this.activeGames.delete(lobbyId);
          console.log(`[Server] Active game ${lobbyId} removed (empty)`);
        }
      }
    }
    
    // Clean up inventory
    this.itemManager.removePlayerInventory?.(playerId);
  }

  private broadcastToLobby(lobby: Lobby, data: object, excludeId?: string): void {
    const message = JSON.stringify(data);
    for (const player of lobby.players) {
      if (player.id !== excludeId && player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(message);
      }
    }
  }

  private send(ws: WebSocket, data: object): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  public broadcast(data: object): void {
    const message = JSON.stringify(data);
    for (const session of this.sessions.values()) {
      if (session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(message);
      }
    }
  }

  public getSessions(): Map<string, PlayerSession> {
    return this.sessions;
  }
}

// Start the server
new GameServer();

import * as THREE from 'three';

type EventCallback = (...args: unknown[]) => void;

/**
 * Network Client - WebSocket client with input buffering and prediction support
 */

export interface SpawnData {
  id: string;
  type: 'champion' | 'monster';
  x: number;
  z: number;
  team: number;
  monsterType?: string;
  elementType?: string;
  ownerId?: string; // Player ID who owns this character
}

export interface EntityState {
  id: string;
  x: number;
  z: number;
  health?: number;
  maxHealth?: number;
  level?: number;
  currentXP?: number;
  xpToNextLevel?: number;
}

export interface StateUpdate {
  tick: number;
  lastProcessedInput: number;
  entities: EntityState[];
}

export class NetworkClient {
  private ws: WebSocket | null = null;
  private localPlayerId: string | null = null;
  
  // Event emitter
  private listeners: Map<string, EventCallback[]> = new Map();
  
  // Input sequence for prediction/reconciliation
  private inputSequence = 0;
  private pendingInputs: Array<{
    sequence: number;
    position: THREE.Vector3;
    timestamp: number;
  }> = [];

  /**
   * Create network client with existing WebSocket from lobby
   */
  constructor(existingWs: WebSocket, playerId: string) {
    this.ws = existingWs;
    this.localPlayerId = playerId;
    
    // Set up message handler
    this.ws.onmessage = (event) => {
      this.handleMessage(event.data);
    };
    
    this.ws.onclose = () => {
      console.log('[Network] Disconnected from server');
      this.emit('disconnected');
    };
    
    this.ws.onerror = (error) => {
      console.error('[Network] Error:', error);
      this.emit('error', error);
    };
    
    console.log('[Network] Using existing WebSocket connection, playerId:', playerId);
    this.emit('connected');
  }

  /**
   * Connect to the game server (kept for compatibility, but no-op since we use existing socket)
   */
  public connect(): void {
    // Already connected via constructor
    console.log('[Network] Already connected');
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);
      
      switch (message.type) {
        case 'welcome':
          this.localPlayerId = message.id;
          console.log('[Network] Received player ID:', this.localPlayerId);
          break;
          
        case 'spawn':
          this.emit('spawn', message.data as SpawnData);
          break;
          
        case 'state':
          this.emit('state', message.data as StateUpdate);
          // Clean up acknowledged inputs
          this.cleanupPendingInputs(message.data.lastProcessedInput);
          break;
          
        case 'playerLeft':
          this.emit('playerLeft', message.data);
          break;
          
        case 'attack':
          this.emit('attack', message.data);
          break;
          
        case 'damage':
          this.emit('damage', message.data);
          break;
          
        case 'abilityCast':
          this.emit('abilityCast', message.data);
          break;
          
        case 'abilityDamage':
          this.emit('abilityDamage', message.data);
          break;
          
        case 'abilityHeal':
          this.emit('abilityHeal', message.data);
          break;
          
        case 'talismanPickup':
          this.emit('talismanPickup', message.data);
          break;
          
        case 'abilityUpgrade':
          this.emit('abilityUpgrade', message.data);
          break;
          
        case 'levelUp':
          this.emit('levelUp', message.data);
          break;
          
        case 'monsterSpawn':
          this.emit('monsterSpawn', message.data);
          break;
          
        case 'monsterDeath':
          this.emit('monsterDeath', message.data);
          break;
          
        case 'monsterAttack':
          this.emit('monsterAttack', message.data);
          break;
          
        case 'xpGain':
          this.emit('xpGain', message.data);
          break;
          
        case 'playerDied':
          this.emit('playerDeath', message.data);
          break;
          
        case 'playerRespawn':
          this.emit('playerRespawn', message.data);
          break;
          
        // Resource node events
        case 'nodeSpawn':
          this.emit('nodeSpawn', message.data);
          break;
          
        case 'nodeDamaged':
          this.emit('nodeDamaged', message.data);
          break;
          
        case 'nodeDestroyed':
          this.emit('nodeDestroyed', message.data);
          break;
          
        // Ground item events
        case 'itemSpawn':
          this.emit('itemSpawn', message.data);
          break;
          
        case 'itemPickup':
          this.emit('itemPickup', message.data);
          break;
          
        case 'itemDespawn':
          this.emit('itemDespawn', message.data);
          break;
          
        // Inventory events
        case 'inventoryUpdate':
          this.emit('inventoryUpdate', message.data);
          break;
          
        // Shop events
        case 'purchaseSuccess':
          this.emit('purchaseSuccess', message.data);
          break;
          
        case 'purchaseFailed':
          this.emit('purchaseFailed', message.data);
          break;
          
        // Consumable events
        case 'consumableEffect':
          this.emit('consumableEffect', message.data);
          break;
          
        case 'talismanConsumed':
          this.emit('talismanConsumed', message.data);
          break;
      }
    } catch (error) {
      console.error('[Network] Failed to parse message:', error);
    }
  }

  private cleanupPendingInputs(lastProcessedSequence: number): void {
    this.pendingInputs = this.pendingInputs.filter(
      input => input.sequence > lastProcessedSequence
    );
  }

  /**
   * Send move command to server
   * LoL-style: We send our CURRENT position so server can relay to others
   */
  public sendMove(target: THREE.Vector3, currentPosition?: THREE.Vector3): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    const input = {
      sequence: ++this.inputSequence,
      position: target.clone(),
      timestamp: performance.now(),
    };
    
    this.pendingInputs.push(input);
    
    this.send({
      type: 'move',
      sequence: input.sequence,
      x: target.x,
      z: target.z,
      // Send current position so server can update other clients
      posX: currentPosition?.x,
      posZ: currentPosition?.z,
    });
  }

  /**
   * Send position update to server (for continuous position streaming)
   */
  public sendPosition(position: THREE.Vector3): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    this.send({
      type: 'position',
      x: position.x,
      z: position.z,
    });
  }

  /**
   * Send position update for a specific character
   */
  public sendPositionForChar(charId: string, position: THREE.Vector3): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    this.send({
      type: 'charPosition',
      charId,
      x: position.x,
      z: position.z,
    });
  }

  /**
   * Send move command for multiple characters at once
   */
  public sendMoveMultiple(charIds: string[], target: THREE.Vector3): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    this.send({
      type: 'moveMultiple',
      charIds,
      x: target.x,
      z: target.z,
      sequence: ++this.inputSequence,
    });
  }

  /**
   * Send character selection to server (for lobby)
   */
  public sendCharSelection(selectedTypes: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    this.send({
      type: 'selectCharacters',
      characters: selectedTypes,
    });
  }

  /**
   * Tell server the game client is ready to receive data
   */
  public sendGameReady(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    this.send({
      type: 'gameReady',
    });
  }

  /**
   * Create a new lobby
   */
  public createLobby(lobbyName: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    this.send({
      type: 'createLobby',
      name: lobbyName,
    });
  }

  /**
   * Join an existing lobby
   */
  public joinLobby(lobbyId: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    this.send({
      type: 'joinLobby',
      lobbyId,
    });
  }

  /**
   * Mark player as ready in lobby
   */
  public setReady(ready: boolean): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    this.send({
      type: 'ready',
      ready,
    });
  }

  /**
   * Send attack command to server
   */
  public sendAttack(targetId: string, attackerId?: string, attackerPos?: THREE.Vector3): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    this.send({
      type: 'attack',
      targetId,
      attackerId, // Which character is attacking
      // Send attacker position so server can update before checking range
      attackerX: attackerPos?.x,
      attackerZ: attackerPos?.z,
      sequence: ++this.inputSequence,
    });
  }

  /**
   * Send ability cast to server
   */
  public sendAbilityCast(casterId: string, targetId: string, abilityId: string, level: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    this.send({
      type: 'abilityCast',
      casterId,
      targetId,
      abilityId,
      level,
      sequence: ++this.inputSequence,
    });
  }

  /**
   * Send talisman pickup notification
   */
  public sendTalismanPickup(charId: string, elementType: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    this.send({
      type: 'talismanPickup',
      charId,
      elementType,
    });
  }

  /**
   * Send ability upgrade notification
   */
  public sendAbilityUpgrade(charId: string, newLevel: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    this.send({
      type: 'abilityUpgrade',
      charId,
      newLevel,
    });
  }

  /**
   * Send node attack command
   */
  public sendNodeAttack(nodeId: string, attackerId: string, damage: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    this.send({
      type: 'attackNode',
      nodeId,
      attackerId,
      damage,
    });
  }

  /**
   * Send item pickup request
   */
  public sendItemPickup(itemId: string, charId: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    this.send({
      type: 'pickupItem',
      itemId,
      charId,
    });
  }

  /**
   * Send consume item request
   */
  public sendConsumeItem(
    consumableType: string,
    targetCharId?: string,
    itemType?: 'talisman' | 'consumable',
    elementType?: string
  ): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    this.send({
      type: 'consumeItem',
      consumableType,
      targetCharId,
      itemType,
      elementType,
    });
  }

  /**
   * Send consume talisman request
   */
  public sendConsumeTalisman(elementType: string, targetCharId: string): void {
    this.sendConsumeItem(elementType, targetCharId, 'talisman', elementType);
  }

  /**
   * Send use consumable request
   */
  public sendUseConsumable(consumableType: string, targetCharId?: string): void {
    this.sendConsumeItem(consumableType, targetCharId, 'consumable');
  }

  /**
   * Send purchase consumable request
   */
  public sendPurchaseConsumable(consumableType: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    this.send({
      type: 'purchaseConsumable',
      consumableType,
    });
  }

  private send(data: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  /**
   * Get the local player's network ID
   */
  public getLocalPlayerId(): string | null {
    return this.localPlayerId;
  }

  /**
   * Get pending inputs for reconciliation
   */
  public getPendingInputs(): typeof this.pendingInputs {
    return this.pendingInputs;
  }

  /**
   * Disconnect from server
   */
  public disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // Event emitter methods
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
}

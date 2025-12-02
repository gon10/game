import { WebSocket } from 'ws';

export type ElementType = 'fire' | 'water' | 'grass' | 'electric' | 'rock' | 'psychic';

export interface LobbyPlayer {
  id: string;
  name: string;
  ws: WebSocket;
  isReady: boolean;
  selectedTypes: ElementType[];
  isHost: boolean;
}

export interface Lobby {
  id: string;
  name: string;
  joinCode: string; // 6-character code to share with friends
  players: LobbyPlayer[];
  maxPlayers: number;
  status: 'waiting' | 'character-select' | 'starting' | 'in-game';
}

/**
 * Generate a random 6-character alphanumeric code
 */
function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars like 0/O, 1/I
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Lobby Manager - Handles lobby creation, joining, and game start
 */
export class LobbyManager {
  private lobbies: Map<string, Lobby> = new Map();
  private playerToLobby: Map<string, string> = new Map();
  private joinCodeToLobby: Map<string, string> = new Map(); // joinCode -> lobbyId
  private nextLobbyId = 1;

  /**
   * Create a new lobby
   */
  public createLobby(player: { id: string; name: string; ws: WebSocket }, lobbyName: string): Lobby {
    const lobbyId = `lobby_${this.nextLobbyId++}`;
    
    // Generate unique join code
    let joinCode = generateJoinCode();
    while (this.joinCodeToLobby.has(joinCode)) {
      joinCode = generateJoinCode();
    }
    
    const lobby: Lobby = {
      id: lobbyId,
      name: lobbyName,
      joinCode,
      players: [{
        id: player.id,
        name: player.name,
        ws: player.ws,
        isReady: false,
        selectedTypes: [],
        isHost: true,
      }],
      maxPlayers: 5, // Support 5 players for pentagon map layout
      status: 'waiting',
    };
    
    this.lobbies.set(lobbyId, lobby);
    this.playerToLobby.set(player.id, lobbyId);
    this.joinCodeToLobby.set(joinCode, lobbyId);
    
    console.log(`[Lobby] Created lobby: ${lobbyName} (${lobbyId}) by ${player.name} - Join Code: ${joinCode}`);
    
    return lobby;
  }

  /**
   * Join a lobby using join code
   */
  public joinLobbyByCode(player: { id: string; name: string; ws: WebSocket }, joinCode: string): Lobby | null {
    const lobbyId = this.joinCodeToLobby.get(joinCode.toUpperCase());
    if (!lobbyId) {
      console.log(`[Lobby] Invalid join code: ${joinCode}`);
      return null;
    }
    return this.joinLobby(player, lobbyId);
  }

  /**
   * Join an existing lobby
   */
  public joinLobby(player: { id: string; name: string; ws: WebSocket }, lobbyId: string): Lobby | null {
    const lobby = this.lobbies.get(lobbyId);
    
    if (!lobby) {
      return null;
    }
    
    if (lobby.players.length >= lobby.maxPlayers) {
      return null;
    }
    
    if (lobby.status !== 'waiting') {
      return null;
    }
    
    lobby.players.push({
      id: player.id,
      name: player.name,
      ws: player.ws,
      isReady: false,
      selectedTypes: [],
      isHost: false,
    });
    
    this.playerToLobby.set(player.id, lobbyId);
    
    console.log(`[Lobby] ${player.name} joined ${lobby.name} using code ${lobby.joinCode}`);
    
    return lobby;
  }

  /**
   * Leave a lobby
   */
  public leaveLobby(playerId: string): { lobby: Lobby | null; disbanded: boolean } {
    const lobbyId = this.playerToLobby.get(playerId);
    if (!lobbyId) return { lobby: null, disbanded: false };
    
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return { lobby: null, disbanded: false };
    
    const playerIndex = lobby.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return { lobby: null, disbanded: false };
    
    const wasHost = lobby.players[playerIndex]?.isHost;
    lobby.players.splice(playerIndex, 1);
    this.playerToLobby.delete(playerId);
    
    // If lobby is empty, delete it
    if (lobby.players.length === 0) {
      this.lobbies.delete(lobbyId);
      this.joinCodeToLobby.delete(lobby.joinCode);
      console.log(`[Lobby] ${lobby.name} disbanded (empty)`);
      return { lobby: null, disbanded: true };
    }
    
    // If host left, assign new host
    if (wasHost && lobby.players[0]) {
      lobby.players[0].isHost = true;
      console.log(`[Lobby] New host: ${lobby.players[0].name}`);
    }
    
    return { lobby, disbanded: false };
  }

  /**
   * Toggle player ready status
   */
  public toggleReady(playerId: string, selectedTypes: ElementType[]): Lobby | null {
    const lobbyId = this.playerToLobby.get(playerId);
    if (!lobbyId) return null;
    
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return null;
    
    const player = lobby.players.find(p => p.id === playerId);
    if (!player) return null;
    
    player.isReady = !player.isReady;
    player.selectedTypes = player.isReady ? selectedTypes : [];
    
    console.log(`[Lobby] ${player.name} is ${player.isReady ? 'READY' : 'not ready'}`);
    
    return lobby;
  }

  /**
   * Start the game
   */
  public startGame(playerId: string): Lobby | null {
    const lobbyId = this.playerToLobby.get(playerId);
    if (!lobbyId) return null;
    
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return null;
    
    // Check if player is host
    const player = lobby.players.find(p => p.id === playerId);
    if (!player?.isHost) return null;
    
    // Check if all players are ready
    if (!lobby.players.every(p => p.isReady)) return null;
    
    // Check minimum players
    if (lobby.players.length < 2) return null;
    
    lobby.status = 'starting';
    console.log(`[Lobby] Game starting in ${lobby.name}!`);
    
    return lobby;
  }

  /**
   * Get all available lobbies (for join screen)
   */
  public getAvailableLobbies(): Array<{
    id: string;
    name: string;
    joinCode: string;
    players: Array<{ id: string; name: string; isReady: boolean; selectedTypes: ElementType[]; isHost: boolean }>;
    maxPlayers: number;
    status: string;
  }> {
    const lobbies: Array<{
      id: string;
      name: string;
      joinCode: string;
      players: Array<{ id: string; name: string; isReady: boolean; selectedTypes: ElementType[]; isHost: boolean }>;
      maxPlayers: number;
      status: string;
    }> = [];
    
    for (const lobby of this.lobbies.values()) {
      if (lobby.status === 'waiting') {
        lobbies.push({
          id: lobby.id,
          name: lobby.name,
          joinCode: lobby.joinCode,
          players: lobby.players.map(p => ({
            id: p.id,
            name: p.name,
            isReady: p.isReady,
            selectedTypes: p.selectedTypes,
            isHost: p.isHost,
          })),
          maxPlayers: lobby.maxPlayers,
          status: lobby.status,
        });
      }
    }
    
    return lobbies;
  }

  /**
   * Get lobby by player ID
   */
  public getLobbyByPlayer(playerId: string): Lobby | null {
    const lobbyId = this.playerToLobby.get(playerId);
    if (!lobbyId) return null;
    return this.lobbies.get(lobbyId) || null;
  }

  /**
   * Get lobby by ID
   */
  public getLobby(lobbyId: string): Lobby | null {
    return this.lobbies.get(lobbyId) || null;
  }

  /**
   * Serialize lobby for sending to clients (removes WebSocket references)
   */
  public serializeLobby(lobby: Lobby): object {
    return {
      id: lobby.id,
      name: lobby.name,
      joinCode: lobby.joinCode,
      players: lobby.players.map(p => ({
        id: p.id,
        name: p.name,
        isReady: p.isReady,
        selectedTypes: p.selectedTypes,
        isHost: p.isHost,
      })),
      maxPlayers: lobby.maxPlayers,
      status: lobby.status,
    };
  }
}

import { WebSocket } from 'ws';

/**
 * Player Session - Tracks individual player state on the server
 */
export class PlayerSession {
  public id: string;
  public ws: WebSocket;
  public lastProcessedInput: number = 0;
  public lastActiveTime: number = Date.now();

  constructor(id: string, ws: WebSocket) {
    this.id = id;
    this.ws = ws;
  }
}

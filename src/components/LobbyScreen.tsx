import { useState, useEffect, useCallback, useRef } from "react";
import { CharacterSelect } from "./CharacterSelect";
import { ElementType } from "../types/CharacterTypes";

interface LobbyPlayer {
  id: string;
  name: string;
  isReady: boolean;
  selectedTypes: ElementType[];
  isHost: boolean;
}

interface Lobby {
  id: string;
  name: string;
  joinCode: string;
  players: LobbyPlayer[];
  maxPlayers: number;
  status: "waiting" | "character-select" | "starting" | "in-game";
}

interface LobbyScreenProps {
  onGameStart: (
    lobbyId: string,
    playerId: string,
    selectedTypes: ElementType[],
    ws: WebSocket
  ) => void;
}

type Screen = "name-entry" | "lobby-list" | "lobby";

export function LobbyScreen({ onGameStart }: LobbyScreenProps) {
  const [screen, setScreen] = useState<Screen>("name-entry");
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [availableLobbies, setAvailableLobbies] = useState<Lobby[]>([]);
  const [currentLobby, setCurrentLobby] = useState<Lobby | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<ElementType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(true);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Use refs for values needed in callbacks to avoid stale closures
  const currentLobbyRef = useRef<Lobby | null>(null);
  const playerIdRef = useRef<string | null>(null);
  const selectedTypesRef = useRef<ElementType[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  // Keep refs in sync
  useEffect(() => {
    currentLobbyRef.current = currentLobby;
  }, [currentLobby]);
  useEffect(() => {
    playerIdRef.current = playerId;
  }, [playerId]);
  useEffect(() => {
    selectedTypesRef.current = selectedTypes;
  }, [selectedTypes]);
  useEffect(() => {
    wsRef.current = ws;
  }, [ws]);

  // Connect to server
  const connectToServer = useCallback(() => {
    setIsConnecting(true);
    setError(null);

    try {
      // Use current host for WebSocket connection (works in dev and production)
      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsHost = window.location.hostname;
      const wsPort = "3001";
      const wsUrl = `${wsProtocol}//${wsHost}:${wsPort}`;
      const socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        console.log("[Lobby] Connected to server");
        setConnected(true);
        setIsConnecting(false);
        setError(null);
      };

      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleServerMessage(message);
      };

      socket.onclose = () => {
        console.log("[Lobby] Disconnected from server");
        setConnected(false);
        setIsConnecting(false);
        // Don't set error here, just show disconnected state
      };

      socket.onerror = () => {
        console.error("[Lobby] Connection error");
        setConnected(false);
        setIsConnecting(false);
        setError("Cannot connect to server. Make sure the server is running.");
      };

      setWs(socket);

      return socket;
    } catch (err) {
      console.error("[Lobby] Failed to create WebSocket:", err);
      setIsConnecting(false);
      setError("Failed to connect to server");
      return null;
    }
  }, []);

  useEffect(() => {
    connectToServer();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      // Only close socket if it wasn't taken by the game
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connectToServer]);

  const handleServerMessage = useCallback(
    (message: {
      type: string;
      id?: string;
      lobby?: Lobby;
      lobbies?: Lobby[];
      error?: string;
      playerId?: string;
      lobbyId?: string;
    }) => {
      switch (message.type) {
        case "welcome":
          setPlayerId(message.id || null);
          break;

        case "lobbyList":
          setAvailableLobbies(message.lobbies || []);
          break;

        case "lobbyCreated":
        case "lobbyJoined":
        case "lobbyUpdate":
          setCurrentLobby(message.lobby || null);
          if (message.type !== "lobbyUpdate") {
            setScreen("lobby");
          }
          setError(null);
          break;

        case "gameStart":
          // Use refs to get current values (avoids stale closure)
          const lobby = currentLobbyRef.current;
          const pid = playerIdRef.current;
          const types = selectedTypesRef.current;
          const socket = wsRef.current;

          console.log("[Lobby] Game starting!", {
            lobbyId: message.lobbyId,
            pid,
            types,
          });

          if (message.lobbyId && pid && types.length > 0 && socket) {
            // Clear the ref so we don't close the socket on unmount
            wsRef.current = null;
            onGameStart(message.lobbyId as string, pid, types, socket);
          } else if (lobby && pid && socket) {
            const player = lobby.players.find((p) => p.id === pid);
            if (player?.selectedTypes) {
              wsRef.current = null;
              onGameStart(lobby.id, pid, player.selectedTypes, socket);
            }
          }
          break;

        case "playerLeft":
          if (message.playerId === playerIdRef.current) {
            setCurrentLobby(null);
            setScreen("lobby-list");
          }
          break;

        case "error":
          setError(message.error || "Unknown error");
          break;
      }
    },
    [currentLobby, playerId, selectedTypes, onGameStart]
  );

  const send = (data: object) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  };

  const handleNameSubmit = () => {
    if (!playerName.trim()) {
      setError("Please enter your name");
      return;
    }
    send({ type: "setName", name: playerName.trim() });
    setScreen("lobby-list");
    send({ type: "getLobbies" });
  };

  const createLobby = () => {
    // Auto-generate lobby name from player name
    const lobbyName = `${playerName}'s Game`;
    send({ type: "createLobby", playerName, lobbyName });
  };

  const joinLobbyWithCode = () => {
    if (!joinCode.trim()) {
      setError("Please enter a join code");
      return;
    }
    send({ type: "joinLobbyByCode", joinCode: joinCode.trim().toUpperCase() });
  };

  const refreshLobbies = () => {
    send({ type: "getLobbies" });
  };

  const leaveLobby = () => {
    send({ type: "leaveLobby" });
    setCurrentLobby(null);
    setSelectedTypes([]);
    setScreen("lobby-list");
  };

  const toggleReady = () => {
    if (!getCurrentPlayer()?.isReady && selectedTypes.length !== 3) {
      setError("Please select exactly 3 characters");
      return;
    }
    send({ type: "toggleReady", selectedTypes });
    setError(null);
  };

  const startGame = () => {
    console.log("[Lobby] Requesting game start");
    send({ type: "startGame" });
  };

  const getCurrentPlayer = (): LobbyPlayer | undefined => {
    return currentLobby?.players.find((p) => p.id === playerId);
  };

  const copyJoinCode = () => {
    if (currentLobby?.joinCode) {
      navigator.clipboard.writeText(currentLobby.joinCode);
    }
  };

  const isHost = getCurrentPlayer()?.isHost || false;
  const allPlayersReady =
    currentLobby?.players.every((p) => p.isReady) || false;
  const canStartGame =
    isHost && allPlayersReady && (currentLobby?.players.length || 0) >= 2;

  // Connection error / reconnect screen
  if (!connected && !isConnecting) {
    return (
      <div style={styles.container}>
        <div style={styles.centerContent}>
          <h1 style={styles.mainTitle}>Element Arena</h1>
          <div style={styles.errorBox}>
            <p style={styles.errorText}>
              ⚠️ {error || "Disconnected from server"}
            </p>
            <p style={styles.helpText}>
              Make sure the server is running. Run this command in the terminal:
            </p>
            <code style={styles.codeBlock}>npm run start</code>
            <button onClick={connectToServer} style={styles.retryButton}>
              🔄 Retry Connection
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Loading screen
  if (isConnecting) {
    return (
      <div style={styles.container}>
        <div style={styles.centerContent}>
          <h1 style={styles.mainTitle}>Element Arena</h1>
          <p style={styles.loadingText}>Connecting to server...</p>
          <div style={styles.spinner} />
        </div>
      </div>
    );
  }

  // Screen: Lobby (character selection)
  if (screen === "lobby" && currentLobby) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <button onClick={leaveLobby} style={styles.backButton}>
            ← Leave
          </button>
          <h2 style={styles.lobbyTitle}>{currentLobby.name}</h2>
          <div style={styles.joinCodeBox}>
            <span style={styles.joinCodeLabel}>Join Code:</span>
            <span style={styles.joinCode}>{currentLobby.joinCode}</span>
            <button onClick={copyJoinCode} style={styles.copyButton}>
              📋
            </button>
          </div>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.lobbyContent}>
          {/* Players section with header */}
          <div style={styles.playersSection}>
            <h3 style={styles.playersSectionTitle}>
              Players ({currentLobby.players.length}/{currentLobby.maxPlayers})
            </h3>
            <div style={styles.playersList}>
              {currentLobby.players.map((player) => (
                <div
                  key={player.id}
                  style={{
                    ...styles.playerCard,
                    borderColor: player.isReady ? "#44ff44" : "#666",
                  }}
                >
                  <span style={styles.playerName}>
                    {player.name}
                    {player.isHost && (
                      <span style={styles.hostBadge}>HOST</span>
                    )}
                    {player.id === playerId && (
                      <span style={styles.youBadge}>YOU</span>
                    )}
                  </span>
                  <span style={player.isReady ? styles.ready : styles.notReady}>
                    {player.isReady ? "✓ Ready" : "Selecting..."}
                  </span>
                  {player.isReady && (
                    <div style={styles.selectedChars}>
                      {player.selectedTypes.map((type, i) => (
                        <span key={i} style={styles.charBadge}>
                          {type}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {currentLobby.players.length < currentLobby.maxPlayers && (
                <div style={styles.waitingSlot}>Waiting for player...</div>
              )}
            </div>
          </div>

          {/* Character selection */}
          <div style={styles.selectSection}>
            <CharacterSelect
              selectedTypes={selectedTypes}
              onSelectionChange={setSelectedTypes}
              maxSelection={3}
              disabled={getCurrentPlayer()?.isReady}
            />

            <div style={styles.actions}>
              {!getCurrentPlayer()?.isReady ? (
                <button
                  onClick={toggleReady}
                  style={{
                    ...styles.readyButton,
                    opacity: selectedTypes.length === 3 ? 1 : 0.5,
                  }}
                  disabled={selectedTypes.length !== 3}
                >
                  ✓ Ready ({selectedTypes.length}/3 selected)
                </button>
              ) : (
                <button onClick={toggleReady} style={styles.cancelButton}>
                  ✗ Cancel Ready
                </button>
              )}

              {isHost && (
                <button
                  onClick={startGame}
                  style={{
                    ...styles.startButton,
                    opacity: canStartGame ? 1 : 0.5,
                  }}
                  disabled={!canStartGame}
                >
                  🎮 Start Game
                </button>
              )}
            </div>

            {isHost && !canStartGame && (
              <p style={styles.waitingMessage}>
                {currentLobby.players.length < 2
                  ? "Waiting for another player to join..."
                  : "Waiting for all players to be ready..."}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Screen: Lobby List
  if (screen === "lobby-list") {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <button
            onClick={() => setScreen("name-entry")}
            style={styles.backButton}
          >
            ← Back
          </button>
          <h2 style={styles.title}>Welcome, {playerName}!</h2>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.topActions}>
          <button onClick={createLobby} style={styles.createButton}>
            + Create New Lobby
          </button>

          <div style={styles.joinCodeSection}>
            <input
              type="text"
              placeholder="Enter code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              style={styles.codeInputSmall}
              maxLength={6}
              onKeyDown={(e) => e.key === "Enter" && joinLobbyWithCode()}
            />
            <button onClick={joinLobbyWithCode} style={styles.joinSmallButton}>
              Join
            </button>
          </div>
        </div>

        {/* Available lobbies */}
        <div style={styles.lobbyListSection}>
          <div style={styles.listHeader}>
            <h3 style={styles.sectionTitle}>Public Lobbies</h3>
            <button onClick={refreshLobbies} style={styles.refreshButton}>
              ↻ Refresh
            </button>
          </div>

          {availableLobbies.length === 0 ? (
            <p style={styles.noLobbies}>
              No public lobbies. Create one or join with a code!
            </p>
          ) : (
            <div style={styles.lobbyGrid}>
              {availableLobbies.map((lobby) => (
                <div key={lobby.id} style={styles.lobbyCard}>
                  <div style={styles.lobbyCardHeader}>
                    <span style={styles.lobbyCardName}>{lobby.name}</span>
                    <span style={styles.lobbyCardPlayers}>
                      {lobby.players.length}/{lobby.maxPlayers} 👥
                    </span>
                  </div>
                  <div style={styles.lobbyCardHost}>
                    Host:{" "}
                    {lobby.players.find((p) => p.isHost)?.name || "Unknown"}
                  </div>
                  <div style={styles.lobbyCardStatus}>
                    {lobby.players.length < lobby.maxPlayers
                      ? "🟢 Open"
                      : "🔴 Full"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Screen: Name Entry (default)
  return (
    <div style={styles.container}>
      <div style={styles.centerContent}>
        <h1 style={styles.mainTitle}>Element Arena</h1>
        <p style={styles.subtitle}>Pokemon-inspired multiplayer battle game</p>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.nameForm}>
          <input
            type="text"
            placeholder="Enter your name"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            style={styles.nameInput}
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleNameSubmit()}
            maxLength={20}
          />
          <button
            onClick={handleNameSubmit}
            style={{
              ...styles.playButton,
              opacity: playerName.trim() ? 1 : 0.5,
            }}
            disabled={!playerName.trim()}
          >
            Play →
          </button>
        </div>

        <div style={styles.instructions}>
          <h4>How to Play:</h4>
          <ul>
            <li>
              Each player controls 3 characters with different elemental types
            </li>
            <li>Create a lobby and share the code with your friend</li>
            <li>Select your 3 characters wisely based on type advantages</li>
            <li>Click to move, battle, and dominate!</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    backgroundColor: "#0a0a15",
    color: "#fff",
    padding: "clamp(15px, 4vw, 40px)",
    fontFamily: "system-ui, -apple-system, sans-serif",
    boxSizing: "border-box",
    overflow: "auto",
  },
  centerContent: {
    maxWidth: "500px",
    margin: "0 auto",
    textAlign: "center",
    paddingTop: "clamp(20px, 5vh, 60px)",
  },
  mainTitle: {
    fontSize: "clamp(32px, 8vw, 56px)",
    margin: "0 0 10px 0",
    background:
      "linear-gradient(135deg, #ff4422, #ffdd00, #44cc44, #3399ff, #dd66ff)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    textShadow: "0 0 30px rgba(255,255,255,0.1)",
  },
  subtitle: {
    fontSize: "clamp(14px, 3vw, 18px)",
    color: "#888",
    margin: "0 0 clamp(20px, 5vh, 50px) 0",
  },
  loadingText: {
    fontSize: "18px",
    color: "#888",
    marginBottom: "20px",
  },
  spinner: {
    width: "40px",
    height: "40px",
    border: "4px solid #333",
    borderTopColor: "#4488ff",
    borderRadius: "50%",
    margin: "0 auto",
    animation: "spin 1s linear infinite",
  },
  errorBox: {
    backgroundColor: "#1a1a2e",
    padding: "30px",
    borderRadius: "12px",
    border: "1px solid #ff4444",
  },
  errorText: {
    fontSize: "18px",
    color: "#ff6666",
    margin: "0 0 15px 0",
  },
  helpText: {
    color: "#888",
    margin: "0 0 15px 0",
  },
  codeBlock: {
    display: "block",
    backgroundColor: "#0a0a15",
    color: "#4488ff",
    padding: "15px 20px",
    borderRadius: "8px",
    fontFamily: "monospace",
    fontSize: "14px",
    marginBottom: "20px",
  },
  retryButton: {
    padding: "15px 30px",
    fontSize: "16px",
    backgroundColor: "#4488ff",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
  },
  nameForm: {
    display: "flex",
    flexDirection: "column",
    gap: "15px",
    marginBottom: "40px",
  },
  nameInput: {
    padding: "20px",
    fontSize: "20px",
    backgroundColor: "#1a1a2e",
    color: "#fff",
    border: "2px solid #333",
    borderRadius: "12px",
    outline: "none",
    textAlign: "center",
  },
  playButton: {
    padding: "20px 40px",
    fontSize: "20px",
    backgroundColor: "#44cc44",
    color: "#fff",
    border: "none",
    borderRadius: "12px",
    cursor: "pointer",
    fontWeight: "bold",
    transition: "all 0.2s ease",
  },
  instructions: {
    textAlign: "left",
    backgroundColor: "#1a1a2e",
    padding: "clamp(15px, 3vw, 25px)",
    borderRadius: "12px",
    fontSize: "clamp(12px, 2vw, 14px)",
    color: "#aaa",
  },
  topActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "15px",
    marginBottom: "20px",
    alignItems: "center",
  },
  createButton: {
    padding: "clamp(12px, 2vw, 15px) clamp(20px, 3vw, 30px)",
    fontSize: "clamp(14px, 2vw, 16px)",
    backgroundColor: "#4488ff",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
    whiteSpace: "nowrap",
  },
  joinCodeSection: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
  },
  codeInputSmall: {
    padding: "12px 15px",
    fontSize: "14px",
    backgroundColor: "#0a0a15",
    color: "#fff",
    border: "2px solid #333",
    borderRadius: "8px",
    outline: "none",
    width: "100px",
    textAlign: "center",
    letterSpacing: "2px",
    fontFamily: "monospace",
    textTransform: "uppercase",
  },
  joinSmallButton: {
    padding: "12px 20px",
    fontSize: "14px",
    backgroundColor: "#44cc44",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
  },
  header: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "10px",
    marginBottom: "20px",
  },
  title: {
    fontSize: "clamp(18px, 4vw, 28px)",
    margin: 0,
    flex: 1,
    minWidth: "150px",
  },
  lobbyTitle: {
    margin: 0,
    fontSize: "clamp(18px, 4vw, 28px)",
    flex: 1,
    minWidth: "100px",
  },
  backButton: {
    padding: "8px 16px",
    backgroundColor: "transparent",
    color: "#888",
    border: "1px solid #444",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "14px",
    flexShrink: 0,
  },
  twoColumn: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "clamp(15px, 3vw, 30px)",
    marginBottom: "30px",
  },
  section: {
    backgroundColor: "#1a1a2e",
    padding: "clamp(15px, 3vw, 25px)",
    borderRadius: "12px",
  },
  sectionTitle: {
    margin: "0 0 15px 0",
    fontSize: "clamp(16px, 2.5vw, 18px)",
    color: "#fff",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  input: {
    padding: "15px",
    fontSize: "16px",
    backgroundColor: "#0a0a15",
    color: "#fff",
    border: "2px solid #333",
    borderRadius: "8px",
    outline: "none",
  },
  codeInput: {
    textAlign: "center",
    letterSpacing: "4px",
    fontFamily: "monospace",
    fontSize: "20px",
    textTransform: "uppercase",
  },
  primaryButton: {
    padding: "15px 30px",
    fontSize: "16px",
    backgroundColor: "#4488ff",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
  },
  joinButton: {
    padding: "15px 30px",
    fontSize: "16px",
    backgroundColor: "#44cc44",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
  },
  error: {
    padding: "15px",
    backgroundColor: "#ff444422",
    color: "#ff6666",
    borderRadius: "8px",
    marginBottom: "20px",
  },
  lobbyListSection: {
    backgroundColor: "#1a1a2e",
    padding: "clamp(15px, 3vw, 25px)",
    borderRadius: "12px",
  },
  listHeader: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "10px",
    marginBottom: "15px",
  },
  refreshButton: {
    padding: "8px 16px",
    backgroundColor: "transparent",
    color: "#4488ff",
    border: "1px solid #4488ff",
    borderRadius: "5px",
    cursor: "pointer",
  },
  noLobbies: {
    color: "#666",
    textAlign: "center",
    padding: "40px",
  },
  lobbyGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
    gap: "15px",
  },
  lobbyCard: {
    padding: "20px",
    backgroundColor: "#0a0a15",
    borderRadius: "10px",
    border: "1px solid #333",
  },
  lobbyCardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "10px",
  },
  lobbyCardName: {
    fontSize: "18px",
    fontWeight: "bold",
  },
  lobbyCardPlayers: {
    color: "#888",
    fontSize: "14px",
  },
  lobbyCardHost: {
    color: "#888",
    fontSize: "14px",
    marginBottom: "8px",
  },
  lobbyCardCode: {
    color: "#4488ff",
    fontSize: "14px",
    fontFamily: "monospace",
  },
  lobbyCardStatus: {
    fontSize: "14px",
    marginTop: "5px",
  },
  joinCodeBox: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "8px",
    backgroundColor: "#1a1a2e",
    padding: "8px 12px",
    borderRadius: "8px",
    flexShrink: 0,
  },
  joinCodeLabel: {
    color: "#888",
    fontSize: "clamp(12px, 2vw, 14px)",
  },
  joinCode: {
    color: "#ffdd00",
    fontSize: "clamp(16px, 3vw, 20px)",
    fontFamily: "monospace",
    fontWeight: "bold",
    letterSpacing: "2px",
  },
  copyButton: {
    padding: "5px 10px",
    backgroundColor: "transparent",
    border: "none",
    cursor: "pointer",
    fontSize: "16px",
  },
  lobbyContent: {
    display: "flex",
    flexDirection: "column",
    gap: "clamp(10px, 2vw, 20px)",
    maxHeight: "calc(100vh - 120px)",
    overflow: "auto",
  },
  playersSection: {
    backgroundColor: "#1a1a2e",
    borderRadius: "8px",
    padding: "clamp(10px, 2vw, 15px)",
  },
  playersSectionTitle: {
    margin: "0 0 10px 0",
    fontSize: "clamp(14px, 2vw, 16px)",
    color: "#fff",
  },
  playersList: {
    width: "100%",
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    alignItems: "flex-start",
  },
  playerCard: {
    padding: "clamp(8px, 1.5vw, 15px)",
    backgroundColor: "#1a1a2e",
    borderRadius: "8px",
    border: "2px solid #666",
    flex: "1 1 auto",
    minWidth: "clamp(150px, 30vw, 250px)",
    maxWidth: "300px",
  },
  playerName: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    fontSize: "16px",
    marginBottom: "5px",
  },
  hostBadge: {
    fontSize: "10px",
    padding: "2px 6px",
    backgroundColor: "#ffdd00",
    color: "#000",
    borderRadius: "3px",
    fontWeight: "bold",
  },
  youBadge: {
    fontSize: "10px",
    padding: "2px 6px",
    backgroundColor: "#4488ff",
    color: "#fff",
    borderRadius: "3px",
    fontWeight: "bold",
  },
  ready: {
    color: "#44ff44",
    fontSize: "14px",
  },
  notReady: {
    color: "#888",
    fontSize: "14px",
  },
  selectedChars: {
    display: "flex",
    gap: "5px",
    marginTop: "8px",
  },
  charBadge: {
    padding: "3px 8px",
    backgroundColor: "#333",
    borderRadius: "4px",
    fontSize: "12px",
    textTransform: "capitalize",
  },
  waitingSlot: {
    padding: "15px",
    backgroundColor: "#1a1a2e",
    borderRadius: "8px",
    border: "2px dashed #444",
    color: "#666",
    textAlign: "center",
  },
  selectSection: {
    flex: 1,
    minWidth: 0,
    width: "100%",
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    marginTop: "clamp(10px, 2vw, 20px)",
    padding: "clamp(10px, 2vw, 15px)",
    backgroundColor: "rgba(10, 10, 21, 0.95)",
    borderRadius: "8px",
    position: "sticky",
    bottom: 0,
    zIndex: 10,
  },
  readyButton: {
    padding: "clamp(10px, 2vw, 15px) clamp(20px, 4vw, 40px)",
    fontSize: "clamp(14px, 2vw, 16px)",
    backgroundColor: "#44cc44",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
    whiteSpace: "nowrap",
  },
  cancelButton: {
    padding: "clamp(10px, 2vw, 15px) clamp(20px, 4vw, 40px)",
    fontSize: "clamp(14px, 2vw, 16px)",
    backgroundColor: "#ff4444",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
    whiteSpace: "nowrap",
  },
  startButton: {
    padding: "clamp(10px, 2vw, 15px) clamp(20px, 4vw, 40px)",
    fontSize: "clamp(14px, 2vw, 16px)",
    backgroundColor: "#4488ff",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
    whiteSpace: "nowrap",
  },
  waitingMessage: {
    color: "#888",
    fontSize: "14px",
    marginTop: "15px",
  },
};

// Add keyframes for spinner animation
const styleSheet = document.createElement("style");
styleSheet.textContent = `
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`;
document.head.appendChild(styleSheet);

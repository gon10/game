import { useEffect, useRef, useState, useCallback } from "react";
import { Game } from "./core/Game";
import { NetworkClient } from "./network/Client";
import { LobbyScreen } from "./components/LobbyScreen";
import { CharacterHUD, CharacterInfo } from "./components/CharacterHUD";
import { TargetInfoPanel } from "./components/TargetInfoPanel";
import { InventoryBag } from "./components/InventoryBag";
import { ElementType } from "./types/CharacterTypes";
import {
  PlayerInventory,
  ElementType as ItemElementType,
  ConsumableType,
} from "./types/ItemTypes";

type AppState = "lobby" | "game";

interface TargetInfo {
  networkId: string;
  entityId: string;
  name: string;
  health: number;
  maxHealth: number;
  team: number;
  type: "champion" | "monster" | "resource_node";
  elementType?: string;
}

export default function App() {
  const [appState, setAppState] = useState<AppState>("lobby");
  const [gameConfig, setGameConfig] = useState<{
    lobbyId: string;
    playerId: string;
    selectedTypes: ElementType[];
    ws: WebSocket;
  } | null>(null);
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<TargetInfo | null>(null);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [inventory, setInventory] = useState<PlayerInventory | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const networkRef = useRef<NetworkClient | null>(null);
  const initializedRef = useRef(false);

  const handleGameStart = useCallback(
    (
      lobbyId: string,
      playerId: string,
      selectedTypes: ElementType[],
      ws: WebSocket
    ) => {
      console.log("[App] Game starting!", { lobbyId, playerId, selectedTypes });
      setGameConfig({ lobbyId, playerId, selectedTypes, ws });
      setAppState("game");
    },
    []
  );

  // Update character data periodically
  useEffect(() => {
    if (appState !== "game") return;

    let interval: NodeJS.Timeout | null = null;

    const updateCharacters = () => {
      if (gameRef.current) {
        const data = gameRef.current.getCharacterData();
        setCharacters(data);

        // Update selected target info
        const targetInfo = gameRef.current.getSelectedTargetInfo();
        setSelectedTarget(targetInfo);
      }
    };

    // Start polling after a short delay to ensure game is initialized
    const timeout = setTimeout(() => {
      updateCharacters();
      interval = setInterval(updateCharacters, 100);
    }, 200);

    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, [appState]);

  const handleToggleSelect = useCallback((index: number) => {
    gameRef.current?.toggleCharacterSelection(index);
    // Update UI immediately
    if (gameRef.current) {
      setCharacters(gameRef.current.getCharacterData());
    }
  }, []);

  const handleSelectAll = useCallback(() => {
    gameRef.current?.selectAllCharacters();
    // Update UI immediately
    if (gameRef.current) {
      setCharacters(gameRef.current.getCharacterData());
    }
  }, []);

  // Tab key to toggle inventory
  useEffect(() => {
    if (appState !== "game") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        e.preventDefault();
        setInventoryOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [appState]);

  // Inventory action handlers
  const handleConsumeTalisman = useCallback(
    (elementType: ItemElementType, targetCharId: string) => {
      networkRef.current?.sendConsumeTalisman(elementType, targetCharId);
    },
    []
  );

  const handleUseConsumable = useCallback(
    (consumableType: ConsumableType, targetCharId?: string) => {
      networkRef.current?.sendUseConsumable(consumableType, targetCharId);
    },
    []
  );

  const handlePurchaseConsumable = useCallback(
    (consumableType: ConsumableType) => {
      networkRef.current?.sendPurchaseConsumable(consumableType);
    },
    []
  );

  // Game initialization and inventory listener - combined to ensure proper order
  useEffect(() => {
    if (appState !== "game" || !gameConfig) return;

    // Prevent double initialization in React strict mode
    if (!canvasRef.current || initializedRef.current) return;
    initializedRef.current = true;

    console.log("[App] Initializing game...");

    // Initialize network client with existing WebSocket from lobby
    networkRef.current = new NetworkClient(gameConfig.ws, gameConfig.playerId);

    // Initialize game with canvas, network, and game config
    gameRef.current = new Game(
      canvasRef.current,
      networkRef.current,
      gameConfig.playerId,
      gameConfig.selectedTypes
    );

    // Set up inventory listener IMMEDIATELY after game creation, before start()
    const handleInventoryChange = (inv: PlayerInventory) => {
      console.log("[App] Received inventory change:", JSON.stringify(inv));
      // Create a deep copy to ensure React detects the change
      setInventory(JSON.parse(JSON.stringify(inv)));
    };

    gameRef.current.on("inventoryChanged", handleInventoryChange);
    console.log("[App] Registered inventory change listener");

    // Start the game
    gameRef.current.start();

    // Get initial inventory after start
    const initialInv = gameRef.current.getInventory() as PlayerInventory | null;
    console.log("[App] Initial inventory:", JSON.stringify(initialInv));
    if (initialInv) {
      setInventory(JSON.parse(JSON.stringify(initialInv)));
    }

    return () => {
      console.log("[App] Cleaning up game...");
      gameRef.current?.off("inventoryChanged", handleInventoryChange);
      gameRef.current?.dispose();
      networkRef.current?.disconnect();
      gameRef.current = null;
      networkRef.current = null;
      initializedRef.current = false;
    };
  }, [appState, gameConfig]);

  if (appState === "lobby") {
    return <LobbyScreen onGameStart={handleGameStart} />;
  }

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
      <TargetInfoPanel target={selectedTarget} />
      <CharacterHUD
        characters={characters}
        onToggleSelect={handleToggleSelect}
        onSelectAll={handleSelectAll}
      />

      {/* Inventory hint */}
      <div
        style={{
          position: "fixed",
          bottom: "10px",
          left: "50%",
          transform: "translateX(-50%)",
          backgroundColor: "rgba(0, 0, 0, 0.6)",
          color: "#fff",
          padding: "6px 12px",
          borderRadius: "4px",
          fontSize: "12px",
          pointerEvents: "none",
        }}
      >
        Press{" "}
        <kbd
          style={{
            backgroundColor: "#444",
            padding: "2px 6px",
            borderRadius: "3px",
          }}
        >
          Tab
        </kbd>{" "}
        to open Inventory
      </div>

      {/* Inventory Bag */}
      <InventoryBag
        inventory={inventory}
        isOpen={inventoryOpen}
        onClose={() => setInventoryOpen(false)}
        onConsumeTalisman={handleConsumeTalisman}
        onUseConsumable={handleUseConsumable}
        onPurchaseConsumable={handlePurchaseConsumable}
        characters={characters.map((c) => ({
          id: c.id,
          elementType: c.elementType,
          name: c.elementType.charAt(0).toUpperCase() + c.elementType.slice(1),
        }))}
      />
    </div>
  );
}

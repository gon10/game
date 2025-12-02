import { useState, useEffect, useCallback } from "react";
import {
  PlayerInventory,
  ITEM_DISPLAY,
  TALISMAN_DISPLAY,
  ElementType,
  ConsumableType,
} from "../types/ItemTypes";
import { CONSUMABLES, ConsumableDefinition } from "../types/ShopTypes";

export interface InventoryBagProps {
  inventory: PlayerInventory | null;
  isOpen: boolean;
  onClose: () => void;
  onConsumeTalisman?: (elementType: ElementType, targetCharId: string) => void;
  onUseConsumable?: (
    consumableType: ConsumableType,
    targetCharId?: string
  ) => void;
  onPurchaseConsumable?: (consumableType: ConsumableType) => void;
  selectedCharId?: string; // Currently selected character for talisman consumption
  characters?: Array<{ id: string; elementType: string; name: string }>;
}

type TabType = "resources" | "talismans" | "consumables" | "shop";

export function InventoryBag({
  inventory,
  isOpen,
  onClose,
  onConsumeTalisman,
  onUseConsumable,
  onPurchaseConsumable,
  selectedCharId: _selectedCharId, // Reserved for future use
  characters = [],
}: InventoryBagProps) {
  const [activeTab, setActiveTab] = useState<TabType>("resources");
  const [selectedTalisman, setSelectedTalisman] = useState<ElementType | null>(
    null
  );
  const [selectingCharFor, setSelectingCharFor] = useState<
    "talisman" | "consumable" | null
  >(null);
  const [pendingConsumable, setPendingConsumable] =
    useState<ConsumableType | null>(null);

  // Keyboard handler for Tab to toggle
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        e.preventDefault();
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  // Handle talisman click - start character selection
  const handleTalismanClick = (elementType: ElementType) => {
    if (!inventory || inventory.talismans[elementType] <= 0) return;
    setSelectedTalisman(elementType);
    setSelectingCharFor("talisman");
  };

  // Handle consumable click
  const handleConsumableClick = (consumableType: ConsumableType) => {
    if (!inventory || inventory.consumables[consumableType] <= 0) return;

    // Some consumables need a target
    if (
      consumableType === "health_potion" ||
      consumableType === "revival_scroll"
    ) {
      setPendingConsumable(consumableType);
      setSelectingCharFor("consumable");
    } else {
      // Team-wide effects don't need target
      onUseConsumable?.(consumableType);
    }
  };

  // Handle character selection for talisman/consumable
  const handleCharacterSelect = (charId: string) => {
    if (selectingCharFor === "talisman" && selectedTalisman) {
      onConsumeTalisman?.(selectedTalisman, charId);
      setSelectedTalisman(null);
    } else if (selectingCharFor === "consumable" && pendingConsumable) {
      onUseConsumable?.(pendingConsumable, charId);
      setPendingConsumable(null);
    }
    setSelectingCharFor(null);
  };

  // Check if player can afford a consumable
  const canAffordConsumable = (def: ConsumableDefinition): boolean => {
    if (!inventory) return false;
    return (
      inventory.resources.gold >= def.cost.gold &&
      inventory.resources.wood >= (def.cost.wood || 0) &&
      inventory.resources.stone >= (def.cost.stone || 0)
    );
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.container}>
        {/* Header */}
        <div style={styles.header}>
          <span style={styles.title}>🎒 Inventory</span>
          <button style={styles.closeButton} onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Resource summary bar */}
        <div style={styles.resourceBar}>
          <div style={styles.resourceItem}>
            <span style={styles.resourceIcon}>🪙</span>
            <span style={styles.resourceValue}>
              {inventory?.resources.gold ?? 0}
            </span>
          </div>
          <div style={styles.resourceItem}>
            <span style={styles.resourceIcon}>🪵</span>
            <span style={styles.resourceValue}>
              {inventory?.resources.wood ?? 0}
            </span>
          </div>
          <div style={styles.resourceItem}>
            <span style={styles.resourceIcon}>🪨</span>
            <span style={styles.resourceValue}>
              {inventory?.resources.stone ?? 0}
            </span>
          </div>
        </div>

        {/* Tab buttons */}
        <div style={styles.tabs}>
          {(["resources", "talismans", "consumables", "shop"] as TabType[]).map(
            (tab) => (
              <button
                key={tab}
                style={{
                  ...styles.tab,
                  ...(activeTab === tab ? styles.activeTab : {}),
                }}
                onClick={() => setActiveTab(tab)}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            )
          )}
        </div>

        {/* Tab content */}
        <div style={styles.content}>
          {activeTab === "resources" && (
            <div style={styles.itemGrid}>
              {(["wood", "gold", "stone"] as const).map((resource) => {
                const display = ITEM_DISPLAY[resource];
                const count = inventory?.resources[resource] ?? 0;
                return (
                  <div key={resource} style={styles.itemCard}>
                    <span style={styles.itemIcon}>{display.icon}</span>
                    <span style={styles.itemName}>{display.name}</span>
                    <span style={styles.itemCount}>{count}</span>
                    <span style={styles.itemDesc}>{display.description}</span>
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === "talismans" && (
            <div>
              {selectingCharFor === "talisman" && selectedTalisman && (
                <div style={styles.selectPrompt}>
                  <span>
                    Select a character to apply{" "}
                    {TALISMAN_DISPLAY[selectedTalisman].name}:
                  </span>
                  <div style={styles.charSelectRow}>
                    {characters.map((char) => (
                      <button
                        key={char.id}
                        style={styles.charButton}
                        onClick={() => handleCharacterSelect(char.id)}
                      >
                        {char.name}
                      </button>
                    ))}
                  </div>
                  <button
                    style={styles.cancelButton}
                    onClick={() => setSelectingCharFor(null)}
                  >
                    Cancel
                  </button>
                </div>
              )}
              <div style={styles.itemGrid}>
                {(Object.keys(TALISMAN_DISPLAY) as ElementType[]).map(
                  (element) => {
                    const display = TALISMAN_DISPLAY[element];
                    const count = inventory?.talismans[element] ?? 0;
                    const colorHex = `#${display.color
                      .toString(16)
                      .padStart(6, "0")}`;
                    return (
                      <div
                        key={element}
                        style={{
                          ...styles.itemCard,
                          ...(count > 0 ? styles.clickable : styles.disabled),
                          borderColor: colorHex,
                        }}
                        onClick={() => handleTalismanClick(element)}
                      >
                        <div
                          style={{
                            ...styles.talismanIcon,
                            backgroundColor: colorHex,
                            boxShadow: `0 0 10px ${colorHex}`,
                          }}
                        >
                          🔮
                        </div>
                        <span style={styles.itemName}>{display.name}</span>
                        <span style={styles.itemCount}>{count}</span>
                        <span style={styles.itemDesc}>
                          Click to upgrade ability
                        </span>
                      </div>
                    );
                  }
                )}
              </div>
            </div>
          )}

          {activeTab === "consumables" && (
            <div>
              {selectingCharFor === "consumable" && pendingConsumable && (
                <div style={styles.selectPrompt}>
                  <span>
                    Select a character to use{" "}
                    {ITEM_DISPLAY[pendingConsumable].name}:
                  </span>
                  <div style={styles.charSelectRow}>
                    {characters.map((char) => (
                      <button
                        key={char.id}
                        style={styles.charButton}
                        onClick={() => handleCharacterSelect(char.id)}
                      >
                        {char.name}
                      </button>
                    ))}
                  </div>
                  <button
                    style={styles.cancelButton}
                    onClick={() => setSelectingCharFor(null)}
                  >
                    Cancel
                  </button>
                </div>
              )}
              <div style={styles.itemGrid}>
                {(Object.keys(ITEM_DISPLAY) as (keyof typeof ITEM_DISPLAY)[])
                  .filter((key) => key.includes("_") && key !== "talisman")
                  .map((consumable) => {
                    const display = ITEM_DISPLAY[consumable];
                    const count =
                      inventory?.consumables[consumable as ConsumableType] ?? 0;
                    return (
                      <div
                        key={consumable}
                        style={{
                          ...styles.itemCard,
                          ...(count > 0 ? styles.clickable : styles.disabled),
                        }}
                        onClick={() =>
                          handleConsumableClick(consumable as ConsumableType)
                        }
                      >
                        <span style={styles.itemIcon}>{display.icon}</span>
                        <span style={styles.itemName}>{display.name}</span>
                        <span style={styles.itemCount}>{count}</span>
                        <span style={styles.itemDesc}>
                          {display.description}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {activeTab === "shop" && (
            <div style={styles.shopGrid}>
              {Object.values(CONSUMABLES).map((consumable) => {
                const affordable = canAffordConsumable(consumable);
                return (
                  <div
                    key={consumable.id}
                    style={{
                      ...styles.shopCard,
                      ...(affordable ? styles.clickable : styles.disabled),
                    }}
                    onClick={() =>
                      affordable && onPurchaseConsumable?.(consumable.id)
                    }
                  >
                    <span style={styles.itemIcon}>{consumable.icon}</span>
                    <span style={styles.itemName}>{consumable.name}</span>
                    <span style={styles.itemDesc}>
                      {consumable.description}
                    </span>
                    <div style={styles.costRow}>
                      {consumable.cost.gold > 0 && (
                        <span style={styles.cost}>
                          🪙 {consumable.cost.gold}
                        </span>
                      )}
                      {consumable.cost.wood > 0 && (
                        <span style={styles.cost}>
                          🪵 {consumable.cost.wood}
                        </span>
                      )}
                      {consumable.cost.stone > 0 && (
                        <span style={styles.cost}>
                          🪨 {consumable.cost.stone}
                        </span>
                      )}
                    </div>
                    <button
                      style={{
                        ...styles.buyButton,
                        opacity: affordable ? 1 : 0.5,
                      }}
                      disabled={!affordable}
                    >
                      Buy
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div style={styles.footer}>
          Press <kbd style={styles.kbd}>Tab</kbd> to close
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  container: {
    width: "600px",
    maxHeight: "80vh",
    backgroundColor: "#1a1a2e",
    borderRadius: "12px",
    border: "2px solid #4a4a6a",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px 20px",
    backgroundColor: "#2a2a4a",
    borderBottom: "1px solid #4a4a6a",
  },
  title: {
    fontSize: "20px",
    fontWeight: "bold",
    color: "#ffffff",
  },
  closeButton: {
    background: "none",
    border: "none",
    color: "#aaa",
    fontSize: "20px",
    cursor: "pointer",
  },
  resourceBar: {
    display: "flex",
    justifyContent: "center",
    gap: "30px",
    padding: "12px",
    backgroundColor: "#252540",
    borderBottom: "1px solid #4a4a6a",
  },
  resourceItem: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  resourceIcon: {
    fontSize: "20px",
  },
  resourceValue: {
    fontSize: "18px",
    fontWeight: "bold",
    color: "#ffffff",
  },
  tabs: {
    display: "flex",
    borderBottom: "1px solid #4a4a6a",
  },
  tab: {
    flex: 1,
    padding: "12px",
    background: "none",
    border: "none",
    color: "#888",
    fontSize: "14px",
    cursor: "pointer",
    transition: "all 0.2s",
  },
  activeTab: {
    color: "#fff",
    backgroundColor: "#3a3a5a",
    borderBottom: "2px solid #6a6aff",
  },
  content: {
    flex: 1,
    padding: "16px",
    overflowY: "auto",
  },
  itemGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "12px",
  },
  itemCard: {
    backgroundColor: "#2a2a4a",
    borderRadius: "8px",
    padding: "12px",
    border: "2px solid #4a4a6a",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "6px",
    transition: "all 0.2s",
  },
  clickable: {
    cursor: "pointer",
    opacity: 1,
  },
  disabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  itemIcon: {
    fontSize: "32px",
  },
  itemName: {
    fontSize: "14px",
    fontWeight: "bold",
    color: "#ffffff",
    textAlign: "center",
  },
  itemCount: {
    fontSize: "18px",
    fontWeight: "bold",
    color: "#88ff88",
  },
  itemDesc: {
    fontSize: "10px",
    color: "#888",
    textAlign: "center",
  },
  talismanIcon: {
    width: "48px",
    height: "48px",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "24px",
  },
  selectPrompt: {
    backgroundColor: "#3a3a5a",
    padding: "12px",
    borderRadius: "8px",
    marginBottom: "12px",
    textAlign: "center",
    color: "#fff",
  },
  charSelectRow: {
    display: "flex",
    justifyContent: "center",
    gap: "10px",
    marginTop: "10px",
  },
  charButton: {
    padding: "8px 16px",
    backgroundColor: "#4a4aff",
    border: "none",
    borderRadius: "4px",
    color: "#fff",
    cursor: "pointer",
  },
  cancelButton: {
    marginTop: "10px",
    padding: "6px 12px",
    backgroundColor: "#666",
    border: "none",
    borderRadius: "4px",
    color: "#fff",
    cursor: "pointer",
  },
  shopGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: "12px",
  },
  shopCard: {
    backgroundColor: "#2a2a4a",
    borderRadius: "8px",
    padding: "12px",
    border: "2px solid #4a4a6a",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "6px",
    transition: "all 0.2s",
  },
  costRow: {
    display: "flex",
    gap: "10px",
    marginTop: "6px",
  },
  cost: {
    fontSize: "12px",
    color: "#ffcc00",
  },
  buyButton: {
    marginTop: "8px",
    padding: "6px 20px",
    backgroundColor: "#44aa44",
    border: "none",
    borderRadius: "4px",
    color: "#fff",
    fontWeight: "bold",
    cursor: "pointer",
  },
  footer: {
    padding: "10px",
    textAlign: "center",
    borderTop: "1px solid #4a4a6a",
    color: "#888",
    fontSize: "12px",
  },
  kbd: {
    backgroundColor: "#4a4a6a",
    padding: "2px 6px",
    borderRadius: "4px",
    color: "#fff",
  },
};

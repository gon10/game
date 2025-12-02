import { useState, useEffect } from "react";
import { CHARACTER_TYPES, ElementType } from "../types/CharacterTypes";
import { ABILITIES } from "../types/AbilityTypes";
import { AbilityLevel } from "../ecs/components";

export interface CharacterInfo {
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
  respawnAt?: number; // Timestamp when respawn happens
}

interface CharacterHUDProps {
  characters: CharacterInfo[];
  onToggleSelect: (index: number) => void;
  onSelectAll: () => void;
}

export function CharacterHUD({
  characters,
  onToggleSelect,
  onSelectAll,
}: CharacterHUDProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [, setTick] = useState(0); // Force re-render for respawn countdown

  // Update every 100ms to refresh respawn timers
  useEffect(() => {
    const hasDeadChars = characters.some((c) => c.isDead && c.respawnAt);
    if (!hasDeadChars) return;

    const interval = setInterval(() => setTick((t) => t + 1), 100);
    return () => clearInterval(interval);
  }, [characters]);

  if (characters.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingText}>Waiting for characters...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Compact header */}
      <div style={styles.header}>
        <span style={styles.title}>TEAM</span>
        <button onClick={onSelectAll} style={styles.selectAllButton}>
          [A] All
        </button>
      </div>

      <div style={styles.characterList}>
        {characters.map((char, idx) => {
          const typeInfo = CHARACTER_TYPES[char.elementType];
          const healthPercent = (char.health / char.maxHealth) * 100;
          const manaPercent = ((char.mana ?? 0) / (char.maxMana ?? 100)) * 100;
          const xpPercent =
            ((char.currentXP ?? 0) / (char.xpToNextLevel ?? 100)) * 100;
          const isHovered = hoveredIndex === idx;
          const colorHex = `#${typeInfo.color.toString(16).padStart(6, "0")}`;

          // Calculate respawn timer if dead
          const respawnRemaining =
            char.isDead && char.respawnAt
              ? Math.max(0, Math.ceil((char.respawnAt - Date.now()) / 1000))
              : 0;
          const isDead = char.isDead && respawnRemaining > 0;

          return (
            <div
              key={char.id}
              onClick={() => !isDead && onToggleSelect(idx)}
              onMouseEnter={() => setHoveredIndex(idx)}
              onMouseLeave={() => setHoveredIndex(null)}
              style={{
                ...styles.characterCard,
                borderColor: isDead
                  ? "#444"
                  : char.isSelected
                  ? colorHex
                  : "#333",
                backgroundColor: isDead
                  ? "#1a1a1a"
                  : char.isSelected
                  ? `${colorHex}20`
                  : "#0a0a15",
                transform: isHovered && !isDead ? "scale(1.02)" : "scale(1)",
                opacity: isDead ? 0.6 : 1,
                filter: isDead ? "grayscale(80%)" : "none",
                cursor: isDead ? "not-allowed" : "pointer",
              }}
            >
              {/* Death overlay on card */}
              {isDead && (
                <div style={styles.deathOverlay}>
                  <span style={styles.skullIcon}>💀</span>
                  <span style={styles.respawnTimer}>{respawnRemaining}s</span>
                </div>
              )}

              {/* Left: Selection + Icon */}
              <div style={styles.leftSection}>
                <div
                  style={{
                    ...styles.selectionDot,
                    backgroundColor: isDead
                      ? "#555"
                      : char.isSelected
                      ? colorHex
                      : "#333",
                  }}
                >
                  {!isDead && char.isSelected && "✓"}
                  {isDead && "✗"}
                </div>
                <div
                  style={{
                    ...styles.charIcon,
                    backgroundColor: isDead ? "#444" : colorHex,
                  }}
                >
                  {typeInfo.name.charAt(0)}
                </div>
                <span style={styles.keyHint}>[{idx + 1}]</span>
              </div>

              {/* Right: Stats */}
              <div style={styles.statsSection}>
                {/* Name + Level */}
                <div style={styles.nameRow}>
                  <span style={styles.charName}>{typeInfo.name}</span>
                  <span style={styles.levelBadge}>Lv.{char.level ?? 1}</span>
                </div>

                {/* HP Bar */}
                <div style={styles.barRow}>
                  <span style={styles.barLabel}>HP</span>
                  <div style={styles.barContainer}>
                    <div
                      style={{
                        ...styles.barFill,
                        width: `${healthPercent}%`,
                        backgroundColor:
                          healthPercent > 50
                            ? "#44cc44"
                            : healthPercent > 25
                            ? "#ccaa44"
                            : "#cc4444",
                      }}
                    />
                  </div>
                  <span style={styles.barValue}>
                    {Math.ceil(char.health)}/{char.maxHealth}
                  </span>
                </div>

                {/* Mana Bar */}
                <div style={styles.barRow}>
                  <span style={styles.barLabel}>MP</span>
                  <div style={styles.barContainer}>
                    <div
                      style={{
                        ...styles.barFill,
                        width: `${manaPercent}%`,
                        backgroundColor: "#4488ff",
                      }}
                    />
                  </div>
                  <span style={styles.barValue}>
                    {Math.ceil(char.mana ?? 0)}/{char.maxMana ?? 100}
                  </span>
                </div>

                {/* XP Bar */}
                <div style={styles.barRow}>
                  <span style={styles.barLabel}>XP</span>
                  <div style={styles.barContainer}>
                    <div
                      style={{
                        ...styles.barFill,
                        width: `${xpPercent}%`,
                        backgroundColor: "#aa66ff",
                      }}
                    />
                  </div>
                  <span style={styles.barValue}>
                    {Math.floor(char.currentXP ?? 0)}/
                    {char.xpToNextLevel ?? 100}
                  </span>
                </div>

                {/* Ability info */}
                <div style={styles.abilityRow}>
                  <span
                    style={{
                      ...styles.abilityBadge,
                      color:
                        char.abilityLevel === "P"
                          ? "#ff8800"
                          : char.abilityLevel === "G"
                          ? "#aa44ff"
                          : "#888",
                    }}
                  >
                    [{char.abilityLevel ?? "M"}]
                  </span>
                  <span style={styles.abilityName}>
                    {ABILITIES[char.elementType]?.name ?? "Ability"}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={styles.helpText}>1/2/3 toggle • A select all</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "absolute",
    bottom: "1vh",
    left: "1vw",
    backgroundColor: "rgba(5, 5, 15, 0.92)",
    borderRadius: "8px",
    padding: "clamp(8px, 1vw, 14px)",
    width: "clamp(200px, 22vw, 320px)",
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "#fff",
    border: "1px solid #333",
    zIndex: 1000,
    fontSize: "clamp(10px, 1.2vw, 14px)",
  },
  loadingText: {
    color: "#666",
    textAlign: "center",
    padding: "16px 0",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "clamp(6px, 0.8vh, 10px)",
    paddingBottom: "clamp(4px, 0.5vh, 8px)",
    borderBottom: "1px solid #333",
  },
  title: {
    fontSize: "clamp(11px, 1.3vw, 15px)",
    fontWeight: "bold",
    color: "#888",
    letterSpacing: "1px",
  },
  selectAllButton: {
    padding: "3px 8px",
    fontSize: "clamp(9px, 1vw, 12px)",
    backgroundColor: "transparent",
    color: "#4488ff",
    border: "1px solid #4488ff",
    borderRadius: "3px",
    cursor: "pointer",
  },
  characterList: {
    display: "flex",
    flexDirection: "column",
    gap: "clamp(4px, 0.6vh, 8px)",
  },
  characterCard: {
    position: "relative",
    display: "flex",
    alignItems: "stretch",
    gap: "clamp(6px, 0.8vw, 10px)",
    padding: "clamp(6px, 0.8vw, 10px)",
    borderRadius: "6px",
    border: "2px solid #333",
    cursor: "pointer",
    transition: "all 0.12s ease",
  },
  leftSection: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "2px",
    minWidth: "clamp(32px, 4vw, 44px)",
  },
  selectionDot: {
    width: "clamp(14px, 1.8vw, 20px)",
    height: "clamp(14px, 1.8vw, 20px)",
    borderRadius: "4px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "clamp(9px, 1vw, 12px)",
    fontWeight: "bold",
    color: "#fff",
  },
  charIcon: {
    width: "clamp(28px, 3.5vw, 40px)",
    height: "clamp(28px, 3.5vw, 40px)",
    borderRadius: "6px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "clamp(14px, 1.8vw, 20px)",
    fontWeight: "bold",
    color: "#fff",
  },
  keyHint: {
    fontSize: "clamp(8px, 0.9vw, 10px)",
    color: "#555",
  },
  statsSection: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "clamp(2px, 0.3vh, 4px)",
    minWidth: 0,
  },
  nameRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  charName: {
    fontSize: "clamp(11px, 1.3vw, 14px)",
    fontWeight: "bold",
    color: "#ddd",
  },
  levelBadge: {
    fontSize: "clamp(9px, 1vw, 11px)",
    fontWeight: "bold",
    color: "#ffd700",
    backgroundColor: "#332800",
    padding: "1px 4px",
    borderRadius: "3px",
  },
  barRow: {
    display: "flex",
    alignItems: "center",
    gap: "clamp(3px, 0.4vw, 6px)",
  },
  barLabel: {
    fontSize: "clamp(8px, 0.9vw, 10px)",
    color: "#666",
    width: "clamp(16px, 2vw, 22px)",
    flexShrink: 0,
  },
  barContainer: {
    flex: 1,
    height: "clamp(6px, 0.8vh, 10px)",
    backgroundColor: "#1a1a1a",
    borderRadius: "3px",
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: "3px",
    transition: "width 0.2s ease",
  },
  barValue: {
    fontSize: "clamp(8px, 0.9vw, 10px)",
    color: "#888",
    width: "clamp(40px, 5vw, 60px)",
    textAlign: "right",
    flexShrink: 0,
  },
  abilityRow: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    marginTop: "2px",
  },
  abilityBadge: {
    fontSize: "clamp(9px, 1vw, 11px)",
    fontWeight: "bold",
  },
  abilityName: {
    fontSize: "clamp(9px, 1vw, 11px)",
    color: "#777",
  },
  helpText: {
    marginTop: "clamp(6px, 0.8vh, 10px)",
    fontSize: "clamp(8px, 0.9vw, 10px)",
    color: "#444",
    textAlign: "center",
  },
  deathOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    borderRadius: "6px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "2px",
    zIndex: 10,
  },
  skullIcon: {
    fontSize: "clamp(18px, 2.5vw, 28px)",
    filter: "drop-shadow(0 0 4px rgba(255, 0, 0, 0.5))",
  },
  respawnTimer: {
    fontSize: "clamp(12px, 1.5vw, 18px)",
    fontWeight: "bold",
    color: "#ff6666",
    textShadow: "0 0 6px rgba(255, 0, 0, 0.5)",
  },
};

import React from "react";

interface TargetInfo {
  networkId: string;
  entityId: string;
  name: string;
  health: number;
  maxHealth: number;
  team: number;
  type: "champion" | "monster" | "resource_node";
  elementType?: string;
  level?: number;
  monsterType?: string;
  nodeType?: string;
}

interface TargetInfoPanelProps {
  target: TargetInfo | null;
}

/**
 * Target Info Panel - Shows selected target's HP and info like LoL
 * Appears at top center when a target is selected via left-click
 */
export const TargetInfoPanel: React.FC<TargetInfoPanelProps> = ({ target }) => {
  if (!target) return null;

  const healthPercent = (target.health / target.maxHealth) * 100;

  // Health bar color based on percentage
  const getHealthColor = () => {
    if (healthPercent > 50) return "#44ff44";
    if (healthPercent > 25) return "#ffaa00";
    return "#ff4444";
  };

  // Border color based on team/type
  const getBorderColor = () => {
    if (target.type === "monster") return "#ffaa00"; // Orange for monsters
    if (target.team === 1) return "#4488ff"; // Blue team
    if (target.team === 2) return "#ff4444"; // Red team
    return "#888888"; // Neutral
  };

  // Element type icon/color
  const getElementColor = () => {
    switch (target.elementType) {
      case "fire":
        return "#ff6600";
      case "water":
        return "#4488ff";
      case "grass":
        return "#44ff44";
      case "electric":
        return "#ffff00";
      case "rock":
        return "#886644";
      case "psychic":
        return "#ff44ff";
      default:
        return "#aaaaaa";
    }
  };

  return (
    <div
      style={{
        position: "absolute",
        top: "clamp(10px, 2vh, 20px)",
        left: "50%",
        transform: "translateX(-50%)",
        background:
          "linear-gradient(to bottom, rgba(20, 20, 30, 0.95), rgba(10, 10, 20, 0.95))",
        border: `2px solid ${getBorderColor()}`,
        borderRadius: "clamp(4px, 0.8vw, 8px)",
        padding: "clamp(8px, 1.2vw, 12px) clamp(12px, 2vw, 20px)",
        minWidth: "clamp(180px, 20vw, 280px)",
        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.5)",
        fontFamily: "Arial, sans-serif",
        color: "#ffffff",
        zIndex: 1000,
      }}
    >
      {/* Target Name & Level */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "clamp(4px, 0.8vh, 8px)",
          gap: "clamp(6px, 1vw, 10px)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "clamp(4px, 0.6vw, 8px)",
          }}
        >
          {/* Level badge */}
          {target.level && (
            <span
              style={{
                background: "linear-gradient(135deg, #ffd700, #ff8c00)",
                color: "#000",
                padding: "clamp(1px, 0.2vh, 3px) clamp(4px, 0.6vw, 8px)",
                borderRadius: "clamp(2px, 0.4vw, 4px)",
                fontSize: "clamp(10px, 1.2vw, 14px)",
                fontWeight: "bold",
                minWidth: "clamp(28px, 3vw, 40px)",
                textAlign: "center",
              }}
            >
              {target.level}
            </span>
          )}

          <span
            style={{
              fontSize: "clamp(12px, 1.5vw, 18px)",
              fontWeight: "bold",
              textTransform: "capitalize",
            }}
          >
            {target.name}
          </span>
        </div>

        {/* Element type badge */}
        {target.elementType && (
          <span
            style={{
              background: getElementColor(),
              color: "#000",
              padding: "clamp(1px, 0.2vh, 3px) clamp(4px, 0.6vw, 8px)",
              borderRadius: "clamp(2px, 0.4vw, 4px)",
              fontSize: "clamp(9px, 1vw, 12px)",
              fontWeight: "bold",
              textTransform: "uppercase",
            }}
          >
            {target.elementType}
          </span>
        )}
      </div>

      {/* Health Bar */}
      <div
        style={{
          background: "rgba(0, 0, 0, 0.5)",
          borderRadius: "clamp(2px, 0.4vw, 4px)",
          height: "clamp(14px, 2vh, 22px)",
          overflow: "hidden",
          position: "relative",
          border: "1px solid rgba(255, 255, 255, 0.2)",
        }}
      >
        {/* Health fill */}
        <div
          style={{
            width: `${healthPercent}%`,
            height: "100%",
            background: `linear-gradient(to bottom, ${getHealthColor()}, ${getHealthColor()}88)`,
            transition: "width 0.2s ease-out",
          }}
        />

        {/* Health text */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            fontSize: "clamp(9px, 1.1vw, 13px)",
            fontWeight: "bold",
            textShadow: "1px 1px 2px rgba(0, 0, 0, 0.8)",
          }}
        >
          {Math.ceil(target.health)} / {target.maxHealth}
        </div>
      </div>

      {/* Target Type Label */}
      <div
        style={{
          marginTop: "clamp(4px, 0.5vh, 6px)",
          fontSize: "clamp(9px, 1vw, 12px)",
          color: "rgba(255, 255, 255, 0.6)",
          textAlign: "center",
          textTransform: "uppercase",
          letterSpacing: "1px",
        }}
      >
        {target.type === "resource_node"
          ? `⛏ ${target.name}`
          : target.type === "monster"
          ? `⚔ ${target.monsterType || "Monster"}`
          : `⚔ ${target.team === 1 ? "Blue" : "Red"} Team Champion`}
      </div>
    </div>
  );
};

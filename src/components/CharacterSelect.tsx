import {
  ElementType,
  CHARACTER_TYPES,
  getAllTypes,
} from "../types/CharacterTypes";

interface CharacterSelectProps {
  selectedTypes: ElementType[];
  onSelectionChange: (types: ElementType[]) => void;
  maxSelection: number;
  disabled?: boolean;
}

/**
 * Character selection grid - allows picking characters from the 6 types
 */
export function CharacterSelect({
  selectedTypes,
  onSelectionChange,
  maxSelection,
  disabled = false,
}: CharacterSelectProps) {
  const allTypes = getAllTypes();

  const toggleType = (type: ElementType) => {
    if (disabled) return;

    if (selectedTypes.includes(type)) {
      // Deselect
      onSelectionChange(selectedTypes.filter((t) => t !== type));
    } else if (selectedTypes.length < maxSelection) {
      // Select if under limit
      onSelectionChange([...selectedTypes, type]);
    }
  };

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>Select {maxSelection} Characters</h3>
      <p style={styles.subtitle}>
        {selectedTypes.length}/{maxSelection} selected
      </p>

      <div style={styles.grid}>
        {allTypes.map((type) => {
          const info = CHARACTER_TYPES[type];
          const isSelected = selectedTypes.includes(type);
          const canSelect = selectedTypes.length < maxSelection || isSelected;

          return (
            <div
              key={type}
              onClick={() => toggleType(type)}
              style={{
                ...styles.card,
                borderColor: isSelected
                  ? `#${info.color.toString(16)}`
                  : "#444",
                backgroundColor: isSelected
                  ? `#${info.color.toString(16)}22`
                  : "#1a1a2e",
                opacity: canSelect || disabled ? 1 : 0.5,
                cursor: disabled
                  ? "default"
                  : canSelect
                  ? "pointer"
                  : "not-allowed",
              }}
            >
              <div
                style={{
                  ...styles.colorDot,
                  backgroundColor: `#${info.color.toString(16)}`,
                }}
              />
              <h4 style={styles.typeName}>{info.name}</h4>
              <p style={styles.description}>{info.description}</p>

              <div style={styles.stats}>
                <StatBar
                  label="HP"
                  value={info.stats.health}
                  max={150}
                  color="#44ff44"
                />
                <StatBar
                  label="ATK"
                  value={info.stats.attackDamage}
                  max={15}
                  color="#ff4444"
                />
                <StatBar
                  label="SPD"
                  value={info.stats.moveSpeed}
                  max={13}
                  color="#44aaff"
                />
              </div>

              {isSelected && (
                <div style={styles.selectedBadge}>
                  #{selectedTypes.indexOf(type) + 1}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const percent = (value / max) * 100;

  return (
    <div style={styles.statRow}>
      <span style={styles.statLabel}>{label}</span>
      <div style={styles.statBarBg}>
        <div
          style={{
            ...styles.statBarFill,
            width: `${percent}%`,
            backgroundColor: color,
          }}
        />
      </div>
      <span style={styles.statValue}>{value}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: "clamp(8px, 1.5vw, 15px)",
  },
  title: {
    color: "#fff",
    margin: "0 0 4px 0",
    fontSize: "clamp(16px, 3vw, 22px)",
  },
  subtitle: {
    color: "#888",
    margin: "0 0 10px 0",
    fontSize: "clamp(11px, 1.8vw, 14px)",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "clamp(6px, 1.5vw, 12px)",
    maxWidth: "100%",
  },
  card: {
    position: "relative",
    padding: "clamp(8px, 1.5vw, 12px)",
    borderRadius: "8px",
    border: "2px solid #444",
    transition: "all 0.2s ease",
    minWidth: 0,
    overflow: "hidden",
  },
  colorDot: {
    width: "clamp(16px, 3vw, 24px)",
    height: "clamp(16px, 3vw, 24px)",
    borderRadius: "50%",
    marginBottom: "6px",
  },
  typeName: {
    color: "#fff",
    margin: "0 0 4px 0",
    fontSize: "clamp(12px, 2vw, 16px)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  description: {
    color: "#aaa",
    margin: "0 0 8px 0",
    fontSize: "clamp(9px, 1.2vw, 11px)",
    lineHeight: "1.3",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  stats: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
  },
  statRow: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
  },
  statLabel: {
    color: "#888",
    fontSize: "clamp(9px, 1.2vw, 11px)",
    width: "clamp(22px, 3vw, 28px)",
    flexShrink: 0,
  },
  statBarBg: {
    flex: 1,
    height: "clamp(4px, 0.8vw, 6px)",
    backgroundColor: "#333",
    borderRadius: "3px",
    overflow: "hidden",
    minWidth: "20px",
  },
  statBarFill: {
    height: "100%",
    borderRadius: "3px",
    transition: "width 0.3s ease",
  },
  statValue: {
    color: "#fff",
    fontSize: "clamp(9px, 1.2vw, 11px)",
    width: "clamp(18px, 2.5vw, 24px)",
    textAlign: "right",
    flexShrink: 0,
  },
  selectedBadge: {
    position: "absolute",
    top: "clamp(4px, 1vw, 8px)",
    right: "clamp(4px, 1vw, 8px)",
    backgroundColor: "#fff",
    color: "#000",
    width: "clamp(18px, 2.5vw, 24px)",
    height: "clamp(18px, 2.5vw, 24px)",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: "bold",
    fontSize: "clamp(10px, 1.5vw, 14px)",
  },
};

import { useEffect, useState } from "react";

interface DeathOverlayProps {
  deadCharacters: Map<string, { respawnAt: number }>;
}

/**
 * Death Overlay - Shows when characters are dead
 * Displays countdown to next respawn
 */
export function DeathOverlay({ deadCharacters }: DeathOverlayProps) {
  const [timeRemaining, setTimeRemaining] = useState(0);

  // Find the soonest respawn time among dead characters
  useEffect(() => {
    if (deadCharacters.size === 0) {
      setTimeRemaining(0);
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      let soonest = Infinity;

      for (const { respawnAt } of deadCharacters.values()) {
        const remaining = Math.max(0, respawnAt - now);
        if (remaining < soonest) {
          soonest = remaining;
        }
      }

      setTimeRemaining(soonest === Infinity ? 0 : soonest / 1000);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 100);
    return () => clearInterval(interval);
  }, [deadCharacters]);

  // Only show overlay if there are dead characters
  if (deadCharacters.size === 0 || timeRemaining <= 0) return null;

  const displayTime = Math.ceil(timeRemaining);

  return (
    <div style={styles.overlay}>
      {/* Semi-transparent grey tint */}
      <div style={styles.greyTint} />

      {/* Death content */}
      <div style={styles.content}>
        {/* Skull icon */}
        <div style={styles.skullIcon}>💀</div>

        {/* Death text */}
        <div style={styles.deathText}>
          {deadCharacters.size === 1
            ? "CHARACTER DOWN"
            : `${deadCharacters.size} CHARACTERS DOWN`}
        </div>

        {/* Respawn countdown */}
        <div style={styles.respawnContainer}>
          <div style={styles.respawnLabel}>Next respawn in</div>
          <div style={styles.countdownNumber}>{displayTime}</div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2000,
    pointerEvents: "none", // Allow clicks through to game
  },
  greyTint: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(30, 30, 30, 0.5)",
  },
  content: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "12px",
    padding: "30px 50px",
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    borderRadius: "12px",
    border: "2px solid #cc2222",
    boxShadow: "0 0 30px rgba(200, 0, 0, 0.3)",
  },
  skullIcon: {
    fontSize: "48px",
    animation: "pulse 1.5s infinite",
    filter: "drop-shadow(0 0 10px rgba(255, 0, 0, 0.5))",
  },
  deathText: {
    fontSize: "32px",
    fontWeight: "bold",
    color: "#cc2222",
    textTransform: "uppercase",
    letterSpacing: "4px",
    textShadow: "0 0 15px rgba(200, 0, 0, 0.5), 0 2px 4px rgba(0, 0, 0, 0.8)",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  respawnContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "4px",
    marginTop: "8px",
  },
  respawnLabel: {
    fontSize: "14px",
    color: "#888",
    textTransform: "uppercase",
    letterSpacing: "2px",
  },
  countdownNumber: {
    fontSize: "56px",
    fontWeight: "bold",
    color: "#ffffff",
    textShadow: "0 0 15px rgba(255, 255, 255, 0.3)",
    fontFamily: "monospace",
    lineHeight: 1,
  },
};

// Add CSS animation for skull pulse
const styleSheet = document.createElement("style");
styleSheet.textContent = `
  @keyframes pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.1); opacity: 0.8; }
  }
`;
document.head.appendChild(styleSheet);

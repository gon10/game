import * as THREE from 'three';

/**
 * Hexagonal map configuration
 * Map is divided into 5 player wedges + safe corridors
 * MUST MATCH server/MonsterManager.ts MAP_CONFIG!
 */
export const MAP_CONFIG = {
  RADIUS: 350, // Hexagon radius (distance from center to vertex) - EXPANDED
  CENTER_RADIUS: 35, // Boss arena radius at center
  PLAYER_SPAWN_RADIUS: 280, // Distance from center for player spawns - at outer edge
  SAFE_ZONE_RADIUS: 30, // Safe zones around player spawns
  CORRIDOR_WIDTH: 12, // Width of safe corridors between wedges
  NUM_PLAYERS: 5,
  WEDGE_ANGLE: (2 * Math.PI) / 5, // 72 degrees per wedge
};

/**
 * Terrain - Creates the hexagonal game map with wedge sectors
 */
export class Terrain {
  public ground: THREE.Mesh;
  private scene: THREE.Scene;
  
  // Hexagon vertices for boundary checking
  private hexagonVertices: THREE.Vector2[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.calculateHexagonVertices();
    this.ground = this.createHexagonGround();
    this.createEnvironment();
    this.createZoneMarkers();
  }

  /**
   * Calculate the 6 vertices of the hexagon
   */
  private calculateHexagonVertices(): void {
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6; // Start at -30 degrees for flat-top hexagon
      this.hexagonVertices.push(new THREE.Vector2(
        Math.cos(angle) * MAP_CONFIG.RADIUS,
        Math.sin(angle) * MAP_CONFIG.RADIUS
      ));
    }
  }

  /**
   * Create a true hexagonal ground mesh
   */
  private createHexagonGround(): THREE.Mesh {
    // Create hexagon shape
    const shape = new THREE.Shape();
    shape.moveTo(this.hexagonVertices[0]!.x, this.hexagonVertices[0]!.y);
    for (let i = 1; i < 6; i++) {
      shape.lineTo(this.hexagonVertices[i]!.x, this.hexagonVertices[i]!.y);
    }
    shape.closePath();
    
    const geometry = new THREE.ShapeGeometry(shape);
    
    // Main ground material
    const material = new THREE.MeshLambertMaterial({
      color: 0x3d5c3d, // Dark green grass color
    });
    
    const ground = new THREE.Mesh(geometry, material);
    ground.rotation.x = -Math.PI / 2; // Rotate to be horizontal
    ground.position.y = 0;
    
    ground.matrixAutoUpdate = false;
    ground.updateMatrix();
    ground.receiveShadow = false;
    
    this.scene.add(ground);
    
    // Add hexagonal grid lines
    this.createHexagonalGrid();
    
    return ground;
  }

  /**
   * Create hexagonal grid lines for visual reference
   */
  private createHexagonalGrid(): void {
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x2a3d2a, transparent: true, opacity: 0.5 });
    
    // Draw radial lines from center (wedge dividers)
    for (let i = 0; i < 5; i++) {
      const angle = MAP_CONFIG.WEDGE_ANGLE * i + MAP_CONFIG.WEDGE_ANGLE / 2;
      const points = [
        new THREE.Vector3(0, 0.02, 0),
        new THREE.Vector3(
          Math.cos(angle) * MAP_CONFIG.RADIUS,
          0.02,
          Math.sin(angle) * MAP_CONFIG.RADIUS
        ),
      ];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geometry, lineMaterial);
      line.matrixAutoUpdate = false;
      line.updateMatrix();
      this.scene.add(line);
    }
    
    // Draw concentric circles for zone boundaries - scaled for larger map
    const zoneRadii = [MAP_CONFIG.CENTER_RADIUS, 100, 175, 250, MAP_CONFIG.RADIUS];
    for (const radius of zoneRadii) {
      const curve = new THREE.EllipseCurve(0, 0, radius, radius, 0, 2 * Math.PI, false, 0);
      const points = curve.getPoints(64);
      const circleGeometry = new THREE.BufferGeometry().setFromPoints(
        points.map(p => new THREE.Vector3(p.x, 0.02, p.y))
      );
      const circle = new THREE.Line(circleGeometry, lineMaterial);
      circle.matrixAutoUpdate = false;
      circle.updateMatrix();
      this.scene.add(circle);
    }
  }

  /**
   * Create visual markers for different zones
   */
  private createZoneMarkers(): void {
    // Create center boss arena marker (dark red glow)
    const bossArenaGeometry = new THREE.RingGeometry(
      MAP_CONFIG.CENTER_RADIUS - 2,
      MAP_CONFIG.CENTER_RADIUS,
      32
    );
    const bossArenaMaterial = new THREE.MeshBasicMaterial({
      color: 0x660000,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
    });
    const bossArena = new THREE.Mesh(bossArenaGeometry, bossArenaMaterial);
    bossArena.rotation.x = -Math.PI / 2;
    bossArena.position.y = 0.03;
    bossArena.matrixAutoUpdate = false;
    bossArena.updateMatrix();
    this.scene.add(bossArena);
    
    // Create player spawn indicators (5 colored circles)
    const spawnColors = [0x44ff44, 0x4444ff, 0xffff44, 0xff44ff, 0x44ffff];
    for (let i = 0; i < 5; i++) {
      const angle = MAP_CONFIG.WEDGE_ANGLE * i;
      const x = Math.cos(angle) * MAP_CONFIG.PLAYER_SPAWN_RADIUS;
      const z = Math.sin(angle) * MAP_CONFIG.PLAYER_SPAWN_RADIUS;
      
      const spawnGeometry = new THREE.CircleGeometry(3, 16);
      const spawnMaterial = new THREE.MeshBasicMaterial({
        color: spawnColors[i],
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
      });
      const spawn = new THREE.Mesh(spawnGeometry, spawnMaterial);
      spawn.rotation.x = -Math.PI / 2;
      spawn.position.set(x, 0.04, z);
      spawn.matrixAutoUpdate = false;
      spawn.updateMatrix();
      this.scene.add(spawn);
    }
  }

  private createEnvironment(): void {
    // Create hexagonal boundary walls
    const wallMaterial = new THREE.MeshLambertMaterial({ color: 0x4a4a4a });
    const wallHeight = 5;
    const wallThickness = 3;
    
    // Create walls along each hexagon edge
    for (let i = 0; i < 6; i++) {
      const v1 = this.hexagonVertices[i]!;
      const v2 = this.hexagonVertices[(i + 1) % 6]!;
      
      // Calculate wall length and angle
      const dx = v2.x - v1.x;
      const dy = v2.y - v1.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      
      // Wall center point
      const centerX = (v1.x + v2.x) / 2;
      const centerZ = (v1.y + v2.y) / 2;
      
      const wallGeometry = new THREE.BoxGeometry(length, wallHeight, wallThickness);
      const wall = new THREE.Mesh(wallGeometry, wallMaterial);
      wall.position.set(centerX, wallHeight / 2, centerZ);
      wall.rotation.y = -angle;
      wall.matrixAutoUpdate = false;
      wall.updateMatrix();
      this.scene.add(wall);
    }
    
    // Decorative rocks removed - now using farmable stone nodes
    // this.createRocks();
    
    // Create boss platform in center
    this.createBossPlatform();
  }

  /**
   * Create the boss platform at the center
   */
  private createBossPlatform(): void {
    // Raised circular platform
    const platformGeometry = new THREE.CylinderGeometry(
      MAP_CONFIG.CENTER_RADIUS - 5,
      MAP_CONFIG.CENTER_RADIUS,
      0.5,
      32
    );
    const platformMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const platform = new THREE.Mesh(platformGeometry, platformMaterial);
    platform.position.y = 0.25;
    platform.matrixAutoUpdate = false;
    platform.updateMatrix();
    this.scene.add(platform);
    
    // Glowing runes on the platform
    const runeGeometry = new THREE.RingGeometry(15, 17, 6);
    const runeMaterial = new THREE.MeshBasicMaterial({
      color: 0xff3300,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });
    const runes = new THREE.Mesh(runeGeometry, runeMaterial);
    runes.rotation.x = -Math.PI / 2;
    runes.position.y = 0.52;
    runes.matrixAutoUpdate = false;
    runes.updateMatrix();
    this.scene.add(runes);
  }

  // Decorative rocks removed - now using farmable stone_rock nodes from ResourceNodeManager

  /**
   * Check if a point is inside the hexagon
   */
  public isInsideHexagon(x: number, z: number): boolean {
    const point = new THREE.Vector2(x, z);
    
    // Use ray casting algorithm
    let inside = false;
    for (let i = 0, j = 5; i < 6; j = i++) {
      const vi = this.hexagonVertices[i]!;
      const vj = this.hexagonVertices[j]!;
      
      if (((vi.y > point.y) !== (vj.y > point.y)) &&
          (point.x < (vj.x - vi.x) * (point.y - vi.y) / (vj.y - vi.y) + vi.x)) {
        inside = !inside;
      }
    }
    return inside;
  }

  /**
   * Get the wedge index (0-4) for a given position
   * Returns -1 if in corridor or center
   */
  public getWedgeIndex(x: number, z: number): number {
    const distance = Math.sqrt(x * x + z * z);
    
    // Check if in center boss arena
    if (distance < MAP_CONFIG.CENTER_RADIUS) {
      return -1;
    }
    
    // Calculate angle from center
    let angle = Math.atan2(z, x);
    if (angle < 0) angle += Math.PI * 2;
    
    // Check if in corridor (between wedges)
    const corridorHalfAngle = (MAP_CONFIG.CORRIDOR_WIDTH / distance) / 2;
    
    for (let i = 0; i < 5; i++) {
      const wedgeCenter = MAP_CONFIG.WEDGE_ANGLE * i;
      const wedgeStart = wedgeCenter - MAP_CONFIG.WEDGE_ANGLE / 2 + corridorHalfAngle;
      const wedgeEnd = wedgeCenter + MAP_CONFIG.WEDGE_ANGLE / 2 - corridorHalfAngle;
      
      // Normalize angle check
      let normalizedAngle = angle;
      if (i === 0 && angle > Math.PI) {
        normalizedAngle = angle - Math.PI * 2;
      }
      
      if (normalizedAngle >= wedgeStart && normalizedAngle < wedgeEnd) {
        return i;
      }
    }
    
    return -1; // In corridor
  }

  /**
   * Get player spawn position for a given player index (0-4)
   */
  public getPlayerSpawnPosition(playerIndex: number): { x: number; z: number } {
    const angle = MAP_CONFIG.WEDGE_ANGLE * playerIndex;
    return {
      x: Math.cos(angle) * MAP_CONFIG.PLAYER_SPAWN_RADIUS,
      z: Math.sin(angle) * MAP_CONFIG.PLAYER_SPAWN_RADIUS,
    };
  }

  public dispose(): void {
    this.ground.geometry.dispose();
    (this.ground.material as THREE.Material).dispose();
    this.scene.remove(this.ground);
  }
}

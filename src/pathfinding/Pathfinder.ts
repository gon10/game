import * as THREE from 'three';

/**
 * A* Pathfinding implementation for hexagonal map
 * Uses a grid-based approach for simplicity and performance
 */

interface Node {
  x: number;
  z: number;
  g: number; // Cost from start
  h: number; // Heuristic (estimated cost to end)
  f: number; // Total cost (g + h)
  parent: Node | null;
  walkable: boolean;
}

/**
 * Map configuration - must match Terrain.ts
 */
const MAP_CONFIG = {
  RADIUS: 200,
  CENTER_RADIUS: 25,
};

/**
 * Pre-calculated hexagon vertices for boundary checking
 */
const HEXAGON_VERTICES: THREE.Vector2[] = [];
for (let i = 0; i < 6; i++) {
  const angle = (Math.PI / 3) * i - Math.PI / 6;
  HEXAGON_VERTICES.push(new THREE.Vector2(
    Math.cos(angle) * MAP_CONFIG.RADIUS,
    Math.sin(angle) * MAP_CONFIG.RADIUS
  ));
}

export class Pathfinder {
  private readonly GRID_SIZE = 400; // Grid dimensions (covers -200 to +200)
  private readonly CELL_SIZE = 1; // Size of each cell in world units
  private grid: Node[][] = [];
  
  // Reusable arrays
  private openList: Node[] = [];
  private closedSet: Set<string> = new Set();

  constructor() {
    this.initializeGrid();
  }

  private initializeGrid(): void {
    const halfSize = this.GRID_SIZE / 2;
    
    for (let x = 0; x < this.GRID_SIZE; x++) {
      this.grid[x] = [];
      for (let z = 0; z < this.GRID_SIZE; z++) {
        const worldX = x - halfSize;
        const worldZ = z - halfSize;
        
        this.grid[x]![z] = {
          x: worldX,
          z: worldZ,
          g: 0,
          h: 0,
          f: 0,
          parent: null,
          walkable: this.isInsideHexagon(worldX, worldZ),
        };
      }
    }
  }

  /**
   * Check if a point is inside the hexagonal map
   */
  private isInsideHexagon(x: number, z: number): boolean {
    const point = new THREE.Vector2(x, z);
    
    // Use ray casting algorithm
    let inside = false;
    for (let i = 0, j = 5; i < 6; j = i++) {
      const vi = HEXAGON_VERTICES[i]!;
      const vj = HEXAGON_VERTICES[j]!;
      
      if (((vi.y > point.y) !== (vj.y > point.y)) &&
          (point.x < (vj.x - vi.x) * (point.y - vi.y) / (vj.y - vi.y) + vi.x)) {
        inside = !inside;
      }
    }
    return inside;
  }

  /**
   * Check if a world position is valid (inside hexagon)
   */
  public isValidPosition(x: number, z: number): boolean {
    return this.isInsideHexagon(x, z);
  }

  /**
   * Clamp a position to stay inside the hexagon
   */
  public clampToHexagon(x: number, z: number): { x: number; z: number } {
    if (this.isInsideHexagon(x, z)) {
      return { x, z };
    }
    
    // Find nearest point on hexagon edge
    const point = new THREE.Vector2(x, z);
    let nearestPoint = new THREE.Vector2(x, z);
    let nearestDist = Infinity;
    
    for (let i = 0; i < 6; i++) {
      const v1 = HEXAGON_VERTICES[i]!;
      const v2 = HEXAGON_VERTICES[(i + 1) % 6]!;
      
      // Project point onto edge
      const edge = new THREE.Vector2().subVectors(v2, v1);
      const toPoint = new THREE.Vector2().subVectors(point, v1);
      const t = Math.max(0, Math.min(1, toPoint.dot(edge) / edge.lengthSq()));
      const projection = new THREE.Vector2().copy(v1).add(edge.multiplyScalar(t));
      
      const dist = point.distanceTo(projection);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestPoint = projection;
      }
    }
    
    // Move slightly inside the hexagon
    const toCenter = new THREE.Vector2(-nearestPoint.x, -nearestPoint.y).normalize();
    return {
      x: nearestPoint.x + toCenter.x * 0.5,
      z: nearestPoint.y + toCenter.y * 0.5,
    };
  }

  /**
   * Set an area as non-walkable (for obstacles)
   */
  public setObstacle(worldX: number, worldZ: number, radius: number): void {
    const halfSize = this.GRID_SIZE / 2;
    const gridRadius = Math.ceil(radius / this.CELL_SIZE);
    
    const centerX = Math.floor(worldX / this.CELL_SIZE) + halfSize;
    const centerZ = Math.floor(worldZ / this.CELL_SIZE) + halfSize;
    
    for (let dx = -gridRadius; dx <= gridRadius; dx++) {
      for (let dz = -gridRadius; dz <= gridRadius; dz++) {
        const gx = centerX + dx;
        const gz = centerZ + dz;
        if (gx >= 0 && gx < this.GRID_SIZE && gz >= 0 && gz < this.GRID_SIZE) {
          this.grid[gx]![gz]!.walkable = false;
        }
      }
    }
  }

  /**
   * Find path from start to end using A*
   */
  public findPath(start: THREE.Vector3, end: THREE.Vector3): THREE.Vector3[] {
    const halfSize = this.GRID_SIZE / 2;
    
    // Convert world coords to grid coords
    const startX = Math.floor(start.x / this.CELL_SIZE) + halfSize;
    const startZ = Math.floor(start.z / this.CELL_SIZE) + halfSize;
    const endX = Math.floor(end.x / this.CELL_SIZE) + halfSize;
    const endZ = Math.floor(end.z / this.CELL_SIZE) + halfSize;
    
    // Bounds check
    if (!this.isValidCell(startX, startZ) || !this.isValidCell(endX, endZ)) {
      return [end.clone()]; // Direct path as fallback
    }

    // Reset pathfinding state
    this.openList.length = 0;
    this.closedSet.clear();
    this.resetGrid();
    
    const startNode = this.grid[startX]![startZ]!;
    const endNode = this.grid[endX]![endZ]!;
    
    // If end is not walkable, find nearest walkable
    if (!endNode.walkable) {
      return [end.clone()];
    }
    
    startNode.g = 0;
    startNode.h = this.heuristic(startNode, endNode);
    startNode.f = startNode.h;
    
    this.openList.push(startNode);
    
    while (this.openList.length > 0) {
      // Get node with lowest f score
      let currentIndex = 0;
      for (let i = 1; i < this.openList.length; i++) {
        if (this.openList[i]!.f < this.openList[currentIndex]!.f) {
          currentIndex = i;
        }
      }
      
      const current = this.openList[currentIndex]!;
      
      // Check if we've reached the goal
      if (current === endNode) {
        return this.reconstructPath(current);
      }
      
      // Move current from open to closed
      this.openList.splice(currentIndex, 1);
      this.closedSet.add(`${current.x},${current.z}`);
      
      // Check neighbors (8-directional)
      const neighbors = this.getNeighbors(current.x + halfSize, current.z + halfSize);
      
      for (const neighbor of neighbors) {
        if (this.closedSet.has(`${neighbor.x},${neighbor.z}`)) continue;
        if (!neighbor.walkable) continue;
        
        // Calculate tentative g score
        const dx = Math.abs(neighbor.x - current.x);
        const dz = Math.abs(neighbor.z - current.z);
        const moveCost = dx + dz === 2 ? 1.414 : 1; // Diagonal vs straight
        const tentativeG = current.g + moveCost;
        
        const inOpenList = this.openList.includes(neighbor);
        
        if (!inOpenList || tentativeG < neighbor.g) {
          neighbor.g = tentativeG;
          neighbor.h = this.heuristic(neighbor, endNode);
          neighbor.f = neighbor.g + neighbor.h;
          neighbor.parent = current;
          
          if (!inOpenList) {
            this.openList.push(neighbor);
          }
        }
      }
    }
    
    // No path found, return direct path
    return [end.clone()];
  }

  private isValidCell(x: number, z: number): boolean {
    return x >= 0 && x < this.GRID_SIZE && z >= 0 && z < this.GRID_SIZE;
  }

  private getNeighbors(gridX: number, gridZ: number): Node[] {
    const neighbors: Node[] = [];
    
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        
        const nx = gridX + dx;
        const nz = gridZ + dz;
        
        if (this.isValidCell(nx, nz)) {
          neighbors.push(this.grid[nx]![nz]!);
        }
      }
    }
    
    return neighbors;
  }

  private heuristic(a: Node, b: Node): number {
    // Euclidean distance
    const dx = Math.abs(a.x - b.x);
    const dz = Math.abs(a.z - b.z);
    return Math.sqrt(dx * dx + dz * dz);
  }

  private resetGrid(): void {
    for (let x = 0; x < this.GRID_SIZE; x++) {
      for (let z = 0; z < this.GRID_SIZE; z++) {
        const node = this.grid[x]![z]!;
        node.g = 0;
        node.h = 0;
        node.f = 0;
        node.parent = null;
      }
    }
  }

  private reconstructPath(endNode: Node): THREE.Vector3[] {
    const path: THREE.Vector3[] = [];
    let current: Node | null = endNode;
    
    while (current !== null) {
      path.unshift(new THREE.Vector3(
        current.x * this.CELL_SIZE,
        0,
        current.z * this.CELL_SIZE
      ));
      current = current.parent;
    }
    
    // Simplify path by removing collinear points
    return this.simplifyPath(path);
  }

  /**
   * Remove unnecessary waypoints that are in a straight line
   */
  private simplifyPath(path: THREE.Vector3[]): THREE.Vector3[] {
    if (path.length <= 2) return path;
    
    const simplified: THREE.Vector3[] = [path[0]!];
    
    for (let i = 1; i < path.length - 1; i++) {
      const prev = path[i - 1]!;
      const current = path[i]!;
      const next = path[i + 1]!;
      
      // Check if points are collinear
      const dir1 = new THREE.Vector3().subVectors(current, prev).normalize();
      const dir2 = new THREE.Vector3().subVectors(next, current).normalize();
      
      if (dir1.dot(dir2) < 0.999) {
        simplified.push(current);
      }
    }
    
    simplified.push(path[path.length - 1]!);
    return simplified;
  }
}

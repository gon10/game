import * as THREE from 'three';

/**
 * Isometric-style camera for LoL-like top-down view
 * Follows the player with smooth interpolation
 */
export class GameCamera {
  public camera: THREE.PerspectiveCamera;
  
  // Camera positioning
  private readonly CAMERA_HEIGHT = 40;
  private readonly CAMERA_DISTANCE = 30;
  
  // Smooth following
  private targetPosition = new THREE.Vector3();
  private currentPosition = new THREE.Vector3();
  private readonly FOLLOW_SPEED = 0.1;
  
  // Offset from player
  private offset: THREE.Vector3;

  constructor(canvas: HTMLCanvasElement) {
    const aspect = canvas.clientWidth / canvas.clientHeight;
    
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
    
    // Calculate offset based on angle
    this.offset = new THREE.Vector3(
      0,
      this.CAMERA_HEIGHT,
      this.CAMERA_DISTANCE
    );
    
    // Initial position
    this.camera.position.copy(this.offset);
    this.camera.lookAt(0, 0, 0);
    
    // Handle resize
    window.addEventListener('resize', this.handleResize);
  }

  private handleResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  };

  /**
   * Set the target position for the camera to follow
   */
  public follow(position: THREE.Vector3): void {
    this.targetPosition.copy(position);
  }

  /**
   * Update camera position with smooth interpolation
   */
  public update(): void {
    // Smoothly interpolate current position towards target
    this.currentPosition.lerp(this.targetPosition, this.FOLLOW_SPEED);
    
    // Apply offset to camera
    this.camera.position.set(
      this.currentPosition.x + this.offset.x,
      this.currentPosition.y + this.offset.y,
      this.currentPosition.z + this.offset.z
    );
    
    // Look at target
    this.camera.lookAt(this.currentPosition);
  }

  /**
   * Immediately set camera position without interpolation
   */
  public setPosition(position: THREE.Vector3): void {
    this.targetPosition.copy(position);
    this.currentPosition.copy(position);
    this.camera.position.set(
      position.x + this.offset.x,
      position.y + this.offset.y,
      position.z + this.offset.z
    );
    this.camera.lookAt(position);
  }

  public dispose(): void {
    window.removeEventListener('resize', this.handleResize);
  }
}

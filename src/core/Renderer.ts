import * as THREE from 'three';

/**
 * High-performance WebGL renderer wrapper
 * Configured for maximum FPS with proper memory management
 */
export class Renderer {
  public renderer: THREE.WebGLRenderer;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // Disable for performance, use FXAA post-process if needed
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      alpha: false,
    });

    // Set pixel ratio (cap at 2 for performance)
    const pixelRatio = Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(pixelRatio);

    // Set initial size
    this.resize();

    // Enable optimizations
    this.renderer.sortObjects = true; // Sort for proper transparency
    this.renderer.info.autoReset = false; // Manual reset for debugging

    // Handle resize
    window.addEventListener('resize', this.resize);
  }

  private resize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
  };

  public render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderer.render(scene, camera);
    this.renderer.info.reset();
  }

  public getInfo(): THREE.WebGLInfo {
    return this.renderer.info;
  }

  public dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.renderer.dispose();
  }
}

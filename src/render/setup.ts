/**
 * Global three.js setup that must run before any THREE.Color is created.
 * The game works in plain sRGB values end to end (like classic voxel games),
 * so color management is off.
 */
import * as THREE from 'three';

THREE.ColorManagement.enabled = false;

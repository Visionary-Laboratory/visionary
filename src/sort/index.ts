// Sorting interfaces and data structures

import { PerspectiveCamera } from '../camera';

/**
 * Generic interface for sorting splat data for depth ordering
 */
export interface ISorter {
  /**
   * Create GPU resources needed for sorting a specific number of points
   */
  createSortStuff(device: GPUDevice, numPoints: number): SortedSplats;
  
  /**
   * Record sorting commands into a command encoder
   */
  recordSort(sortStuff: SortedSplats, numPoints: number, encoder: GPUCommandEncoder): void;
  
  /**
   * Record indirect sorting commands (for dynamic point counts)
   */
  recordSortIndirect?(sortStuff: SortedSplats, dispatchBuffer: GPUBuffer, encoder: GPUCommandEncoder): void;
}

/**
 * Container for sorted splat data and GPU resources
 */
export interface SortedSplats {
  numPoints: number;
  sortedIndices: GPUBuffer;
  indirectBuffer: GPUBuffer;
  visibleCount?: number;
  
  // Additional context for different sorter implementations
  [key: string]: any;
}

/**
 * Sorting arguments passed to sorting operations
 */
export interface SortingArgs {
  camera: PerspectiveCamera;
  viewport: [number, number];
  numPoints: number;
  
  // Optional parameters
  maxDistance?: number;
  minDistance?: number;
  sortingEnabled?: boolean;
}

// Export concrete implementations
export { GPURSSorter, HISTOGRAM_WG_SIZE, RS_HISTOGRAM_BLOCK_ROWS } from './radix_sort';
export type { PointCloudSortStuff } from './radix_sort';
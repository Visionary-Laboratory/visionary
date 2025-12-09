/**
 * DOM element references and utilities
 * Centralizes all DOM element queries and helpers
 */

// Utility for type-safe DOM element selection
export const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

/**
 * All DOM element references used by the application
 */
export class DOMElements {
  // Canvas
  readonly canvas = $("#canvas") as HTMLCanvasElement;
  
  // Loading UI
  readonly loadingOverlay = $("#loadingOverlay");
  readonly progressFill = document.querySelector<HTMLElement>("#loadingOverlay .progress-fill")!;
  readonly progressText = document.querySelector<HTMLElement>("#loadingOverlay .progress-text")!;
  
  // Error handling UI
  readonly errorModal = $("#errorModal");
  readonly errorMessage = $("#errorMessage");
  readonly closeError = $("#closeError");
  readonly noWebGPU = $("#noWebGPU");
  
  // File handling UI
  readonly dropZone = $("#dropZone");
  readonly browseBtn = $("#browseButton");
  readonly fileInput = $("#fileInput") as HTMLInputElement;
  
  // Toggle panel (still available)
  readonly togglePanelBtn = $("#togglePanel");
  
  // Stats display
  readonly fpsEl = $("#fps");
  readonly pointCountEl = $("#pointCount");
}

/**
 * Utility to toggle element visibility
 */
export function setHidden(el: HTMLElement | null, hidden: boolean): void {
  el?.classList.toggle("hidden", hidden);
}

/**
 * Clamp a value between min and max
 */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Parse hex color to RGB values (0-1 range)
 */
export function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}
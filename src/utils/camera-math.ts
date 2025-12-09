// Camera-specific math utilities
// Functions for field-of-view and focal length conversions

export function deg2rad(d: number): number { 
  return d * Math.PI / 180; 
}

export function focal2fov(focal: number, pixels: number): number {
  return 2 * Math.atan(pixels / (2 * focal));
}

export function fov2focal(fov: number, pixels: number): number {
  return pixels / (2 * Math.tan(fov * 0.5));
}
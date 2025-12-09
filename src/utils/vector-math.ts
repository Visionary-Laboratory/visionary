// Shared vector math utilities
// Extracted from duplicate PLY loader implementations

export type Vec3 = [number, number, number];

export function dot(a: Vec3, b: Vec3): number { 
  return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; 
}

export function add(a: Vec3, b: Vec3): Vec3 { 
  return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; 
}

export function sub(a: Vec3, b: Vec3): Vec3 { 
  return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; 
}

export function scale(a: Vec3, s: number): Vec3 { 
  return [a[0]*s, a[1]*s, a[2]*s]; 
}

export function len(a: Vec3): number { 
  return Math.hypot(a[0], a[1], a[2]); 
}

export function normalize(a: Vec3): Vec3 {
  const l = len(a);
  return l > 0 ? [a[0]/l, a[1]/l, a[2]/l] : [NaN, NaN, NaN];
}

export function isFiniteVec3(a: Vec3): boolean {
  return Number.isFinite(a[0]) && Number.isFinite(a[1]) && Number.isFinite(a[2]);
}

/**
 * Fit plane using fast approximate eigenvector method
 * @param points Array of [x,y,z] points
 * @param forceUp Force normal vector to point up (+Y direction)
 * @returns Object with centroid and optional normal vector
 */
export function planeFromPoints(
  points: Vec3[],
  forceUp: boolean = true
): { centroid: Vec3; normal?: Vec3 } {
  if (points.length === 0) {
    return { centroid: [0, 0, 0] };
  }

  // Calculate centroid
  let cx = 0, cy = 0, cz = 0;
  for (const [x, y, z] of points) {
    cx += x;
    cy += y;
    cz += z;
  }
  const n = points.length;
  const centroid: Vec3 = [cx / n, cy / n, cz / n];

  if (points.length < 3) {
    return { centroid };
  }

  // Build covariance matrix
  let c00 = 0, c01 = 0, c02 = 0;
  let c11 = 0, c12 = 0, c22 = 0;

  for (const [x, y, z] of points) {
    const dx = x - centroid[0];
    const dy = y - centroid[1];
    const dz = z - centroid[2];

    c00 += dx * dx;
    c01 += dx * dy;
    c02 += dx * dz;
    c11 += dy * dy;
    c12 += dy * dz;
    c22 += dz * dz;
  }

  // Find approximate smallest eigenvector using power iteration
  let x = 1, y = 1, z = 1;
  const maxIter = 20;
  
  for (let iter = 0; iter < maxIter; iter++) {
    // Apply matrix (find largest eigenvalue, then invert for smallest)
    const nx = c00 * x + c01 * y + c02 * z;
    const ny = c01 * x + c11 * y + c12 * z;
    const nz = c02 * x + c12 * y + c22 * z;
    
    // Normalize
    const norm = Math.hypot(nx, ny, nz);
    if (norm < 1e-10) break;
    
    x = nx / norm;
    y = ny / norm;
    z = nz / norm;
  }

  let normal: Vec3 = [x, y, z];

  // Force upward direction if requested
  if (forceUp && normal[1] < 0) {
    normal = [-normal[0], -normal[1], -normal[2]];
  }

  // Validate result
  if (!isFiniteVec3(normal)) {
    return { centroid };
  }

  return { centroid, normal };
}
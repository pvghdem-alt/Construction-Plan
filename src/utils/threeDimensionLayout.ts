import type { Point2D, SolvedWallSegment } from '../types/floorplan';

const CM_TO_M = 0.01;

export interface WallDimensionLayout {
  spanOffsetM: number;
  tickRatioM: number;
  yLineM: number;
  badgeY: number;
  badgeHeightM: number;
}

export function computeWallDimensionLayout(
  wallThickM: number,
  isInterior: boolean,
  lengthCm: number,
  segmentIndex: number
): WallDimensionLayout {
  const spanOffsetM = isInterior ? 0.28 : wallThickM + 0.5;
  const tickRatioM = isInterior ? 0.08 : 0.14;
  const staggerShortWall = !isInterior && lengthCm < 90 && segmentIndex % 2 === 1;
  return {
    spanOffsetM,
    tickRatioM,
    yLineM: 0.03,
    badgeY: staggerShortWall ? 0.48 : 0.24,
    badgeHeightM: isInterior ? 0.23 : 0.25,
  };
}

export interface CeilingRulerPosition {
  x: number;
  yBadge: number;
  z: number;
  badgeHeightM: number;
}

export function computeCeilingRulerPosition(
  polygonPoints: Point2D[],
  solvedEdges: SolvedWallSegment[],
  wallThickM: number,
  ceilingM: number
): CeilingRulerPosition | null {
  if (polygonPoints.length === 0) return null;
  const p0 = polygonPoints[0];
  const firstEdge = solvedEdges[0];
  const lastEdge = solvedEdges[solvedEdges.length - 1];

  const rawNx = (firstEdge?.outwardNormal.x ?? -1) + (lastEdge?.outwardNormal.x ?? 0);
  const rawNz = (firstEdge?.outwardNormal.y ?? 0) + (lastEdge?.outwardNormal.y ?? -1);
  const len = Math.hypot(rawNx, rawNz);
  const nx = len > 1e-4 ? rawNx / len : -Math.SQRT1_2;
  const nz = len > 1e-4 ? rawNz / len : -Math.SQRT1_2;

  const dist = wallThickM + 0.52;
  return {
    x: p0.x * CM_TO_M + nx * dist,
    yBadge: ceilingM * 0.58,
    z: p0.y * CM_TO_M + nz * dist,
    badgeHeightM: 0.28,
  };
}

export interface OpeningBadgePosition {
  x: number;
  y: number;
  z: number;
  leaderTopY: number;
  leaderBottomY: number;
  badgeHeightM: number;
}

export function computeOpeningBadgePosition(
  centerCm: Point2D,
  edge: SolvedWallSegment | null,
  wallThickM: number,
  ceilingM: number
): OpeningBadgePosition {
  const normalShiftM = edge && !edge.isInterior ? wallThickM * 0.5 : 0;
  const x = centerCm.x * CM_TO_M + (edge?.outwardNormal.x ?? 0) * normalShiftM;
  const z = centerCm.y * CM_TO_M + (edge?.outwardNormal.y ?? 0) * normalShiftM;
  const badgeHeightM = 0.25;
  // Place cleanly above ceilingM so opening badges never intersect or get half-clipped by wall headers,
  // while still being occluded by closer foreground walls via GPU depth testing.
  const y = ceilingM + 0.24;
  return {
    x,
    y,
    z,
    leaderBottomY: ceilingM + 0.01,
    leaderTopY: ceilingM + 0.09,
    badgeHeightM,
  };
}

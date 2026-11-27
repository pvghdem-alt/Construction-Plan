import type {
  FloorplanElement,
  Point2D,
  SolvedElementPlacement,
  SolvedFloorplan,
} from '../types/floorplan';

export interface WallColliderRect {
  id: string;
  cx: number;
  cy: number;
  ux: number;
  uy: number;
  nx: number;
  ny: number;
  halfLen: number;
  halfThick: number;
}

export interface SpaceInteractableTarget {
  id: string;
  kind: 'door' | 'bed_curtain' | 'cabinet' | 'wall_cabinet' | 'kitchen_counter';
  name: string;
  distanceCm: number;
}

export const DEFAULT_FP_PLAYER_RADIUS_CM = 22;
export const DEFAULT_FP_EYE_HEIGHT_CM = 160;
export const DEFAULT_FP_WALK_SPEED_CM_S = 220;
export const DEFAULT_FP_TURN_SPEED_RAD_S = 1.95;

export function isLightingElementKind(kind: FloorplanElement['kind']): boolean {
  return (
    kind === 'panel_light' ||
    kind === 'track_light' ||
    kind === 'recessed_light' ||
    kind === 'wall_sconce'
  );
}

export function isPointInsidePolygon(pt: Point2D, polygon: Point2D[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointToSegmentDistSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): { distSq: number; closestX: number; closestY: number } {
  const vx = bx - ax;
  const vy = by - ay;
  const lenSq = vx * vx + vy * vy;
  if (lenSq <= 1e-8) {
    const dx = px - ax;
    const dy = py - ay;
    return { distSq: dx * dx + dy * dy, closestX: ax, closestY: ay };
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / lenSq));
  const cx = ax + t * vx;
  const cy = ay + t * vy;
  const dx = px - cx;
  const dy = py - cy;
  return { distSq: dx * dx + dy * dy, closestX: cx, closestY: cy };
}

function subtractSpanIntervals(
  lengthCm: number,
  cuts: Array<{ start: number; end: number }>
): Array<{ start: number; end: number }> {
  if (cuts.length === 0) return [{ start: 0, end: lengthCm }];
  const sorted = [...cuts].sort((a, b) => a.start - b.start);
  const out: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const cut of sorted) {
    const s = Math.max(0, cut.start);
    const e = Math.min(lengthCm, cut.end);
    if (s > cursor + 1) {
      out.push({ start: cursor, end: s });
    }
    cursor = Math.max(cursor, e);
  }
  if (cursor < lengthCm - 1) {
    out.push({ start: cursor, end: lengthCm });
  }
  return out;
}

/**
 * Build 2D oriented bounding-box colliders for all solid walls and any currently closed doors.
 * Open doors slice a passable gap out of their host wall so the player can walk cleanly through.
 */
export function buildFirstPersonColliders(
  solved: SolvedFloorplan,
  placements: SolvedElementPlacement[],
  wallThicknessCm: number,
  openElementIds: ReadonlySet<string> | Record<string, boolean>
): WallColliderRect[] {
  const thick = Math.max(6, wallThicknessCm || 12);
  const halfThick = thick * 0.5;
  const isOpen = (id: string) =>
    typeof (openElementIds as ReadonlySet<string>).has === 'function'
      ? (openElementIds as ReadonlySet<string>).has(id)
      : Boolean((openElementIds as Record<string, boolean>)[id]);

  const openDoorsByWall = new Map<string, Array<{ start: number; end: number }>>();
  for (const pl of placements) {
    if (pl.element.kind === 'door' && pl.edge && isOpen(pl.element.id)) {
      const list = openDoorsByWall.get(pl.edge.id) || [];
      list.push({
        start: pl.clampedOffsetCm + 2,
        end: pl.clampedOffsetCm + pl.clampedWidthCm - 2,
      });
      openDoorsByWall.set(pl.edge.id, list);
    }
  }

  const colliders: WallColliderRect[] = [];
  const wallSegs = [...solved.solvedEdges, ...solved.solvedInteriorWalls];

  for (const se of wallSegs) {
    if (!se.hasWall || se.lengthCm <= 1) continue;
    const openSpans = openDoorsByWall.get(se.id) || [];
    const solidSpans = subtractSpanIntervals(se.lengthCm, openSpans);
    const normalShift = se.isInterior ? 0 : halfThick;

    solidSpans.forEach((span, idx) => {
      const segLen = span.end - span.start;
      if (segLen <= 1) return;
      const midDist = (span.start + span.end) * 0.5;
      colliders.push({
        id: `${se.id}-seg-${idx}`,
        cx: se.start.x + se.tangent.x * midDist + se.outwardNormal.x * normalShift,
        cy: se.start.y + se.tangent.y * midDist + se.outwardNormal.y * normalShift,
        ux: se.tangent.x,
        uy: se.tangent.y,
        nx: se.outwardNormal.x,
        ny: se.outwardNormal.y,
        halfLen: segLen * 0.5,
        halfThick,
      });
    });
  }

  return colliders;
}

/**
 * Push a 2D circle out of overlapping wall/closed-door OBBs over multiple passes
 * so movement slides smoothly along orthogonal and angled walls without snagging.
 */
export function resolveCircleColliders(
  xCm: number,
  yCm: number,
  radiusCm: number,
  colliders: ReadonlyArray<WallColliderRect>
): Point2D {
  let px = xCm;
  let py = yCm;

  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      const dxWorld = px - c.cx;
      const dyWorld = py - c.cy;
      const lx = dxWorld * c.ux + dyWorld * c.uy;
      const ly = dxWorld * c.nx + dyWorld * c.ny;

      const clampedX = Math.max(-c.halfLen, Math.min(c.halfLen, lx));
      const clampedY = Math.max(-c.halfThick, Math.min(c.halfThick, ly));

      const diffX = lx - clampedX;
      const diffY = ly - clampedY;
      const distSq = diffX * diffX + diffY * diffY;

      if (distSq >= radiusCm * radiusCm) continue;

      if (distSq > 1e-8) {
        const dist = Math.sqrt(distSq);
        const pen = radiusCm - dist;
        const pushLocalX = diffX / dist;
        const pushLocalY = diffY / dist;
        px += (pushLocalX * c.ux + pushLocalY * c.nx) * pen;
        py += (pushLocalX * c.uy + pushLocalY * c.ny) * pen;
        moved = true;
      } else {
        // Circle center lies strictly inside the wall OBB: push out along nearest face
        const penX = c.halfLen - Math.abs(lx) + radiusCm;
        const penY = c.halfThick - Math.abs(ly) + radiusCm;
        if (penY <= penX) {
          const sign = ly >= 0 ? 1 : -1;
          px += c.nx * sign * penY;
          py += c.ny * sign * penY;
        } else {
          const sign = lx >= 0 ? 1 : -1;
          px += c.ux * sign * penX;
          py += c.uy * sign * penX;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }

  return { x: px, y: py };
}

export function getForward2DFromYaw(yawRad: number): Point2D {
  return {
    x: -Math.sin(yawRad),
    y: -Math.cos(yawRad),
  };
}

export function getRight2DFromYaw(yawRad: number): Point2D {
  return {
    x: Math.cos(yawRad),
    y: -Math.sin(yawRad),
  };
}

export function stepFirstPersonMovement(params: {
  xCm: number;
  yCm: number;
  yawRad: number;
  forwardInput: number;
  rightInput: number;
  dtSec: number;
  speedCmPerSec?: number;
  radiusCm?: number;
  colliders: ReadonlyArray<WallColliderRect>;
}): Point2D {
  const {
    xCm,
    yCm,
    yawRad,
    forwardInput,
    rightInput,
    dtSec,
    speedCmPerSec = DEFAULT_FP_WALK_SPEED_CM_S,
    radiusCm = DEFAULT_FP_PLAYER_RADIUS_CM,
    colliders,
  } = params;

  const mag = Math.hypot(forwardInput, rightInput);
  if (mag < 1e-4 || dtSec <= 0) {
    return resolveCircleColliders(xCm, yCm, radiusCm, colliders);
  }

  const fwdNorm = forwardInput / mag;
  const rightNorm = rightInput / mag;
  const fwd = getForward2DFromYaw(yawRad);
  const right = getRight2DFromYaw(yawRad);

  const stepDist = speedCmPerSec * Math.min(0.1, dtSec);
  const totalDx = (fwd.x * fwdNorm + right.x * rightNorm) * stepDist;
  const totalDy = (fwd.y * fwdNorm + right.y * rightNorm) * stepDist;

  // Sub-step so fast frames cannot tunnel through thin partition walls
  const maxStep = Math.max(4, radiusCm * 0.45);
  const subSteps = Math.max(1, Math.ceil(stepDist / maxStep));
  let cur: Point2D = { x: xCm, y: yCm };

  for (let s = 0; s < subSteps; s++) {
    cur = resolveCircleColliders(
      cur.x + totalDx / subSteps,
      cur.y + totalDy / subSteps,
      radiusCm,
      colliders
    );
  }

  return cur;
}

function minDistanceToColliders(
  px: number,
  py: number,
  colliders: ReadonlyArray<WallColliderRect>
): number {
  let best = Infinity;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    const dx = px - c.cx;
    const dy = py - c.cy;
    const lx = dx * c.ux + dy * c.uy;
    const ly = dx * c.nx + dy * c.ny;
    const ex = Math.max(0, Math.abs(lx) - c.halfLen);
    const ey = Math.max(0, Math.abs(ly) - c.halfThick);
    const d = Math.hypot(ex, ey);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Compute an unobstructed interior spawn position and ~160 cm eye height.
 */
export function computeFirstPersonSpawn(
  solved: SolvedFloorplan,
  colliders: ReadonlyArray<WallColliderRect>,
  ceilingHeightCm: number,
  placements: ReadonlyArray<SolvedElementPlacement> = [],
  radiusCm = DEFAULT_FP_PLAYER_RADIUS_CM
): { xCm: number; yCm: number; eyeHeightCm: number; yawRad: number } {
  const eyeHeightCm = Math.min(
    DEFAULT_FP_EYE_HEIGHT_CM,
    Math.max(85, (ceilingHeightCm || 250) - 18)
  );
  const { minX, maxX, minY, maxY, centerX, centerY } = solved.bounds;
  const poly = solved.polygonPoints;

  let bestPt: Point2D = { x: centerX, y: centerY };
  let bestClearance = -1;

  if (poly.length >= 3) {
    if (isPointInsidePolygon(bestPt, poly)) {
      bestClearance = minDistanceToColliders(bestPt.x, bestPt.y, colliders);
    }

    if (bestClearance < radiusCm + 18) {
      const steps = 11;
      for (let ix = 1; ix < steps; ix++) {
        for (let iy = 1; iy < steps; iy++) {
          const cand = {
            x: minX + ((maxX - minX) * ix) / steps,
            y: minY + ((maxY - minY) * iy) / steps,
          };
          if (!isPointInsidePolygon(cand, poly)) continue;
          const clr = minDistanceToColliders(cand.x, cand.y, colliders);
          if (clr > bestClearance) {
            bestClearance = clr;
            bestPt = cand;
          }
        }
      }
    }
  }

  const resolved = resolveCircleColliders(bestPt.x, bestPt.y, radiusCm, colliders);

  // Face toward the nearest door (helps users immediately spot & test opening doors)
  let yawRad = 0;
  const doors = placements.filter((p) => p.element.kind === 'door');
  if (doors.length > 0) {
    let nearestDoor = doors[0];
    let nearestDistSq = Infinity;
    for (const d of doors) {
      const dx = d.center.x - resolved.x;
      const dy = d.center.y - resolved.y;
      const dSq = dx * dx + dy * dy;
      if (dSq < nearestDistSq) {
        nearestDistSq = dSq;
        nearestDoor = d;
      }
    }
    const dx = nearestDoor.center.x - resolved.x;
    const dy = nearestDoor.center.y - resolved.y;
    if (Math.hypot(dx, dy) > 10) {
      yawRad = Math.atan2(-dx, -dy);
    }
  } else {
    const dx = centerX - resolved.x;
    const dy = centerY - resolved.y;
    if (Math.hypot(dx, dy) > 10) {
      yawRad = Math.atan2(-dx, -dy);
    }
  }

  return {
    xCm: resolved.x,
    yCm: resolved.y,
    eyeHeightCm,
    yawRad,
  };
}

/**
 * Find the nearest interactive door, bed curtain, or cabinet within reach for Spacebar toggle.
 */
export function findNearestSpaceInteractable(
  xCm: number,
  yCm: number,
  forwardX: number,
  forwardY: number,
  placements: ReadonlyArray<SolvedElementPlacement>,
  maxDistanceCm = 240
): SpaceInteractableTarget | null {
  let best: SpaceInteractableTarget | null = null;
  let bestScore = Infinity;

  for (const pl of placements) {
    const el = pl.element;
    if (
      el.kind !== 'door' &&
      el.kind !== 'bed_curtain' &&
      el.kind !== 'cabinet' &&
      el.kind !== 'wall_cabinet' &&
      el.kind !== 'kitchen_counter'
    ) {
      continue;
    }
    const isCabinet =
      el.kind === 'cabinet' ||
      el.kind === 'wall_cabinet' ||
      el.kind === 'kitchen_counter';

    if (isCabinet && el.cabinetSpec) {
      if (el.cabinetSpec.doorMode === 'none' && el.cabinetSpec.drawerCount <= 0) {
        continue;
      }
    }

    let distSq = Infinity;
    let targetX = pl.boxCenter.x;
    let targetY = pl.boxCenter.y;

    if (el.kind === 'door') {
      const hit = pointToSegmentDistSq(
        xCm,
        yCm,
        pl.startPoint.x,
        pl.startPoint.y,
        pl.endPoint.x,
        pl.endPoint.y
      );
      distSq = hit.distSq;
      targetX = hit.closestX;
      targetY = hit.closestY;
    } else if (el.kind === 'bed_curtain') {
      // L-shaped bed curtain: arm1 from (-w/2, -d/2) to (-w/2, +d/2), arm2 to (+w/2, +d/2)
      const halfW = pl.clampedWidthCm * 0.5;
      const halfD = el.depthCm * 0.5;
      const t = pl.tangent;
      const n = pl.facingNormal;
      const p1 = {
        x: pl.boxCenter.x - t.x * halfW - n.x * halfD,
        y: pl.boxCenter.y - t.y * halfW - n.y * halfD,
      };
      const corner = {
        x: pl.boxCenter.x - t.x * halfW + n.x * halfD,
        y: pl.boxCenter.y - t.y * halfW + n.y * halfD,
      };
      const p2 = {
        x: pl.boxCenter.x + t.x * halfW + n.x * halfD,
        y: pl.boxCenter.y + t.y * halfW + n.y * halfD,
      };
      const hit1 = pointToSegmentDistSq(xCm, yCm, p1.x, p1.y, corner.x, corner.y);
      const hit2 = pointToSegmentDistSq(xCm, yCm, corner.x, corner.y, p2.x, p2.y);
      const bestArm = hit1.distSq <= hit2.distSq ? hit1 : hit2;
      distSq = bestArm.distSq;
      targetX = bestArm.closestX;
      targetY = bestArm.closestY;
    } else {
      // Cabinet OBB surface distance
      const dx = xCm - pl.boxCenter.x;
      const dy = yCm - pl.boxCenter.y;
      const lx = dx * pl.tangent.x + dy * pl.tangent.y;
      const ly = dx * pl.facingNormal.x + dy * pl.facingNormal.y;
      const halfW = pl.clampedWidthCm * 0.5;
      const halfD = el.depthCm * 0.5;
      const cx = Math.max(-halfW, Math.min(halfW, lx));
      const cy = Math.max(-halfD, Math.min(halfD, ly));
      const ex = lx - cx;
      const ey = ly - cy;
      distSq = ex * ex + ey * ey;
      targetX = pl.boxCenter.x + pl.tangent.x * cx + pl.facingNormal.x * cy;
      targetY = pl.boxCenter.y + pl.tangent.y * cx + pl.facingNormal.y * cy;
    }

    const dist = Math.sqrt(distSq);
    if (dist > maxDistanceCm) continue;

    const toTargetX = targetX - xCm;
    const toTargetY = targetY - yCm;
    const len = Math.hypot(toTargetX, toTargetY);
    const dotForward =
      len > 1e-4 ? (toTargetX / len) * forwardX + (toTargetY / len) * forwardY : 1;

    // Slightly prioritize doors/curtains over cabinets at equal distance, and items in front of camera
    const priorityBias = isCabinet ? 22 : 0;
    const score = dist + priorityBias - Math.max(0, dotForward) * 35;
    if (score < bestScore) {
      bestScore = score;
      best = {
        id: el.id,
        kind: el.kind,
        name: el.name,
        distanceCm: Math.round(dist * 10) / 10,
      };
    }
  }

  return best;
}

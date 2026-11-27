import type {
  ClosureSuggestion,
  DoorSwing,
  ElementCategoryId,
  ElementKind,
  ElementPlacementMode,
  ElementWallClearanceRay,
  ElementWallClearancesResult,
  ElevationFurnitureItem,
  ElevationOpeningItem,
  ElevationRenderItem,
  ElevationWallItem,
  FloorplanElement,
  FloorplanLayer,
  FloorplanProject,
  Point2D,
  SectionLine,
  SnapGuideLine,
  SolvedEdge,
  SolvedElementPlacement,
  SolvedElevation,
  SolvedFloorplan,
  SolvedInteriorWall,
  SolvedWallSegment,
  UnitType,
  WallOpeningDeduction,
  WallSurfaceBreakdownItem,
  WallSurfaceSummary,
} from '../types/floorplan';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const CLOSURE_THRESHOLD_CM = 2.0;

export const DEFAULT_WALL_COLOR = '#f8fafc';
export const DEFAULT_WALL_CORE_2D_COLOR = '#cbd5e1';
export const DEFAULT_INTERIOR_WALL_CORE_2D_COLOR = '#e2e8f0';
export const DEFAULT_FLOOR_COLOR = '#e7dccb';
export const DEFAULT_FLOOR_2D_COLOR = '#f8fafc';

export const WALL_COLOR_PRESETS: ReadonlyArray<{ label: string; hex: string }> = [
  { label: '純白石膏', hex: '#f8fafc' },
  { label: '暖米白', hex: '#f5f0e6' },
  { label: '淺水泥灰', hex: '#cbd5e1' },
  { label: '鼠尾草綠', hex: '#d1fae5' },
  { label: '莫蘭迪藍', hex: '#dbeafe' },
  { label: '霧面炭灰', hex: '#64748b' },
];

export const FLOOR_COLOR_PRESETS: ReadonlyArray<{ label: string; hex: string }> = [
  { label: '淺橡木', hex: '#e7dccb' },
  { label: '胡桃木', hex: '#b0845c' },
  { label: '白瓷磚', hex: '#f8fafc' },
  { label: '磨石子灰', hex: '#cbd5e1' },
  { label: '深岩板', hex: '#64748b' },
  { label: '醫療淺綠', hex: '#d1fae5' },
];

export const ELEMENT_COLOR_PRESETS: ReadonlyArray<{ label: string; hex: string }> = [
  { label: '原木橡色', hex: '#d9b382' },
  { label: '純白烤漆', hex: '#ffffff' },
  { label: '暖米亞麻', hex: '#f5ead6' },
  { label: '莫蘭迪藍', hex: '#93c5fd' },
  { label: '醫療薄荷', hex: '#6ee7b7' },
  { label: '現代深灰', hex: '#475569' },
];

export function sanitizeHexColor(val: unknown): string | undefined {
  if (typeof val !== 'string') return undefined;
  const trimmed = val.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return undefined;
}

export function getContrastTextColor(hex: string): string {
  const clean = sanitizeHexColor(hex);
  if (!clean) return '#0f172a';
  const r = parseInt(clean.slice(1, 3), 16);
  const g = parseInt(clean.slice(3, 5), 16);
  const b = parseInt(clean.slice(5, 7), 16);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance < 142 ? '#f8fafc' : '#0f172a';
}

export function darkenHexColor(hex: string, factor = 0.62): string {
  const clean = sanitizeHexColor(hex);
  if (!clean) return '#334155';
  const r = Math.max(0, Math.min(255, Math.round(parseInt(clean.slice(1, 3), 16) * factor)));
  const g = Math.max(0, Math.min(255, Math.round(parseInt(clean.slice(3, 5), 16) * factor)));
  const b = Math.max(0, Math.min(255, Math.round(parseInt(clean.slice(5, 7), 16) * factor)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export const ELEMENT_CATEGORIES: ReadonlyArray<{
  id: ElementCategoryId;
  label: string;
  kinds: readonly ElementKind[];
}> = [
  { id: 'opening', label: '門窗', kinds: ['door', 'window'] },
  { id: 'furniture', label: '家具', kinds: ['table', 'round_table', 'chair', 'sofa'] },
  { id: 'storage', label: '廚具櫃體', kinds: ['cabinet', 'wall_cabinet', 'kitchen_counter'] },
  { id: 'bathroom', label: '衛浴設備', kinds: ['toilet', 'urinal', 'shower', 'sink'] },
  { id: 'medical', label: '病房設施', kinds: ['bed', 'bed_curtain'] },
  {
    id: 'lighting',
    label: '燈具照明',
    kinds: ['panel_light', 'track_light', 'recessed_light', 'wall_sconce'],
  },
];

export const ELEMENT_KIND_DEFAULTS: Record<
  ElementKind,
  {
    label: string;
    category: ElementCategoryId;
    defaultPlacement: ElementPlacementMode;
    widthCm: number;
    depthCm: number;
    heightCm: number;
    elevationCm: number;
    showClearance?: boolean;
  }
> = {
  door: {
    label: '新門扇',
    category: 'opening',
    defaultPlacement: 'wall',
    widthCm: 90,
    depthCm: 12,
    heightCm: 210,
    elevationCm: 0,
  },
  window: {
    label: '新窗戶',
    category: 'opening',
    defaultPlacement: 'wall',
    widthCm: 140,
    depthCm: 12,
    heightCm: 130,
    elevationCm: 90,
  },
  cabinet: {
    label: '新櫃體',
    category: 'storage',
    defaultPlacement: 'wall',
    widthCm: 100,
    depthCm: 60,
    heightCm: 210,
    elevationCm: 0,
  },
  wall_cabinet: {
    label: '吊櫃',
    category: 'storage',
    defaultPlacement: 'free',
    widthCm: 100,
    depthCm: 35,
    heightCm: 70,
    elevationCm: 145,
  },
  kitchen_counter: {
    label: '廚房一字櫥櫃',
    category: 'storage',
    defaultPlacement: 'free',
    widthCm: 240,
    depthCm: 65,
    heightCm: 85,
    elevationCm: 0,
  },
  table: {
    label: '書桌／餐桌',
    category: 'furniture',
    defaultPlacement: 'free',
    widthCm: 120,
    depthCm: 60,
    heightCm: 75,
    elevationCm: 0,
  },
  round_table: {
    label: '圓桌',
    category: 'furniture',
    defaultPlacement: 'free',
    widthCm: 110,
    depthCm: 110,
    heightCm: 75,
    elevationCm: 0,
  },
  chair: {
    label: '座椅',
    category: 'furniture',
    defaultPlacement: 'free',
    widthCm: 48,
    depthCm: 48,
    heightCm: 85,
    elevationCm: 0,
  },
  sofa: {
    label: '沙發',
    category: 'furniture',
    defaultPlacement: 'free',
    widthCm: 210,
    depthCm: 88,
    heightCm: 82,
    elevationCm: 0,
  },
  bed: {
    label: '病床',
    category: 'medical',
    defaultPlacement: 'free',
    widthCm: 100,
    depthCm: 215,
    heightCm: 60,
    elevationCm: 0,
    showClearance: true,
  },
  bed_curtain: {
    label: '病床隔簾(L型)',
    category: 'medical',
    defaultPlacement: 'free',
    widthCm: 160,
    depthCm: 240,
    heightCm: 210,
    elevationCm: 40,
  },
  toilet: {
    label: '馬桶',
    category: 'bathroom',
    defaultPlacement: 'free',
    widthCm: 40,
    depthCm: 70,
    heightCm: 75,
    elevationCm: 0,
  },
  urinal: {
    label: '小便斗',
    category: 'bathroom',
    defaultPlacement: 'free',
    widthCm: 36,
    depthCm: 36,
    heightCm: 75,
    elevationCm: 50,
  },
  shower: {
    label: '蓮蓬頭',
    category: 'bathroom',
    defaultPlacement: 'free',
    widthCm: 30,
    depthCm: 35,
    heightCm: 130,
    elevationCm: 80,
  },
  sink: {
    label: '洗手台',
    category: 'bathroom',
    defaultPlacement: 'free',
    widthCm: 60,
    depthCm: 48,
    heightCm: 85,
    elevationCm: 0,
  },
  panel_light: {
    label: '平板燈',
    category: 'lighting',
    defaultPlacement: 'free',
    widthCm: 60,
    depthCm: 60,
    heightCm: 6,
    elevationCm: 244,
  },
  track_light: {
    label: '軌道燈',
    category: 'lighting',
    defaultPlacement: 'free',
    widthCm: 120,
    depthCm: 16,
    heightCm: 18,
    elevationCm: 232,
  },
  recessed_light: {
    label: '崁燈',
    category: 'lighting',
    defaultPlacement: 'free',
    widthCm: 18,
    depthCm: 18,
    heightCm: 8,
    elevationCm: 242,
  },
  wall_sconce: {
    label: '壁燈',
    category: 'lighting',
    defaultPlacement: 'wall',
    widthCm: 22,
    depthCm: 16,
    heightCm: 28,
    elevationCm: 170,
  },
};

export function normalizeAngleDeg(deg: number): number {
  const mod = ((deg % 360) + 360) % 360;
  return Math.abs(mod - 360) < 1e-9 ? 0 : mod;
}

export function rotateElementAngle(currentDeg: number | undefined, deltaDeg: number): number {
  return Math.round(normalizeAngleDeg((currentDeg ?? 0) + deltaDeg) * 10) / 10;
}

export function computeWallDragResult(params: {
  dxCm: number;
  dyCm: number;
  origOffsetCm: number;
  origBoxXCm: number;
  origBoxYCm: number;
  edgeLengthCm: number;
  elementWidthCm: number;
  tangent: Point2D;
  inwardNormal: Point2D;
  facingNormal: Point2D;
  isOpening: boolean;
  detachThresholdCm?: number;
  snapEnabled?: boolean;
}):
  | { mode: 'wall'; offsetCm: number }
  | { mode: 'free'; xCm: number; yCm: number; rotationDeg: number } {
  const {
    dxCm,
    dyCm,
    origOffsetCm,
    origBoxXCm,
    origBoxYCm,
    edgeLengthCm,
    elementWidthCm,
    tangent,
    inwardNormal,
    facingNormal,
    isOpening,
    detachThresholdCm = 26,
    snapEnabled = false,
  } = params;

  const perpDist = Math.abs(dxCm * inwardNormal.x + dyCm * inwardNormal.y);
  if (!isOpening && perpDist > detachThresholdCm) {
    const rotationDeg = Math.round(
      normalizeAngleDeg((Math.atan2(-facingNormal.x, facingNormal.y) * 180) / Math.PI)
    );
    return {
      mode: 'free',
      xCm: Math.round(origBoxXCm + dxCm),
      yCm: Math.round(origBoxYCm + dyCm),
      rotationDeg,
    };
  }

  const projAlong = dxCm * tangent.x + dyCm * tangent.y;
  const maxOff = Math.max(0, edgeLengthCm - elementWidthCm);
  let rawOff = Math.min(maxOff, Math.max(0, origOffsetCm + projAlong));
  if (snapEnabled) {
    const midOff = maxOff * 0.5;
    if (Math.abs(rawOff - midOff) <= 5) {
      rawOff = midOff;
    } else if (rawOff <= 4) {
      rawOff = 0;
    } else if (maxOff - rawOff <= 4) {
      rawOff = maxOff;
    }
  }
  const offsetCm = Math.round(rawOff);
  return { mode: 'wall', offsetCm };
}

/**
 * Computes magnetic alignment and wall-flush snapping for free-placed elements in 2D space.
 * Returns snapped center coordinates and visual alignment guide lines.
 */
export function computeMagneticSnapPosition(params: {
  elementId: string;
  candidateXCm: number;
  candidateYCm: number;
  widthCm: number;
  depthCm: number;
  rotationDeg: number;
  wallThicknessCm: number;
  solved: SolvedFloorplan;
  placements: SolvedElementPlacement[];
  enabled: boolean;
  snapThresholdCm?: number;
}): { xCm: number; yCm: number; guides: SnapGuideLine[] } {
  const {
    elementId,
    candidateXCm,
    candidateYCm,
    widthCm,
    depthCm,
    rotationDeg,
    wallThicknessCm,
    solved,
    placements,
    enabled,
    snapThresholdCm = 12,
  } = params;

  if (!enabled) {
    return {
      xCm: Math.round(candidateXCm),
      yCm: Math.round(candidateYCm),
      guides: [],
    };
  }

  const rad = normalizeAngleDeg(rotationDeg) * DEG_TO_RAD;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const halfExtentX = cos * (Math.max(5, widthCm) * 0.5) + sin * (Math.max(2, depthCm) * 0.5);
  const halfExtentY = sin * (Math.max(5, widthCm) * 0.5) + cos * (Math.max(2, depthCm) * 0.5);
  const halfWallThick = Math.max(2, (wallThicknessCm || 12) * 0.5);

  interface AxisCandidate {
    delta: number;
    absDist: number;
    targetPos: number;
    spanStart: number;
    spanEnd: number;
    reason: 'wall' | 'element' | 'center';
    priority: number;
  }

  const xCandidates: AxisCandidate[] = [];
  const yCandidates: AxisCandidate[] = [];

  const candMinY = candidateYCm - halfExtentY;
  const candMaxY = candidateYCm + halfExtentY;
  const candMinX = candidateXCm - halfExtentX;
  const candMaxX = candidateXCm + halfExtentX;

  const tryXTarget = (
    targetX: number,
    spanStart: number,
    spanEnd: number,
    reason: 'wall' | 'element' | 'center',
    priority: number,
    edgesOnly = false
  ) => {
    const anchors = edgesOnly
      ? [candidateXCm - halfExtentX, candidateXCm + halfExtentX]
      : [candidateXCm - halfExtentX, candidateXCm, candidateXCm + halfExtentX];
    for (const anchor of anchors) {
      const delta = targetX - anchor;
      const absDist = Math.abs(delta);
      if (absDist <= snapThresholdCm) {
        xCandidates.push({
          delta,
          absDist,
          targetPos: targetX,
          spanStart,
          spanEnd,
          reason,
          priority,
        });
      }
    }
  };

  const tryYTarget = (
    targetY: number,
    spanStart: number,
    spanEnd: number,
    reason: 'wall' | 'element' | 'center',
    priority: number,
    edgesOnly = false
  ) => {
    const anchors = edgesOnly
      ? [candidateYCm - halfExtentY, candidateYCm + halfExtentY]
      : [candidateYCm - halfExtentY, candidateYCm, candidateYCm + halfExtentY];
    for (const anchor of anchors) {
      const delta = targetY - anchor;
      const absDist = Math.abs(delta);
      if (absDist <= snapThresholdCm) {
        yCandidates.push({
          delta,
          absDist,
          targetPos: targetY,
          spanStart,
          spanEnd,
          reason,
          priority,
        });
      }
    }
  };

  // 1. Walls (outer perimeter inner face & interior partition faces)
  const allWalls = [...solved.solvedEdges, ...solved.solvedInteriorWalls].filter(
    (seg) => seg.hasWall && seg.lengthCm > 4
  );

  for (const seg of allWalls) {
    if (Math.abs(seg.tangent.x) < 0.08 && Math.abs(seg.start.x - seg.end.x) < 2) {
      const wallMinY = Math.min(seg.start.y, seg.end.y);
      const wallMaxY = Math.max(seg.start.y, seg.end.y);
      if (candMaxY >= wallMinY - 40 && candMinY <= wallMaxY + 40) {
        const wallX = (seg.start.x + seg.end.x) * 0.5;
        if (seg.isInterior) {
          tryXTarget(wallX - halfWallThick, wallMinY, wallMaxY, 'wall', 3, true);
          tryXTarget(wallX + halfWallThick, wallMinY, wallMaxY, 'wall', 3, true);
        } else {
          tryXTarget(wallX, wallMinY, wallMaxY, 'wall', 3, true);
        }
      }
    }
    if (Math.abs(seg.tangent.y) < 0.08 && Math.abs(seg.start.y - seg.end.y) < 2) {
      const wallMinX = Math.min(seg.start.x, seg.end.x);
      const wallMaxX = Math.max(seg.start.x, seg.end.x);
      if (candMaxX >= wallMinX - 40 && candMinX <= wallMaxX + 40) {
        const wallY = (seg.start.y + seg.end.y) * 0.5;
        if (seg.isInterior) {
          tryYTarget(wallY - halfWallThick, wallMinX, wallMaxX, 'wall', 3, true);
          tryYTarget(wallY + halfWallThick, wallMinX, wallMaxX, 'wall', 3, true);
        } else {
          tryYTarget(wallY, wallMinX, wallMaxX, 'wall', 3, true);
        }
      }
    }
  }

  // 2. Other placed elements (flush side contact + left/center/right alignment)
  for (const pl of placements) {
    if (pl.element.id === elementId) continue;
    const isOpening = pl.element.kind === 'door' || pl.element.kind === 'window';
    const peerHalfW = pl.clampedWidthCm * 0.5;
    const peerHalfD = isOpening ? halfWallThick : pl.element.depthCm * 0.5;
    const peerExtentX =
      Math.abs(pl.tangent.x) * peerHalfW + Math.abs(pl.facingNormal.x) * peerHalfD;
    const peerExtentY =
      Math.abs(pl.tangent.y) * peerHalfW + Math.abs(pl.facingNormal.y) * peerHalfD;
    const pMinX = pl.boxCenter.x - peerExtentX;
    const pMaxX = pl.boxCenter.x + peerExtentX;
    const pMidX = pl.boxCenter.x;
    const pMinY = pl.boxCenter.y - peerExtentY;
    const pMaxY = pl.boxCenter.y + peerExtentY;
    const pMidY = pl.boxCenter.y;

    tryXTarget(pMinX, pMinY, pMaxY, 'element', 2, false);
    tryXTarget(pMaxX, pMinY, pMaxY, 'element', 2, false);
    tryXTarget(pMidX, pMinY, pMaxY, 'element', 2, false);

    tryYTarget(pMinY, pMinX, pMaxX, 'element', 2, false);
    tryYTarget(pMaxY, pMinX, pMaxX, 'element', 2, false);
    tryYTarget(pMidY, pMinX, pMaxX, 'element', 2, false);
  }

  // 3. Room center axes (center-to-center alignment)
  if (Math.abs(solved.bounds.centerX - candidateXCm) <= snapThresholdCm * 0.75) {
    xCandidates.push({
      delta: solved.bounds.centerX - candidateXCm,
      absDist: Math.abs(solved.bounds.centerX - candidateXCm),
      targetPos: solved.bounds.centerX,
      spanStart: solved.bounds.minY,
      spanEnd: solved.bounds.maxY,
      reason: 'center',
      priority: 1,
    });
  }
  if (Math.abs(solved.bounds.centerY - candidateYCm) <= snapThresholdCm * 0.75) {
    yCandidates.push({
      delta: solved.bounds.centerY - candidateYCm,
      absDist: Math.abs(solved.bounds.centerY - candidateYCm),
      targetPos: solved.bounds.centerY,
      spanStart: solved.bounds.minX,
      spanEnd: solved.bounds.maxX,
      reason: 'center',
      priority: 1,
    });
  }

  const pickBest = (list: AxisCandidate[]): AxisCandidate | null => {
    if (list.length === 0) return null;
    list.sort((a, b) => {
      if (Math.abs(a.absDist - b.absDist) > 1.5) return a.absDist - b.absDist;
      return b.priority - a.priority;
    });
    return list[0];
  };

  const bestX = pickBest(xCandidates);
  const bestY = pickBest(yCandidates);

  const snappedX = Math.round(candidateXCm + (bestX ? bestX.delta : 0));
  const snappedY = Math.round(candidateYCm + (bestY ? bestY.delta : 0));

  const guides: SnapGuideLine[] = [];
  if (bestX) {
    guides.push({
      axis: 'x',
      positionCm: Math.round(bestX.targetPos * 10) / 10,
      startCm: Math.min(bestX.spanStart, snappedY - halfExtentY) - 12,
      endCm: Math.max(bestX.spanEnd, snappedY + halfExtentY) + 12,
      reason: bestX.reason,
    });
  }
  if (bestY) {
    guides.push({
      axis: 'y',
      positionCm: Math.round(bestY.targetPos * 10) / 10,
      startCm: Math.min(bestY.spanStart, snappedX - halfExtentX) - 12,
      endCm: Math.max(bestY.spanEnd, snappedX + halfExtentX) + 12,
      reason: bestY.reason,
    });
  }

  return { xCm: snappedX, yCm: snappedY, guides };
}

export const ALL_DOOR_SWINGS: readonly DoorSwing[] = [
  'inward-left',
  'inward-right',
  'outward-left',
  'outward-right',
  'sliding-inward-left',
  'sliding-inward-right',
  'sliding-outward-left',
  'sliding-outward-right',
] as const;

export function parseDoorSwing(swing: DoorSwing | undefined): {
  mode: 'swing' | 'sliding';
  side: 'inward' | 'outward';
  dir: 'left' | 'right';
} {
  const raw = swing || 'inward-right';
  const isSliding = raw.startsWith('sliding-');
  const core = isSliding ? raw.slice('sliding-'.length) : raw;
  const side: 'inward' | 'outward' = core.startsWith('outward') ? 'outward' : 'inward';
  const dir: 'left' | 'right' = core.endsWith('left') ? 'left' : 'right';
  return {
    mode: isSliding ? 'sliding' : 'swing',
    side,
    dir,
  };
}

export function buildDoorSwing(
  mode: 'swing' | 'sliding',
  side: 'inward' | 'outward',
  dir: 'left' | 'right'
): DoorSwing {
  return (mode === 'sliding' ? `sliding-${side}-${dir}` : `${side}-${dir}`) as DoorSwing;
}

export function getDoorSwingLabel(swing: DoorSwing | undefined): string {
  const { mode, side, dir } = parseDoorSwing(swing);
  if (mode === 'sliding') {
    const sideText = side === 'inward' ? '內橫拉' : '外橫拉';
    const dirText = dir === 'left' ? '往左' : '往右';
    return `${sideText}·${dirText}`;
  }
  const sideText = side === 'inward' ? '內開' : '外開';
  const dirText = dir === 'left' ? '左開' : '右開';
  return `${sideText}·${dirText}`;
}

export function flipDoorSwing(
  swing: DoorSwing | undefined,
  axis: 'hinge' | 'side' | 'type'
): DoorSwing {
  const parsed = parseDoorSwing(swing);
  if (axis === 'hinge') {
    return buildDoorSwing(
      parsed.mode,
      parsed.side,
      parsed.dir === 'right' ? 'left' : 'right'
    );
  }
  if (axis === 'side') {
    return buildDoorSwing(
      parsed.mode,
      parsed.side === 'inward' ? 'outward' : 'inward',
      parsed.dir
    );
  }
  return buildDoorSwing(
    parsed.mode === 'sliding' ? 'swing' : 'sliding',
    parsed.side,
    parsed.dir
  );
}

export function snapAngleDeg(
  rawAngleDeg: number,
  autoSnapAngles: boolean,
  toleranceDeg = 8
): { angleDeg: number; snapped: boolean } {
  const normalized = normalizeAngleDeg(rawAngleDeg);
  if (!autoSnapAngles) {
    return { angleDeg: normalized, snapped: false };
  }

  const orthoTargets = [0, 90, 180, 270];
  for (const target of orthoTargets) {
    const diff = Math.abs(shortestAngleDiffDeg(normalized, target));
    if (diff <= toleranceDeg) {
      return { angleDeg: target, snapped: diff > 1e-6 };
    }
  }

  const diagTargets = [45, 135, 225, 315];
  const diagTol = Math.min(4, toleranceDeg * 0.5);
  for (const target of diagTargets) {
    const diff = Math.abs(shortestAngleDiffDeg(normalized, target));
    if (diff <= diagTol) {
      return { angleDeg: target, snapped: diff > 1e-6 };
    }
  }

  return { angleDeg: normalized, snapped: false };
}

export function shortestAngleDiffDeg(a: number, b: number): number {
  let diff = normalizeAngleDeg(a) - normalizeAngleDeg(b);
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return diff;
}

export function computeSignedArea(points: Point2D[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    sum += p1.x * p2.y - p2.x * p1.y;
  }
  return sum * 0.5;
}

export function solveFloorplan(project: FloorplanProject): SolvedFloorplan {
  const edges = project.edges;
  if (edges.length === 0) {
    return {
      solvedEdges: [],
      solvedInteriorWalls: [],
      polygonPoints: [],
      rawEndPoint: { x: 0, y: 0 },
      isClockwise: true,
      isClosed: true,
      gapCm: 0,
      gapDxCm: 0,
      gapDyCm: 0,
      perimeterCm: 0,
      areaCm2: 0,
      areaSqMeters: 0,
      areaPing: 0,
      bounds: {
        minX: 0,
        minY: 0,
        maxX: 100,
        maxY: 100,
        widthCm: 100,
        heightCm: 100,
        centerX: 50,
        centerY: 50,
      },
      closureSuggestions: [],
    };
  }

  const rawPoints: Point2D[] = [{ x: 0, y: 0 }];
  const edgeMeta: Array<{
    rawAngleDeg: number;
    effectiveAngleDeg: number;
    snapped: boolean;
    lengthCm: number;
  }> = [];

  let totalPerimeter = 0;
  for (const edge of edges) {
    const len = Math.max(1, Number.isFinite(edge.lengthCm) ? edge.lengthCm : 100);
    const { angleDeg, snapped } = snapAngleDeg(
      edge.angleDeg,
      project.autoSnapAngles,
      project.snapToleranceDeg
    );
    const rad = angleDeg * DEG_TO_RAD;
    const prev = rawPoints[rawPoints.length - 1];
    rawPoints.push({
      x: prev.x + len * Math.cos(rad),
      y: prev.y + len * Math.sin(rad),
    });
    edgeMeta.push({
      rawAngleDeg: normalizeAngleDeg(edge.angleDeg),
      effectiveAngleDeg: angleDeg,
      snapped,
      lengthCm: len,
    });
    totalPerimeter += len;
  }

  const rawEnd = rawPoints[rawPoints.length - 1];
  const gapDxCm = rawPoints[0].x - rawEnd.x;
  const gapDyCm = rawPoints[0].y - rawEnd.y;
  const gapCm = Math.hypot(gapDxCm, gapDyCm);
  const isClosed = gapCm <= CLOSURE_THRESHOLD_CM;

  const adjustedPoints: Point2D[] = rawPoints.map((p) => ({ ...p }));
  if (project.forceClose && edges.length >= 3 && gapCm > 0.01 && totalPerimeter > 0) {
    let cumulative = 0;
    for (let i = 0; i < edges.length; i++) {
      cumulative += edgeMeta[i].lengthCm;
      const ratio = cumulative / totalPerimeter;
      adjustedPoints[i + 1] = {
        x: rawPoints[i + 1].x + gapDxCm * ratio,
        y: rawPoints[i + 1].y + gapDyCm * ratio,
      };
    }
    adjustedPoints[adjustedPoints.length - 1] = { ...adjustedPoints[0] };
  }

  const polygonPoints = adjustedPoints.slice(0, edges.length);

  const signedArea = computeSignedArea(polygonPoints);
  const isClockwise = signedArea >= 0;
  const areaCm2 = Math.abs(signedArea);
  const areaSqMeters = areaCm2 / 10000;
  const areaPing = areaSqMeters * 0.3025;

  const solvedEdges: SolvedEdge[] = [];
  for (let i = 0; i < edges.length; i++) {
    const start = adjustedPoints[i];
    const end =
      project.forceClose && i === edges.length - 1
        ? adjustedPoints[0]
        : adjustedPoints[i + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const actualLen = Math.hypot(dx, dy);
    const ux = actualLen > 1e-6 ? dx / actualLen : Math.cos(edgeMeta[i].effectiveAngleDeg * DEG_TO_RAD);
    const uy = actualLen > 1e-6 ? dy / actualLen : Math.sin(edgeMeta[i].effectiveAngleDeg * DEG_TO_RAD);

    const outwardNormal: Point2D = isClockwise
      ? { x: uy, y: -ux }
      : { x: -uy, y: ux };
    const inwardNormal: Point2D = { x: -outwardNormal.x, y: -outwardNormal.y };

    const effectiveAngle =
      actualLen > 1e-6 ? normalizeAngleDeg(Math.atan2(dy, dx) * RAD_TO_DEG) : edgeMeta[i].effectiveAngleDeg;

    solvedEdges.push({
      id: edges[i].id,
      label: edges[i].label,
      hasWall: edges[i].hasWall,
      isInterior: false,
      edge: edges[i],
      index: i,
      start,
      end,
      rawAngleDeg: edgeMeta[i].rawAngleDeg,
      effectiveAngleDeg: effectiveAngle,
      snapped: edgeMeta[i].snapped,
      lengthCm: actualLen,
      tangent: { x: ux, y: uy },
      outwardNormal,
      inwardNormal,
      midpoint: {
        x: (start.x + end.x) * 0.5,
        y: (start.y + end.y) * 0.5,
      },
      bowditchDeltaCm: actualLen - edgeMeta[i].lengthCm,
    });
  }

  // Solve interior partition walls (if present)
  const solvedInteriorWalls: SolvedInteriorWall[] = (project.interiorWalls ?? []).map(
    (wall, idx) => {
      const len = Math.max(1, Number.isFinite(wall.lengthCm) ? wall.lengthCm : 100);
      const sx = Number.isFinite(wall.startXCm) ? wall.startXCm : 0;
      const sy = Number.isFinite(wall.startYCm) ? wall.startYCm : 0;
      const { angleDeg, snapped } = snapAngleDeg(
        wall.angleDeg,
        project.autoSnapAngles,
        project.snapToleranceDeg
      );
      const rad = angleDeg * DEG_TO_RAD;
      const ux = Math.cos(rad);
      const uy = Math.sin(rad);
      const start: Point2D = { x: sx, y: sy };
      const end: Point2D = { x: sx + len * ux, y: sy + len * uy };
      const outwardNormal: Point2D = { x: uy, y: -ux };
      const inwardNormal: Point2D = { x: -uy, y: ux };

      return {
        id: wall.id,
        label: wall.label,
        hasWall: wall.hasWall !== false,
        isInterior: true,
        wall,
        index: idx,
        start,
        end,
        rawAngleDeg: normalizeAngleDeg(wall.angleDeg),
        effectiveAngleDeg: angleDeg,
        snapped,
        lengthCm: len,
        tangent: { x: ux, y: uy },
        outwardNormal,
        inwardNormal,
        midpoint: {
          x: (start.x + end.x) * 0.5,
          y: (start.y + end.y) * 0.5,
        },
      };
    }
  );

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of adjustedPoints) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }
  for (const iw of solvedInteriorWalls) {
    for (const pt of [iw.start, iw.end]) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  }
  const widthCm = Math.max(10, maxX - minX);
  const heightCm = Math.max(10, maxY - minY);

  const closureSuggestions: ClosureSuggestion[] = [];
  if (!isClosed && gapCm > CLOSURE_THRESHOLD_CM) {
    const scored = edges.map((edge, idx) => {
      const rad = edgeMeta[idx].effectiveAngleDeg * DEG_TO_RAD;
      const ux = Math.cos(rad);
      const uy = Math.sin(rad);
      const proj = gapDxCm * ux + gapDyCm * uy;
      const residualAfterSingleFix = Math.hypot(gapDxCm - proj * ux, gapDyCm - proj * uy);
      const improvement = gapCm - residualAfterSingleFix;
      return {
        edge,
        currentLengthCm: edgeMeta[idx].lengthCm,
        deltaLengthCm: proj,
        suggestedLengthCm: Math.max(5, Math.round((edgeMeta[idx].lengthCm + proj) * 10) / 10),
        improvement,
      };
    });

    scored.sort((a, b) => b.improvement - a.improvement);

    for (const item of scored.slice(0, 3)) {
      if (item.improvement > 0.5 && Math.abs(item.deltaLengthCm) >= 0.5) {
        const sign = item.deltaLengthCm >= 0 ? '+' : '';
        const dirText =
          Math.abs(gapDxCm) > Math.abs(gapDyCm) ? '水平方向缺口' : '垂直方向缺口';
        closureSuggestions.push({
          edgeId: item.edge.id,
          label: item.edge.label,
          currentLengthCm: item.currentLengthCm,
          suggestedLengthCm: item.suggestedLengthCm,
          deltaLengthCm: Math.round(item.deltaLengthCm * 10) / 10,
          reason: `微調約 ${sign}${(Math.round(item.deltaLengthCm * 10) / 10).toFixed(1)} cm 可大幅縮小${dirText}`,
        });
      }
    }
  }

  return {
    solvedEdges,
    solvedInteriorWalls,
    polygonPoints,
    rawEndPoint: rawEnd,
    isClockwise,
    isClosed,
    gapCm,
    gapDxCm,
    gapDyCm,
    perimeterCm: totalPerimeter,
    areaCm2,
    areaSqMeters,
    areaPing,
    bounds: {
      minX,
      minY,
      maxX,
      maxY,
      widthCm,
      heightCm,
      centerX: (minX + maxX) * 0.5,
      centerY: (minY + maxY) * 0.5,
    },
    closureSuggestions,
  };
}

export function applyAutoCloseToProject(project: FloorplanProject): FloorplanProject {
  const solved = solveFloorplan({ ...project, forceClose: false });
  if (solved.isClosed || solved.solvedEdges.length < 3) {
    return { ...project, forceClose: false };
  }

  const dxGap = solved.gapDxCm;
  const dyGap = solved.gapDyCm;

  let sumAbsCos = 0;
  let sumAbsSin = 0;
  const dirs = solved.solvedEdges.map((se) => {
    const rad = se.effectiveAngleDeg * DEG_TO_RAD;
    const ux = Math.cos(rad);
    const uy = Math.sin(rad);
    sumAbsCos += Math.abs(ux) * se.edge.lengthCm;
    sumAbsSin += Math.abs(uy) * se.edge.lengthCm;
    return { se, ux, uy };
  });

  if (sumAbsCos > 1 && sumAbsSin > 1) {
    const updatedEdges = dirs.map(({ se, ux, uy }) => {
      const len = se.edge.lengthCm;
      const contribX = Math.abs(ux) > 0.2 ? (dxGap * (Math.abs(ux) * len) / sumAbsCos) / ux : 0;
      const contribY = Math.abs(uy) > 0.2 ? (dyGap * (Math.abs(uy) * len) / sumAbsSin) / uy : 0;
      const weightX = Math.abs(ux) > 0.2 ? 1 : 0;
      const weightY = Math.abs(uy) > 0.2 ? 1 : 0;
      const delta =
        weightX && weightY ? (contribX + contribY) * 0.5 : contribX + contribY;
      const nextLen = Math.max(5, Math.round((len + delta) * 10) / 10);
      return {
        ...se.edge,
        lengthCm: nextLen,
        angleDeg: Math.round(se.effectiveAngleDeg * 10) / 10,
      };
    });

    const candidate: FloorplanProject = {
      ...project,
      edges: updatedEdges,
      forceClose: false,
    };
    const check = solveFloorplan(candidate);
    if (check.isClosed) {
      return candidate;
    }

    const finalEdges = [...updatedEdges];
    const bestXIdx = dirs.reduce(
      (best, d, i) => (Math.abs(d.ux) * d.se.lengthCm > Math.abs(dirs[best].ux) * dirs[best].se.lengthCm ? i : best),
      0
    );
    const bestYIdx = dirs.reduce(
      (best, d, i) => (Math.abs(d.uy) * d.se.lengthCm > Math.abs(dirs[best].uy) * dirs[best].se.lengthCm ? i : best),
      0
    );
    if (Math.abs(dirs[bestXIdx].ux) > 0.5) {
      finalEdges[bestXIdx] = {
        ...finalEdges[bestXIdx],
        lengthCm: Math.max(
          5,
          Math.round((finalEdges[bestXIdx].lengthCm + check.gapDxCm / dirs[bestXIdx].ux) * 10) / 10
        ),
      };
    }
    const check2 = solveFloorplan({ ...candidate, edges: finalEdges });
    if (Math.abs(dirs[bestYIdx].uy) > 0.5) {
      finalEdges[bestYIdx] = {
        ...finalEdges[bestYIdx],
        lengthCm: Math.max(
          5,
          Math.round((finalEdges[bestYIdx].lengthCm + check2.gapDyCm / dirs[bestYIdx].uy) * 10) / 10
        ),
      };
    }
    const check3 = solveFloorplan({ ...candidate, edges: finalEdges });
    if (check3.isClosed) {
      return { ...candidate, edges: finalEdges };
    }
  }

  const bowditchSolved = solveFloorplan({ ...project, forceClose: true });
  return {
    ...project,
    autoSnapAngles: false,
    edges: bowditchSolved.solvedEdges.map((se) => ({
      ...se.edge,
      lengthCm: Math.max(5, Math.round(se.lengthCm * 10) / 10),
      angleDeg: Math.round(se.effectiveAngleDeg * 100) / 100,
    })),
    forceClose: false,
  };
}

export function resolveElementPlacements(
  elements: FloorplanElement[],
  solved: SolvedFloorplan
): SolvedElementPlacement[] {
  const wallMap = new Map<string, SolvedWallSegment>();
  for (const se of solved.solvedEdges) {
    wallMap.set(se.id, se);
  }
  for (const iw of solved.solvedInteriorWalls) {
    wallMap.set(iw.id, iw);
  }

  const placements: SolvedElementPlacement[] = [];
  for (const el of elements) {
    const mode: ElementPlacementMode = el.placement === 'free' ? 'free' : 'wall';

    if (mode === 'free') {
      const cx = Number.isFinite(el.xCm) ? (el.xCm as number) : solved.bounds.centerX;
      const cy = Number.isFinite(el.yCm) ? (el.yCm as number) : solved.bounds.centerY;
      const angleDeg = normalizeAngleDeg(el.rotationDeg ?? 0);
      const angleRad = angleDeg * DEG_TO_RAD;
      const tangent: Point2D = { x: Math.cos(angleRad), y: Math.sin(angleRad) };
      // Facing direction perpendicular to width axis (at 0 deg -> +Y down)
      const facingNormal: Point2D = { x: -Math.sin(angleRad), y: Math.cos(angleRad) };
      const w = Math.max(10, el.widthCm);
      const center: Point2D = { x: cx, y: cy };

      placements.push({
        element: el,
        placementMode: 'free',
        edge: null,
        center,
        startPoint: {
          x: cx - tangent.x * w * 0.5,
          y: cy - tangent.y * w * 0.5,
        },
        endPoint: {
          x: cx + tangent.x * w * 0.5,
          y: cy + tangent.y * w * 0.5,
        },
        boxCenter: center,
        tangent,
        facingNormal,
        angleRad,
        angleDeg,
        outwardNormal: { x: -facingNormal.x, y: -facingNormal.y },
        inwardNormal: facingNormal,
        clampedOffsetCm: 0,
        clampedWidthCm: w,
      });
      continue;
    }

    // Wall-anchored placement (works for both outer perimeter edges and interior partition walls)
    const se = wallMap.get(el.edgeId) ?? solved.solvedEdges[0] ?? solved.solvedInteriorWalls[0];
    if (!se || se.lengthCm <= 1) continue;

    const clampedWidthCm = Math.min(Math.max(5, el.widthCm), se.lengthCm);
    const maxOffset = Math.max(0, se.lengthCm - clampedWidthCm);
    const clampedOffsetCm = Math.min(Math.max(0, el.offsetCm), maxOffset);

    const startDist = clampedOffsetCm;
    const endDist = clampedOffsetCm + clampedWidthCm;
    const midDist = (startDist + endDist) * 0.5;

    const startPoint: Point2D = {
      x: se.start.x + se.tangent.x * startDist,
      y: se.start.y + se.tangent.y * startDist,
    };
    const endPoint: Point2D = {
      x: se.start.x + se.tangent.x * endDist,
      y: se.start.y + se.tangent.y * endDist,
    };
    const center: Point2D = {
      x: se.start.x + se.tangent.x * midDist,
      y: se.start.y + se.tangent.y * midDist,
    };

    const normalDir = el.side === 'outside' ? se.outwardNormal : se.inwardNormal;
    const isProjectedBody = el.kind !== 'door' && el.kind !== 'window';
    const localRotDeg = isProjectedBody ? normalizeAngleDeg(el.rotationDeg ?? 0) : 0;
    const localRotRad = localRotDeg * DEG_TO_RAD;
    const cosR = Math.cos(localRotRad);
    const sinR = Math.sin(localRotRad);

    const rotatedTangent: Point2D = isProjectedBody
      ? {
          x: se.tangent.x * cosR + normalDir.x * sinR,
          y: se.tangent.y * cosR + normalDir.y * sinR,
        }
      : se.tangent;
    const rotatedFacingNormal: Point2D = isProjectedBody
      ? {
          x: -se.tangent.x * sinR + normalDir.x * cosR,
          y: -se.tangent.y * sinR + normalDir.y * cosR,
        }
      : normalDir;

    const shift = isProjectedBody
      ? Math.abs(cosR) * (el.depthCm * 0.5) + Math.abs(sinR) * (clampedWidthCm * 0.5)
      : 0;
    const boxCenter: Point2D = {
      x: center.x + normalDir.x * shift,
      y: center.y + normalDir.y * shift,
    };

    const angleRad = Math.atan2(rotatedTangent.y, rotatedTangent.x);

    placements.push({
      element: el,
      placementMode: 'wall',
      edge: se,
      center,
      startPoint,
      endPoint,
      boxCenter,
      tangent: rotatedTangent,
      facingNormal: rotatedFacingNormal,
      angleRad,
      angleDeg: normalizeAngleDeg(se.effectiveAngleDeg + localRotDeg),
      outwardNormal: se.outwardNormal,
      inwardNormal: se.inwardNormal,
      clampedOffsetCm,
      clampedWidthCm,
    });
  }

  return placements;
}

export function formatDimension(cm: number, unit: UnitType, includeUnit = true): string {
  if (!Number.isFinite(cm)) return includeUnit ? `0 ${unit}` : '0';
  if (unit === 'm') {
    const val = (cm / 100).toFixed(2);
    return includeUnit ? `${val} m` : val;
  }
  if (unit === 'mm') {
    const val = Math.round(cm * 10).toString();
    return includeUnit ? `${val} mm` : val;
  }
  const rounded = Math.abs(cm - Math.round(cm)) < 0.05 ? Math.round(cm).toString() : cm.toFixed(1);
  return includeUnit ? `${rounded} cm` : rounded;
}

export function computeWallSurfaceAreas(
  project: FloorplanProject,
  solved: SolvedFloorplan,
  placements: SolvedElementPlacement[],
  options?: { interiorWallFaces?: 1 | 2 }
): WallSurfaceSummary {
  const ceilingHeightCm = Math.max(1, Number.isFinite(project.ceilingHeightCm) ? project.ceilingHeightCm : 250);
  const interiorWallFaces: 1 | 2 = options?.interiorWallFaces === 1 ? 1 : 2;

  const allSegments: SolvedWallSegment[] = [
    ...solved.solvedEdges,
    ...solved.solvedInteriorWalls,
  ];

  const items: WallSurfaceBreakdownItem[] = [];
  let totalGrossAreaM2 = 0;
  let totalDeductionAreaM2 = 0;
  let totalNetAreaM2 = 0;
  let outerNetAreaM2 = 0;
  let interiorPartitionNetAreaM2 = 0;

  for (const seg of allSegments) {
    if (!seg.hasWall) continue;
    const faces: 1 | 2 = seg.isInterior ? interiorWallFaces : 1;
    const singleFaceGrossCm2 = seg.lengthCm * ceilingHeightCm;

    const openings: WallOpeningDeduction[] = [];
    let singleFaceDeductionCm2 = 0;

    for (const pl of placements) {
      if (pl.placementMode !== 'wall' || pl.edge?.id !== seg.id) continue;
      if (pl.element.kind !== 'door' && pl.element.kind !== 'window') continue;

      const bottom = Math.max(0, Math.min(ceilingHeightCm, pl.element.elevationCm || 0));
      const top = Math.max(
        bottom,
        Math.min(ceilingHeightCm, (pl.element.elevationCm || 0) + Math.max(0, pl.element.heightCm || 0))
      );
      const effectiveHeightCm = Math.max(0, top - bottom);
      const deductCm2 = pl.clampedWidthCm * effectiveHeightCm;
      singleFaceDeductionCm2 += deductCm2;

      openings.push({
        elementId: pl.element.id,
        name: pl.element.name,
        kind: pl.element.kind,
        widthCm: pl.clampedWidthCm,
        effectiveHeightCm,
        deductAreaM2: (deductCm2 * faces) / 10000,
      });
    }

    const clampedSingleDeductionCm2 = Math.min(singleFaceGrossCm2, singleFaceDeductionCm2);
    const singleFaceNetCm2 = Math.max(0, singleFaceGrossCm2 - clampedSingleDeductionCm2);

    const grossAreaM2 = (singleFaceGrossCm2 * faces) / 10000;
    const deductionAreaM2 = (clampedSingleDeductionCm2 * faces) / 10000;
    const netAreaM2 = (singleFaceNetCm2 * faces) / 10000;

    items.push({
      wallId: seg.id,
      label: seg.label,
      isInterior: seg.isInterior,
      faces,
      lengthCm: seg.lengthCm,
      heightCm: ceilingHeightCm,
      grossAreaM2,
      deductionAreaM2,
      netAreaM2,
      openings,
    });

    totalGrossAreaM2 += grossAreaM2;
    totalDeductionAreaM2 += deductionAreaM2;
    totalNetAreaM2 += netAreaM2;
    if (seg.isInterior) {
      interiorPartitionNetAreaM2 += netAreaM2;
    } else {
      outerNetAreaM2 += netAreaM2;
    }
  }

  return {
    ceilingHeightCm,
    interiorWallFaces,
    items,
    totalGrossAreaM2,
    totalDeductionAreaM2,
    totalNetAreaM2,
    totalNetAreaPing: totalNetAreaM2 * 0.3025,
    outerNetAreaM2,
    interiorPartitionNetAreaM2,
    floorAreaM2: solved.areaSqMeters,
    floorAreaPing: solved.areaPing,
  };
}

function intersectRayWithSegment(
  origin: Point2D,
  dir: Point2D,
  segStart: Point2D,
  segEnd: Point2D
): { t: number; point: Point2D } | null {
  const rx = dir.x;
  const ry = dir.y;
  const sx = segEnd.x - segStart.x;
  const sy = segEnd.y - segStart.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-8) return null;

  const qpx = segStart.x - origin.x;
  const qpy = segStart.y - origin.y;
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * ry - qpy * rx) / denom;

  if (u < -0.001 || u > 1.001) return null;
  if (t < -0.6) return null;

  const clampedT = Math.max(0, t);
  return {
    t: clampedT,
    point: {
      x: origin.x + rx * clampedT,
      y: origin.y + ry * clampedT,
    },
  };
}

/**
 * Cast rays from all 4 outer sides of an element's oriented bounding box
 * to find the nearest surrounding wall segment in each direction.
 */
export function computeElementWallClearances(
  placement: SolvedElementPlacement,
  solved: SolvedFloorplan,
  wallThicknessCm = 12
): ElementWallClearancesResult {
  const isOpening =
    placement.element.kind === 'door' || placement.element.kind === 'window';
  const halfW = placement.clampedWidthCm * 0.5;
  const halfD = isOpening
    ? Math.max(4, wallThicknessCm * 0.5)
    : placement.element.depthCm * 0.5;

  const wallSegments = [...solved.solvedEdges, ...solved.solvedInteriorWalls].filter(
    (seg) => seg.hasWall
  );

  const sideDefs: Array<{
    side: ElementWallClearanceRay['side'];
    sideLabel: string;
    origin: Point2D;
    dir: Point2D;
  }> = [
    {
      side: 'left',
      sideLabel: '左側',
      origin: {
        x: placement.boxCenter.x - placement.tangent.x * halfW,
        y: placement.boxCenter.y - placement.tangent.y * halfW,
      },
      dir: { x: -placement.tangent.x, y: -placement.tangent.y },
    },
    {
      side: 'right',
      sideLabel: '右側',
      origin: {
        x: placement.boxCenter.x + placement.tangent.x * halfW,
        y: placement.boxCenter.y + placement.tangent.y * halfW,
      },
      dir: { x: placement.tangent.x, y: placement.tangent.y },
    },
    {
      side: 'back',
      sideLabel: '後方',
      origin: {
        x: placement.boxCenter.x - placement.facingNormal.x * halfD,
        y: placement.boxCenter.y - placement.facingNormal.y * halfD,
      },
      dir: { x: -placement.facingNormal.x, y: -placement.facingNormal.y },
    },
    {
      side: 'front',
      sideLabel: '前方',
      origin: {
        x: placement.boxCenter.x + placement.facingNormal.x * halfD,
        y: placement.boxCenter.y + placement.facingNormal.y * halfD,
      },
      dir: { x: placement.facingNormal.x, y: placement.facingNormal.y },
    },
  ];

  const rays: ElementWallClearanceRay[] = [];
  for (const def of sideDefs) {
    let bestHit: {
      dist: number;
      point: Point2D;
      wallId: string;
      wallLabel: string;
    } | null = null;

    for (const seg of wallSegments) {
      const hit = intersectRayWithSegment(def.origin, def.dir, seg.start, seg.end);
      if (!hit) continue;
      // Ignore grazing intersection on a wall that the ray starts away from unless anchored flush
      const isAnchoredWall = placement.edge?.id === seg.id;
      if (!isAnchoredWall && hit.t < 0.25) continue;

      if (!bestHit || hit.t < bestHit.dist) {
        bestHit = {
          dist: hit.t,
          point: hit.point,
          wallId: seg.id,
          wallLabel: seg.label,
        };
      }
    }

    if (bestHit) {
      rays.push({
        side: def.side,
        sideLabel: def.sideLabel,
        start: def.origin,
        end: bestHit.point,
        distanceCm: Math.round(bestHit.dist * 10) / 10,
        wallId: bestHit.wallId,
        wallLabel: bestHit.wallLabel,
      });
    }
  }

  return {
    elementId: placement.element.id,
    rays,
  };
}

/**
 * Duplicate an existing element cleanly for Ctrl+C / Ctrl+V paste operations.
 */
export function duplicateElementForPaste(
  source: FloorplanElement,
  project: FloorplanProject,
  solved: SolvedFloorplan,
  pasteSequence = 1
): FloorplanElement {
  const step = Math.max(1, pasteSequence);
  const existingNames = new Set(project.elements.map((e) => e.name));
  const baseName = source.name.replace(/\s*\(複製(?:\s*\d+)?\)\s*$/, '').trim() || source.name;
  let candidateName = `${baseName} (複製)`;
  let suffix = 2;
  while (existingNames.has(candidateName)) {
    candidateName = `${baseName} (複製 ${suffix})`;
    suffix += 1;
  }

  const newId = `el-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const isOpening = source.kind === 'door' || source.kind === 'window';
  const mode: ElementPlacementMode = !isOpening && source.placement === 'free' ? 'free' : 'wall';

  if (mode === 'free') {
    const baseX = Number.isFinite(source.xCm) ? (source.xCm as number) : solved.bounds.centerX;
    const baseY = Number.isFinite(source.yCm) ? (source.yCm as number) : solved.bounds.centerY;
    const offset = 28 * step;
    const marginX = Math.max(10, source.widthCm * 0.5);
    const marginY = Math.max(10, source.depthCm * 0.5);
    const nextX = Math.min(
      Math.max(solved.bounds.minX + marginX, Math.round(baseX + offset)),
      Math.max(solved.bounds.minX + marginX, solved.bounds.maxX - marginX)
    );
    const nextY = Math.min(
      Math.max(solved.bounds.minY + marginY, Math.round(baseY + offset)),
      Math.max(solved.bounds.minY + marginY, solved.bounds.maxY - marginY)
    );
    return {
      ...source,
      id: newId,
      name: candidateName,
      placement: 'free',
      xCm: nextX,
      yCm: nextY,
    };
  }

  const allWalls: SolvedWallSegment[] = [
    ...solved.solvedEdges,
    ...solved.solvedInteriorWalls,
  ];
  const wall = allWalls.find((w) => w.id === source.edgeId) ?? allWalls[0];
  let nextOffset = source.offsetCm + 25 * step;
  if (wall) {
    const maxOff = Math.max(0, wall.lengthCm - source.widthCm);
    const delta = (source.widthCm + 15) * step;
    if (source.offsetCm + delta <= maxOff) {
      nextOffset = source.offsetCm + delta;
    } else if (source.offsetCm - delta >= 0) {
      nextOffset = source.offsetCm - delta;
    } else {
      nextOffset = Math.min(maxOff, Math.max(0, (source.offsetCm + 25 * step) % Math.max(1, maxOff + 1)));
    }
  }

  return {
    ...source,
    id: newId,
    name: candidateName,
    offsetCm: Math.round(nextOffset * 10) / 10,
  };
}

export function getNextSectionLabel(existing: SectionLine[] | undefined): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const used = new Set((existing ?? []).map((s) => s.label));
  for (let i = 0; i < letters.length; i++) {
    const label = `${letters[i]}-${letters[i]}`;
    if (!used.has(label)) return label;
  }
  return `S${(existing?.length ?? 0) + 1}`;
}

export function createPresetSectionLine(
  solved: SolvedFloorplan,
  direction: 'north' | 'south' | 'west' | 'east',
  existing?: SectionLine[]
): SectionLine {
  const { minX, maxX, minY, maxY, centerX, centerY } = solved.bounds;
  const pad = 25;
  const label = getNextSectionLabel(existing);
  const id = `sec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  if (direction === 'north') {
    // Cut horizontally left -> right, look UP (-Y)
    return {
      id,
      label,
      startXCm: Math.round(minX - pad),
      startYCm: Math.round(centerY),
      endXCm: Math.round(maxX + pad),
      endYCm: Math.round(centerY),
      viewDirection: 1,
    };
  }
  if (direction === 'south') {
    // Cut horizontally left -> right, look DOWN (+Y)
    return {
      id,
      label,
      startXCm: Math.round(minX - pad),
      startYCm: Math.round(centerY),
      endXCm: Math.round(maxX + pad),
      endYCm: Math.round(centerY),
      viewDirection: -1,
    };
  }
  if (direction === 'east') {
    // Cut vertically top -> bottom, look RIGHT (+X)
    return {
      id,
      label,
      startXCm: Math.round(centerX),
      startYCm: Math.round(minY - pad),
      endXCm: Math.round(centerX),
      endYCm: Math.round(maxY + pad),
      viewDirection: 1,
    };
  }
  // Cut vertically top -> bottom, look LEFT (-X)
  return {
    id,
    label,
    startXCm: Math.round(centerX),
    startYCm: Math.round(minY - pad),
    endXCm: Math.round(centerX),
    endYCm: Math.round(maxY + pad),
    viewDirection: -1,
  };
}

/**
 * Derive basis vectors for a section cut line:
 * - lookDir (v): direction the observer faces
 * - rightAxis (r): observer's screen-right horizontal axis in 2D plan coordinates (+X right, +Y down)
 */
export function getSectionBasis(section: SectionLine): {
  origin: Point2D;
  cutDir: Point2D;
  cutLengthCm: number;
  lookDir: Point2D;
  rightAxis: Point2D;
} {
  const dx = section.endXCm - section.startXCm;
  const dy = section.endYCm - section.startYCm;
  const len = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / len;
  const uy = dy / len;
  const sign = section.viewDirection === -1 ? -1 : 1;
  // When cut goes left->right (1, 0), sign=+1 looks North (0, -1)
  const lookDir: Point2D = {
    x: uy * sign,
    y: -ux * sign,
  };
  // Viewer's right hand when looking along lookDir in 2D (+X right, +Y down): (-vy, vx)
  const rightAxis: Point2D = {
    x: -lookDir.y,
    y: lookDir.x,
  };
  return {
    origin: { x: section.startXCm, y: section.startYCm },
    cutDir: { x: ux, y: uy },
    cutLengthCm: len,
    lookDir,
    rightAxis,
  };
}

function clipSegmentToRange(
  a: { s: number; d: number },
  b: { s: number; d: number },
  sMin: number,
  sMax: number,
  dMin: number
): [{ s: number; d: number }, { s: number; d: number }] | null {
  let t0 = 0;
  let t1 = 1;
  const ds = b.s - a.s;
  const dd = b.d - a.d;

  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-8) {
      return q >= 0;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };

  if (
    !clip(-ds, a.s - sMin) ||
    !clip(ds, sMax - a.s) ||
    !clip(-dd, a.d - dMin)
  ) {
    return null;
  }

  return [
    { s: a.s + t0 * ds, d: a.d + t0 * dd },
    { s: a.s + t1 * ds, d: a.d + t1 * dd },
  ];
}

const ELEVATION_OCCLUSION_DEPTH_TOL_CM = 2;

function subtractVisibleIntervals(
  base: [number, number],
  blockers: Array<[number, number]>
): Array<[number, number]> {
  const [baseStart, baseEnd] = base;
  if (baseEnd - baseStart <= 1e-4) return [];
  let remaining: Array<[number, number]> = [[baseStart, baseEnd]];

  for (const [bRawStart, bRawEnd] of blockers) {
    const bStart = Math.max(baseStart, bRawStart);
    const bEnd = Math.min(baseEnd, bRawEnd);
    if (bEnd - bStart <= 1e-4) continue;

    const next: Array<[number, number]> = [];
    for (const [rStart, rEnd] of remaining) {
      if (bEnd <= rStart + 1e-4 || bStart >= rEnd - 1e-4) {
        next.push([rStart, rEnd]);
      } else {
        if (bStart > rStart + 1e-4) {
          next.push([rStart, bStart]);
        }
        if (bEnd < rEnd - 1e-4) {
          next.push([bEnd, rEnd]);
        }
      }
    }
    remaining = next;
    if (remaining.length === 0) break;
  }

  return remaining;
}

function computeWallOccludingInterval(
  wall: ElevationWallItem,
  tS0: number,
  tS1: number,
  tD0: number,
  tD1: number
): [number, number] | null {
  const wS0 = wall.sStartCm;
  const wS1 = wall.sEndCm;
  const a0 = Math.max(wS0, tS0);
  const a1 = Math.min(wS1, tS1);
  if (a1 - a0 <= 1e-4) return null;

  const wD0 = wall.dStartCm ?? wall.depthCm;
  const wD1 = wall.dEndCm ?? wall.depthCm;
  const evalWallD = (s: number) =>
    wS1 - wS0 > 1e-4 ? wD0 + ((s - wS0) / (wS1 - wS0)) * (wD1 - wD0) : Math.min(wD0, wD1);
  const evalTargetD = (s: number) =>
    tS1 - tS0 > 1e-4 ? tD0 + ((s - tS0) / (tS1 - tS0)) * (tD1 - tD0) : tD0;

  const v0 = evalTargetD(a0) - evalWallD(a0);
  const v1 = evalTargetD(a1) - evalWallD(a1);
  const T = ELEVATION_OCCLUSION_DEPTH_TOL_CM;

  if (v0 <= T && v1 <= T) return null;
  if (v0 >= T && v1 >= T) return [a0, a1];

  const denom = v1 - v0;
  if (Math.abs(denom) <= 1e-6) {
    return (v0 + v1) * 0.5 > T ? [a0, a1] : null;
  }
  const sCross = a0 + ((T - v0) / denom) * (a1 - a0);
  return v0 > T ? [a0, sCross] : [sCross, a1];
}

function pickWidestInterval(
  intervals: Array<[number, number]>,
  fallbackStart: number,
  fallbackEnd: number
): [number, number] {
  if (intervals.length === 0) return [fallbackStart, fallbackEnd];
  let best = intervals[0];
  let bestLen = best[1] - best[0];
  for (let i = 1; i < intervals.length; i++) {
    const len = intervals[i][1] - intervals[i][0];
    if (len > bestLen) {
      best = intervals[i];
      bestLen = len;
    }
  }
  return best;
}

/**
 * Project walls, doors, windows, and furniture in front of a section cut line
 * into an architectural elevation drawing, culling items hidden behind nearer walls.
 */
export function computeSectionElevation(
  project: FloorplanProject,
  solved: SolvedFloorplan,
  placements: SolvedElementPlacement[],
  sectionLine: SectionLine
): SolvedElevation {
  const ceilingHeightCm = Math.max(
    100,
    Number.isFinite(project.ceilingHeightCm) ? project.ceilingHeightCm : 250
  );
  const wallThick = Math.max(6, project.wallThicknessCm || 12);
  const { origin, cutLengthCm, lookDir, rightAxis } = getSectionBasis(sectionLine);

  const projectPt = (pt: Point2D) => {
    const rx = pt.x - origin.x;
    const ry = pt.y - origin.y;
    return {
      s: rx * rightAxis.x + ry * rightAxis.y,
      d: rx * lookDir.x + ry * lookDir.y,
    };
  };

  const p1Proj = projectPt({ x: sectionLine.startXCm, y: sectionLine.startYCm });
  const p2Proj = projectPt({ x: sectionLine.endXCm, y: sectionLine.endYCm });
  const sMinCm = Math.min(p1Proj.s, p2Proj.s);
  const sMaxCm = Math.max(p1Proj.s, p2Proj.s);

  const walls: ElevationWallItem[] = [];
  const allWallSegs = [...solved.solvedEdges, ...solved.solvedInteriorWalls].filter(
    (seg) => seg.hasWall
  );

  for (const seg of allWallSegs) {
    const a = projectPt(seg.start);
    const b = projectPt(seg.end);

    // Check if the section cut line directly slices through this wall
    let isCutThrough = false;
    if ((a.d <= 0.5 && b.d >= -0.5) || (b.d <= 0.5 && a.d >= -0.5)) {
      const denom = b.d - a.d;
      if (Math.abs(denom) > 1e-4) {
        const t = -a.d / denom;
        if (t >= -0.01 && t <= 1.01) {
          const sCross = a.s + t * (b.s - a.s);
          if (sCross >= sMinCm - wallThick && sCross <= sMaxCm + wallThick) {
            isCutThrough = true;
          }
        }
      }
    }

    const clipped = clipSegmentToRange(a, b, sMinCm - 4, sMaxCm + 4, -2);
    if (!clipped) continue;

    const c0 = clipped[0].s <= clipped[1].s ? clipped[0] : clipped[1];
    const c1 = clipped[0].s <= clipped[1].s ? clipped[1] : clipped[0];

    let segSMin = c0.s;
    let segSMax = c1.s;
    const span = segSMax - segSMin;
    if (span < 2 && !isCutThrough) continue;

    let dStartCm = c0.d;
    let dEndCm = c1.d;
    let avgDepth = (c0.d + c1.d) * 0.5;

    if (isCutThrough && span < wallThick) {
      const midS = (segSMin + segSMax) * 0.5;
      segSMin = midS - wallThick * 0.5;
      segSMax = midS + wallThick * 0.5;
      // Cut cross-section sits directly on the section cut plane (d = 0)
      dStartCm = 0;
      dEndCm = 0;
      avgDepth = 0;
    }

    walls.push({
      wallId: seg.id,
      label: seg.label,
      isInterior: seg.isInterior,
      isCutThrough,
      sStartCm: segSMin,
      sEndCm: segSMax,
      depthCm: avgDepth,
      dStartCm,
      dEndCm,
      heightCm: ceilingHeightCm,
    });
  }

  // Sort walls back-to-front so closer walls naturally sit over farther walls
  walls.sort((x, y) => y.depthCm - x.depthCm);

  const openings: ElevationOpeningItem[] = [];
  const furniture: ElevationFurnitureItem[] = [];
  const edgeOcclusionTol = wallThick * 0.65;

  for (const pl of placements) {
    const el = pl.element;
    if (el.kind === 'door' || el.kind === 'window') {
      const pA = projectPt(pl.startPoint);
      const pB = projectPt(pl.endPoint);
      const midDepth = (pA.d + pB.d) * 0.5;
      // Only show openings that are in front of the cut line and face broadly toward viewer
      if (Math.max(pA.d, pB.d) < -wallThick * 0.5) continue;

      const o0 = pA.s <= pB.s ? pA : pB;
      const o1 = pA.s <= pB.s ? pB : pA;
      const opMin = Math.max(sMinCm - 2, o0.s);
      const opMax = Math.min(sMaxCm + 2, o1.s);
      const projW = opMax - opMin;
      if (projW < 6) continue;

      const evalOpeningD = (s: number) =>
        o1.s - o0.s > 1e-4 ? o0.d + ((s - o0.s) / (o1.s - o0.s)) * (o1.d - o0.d) : midDepth;
      const tD0 = evalOpeningD(opMin);
      const tD1 = evalOpeningD(opMax);
      const hostWallId = el.placement === 'wall' ? el.edgeId : undefined;

      const blockers: Array<[number, number]> = [];
      for (const wall of walls) {
        if (hostWallId && wall.wallId === hostWallId) continue;
        const occ = computeWallOccludingInterval(wall, opMin, opMax, tD0, tD1);
        if (occ) blockers.push(occ);
      }

      const visibleIntervals = subtractVisibleIntervals([opMin, opMax], blockers);
      const visibleWidth = visibleIntervals.reduce((acc, [s0, s1]) => acc + (s1 - s0), 0);
      if (visibleWidth < Math.min(4, projW * 0.15)) {
        continue;
      }

      const [visibleSStartCm, visibleSEndCm] = pickWidestInterval(visibleIntervals, opMin, opMax);
      const firstVisibleStart = visibleIntervals[0][0];
      const lastVisibleEnd = visibleIntervals[visibleIntervals.length - 1][1];
      const dimSStartCm =
        firstVisibleStart - opMin > edgeOcclusionTol ? firstVisibleStart : opMin;
      const dimSEndCm = opMax - lastVisibleEnd > edgeOcclusionTol ? lastVisibleEnd : opMax;

      let slideSignInView: 1 | -1 | undefined;
      if (el.kind === 'door') {
        const parsedDoor = parseDoorSwing(el.swingDirection);
        const targetVec =
          parsedDoor.mode === 'sliding'
            ? {
                x: pl.tangent.x * (parsedDoor.dir === 'right' ? 1 : -1),
                y: pl.tangent.y * (parsedDoor.dir === 'right' ? 1 : -1),
              }
            : {
                x: pl.tangent.x * (parsedDoor.dir === 'right' ? -1 : 1),
                y: pl.tangent.y * (parsedDoor.dir === 'right' ? -1 : 1),
              };
        const dotS = targetVec.x * rightAxis.x + targetVec.y * rightAxis.y;
        slideSignInView = dotS >= 0 ? 1 : -1;
      }

      openings.push({
        elementId: el.id,
        hostWallId,
        kind: el.kind,
        name: el.name,
        ...(el.kind === 'door'
          ? {
              swingDirection: el.swingDirection || 'inward-right',
              slideSignInView,
            }
          : {}),
        sStartCm: opMin,
        sEndCm: opMax,
        visibleSStartCm,
        visibleSEndCm,
        dimSStartCm,
        dimSEndCm,
        projectedWidthCm: projW,
        actualWidthCm: pl.clampedWidthCm,
        elevationCm: Math.max(0, el.elevationCm),
        heightCm: Math.min(ceilingHeightCm - Math.max(0, el.elevationCm), Math.max(10, el.heightCm)),
        depthCm: midDepth,
        ...(el.color ? { color: el.color } : {}),
      });
    } else {
      const halfW = pl.clampedWidthCm * 0.5;
      const halfD = el.depthCm * 0.5;
      const corners: Point2D[] = [
        {
          x: pl.boxCenter.x - pl.tangent.x * halfW - pl.facingNormal.x * halfD,
          y: pl.boxCenter.y - pl.tangent.y * halfW - pl.facingNormal.y * halfD,
        },
        {
          x: pl.boxCenter.x + pl.tangent.x * halfW - pl.facingNormal.x * halfD,
          y: pl.boxCenter.y + pl.tangent.y * halfW - pl.facingNormal.y * halfD,
        },
        {
          x: pl.boxCenter.x + pl.tangent.x * halfW + pl.facingNormal.x * halfD,
          y: pl.boxCenter.y + pl.tangent.y * halfW + pl.facingNormal.y * halfD,
        },
        {
          x: pl.boxCenter.x - pl.tangent.x * halfW + pl.facingNormal.x * halfD,
          y: pl.boxCenter.y - pl.tangent.y * halfW + pl.facingNormal.y * halfD,
        },
      ];
      const projectedCorners = corners.map(projectPt);
      const dMax = Math.max(...projectedCorners.map((c) => c.d));
      const dMin = Math.min(...projectedCorners.map((c) => c.d));
      if (dMax < -2) continue;

      const rawSMin = Math.min(...projectedCorners.map((c) => c.s));
      const rawSMax = Math.max(...projectedCorners.map((c) => c.s));
      const sStart = Math.max(sMinCm - 2, rawSMin);
      const sEnd = Math.min(sMaxCm + 2, rawSMax);
      const fSpan = sEnd - sStart;
      if (fSpan < 4) continue;

      const frontDepth = Math.max(0, dMin);
      const blockers: Array<[number, number]> = [];
      for (const wall of walls) {
        const occ = computeWallOccludingInterval(wall, sStart, sEnd, frontDepth, frontDepth);
        if (occ) blockers.push(occ);
      }

      const visibleIntervals = subtractVisibleIntervals([sStart, sEnd], blockers);
      const visibleWidth = visibleIntervals.reduce((acc, [s0, s1]) => acc + (s1 - s0), 0);
      if (visibleWidth < Math.min(4, fSpan * 0.15)) {
        continue;
      }

      const [visibleSStartCm, visibleSEndCm] = pickWidestInterval(visibleIntervals, sStart, sEnd);

      furniture.push({
        elementId: el.id,
        kind: el.kind,
        name: el.name,
        sStartCm: sStart,
        sEndCm: sEnd,
        visibleSStartCm,
        visibleSEndCm,
        elevationCm: Math.max(0, el.elevationCm),
        heightCm: Math.min(ceilingHeightCm, Math.max(4, el.heightCm)),
        depthCm: frontDepth,
        ...(el.color ? { color: el.color } : {}),
        ...(el.cabinetSpec ? { cabinetSpec: el.cabinetSpec } : {}),
      });
    }
  }

  openings.sort((a, b) => b.depthCm - a.depthCm);
  furniture.sort((a, b) => b.depthCm - a.depthCm);

  return {
    sectionLine,
    cutLengthCm,
    ceilingHeightCm,
    sMinCm,
    sMaxCm,
    walls,
    openings,
    furniture,
  };
}

/**
 * Combine walls, openings, and furniture into a unified back-to-front painter's render list
 * so nearer partition walls naturally occlude background walls, windows, and furniture.
 */
export function buildElevationRenderItems(elevation: SolvedElevation): ElevationRenderItem[] {
  const wallDepthMap = new Map<string, number>();
  elevation.walls.forEach((w) => {
    wallDepthMap.set(w.wallId, w.depthCm);
  });

  const items: ElevationRenderItem[] = [];
  elevation.walls.forEach((wall, wallIndex) => {
    items.push({
      kind: 'wall',
      renderDepthCm: wall.depthCm,
      priority: 0,
      wall,
      wallIndex,
    });
  });

  elevation.openings.forEach((opening, openingIndex) => {
    const hostDepth = opening.hostWallId ? wallDepthMap.get(opening.hostWallId) : undefined;
    const renderDepthCm =
      hostDepth !== undefined ? Math.min(opening.depthCm, hostDepth) : opening.depthCm;
    items.push({
      kind: 'opening',
      renderDepthCm,
      priority: 1,
      opening,
      openingIndex,
    });
  });

  elevation.furniture.forEach((furniture) => {
    items.push({
      kind: 'furniture',
      renderDepthCm: furniture.depthCm,
      priority: 2,
      furniture,
    });
  });

  items.sort((a, b) => {
    const depthDiff = b.renderDepthCm - a.renderDepthCm;
    if (Math.abs(depthDiff) > 0.25) return depthDiff;
    return a.priority - b.priority;
  });

  return items;
}

export const DEFAULT_FLOORPLAN_LAYERS: ReadonlyArray<FloorplanLayer> = [
  { id: 'layer-opening', name: '門窗圖層', visible: true },
  { id: 'layer-furniture', name: '家具圖層', visible: true },
  { id: 'layer-storage', name: '廚具櫃體圖層', visible: true },
  { id: 'layer-bathroom', name: '衛浴設備圖層', visible: true },
  { id: 'layer-medical', name: '病房設施圖層', visible: true },
  { id: 'layer-lighting', name: '燈具照明圖層', visible: true },
];

export function getEffectiveLayers(layers?: ReadonlyArray<FloorplanLayer>): FloorplanLayer[] {
  if (Array.isArray(layers) && layers.length > 0) {
    return layers.map((layer, idx) => ({
      id: layer.id || `layer-${idx + 1}`,
      name: layer.name || `圖層 ${idx + 1}`,
      visible: layer.visible !== false,
      ...(sanitizeHexColor(layer.color) ? { color: sanitizeHexColor(layer.color) } : {}),
    }));
  }
  return DEFAULT_FLOORPLAN_LAYERS.map((l) => ({ ...l }));
}

export function getDefaultLayerIdForKind(
  kind: ElementKind,
  layers: ReadonlyArray<FloorplanLayer>
): string {
  const category = ELEMENT_KIND_DEFAULTS[kind]?.category ?? 'furniture';
  const expectedId = `layer-${category}`;
  if (layers.some((l) => l.id === expectedId)) {
    return expectedId;
  }
  return layers[0]?.id ?? expectedId;
}

export function resolveElementLayer(
  element: Pick<FloorplanElement, 'kind' | 'layerId'>,
  layers?: ReadonlyArray<FloorplanLayer>
): FloorplanLayer | undefined {
  const effective = getEffectiveLayers(layers);
  if (element.layerId) {
    const matched = effective.find((l) => l.id === element.layerId);
    if (matched) return matched;
  }
  const fallbackId = getDefaultLayerIdForKind(element.kind, effective);
  return effective.find((l) => l.id === fallbackId) ?? effective[0];
}

export function isElementVisibleInLayers(
  element: Pick<FloorplanElement, 'kind' | 'layerId'>,
  layers?: ReadonlyArray<FloorplanLayer>
): boolean {
  const layer = resolveElementLayer(element, layers);
  return layer ? layer.visible !== false : true;
}

export function resolveElementEffectiveColor(
  element: Pick<FloorplanElement, 'kind' | 'layerId' | 'color'>,
  layers?: ReadonlyArray<FloorplanLayer>
): string | undefined {
  const itemColor = sanitizeHexColor(element.color);
  if (itemColor) return itemColor;
  const layer = resolveElementLayer(element, layers);
  return layer ? sanitizeHexColor(layer.color) : undefined;
}

export function applyLayersToPlacements(
  placements: SolvedElementPlacement[],
  layers?: ReadonlyArray<FloorplanLayer>
): SolvedElementPlacement[] {
  const effectiveLayers = getEffectiveLayers(layers);
  const out: SolvedElementPlacement[] = [];
  for (const pl of placements) {
    if (!isElementVisibleInLayers(pl.element, effectiveLayers)) continue;
    const effectiveColor = resolveElementEffectiveColor(pl.element, effectiveLayers);
    out.push({
      ...pl,
      element:
        effectiveColor !== pl.element.color
          ? { ...pl.element, color: effectiveColor }
          : pl.element,
    });
  }
  return out;
}





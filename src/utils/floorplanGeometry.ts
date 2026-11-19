import type {
  ClosureSuggestion,
  DoorSwing,
  ElementKind,
  ElementPlacementMode,
  ElementWallClearanceRay,
  ElementWallClearancesResult,
  ElevationFurnitureItem,
  ElevationOpeningItem,
  ElevationWallItem,
  FloorplanElement,
  FloorplanProject,
  Point2D,
  SectionLine,
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

export const ELEMENT_KIND_DEFAULTS: Record<
  ElementKind,
  {
    label: string;
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
    defaultPlacement: 'wall',
    widthCm: 90,
    depthCm: 12,
    heightCm: 210,
    elevationCm: 0,
  },
  cabinet: {
    label: '新櫃體',
    defaultPlacement: 'wall',
    widthCm: 100,
    depthCm: 60,
    heightCm: 210,
    elevationCm: 0,
  },
  window: {
    label: '新窗戶',
    defaultPlacement: 'wall',
    widthCm: 140,
    depthCm: 12,
    heightCm: 130,
    elevationCm: 90,
  },
  table: {
    label: '書桌／餐桌',
    defaultPlacement: 'free',
    widthCm: 120,
    depthCm: 60,
    heightCm: 75,
    elevationCm: 0,
  },
  chair: {
    label: '座椅',
    defaultPlacement: 'free',
    widthCm: 48,
    depthCm: 48,
    heightCm: 85,
    elevationCm: 0,
  },
  bed: {
    label: '病床',
    defaultPlacement: 'free',
    widthCm: 100,
    depthCm: 215,
    heightCm: 60,
    elevationCm: 0,
    showClearance: true,
  },
};

export function normalizeAngleDeg(deg: number): number {
  const mod = ((deg % 360) + 360) % 360;
  return Math.abs(mod - 360) < 1e-9 ? 0 : mod;
}

export function rotateElementAngle(currentDeg: number | undefined, deltaDeg: number): number {
  return Math.round(normalizeAngleDeg((currentDeg ?? 0) + deltaDeg) * 10) / 10;
}

export function flipDoorSwing(
  swing: DoorSwing | undefined,
  axis: 'hinge' | 'side'
): DoorSwing {
  const current = swing || 'inward-right';
  const [inOut, leftRight] = current.split('-') as ['inward' | 'outward', 'left' | 'right'];
  if (axis === 'hinge') {
    return `${inOut}-${leftRight === 'right' ? 'left' : 'right'}` as DoorSwing;
  }
  return `${inOut === 'inward' ? 'outward' : 'inward'}-${leftRight}` as DoorSwing;
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
    const isProjectedBody =
      el.kind === 'cabinet' || el.kind === 'table' || el.kind === 'chair' || el.kind === 'bed';
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
      viewDirection: -1,
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
    viewDirection: 1,
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

/**
 * Project walls, doors, windows, and furniture in front of a section cut line
 * into an architectural elevation drawing.
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

    let segSMin = Math.min(clipped[0].s, clipped[1].s);
    let segSMax = Math.max(clipped[0].s, clipped[1].s);
    const span = segSMax - segSMin;
    if (span < 2 && !isCutThrough) continue;
    if (isCutThrough && span < wallThick) {
      const midS = (segSMin + segSMax) * 0.5;
      segSMin = midS - wallThick * 0.5;
      segSMax = midS + wallThick * 0.5;
    }

    const avgDepth = (clipped[0].d + clipped[1].d) * 0.5;
    walls.push({
      wallId: seg.id,
      label: seg.label,
      isInterior: seg.isInterior,
      isCutThrough,
      sStartCm: segSMin,
      sEndCm: segSMax,
      depthCm: avgDepth,
      heightCm: ceilingHeightCm,
    });
  }

  // Sort walls back-to-front so closer walls naturally sit over farther walls
  walls.sort((x, y) => y.depthCm - x.depthCm);

  const openings: ElevationOpeningItem[] = [];
  const furniture: ElevationFurnitureItem[] = [];

  for (const pl of placements) {
    const el = pl.element;
    if (el.kind === 'door' || el.kind === 'window') {
      const pA = projectPt(pl.startPoint);
      const pB = projectPt(pl.endPoint);
      const midDepth = (pA.d + pB.d) * 0.5;
      // Only show openings that are in front of the cut line and face broadly toward viewer
      if (Math.max(pA.d, pB.d) < -wallThick * 0.5) continue;

      const opMin = Math.max(sMinCm - 2, Math.min(pA.s, pB.s));
      const opMax = Math.min(sMaxCm + 2, Math.max(pA.s, pB.s));
      const projW = opMax - opMin;
      if (projW < 6) continue;

      openings.push({
        elementId: el.id,
        kind: el.kind,
        name: el.name,
        sStartCm: opMin,
        sEndCm: opMax,
        projectedWidthCm: projW,
        actualWidthCm: pl.clampedWidthCm,
        elevationCm: Math.max(0, el.elevationCm),
        heightCm: Math.min(ceilingHeightCm - Math.max(0, el.elevationCm), Math.max(10, el.heightCm)),
        depthCm: midDepth,
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
      if (sEnd - sStart < 4) continue;

      furniture.push({
        elementId: el.id,
        kind: el.kind,
        name: el.name,
        sStartCm: sStart,
        sEndCm: sEnd,
        elevationCm: Math.max(0, el.elevationCm),
        heightCm: Math.min(ceilingHeightCm, Math.max(10, el.heightCm)),
        depthCm: Math.max(0, dMin),
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



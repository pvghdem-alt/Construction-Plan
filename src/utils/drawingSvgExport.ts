import type {
  FloorplanProject,
  Point2D,
  SectionLine,
  SolvedElementPlacement,
  SolvedElevation,
  SolvedFloorplan,
} from '../types/floorplan';
import {
  computeElementWallClearances,
  computeSectionElevation,
  formatDimension,
  getSectionBasis,
} from './floorplanGeometry';

function escXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Generate a standalone architectural SVG string for the 2D floorplan
 * (including walls, interior partitions, doors, windows, furniture, optional 4-side wall clearances, and section lines).
 */
export function buildFloorplan2DSvgString(
  project: FloorplanProject,
  solved: SolvedFloorplan,
  placements: SolvedElementPlacement[]
): string {
  const { minX, minY, widthCm, heightCm, centerX, centerY } = solved.bounds;
  const maxDim = Math.max(widthCm, heightCm, 200);
  const margin = Math.max(115, maxDim * 0.25);
  const vbX = minX - margin;
  const vbY = minY - margin;
  const vbW = widthCm + margin * 2;
  const vbH = heightCm + margin * 2;
  const s = maxDim / 750;
  const wallStroke = Math.max(6, project.wallThicknessCm);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="1800" height="1280" style="font-family:'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif;">`
  );
  parts.push(`<rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="#ffffff" />`);

  // Room fill
  if (solved.polygonPoints.length >= 3) {
    const pts = solved.polygonPoints.map((p) => `${p.x},${p.y}`).join(' ');
    parts.push(`<polygon points="${pts}" fill="#f8fafc" stroke="none" />`);
  }

  // Outer walls
  for (const se of solved.solvedEdges) {
    if (se.hasWall) {
      parts.push(
        `<line x1="${se.start.x}" y1="${se.start.y}" x2="${se.end.x}" y2="${se.end.y}" stroke="#1e293b" stroke-width="${wallStroke}" stroke-linecap="square" />`
      );
      parts.push(
        `<line x1="${se.start.x}" y1="${se.start.y}" x2="${se.end.x}" y2="${se.end.y}" stroke="#cbd5e1" stroke-width="${Math.max(2, wallStroke - 4)}" stroke-linecap="square" />`
      );
    } else {
      parts.push(
        `<line x1="${se.start.x}" y1="${se.start.y}" x2="${se.end.x}" y2="${se.end.y}" stroke="#94a3b8" stroke-width="${2 * s}" stroke-dasharray="${8 * s} ${6 * s}" />`
      );
    }
  }

  // Interior walls
  const innerStroke = Math.max(5, wallStroke * 0.85);
  for (const iw of solved.solvedInteriorWalls) {
    if (iw.hasWall) {
      parts.push(
        `<line x1="${iw.start.x}" y1="${iw.start.y}" x2="${iw.end.x}" y2="${iw.end.y}" stroke="#334155" stroke-width="${innerStroke}" stroke-linecap="square" />`
      );
      parts.push(
        `<line x1="${iw.start.x}" y1="${iw.start.y}" x2="${iw.end.x}" y2="${iw.end.y}" stroke="#e2e8f0" stroke-width="${Math.max(2, innerStroke - 4)}" stroke-linecap="square" />`
      );
    } else {
      parts.push(
        `<line x1="${iw.start.x}" y1="${iw.start.y}" x2="${iw.end.x}" y2="${iw.end.y}" stroke="#94a3b8" stroke-width="${2 * s}" stroke-dasharray="${6 * s} ${4 * s}" />`
      );
    }
  }

  // Elements
  for (const pl of placements) {
    const { element, startPoint, endPoint, center, boxCenter, tangent, facingNormal } = pl;
    const rectPts = (cx: number, cy: number, halfW: number, halfD: number) =>
      [
        { x: cx - tangent.x * halfW - facingNormal.x * halfD, y: cy - tangent.y * halfW - facingNormal.y * halfD },
        { x: cx + tangent.x * halfW - facingNormal.x * halfD, y: cy + tangent.y * halfW - facingNormal.y * halfD },
        { x: cx + tangent.x * halfW + facingNormal.x * halfD, y: cy + tangent.y * halfW + facingNormal.y * halfD },
        { x: cx - tangent.x * halfW + facingNormal.x * halfD, y: cy - tangent.y * halfW + facingNormal.y * halfD },
      ]
        .map((p) => `${p.x},${p.y}`)
        .join(' ');

    if (element.kind === 'cabinet' || element.kind === 'table' || element.kind === 'chair' || element.kind === 'bed') {
      const halfW = pl.clampedWidthCm * 0.5;
      const halfD = element.depthCm * 0.5;
      const fillMap: Record<string, string> = {
        cabinet: '#fef3c7',
        table: '#fef9c3',
        chair: '#f1f5f9',
        bed: '#ffffff',
      };
      const strokeMap: Record<string, string> = {
        cabinet: '#b45309',
        table: '#a16207',
        chair: '#475569',
        bed: '#0f766e',
      };
      parts.push(
        `<polygon points="${rectPts(boxCenter.x, boxCenter.y, halfW, halfD)}" fill="${fillMap[element.kind]}" stroke="${strokeMap[element.kind]}" stroke-width="${1.8 * s}" />`
      );
      parts.push(
        `<text x="${boxCenter.x}" y="${boxCenter.y}" text-anchor="middle" dominant-baseline="central" fill="#0f172a" font-size="${9.5 * s}" font-weight="600">${escXml(element.name)}</text>`
      );
    } else if (element.kind === 'window' && pl.edge) {
      const offsetSide = wallStroke * 0.3;
      parts.push(
        `<line x1="${startPoint.x}" y1="${startPoint.y}" x2="${endPoint.x}" y2="${endPoint.y}" stroke="#ffffff" stroke-width="${wallStroke + 2}" />`
      );
      parts.push(
        `<line x1="${startPoint.x + pl.edge.outwardNormal.x * offsetSide}" y1="${startPoint.y + pl.edge.outwardNormal.y * offsetSide}" x2="${endPoint.x + pl.edge.outwardNormal.x * offsetSide}" y2="${endPoint.y + pl.edge.outwardNormal.y * offsetSide}" stroke="#0284c7" stroke-width="${2 * s}" />`
      );
      parts.push(
        `<line x1="${startPoint.x - pl.edge.outwardNormal.x * offsetSide}" y1="${startPoint.y - pl.edge.outwardNormal.y * offsetSide}" x2="${endPoint.x - pl.edge.outwardNormal.x * offsetSide}" y2="${endPoint.y - pl.edge.outwardNormal.y * offsetSide}" stroke="#0284c7" stroke-width="${2 * s}" />`
      );
      parts.push(
        `<line x1="${startPoint.x}" y1="${startPoint.y}" x2="${endPoint.x}" y2="${endPoint.y}" stroke="#38bdf8" stroke-width="${3.2 * s}" />`
      );
      parts.push(
        `<text x="${center.x + pl.edge.inwardNormal.x * 18 * s}" y="${center.y + pl.edge.inwardNormal.y * 18 * s}" text-anchor="middle" dominant-baseline="central" fill="#0369a1" font-size="${9 * s}" font-weight="600">${escXml(element.name)} (${formatDimension(pl.clampedWidthCm, project.unit, false)})</text>`
      );
    } else if (element.kind === 'door' && pl.edge) {
      const swing = element.swingDirection || 'inward-right';
      const isOutward = swing.startsWith('outward');
      const isHingeEnd = swing.endsWith('right');
      const swingNormal = isOutward ? pl.outwardNormal : pl.inwardNormal;
      const hinge = isHingeEnd ? endPoint : startPoint;
      const latch = isHingeEnd ? startPoint : endPoint;
      const leafTip: Point2D = {
        x: hinge.x + swingNormal.x * pl.clampedWidthCm,
        y: hinge.y + swingNormal.y * pl.clampedWidthCm,
      };
      const cross = (latch.x - hinge.x) * (leafTip.y - hinge.y) - (latch.y - hinge.y) * (leafTip.x - hinge.x);
      const sweepFlag = cross >= 0 ? 1 : 0;

      parts.push(
        `<line x1="${startPoint.x}" y1="${startPoint.y}" x2="${endPoint.x}" y2="${endPoint.y}" stroke="#f8fafc" stroke-width="${wallStroke + 2}" />`
      );
      parts.push(
        `<line x1="${hinge.x}" y1="${hinge.y}" x2="${leafTip.x}" y2="${leafTip.y}" stroke="#0f172a" stroke-width="${3.2 * s}" stroke-linecap="round" />`
      );
      parts.push(
        `<path d="M ${latch.x} ${latch.y} A ${pl.clampedWidthCm} ${pl.clampedWidthCm} 0 0 ${sweepFlag} ${leafTip.x} ${leafTip.y}" fill="rgba(37,99,235,0.06)" stroke="#2563eb" stroke-width="${1.4 * s}" stroke-dasharray="${5 * s} ${4 * s}" />`
      );
      parts.push(
        `<text x="${center.x + swingNormal.x * Math.min(44 * s, pl.clampedWidthCm * 0.45)}" y="${center.y + swingNormal.y * Math.min(44 * s, pl.clampedWidthCm * 0.45)}" text-anchor="middle" dominant-baseline="central" fill="#1e40af" font-size="${9.5 * s}" font-weight="600">${escXml(element.name)}</text>`
      );
    }

    // 4-side wall clearance rays if enabled on element
    if (element.showWallDistances) {
      const clearances = computeElementWallClearances(pl, solved, project.wallThicknessCm);
      for (const ray of clearances.rays) {
        if (ray.distanceCm < 1) continue;
        parts.push(
          `<line x1="${ray.start.x}" y1="${ray.start.y}" x2="${ray.end.x}" y2="${ray.end.y}" stroke="#0d9488" stroke-width="${1.5 * s}" stroke-dasharray="${5 * s} ${3 * s}" />`
        );
        const mx = (ray.start.x + ray.end.x) * 0.5;
        const my = (ray.start.y + ray.end.y) * 0.5;
        const distTxt = formatDimension(ray.distanceCm, project.unit);
        const boxW = Math.max(46, distTxt.length * 6.8 + 10) * s;
        parts.push(
          `<rect x="${mx - boxW * 0.5}" y="${my - 7.5 * s}" width="${boxW}" height="${15 * s}" rx="${3 * s}" fill="#f0fdfa" stroke="#0d9488" stroke-width="${1 * s}" />`
        );
        parts.push(
          `<text x="${mx}" y="${my}" text-anchor="middle" dominant-baseline="central" fill="#0f766e" font-size="${9 * s}" font-weight="700">${escXml(distTxt)}</text>`
        );
      }
    }
  }

  // Wall length dimension labels
  for (const se of [...solved.solvedEdges, ...solved.solvedInteriorWalls]) {
    const offset = se.isInterior ? 22 * s : 36 * s;
    const dimOff = offset - 9 * s;
    const ds = { x: se.start.x + se.outwardNormal.x * dimOff, y: se.start.y + se.outwardNormal.y * dimOff };
    const de = { x: se.end.x + se.outwardNormal.x * dimOff, y: se.end.y + se.outwardNormal.y * dimOff };
    const tp = { x: se.midpoint.x + se.outwardNormal.x * offset, y: se.midpoint.y + se.outwardNormal.y * offset };
    let ang = se.effectiveAngleDeg;
    if (ang > 90 && ang < 270) ang -= 180;
    const text = `${se.label.split(' ')[0]} · ${formatDimension(se.lengthCm, project.unit)}`;
    parts.push(
      `<line x1="${ds.x}" y1="${ds.y}" x2="${de.x}" y2="${de.y}" stroke="#64748b" stroke-width="${1.1 * s}" />`
    );
    parts.push(
      `<g transform="translate(${tp.x},${tp.y}) rotate(${ang})"><rect x="${(-text.length * 3.6 - 5) * s}" y="${-7.5 * s}" width="${(text.length * 7.2 + 10) * s}" height="${15 * s}" rx="${3 * s}" fill="rgba(255,255,255,0.92)" /><text x="0" y="0" text-anchor="middle" dominant-baseline="central" fill="#0f172a" font-size="${10 * s}" font-weight="600">${escXml(text)}</text></g>`
    );
  }

  // Section lines overlay
  for (const sec of project.sectionLines ?? []) {
    const { lookDir } = getSectionBasis(sec);
    const arrowLen = 28 * s;
    const tag = sec.label.split('-')[0] || 'A';
    parts.push(
      `<line x1="${sec.startXCm}" y1="${sec.startYCm}" x2="${sec.endXCm}" y2="${sec.endYCm}" stroke="#dc2626" stroke-width="${2.2 * s}" stroke-dasharray="${12 * s} ${4 * s} ${3 * s} ${4 * s}" />`
    );
    for (const ep of [
      { x: sec.startXCm, y: sec.startYCm, t: tag },
      { x: sec.endXCm, y: sec.endYCm, t: `${tag}'` },
    ]) {
      const tipX = ep.x + lookDir.x * arrowLen;
      const tipY = ep.y + lookDir.y * arrowLen;
      parts.push(
        `<line x1="${ep.x}" y1="${ep.y}" x2="${tipX}" y2="${tipY}" stroke="#dc2626" stroke-width="${2.4 * s}" />`
      );
      parts.push(
        `<circle cx="${ep.x}" cy="${ep.y}" r="${11 * s}" fill="#dc2626" /><text x="${ep.x}" y="${ep.y}" text-anchor="middle" dominant-baseline="central" fill="#ffffff" font-size="${9.5 * s}" font-weight="700">${escXml(ep.t)}</text>`
      );
    }
  }

  // Room summary
  if (solved.polygonPoints.length >= 3) {
    parts.push(
      `<text x="${centerX}" y="${centerY - 8 * s}" text-anchor="middle" fill="#475569" font-size="${12.5 * s}" font-weight="600">${solved.areaSqMeters.toFixed(2)} m² · ${solved.areaPing.toFixed(2)} 坪</text>`
    );
    parts.push(
      `<text x="${centerX}" y="${centerY + 10 * s}" text-anchor="middle" fill="#64748b" font-size="${10 * s}">天花高度 ${escXml(formatDimension(project.ceilingHeightCm, project.unit))}</text>`
    );
  }

  parts.push('</svg>');
  return parts.join('');
}

/**
 * Generate a standalone architectural SVG string for an Elevation view generated from a SectionLine,
 * including complete width, height, and sill elevation dimensions for all visible doors & windows.
 */
export function buildElevationSvgString(
  project: FloorplanProject,
  solved: SolvedFloorplan,
  placements: SolvedElementPlacement[],
  sectionLine: SectionLine,
  precomputed?: SolvedElevation
): string {
  const elev = precomputed ?? computeSectionElevation(project, solved, placements, sectionLine);
  const span = Math.max(200, elev.sMaxCm - elev.sMinCm);
  const ceilH = Math.max(120, elev.ceilingHeightCm);
  const padLeft = Math.max(95, span * 0.16);
  const padRight = Math.max(95, span * 0.16);
  const padTop = Math.max(70, ceilH * 0.24);
  const padBottom = Math.max(75, ceilH * 0.26);

  const vbX = elev.sMinCm - padLeft;
  const vbY = -ceilH - padTop;
  const vbW = span + padLeft + padRight;
  const vbH = ceilH + padTop + padBottom;
  const s = Math.max(span, ceilH) / 720;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="1800" height="1180" style="font-family:'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif;">`
  );
  parts.push(`<rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="#ffffff" />`);

  // Ceiling datum dashed line
  parts.push(
    `<line x1="${elev.sMinCm - 24 * s}" y1="${-ceilH}" x2="${elev.sMaxCm + 24 * s}" y2="${-ceilH}" stroke="#94a3b8" stroke-width="${1.2 * s}" stroke-dasharray="${6 * s} ${4 * s}" />`
  );

  // Wall elevations (back to front)
  for (const w of elev.walls) {
    const ww = Math.max(4, w.sEndCm - w.sStartCm);
    const fill = w.isCutThrough ? '#cbd5e1' : w.isInterior ? '#f8fafc' : '#f1f5f9';
    const stroke = w.isCutThrough ? '#0f172a' : '#475569';
    const sw = (w.isCutThrough ? 2.4 : 1.6) * s;
    parts.push(
      `<rect x="${w.sStartCm}" y="${-w.heightCm}" width="${ww}" height="${w.heightCm}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
    );
  }

  // Furniture silhouettes
  for (const f of elev.furniture) {
    const fw = Math.max(4, f.sEndCm - f.sStartCm);
    const yTop = -(f.elevationCm + f.heightCm);
    const fill =
      f.kind === 'cabinet'
        ? '#fef3c7'
        : f.kind === 'bed'
          ? '#ccfbf1'
          : f.kind === 'table'
            ? '#fef9c3'
            : '#e2e8f0';
    const stroke =
      f.kind === 'cabinet'
        ? '#b45309'
        : f.kind === 'bed'
          ? '#0f766e'
          : f.kind === 'table'
            ? '#a16207'
            : '#475569';
    parts.push(
      `<rect x="${f.sStartCm}" y="${yTop}" width="${fw}" height="${f.heightCm}" fill="${fill}" fill-opacity="0.88" stroke="${stroke}" stroke-width="${1.4 * s}" />`
    );
    parts.push(
      `<text x="${(f.sStartCm + f.sEndCm) * 0.5}" y="${yTop + f.heightCm * 0.5}" text-anchor="middle" dominant-baseline="central" fill="#334155" font-size="${8.5 * s}" font-weight="600">${escXml(f.name)}</text>`
    );
  }

  // Doors & Windows with architectural details and dimension callouts
  elev.openings.forEach((op, idx) => {
    const ow = Math.max(6, op.sEndCm - op.sStartCm);
    const yTop = -(op.elevationCm + op.heightCm);
    const midX = (op.sStartCm + op.sEndCm) * 0.5;
    const midY = yTop + op.heightCm * 0.5;

    if (op.kind === 'window') {
      parts.push(
        `<rect x="${op.sStartCm}" y="${yTop}" width="${ow}" height="${op.heightCm}" fill="#e0f2fe" stroke="#0284c7" stroke-width="${2.2 * s}" />`
      );
      const inset = Math.min(ow, op.heightCm) * 0.08;
      parts.push(
        `<rect x="${op.sStartCm + inset}" y="${yTop + inset}" width="${Math.max(2, ow - inset * 2)}" height="${Math.max(2, op.heightCm - inset * 2)}" fill="#bae6fd" fill-opacity="0.6" stroke="#0369a1" stroke-width="${1.1 * s}" />`
      );
      parts.push(
        `<line x1="${midX}" y1="${yTop + inset}" x2="${midX}" y2="${yTop + op.heightCm - inset}" stroke="#0369a1" stroke-width="${1.2 * s}" />`
      );
    } else {
      parts.push(
        `<rect x="${op.sStartCm}" y="${yTop}" width="${ow}" height="${op.heightCm}" fill="#fef3c7" stroke="#78350f" stroke-width="${2.4 * s}" />`
      );
      const inset = Math.min(ow * 0.12, 8 * s);
      parts.push(
        `<rect x="${op.sStartCm + inset}" y="${yTop + inset}" width="${Math.max(2, ow - inset * 2)}" height="${Math.max(2, op.heightCm - inset)}" fill="#fde68a" fill-opacity="0.45" stroke="#92400e" stroke-width="${1.2 * s}" />`
      );
      // Handle dot
      parts.push(
        `<circle cx="${op.sEndCm - inset * 1.8}" cy="${yTop + op.heightCm * 0.52}" r="${2.6 * s}" fill="#451a03" />`
      );
    }

    // Opening title inside frame
    parts.push(
      `<text x="${midX}" y="${midY - 7 * s}" text-anchor="middle" dominant-baseline="central" fill="#0f172a" font-size="${9.5 * s}" font-weight="700">${escXml(op.name)}</text>`
    );

    // Width dimension line above opening (staggered lanes to avoid overlap)
    const dimY = yTop - (16 + (idx % 2) * 18) * s;
    const wText = `寬 ${formatDimension(op.actualWidthCm, project.unit)}`;
    parts.push(
      `<line x1="${op.sStartCm}" y1="${yTop - 3 * s}" x2="${op.sStartCm}" y2="${dimY - 4 * s}" stroke="#64748b" stroke-width="${0.9 * s}" />`
    );
    parts.push(
      `<line x1="${op.sEndCm}" y1="${yTop - 3 * s}" x2="${op.sEndCm}" y2="${dimY - 4 * s}" stroke="#64748b" stroke-width="${0.9 * s}" />`
    );
    parts.push(
      `<line x1="${op.sStartCm}" y1="${dimY}" x2="${op.sEndCm}" y2="${dimY}" stroke="#2563eb" stroke-width="${1.2 * s}" />`
    );
    const wBoxW = Math.max(48, wText.length * 6.8 + 10) * s;
    parts.push(
      `<rect x="${midX - wBoxW * 0.5}" y="${dimY - 7 * s}" width="${wBoxW}" height="${14 * s}" rx="${3 * s}" fill="#eff6ff" stroke="#93c5fd" stroke-width="${0.9 * s}" />`
    );
    parts.push(
      `<text x="${midX}" y="${dimY}" text-anchor="middle" dominant-baseline="central" fill="#1d4ed8" font-size="${8.8 * s}" font-weight="700">${escXml(wText)}</text>`
    );

    // Vertical height & sill callout on opening center/right
    const hText = `高 ${formatDimension(op.heightCm, project.unit)}`;
    parts.push(
      `<text x="${midX}" y="${midY + 8 * s}" text-anchor="middle" dominant-baseline="central" fill="#0369a1" font-size="${8.8 * s}" font-weight="700">${escXml(hText)}</text>`
    );
    if (op.elevationCm > 0) {
      const sillText = `台高 ${formatDimension(op.elevationCm, project.unit)}`;
      parts.push(
        `<line x1="${midX}" y1="0" x2="${midX}" y2="${-op.elevationCm}" stroke="#0284c7" stroke-width="${1.1 * s}" stroke-dasharray="${3 * s} ${2 * s}" />`
      );
      parts.push(
        `<text x="${midX}" y="${-op.elevationCm * 0.5}" text-anchor="middle" dominant-baseline="central" fill="#0369a1" font-size="${8.5 * s}" font-weight="600">${escXml(sillText)}</text>`
      );
    }
  });

  // Floor baseline (FL ±0)
  parts.push(
    `<line x1="${elev.sMinCm - 32 * s}" y1="0" x2="${elev.sMaxCm + 32 * s}" y2="0" stroke="#0f172a" stroke-width="${2.6 * s}" />`
  );
  parts.push(
    `<text x="${elev.sMaxCm + 36 * s}" y="0" dominant-baseline="central" fill="#475569" font-size="${9.5 * s}" font-weight="600">FL ±0</text>`
  );
  parts.push(
    `<text x="${elev.sMaxCm + 36 * s}" y="${-ceilH}" dominant-baseline="central" fill="#475569" font-size="${9.5 * s}" font-weight="600">CL +${escXml(formatDimension(ceilH, project.unit))}</text>`
  );

  // Left ceiling height ruler
  const rulerX = elev.sMinCm - 38 * s;
  parts.push(
    `<line x1="${rulerX}" y1="0" x2="${rulerX}" y2="${-ceilH}" stroke="#0f766e" stroke-width="${1.4 * s}" />`
  );
  parts.push(
    `<line x1="${rulerX - 5 * s}" y1="0" x2="${rulerX + 5 * s}" y2="0" stroke="#0f766e" stroke-width="${1.4 * s}" />`
  );
  parts.push(
    `<line x1="${rulerX - 5 * s}" y1="${-ceilH}" x2="${rulerX + 5 * s}" y2="${-ceilH}" stroke="#0f766e" stroke-width="${1.4 * s}" />`
  );
  parts.push(
    `<text x="${rulerX - 8 * s}" y="${-ceilH * 0.5}" text-anchor="end" dominant-baseline="central" fill="#0f766e" font-size="${9.5 * s}" font-weight="700">天花板 ${escXml(formatDimension(ceilH, project.unit))}</text>`
  );

  // Bottom cut span dimension
  const spanY = 26 * s;
  parts.push(
    `<line x1="${elev.sMinCm}" y1="4" x2="${elev.sMinCm}" y2="${spanY + 6 * s}" stroke="#94a3b8" stroke-width="${1 * s}" />`
  );
  parts.push(
    `<line x1="${elev.sMaxCm}" y1="4" x2="${elev.sMaxCm}" y2="${spanY + 6 * s}" stroke="#94a3b8" stroke-width="${1 * s}" />`
  );
  parts.push(
    `<line x1="${elev.sMinCm}" y1="${spanY}" x2="${elev.sMaxCm}" y2="${spanY}" stroke="#475569" stroke-width="${1.3 * s}" />`
  );
  parts.push(
    `<text x="${(elev.sMinCm + elev.sMaxCm) * 0.5}" y="${spanY + 16 * s}" text-anchor="middle" dominant-baseline="central" fill="#0f172a" font-size="${10 * s}" font-weight="600">剖面 ${escXml(sectionLine.label)} 總寬度 ${escXml(formatDimension(span, project.unit))}</text>`
  );

  parts.push('</svg>');
  return parts.join('');
}

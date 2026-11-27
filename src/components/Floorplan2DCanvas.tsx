import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  Maximize2,
  ZoomIn,
  ZoomOut,
  Grid3X3,
  Ruler,
  RotateCcw,
  RotateCw,
  ArrowLeftRight,
  SlidersHorizontal,
  Trash2,
  MoveHorizontal,
  Scissors,
  Copy,
  Eye,
  Magnet,
  Lightbulb,
} from 'lucide-react';
import { isLightingElementKind } from '../utils/firstPersonNavigation';
import { resolveCabinetSpecForElement } from '../utils/cabinetDesigner';
import type {
  FloorplanProject,
  Point2D,
  SectionLine,
  SnapGuideLine,
  SolvedFloorplan,
  SolvedElementPlacement,
  SolvedWallSegment,
} from '../types/floorplan';
import {
  computeElementWallClearances,
  computeMagneticSnapPosition,
  computeWallDragResult,
  darkenHexColor,
  DEFAULT_FLOOR_2D_COLOR,
  DEFAULT_INTERIOR_WALL_CORE_2D_COLOR,
  DEFAULT_WALL_CORE_2D_COLOR,
  formatDimension,
  getContrastTextColor,
  getDoorSwingLabel,
  getNextSectionLabel,
  getSectionBasis,
  normalizeAngleDeg,
  parseDoorSwing,
  rotateElementAngle,
  sanitizeHexColor,
} from '../utils/floorplanGeometry';

export interface Floorplan2DHandle {
  exportSvg: () => void;
  exportPng: () => void;
  fitToView: () => void;
}

interface Floorplan2DCanvasProps {
  project: FloorplanProject;
  solved: SolvedFloorplan;
  placements: SolvedElementPlacement[];
  selectedEdgeId: string | null;
  selectedElementId: string | null;
  selectedSectionId?: string | null;
  sectionDrawMode?: boolean;
  magneticSnapEnabled?: boolean;
  readOnly?: boolean;
  onSetSectionDrawMode?: (active: boolean) => void;
  onToggleMagneticSnap?: () => void;
  onSelectEdge: (edgeId: string | null) => void;
  onSelectElement: (elementId: string | null) => void;
  onSelectSection?: (sectionId: string | null) => void;
  onMoveElement?: (elementId: string, xCm: number, yCm: number) => void;
  onSlideWallElement?: (elementId: string, offsetCm: number) => void;
  onDetachWallElement?: (elementId: string, xCm: number, yCm: number, rotationDeg: number) => void;
  onRotateElement?: (elementId: string, rotationDeg: number) => void;
  onFlipDoor?: (elementId: string, axis: 'hinge' | 'side' | 'type') => void;
  onBeginElementInteraction?: () => void;
  onEndElementInteraction?: () => void;
  onDoubleClickElement?: (elementId: string) => void;
  onDeleteElement?: (elementId: string) => void;
  onToggleWallDistances?: (elementId: string) => void;
  onToggleLight?: (elementId: string) => void;
  onCopyElement?: (elementId: string) => void;
  onCreateSectionLine?: (section: SectionLine) => void;
  onUpdateSectionLine?: (sectionId: string, patch: Partial<SectionLine>) => void;
  onFlipSectionDirection?: (sectionId: string) => void;
  onDeleteSectionLine?: (sectionId: string) => void;
  onViewSectionElevation?: (sectionId: string) => void;
}

interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PlacedEdgeLabel {
  edge: SolvedWallSegment;
  normalDir: Point2D;
  dimStart: Point2D;
  dimEnd: Point2D;
  textPos: Point2D;
  angleDeg: number;
  text: string;
}

function boxesOverlap(a: LabelBox, b: LabelBox, padding = 4): boolean {
  return !(
    a.x + a.w + padding < b.x ||
    b.x + b.w + padding < a.x ||
    a.y + a.h + padding < b.y ||
    b.y + b.h + padding < a.y
  );
}

export const Floorplan2DCanvas = React.forwardRef<Floorplan2DHandle, Floorplan2DCanvasProps>(
  function Floorplan2DCanvas(
    {
      project,
      solved,
      placements,
      selectedEdgeId,
      selectedElementId,
      selectedSectionId = null,
      sectionDrawMode = false,
      magneticSnapEnabled,
      readOnly = false,
      onSetSectionDrawMode,
      onToggleMagneticSnap,
      onSelectEdge,
      onSelectElement,
      onSelectSection,
      onMoveElement,
      onSlideWallElement,
      onDetachWallElement,
      onRotateElement,
      onFlipDoor,
      onBeginElementInteraction,
      onEndElementInteraction,
      onDoubleClickElement,
      onDeleteElement,
      onToggleWallDistances,
      onToggleLight,
      onCopyElement,
      onCreateSectionLine,
      onUpdateSectionLine,
      onFlipSectionDirection,
      onDeleteSectionLine,
      onViewSectionElevation,
    },
    ref
  ) {
    const svgRef = useRef<SVGSVGElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);

    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState<Point2D>({ x: 0, y: 0 });
    const [showGrid, setShowGrid] = useState(true);
    const [showDimensions, setShowDimensions] = useState(true);
    const [internalSnapEnabled, setInternalSnapEnabled] = useState(true);
    const effectiveSnapEnabled = onToggleMagneticSnap
      ? (magneticSnapEnabled ?? true)
      : internalSnapEnabled;
    const handleToggleSnap = onToggleMagneticSnap ?? (() => setInternalSnapEnabled((v) => !v));
    const [snapGuides, setSnapGuides] = useState<SnapGuideLine[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [draftSection, setDraftSection] = useState<{
      startX: number;
      startY: number;
      endX: number;
      endY: number;
    } | null>(null);
    const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
    const panMovedRef = useRef(false);
    const suppressNextSvgClickRef = useRef(false);
    const draggingElRef = useRef<{
      id: string;
      startClientX: number;
      startClientY: number;
      origXCm: number;
      origYCm: number;
      mode: 'free' | 'wall';
      origOffsetCm: number;
      edgeTangent?: Point2D;
      edgeInward?: Point2D;
      facingNormal?: Point2D;
      edgeLenCm?: number;
      widthCm: number;
      depthCm: number;
      rotationDeg: number;
      isOpening: boolean;
    } | null>(null);
    const rotatingElRef = useRef<{
      id: string;
      boxCenter: Point2D;
      baseTangent: Point2D;
      baseNormal: Point2D;
    } | null>(null);
    const draggingSectionEndpointRef = useRef<{
      sectionId: string;
      endpoint: 'start' | 'end';
    } | null>(null);

    const fitToView = useCallback(() => {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }, []);

    // Compute world-space viewBox centered around the floorplan with generous margin for dimension callouts
    const viewMetrics = useMemo(() => {
      const { minX, minY, widthCm, heightCm, centerX, centerY } = solved.bounds;
      const maxDim = Math.max(widthCm, heightCm, 200);
      const margin = Math.max(110, maxDim * 0.24);
      const vbW = widthCm + margin * 2;
      const vbH = heightCm + margin * 2;
      const baseOriginX = minX - margin;
      const baseOriginY = minY - margin;

      const curW = vbW / zoom;
      const curH = vbH / zoom;
      const vbX = centerX - curW * 0.5 - pan.x;
      const vbY = centerY - curH * 0.5 - pan.y;

      // Adaptive typography & stroke scale so labels stay legible regardless of room size
      const unitScale = maxDim / 750;
      return {
        vbX,
        vbY,
        vbW: curW,
        vbH: curH,
        baseOriginX,
        baseOriginY,
        baseW: vbW,
        baseH: vbH,
        unitScale,
        maxDim,
      };
    }, [solved.bounds, zoom, pan]);

    // Smart non-overlapping dimension label placement along outward normals (outer + interior walls)
    const edgeLabels = useMemo<PlacedEdgeLabel[]>(() => {
      const s = viewMetrics.unitScale;
      const baseOffset = 34 * s;
      const stepOffset = 24 * s;
      const placedBoxes: LabelBox[] = [];
      const results: PlacedEdgeLabel[] = [];

      // Seed obstacle boxes from outer walls, interior walls & furniture placements
      for (const se of [...solved.solvedEdges, ...solved.solvedInteriorWalls]) {
        const minX = Math.min(se.start.x, se.end.x) - 6 * s;
        const minY = Math.min(se.start.y, se.end.y) - 6 * s;
        const maxX = Math.max(se.start.x, se.end.x) + 6 * s;
        const maxY = Math.max(se.start.y, se.end.y) + 6 * s;
        placedBoxes.push({
          x: minX,
          y: minY,
          w: Math.max(12 * s, maxX - minX),
          h: Math.max(12 * s, maxY - minY),
        });
      }

      for (const pl of placements) {
        if (pl.element.kind !== 'door' && pl.element.kind !== 'window') {
          const r = Math.max(pl.clampedWidthCm, pl.element.depthCm) * 0.52;
          placedBoxes.push({
            x: pl.boxCenter.x - r,
            y: pl.boxCenter.y - r,
            w: r * 2,
            h: r * 2,
          });
        } else if (pl.element.kind === 'door') {
          const parsedDoor = parseDoorSwing(pl.element.swingDirection);
          const swingNormal = parsedDoor.side === 'outward' ? pl.outwardNormal : pl.inwardNormal;
          if (parsedDoor.mode === 'sliding') {
            const trackOff = 24 * s;
            const cx = pl.center.x + swingNormal.x * trackOff;
            const cy = pl.center.y + swingNormal.y * trackOff;
            const r = pl.clampedWidthCm * 0.5;
            placedBoxes.push({
              x: cx - r,
              y: cy - 18 * s,
              w: r * 2,
              h: 36 * s,
            });
          } else {
            const arcCenterX = pl.center.x + swingNormal.x * (pl.clampedWidthCm * 0.5);
            const arcCenterY = pl.center.y + swingNormal.y * (pl.clampedWidthCm * 0.5);
            const r = pl.clampedWidthCm * 0.52;
            placedBoxes.push({
              x: arcCenterX - r,
              y: arcCenterY - r,
              w: r * 2,
              h: r * 2,
            });
          }
        }
      }

      const placeSegmentLabel = (se: SolvedWallSegment, isInterior: boolean) => {
        const text = `${se.label.split(' ')[0]} · ${formatDimension(
          se.lengthCm,
          project.unit
        )}`;
        const estWidth = Math.max(58, text.length * 7.2) * s;
        const estHeight = 18 * s;

        const candidateNormals: Array<{ dir: Point2D; offset: number }> = isInterior
          ? [
              { dir: se.outwardNormal, offset: 22 * s },
              { dir: se.inwardNormal, offset: 22 * s },
              { dir: se.outwardNormal, offset: 40 * s },
              { dir: se.inwardNormal, offset: 40 * s },
              { dir: se.outwardNormal, offset: 58 * s },
              { dir: se.inwardNormal, offset: 58 * s },
            ]
          : Array.from({ length: 6 }, (_, attempt) => ({
              dir: se.outwardNormal,
              offset: baseOffset + attempt * stepOffset,
            }));

        let chosenDir = se.outwardNormal;
        let chosenOffset = candidateNormals[0].offset;
        let chosenPos: Point2D = {
          x: se.midpoint.x + chosenDir.x * chosenOffset,
          y: se.midpoint.y + chosenDir.y * chosenOffset,
        };

        for (let idx = 0; idx < candidateNormals.length; idx++) {
          const cand = candidateNormals[idx];
          const pos: Point2D = {
            x: se.midpoint.x + cand.dir.x * cand.offset,
            y: se.midpoint.y + cand.dir.y * cand.offset,
          };
          const box: LabelBox = {
            x: pos.x - estWidth * 0.5,
            y: pos.y - estHeight * 0.5,
            w: estWidth,
            h: estHeight,
          };
          const collides = placedBoxes.some((b) => boxesOverlap(b, box, 4 * s));
          if (!collides || idx === candidateNormals.length - 1) {
            chosenDir = cand.dir;
            chosenOffset = cand.offset;
            chosenPos = pos;
            placedBoxes.push(box);
            break;
          }
        }

        const dimLineOffset = Math.max(14 * s, chosenOffset - 10 * s);
        const dimStart: Point2D = {
          x: se.start.x + chosenDir.x * dimLineOffset,
          y: se.start.y + chosenDir.y * dimLineOffset,
        };
        const dimEnd: Point2D = {
          x: se.end.x + chosenDir.x * dimLineOffset,
          y: se.end.y + chosenDir.y * dimLineOffset,
        };

        // Keep label upright (never upside down)
        let angle = se.effectiveAngleDeg;
        if (angle > 90 && angle < 270) {
          angle = angle - 180;
        }

        results.push({
          edge: se,
          normalDir: chosenDir,
          dimStart,
          dimEnd,
          textPos: chosenPos,
          angleDeg: angle,
          text,
        });
      };

      for (const se of solved.solvedEdges) {
        placeSegmentLabel(se, false);
      }
      for (const iw of solved.solvedInteriorWalls) {
        placeSegmentLabel(iw, true);
      }

      return results;
    }, [solved.solvedEdges, solved.solvedInteriorWalls, placements, project.unit, viewMetrics.unitScale]);

    const clientToWorldCm = useCallback((clientX: number, clientY: number): Point2D | null => {
      if (!svgRef.current) return null;
      const ctm = svgRef.current.getScreenCTM();
      if (!ctm) return null;
      const pt = svgRef.current.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const worldPt = pt.matrixTransform(ctm.inverse());
      return { x: worldPt.x, y: worldPt.y };
    }, []);

    const snapSectionEndpoint = useCallback(
      (startX: number, startY: number, rawX: number, rawY: number): Point2D => {
        const dx = rawX - startX;
        const dy = rawY - startY;
        const len = Math.hypot(dx, dy);
        if (len > 10) {
          const deg = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
          if (Math.abs(deg - 0) < 6 || Math.abs(deg - 360) < 6 || Math.abs(deg - 180) < 6) {
            return { x: Math.round(rawX), y: Math.round(startY) };
          }
          if (Math.abs(deg - 90) < 6 || Math.abs(deg - 270) < 6) {
            return { x: Math.round(startX), y: Math.round(rawY) };
          }
        }
        return { x: Math.round(rawX), y: Math.round(rawY) };
      },
      []
    );

    const handleWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      setZoom((prev) => Math.min(6, Math.max(0.35, prev * factor)));
    }, []);

    const handlePointerDown = useCallback(
      (e: React.PointerEvent<SVGSVGElement>) => {
        if (e.button !== 0) return;
        const target = e.target as HTMLElement;
        if (!readOnly && sectionDrawMode && onCreateSectionLine) {
          const wp = clientToWorldCm(e.clientX, e.clientY);
          if (wp) {
            const sx = Math.round(wp.x);
            const sy = Math.round(wp.y);
            setDraftSection({ startX: sx, startY: sy, endX: sx, endY: sy });
            e.currentTarget.setPointerCapture(e.pointerId);
          }
          return;
        }
        if (target.closest('[data-interactive="true"]')) return;
        panMovedRef.current = false;
        suppressNextSvgClickRef.current = false;
        setIsDragging(true);
        dragStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          panX: pan.x,
          panY: pan.y,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      },
      [pan, readOnly, sectionDrawMode, onCreateSectionLine, clientToWorldCm]
    );

    const handlePointerMove = useCallback(
      (e: React.PointerEvent<SVGSVGElement>) => {
        if (draftSection) {
          const wp = clientToWorldCm(e.clientX, e.clientY);
          if (wp) {
            const snapped = snapSectionEndpoint(
              draftSection.startX,
              draftSection.startY,
              wp.x,
              wp.y
            );
            setDraftSection((prev) =>
              prev ? { ...prev, endX: snapped.x, endY: snapped.y } : null
            );
          }
          return;
        }

        if (draggingSectionEndpointRef.current && onUpdateSectionLine) {
          const ep = draggingSectionEndpointRef.current;
          const wp = clientToWorldCm(e.clientX, e.clientY);
          if (wp) {
            const sec = (project.sectionLines ?? []).find((s) => s.id === ep.sectionId);
            if (sec) {
              const anchorX = ep.endpoint === 'end' ? sec.startXCm : sec.endXCm;
              const anchorY = ep.endpoint === 'end' ? sec.startYCm : sec.endYCm;
              const snapped = snapSectionEndpoint(anchorX, anchorY, wp.x, wp.y);
              onUpdateSectionLine(
                ep.sectionId,
                ep.endpoint === 'end'
                  ? { endXCm: snapped.x, endYCm: snapped.y }
                  : { startXCm: snapped.x, startYCm: snapped.y }
              );
            }
          }
          return;
        }

        if (rotatingElRef.current && onRotateElement && svgRef.current) {
          const rot = rotatingElRef.current;
          const worldPt = clientToWorldCm(e.clientX, e.clientY);
          if (worldPt) {
            const dx = worldPt.x - rot.boxCenter.x;
            const dy = worldPt.y - rot.boxCenter.y;
            if (Math.hypot(dx, dy) > 4) {
              const projT = dx * rot.baseTangent.x + dy * rot.baseTangent.y;
              const projN = dx * rot.baseNormal.x + dy * rot.baseNormal.y;
              let deg = normalizeAngleDeg((Math.atan2(-projT, projN) * 180) / Math.PI);
              const nearest15 = Math.round(deg / 15) * 15;
              if (Math.abs(deg - nearest15) < 5) {
                deg = normalizeAngleDeg(nearest15);
              } else {
                deg = Math.round(deg);
              }
              onRotateElement(rot.id, deg);
            }
          }
          return;
        }

        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const scaleX = viewMetrics.vbW / Math.max(1, rect.width);
        const scaleY = viewMetrics.vbH / Math.max(1, rect.height);
        const scale = Math.max(scaleX, scaleY);

        if (draggingElRef.current) {
          const drag = draggingElRef.current;
          const dxCm = (e.clientX - drag.startClientX) * scale;
          const dyCm = (e.clientY - drag.startClientY) * scale;
          const snapActive = effectiveSnapEnabled && !e.shiftKey && !e.altKey;
          if (drag.mode === 'free') {
            const snapRes = computeMagneticSnapPosition({
              elementId: drag.id,
              candidateXCm: drag.origXCm + dxCm,
              candidateYCm: drag.origYCm + dyCm,
              widthCm: drag.widthCm,
              depthCm: drag.depthCm,
              rotationDeg: drag.rotationDeg,
              wallThicknessCm: project.wallThicknessCm,
              solved,
              placements,
              enabled: snapActive,
            });
            setSnapGuides(snapRes.guides);
            onMoveElement?.(drag.id, snapRes.xCm, snapRes.yCm);
          } else if (drag.edgeTangent && drag.edgeInward && drag.facingNormal) {
            const res = computeWallDragResult({
              dxCm,
              dyCm,
              origOffsetCm: drag.origOffsetCm,
              origBoxXCm: drag.origXCm,
              origBoxYCm: drag.origYCm,
              edgeLengthCm: drag.edgeLenCm ?? 0,
              elementWidthCm: drag.widthCm,
              tangent: drag.edgeTangent,
              inwardNormal: drag.edgeInward,
              facingNormal: drag.facingNormal,
              isOpening: drag.isOpening,
              snapEnabled: snapActive,
            });
            if (res.mode === 'free' && onDetachWallElement) {
              drag.mode = 'free';
              drag.rotationDeg = res.rotationDeg;
              setSnapGuides([]);
              onDetachWallElement(drag.id, res.xCm, res.yCm, res.rotationDeg);
            } else if (res.mode === 'wall' && onSlideWallElement) {
              setSnapGuides([]);
              onSlideWallElement(drag.id, res.offsetCm);
            }
          }
          return;
        }

        if (!isDragging || !dragStartRef.current) return;
        if (
          Math.hypot(
            e.clientX - dragStartRef.current.x,
            e.clientY - dragStartRef.current.y
          ) > 3
        ) {
          panMovedRef.current = true;
        }
        const dx = (e.clientX - dragStartRef.current.x) * scale;
        const dy = (e.clientY - dragStartRef.current.y) * scale;
        setPan({
          x: dragStartRef.current.panX + dx,
          y: dragStartRef.current.panY + dy,
        });
      },
      [
        draftSection,
        isDragging,
        viewMetrics.vbW,
        viewMetrics.vbH,
        project.sectionLines,
        project.wallThicknessCm,
        solved,
        placements,
        effectiveSnapEnabled,
        clientToWorldCm,
        snapSectionEndpoint,
        onMoveElement,
        onSlideWallElement,
        onDetachWallElement,
        onRotateElement,
        onUpdateSectionLine,
      ]
    );

    const handlePointerUp = useCallback(() => {
      if (draftSection && onCreateSectionLine) {
        const len = Math.hypot(
          draftSection.endX - draftSection.startX,
          draftSection.endY - draftSection.startY
        );
        if (len >= 20) {
          const newSection: SectionLine = {
            id: `sec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            label: getNextSectionLabel(project.sectionLines),
            startXCm: draftSection.startX,
            startYCm: draftSection.startY,
            endXCm: draftSection.endX,
            endYCm: draftSection.endY,
            viewDirection: 1,
          };
          onCreateSectionLine(newSection);
          onSelectSection?.(newSection.id);
          onSelectElement(null);
          onSelectEdge(null);
          onSetSectionDrawMode?.(false);
        }
        setDraftSection(null);
        suppressNextSvgClickRef.current = true;
        requestAnimationFrame(() => {
          suppressNextSvgClickRef.current = false;
        });
        return;
      }

      const hadElementInteraction = Boolean(
        draggingElRef.current || rotatingElRef.current || draggingSectionEndpointRef.current
      );
      const hadPanMove = panMovedRef.current;

      if (hadElementInteraction || hadPanMove) {
        suppressNextSvgClickRef.current = true;
        requestAnimationFrame(() => {
          suppressNextSvgClickRef.current = false;
        });
      }
      if (hadElementInteraction) {
        onEndElementInteraction?.();
      }

      setIsDragging(false);
      setSnapGuides([]);
      dragStartRef.current = null;
      panMovedRef.current = false;
      draggingElRef.current = null;
      rotatingElRef.current = null;
      draggingSectionEndpointRef.current = null;
    }, [
      draftSection,
      project.sectionLines,
      onCreateSectionLine,
      onSelectSection,
      onSelectElement,
      onSelectEdge,
      onSetSectionDrawMode,
      onEndElementInteraction,
    ]);

    useEffect(() => {
      fitToView();
    }, [project.edges.length, project.edges[0]?.id, fitToView]);

    const serializeSvgForExport = useCallback(() => {
      if (!svgRef.current) return null;
      const clone = svgRef.current.cloneNode(true) as SVGSVGElement;
      clone.querySelectorAll('[data-export-exclude="true"]').forEach((el) => el.remove());
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute(
        'viewBox',
        `${viewMetrics.baseOriginX} ${viewMetrics.baseOriginY} ${viewMetrics.baseW} ${viewMetrics.baseH}`
      );
      clone.setAttribute('width', '1600');
      clone.setAttribute('height', '1200');
      // Add solid white architectural background for standalone export
      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bg.setAttribute('x', String(viewMetrics.baseOriginX));
      bg.setAttribute('y', String(viewMetrics.baseOriginY));
      bg.setAttribute('width', String(viewMetrics.baseW));
      bg.setAttribute('height', String(viewMetrics.baseH));
      bg.setAttribute('fill', '#ffffff');
      clone.insertBefore(bg, clone.firstChild);
      return new XMLSerializer().serializeToString(clone);
    }, [viewMetrics]);

    useImperativeHandle(
      ref,
      () => ({
        fitToView,
        exportSvg: () => {
          const svgStr = serializeSvgForExport();
          if (!svgStr) return;
          const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `${project.projectName || 'floorplan'}-2d.svg`;
          link.click();
          URL.revokeObjectURL(url);
        },
        exportPng: () => {
          const svgStr = serializeSvgForExport();
          if (!svgStr) return;
          const img = new Image();
          const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
          const url = URL.createObjectURL(svgBlob);
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 2000;
            canvas.height = 1500;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              const pngUrl = canvas.toDataURL('image/png');
              const link = document.createElement('a');
              link.href = pngUrl;
              link.download = `${project.projectName || 'floorplan'}-2d.png`;
              link.click();
            }
            URL.revokeObjectURL(url);
          };
          img.src = url;
        },
      }),
      [fitToView, serializeSvgForExport, project.projectName]
    );

    const s = viewMetrics.unitScale;
    const polygonPointsStr = solved.polygonPoints.map((p) => `${p.x},${p.y}`).join(' ');
    const wallStroke = Math.max(6, project.wallThicknessCm);

    // Nice metric grid step in cm (50cm or 100cm depending on room scale)
    const gridStep = viewMetrics.maxDim > 1000 ? 100 : 50;

    return (
      <div
        ref={containerRef}
        className="relative w-full h-full bg-white overflow-hidden select-none"
        data-testid="floorplan-2d-viewport"
      >
        <svg
          ref={svgRef}
          className={`w-full h-full ${
            sectionDrawMode
              ? 'cursor-crosshair'
              : isDragging
                ? 'cursor-grabbing'
                : 'cursor-grab'
          }`}
          viewBox={`${viewMetrics.vbX} ${viewMetrics.vbY} ${viewMetrics.vbW} ${viewMetrics.vbH}`}
          preserveAspectRatio="xMidYMid meet"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onClick={(e) => {
            if (suppressNextSvgClickRef.current) {
              suppressNextSvgClickRef.current = false;
              return;
            }
            if (!(e.target as HTMLElement).closest('[data-interactive="true"]')) {
              onSelectEdge(null);
              onSelectElement(null);
              onSelectSection?.(null);
            }
          }}
        >
          <defs>
            <pattern
              id="blueprint-grid-minor"
              width={gridStep}
              height={gridStep}
              patternUnits="userSpaceOnUse"
            >
              <path
                d={`M ${gridStep} 0 L 0 0 0 ${gridStep}`}
                fill="none"
                stroke="#f1f5f9"
                strokeWidth={1 * s}
              />
            </pattern>
            <pattern
              id="blueprint-grid-major"
              width={gridStep * 2}
              height={gridStep * 2}
              patternUnits="userSpaceOnUse"
            >
              <rect width={gridStep * 2} height={gridStep * 2} fill="url(#blueprint-grid-minor)" />
              <path
                d={`M ${gridStep * 2} 0 L 0 0 0 ${gridStep * 2}`}
                fill="none"
                stroke="#e2e8f0"
                strokeWidth={1.4 * s}
              />
            </pattern>
            <pattern
              id="cabinet-hatch"
              width={12 * s}
              height={12 * s}
              patternTransform="rotate(45 0 0)"
              patternUnits="userSpaceOnUse"
            >
              <line
                x1="0"
                y1="0"
                x2="0"
                y2={12 * s}
                stroke="#b45309"
                strokeOpacity="0.22"
                strokeWidth={1.2 * s}
              />
            </pattern>
          </defs>

          {/* Architectural Grid */}
          {showGrid && (
            <rect
              x={viewMetrics.vbX - 500}
              y={viewMetrics.vbY - 500}
              width={viewMetrics.vbW + 1000}
              height={viewMetrics.vbH + 1000}
              fill="url(#blueprint-grid-major)"
            />
          )}

          {/* Room Interior Fill */}
          {solved.polygonPoints.length >= 3 && (
            <polygon
              points={polygonPointsStr}
              fill={sanitizeHexColor(project.floorColor) || DEFAULT_FLOOR_2D_COLOR}
              stroke="none"
            />
          )}

          {/* Wall Thickness Underlay (Outer architectural body) */}
          {solved.solvedEdges.map((se) => {
            if (!se.edge.hasWall) return null;
            const isSelected = selectedEdgeId === se.edge.id;
            const wallCoreColor =
              sanitizeHexColor(project.wallColor) || DEFAULT_WALL_CORE_2D_COLOR;
            return (
              <g
                key={`wall-${se.edge.id}`}
                data-interactive="true"
                className="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectEdge(se.edge.id);
                  onSelectElement(null);
                }}
              >
                {/* Hit area for easy clicking */}
                <line
                  x1={se.start.x}
                  y1={se.start.y}
                  x2={se.end.x}
                  y2={se.end.y}
                  stroke="transparent"
                  strokeWidth={Math.max(24 * s, wallStroke + 12)}
                  strokeLinecap="round"
                />
                {/* Outer dark ink border */}
                <line
                  x1={se.start.x}
                  y1={se.start.y}
                  x2={se.end.x}
                  y2={se.end.y}
                  stroke={isSelected ? '#1d4ed8' : '#1e293b'}
                  strokeWidth={wallStroke}
                  strokeLinecap="square"
                />
                {/* Inner wall core */}
                <line
                  x1={se.start.x}
                  y1={se.start.y}
                  x2={se.end.x}
                  y2={se.end.y}
                  stroke={isSelected ? '#dbeafe' : wallCoreColor}
                  strokeWidth={Math.max(2, wallStroke - 4)}
                  strokeLinecap="square"
                />
              </g>
            );
          })}

          {/* Open / Virtual Wall Edges (when hasWall = false) */}
          {solved.solvedEdges
            .filter((se) => !se.edge.hasWall)
            .map((se) => (
              <line
                key={`open-${se.edge.id}`}
                x1={se.start.x}
                y1={se.start.y}
                x2={se.end.x}
                y2={se.end.y}
                stroke="#94a3b8"
                strokeWidth={2 * s}
                strokeDasharray={`${8 * s} ${6 * s}`}
              />
            ))}

          {/* Interior Partition Walls (房中房 / 室內隔間牆) */}
          {solved.solvedInteriorWalls.map((iw) => {
            const isSelected = selectedEdgeId === iw.id;
            const innerWallStroke = Math.max(5, wallStroke * 0.85);
            const interiorCoreColor =
              sanitizeHexColor(project.wallColor) || DEFAULT_INTERIOR_WALL_CORE_2D_COLOR;
            return (
              <g
                key={`iw-${iw.id}`}
                data-interactive="true"
                className="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectEdge(iw.id);
                  onSelectElement(null);
                }}
              >
                <line
                  x1={iw.start.x}
                  y1={iw.start.y}
                  x2={iw.end.x}
                  y2={iw.end.y}
                  stroke="transparent"
                  strokeWidth={Math.max(24 * s, innerWallStroke + 12)}
                  strokeLinecap="round"
                />
                {iw.hasWall ? (
                  <>
                    <line
                      x1={iw.start.x}
                      y1={iw.start.y}
                      x2={iw.end.x}
                      y2={iw.end.y}
                      stroke={isSelected ? '#1d4ed8' : '#334155'}
                      strokeWidth={innerWallStroke}
                      strokeLinecap="square"
                    />
                    <line
                      x1={iw.start.x}
                      y1={iw.start.y}
                      x2={iw.end.x}
                      y2={iw.end.y}
                      stroke={isSelected ? '#dbeafe' : interiorCoreColor}
                      strokeWidth={Math.max(2, innerWallStroke - 4)}
                      strokeLinecap="square"
                    />
                  </>
                ) : (
                  <line
                    x1={iw.start.x}
                    y1={iw.start.y}
                    x2={iw.end.x}
                    y2={iw.end.y}
                    stroke={isSelected ? '#2563eb' : '#94a3b8'}
                    strokeWidth={2 * s}
                    strokeDasharray={`${6 * s} ${4 * s}`}
                  />
                )}
              </g>
            );
          })}

          {/* Unclosed Polygon Warning Gap */}
          {!solved.isClosed && !project.forceClose && solved.solvedEdges.length >= 2 && (
            <g>
              <line
                x1={solved.rawEndPoint.x}
                y1={solved.rawEndPoint.y}
                x2={solved.polygonPoints[0].x}
                y2={solved.polygonPoints[0].y}
                stroke="#d97706"
                strokeWidth={2.5 * s}
                strokeDasharray={`${6 * s} ${4 * s}`}
              />
              <circle
                cx={solved.rawEndPoint.x}
                cy={solved.rawEndPoint.y}
                r={5 * s}
                fill="#fef3c7"
                stroke="#d97706"
                strokeWidth={2 * s}
              />
              <text
                x={(solved.rawEndPoint.x + solved.polygonPoints[0].x) * 0.5 - 8 * s}
                y={(solved.rawEndPoint.y + solved.polygonPoints[0].y) * 0.5 - 16 * s}
                fill="#b45309"
                fontSize={10.5 * s}
                fontWeight="600"
                className="font-mono tabular-nums"
              >
                缺口 {formatDimension(solved.gapCm, project.unit)}
              </text>
            </g>
          )}

          {/* Corner Vertex Nodes */}
          {solved.polygonPoints.map((pt, idx) => (
            <circle
              key={`v-${idx}`}
              cx={pt.x}
              cy={pt.y}
              r={3 * s}
              fill="#0f172a"
            />
          ))}
          {solved.solvedInteriorWalls.map((iw) => (
            <g key={`iv-${iw.id}`}>
              <circle cx={iw.start.x} cy={iw.start.y} r={2.4 * s} fill="#334155" />
              <circle cx={iw.end.x} cy={iw.end.y} r={2.4 * s} fill="#334155" />
            </g>
          ))}

          {/* Elements: Cabinets, Furniture (Table/Chair/Bed), Windows, Doors */}
          {[...placements]
            .sort((a, b) => {
              const aTop =
                a.element.id === selectedElementId &&
                a.element.kind !== 'door' &&
                a.element.kind !== 'window'
                  ? 1
                  : 0;
              const bTop =
                b.element.id === selectedElementId &&
                b.element.kind !== 'door' &&
                b.element.kind !== 'window'
                  ? 1
                  : 0;
              return aTop - bTop;
            })
            .map((pl) => {
            const { element, startPoint, endPoint, center, boxCenter, edge, tangent } = pl;
            const isSelected = selectedElementId === element.id;
            const isFree = pl.placementMode === 'free';
            const normalDir = pl.facingNormal;

            const isOpening = element.kind === 'door' || element.kind === 'window';
            const customColor = sanitizeHexColor(element.color);
            const customTextColor = customColor ? getContrastTextColor(customColor) : null;
            const customStrokeColor = customColor ? darkenHexColor(customColor, 0.58) : null;

            const startFreeDrag = (e: React.PointerEvent<SVGGElement>) => {
              e.stopPropagation();
              onSelectElement(element.id);
              onSelectEdge(null);
              if (readOnly || e.button !== 0) return;
              if (isFree && onMoveElement) {
                onBeginElementInteraction?.();
                suppressNextSvgClickRef.current = true;
                draggingElRef.current = {
                  id: element.id,
                  startClientX: e.clientX,
                  startClientY: e.clientY,
                  origXCm: boxCenter.x,
                  origYCm: boxCenter.y,
                  mode: 'free',
                  origOffsetCm: pl.clampedOffsetCm,
                  widthCm: pl.clampedWidthCm,
                  depthCm: element.depthCm,
                  rotationDeg: pl.angleDeg,
                  isOpening,
                };
                e.currentTarget.setPointerCapture?.(e.pointerId);
              } else if (!isFree && edge && (onSlideWallElement || (!isOpening && onDetachWallElement))) {
                onBeginElementInteraction?.();
                suppressNextSvgClickRef.current = true;
                draggingElRef.current = {
                  id: element.id,
                  startClientX: e.clientX,
                  startClientY: e.clientY,
                  origXCm: boxCenter.x,
                  origYCm: boxCenter.y,
                  mode: 'wall',
                  origOffsetCm: pl.clampedOffsetCm,
                  edgeTangent: edge.tangent,
                  edgeInward: edge.inwardNormal,
                  facingNormal: normalDir,
                  edgeLenCm: edge.lengthCm,
                  widthCm: pl.clampedWidthCm,
                  depthCm: element.depthCm,
                  rotationDeg: pl.angleDeg,
                  isOpening,
                };
                e.currentTarget.setPointerCapture?.(e.pointerId);
              }
            };

            const handleElementDoubleClick = (e: React.MouseEvent<SVGGElement>) => {
              e.stopPropagation();
              onSelectElement(element.id);
              onSelectEdge(null);
              if (!readOnly) {
                onDoubleClickElement?.(element.id);
              }
            };

            const buildRectCorners = (
              cx: number,
              cy: number,
              halfW: number,
              halfD: number
            ): [Point2D, Point2D, Point2D, Point2D] => [
              {
                x: cx - tangent.x * halfW - normalDir.x * halfD,
                y: cy - tangent.y * halfW - normalDir.y * halfD,
              },
              {
                x: cx + tangent.x * halfW - normalDir.x * halfD,
                y: cy + tangent.y * halfW - normalDir.y * halfD,
              },
              {
                x: cx + tangent.x * halfW + normalDir.x * halfD,
                y: cy + tangent.y * halfW + normalDir.y * halfD,
              },
              {
                x: cx - tangent.x * halfW + normalDir.x * halfD,
                y: cy - tangent.y * halfW + normalDir.y * halfD,
              },
            ];

            const toPts = (corners: Point2D[]) =>
              corners.map((p) => `${p.x},${p.y}`).join(' ');

            if (element.kind === 'cabinet') {
              const halfW = pl.clampedWidthCm * 0.5;
              const halfD = element.depthCm * 0.5;
              const [c1, c2, c3, c4] = buildRectCorners(boxCenter.x, boxCenter.y, halfW, halfD);
              const pts = toPts([c1, c2, c3, c4]);
              const fillCol = customColor || '#fef3c7';
              const strokeCol = isSelected ? '#1d4ed8' : customStrokeColor || '#b45309';
              const txtCol = customTextColor || '#78350f';
              const cabSpec = resolveCabinetSpecForElement(element);
              const sinkW = Math.min(pl.clampedWidthCm * 0.56, 56);
              const sinkD = Math.min(element.depthCm * 0.6, 36);

              return (
                <g
                  key={element.id}
                  data-interactive="true"
                  data-element-id={element.id}
                  className={!readOnly ? 'cursor-move' : 'cursor-pointer'}
                  onPointerDown={startFreeDrag}
                  onDoubleClick={handleElementDoubleClick}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectElement(element.id);
                    onSelectEdge(null);
                  }}
                >
                  <polygon
                    points={pts}
                    fill={fillCol}
                    stroke={strokeCol}
                    strokeWidth={(isSelected ? 2.5 : 1.8) * s}
                  />
                  {!customColor && <polygon points={pts} fill="url(#cabinet-hatch)" />}
                  <g
                    transform={`matrix(${tangent.x} ${tangent.y} ${normalDir.x} ${normalDir.y} ${boxCenter.x} ${boxCenter.y})`}
                  >
                    {!cabSpec.hasSink && (
                      <>
                        <line
                          x1={-halfW}
                          y1={-halfD}
                          x2={halfW}
                          y2={halfD}
                          stroke={customStrokeColor || '#b45309'}
                          strokeOpacity="0.32"
                          strokeWidth={1 * s}
                        />
                        <line
                          x1={halfW}
                          y1={-halfD}
                          x2={-halfW}
                          y2={halfD}
                          stroke={customStrokeColor || '#b45309'}
                          strokeOpacity="0.32"
                          strokeWidth={1 * s}
                        />
                      </>
                    )}
                    {cabSpec.hasSink && (
                      <>
                        <rect
                          x={-sinkW * 0.5}
                          y={-sinkD * 0.45}
                          width={sinkW}
                          height={sinkD}
                          rx={3 * s}
                          fill="#e2e8f0"
                          stroke="#475569"
                          strokeWidth={1.2 * s}
                        />
                        <circle
                          cx={0}
                          cy={0}
                          r={Math.min(3.2, sinkW * 0.08)}
                          fill="#94a3b8"
                          stroke="#334155"
                          strokeWidth={0.8 * s}
                        />
                        <line
                          x1={0}
                          y1={-halfD + 3}
                          x2={0}
                          y2={-sinkD * 0.14}
                          stroke="#1e293b"
                          strokeWidth={2 * s}
                          strokeLinecap="round"
                        />
                      </>
                    )}
                    {/* Front face door swing/leaf indicator (+Y local is outward front normal) */}
                    {cabSpec.doorMode === 'double' && (
                      <>
                        <line
                          x1={0}
                          y1={halfD - 5 * s}
                          x2={0}
                          y2={halfD + 4 * s}
                          stroke={strokeCol}
                          strokeWidth={1.4 * s}
                        />
                        <circle cx={-5 * s} cy={halfD - 3 * s} r={1.6 * s} fill={strokeCol} />
                        <circle cx={5 * s} cy={halfD - 3 * s} r={1.6 * s} fill={strokeCol} />
                      </>
                    )}
                    {cabSpec.doorMode === 'single-left' && (
                      <>
                        <line
                          x1={-halfW + 3 * s}
                          y1={halfD - 4 * s}
                          x2={-halfW + 3 * s}
                          y2={halfD + 3 * s}
                          stroke={strokeCol}
                          strokeWidth={1.6 * s}
                        />
                        <circle cx={halfW - 6 * s} cy={halfD - 3 * s} r={1.8 * s} fill={strokeCol} />
                      </>
                    )}
                    {cabSpec.doorMode === 'single-right' && (
                      <>
                        <line
                          x1={halfW - 3 * s}
                          y1={halfD - 4 * s}
                          x2={halfW - 3 * s}
                          y2={halfD + 3 * s}
                          stroke={strokeCol}
                          strokeWidth={1.6 * s}
                        />
                        <circle cx={-halfW + 6 * s} cy={halfD - 3 * s} r={1.8 * s} fill={strokeCol} />
                      </>
                    )}
                  </g>
                  <text
                    x={boxCenter.x}
                    y={boxCenter.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={txtCol}
                    fontSize={10 * s}
                    fontWeight="600"
                    className="font-sans pointer-events-none"
                  >
                    {element.name}
                  </text>
                  <text
                    x={boxCenter.x}
                    y={boxCenter.y + 12 * s}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={customTextColor || '#92400e'}
                    fontSize={8.5 * s}
                    className="font-mono tabular-nums pointer-events-none"
                  >
                    {Math.round(element.depthCm)}×{Math.round(pl.clampedWidthCm)}
                  </text>
                </g>
              );
            }

            if (element.kind === 'kitchen_counter') {
              const halfW = pl.clampedWidthCm * 0.5;
              const halfD = element.depthCm * 0.5;
              const fillCol = customColor || '#f5efe6';
              const strokeCol = isSelected ? '#1d4ed8' : customStrokeColor || '#92400e';
              const txtCol = customTextColor || '#451a03';
              const cabSpec = resolveCabinetSpecForElement(element);
              const showCooktop = element.cabinetSpec === undefined;
              const sinkW = Math.min(pl.clampedWidthCm * 0.28, 56);
              const sinkD = element.depthCm * 0.62;
              const sinkCx = showCooktop
                ? -halfW + Math.max(sinkW * 0.68, pl.clampedWidthCm * 0.22)
                : 0;
              const stoveW = Math.min(pl.clampedWidthCm * 0.3, 64);
              const stoveD = element.depthCm * 0.68;
              const stoveCx = halfW - Math.max(stoveW * 0.68, pl.clampedWidthCm * 0.22);

              return (
                <g
                  key={element.id}
                  data-interactive="true"
                  data-element-id={element.id}
                  className={!readOnly ? 'cursor-move' : 'cursor-pointer'}
                  onPointerDown={startFreeDrag}
                  onDoubleClick={handleElementDoubleClick}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectElement(element.id);
                    onSelectEdge(null);
                  }}
                >
                  <g
                    transform={`matrix(${tangent.x} ${tangent.y} ${normalDir.x} ${normalDir.y} ${boxCenter.x} ${boxCenter.y})`}
                  >
                    {/* Countertop body */}
                    <rect
                      x={-halfW}
                      y={-halfD}
                      width={pl.clampedWidthCm}
                      height={element.depthCm}
                      rx={2.5 * s}
                      fill={fillCol}
                      stroke={strokeCol}
                      strokeWidth={(isSelected ? 2.5 : 1.8) * s}
                    />
                    {/* Back wall lip */}
                    <line
                      x1={-halfW}
                      y1={-halfD + 4}
                      x2={halfW}
                      y2={-halfD + 4}
                      stroke={customStrokeColor || '#b45309'}
                      strokeOpacity="0.4"
                      strokeWidth={1.2 * s}
                    />
                    {/* Stainless sink basin */}
                    {cabSpec.hasSink && (
                      <>
                        <rect
                          x={sinkCx - sinkW * 0.5}
                          y={-sinkD * 0.45}
                          width={sinkW}
                          height={sinkD}
                          rx={4 * s}
                          fill="#e2e8f0"
                          stroke="#475569"
                          strokeWidth={1.3 * s}
                        />
                        <circle
                          cx={sinkCx}
                          cy={0}
                          r={Math.min(3.5, sinkW * 0.08)}
                          fill="#94a3b8"
                          stroke="#334155"
                          strokeWidth={0.9 * s}
                        />
                        <line
                          x1={sinkCx}
                          y1={-halfD + 4}
                          x2={sinkCx}
                          y2={-sinkD * 0.15}
                          stroke="#1e293b"
                          strokeWidth={2.2 * s}
                          strokeLinecap="round"
                        />
                      </>
                    )}
                    {/* Ceramic induction cooktop (legacy default kitchen counter) */}
                    {showCooktop && (
                      <>
                        <rect
                          x={stoveCx - stoveW * 0.5}
                          y={-stoveD * 0.46}
                          width={stoveW}
                          height={stoveD}
                          rx={3 * s}
                          fill="#1e293b"
                          stroke="#475569"
                          strokeWidth={1.2 * s}
                        />
                        <circle
                          cx={stoveCx - stoveW * 0.22}
                          cy={0}
                          r={Math.min(11, stoveD * 0.28)}
                          fill="none"
                          stroke="#cbd5e1"
                          strokeWidth={1.3 * s}
                        />
                        <circle
                          cx={stoveCx + stoveW * 0.22}
                          cy={0}
                          r={Math.min(9.5, stoveD * 0.24)}
                          fill="none"
                          stroke="#cbd5e1"
                          strokeWidth={1.3 * s}
                        />
                      </>
                    )}
                    {cabSpec.doorMode === 'double' && (
                      <line
                        x1={0}
                        y1={halfD - 4 * s}
                        x2={0}
                        y2={halfD + 3 * s}
                        stroke={strokeCol}
                        strokeWidth={1.3 * s}
                      />
                    )}
                  </g>
                  <text
                    x={boxCenter.x}
                    y={boxCenter.y + normalDir.y * (halfD + 10 * s) + tangent.x * 0}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={txtCol}
                    fontSize={9 * s}
                    fontWeight="600"
                    className="font-sans pointer-events-none"
                  >
                    {element.name} ({Math.round(pl.clampedWidthCm)}×{Math.round(element.depthCm)})
                  </text>
                </g>
              );
            }

            if (element.kind === 'table') {
              const halfW = pl.clampedWidthCm * 0.5;
              const halfD = element.depthCm * 0.5;
              const outerPts = toPts(buildRectCorners(boxCenter.x, boxCenter.y, halfW, halfD));
              const innerPts = toPts(
                buildRectCorners(
                  boxCenter.x,
                  boxCenter.y,
                  Math.max(4, halfW - 5 * s),
                  Math.max(4, halfD - 5 * s)
                )
              );
              const fillCol = customColor || '#fef9c3';
              const strokeCol = isSelected ? '#1d4ed8' : customStrokeColor || '#a16207';
              const txtCol = customTextColor || '#713f12';

              return (
                <g
                  key={element.id}
                  data-interactive="true"
                  data-element-id={element.id}
                  className={!readOnly ? 'cursor-move' : 'cursor-pointer'}
                  onPointerDown={startFreeDrag}
                  onDoubleClick={handleElementDoubleClick}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectElement(element.id);
                    onSelectEdge(null);
                  }}
                >
                  <polygon
                    points={outerPts}
                    fill={fillCol}
                    stroke={strokeCol}
                    strokeWidth={(isSelected ? 2.5 : 1.8) * s}
                  />
                  <polygon
                    points={innerPts}
                    fill="none"
                    stroke={customStrokeColor || '#ca8a04'}
                    strokeOpacity="0.45"
                    strokeWidth={1 * s}
                  />
                  <text
                    x={boxCenter.x}
                    y={boxCenter.y - 4 * s}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={txtCol}
                    fontSize={10 * s}
                    fontWeight="600"
                    className="font-sans pointer-events-none"
                  >
                    {element.name}
                  </text>
                  <text
                    x={boxCenter.x}
                    y={boxCenter.y + 9 * s}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={customTextColor || '#854d0e'}
                    fontSize={8.5 * s}
                    className="font-mono tabular-nums pointer-events-none"
                  >
                    {Math.round(pl.clampedWidthCm)}×{Math.round(element.depthCm)}
                  </text>
                </g>
              );
            }

            if (element.kind === 'round_table') {
              const halfW = pl.clampedWidthCm * 0.5;
              const halfD = element.depthCm * 0.5;
              const fillCol = customColor || '#fef3c7';
              const strokeCol = isSelected ? '#1d4ed8' : customStrokeColor || '#b45309';
              const txtCol = customTextColor || '#78350f';
              const sizeLabel =
                Math.abs(pl.clampedWidthCm - element.depthCm) <= 2
                  ? `Ø${Math.round(pl.clampedWidthCm)}`
                  : `${Math.round(pl.clampedWidthCm)}×${Math.round(element.depthCm)}`;

              return (
                <g
                  key={element.id}
                  data-interactive="true"
                  data-element-id={element.id}
                  className={!readOnly ? 'cursor-move' : 'cursor-pointer'}
                  onPointerDown={startFreeDrag}
                  onDoubleClick={handleElementDoubleClick}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectElement(element.id);
                    onSelectEdge(null);
                  }}
                >
                  <g
                    transform={`matrix(${tangent.x} ${tangent.y} ${normalDir.x} ${normalDir.y} ${boxCenter.x} ${boxCenter.y})`}
                  >
                    <ellipse
                      cx={0}
                      cy={0}
                      rx={halfW}
                      ry={halfD}
                      fill={fillCol}
                      stroke={strokeCol}
                      strokeWidth={(isSelected ? 2.6 : 1.9) * s}
                    />
                    <ellipse
                      cx={0}
                      cy={0}
                      rx={Math.max(4, halfW * 0.85)}
                      ry={Math.max(4, halfD * 0.85)}
                      fill="none"
                      stroke={customStrokeColor || '#d97706'}
                      strokeOpacity="0.4"
                      strokeWidth={1 * s}
                    />
                    <circle
                      cx={0}
                      cy={0}
                      r={Math.min(halfW, halfD) * 0.16}
                      fill="none"
                      stroke={customStrokeColor || '#92400e'}
                      strokeOpacity="0.35"
                      strokeWidth={1.1 * s}
                      strokeDasharray={`${3 * s} ${2 * s}`}
                    />
                  </g>
                  <text
                    x={boxCenter.x}
                    y={boxCenter.y - 4 * s}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={txtCol}
                    fontSize={10 * s}
                    fontWeight="600"
                    className="font-sans pointer-events-none"
                  >
                    {element.name}
                  </text>
                  <text
                    x={boxCenter.x}
                    y={boxCenter.y + 9 * s}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={customTextColor || '#92400e'}
                    fontSize={8.5 * s}
                    className="font-mono tabular-nums pointer-events-none"
                  >
                    {sizeLabel}
                  </text>
                </g>
              );
            }

            if (element.kind === 'sofa') {
              const halfW = pl.clampedWidthCm * 0.5;
              const halfD = element.depthCm * 0.5;
              const fillCol = customColor || '#ede9fe';
              const strokeCol = isSelected ? '#1d4ed8' : customStrokeColor || '#6d28d9';
              const backFill = customColor ? darkenHexColor(customColor, 0.82) : '#ddd6fe';
              const txtCol = customTextColor || '#4c1d95';
              const armW = Math.min(18, pl.clampedWidthCm * 0.12);
              const backD = Math.min(22, element.depthCm * 0.26);
              const seatW = Math.max(12, pl.clampedWidthCm - armW * 2);
              const cushionCount = pl.clampedWidthCm >= 170 ? 3 : 2;

              return (
                <g
                  key={element.id}
                  data-interactive="true"
                  data-element-id={element.id}
                  className={!readOnly ? 'cursor-move' : 'cursor-pointer'}
                  onPointerDown={startFreeDrag}
                  onDoubleClick={handleElementDoubleClick}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectElement(element.id);
                    onSelectEdge(null);
                  }}
                >
                  <g
                    transform={`matrix(${tangent.x} ${tangent.y} ${normalDir.x} ${normalDir.y} ${boxCenter.x} ${boxCenter.y})`}
                  >
                    {/* Main frame */}
                    <rect
                      x={-halfW}
                      y={-halfD}
                      width={pl.clampedWidthCm}
                      height={element.depthCm}
                      rx={5 * s}
                      fill={fillCol}
                      stroke={strokeCol}
                      strokeWidth={(isSelected ? 2.6 : 1.8) * s}
                    />
                    {/* Backrest */}
                    <rect
                      x={-halfW}
                      y={-halfD}
                      width={pl.clampedWidthCm}
                      height={backD}
                      rx={4 * s}
                      fill={backFill}
                      stroke={strokeCol}
                      strokeWidth={1.3 * s}
                    />
                    {/* Left & right armrests */}
                    <rect
                      x={-halfW}
                      y={-halfD}
                      width={armW}
                      height={element.depthCm}
                      rx={3.5 * s}
                      fill={backFill}
                      stroke={strokeCol}
                      strokeWidth={1.3 * s}
                    />
                    <rect
                      x={halfW - armW}
                      y={-halfD}
                      width={armW}
                      height={element.depthCm}
                      rx={3.5 * s}
                      fill={backFill}
                      stroke={strokeCol}
                      strokeWidth={1.3 * s}
                    />
                    {/* Seat cushion seam dividers */}
                    {Array.from({ length: cushionCount - 1 }, (_, idx) => {
                      const sx = -seatW * 0.5 + ((idx + 1) * seatW) / cushionCount;
                      return (
                        <line
                          key={idx}
                          x1={sx}
                          y1={-halfD + backD}
                          x2={sx}
                          y2={halfD - 2}
                          stroke={strokeCol}
                          strokeOpacity="0.45"
                          strokeWidth={1.1 * s}
                        />
                      );
                    })}
                  </g>
                  <text
                    x={boxCenter.x + normalDir.x * (backD * 0.35)}
                    y={boxCenter.y + normalDir.y * (backD * 0.35) - 4 * s}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={txtCol}
                    fontSize={9.5 * s}
                    fontWeight="600"
                    className="font-sans pointer-events-none"
                  >
                    {element.name}
                  </text>
                  <text
                    x={boxCenter.x + normalDir.x * (backD * 0.35)}
                    y={boxCenter.y + normalDir.y * (backD * 0.35) + 8 * s}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={customTextColor || '#5b21b6'}
                    fontSize={8 * s}
                    className="font-mono tabular-nums pointer-events-none"
                  >
                    {Math.round(pl.clampedWidthCm)}×{Math.round(element.depthCm)}
                  </text>
                </g>
              );
            }

            if (element.kind === 'chair') {
              const halfW = pl.clampedWidthCm * 0.5;
              const halfD = element.depthCm * 0.5;
              const seatPts = toPts(buildRectCorners(boxCenter.x, boxCenter.y, halfW, halfD));
              const backThick = Math.max(6, element.depthCm * 0.22);
              const backCenterX = boxCenter.x - normalDir.x * (halfD - backThick * 0.5);
              const backCenterY = boxCenter.y - normalDir.y * (halfD - backThick * 0.5);
              const backPts = toPts(
                buildRectCorners(backCenterX, backCenterY, halfW, backThick * 0.5)
              );
              const fillCol = customColor || '#f1f5f9';
              const strokeCol = isSelected ? '#1d4ed8' : customStrokeColor || '#475569';
              const txtCol = customTextColor || '#1e293b';

              return (
                <g
                  key={element.id}
                  data-interactive="true"
                  data-element-id={element.id}
                  className={!readOnly ? 'cursor-move' : 'cursor-pointer'}
                  onPointerDown={startFreeDrag}
                  onDoubleClick={handleElementDoubleClick}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectElement(element.id);
                    onSelectEdge(null);
                  }}
                >
                  <polygon
                    points={seatPts}
                    fill={fillCol}
                    stroke={strokeCol}
                    strokeWidth={(isSelected ? 2.4 : 1.6) * s}
                  />
                  <polygon
                    points={backPts}
                    fill={isSelected ? '#3b82f6' : customStrokeColor || '#334155'}
                    stroke={isSelected ? '#1d4ed8' : '#1e293b'}
                    strokeWidth={1.2 * s}
                  />
                  <text
                    x={boxCenter.x + normalDir.x * (backThick * 0.35)}
                    y={boxCenter.y + normalDir.y * (backThick * 0.35)}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={txtCol}
                    fontSize={8.5 * s}
                    fontWeight="600"
                    className="font-sans pointer-events-none"
                  >
                    {element.name}
                  </text>
                </g>
              );
            }

            if (element.kind === 'bed') {
              const halfW = pl.clampedWidthCm * 0.5;
              const halfD = element.depthCm * 0.5;
              const bedCorners = buildRectCorners(boxCenter.x, boxCenter.y, halfW, halfD);
              const bedPts = toPts(bedCorners);

              // Care clearance perimeter (75 cm around left, right, and foot)
              const aisle = 75;
              const clearCenterX = boxCenter.x + normalDir.x * (aisle * 0.5);
              const clearCenterY = boxCenter.y + normalDir.y * (aisle * 0.5);
              const clearPts = toPts(
                buildRectCorners(clearCenterX, clearCenterY, halfW + aisle, halfD + aisle * 0.5)
              );

              // Headboard along -normalDir
              const hbThick = Math.min(12, element.depthCm * 0.06);
              const hbPts = toPts(
                buildRectCorners(
                  boxCenter.x - normalDir.x * (halfD - hbThick * 0.5),
                  boxCenter.y - normalDir.y * (halfD - hbThick * 0.5),
                  halfW,
                  hbThick * 0.5
                )
              );

              // Pillow near headboard
              const pillowD = Math.min(34, element.depthCm * 0.17);
              const pillowOffset = halfD - hbThick - pillowD * 0.5 - 6;
              const pillowPts = toPts(
                buildRectCorners(
                  boxCenter.x - normalDir.x * pillowOffset,
                  boxCenter.y - normalDir.y * pillowOffset,
                  halfW * 0.72,
                  pillowD * 0.5
                )
              );

              // Blanket / folded sheet on lower 65% of bed (+normalDir)
              const blanketD = element.depthCm * 0.62;
              const blanketCenter = halfD - blanketD * 0.5 - 4;
              const blanketPts = toPts(
                buildRectCorners(
                  boxCenter.x + normalDir.x * blanketCenter,
                  boxCenter.y + normalDir.y * blanketCenter,
                  Math.max(8, halfW - 3),
                  blanketD * 0.5
                )
              );

              // Left & right safety side rails
              const railHalfLen = element.depthCm * 0.28;
              const railInset = halfW - 2.5;
              const leftRailStart = {
                x: boxCenter.x - tangent.x * railInset - normalDir.x * railHalfLen,
                y: boxCenter.y - tangent.y * railInset - normalDir.y * railHalfLen,
              };
              const leftRailEnd = {
                x: boxCenter.x - tangent.x * railInset + normalDir.x * railHalfLen,
                y: boxCenter.y - tangent.y * railInset + normalDir.y * railHalfLen,
              };
              const rightRailStart = {
                x: boxCenter.x + tangent.x * railInset - normalDir.x * railHalfLen,
                y: boxCenter.y + tangent.y * railInset - normalDir.y * railHalfLen,
              };
              const rightRailEnd = {
                x: boxCenter.x + tangent.x * railInset + normalDir.x * railHalfLen,
                y: boxCenter.y + tangent.y * railInset + normalDir.y * railHalfLen,
              };

              return (
                <g
                  key={element.id}
                  data-interactive="true"
                  data-element-id={element.id}
                  className={!readOnly ? 'cursor-move' : 'cursor-pointer'}
                  onPointerDown={startFreeDrag}
                  onDoubleClick={handleElementDoubleClick}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectElement(element.id);
                    onSelectEdge(null);
                  }}
                >
                  {element.showClearance && (
                    <polygon
                      points={clearPts}
                      fill="rgba(14, 165, 233, 0.04)"
                      stroke="#0284c7"
                      strokeOpacity="0.55"
                      strokeWidth={1.3 * s}
                      strokeDasharray={`${6 * s} ${5 * s}`}
                      className="pointer-events-none"
                    />
                  )}
                  <polygon
                    points={bedPts}
                    fill="#ffffff"
                    stroke={isSelected ? '#1d4ed8' : customStrokeColor || '#0f766e'}
                    strokeWidth={(isSelected ? 2.6 : 1.9) * s}
                  />
                  <polygon
                    points={blanketPts}
                    fill={customColor || '#e0f2fe'}
                    stroke={customStrokeColor || '#0284c7'}
                    strokeOpacity="0.55"
                    strokeWidth={1.2 * s}
                  />
                  <polygon
                    points={pillowPts}
                    fill="#f8fafc"
                    stroke="#64748b"
                    strokeWidth={1.2 * s}
                  />
                  <polygon
                    points={hbPts}
                    fill={isSelected ? '#1d4ed8' : customStrokeColor || '#0f766e'}
                  />
                  <line
                    x1={leftRailStart.x}
                    y1={leftRailStart.y}
                    x2={leftRailEnd.x}
                    y2={leftRailEnd.y}
                    stroke="#334155"
                    strokeWidth={3.2 * s}
                    strokeLinecap="round"
                  />
                  <line
                    x1={rightRailStart.x}
                    y1={rightRailStart.y}
                    x2={rightRailEnd.x}
                    y2={rightRailEnd.y}
                    stroke="#334155"
                    strokeWidth={3.2 * s}
                    strokeLinecap="round"
                  />
                  <text
                    x={boxCenter.x + normalDir.x * (element.depthCm * 0.14)}
                    y={boxCenter.y + normalDir.y * (element.depthCm * 0.14) - 4 * s}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={customTextColor || '#0f172a'}
                    fontSize={10 * s}
                    fontWeight="600"
                    className="font-sans pointer-events-none"
                  >
                    {element.name}
                  </text>
                  <text
                    x={boxCenter.x + normalDir.x * (element.depthCm * 0.14)}
                    y={boxCenter.y + normalDir.y * (element.depthCm * 0.14) + 9 * s}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={customTextColor || '#0369a1'}
                    fontSize={8.5 * s}
                    className="font-mono tabular-nums pointer-events-none"
                  >
                    {Math.round(pl.clampedWidthCm)}×{Math.round(element.depthCm)}
                  </text>
                </g>
              );
            }

            if (element.kind === 'wall_cabinet') {
              const halfW = pl.clampedWidthCm * 0.5;
              const halfD = element.depthCm * 0.5;
              const [c1, c2, c3, c4] = buildRectCorners(boxCenter.x, boxCenter.y, halfW, halfD);
              const pts = toPts([c1, c2, c3, c4]);
              const fillCol = customColor || '#ffedd5';
              const strokeCol = isSelected ? '#1d4ed8' : customStrokeColor || '#c2410c';
              const cabSpec = resolveCabinetSpecForElement(element);

              return (
                <g
                  key={element.id}
                  data-interactive="true"
                  data-element-id={element.id}
                  className={!readOnly ? 'cursor-move' : 'cursor-pointer'}
                  onPointerDown={startFreeDrag}
                  onDoubleClick={handleElementDoubleClick}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectElement(element.id);
                    onSelectEdge(null);
                  }}
                >
                  <polygon
                    points={pts}
                    fill={fillCol}
                    fillOpacity="0.58"
                    stroke={strokeCol}
                    strokeWidth={(isSelected ? 2.5 : 1.7) * s}
                    strokeDasharray={`${5.5 * s} ${3.5 * s}`}
                  />
                  <line
                    x1={c1.x}
                    y1={c1.y}
                    x2={c3.x}
                    y2={c3.y}
                    stroke={customStrokeColor || '#c2410c'}
                    strokeOpacity="0.35"
                    strokeWidth={1 * s}
                    strokeDasharray={`${4 * s} ${3 * s}`}
                  />
                  <line
                    x1={c2.x}
                    y1={c2.y}
                    x2={c4.x}
                    y2={c4.y}
                    stroke={customStrokeColor || '#c2410c'}
                    strokeOpacity="0.35"
                    strokeWidth={1 * s}
                    strokeDasharray={`${4 * s} ${3 * s}`}
                  />
                  {cabSpec.doorMode === 'double' && (
                    <g
                      transform={`matrix(${tangent.x} ${tangent.y} ${normalDir.x} ${normalDir.y} ${boxCenter.x} ${boxCenter.y})`}
                    >
                      <line
                        x1={0}
                        y1={halfD - 4 * s}
                        x2={0}
                        y2={halfD + 3 * s}
                        stroke={strokeCol}
                        strokeWidth={1.2 * s}
                      />
                    </g>
                  )}
                  <text
                    x={boxCenter.x}
                    y={boxCenter.y - 4 * s}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={customTextColor || '#9a3412'}
                    fontSize={9.5 * s}
                    fontWeight="600"
                    className="font-sans pointer-events-none"
                  >
                    {element.name}
                  </text>
                  <text
                    x={boxCenter.x}
                    y={boxCenter.y + 8 * s}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={customTextColor || '#c2410c'}
                    fontSize={8 * s}
                    className="font-mono tabular-nums pointer-events-none"
                  >
                    {Math.round(element.depthCm)}×{Math.round(pl.clampedWidthCm)}
                  </text>
                </g>
              );
            }

            if (element.kind === 'toilet') {
              const halfW = pl.clampedWidthCm * 0.5;
              const halfD = element.depthCm * 0.5;
              const tankD = Math.min(element.depthCm * 0.34, 24);
              const bowlD = Math.max(12, element.depthCm - tankD);
              const tankW = pl.clampedWidthCm * 0.94;
              const bowlCy = -halfD + tankD + bowlD * 0.48;
              const strokeCol = isSelected ? '#1d4ed8' : customStrokeColor || '#0284c7';
              const bodyFill = customColor || '#ffffff';

              return (
                <g
                  key={element.id}
                  data-interactive="true"
                  data-element-id={element.id}
                  className={!readOnly ? 'cursor-move' : 'cursor-pointer'}
                  onPointerDown={startFreeDrag}
                  onDoubleClick={handleElementDoubleClick}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectElement(element.id);
                    onSelectEdge(null);
                  }}
                >
                  <g
                    transform={`matrix(${tangent.x} ${tangent.y} ${normalDir.x} ${normalDir.y} ${boxCenter.x} ${boxCenter.y})`}
                  >
                    <rect
                      x={-halfW}
                      y={-halfD}
                      width={pl.clampedWidthCm}
                      height={element.depthCm}
                      fill="transparent"
                    />
                    {/* Cistern tank */}
                    <rect
                      x={-tankW * 0.5}
                      y={-halfD}
                      width={tankW}
                      height={tankD}
                      rx={3 * s}
                      fill={bodyFill}
                      stroke={strokeCol}
                      strokeWidth={(isSelected ? 2.4 : 1.6) * s}
                    />
                    <circle
                      cx={0}
                      cy={-halfD + tankD * 0.5}
                      r={Math.min(3.5, tankD * 0.22)}
                      fill="#bae6fd"
                      stroke={strokeCol}
                      strokeWidth={1 * s}
                    />
                    {/* Elongated ceramic bowl & inner seat */}
                    <ellipse
                      cx={0}
                      cy={bowlCy}
                      rx={halfW * 0.82}
                      ry={bowlD * 0.52}
                      fill={bodyFill}
                      stroke={strokeCol}
                      strokeWidth={(isSelected ? 2.4 : 1.6) * s}
                    />
                    <ellipse
                      cx={0}
                      cy={bowlCy + 1.5}
                      rx={halfW * 0.52}
                      ry={bowlD * 0.34}
                      fill="#f0f9ff"
                      stroke="#38bdf8"
                      strokeWidth={1.1 * s}
                    />
                  </g>
                  <text
                    x={boxCenter.x + normalDir.x * (halfD + 9 * s)}
                    y={boxCenter.y + normalDir.y * (halfD + 9 * s)}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#0369a1"
                    fontSize={8.5 * s}
                    fontWeight="600"
                    className="font-sans pointer-events-none"
                  >
                    {element.name}
                  </text>
                </g>
              );
            }

            if (element.kind === 'urinal') {
              const halfW = pl.clampedWidthCm * 0.5;
              const halfD = element.depthCm * 0.5;
              const outerW = halfW * 0.88;
              const innerW = halfW * 0.55;
              const strokeCol = isSelected ? '#1d4ed8' : customStrokeColor || '#0369a1';
              const bodyFill = customColor || '#ffffff';

              return (
                <g
                  key={element.id}
                  data-interactive="true"
                  data-element-id={element.id}
                  className={!readOnly ? 'cursor-move' : 'cursor-pointer'}
                  onPointerDown={startFreeDrag}
                  onDoubleClick={handleElementDoubleClick}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectElement(element.id);
                    onSelectEdge(null);
                  }}
                >
                  <g
                    transform={`matrix(${tangent.x} ${tangent.y} ${normalDir.x} ${normalDir.y} ${boxCenter.x} ${boxCenter.y})`}
                  >
                    <rect
                      x={-halfW}
                      y={-halfD}
                      width={pl.clampedWidthCm}
                      height={element.depthCm}
                      fill="transparent"
                    />
                    <path
                      d={`M ${-outerW} ${-halfD} L ${outerW} ${-halfD} L ${outerW} ${-halfD * 0.1} A ${outerW} ${halfD * 1.05} 0 0 1 ${-outerW} ${-halfD * 0.1} Z`}
                      fill={bodyFill}
                      stroke={strokeCol}
                      strokeWidth={(isSelected ? 2.4 : 1.6) * s}
                    />
                    <path
                      d={`M ${-innerW} ${-halfD + 4} L ${innerW} ${-halfD + 4} L ${innerW} ${0} A ${innerW} ${halfD * 0.72} 0 0 1 ${-innerW} ${0} Z`}
                      fill="#f0f9ff"
                      stroke="#38bdf8"
                      strokeWidth={1.1 * s}
                    />
                    <circle
                      cx={0}
                      cy={-halfD + 6}
                      r={2.4 * s}
                      fill="#94a3b8"
                    />
                  </g>
                  <text
                    x={boxCenter.x + normalDir.x * (halfD + 9 * s)}
                    y={boxCenter.y + normalDir.y * (halfD + 9 * s)}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#0369a1"
                    fontSize={8.5 * s}
                    fontWeight="600"
                    className="font-sans pointer-events-none"
                  >
                    {element.name}
                  </text>
                </g>
              );
            }

            if (element.kind === 'shower') {
              const halfW = pl.clampedWidthCm * 0.5;
              const halfD = element.depthCm * 0.5;
              const strokeCol = isSelected ? '#1d4ed8' : customStrokeColor || '#4f46e5';
              const headFill = customColor || '#eef2ff';
              const headY = -halfD + element.depthCm * 0.42;

              return (
                <g
                  key={element.id}
                  data-interactive="true"
                  data-element-id={element.id}
                  className={!readOnly ? 'cursor-move' : 'cursor-pointer'}
                  onPointerDown={startFreeDrag}
                  onDoubleClick={handleElementDoubleClick}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectElement(element.id);
                    onSelectEdge(null);
                  }}
                >
                  <g
                    transform={`matrix(${tangent.x} ${tangent.y} ${normalDir.x} ${normalDir.y} ${boxCenter.x} ${boxCenter.y})`}
                  >
                    <rect
                      x={-halfW}
                      y={-halfD}
                      width={pl.clampedWidthCm}
                      height={element.depthCm}
                      fill="transparent"
                    />
                    {/* Wall mixer bar */}
                    <rect
                      x={-halfW * 0.7}
                      y={-halfD}
                      width={pl.clampedWidthCm * 0.7}
                      height={Math.max(4, element.depthCm * 0.16)}
                      rx={1.5 * s}
                      fill="#e2e8f0"
                      stroke={strokeCol}
                      strokeWidth={1.3 * s}
                    />
                    {/* Arm & overhead rain head */}
                    <line
                      x1={0}
                      y1={-halfD + 3}
                      x2={0}
                      y2={headY}
                      stroke={strokeCol}
                      strokeWidth={2.2 * s}
                    />
                    <circle
                      cx={0}
                      cy={headY}
                      r={Math.min(halfW * 0.48, 7.5)}
                      fill={headFill}
                      stroke={strokeCol}
                      strokeWidth={(isSelected ? 2.4 : 1.6) * s}
                    />
                    {/* Spray fan rays */}
                    {[-0.65, -0.32, 0, 0.32, 0.65].map((frac, idx) => (
                      <line
                        key={idx}
                        x1={0}
                        y1={headY + 4}
                        x2={halfW * 0.75 * frac}
                        y2={halfD}
                        stroke={customStrokeColor || '#6366f1'}
                        strokeOpacity="0.6"
                        strokeWidth={1.1 * s}
                        strokeDasharray={`${3 * s} ${2.5 * s}`}
                      />
                    ))}
                  </g>
                  <text
                    x={boxCenter.x + normalDir.x * (halfD + 9 * s)}
                    y={boxCenter.y + normalDir.y * (halfD + 9 * s)}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#4338ca"
                    fontSize={8.5 * s}
                    fontWeight="600"
                    className="font-sans pointer-events-none"
                  >
                    {element.name}
                  </text>
                </g>
              );
            }

            if (element.kind === 'sink') {
              const halfW = pl.clampedWidthCm * 0.5;
              const halfD = element.depthCm * 0.5;
              const strokeCol = isSelected ? '#1d4ed8' : customStrokeColor || '#0891b2';
              const topFill = customColor || '#ecfeff';

              return (
                <g
                  key={element.id}
                  data-interactive="true"
                  data-element-id={element.id}
                  className={!readOnly ? 'cursor-move' : 'cursor-pointer'}
                  onPointerDown={startFreeDrag}
                  onDoubleClick={handleElementDoubleClick}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectElement(element.id);
                    onSelectEdge(null);
                  }}
                >
                  <g
                    transform={`matrix(${tangent.x} ${tangent.y} ${normalDir.x} ${normalDir.y} ${boxCenter.x} ${boxCenter.y})`}
                  >
                    {/* Countertop */}
                    <rect
                      x={-halfW}
                      y={-halfD}
                      width={pl.clampedWidthCm}
                      height={element.depthCm}
                      rx={3 * s}
                      fill={topFill}
                      stroke={strokeCol}
                      strokeWidth={(isSelected ? 2.5 : 1.7) * s}
                    />
                    {/* Ceramic basin */}
                    <rect
                      x={-halfW * 0.78}
                      y={-halfD + element.depthCm * 0.18}
                      width={pl.clampedWidthCm * 0.78}
                      height={element.depthCm * 0.68}
                      rx={6 * s}
                      fill="#ffffff"
                      stroke="#06b6d4"
                      strokeWidth={1.3 * s}
                    />
                    {/* Drain */}
                    <circle
                      cx={0}
                      cy={-halfD + element.depthCm * 0.52}
                      r={Math.min(3.5, halfW * 0.14)}
                      fill="#cffafe"
                      stroke="#0891b2"
                      strokeWidth={1.1 * s}
                    />
                    {/* Faucet spout & deck */}
                    <line
                      x1={0}
                      y1={-halfD + 3}
                      x2={0}
                      y2={-halfD + element.depthCm * 0.34}
                      stroke="#334155"
                      strokeWidth={2.4 * s}
                      strokeLinecap="round"
                    />
                    <circle cx={-5} cy={-halfD + 5} r={1.8 * s} fill="#64748b" />
                    <circle cx={5} cy={-halfD + 5} r={1.8 * s} fill="#64748b" />
                  </g>
                  <text
                    x={boxCenter.x + normalDir.x * (halfD + 9 * s)}
                    y={boxCenter.y + normalDir.y * (halfD + 9 * s)}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#0e7490"
                    fontSize={8.5 * s}
                    fontWeight="600"
                    className="font-sans pointer-events-none"
                  >
                    {element.name}
                  </text>
                </g>
              );
            }

            if (element.kind === 'bed_curtain') {
              const halfW = pl.clampedWidthCm * 0.5;
              const halfD = element.depthCm * 0.5;
              const lTrackPath = `M ${-halfW} ${-halfD} L ${-halfW} ${halfD} L ${halfW} ${halfD}`;

              // Build pleated wave path along both L arms
              const waveSegments: string[] = [];
              const step = 14;
              const amp = 4.2;
              const vSteps = Math.max(4, Math.round((halfD * 2) / step));
              waveSegments.push(`M ${-halfW} ${-halfD}`);
              for (let i = 1; i <= vSteps; i++) {
                const yPos = -halfD + (i / vSteps) * (halfD * 2);
                const xOff = i === vSteps ? 0 : (i % 2 === 1 ? amp : -amp);
                waveSegments.push(`L ${-halfW + xOff} ${yPos}`);
              }
              const hSteps = Math.max(4, Math.round((halfW * 2) / step));
              for (let i = 1; i <= hSteps; i++) {
                const xPos = -halfW + (i / hSteps) * (halfW * 2);
                const yOff = i === hSteps ? 0 : (i % 2 === 1 ? -amp : amp);
                waveSegments.push(`L ${xPos} ${halfD + yOff}`);
              }
              const wavePath = waveSegments.join(' ');
              const labelPt = {
                x: boxCenter.x - tangent.x * (halfW * 0.35) + normalDir.x * (halfD + 11 * s),
                y: boxCenter.y - tangent.y * (halfW * 0.35) + normalDir.y * (halfD + 11 * s),
              };

              return (
                <g
                  key={element.id}
                  data-interactive="true"
                  data-element-id={element.id}
                  className={!readOnly ? 'cursor-move' : 'cursor-pointer'}
                  onPointerDown={startFreeDrag}
                  onDoubleClick={handleElementDoubleClick}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectElement(element.id);
                    onSelectEdge(null);
                  }}
                >
                  <g
                    transform={`matrix(${tangent.x} ${tangent.y} ${normalDir.x} ${normalDir.y} ${boxCenter.x} ${boxCenter.y})`}
                  >
                    {/* Hit stroke ONLY along the L arms so beds inside stay clickable */}
                    <path
                      d={lTrackPath}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={38 * s}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {/* Dashed ceiling L-track */}
                    <path
                      d={lTrackPath}
                      fill="none"
                      stroke={isSelected ? '#1d4ed8' : customStrokeColor || '#047857'}
                      strokeWidth={(isSelected ? 2.8 : 2) * s}
                      strokeDasharray={`${6 * s} ${4 * s}`}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {/* Pleated fabric line */}
                    <path
                      d={wavePath}
                      fill="none"
                      stroke={isSelected ? '#3b82f6' : customColor || '#10b981'}
                      strokeWidth={(isSelected ? 2.2 : 1.7) * s}
                      strokeLinejoin="round"
                    />
                    {/* Track end & corner grab handle */}
                    <circle cx={-halfW} cy={-halfD} r={3.5 * s} fill={customStrokeColor || '#047857'} />
                    <circle
                      cx={-halfW}
                      cy={halfD}
                      r={6.5 * s}
                      fill="#ecfdf5"
                      stroke={isSelected ? '#1d4ed8' : customStrokeColor || '#047857'}
                      strokeWidth={2 * s}
                    />
                    <circle cx={halfW} cy={halfD} r={3.5 * s} fill={customStrokeColor || '#047857'} />
                  </g>
                  <text
                    x={labelPt.x}
                    y={labelPt.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#047857"
                    fontSize={8.8 * s}
                    fontWeight="600"
                    className={!readOnly ? 'font-sans cursor-move' : 'font-sans pointer-events-none'}
                  >
                    {element.name} ({Math.round(pl.clampedWidthCm)}×{Math.round(element.depthCm)})
                  </text>
                </g>
              );
            }

            if (isLightingElementKind(element.kind)) {
              const halfW = pl.clampedWidthCm * 0.5;
              const halfD = element.depthCm * 0.5;
              const isOn = element.lightOn !== false;
              const activeStroke = isSelected
                ? '#1d4ed8'
                : customStrokeColor || (isOn ? '#d97706' : '#64748b');
              const glowFill = customColor || (isOn ? '#fef08a' : '#f1f5f9');

              return (
                <g
                  key={element.id}
                  data-interactive="true"
                  data-element-id={element.id}
                  className={!readOnly ? 'cursor-move' : 'cursor-pointer'}
                  onPointerDown={startFreeDrag}
                  onDoubleClick={handleElementDoubleClick}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectElement(element.id);
                    onSelectEdge(null);
                  }}
                >
                  <g
                    transform={`matrix(${tangent.x} ${tangent.y} ${normalDir.x} ${normalDir.y} ${boxCenter.x} ${boxCenter.y})`}
                  >
                    {element.kind === 'panel_light' && (
                      <>
                        {isOn && (
                          <rect
                            x={-halfW - 4}
                            y={-halfD - 4}
                            width={pl.clampedWidthCm + 8}
                            height={element.depthCm + 8}
                            rx={4 * s}
                            fill="#fde047"
                            fillOpacity="0.22"
                          />
                        )}
                        <rect
                          x={-halfW}
                          y={-halfD}
                          width={pl.clampedWidthCm}
                          height={element.depthCm}
                          rx={2 * s}
                          fill={glowFill}
                          fillOpacity={isOn ? 0.85 : 0.72}
                          stroke={activeStroke}
                          strokeWidth={(isSelected ? 2.4 : 1.7) * s}
                          strokeDasharray={`${5 * s} ${3 * s}`}
                        />
                        <line
                          x1={-halfW}
                          y1={0}
                          x2={halfW}
                          y2={0}
                          stroke={activeStroke}
                          strokeOpacity="0.45"
                          strokeWidth={1.1 * s}
                        />
                        <line
                          x1={0}
                          y1={-halfD}
                          x2={0}
                          y2={halfD}
                          stroke={activeStroke}
                          strokeOpacity="0.45"
                          strokeWidth={1.1 * s}
                        />
                      </>
                    )}

                    {element.kind === 'track_light' && (
                      <>
                        <rect
                          x={-halfW}
                          y={-halfD}
                          width={pl.clampedWidthCm}
                          height={element.depthCm}
                          fill="transparent"
                        />
                        <line
                          x1={-halfW}
                          y1={0}
                          x2={halfW}
                          y2={0}
                          stroke={isSelected ? '#1d4ed8' : '#334155'}
                          strokeWidth={3.2 * s}
                          strokeLinecap="round"
                        />
                        {[-0.32, 0, 0.32].map((frac, idx) => (
                          <g key={idx} transform={`translate(${pl.clampedWidthCm * frac}, 0)`}>
                            <circle
                              cx={0}
                              cy={0}
                              r={Math.min(5.5, Math.max(3.6, element.depthCm * 0.32))}
                              fill={glowFill}
                              stroke={activeStroke}
                              strokeWidth={1.5 * s}
                            />
                            {isOn && (
                              <circle cx={0} cy={0} r={2.2 * s} fill="#f59e0b" />
                            )}
                          </g>
                        ))}
                      </>
                    )}

                    {element.kind === 'recessed_light' && (
                      <>
                        {isOn && (
                          <circle
                            cx={0}
                            cy={0}
                            r={Math.max(halfW, halfD) + 5}
                            fill="#fde047"
                            fillOpacity="0.28"
                          />
                        )}
                        <circle
                          cx={0}
                          cy={0}
                          r={Math.max(halfW, halfD)}
                          fill={glowFill}
                          stroke={activeStroke}
                          strokeWidth={(isSelected ? 2.4 : 1.7) * s}
                        />
                        <circle
                          cx={0}
                          cy={0}
                          r={Math.max(halfW, halfD) * 0.56}
                          fill={isOn ? '#fef9c3' : '#e2e8f0'}
                          stroke={activeStroke}
                          strokeWidth={1.1 * s}
                        />
                      </>
                    )}

                    {element.kind === 'wall_sconce' && (
                      <>
                        <rect
                          x={-halfW}
                          y={-halfD}
                          width={pl.clampedWidthCm}
                          height={element.depthCm}
                          fill="transparent"
                        />
                        {isOn && (
                          <circle
                            cx={0}
                            cy={halfD * 0.25}
                            r={Math.max(halfW, halfD) + 4}
                            fill="#fed7aa"
                            fillOpacity="0.32"
                          />
                        )}
                        <rect
                          x={-halfW * 0.68}
                          y={-halfD}
                          width={pl.clampedWidthCm * 0.68}
                          height={Math.max(4, element.depthCm * 0.28)}
                          fill="#475569"
                        />
                        <path
                          d={`M ${-halfW * 0.78} ${-halfD * 0.4} A ${halfW * 0.78} ${element.depthCm * 0.72} 0 0 0 ${halfW * 0.78} ${-halfD * 0.4} Z`}
                          fill={glowFill}
                          stroke={activeStroke}
                          strokeWidth={(isSelected ? 2.4 : 1.6) * s}
                        />
                      </>
                    )}
                  </g>
                  <text
                    x={boxCenter.x + normalDir.x * (halfD + 11 * s)}
                    y={boxCenter.y + normalDir.y * (halfD + 11 * s)}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={isOn ? '#b45309' : '#64748b'}
                    fontSize={8.5 * s}
                    fontWeight="600"
                    className="font-sans pointer-events-none"
                  >
                    {element.name}
                    {isOn ? '' : ' (關)'}
                  </text>
                </g>
              );
            }

            if (!edge) return null;

            if (element.kind === 'window') {
              const offsetSide = wallStroke * 0.3;
              const customWinHex = sanitizeHexColor(element.color);
              const winFrameStroke = isSelected
                ? '#1d4ed8'
                : customWinHex
                  ? darkenHexColor(customWinHex, 0.72)
                  : '#0284c7';
              const winGlassStroke = customWinHex ?? '#38bdf8';
              const winTextFill = customWinHex ? darkenHexColor(customWinHex, 0.56) : '#0369a1';
              return (
                <g
                  key={element.id}
                  data-interactive="true"
                  data-element-id={element.id}
                  className={!readOnly ? 'cursor-grab' : 'cursor-pointer'}
                  onPointerDown={startFreeDrag}
                  onDoubleClick={handleElementDoubleClick}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectElement(element.id);
                    onSelectEdge(null);
                  }}
                >
                  {/* Clear wall background for window */}
                  <line
                    x1={startPoint.x}
                    y1={startPoint.y}
                    x2={endPoint.x}
                    y2={endPoint.y}
                    stroke={edge.isInterior ? '#f8fafc' : '#ffffff'}
                    strokeWidth={wallStroke + 2}
                    strokeLinecap="butt"
                  />
                  {/* Outer sill lines */}
                  <line
                    x1={startPoint.x + edge.outwardNormal.x * offsetSide}
                    y1={startPoint.y + edge.outwardNormal.y * offsetSide}
                    x2={endPoint.x + edge.outwardNormal.x * offsetSide}
                    y2={endPoint.y + edge.outwardNormal.y * offsetSide}
                    stroke={winFrameStroke}
                    strokeWidth={2 * s}
                  />
                  <line
                    x1={startPoint.x - edge.outwardNormal.x * offsetSide}
                    y1={startPoint.y - edge.outwardNormal.y * offsetSide}
                    x2={endPoint.x - edge.outwardNormal.x * offsetSide}
                    y2={endPoint.y - edge.outwardNormal.y * offsetSide}
                    stroke={winFrameStroke}
                    strokeWidth={2 * s}
                  />
                  {/* Center glass pane line */}
                  <line
                    x1={startPoint.x}
                    y1={startPoint.y}
                    x2={endPoint.x}
                    y2={endPoint.y}
                    stroke={winGlassStroke}
                    strokeWidth={3.2 * s}
                  />
                  <text
                    x={center.x + edge.inwardNormal.x * 18 * s}
                    y={center.y + edge.inwardNormal.y * 18 * s}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={winTextFill}
                    fontSize={9.5 * s}
                    fontWeight="600"
                    className="pointer-events-none"
                  >
                    {element.name} ({formatDimension(pl.clampedWidthCm, project.unit, false)})
                  </text>
                </g>
              );
            }

            // Door architectural symbol: swinging (leaf + 90-deg arc) OR sliding (inner/outer track + slid panel + direction arrow)
            const { mode: doorMode, side: doorSide, dir: doorDir } = parseDoorSwing(
              element.swingDirection
            );
            const swingNormal = doorSide === 'outward' ? pl.outwardNormal : pl.inwardNormal;
            const customDoorHex = sanitizeHexColor(element.color);
            const doorLeafStroke = isSelected
              ? '#1d4ed8'
              : customDoorHex
                ? darkenHexColor(customDoorHex, 0.78)
                : '#0f172a';
            const doorAccentStroke = isSelected
              ? '#1d4ed8'
              : customDoorHex
                ? darkenHexColor(customDoorHex, 0.65)
                : '#2563eb';
            const doorTextFill = customDoorHex ? darkenHexColor(customDoorHex, 0.56) : '#1e40af';

            if (doorMode === 'sliding') {
              const slideDirVec: Point2D =
                doorDir === 'right' ? tangent : { x: -tangent.x, y: -tangent.y };
              const trackOff = wallStroke * 0.65 + 4 * s;
              const railStartAnchor = doorDir === 'right' ? startPoint : endPoint;
              const railOpenEnd = doorDir === 'right' ? endPoint : startPoint;
              const railStart: Point2D = {
                x: railStartAnchor.x + swingNormal.x * trackOff,
                y: railStartAnchor.y + swingNormal.y * trackOff,
              };
              const railEnd: Point2D = {
                x:
                  railOpenEnd.x +
                  slideDirVec.x * (pl.clampedWidthCm * 0.72) +
                  swingNormal.x * trackOff,
                y:
                  railOpenEnd.y +
                  slideDirVec.y * (pl.clampedWidthCm * 0.72) +
                  swingNormal.y * trackOff,
              };
              const shiftDist = pl.clampedWidthCm * 0.55;
              const leafStart: Point2D = {
                x: startPoint.x + slideDirVec.x * shiftDist + swingNormal.x * trackOff,
                y: startPoint.y + slideDirVec.y * shiftDist + swingNormal.y * trackOff,
              };
              const leafEnd: Point2D = {
                x: endPoint.x + slideDirVec.x * shiftDist + swingNormal.x * trackOff,
                y: endPoint.y + slideDirVec.y * shiftDist + swingNormal.y * trackOff,
              };
              const arrowOff = trackOff + 10 * s;
              const arrA: Point2D = {
                x:
                  center.x -
                  slideDirVec.x * (pl.clampedWidthCm * 0.25) +
                  swingNormal.x * arrowOff,
                y:
                  center.y -
                  slideDirVec.y * (pl.clampedWidthCm * 0.25) +
                  swingNormal.y * arrowOff,
              };
              const arrB: Point2D = {
                x:
                  center.x +
                  slideDirVec.x * (pl.clampedWidthCm * 0.25) +
                  swingNormal.x * arrowOff,
                y:
                  center.y +
                  slideDirVec.y * (pl.clampedWidthCm * 0.25) +
                  swingNormal.y * arrowOff,
              };
              const headL: Point2D = {
                x: arrB.x - slideDirVec.x * 7 * s + swingNormal.x * 4 * s,
                y: arrB.y - slideDirVec.y * 7 * s + swingNormal.y * 4 * s,
              };
              const headR: Point2D = {
                x: arrB.x - slideDirVec.x * 7 * s - swingNormal.x * 4 * s,
                y: arrB.y - slideDirVec.y * 7 * s - swingNormal.y * 4 * s,
              };

              return (
                <g
                  key={element.id}
                  data-interactive="true"
                  data-element-id={element.id}
                  data-door-swing={element.swingDirection || 'inward-right'}
                  className={!readOnly ? 'cursor-grab' : 'cursor-pointer'}
                  onPointerDown={startFreeDrag}
                  onDoubleClick={handleElementDoubleClick}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectElement(element.id);
                    onSelectEdge(null);
                  }}
                >
                  {/* Full opening & track hit target */}
                  <polygon
                    points={`${startPoint.x - swingNormal.x * wallStroke * 0.5},${startPoint.y - swingNormal.y * wallStroke * 0.5} ${endPoint.x - swingNormal.x * wallStroke * 0.5},${endPoint.y - swingNormal.y * wallStroke * 0.5} ${endPoint.x + swingNormal.x * (trackOff + 14 * s)},${endPoint.y + swingNormal.y * (trackOff + 14 * s)} ${startPoint.x + swingNormal.x * (trackOff + 14 * s)},${startPoint.y + swingNormal.y * (trackOff + 14 * s)}`}
                    fill="transparent"
                    stroke="none"
                  />
                  {/* Clear wall fill at door opening */}
                  <line
                    x1={startPoint.x}
                    y1={startPoint.y}
                    x2={endPoint.x}
                    y2={endPoint.y}
                    stroke="#f8fafc"
                    strokeWidth={wallStroke + 2}
                    strokeLinecap="butt"
                  />
                  {/* Threshold dashed guide */}
                  <line
                    x1={startPoint.x}
                    y1={startPoint.y}
                    x2={endPoint.x}
                    y2={endPoint.y}
                    stroke="#94a3b8"
                    strokeWidth={1.2 * s}
                    strokeDasharray={`${4 * s} ${3 * s}`}
                  />
                  {/* Sliding track rail */}
                  <line
                    x1={railStart.x}
                    y1={railStart.y}
                    x2={railEnd.x}
                    y2={railEnd.y}
                    stroke={isSelected ? '#2563eb' : '#64748b'}
                    strokeWidth={1.6 * s}
                    strokeDasharray={`${4 * s} ${3 * s}`}
                  />
                  {/* Slid door panel */}
                  <line
                    x1={leafStart.x}
                    y1={leafStart.y}
                    x2={leafEnd.x}
                    y2={leafEnd.y}
                    stroke={doorLeafStroke}
                    strokeWidth={4.4 * s}
                    strokeLinecap="square"
                  />
                  {/* Direction arrow */}
                  <line
                    x1={arrA.x}
                    y1={arrA.y}
                    x2={arrB.x}
                    y2={arrB.y}
                    stroke={doorAccentStroke}
                    strokeWidth={1.6 * s}
                  />
                  <polygon
                    points={`${arrB.x},${arrB.y} ${headL.x},${headL.y} ${headR.x},${headR.y}`}
                    fill={doorAccentStroke}
                  />
                  {/* Sliding door label */}
                  <text
                    x={center.x + swingNormal.x * (arrowOff + 13 * s)}
                    y={center.y + swingNormal.y * (arrowOff + 13 * s)}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={doorTextFill}
                    fontSize={9.5 * s}
                    fontWeight="600"
                    className="pointer-events-none"
                  >
                    {element.name} ({doorSide === 'inward' ? '內橫拉' : '外橫拉'})
                  </text>
                </g>
              );
            }

            const isHingeEnd = doorDir === 'right';
            const hinge = isHingeEnd ? endPoint : startPoint;
            const latch = isHingeEnd ? startPoint : endPoint;
            const leafTip: Point2D = {
              x: hinge.x + swingNormal.x * pl.clampedWidthCm,
              y: hinge.y + swingNormal.y * pl.clampedWidthCm,
            };

            // Determine SVG arc sweep flag using cross product of (latch - hinge) x (leafTip - hinge)
            const vx1 = latch.x - hinge.x;
            const vy1 = latch.y - hinge.y;
            const vx2 = leafTip.x - hinge.x;
            const vy2 = leafTip.y - hinge.y;
            const cross = vx1 * vy2 - vy1 * vx2;
            const sweepFlag = cross >= 0 ? 1 : 0;

            return (
              <g
                key={element.id}
                data-interactive="true"
                data-element-id={element.id}
                data-door-swing={element.swingDirection || 'inward-right'}
                className={!readOnly ? 'cursor-grab' : 'cursor-pointer'}
                onPointerDown={startFreeDrag}
                onDoubleClick={handleElementDoubleClick}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectElement(element.id);
                  onSelectEdge(null);
                }}
              >
                {/* Clear wall fill at door opening */}
                <line
                  x1={startPoint.x}
                  y1={startPoint.y}
                  x2={endPoint.x}
                  y2={endPoint.y}
                  stroke="#f8fafc"
                  strokeWidth={wallStroke + 2}
                  strokeLinecap="butt"
                />
                {/* Door threshold line */}
                <line
                  x1={startPoint.x}
                  y1={startPoint.y}
                  x2={endPoint.x}
                  y2={endPoint.y}
                  stroke="#94a3b8"
                  strokeWidth={1.2 * s}
                  strokeDasharray={`${4 * s} ${3 * s}`}
                />
                {/* 90-degree swing sector hit & subtle architectural fill */}
                <path
                  d={`M ${hinge.x} ${hinge.y} L ${latch.x} ${latch.y} A ${pl.clampedWidthCm} ${pl.clampedWidthCm} 0 0 ${sweepFlag} ${leafTip.x} ${leafTip.y} Z`}
                  fill="rgba(37, 99, 235, 0.05)"
                  stroke="none"
                />
                {/* Door leaf */}
                <line
                  x1={hinge.x}
                  y1={hinge.y}
                  x2={leafTip.x}
                  y2={leafTip.y}
                  stroke={doorLeafStroke}
                  strokeWidth={3.5 * s}
                  strokeLinecap="round"
                />
                {/* 90-degree swing arc */}
                <path
                  d={`M ${latch.x} ${latch.y} A ${pl.clampedWidthCm} ${pl.clampedWidthCm} 0 0 ${sweepFlag} ${leafTip.x} ${leafTip.y}`}
                  fill="none"
                  stroke={doorAccentStroke}
                  strokeWidth={1.5 * s}
                  strokeDasharray={`${5 * s} ${4 * s}`}
                />
                {/* Label inside arc */}
                <text
                  x={center.x + swingNormal.x * Math.min(48 * s, pl.clampedWidthCm * 0.45)}
                  y={center.y + swingNormal.y * Math.min(48 * s, pl.clampedWidthCm * 0.45)}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={doorTextFill}
                  fontSize={10 * s}
                  fontWeight="600"
                  className="pointer-events-none"
                >
                  {element.name}
                </text>
              </g>
            );
          })}

          {/* Architectural Dimension Callouts */}
          {showDimensions &&
            edgeLabels.map(({ edge: se, normalDir, dimStart, dimEnd, textPos, angleDeg, text }) => {
              const isSelected = selectedEdgeId === se.id;
              return (
                <g
                  key={`dim-${se.id}`}
                  data-interactive="true"
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectEdge(se.id);
                    onSelectElement(null);
                  }}
                >
                  {/* Witness extension lines */}
                  <line
                    x1={se.start.x + normalDir.x * 8 * s}
                    y1={se.start.y + normalDir.y * 8 * s}
                    x2={dimStart.x + normalDir.x * 4 * s}
                    y2={dimStart.y + normalDir.y * 4 * s}
                    stroke="#cbd5e1"
                    strokeWidth={1 * s}
                  />
                  <line
                    x1={se.end.x + normalDir.x * 8 * s}
                    y1={se.end.y + normalDir.y * 8 * s}
                    x2={dimEnd.x + normalDir.x * 4 * s}
                    y2={dimEnd.y + normalDir.y * 4 * s}
                    stroke="#cbd5e1"
                    strokeWidth={1 * s}
                  />
                  {/* Dimension line */}
                  <line
                    x1={dimStart.x}
                    y1={dimStart.y}
                    x2={dimEnd.x}
                    y2={dimEnd.y}
                    stroke={isSelected ? '#2563eb' : '#64748b'}
                    strokeWidth={1.1 * s}
                  />
                  {/* Endpoint ticks */}
                  <circle cx={dimStart.x} cy={dimStart.y} r={2 * s} fill="#64748b" />
                  <circle cx={dimEnd.x} cy={dimEnd.y} r={2 * s} fill="#64748b" />
                  {/* Label */}
                  <g transform={`translate(${textPos.x}, ${textPos.y}) rotate(${angleDeg})`}>
                    <rect
                      x={(-text.length * 3.7 - 6) * s}
                      y={-8 * s}
                      width={(text.length * 7.4 + 12) * s}
                      height={16 * s}
                      rx={3 * s}
                      fill={isSelected ? '#eff6ff' : 'rgba(255,255,255,0.92)'}
                      stroke={isSelected ? '#2563eb' : 'none'}
                      strokeWidth={1 * s}
                    />
                    <text
                      x={0}
                      y={0.5 * s}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill={isSelected ? '#1d4ed8' : '#0f172a'}
                      fontSize={10.5 * s}
                      fontWeight={isSelected ? '700' : '600'}
                      className="font-mono tabular-nums"
                    >
                      {text}
                    </text>
                  </g>
                </g>
              );
            })}

          {/* Interactive Rotation Handle for Selected Furniture */}
          {!readOnly &&
            placements
              .filter(
                (pl) =>
                  pl.element.id === selectedElementId &&
                  pl.element.kind !== 'door' &&
                  pl.element.kind !== 'window'
              )
            .map((pl) => {
              const halfD = pl.element.depthCm * 0.5;
              const stemEnd: Point2D = {
                x: pl.boxCenter.x + pl.facingNormal.x * (halfD + 26 * s),
                y: pl.boxCenter.y + pl.facingNormal.y * (halfD + 26 * s),
              };
              const arrowBase: Point2D = {
                x: pl.boxCenter.x + pl.facingNormal.x * (halfD + 8 * s),
                y: pl.boxCenter.y + pl.facingNormal.y * (halfD + 8 * s),
              };
              const baseTangent: Point2D =
                pl.placementMode === 'wall' && pl.edge
                  ? pl.edge.tangent
                  : { x: 1, y: 0 };
              const baseNormal: Point2D =
                pl.placementMode === 'wall' && pl.edge
                  ? pl.element.side === 'outside'
                    ? pl.edge.outwardNormal
                    : pl.edge.inwardNormal
                  : { x: 0, y: 1 };

              return (
                <g key={`rot-handle-${pl.element.id}`} data-export-exclude="true">
                  <line
                    x1={arrowBase.x}
                    y1={arrowBase.y}
                    x2={stemEnd.x}
                    y2={stemEnd.y}
                    stroke="#2563eb"
                    strokeWidth={1.6 * s}
                    strokeDasharray={`${3 * s} ${2 * s}`}
                    className="pointer-events-none"
                  />
                  <circle
                    cx={stemEnd.x}
                    cy={stemEnd.y}
                    r={9 * s}
                    fill="#2563eb"
                    stroke="#ffffff"
                    strokeWidth={2 * s}
                    data-interactive="true"
                    data-testid="rotation-handle"
                    aria-label={`旋轉 ${pl.element.name}`}
                    className="cursor-grab active:cursor-grabbing"
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      if (e.button !== 0 || !onRotateElement) return;
                      onBeginElementInteraction?.();
                      suppressNextSvgClickRef.current = true;
                      rotatingElRef.current = {
                        id: pl.element.id,
                        boxCenter: pl.boxCenter,
                        baseTangent,
                        baseNormal,
                      };
                      e.currentTarget.setPointerCapture?.(e.pointerId);
                    }}
                  />
                  <text
                    x={stemEnd.x}
                    y={stemEnd.y + 0.5 * s}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#ffffff"
                    fontSize={8 * s}
                    fontWeight="700"
                    className="pointer-events-none select-none"
                  >
                    ↻
                  </text>
                </g>
              );
            })}

          {/* 4-Side Wall Clearances Overlay for Elements with showWallDistances enabled */}
          {placements
            .filter((pl) => pl.element.showWallDistances)
            .map((pl) => {
              const result = computeElementWallClearances(pl, solved, project.wallThicknessCm);
              return (
                <g key={`wall-clear-${pl.element.id}`} className="pointer-events-none">
                  {result.rays.map((ray) => {
                    if (ray.distanceCm < 1) return null;
                    const mx = (ray.start.x + ray.end.x) * 0.5;
                    const my = (ray.start.y + ray.end.y) * 0.5;
                    const distTxt = formatDimension(ray.distanceCm, project.unit);
                    const boxW = Math.max(46, distTxt.length * 6.8 + 10) * s;
                    return (
                      <g key={`ray-${pl.element.id}-${ray.side}`}>
                        <line
                          x1={ray.start.x}
                          y1={ray.start.y}
                          x2={ray.end.x}
                          y2={ray.end.y}
                          stroke="#0d9488"
                          strokeWidth={1.6 * s}
                          strokeDasharray={`${5 * s} ${3 * s}`}
                        />
                        <circle cx={ray.start.x} cy={ray.start.y} r={2.2 * s} fill="#0d9488" />
                        <circle cx={ray.end.x} cy={ray.end.y} r={2.6 * s} fill="#0f766e" />
                        <rect
                          x={mx - boxW * 0.5}
                          y={my - 8 * s}
                          width={boxW}
                          height={16 * s}
                          rx={3 * s}
                          fill="#f0fdfa"
                          stroke="#0d9488"
                          strokeWidth={1 * s}
                        />
                        <text
                          x={mx}
                          y={my}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fill="#0f766e"
                          fontSize={9 * s}
                          fontWeight="700"
                          className="font-mono tabular-nums"
                        >
                          {distTxt}
                        </text>
                      </g>
                    );
                  })}
                </g>
              );
            })}

          {/* Architectural Section Cut Lines (剖面線) */}
          {(project.sectionLines ?? []).map((sec) => {
            const isSel = selectedSectionId === sec.id;
            const { lookDir, cutDir } = getSectionBasis(sec);
            const arrowLen = 28 * s;
            const headLen = 9 * s;
            const tag = sec.label.split('-')[0] || 'A';
            const midX = (sec.startXCm + sec.endXCm) * 0.5;
            const midY = (sec.startYCm + sec.endYCm) * 0.5;
            const strokeColor = isSel ? '#be123c' : '#e11d48';

            const renderArrow = (px: number, py: number, len: number) => {
              const tx = px + lookDir.x * len;
              const ty = py + lookDir.y * len;
              const leftX = tx - lookDir.x * headLen + cutDir.x * (headLen * 0.55);
              const leftY = ty - lookDir.y * headLen + cutDir.y * (headLen * 0.55);
              const rightX = tx - lookDir.x * headLen - cutDir.x * (headLen * 0.55);
              const rightY = ty - lookDir.y * headLen - cutDir.y * (headLen * 0.55);
              return (
                <g className="pointer-events-none">
                  <line
                    x1={px}
                    y1={py}
                    x2={tx}
                    y2={ty}
                    stroke={strokeColor}
                    strokeWidth={2.2 * s}
                  />
                  <polygon
                    points={`${tx},${ty} ${leftX},${leftY} ${rightX},${rightY}`}
                    fill={strokeColor}
                  />
                </g>
              );
            };

            return (
              <g
                key={sec.id}
                data-interactive="true"
                data-section-id={sec.id}
                className="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectSection?.(sec.id);
                  onSelectElement(null);
                  onSelectEdge(null);
                }}
              >
                <line
                  x1={sec.startXCm}
                  y1={sec.startYCm}
                  x2={sec.endXCm}
                  y2={sec.endYCm}
                  stroke="transparent"
                  strokeWidth={20 * s}
                />
                <line
                  x1={sec.startXCm}
                  y1={sec.startYCm}
                  x2={sec.endXCm}
                  y2={sec.endYCm}
                  stroke={strokeColor}
                  strokeWidth={(isSel ? 3 : 2.2) * s}
                  strokeDasharray={`${14 * s} ${4 * s} ${3 * s} ${4 * s}`}
                />
                {renderArrow(sec.startXCm, sec.startYCm, arrowLen)}
                {renderArrow(midX, midY, arrowLen * 0.85)}
                {renderArrow(sec.endXCm, sec.endYCm, arrowLen)}

                {[
                  { ep: 'start' as const, x: sec.startXCm, y: sec.startYCm, text: tag },
                  { ep: 'end' as const, x: sec.endXCm, y: sec.endYCm, text: `${tag}'` },
                ].map((node) => (
                  <g
                    key={node.ep}
                    className={readOnly ? 'cursor-pointer' : 'cursor-move'}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      if (readOnly || e.button !== 0 || !onUpdateSectionLine) return;
                      onBeginElementInteraction?.();
                      onSelectSection?.(sec.id);
                      onSelectElement(null);
                      onSelectEdge(null);
                      draggingSectionEndpointRef.current = {
                        sectionId: sec.id,
                        endpoint: node.ep,
                      };
                      e.currentTarget.setPointerCapture?.(e.pointerId);
                    }}
                  >
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={(isSel ? 12 : 10.5) * s}
                      fill={strokeColor}
                      stroke="#ffffff"
                      strokeWidth={2 * s}
                    />
                    <text
                      x={node.x}
                      y={node.y + 0.5 * s}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#ffffff"
                      fontSize={9.5 * s}
                      fontWeight="700"
                      className="pointer-events-none select-none"
                    >
                      {node.text}
                    </text>
                  </g>
                ))}
              </g>
            );
          })}

          {/* Draft Section Cut Line While Drawing */}
          {draftSection && (
            <g className="pointer-events-none" data-export-exclude="true">
              <line
                x1={draftSection.startX}
                y1={draftSection.startY}
                x2={draftSection.endX}
                y2={draftSection.endY}
                stroke="#e11d48"
                strokeWidth={2.6 * s}
                strokeDasharray={`${10 * s} ${4 * s}`}
              />
              <circle cx={draftSection.startX} cy={draftSection.startY} r={6 * s} fill="#e11d48" />
              <circle cx={draftSection.endX} cy={draftSection.endY} r={6 * s} fill="#e11d48" />
            </g>
          )}

          {/* Magnetic Snap Alignment Guides (active only while dragging) */}
          {snapGuides.length > 0 && (
            <g className="pointer-events-none" data-export-exclude="true">
              {snapGuides.map((g, idx) => (
                <line
                  key={`snap-guide-${idx}`}
                  data-testid="snap-guide"
                  x1={g.axis === 'x' ? g.positionCm : g.startCm}
                  y1={g.axis === 'y' ? g.positionCm : g.startCm}
                  x2={g.axis === 'x' ? g.positionCm : g.endCm}
                  y2={g.axis === 'y' ? g.positionCm : g.endCm}
                  stroke={g.reason === 'wall' ? '#ec4899' : g.reason === 'element' ? '#0284c7' : '#8b5cf6'}
                  strokeWidth={1.8 * s}
                  strokeDasharray={`${5 * s} ${3 * s}`}
                />
              ))}
            </g>
          )}

          {/* Room Center Summary Watermark Info (clean architectural tag) */}
          {solved.polygonPoints.length >= 3 && (
            <g className="pointer-events-none">
              <text
                x={solved.bounds.centerX}
                y={solved.bounds.centerY - 8 * s}
                textAnchor="middle"
                fill="#475569"
                fontSize={13 * s}
                fontWeight="600"
              >
                {solved.areaSqMeters.toFixed(2)} m² · {solved.areaPing.toFixed(2)} 坪
              </text>
              <text
                x={solved.bounds.centerX}
                y={solved.bounds.centerY + 10 * s}
                textAnchor="middle"
                fill="#64748b"
                fontSize={10.5 * s}
                className="font-mono tabular-nums"
              >
                天花高度 {formatDimension(project.ceilingHeightCm, project.unit)}
              </text>
            </g>
          )}
        </svg>

        {/* Section Draw Mode Top Prompt Banner */}
        {sectionDrawMode && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-rose-600 text-white px-4 py-1.5 rounded-lg shadow-md text-xs font-semibold flex items-center gap-3 whitespace-nowrap">
            <span>剖面線繪製模式：在平面圖按住左鍵拖曳切出剖面線</span>
            <button
              type="button"
              onClick={() => onSetSectionDrawMode?.(false)}
              className="px-2 py-0.5 rounded bg-white/20 hover:bg-white/30 text-white text-[11px]"
            >
              取消 (Esc)
            </button>
          </div>
        )}

        {/* Bottom HUD Row: Non-overlapping Selected Controls (left) + Canvas Controls (right) */}
        <div className="pointer-events-none absolute bottom-3 inset-x-3 z-10 flex flex-wrap-reverse items-end justify-between gap-2">
          <div className="pointer-events-auto min-w-0 max-w-full">
            {(() => {
              const selectedPl = selectedElementId
                ? placements.find((p) => p.element.id === selectedElementId)
                : null;

              if (selectedPl) {
                const el = selectedPl.element;
                const isDoor = el.kind === 'door';
                const isWindow = el.kind === 'window';
                const parsedDoor = isDoor ? parseDoorSwing(el.swingDirection) : null;

                if (readOnly) {
                  return (
                    <div className="flex flex-wrap items-center gap-2 bg-white/95 border border-slate-200 rounded-lg px-3 py-1.5 shadow-sm text-xs text-slate-700">
                      <span className="font-semibold text-slate-900">{el.name}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {formatDimension(selectedPl.clampedWidthCm, project.unit)} ×{' '}
                        {formatDimension(el.depthCm, project.unit)}
                      </span>
                      {isDoor && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-blue-700 font-medium">
                            {getDoorSwingLabel(el.swingDirection)}
                          </span>
                        </>
                      )}
                    </div>
                  );
                }

                return (
                  <div className="flex flex-wrap items-center gap-1.5 bg-white/95 border border-slate-200 rounded-lg px-2.5 py-1.5 shadow-sm">
                    <span className="text-xs font-semibold text-slate-800 mr-1 truncate max-w-[120px]">
                      {el.name}
                    </span>
                    {isDoor && onFlipDoor && parsedDoor ? (
                      <>
                        <span className="text-[11px] font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 whitespace-nowrap">
                          {getDoorSwingLabel(el.swingDirection)}
                        </span>
                        <button
                          type="button"
                          onClick={() => onFlipDoor(el.id, 'type')}
                          className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                            parsedDoor.mode === 'sliding'
                              ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                              : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                          }`}
                        >
                          <span>{parsedDoor.mode === 'sliding' ? '改為推開門' : '改為橫拉門'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onFlipDoor(el.id, 'hinge')}
                          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors whitespace-nowrap shrink-0"
                        >
                          <ArrowLeftRight className="w-3 h-3" />
                          <span>{parsedDoor.mode === 'sliding' ? '左右拉向' : '左/右開'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onFlipDoor(el.id, 'side')}
                          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
                        >
                          <RotateCw className="w-3 h-3" />
                          <span>{parsedDoor.mode === 'sliding' ? '內/外橫拉' : '內/外開'}</span>
                        </button>
                      </>
                    ) : !isWindow && onRotateElement ? (
                      <>
                        <span className="text-[11px] font-mono tabular-nums text-slate-500 mr-0.5">
                          {Math.round(el.rotationDeg ?? 0)}°
                        </span>
                        <button
                          type="button"
                          onClick={() => onRotateElement(el.id, rotateElementAngle(el.rotationDeg, -90))}
                          aria-label={`逆時針旋轉 ${el.name} 90度`}
                          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>-90°</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onRotateElement(el.id, rotateElementAngle(el.rotationDeg, 90))}
                          aria-label={`順時針旋轉 ${el.name} 90度`}
                          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors whitespace-nowrap shrink-0"
                        >
                          <RotateCw className="w-3 h-3" />
                          <span>+90°</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onRotateElement(el.id, rotateElementAngle(el.rotationDeg, 180))}
                          aria-label={`反轉 ${el.name} 180度`}
                          className="px-2 py-1 rounded text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
                        >
                          180° 反向
                        </button>
                      </>
                    ) : null}

                    {isLightingElementKind(el.kind) && onToggleLight && (
                      <button
                        type="button"
                        aria-pressed={el.lightOn !== false}
                        onClick={() => onToggleLight(el.id)}
                        aria-label={`切換 ${el.name} 燈具電源`}
                        className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 ${
                          el.lightOn !== false
                            ? 'bg-amber-500 text-white border-amber-500 hover:bg-amber-600'
                            : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                        }`}
                      >
                        <Lightbulb className="w-3 h-3" />
                        <span>{el.lightOn !== false ? '開燈中' : '已關燈'}</span>
                      </button>
                    )}

                    {onToggleWallDistances && (
                      <button
                        type="button"
                        aria-pressed={Boolean(el.showWallDistances)}
                        onClick={() => onToggleWallDistances(el.id)}
                        aria-label={`切換 ${el.name} 四邊與牆壁距離標示`}
                        className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                          el.showWallDistances
                            ? 'bg-teal-600 text-white border-teal-600'
                            : 'bg-teal-50 text-teal-800 border-teal-200 hover:bg-teal-100'
                        }`}
                      >
                        <MoveHorizontal className="w-3 h-3" />
                        <span>四邊牆距</span>
                      </button>
                    )}

                    {onCopyElement && (
                      <button
                        type="button"
                        onClick={() => onCopyElement(el.id)}
                        aria-label={`複製 ${el.name}`}
                        title="複製貼上 (Ctrl+C / Ctrl+V)"
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
                      >
                        <Copy className="w-3 h-3" />
                        <span>複製</span>
                      </button>
                    )}

                    {onDoubleClickElement && (
                      <button
                        type="button"
                        onClick={() => onDoubleClickElement(el.id)}
                        aria-label={`調整 ${el.name} 尺寸`}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
                      >
                        <SlidersHorizontal className="w-3 h-3" />
                        <span>調整尺寸</span>
                      </button>
                    )}

                    {onDeleteElement && (
                      <button
                        type="button"
                        onClick={() => onDeleteElement(el.id)}
                        aria-label={`刪除選取物品 ${el.name}`}
                        title="刪除 (Delete)"
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100 transition-colors whitespace-nowrap shrink-0"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>刪除</span>
                      </button>
                    )}
                  </div>
                );
              }

              const selectedSection = selectedSectionId
                ? (project.sectionLines ?? []).find((s) => s.id === selectedSectionId)
                : null;
              if (!selectedSection) return null;

              return (
                <div className="flex flex-wrap items-center gap-1.5 bg-white/95 border border-rose-200 rounded-lg px-2.5 py-1.5 shadow-sm">
                  <span className="text-xs font-semibold text-rose-700 mr-1">
                    剖面線 {selectedSection.label}
                  </span>
                  {!readOnly && onFlipSectionDirection && (
                    <button
                      type="button"
                      onClick={() => onFlipSectionDirection(selectedSection.id)}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors whitespace-nowrap shrink-0"
                    >
                      <ArrowLeftRight className="w-3 h-3" />
                      <span>反轉方向</span>
                    </button>
                  )}
                  {onViewSectionElevation && (
                    <button
                      type="button"
                      onClick={() => onViewSectionElevation(selectedSection.id)}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 transition-colors whitespace-nowrap shrink-0"
                    >
                      <Eye className="w-3 h-3" />
                      <span>檢視立面圖</span>
                    </button>
                  )}
                  {!readOnly && onDeleteSectionLine && (
                    <button
                      type="button"
                      onClick={() => onDeleteSectionLine(selectedSection.id)}
                      aria-label={`刪除剖面線 ${selectedSection.label}`}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100 transition-colors whitespace-nowrap shrink-0"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>刪除</span>
                    </button>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Bottom-Right Subtle Blueprint Canvas Controls */}
          <div className="pointer-events-auto ml-auto shrink-0 flex items-center gap-1.5 bg-white/95 border border-slate-200 rounded-lg p-1 shadow-sm">
            {!readOnly && onSetSectionDrawMode && (
              <button
                type="button"
                onClick={() => onSetSectionDrawMode(!sectionDrawMode)}
                aria-pressed={sectionDrawMode}
                aria-label="在平面圖繪製剖面線"
                title="繪製剖面線並生成立面圖"
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  sectionDrawMode
                    ? 'bg-rose-600 text-white'
                    : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                }`}
              >
                <Scissors className="w-3.5 h-3.5" />
                <span>畫剖面線</span>
              </button>
            )}
            {!readOnly && (
              <button
                type="button"
                onClick={handleToggleSnap}
                aria-pressed={effectiveSnapEnabled}
                aria-label="切換移動元件磁吸貼齊功能"
                title="拖曳元件時自動貼齊牆面與其他設備（拖曳時按住 Shift 可暫時取消）"
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  effectiveSnapEnabled
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Magnet className="w-3.5 h-3.5" />
                <span>磁吸貼齊</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowGrid((v) => !v)}
              aria-label="切換背景格線"
              title="切換格線"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                showGrid
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Grid3X3 className="w-3.5 h-3.5" />
              <span>格線</span>
            </button>
            <button
              type="button"
              onClick={() => setShowDimensions((v) => !v)}
              aria-label="切換尺寸標註"
              title="切換尺寸標註"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                showDimensions
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Ruler className="w-3.5 h-3.5" />
              <span>尺寸</span>
            </button>
            <div className="w-px h-4 bg-slate-200 mx-0.5" />
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.35, z * 0.85))}
              aria-label="縮小平面圖"
              className="p-1.5 rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs font-mono tabular-nums text-slate-600 min-w-[44px] text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(6, z * 1.18))}
              aria-label="放大平面圖"
              className="p-1.5 rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={fitToView}
              aria-label="重設視窗縮放"
              title="適應視窗"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>置中</span>
            </button>
          </div>
        </div>

        {/* Top-Left Proportional Scale Info (never overlaps bottom-right zoom toolbar) */}
        <div className="absolute top-3 left-3 pointer-events-none bg-white/95 border border-slate-200 rounded-md px-2.5 py-1 text-xs text-slate-600 flex items-center gap-2 shadow-xs">
          <span className="font-medium text-slate-800">等比例 1:1</span>
          <span aria-hidden="true" className="hidden sm:inline">·</span>
          <span className="hidden sm:inline font-mono tabular-nums">拖曳平移 / 滾輪縮放 / Ctrl+C 複製</span>
        </div>
      </div>
    );
  }
);

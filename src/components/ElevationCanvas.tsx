import React, { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  Download,
  Maximize2,
  Plus,
  Scissors,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  FloorplanProject,
  SectionLine,
  SolvedElementPlacement,
  SolvedFloorplan,
} from '../types/floorplan';
import {
  buildElevationRenderItems,
  computeSectionElevation,
  createPresetSectionLine,
  darkenHexColor,
  formatDimension,
  getContrastTextColor,
  getSectionBasis,
  parseDoorSwing,
  sanitizeHexColor,
} from '../utils/floorplanGeometry';
import { buildElevationSvgString } from '../utils/drawingSvgExport';
import {
  isCabinetElementKind,
  resolveCabinetSpecForElement,
} from '../utils/cabinetDesigner';

interface ElevationCanvasProps {
  project: FloorplanProject;
  solved: SolvedFloorplan;
  placements: SolvedElementPlacement[];
  selectedSectionId: string | null;
  selectedElementId: string | null;
  readOnly?: boolean;
  onSelectSection: (sectionId: string | null) => void;
  onSelectElement: (elementId: string | null) => void;
  onAddSectionLine?: (section: SectionLine) => void;
  onFlipSectionDirection?: (sectionId: string) => void;
  onDeleteSectionLine?: (sectionId: string) => void;
  onSwitchToDraw2D?: () => void;
}

export const ElevationCanvas: React.FC<ElevationCanvasProps> = ({
  project,
  solved,
  placements,
  selectedSectionId,
  selectedElementId,
  readOnly = false,
  onSelectSection,
  onSelectElement,
  onAddSectionLine,
  onFlipSectionDirection,
  onDeleteSectionLine,
  onSwitchToDraw2D,
}) => {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<{
    clientX: number;
    clientY: number;
    panX: number;
    panY: number;
  } | null>(null);

  const sectionLines = project.sectionLines ?? [];
  const activeSection = useMemo(
    () =>
      sectionLines.find((s) => s.id === selectedSectionId) ??
      sectionLines[0] ??
      null,
    [sectionLines, selectedSectionId]
  );

  const elevation = useMemo(() => {
    if (!activeSection) return null;
    return computeSectionElevation(project, solved, placements, activeSection);
  }, [project, solved, placements, activeSection]);

  const renderItems = useMemo(
    () => (elevation ? buildElevationRenderItems(elevation) : []),
    [elevation]
  );

  const viewMetrics = useMemo(() => {
    if (!elevation) {
      return { vbX: 0, vbY: -300, vbW: 600, vbH: 380, unitScale: 1 };
    }
    const span = Math.max(200, elevation.sMaxCm - elevation.sMinCm);
    const ceilH = Math.max(120, elevation.ceilingHeightCm);
    const padX = Math.max(100, span * 0.17);
    const padTop = Math.max(75, ceilH * 0.25);
    const padBottom = Math.max(75, ceilH * 0.25);

    const baseW = span + padX * 2;
    const baseH = ceilH + padTop + padBottom;
    const centerX = (elevation.sMinCm + elevation.sMaxCm) * 0.5;
    const centerY = -ceilH * 0.5;
    const curW = baseW / zoom;
    const curH = baseH / zoom;
    return {
      vbX: centerX - curW * 0.5 - pan.x,
      vbY: centerY - curH * 0.5 - pan.y,
      vbW: curW,
      vbH: curH,
      unitScale: Math.max(span, ceilH) / 720,
    };
  }, [elevation, zoom, pan]);

  const handleQuickPreset = (dir: 'north' | 'south' | 'west' | 'east') => {
    if (readOnly || !onAddSectionLine) return;
    const sec = createPresetSectionLine(solved, dir, sectionLines);
    onAddSectionLine(sec);
    onSelectSection(sec.id);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleExportSvg = () => {
    if (!activeSection || !elevation) return;
    const svg = buildElevationSvgString(project, solved, placements, activeSection, elevation);
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.projectName || 'floorplan'}-立面圖-${activeSection.label}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!activeSection || !elevation) {
    return (
      <div
        className="w-full h-full flex items-center justify-center bg-slate-50 p-6"
        data-testid="elevation-empty-state"
      >
        <div className="max-w-lg w-full bg-white border border-slate-200 rounded-xl p-6 shadow-xs text-center space-y-4">
          <div className="w-11 h-11 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center mx-auto">
            <Scissors className="w-5 h-5" />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-base font-bold text-slate-900">尚未設定剖面線</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              {readOnly
                ? '此唯讀分享圖面目前尚未包含剖面線區域，請切換至 2D 平面圖或 3D 空間檢視。'
                : '在 2D 平面圖切一條剖面線並指定觀看方向（或直接使用下方快速剖面），即可自動產生含門窗尺寸、窗台高度與家具配置的立面圖，並一併匯入多頁 PDF。'}
            </p>
          </div>

          {!readOnly && (
            <>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleQuickPreset('north')}
                  className="px-3 py-2 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 transition-colors"
                >
                  + 水平剖面（往北/上看）
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickPreset('south')}
                  className="px-3 py-2 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 transition-colors"
                >
                  + 水平剖面（往南/下看）
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickPreset('west')}
                  className="px-3 py-2 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 transition-colors"
                >
                  + 垂直剖面（往西/左看）
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickPreset('east')}
                  className="px-3 py-2 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 transition-colors"
                >
                  + 垂直剖面（往東/右看）
                </button>
              </div>

              <button
                type="button"
                onClick={() => onSwitchToDraw2D?.()}
                className="w-full py-2.5 px-4 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 transition-colors"
              >
                切換至 2D 平面圖手繪剖面線
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  const s = viewMetrics.unitScale;
  const ceilH = elevation.ceilingHeightCm;
  const span = Math.max(100, elevation.sMaxCm - elevation.sMinCm);

  return (
    <div
      className="relative w-full h-full flex flex-col bg-white overflow-hidden select-none"
      data-testid="elevation-viewport"
    >
      {/* Top Section Control Bar */}
      <div className="shrink-0 bg-slate-50 border-b border-slate-200 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-slate-700 mr-1">剖面區域：</span>
          {sectionLines.map((sec) => {
            const active = sec.id === activeSection.id;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => {
                  onSelectSection(sec.id);
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-rose-600 text-white border-rose-600'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                剖面 {sec.label}
              </button>
            );
          })}
          {!readOnly && (
            <>
              <button
                type="button"
                onClick={() => handleQuickPreset('north')}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
                title="新增一道水平中線剖面"
              >
                <Plus className="w-3 h-3" />
                <span>水平剖面</span>
              </button>
              <button
                type="button"
                onClick={() => handleQuickPreset('east')}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
                title="新增一道垂直中線剖面"
              >
                <Plus className="w-3 h-3" />
                <span>垂直剖面</span>
              </button>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {!readOnly && onFlipSectionDirection && (
            <button
              type="button"
              onClick={() => onFlipSectionDirection(activeSection.id)}
              aria-label={`反轉剖面 ${activeSection.label} 觀看方向`}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors whitespace-nowrap shrink-0"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              <span>反轉觀看方向</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleExportSvg}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>立面 SVG</span>
          </button>
          {!readOnly && onDeleteSectionLine && (
            <button
              type="button"
              onClick={() => onDeleteSectionLine(activeSection.id)}
              aria-label={`刪除剖面 ${activeSection.label}`}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100 transition-colors whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>刪除</span>
            </button>
          )}
        </div>
      </div>

      {/* Interactive SVG Elevation Canvas */}
      <div className="flex-1 min-h-0 relative">
        <svg
          className={`w-full h-full ${dragStart ? 'cursor-grabbing' : 'cursor-grab'}`}
          viewBox={`${viewMetrics.vbX} ${viewMetrics.vbY} ${viewMetrics.vbW} ${viewMetrics.vbH}`}
          preserveAspectRatio="xMidYMid meet"
          onWheel={(e) => {
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1.12 : 0.89;
            setZoom((z) => Math.min(5, Math.max(0.4, z * factor)));
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            if ((e.target as HTMLElement).closest('[data-interactive="true"]')) return;
            setDragStart({
              clientX: e.clientX,
              clientY: e.clientY,
              panX: pan.x,
              panY: pan.y,
            });
          }}
          onPointerMove={(e) => {
            if (!dragStart) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const scale = Math.max(
              viewMetrics.vbW / Math.max(1, rect.width),
              viewMetrics.vbH / Math.max(1, rect.height)
            );
            setPan({
              x: dragStart.panX + (e.clientX - dragStart.clientX) * scale,
              y: dragStart.panY + (e.clientY - dragStart.clientY) * scale,
            });
          }}
          onPointerUp={() => setDragStart(null)}
          onPointerCancel={() => setDragStart(null)}
        >
          <defs>
            <pattern
              id="elev-cut-hatch"
              width={10 * s}
              height={10 * s}
              patternTransform="rotate(45 0 0)"
              patternUnits="userSpaceOnUse"
            >
              <line
                x1="0"
                y1="0"
                x2="0"
                y2={10 * s}
                stroke="#334155"
                strokeOpacity="0.35"
                strokeWidth={1.6 * s}
              />
            </pattern>
          </defs>

          {/* Ceiling datum dashed reference line */}
          <line
            x1={elevation.sMinCm - 24 * s}
            y1={-ceilH}
            x2={elevation.sMaxCm + 24 * s}
            y2={-ceilH}
            stroke="#94a3b8"
            strokeWidth={1.2 * s}
            strokeDasharray={`${6 * s} ${4 * s}`}
          />

          {/* Unified Depth-Sorted Walls, Furniture, and Openings (back to front) */}
          {renderItems.map((item) => {
            if (item.kind === 'wall') {
              const w = item.wall;
              const ww = Math.max(4, w.sEndCm - w.sStartCm);
              const customWallHex = sanitizeHexColor(project.wallColor);
              const wallFill = w.isCutThrough
                ? '#e2e8f0'
                : customWallHex ?? (w.isInterior ? '#f8fafc' : '#f1f5f9');
              return (
                <g key={`ew-${w.wallId}-${item.wallIndex}`}>
                  <rect
                    x={w.sStartCm}
                    y={-w.heightCm}
                    width={ww}
                    height={w.heightCm}
                    fill={wallFill}
                    stroke={w.isCutThrough ? '#0f172a' : '#475569'}
                    strokeWidth={(w.isCutThrough ? 2.4 : 1.5) * s}
                  />
                  {w.isCutThrough && (
                    <rect
                      x={w.sStartCm}
                      y={-w.heightCm}
                      width={ww}
                      height={w.heightCm}
                      fill="url(#elev-cut-hatch)"
                    />
                  )}
                </g>
              );
            }

            if (item.kind === 'furniture') {
              const f = item.furniture;
              const fw = Math.max(4, f.sEndCm - f.sStartCm);
              const yTop = -(f.elevationCm + f.heightCm);
              const isSel = selectedElementId === f.elementId;
              const palette: Record<string, { fill: string; stroke: string; opacity?: number }> = {
                cabinet: { fill: '#fef3c7', stroke: '#b45309' },
                wall_cabinet: { fill: '#ffedd5', stroke: '#c2410c', opacity: 0.9 },
                kitchen_counter: { fill: '#ffedd5', stroke: '#9a3412' },
                bed: { fill: '#ccfbf1', stroke: '#0f766e' },
                bed_curtain: { fill: '#d1fae5', stroke: '#059669', opacity: 0.42 },
                table: { fill: '#fef9c3', stroke: '#a16207' },
                round_table: { fill: '#fef3c7', stroke: '#92400e' },
                chair: { fill: '#e2e8f0', stroke: '#475569' },
                sofa: { fill: '#ede9fe', stroke: '#6d28d9' },
                toilet: { fill: '#f0f9ff', stroke: '#0284c7' },
                urinal: { fill: '#f0f9ff', stroke: '#0369a1' },
                shower: { fill: '#eef2ff', stroke: '#4f46e5' },
                sink: { fill: '#ecfeff', stroke: '#0891b2' },
                panel_light: { fill: '#fef9c3', stroke: '#ca8a04' },
                track_light: { fill: '#fef3c7', stroke: '#334155' },
                recessed_light: { fill: '#fef08a', stroke: '#d97706' },
                wall_sconce: { fill: '#ffedd5', stroke: '#b45309' },
              };
              const baseP = palette[f.kind] ?? { fill: '#f1f5f9', stroke: '#475569' };
              const customHex = sanitizeHexColor(f.color);
              const fillHex = customHex ?? baseP.fill;
              const strokeHex = customHex ? darkenHexColor(customHex, 0.58) : baseP.stroke;
              const textColor = customHex ? getContrastTextColor(customHex) : '#1e293b';
              const midX = (f.sStartCm + f.sEndCm) * 0.5;
              const visMidX =
                ((f.visibleSStartCm ?? f.sStartCm) + (f.visibleSEndCm ?? f.sEndCm)) * 0.5;
              return (
                <g
                  key={`ef-${f.elementId}`}
                  data-interactive="true"
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectElement(f.elementId);
                  }}
                >
                  <rect
                    x={f.sStartCm}
                    y={yTop}
                    width={fw}
                    height={f.heightCm}
                    fill={fillHex}
                    fillOpacity={baseP.opacity ?? 0.95}
                    stroke={isSel ? '#2563eb' : strokeHex}
                    strokeWidth={(isSel ? 2.4 : 1.5) * s}
                    strokeDasharray={f.kind === 'wall_cabinet' ? `${5 * s} ${3 * s}` : undefined}
                  />
                  {isCabinetElementKind(f.kind) &&
                    (() => {
                      const cabSpec = resolveCabinetSpecForElement({
                        kind: f.kind,
                        widthCm: fw,
                        cabinetSpec: f.cabinetSpec,
                      });
                      const hasUpper =
                        cabSpec.doorMode !== 'none' ||
                        cabSpec.shelfCount > 0 ||
                        cabSpec.hasHangingRod;
                      const drawerRatio =
                        cabSpec.drawerCount > 0
                          ? Math.min(hasUpper ? 0.54 : 0.9, cabSpec.drawerCount * 0.16)
                          : 0;
                      const drawerZoneH = f.heightCm * drawerRatio;
                      const upperH = Math.max(0, f.heightCm - drawerZoneH);
                      const yDrawerTop = yTop + upperH;
                      const sinkOffsetX =
                        f.kind === 'kitchen_counter' && !f.cabinetSpec
                          ? f.sStartCm + fw * 0.25
                          : midX;
                      return (
                        <>
                          {cabSpec.drawerCount > 0 && (
                            <>
                              <line
                                x1={f.sStartCm}
                                y1={yDrawerTop}
                                x2={f.sEndCm}
                                y2={yDrawerTop}
                                stroke={strokeHex}
                                strokeOpacity="0.6"
                                strokeWidth={1.2 * s}
                              />
                              {Array.from({ length: cabSpec.drawerCount }, (_, dIdx) => {
                                const perH = drawerZoneH / cabSpec.drawerCount;
                                const lineY = yDrawerTop + perH * dIdx;
                                const pullY = lineY + perH * 0.5;
                                return (
                                  <React.Fragment key={dIdx}>
                                    {dIdx > 0 && (
                                      <line
                                        x1={f.sStartCm}
                                        y1={lineY}
                                        x2={f.sEndCm}
                                        y2={lineY}
                                        stroke={strokeHex}
                                        strokeOpacity="0.45"
                                        strokeWidth={1 * s}
                                      />
                                    )}
                                    <line
                                      x1={midX - Math.min(10, fw * 0.14)}
                                      y1={pullY}
                                      x2={midX + Math.min(10, fw * 0.14)}
                                      y2={pullY}
                                      stroke={strokeHex}
                                      strokeOpacity="0.65"
                                      strokeWidth={1.6 * s}
                                      strokeLinecap="round"
                                    />
                                  </React.Fragment>
                                );
                              })}
                            </>
                          )}
                          {upperH > 12 && cabSpec.doorMode === 'double' && (
                            <line
                              x1={midX}
                              y1={yTop + 4 * s}
                              x2={midX}
                              y2={yTop + upperH - 3 * s}
                              stroke={strokeHex}
                              strokeOpacity="0.5"
                              strokeWidth={1.1 * s}
                            />
                          )}
                          {upperH > 12 &&
                            (cabSpec.doorMode === 'single-left' ||
                              cabSpec.doorMode === 'single-right') && (
                              <line
                                x1={
                                  cabSpec.doorMode === 'single-left'
                                    ? f.sEndCm - Math.min(7, fw * 0.12)
                                    : f.sStartCm + Math.min(7, fw * 0.12)
                                }
                                y1={yTop + upperH * 0.42}
                                x2={
                                  cabSpec.doorMode === 'single-left'
                                    ? f.sEndCm - Math.min(7, fw * 0.12)
                                    : f.sStartCm + Math.min(7, fw * 0.12)
                                }
                                y2={yTop + upperH * 0.62}
                                stroke={strokeHex}
                                strokeOpacity="0.7"
                                strokeWidth={1.8 * s}
                                strokeLinecap="round"
                              />
                            )}
                          {cabSpec.hasSink && (
                            <>
                              <line
                                x1={f.sStartCm}
                                y1={yTop + 5 * s}
                                x2={f.sEndCm}
                                y2={yTop + 5 * s}
                                stroke={strokeHex}
                                strokeWidth={1.3 * s}
                              />
                              <path
                                d={`M ${sinkOffsetX} ${yTop} L ${sinkOffsetX} ${yTop - 16 * s} Q ${sinkOffsetX} ${yTop - 22 * s} ${sinkOffsetX + 8 * s} ${yTop - 18 * s}`}
                                fill="none"
                                stroke="#475569"
                                strokeWidth={1.8 * s}
                                strokeLinecap="round"
                              />
                            </>
                          )}
                        </>
                      );
                    })()}
                  {f.kind === 'sofa' && (
                    <line
                      x1={f.sStartCm + fw * 0.1}
                      y1={yTop + f.heightCm * 0.45}
                      x2={f.sEndCm - fw * 0.1}
                      y2={yTop + f.heightCm * 0.45}
                      stroke={strokeHex}
                      strokeOpacity="0.55"
                      strokeWidth={1.2 * s}
                    />
                  )}
                  {f.kind === 'round_table' && (
                    <line
                      x1={f.sStartCm}
                      y1={yTop + 5 * s}
                      x2={f.sEndCm}
                      y2={yTop + 5 * s}
                      stroke={strokeHex}
                      strokeWidth={1.6 * s}
                    />
                  )}
                  {f.kind === 'bed_curtain' && (
                    <>
                      <line
                        x1={f.sStartCm}
                        y1={yTop}
                        x2={f.sEndCm}
                        y2={yTop}
                        stroke="#047857"
                        strokeWidth={2.4 * s}
                      />
                      {Array.from({ length: Math.max(2, Math.floor(fw / 28)) }, (_, idx) => {
                        const px = f.sStartCm + ((idx + 1) * fw) / (Math.max(2, Math.floor(fw / 28)) + 1);
                        return (
                          <line
                            key={idx}
                            x1={px}
                            y1={yTop + 3 * s}
                            x2={px}
                            y2={yTop + f.heightCm - 3 * s}
                            stroke="#059669"
                            strokeOpacity="0.35"
                            strokeWidth={1 * s}
                            strokeDasharray={`${4 * s} ${3 * s}`}
                          />
                        );
                      })}
                    </>
                  )}
                  <text
                    x={visMidX}
                    y={yTop + f.heightCm * 0.5}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={textColor}
                    fontSize={8.5 * s}
                    fontWeight="600"
                    className="pointer-events-none"
                  >
                    {f.name}
                  </text>
                </g>
              );
            }

            const op = item.opening;
            const ow = Math.max(6, op.sEndCm - op.sStartCm);
            const yTop = -(op.elevationCm + op.heightCm);
            const midX = (op.sStartCm + op.sEndCm) * 0.5;
            const visMidX =
              ((op.visibleSStartCm ?? op.sStartCm) + (op.visibleSEndCm ?? op.sEndCm)) * 0.5;
            const midY = yTop + op.heightCm * 0.5;
            const isSel = selectedElementId === op.elementId;
            const hText = `高 ${formatDimension(op.heightCm, project.unit)}`;
            const customOpFill = sanitizeHexColor(op.color);
            const opOuterFill = customOpFill ?? (op.kind === 'window' ? '#e0f2fe' : '#fef3c7');
            const opInnerFill = customOpFill
              ? darkenHexColor(customOpFill, 0.88)
              : op.kind === 'window'
                ? '#bae6fd'
                : '#fde68a';
            const opStroke = isSel
              ? '#1d4ed8'
              : customOpFill
                ? darkenHexColor(customOpFill, 0.58)
                : op.kind === 'window'
                  ? '#0284c7'
                  : '#78350f';
            const opSubStroke = customOpFill
              ? darkenHexColor(customOpFill, 0.65)
              : op.kind === 'window'
                ? '#0369a1'
                : '#92400e';
            const opTextColor = customOpFill ? getContrastTextColor(opOuterFill) : '#0f172a';
            const opSubTextColor = customOpFill
              ? getContrastTextColor(opOuterFill)
              : op.kind === 'window'
                ? '#0369a1'
                : '#78350f';

            return (
              <g
                key={`eo-${op.elementId}`}
                data-interactive="true"
                className="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectElement(op.elementId);
                }}
              >
                {op.kind === 'window' ? (
                  <>
                    <rect
                      x={op.sStartCm}
                      y={yTop}
                      width={ow}
                      height={op.heightCm}
                      fill={opOuterFill}
                      stroke={opStroke}
                      strokeWidth={(isSel ? 2.8 : 2.1) * s}
                    />
                    <rect
                      x={op.sStartCm + Math.min(ow, op.heightCm) * 0.08}
                      y={yTop + Math.min(ow, op.heightCm) * 0.08}
                      width={Math.max(2, ow - Math.min(ow, op.heightCm) * 0.16)}
                      height={Math.max(2, op.heightCm - Math.min(ow, op.heightCm) * 0.16)}
                      fill={opInnerFill}
                      fillOpacity="0.6"
                      stroke={opSubStroke}
                      strokeWidth={1.1 * s}
                    />
                    <line
                      x1={midX}
                      y1={yTop + Math.min(ow, op.heightCm) * 0.08}
                      x2={midX}
                      y2={yTop + op.heightCm - Math.min(ow, op.heightCm) * 0.08}
                      stroke={opSubStroke}
                      strokeWidth={1.2 * s}
                    />
                  </>
                ) : (
                  (() => {
                    const parsedDoor = parseDoorSwing(op.swingDirection);
                    const inset = Math.min(ow * 0.12, 8 * s);
                    const dirSign = op.slideSignInView ?? 1;
                    const ax1 = midX - dirSign * Math.min(ow * 0.25, 20 * s);
                    const ax2 = midX + dirSign * Math.min(ow * 0.25, 20 * s);
                    const ay = yTop + op.heightCm * 0.72;
                    const handleX =
                      (op.slideSignInView ?? -1) >= 0
                        ? op.sEndCm - inset * 1.8
                        : op.sStartCm + inset * 1.8;
                    return (
                      <>
                        <rect
                          x={op.sStartCm}
                          y={yTop}
                          width={ow}
                          height={op.heightCm}
                          fill={opOuterFill}
                          stroke={opStroke}
                          strokeWidth={(isSel ? 2.8 : 2.2) * s}
                        />
                        <rect
                          x={op.sStartCm + inset}
                          y={yTop + inset}
                          width={Math.max(2, ow - inset * 2)}
                          height={Math.max(2, op.heightCm - inset)}
                          fill={opInnerFill}
                          fillOpacity="0.45"
                          stroke={opSubStroke}
                          strokeWidth={1.2 * s}
                        />
                        {parsedDoor.mode === 'sliding' ? (
                          <>
                            <line
                              x1={op.sStartCm - 12 * s}
                              y1={yTop - 5 * s}
                              x2={op.sEndCm + 12 * s}
                              y2={yTop - 5 * s}
                              stroke="#334155"
                              strokeWidth={2.4 * s}
                              strokeLinecap="round"
                            />
                            <line
                              x1={ax1}
                              y1={ay}
                              x2={ax2}
                              y2={ay}
                              stroke="#2563eb"
                              strokeWidth={1.8 * s}
                            />
                            <polygon
                              points={`${ax2},${ay} ${ax2 - dirSign * 6 * s},${ay - 3.5 * s} ${ax2 - dirSign * 6 * s},${ay + 3.5 * s}`}
                              fill="#2563eb"
                            />
                          </>
                        ) : (
                          <circle
                            cx={handleX}
                            cy={yTop + op.heightCm * 0.52}
                            r={2.5 * s}
                            fill="#451a03"
                          />
                        )}
                      </>
                    );
                  })()
                )}

                {/* Opening name & height label positioned in visible span */}
                <text
                  x={visMidX}
                  y={midY - 7 * s}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={opTextColor}
                  fontSize={9.5 * s}
                  fontWeight="700"
                  className="pointer-events-none"
                >
                  {op.name}
                </text>
                <text
                  x={visMidX}
                  y={midY + 8 * s}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={opSubTextColor}
                  fontSize={8.8 * s}
                  fontWeight="700"
                  className="font-mono tabular-nums pointer-events-none"
                >
                  {hText}
                </text>
              </g>
            );
          })}

          {/* Visible Opening Dimension & Sill Annotations (drawn above geometry so lines never hide behind cut walls) */}
          {elevation.openings.map((op, idx) => {
            const yTop = -(op.elevationCm + op.heightCm);
            const dimStart = op.dimSStartCm ?? op.sStartCm;
            const dimEnd = op.dimSEndCm ?? op.sEndCm;
            const dimMidX = (dimStart + dimEnd) * 0.5;
            const visMidX =
              ((op.visibleSStartCm ?? op.sStartCm) + (op.visibleSEndCm ?? op.sEndCm)) * 0.5;
            const laneOffset = (idx % 2) * 18 * s;
            const dimY = yTop - (16 * s + laneOffset);
            const wText = `寬 ${formatDimension(op.actualWidthCm, project.unit)}`;
            const wBoxW = Math.max(48, wText.length * 6.8 + 12) * s;

            return (
              <g key={`eo-dim-${op.elementId}`} className="pointer-events-none">
                <line
                  x1={dimStart}
                  y1={yTop - 2 * s}
                  x2={dimStart}
                  y2={dimY - 4 * s}
                  stroke="#64748b"
                  strokeWidth={0.9 * s}
                />
                <line
                  x1={dimEnd}
                  y1={yTop - 2 * s}
                  x2={dimEnd}
                  y2={dimY - 4 * s}
                  stroke="#64748b"
                  strokeWidth={0.9 * s}
                />
                <line
                  x1={dimStart}
                  y1={dimY}
                  x2={dimEnd}
                  y2={dimY}
                  stroke="#2563eb"
                  strokeWidth={1.2 * s}
                />
                <rect
                  x={dimMidX - wBoxW * 0.5}
                  y={dimY - 7 * s}
                  width={wBoxW}
                  height={14 * s}
                  rx={3 * s}
                  fill="#eff6ff"
                  stroke="#93c5fd"
                  strokeWidth={0.9 * s}
                />
                <text
                  x={dimMidX}
                  y={dimY}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#1d4ed8"
                  fontSize={8.8 * s}
                  fontWeight="700"
                  className="font-mono tabular-nums"
                >
                  {wText}
                </text>

                {op.elevationCm > 0 && (
                  <>
                    <line
                      x1={visMidX}
                      y1={0}
                      x2={visMidX}
                      y2={-op.elevationCm}
                      stroke="#0284c7"
                      strokeWidth={1.2 * s}
                      strokeDasharray={`${3 * s} ${2 * s}`}
                    />
                    <text
                      x={visMidX}
                      y={-op.elevationCm * 0.5}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#0369a1"
                      fontSize={8.5 * s}
                      fontWeight="700"
                      className="font-mono tabular-nums"
                    >
                      台高 {formatDimension(op.elevationCm, project.unit)}
                    </text>
                  </>
                )}
              </g>
            );
          })}

          {/* Floor Baseline FL ±0 & Datum Tags */}
          <line
            x1={elevation.sMinCm - 32 * s}
            y1={0}
            x2={elevation.sMaxCm + 32 * s}
            y2={0}
            stroke="#0f172a"
            strokeWidth={2.6 * s}
          />
          <text
            x={elevation.sMaxCm + 36 * s}
            y={0}
            dominantBaseline="central"
            fill="#475569"
            fontSize={9.5 * s}
            fontWeight="600"
          >
            FL ±0
          </text>
          <text
            x={elevation.sMaxCm + 36 * s}
            y={-ceilH}
            dominantBaseline="central"
            fill="#475569"
            fontSize={9.5 * s}
            fontWeight="600"
            className="font-mono tabular-nums"
          >
            CL +{formatDimension(ceilH, project.unit)}
          </text>

          {/* Left Ceiling Height Ruler */}
          <g className="pointer-events-none">
            <line
              x1={elevation.sMinCm - 38 * s}
              y1={0}
              x2={elevation.sMinCm - 38 * s}
              y2={-ceilH}
              stroke="#0f766e"
              strokeWidth={1.4 * s}
            />
            <line
              x1={elevation.sMinCm - 43 * s}
              y1={0}
              x2={elevation.sMinCm - 33 * s}
              y2={0}
              stroke="#0f766e"
              strokeWidth={1.4 * s}
            />
            <line
              x1={elevation.sMinCm - 43 * s}
              y1={-ceilH}
              x2={elevation.sMinCm - 33 * s}
              y2={-ceilH}
              stroke="#0f766e"
              strokeWidth={1.4 * s}
            />
            <text
              x={elevation.sMinCm - 46 * s}
              y={-ceilH * 0.5}
              textAnchor="end"
              dominantBaseline="central"
              fill="#0f766e"
              fontSize={9.5 * s}
              fontWeight="700"
              className="font-mono tabular-nums"
            >
              天花 {formatDimension(ceilH, project.unit)}
            </text>
          </g>

          {/* Bottom Cut Span Width Dimension */}
          <g className="pointer-events-none">
            <line
              x1={elevation.sMinCm}
              y1={4}
              x2={elevation.sMinCm}
              y2={32 * s}
              stroke="#94a3b8"
              strokeWidth={1 * s}
            />
            <line
              x1={elevation.sMaxCm}
              y1={4}
              x2={elevation.sMaxCm}
              y2={32 * s}
              stroke="#94a3b8"
              strokeWidth={1 * s}
            />
            <line
              x1={elevation.sMinCm}
              y1={26 * s}
              x2={elevation.sMaxCm}
              y2={26 * s}
              stroke="#475569"
              strokeWidth={1.3 * s}
            />
            <text
              x={(elevation.sMinCm + elevation.sMaxCm) * 0.5}
              y={42 * s}
              textAnchor="middle"
              dominantBaseline="central"
              fill="#0f172a"
              fontSize={10 * s}
              fontWeight="600"
              className="font-mono tabular-nums"
            >
              剖面 {activeSection.label} 投影總寬度 {formatDimension(span, project.unit)}
            </text>
          </g>
        </svg>

        {/* Bottom-Right Zoom Toolbar */}
        <div className="absolute bottom-4 right-4 flex items-center gap-1.5 bg-white/95 border border-slate-200 rounded-lg p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.4, z * 0.85))}
            aria-label="縮小立面圖"
            className="p-1.5 rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono tabular-nums text-slate-600 min-w-[44px] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(5, z * 1.18))}
            aria-label="放大立面圖"
            className="p-1.5 rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            aria-label="置中立面圖"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>置中</span>
          </button>
        </div>

        {/* Top-Left Summary Badge */}
        <div
          className="absolute top-3 left-3 pointer-events-none bg-white/95 border border-slate-200 rounded-md px-2.5 py-1 text-xs text-slate-600 flex items-center gap-2 shadow-xs"
          data-view-direction={activeSection.viewDirection}
        >
          <span className="font-semibold text-rose-700">立面圖 {activeSection.label}</span>
          <span aria-hidden="true">·</span>
          <span>
            視線方向：{(() => {
              const { lookDir } = getSectionBasis(activeSection);
              if (Math.abs(lookDir.x) >= Math.abs(lookDir.y)) {
                return lookDir.x >= 0 ? '往東（右）看' : '往西（左）看';
              }
              return lookDir.y < 0 ? '往北（上）看' : '往南（下）看';
            })()}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            顯示門窗 {elevation.openings.length} 件 / 家具 {elevation.furniture.length} 件
          </span>
        </div>
      </div>
    </div>
  );
};

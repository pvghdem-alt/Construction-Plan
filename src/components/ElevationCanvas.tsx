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
  computeSectionElevation,
  createPresetSectionLine,
  formatDimension,
  getSectionBasis,
  parseDoorSwing,
} from '../utils/floorplanGeometry';
import { buildElevationSvgString } from '../utils/drawingSvgExport';

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

          {/* Projected Wall Segments (sorted back to front) */}
          {elevation.walls.map((w, idx) => {
            const ww = Math.max(4, w.sEndCm - w.sStartCm);
            return (
              <g key={`ew-${w.wallId}-${idx}`}>
                <rect
                  x={w.sStartCm}
                  y={-w.heightCm}
                  width={ww}
                  height={w.heightCm}
                  fill={w.isCutThrough ? '#e2e8f0' : w.isInterior ? '#f8fafc' : '#f1f5f9'}
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
          })}

          {/* Projected Furniture Items */}
          {elevation.furniture.map((f) => {
            const fw = Math.max(4, f.sEndCm - f.sStartCm);
            const yTop = -(f.elevationCm + f.heightCm);
            const isSel = selectedElementId === f.elementId;
            const palette: Record<string, { fill: string; stroke: string }> = {
              cabinet: { fill: '#fef3c7', stroke: '#b45309' },
              bed: { fill: '#ccfbf1', stroke: '#0f766e' },
              table: { fill: '#fef9c3', stroke: '#a16207' },
              chair: { fill: '#e2e8f0', stroke: '#475569' },
            };
            const p = palette[f.kind] ?? { fill: '#f1f5f9', stroke: '#475569' };
            const midX = (f.sStartCm + f.sEndCm) * 0.5;
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
                  fill={p.fill}
                  fillOpacity="0.9"
                  stroke={isSel ? '#2563eb' : p.stroke}
                  strokeWidth={(isSel ? 2.4 : 1.5) * s}
                />
                {f.kind === 'cabinet' && fw > 55 && (
                  <line
                    x1={midX}
                    y1={yTop + 4 * s}
                    x2={midX}
                    y2={yTop + f.heightCm - 4 * s}
                    stroke={p.stroke}
                    strokeOpacity="0.45"
                    strokeWidth={1 * s}
                  />
                )}
                <text
                  x={midX}
                  y={yTop + f.heightCm * 0.5}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#1e293b"
                  fontSize={8.5 * s}
                  fontWeight="600"
                  className="pointer-events-none"
                >
                  {f.name}
                </text>
              </g>
            );
          })}

          {/* Projected Windows & Doors + Full Dimension Annotations */}
          {elevation.openings.map((op, idx) => {
            const ow = Math.max(6, op.sEndCm - op.sStartCm);
            const yTop = -(op.elevationCm + op.heightCm);
            const midX = (op.sStartCm + op.sEndCm) * 0.5;
            const midY = yTop + op.heightCm * 0.5;
            const isSel = selectedElementId === op.elementId;
            const laneOffset = (idx % 2) * 18 * s;
            const dimY = yTop - (16 * s + laneOffset);
            const wText = `寬 ${formatDimension(op.actualWidthCm, project.unit)}`;
            const hText = `高 ${formatDimension(op.heightCm, project.unit)}`;
            const wBoxW = Math.max(48, wText.length * 6.8 + 12) * s;

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
                      fill="#e0f2fe"
                      stroke={isSel ? '#1d4ed8' : '#0284c7'}
                      strokeWidth={(isSel ? 2.8 : 2.1) * s}
                    />
                    <rect
                      x={op.sStartCm + Math.min(ow, op.heightCm) * 0.08}
                      y={yTop + Math.min(ow, op.heightCm) * 0.08}
                      width={Math.max(2, ow - Math.min(ow, op.heightCm) * 0.16)}
                      height={Math.max(2, op.heightCm - Math.min(ow, op.heightCm) * 0.16)}
                      fill="#bae6fd"
                      fillOpacity="0.6"
                      stroke="#0369a1"
                      strokeWidth={1.1 * s}
                    />
                    <line
                      x1={midX}
                      y1={yTop + Math.min(ow, op.heightCm) * 0.08}
                      x2={midX}
                      y2={yTop + op.heightCm - Math.min(ow, op.heightCm) * 0.08}
                      stroke="#0369a1"
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
                          fill="#fef3c7"
                          stroke={isSel ? '#1d4ed8' : '#78350f'}
                          strokeWidth={(isSel ? 2.8 : 2.2) * s}
                        />
                        <rect
                          x={op.sStartCm + inset}
                          y={yTop + inset}
                          width={Math.max(2, ow - inset * 2)}
                          height={Math.max(2, op.heightCm - inset)}
                          fill="#fde68a"
                          fillOpacity="0.45"
                          stroke="#92400e"
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

                {/* Opening name & height label */}
                <text
                  x={midX}
                  y={midY - 7 * s}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#0f172a"
                  fontSize={9.5 * s}
                  fontWeight="700"
                  className="pointer-events-none"
                >
                  {op.name}
                </text>
                <text
                  x={midX}
                  y={midY + 8 * s}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={op.kind === 'window' ? '#0369a1' : '#78350f'}
                  fontSize={8.8 * s}
                  fontWeight="700"
                  className="font-mono tabular-nums pointer-events-none"
                >
                  {hText}
                </text>

                {/* Top Width Dimension Callout */}
                <line
                  x1={op.sStartCm}
                  y1={yTop - 2 * s}
                  x2={op.sStartCm}
                  y2={dimY - 4 * s}
                  stroke="#64748b"
                  strokeWidth={0.9 * s}
                />
                <line
                  x1={op.sEndCm}
                  y1={yTop - 2 * s}
                  x2={op.sEndCm}
                  y2={dimY - 4 * s}
                  stroke="#64748b"
                  strokeWidth={0.9 * s}
                />
                <line
                  x1={op.sStartCm}
                  y1={dimY}
                  x2={op.sEndCm}
                  y2={dimY}
                  stroke="#2563eb"
                  strokeWidth={1.2 * s}
                />
                <rect
                  x={midX - wBoxW * 0.5}
                  y={dimY - 7 * s}
                  width={wBoxW}
                  height={14 * s}
                  rx={3 * s}
                  fill="#eff6ff"
                  stroke="#93c5fd"
                  strokeWidth={0.9 * s}
                />
                <text
                  x={midX}
                  y={dimY}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#1d4ed8"
                  fontSize={8.8 * s}
                  fontWeight="700"
                  className="font-mono tabular-nums pointer-events-none"
                >
                  {wText}
                </text>

                {/* Sill elevation callout when window/opening is elevated */}
                {op.elevationCm > 0 && (
                  <>
                    <line
                      x1={midX}
                      y1={0}
                      x2={midX}
                      y2={-op.elevationCm}
                      stroke="#0284c7"
                      strokeWidth={1.2 * s}
                      strokeDasharray={`${3 * s} ${2 * s}`}
                    />
                    <text
                      x={midX}
                      y={-op.elevationCm * 0.5}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#0369a1"
                      fontSize={8.5 * s}
                      fontWeight="700"
                      className="font-mono tabular-nums pointer-events-none"
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

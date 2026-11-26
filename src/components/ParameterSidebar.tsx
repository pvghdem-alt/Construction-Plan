import React, { useRef, useState } from 'react';
import {
  Upload,
  FileText,
  Sparkles,
  Plus,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  DoorOpen,
  Square,
  Box,
  RotateCcw,
  BedDouble,
  Armchair,
  Table2,
  PanelTop,
  Toilet,
  Droplets,
  ShowerHead,
  Bath,
  Columns2,
  Circle,
  Sofa,
  Utensils,
  Palette,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Layers,
} from 'lucide-react';
import type {
  DoorSwing,
  ElementCategoryId,
  ElementKind,
  ElementPlacementMode,
  FloorplanElement,
  FloorplanLayer,
  FloorplanProject,
  InteriorWall,
  SolvedFloorplan,
  UnitType,
  WallEdge,
} from '../types/floorplan';
import {
  buildDoorSwing,
  DEFAULT_FLOOR_COLOR,
  DEFAULT_FLOORPLAN_LAYERS,
  DEFAULT_WALL_COLOR,
  ELEMENT_CATEGORIES,
  ELEMENT_COLOR_PRESETS,
  ELEMENT_KIND_DEFAULTS,
  FLOOR_COLOR_PRESETS,
  formatDimension,
  getDefaultLayerIdForKind,
  getEffectiveLayers,
  parseDoorSwing,
  resolveElementEffectiveColor,
  resolveElementLayer,
  rotateElementAngle,
  sanitizeHexColor,
  WALL_COLOR_PRESETS,
} from '../utils/floorplanGeometry';

interface ParameterSidebarProps {
  project: FloorplanProject;
  solved: SolvedFloorplan;
  selectedEdgeId: string | null;
  selectedElementId: string | null;
  onSelectEdge: (id: string | null) => void;
  onSelectElement: (id: string | null) => void;
  onUpdateProject: (updater: (prev: FloorplanProject) => FloorplanProject) => void;
  onAutoClose: () => void;
  onLoadPreset: (preset: 'attached' | 'l-studio' | 'care-room' | 'room-in-room') => void;
  onAnalyzeUpload: (payload: {
    mimeType: string;
    dataBase64: string;
    fileName: string;
  }) => Promise<void>;
  onAnalyzeSamplePdf: () => Promise<void>;
  isAnalyzing: boolean;
  analyzeError: string | null;
}

const ANGLE_QUICK_OPTIONS = [
  { deg: 0, label: '0° 右' },
  { deg: 90, label: '90° 下' },
  { deg: 180, label: '180° 左' },
  { deg: 270, label: '270° 上' },
  { deg: 135, label: '135° 斜' },
];

export const ParameterSidebar: React.FC<ParameterSidebarProps> = ({
  project,
  solved,
  selectedEdgeId,
  selectedElementId,
  onSelectEdge,
  onSelectElement,
  onUpdateProject,
  onAutoClose,
  onLoadPreset,
  onAnalyzeUpload,
  onAnalyzeSamplePdf,
  isAnalyzing,
  analyzeError,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [activeTab, setActiveTab] = useState<'edges' | 'elements'>('edges');
  const [elementCategoryFilter, setElementCategoryFilter] = useState<'all' | ElementCategoryId>('all');
  const [layerFilter, setLayerFilter] = useState<string>('all');
  const [layersPanelOpen, setLayersPanelOpen] = useState<boolean>(true);
  const [expandedElementIds, setExpandedElementIds] = useState<Record<string, boolean>>({});
  const [newLayerName, setNewLayerName] = useState<string>('');
  const [uploadedPreview, setUploadedPreview] = useState<{
    name: string;
    mimeType: string;
    previewUrl: string | null;
    dataBase64: string;
  } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const handleFileChange = (file: File | undefined) => {
    if (!file) return;
    setFileError(null);

    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.type)) {
      setFileError('僅支援 JPG、PNG、WebP 圖片或 PDF 檔案。');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setFileError('檔案大小請勿超過 15 MB。');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',').pop() || '' : result;
      const previewUrl = file.type.startsWith('image/') ? result : null;
      setUploadedPreview({
        name: file.name,
        mimeType: file.type,
        previewUrl,
        dataBase64: base64,
      });
    };
    reader.readAsDataURL(file);
  };

  const handleTriggerAnalyze = async () => {
    if (!uploadedPreview) return;
    await onAnalyzeUpload({
      mimeType: uploadedPreview.mimeType,
      dataBase64: uploadedPreview.dataBase64,
      fileName: uploadedPreview.name,
    });
  };

  const updateEdge = (edgeId: string, patch: Partial<WallEdge>) => {
    onUpdateProject((prev) => ({
      ...prev,
      edges: prev.edges.map((e) => (e.id === edgeId ? { ...e, ...patch } : e)),
    }));
  };

  const addEdge = () => {
    onUpdateProject((prev) => {
      const lastAngle = prev.edges.length > 0 ? prev.edges[prev.edges.length - 1].angleDeg : 0;
      const nextAngle = (lastAngle + 90) % 360;
      const idx = prev.edges.length + 1;
      const newEdge: WallEdge = {
        id: `w-${Date.now()}`,
        label: `W${idx} 新牆段`,
        lengthCm: 150,
        angleDeg: nextAngle,
        hasWall: true,
      };
      return { ...prev, edges: [...prev.edges, newEdge] };
    });
  };

  const removeEdge = (edgeId: string) => {
    onUpdateProject((prev) => {
      const remaining = prev.edges.filter((e) => e.id !== edgeId);
      const fallbackId = remaining[0]?.id ?? prev.interiorWalls?.[0]?.id ?? '';
      return {
        ...prev,
        edges: remaining,
        elements: prev.elements
          .map((el) => (el.edgeId === edgeId ? { ...el, edgeId: fallbackId } : el))
          .filter((el) => el.edgeId !== ''),
      };
    });
  };

  const updateInteriorWall = (wallId: string, patch: Partial<InteriorWall>) => {
    onUpdateProject((prev) => ({
      ...prev,
      interiorWalls: (prev.interiorWalls ?? []).map((w) =>
        w.id === wallId ? { ...w, ...patch } : w
      ),
    }));
  };

  const addInteriorWall = () => {
    const lastSolvedIw =
      solved.solvedInteriorWalls[solved.solvedInteriorWalls.length - 1];
    const defaultStartX = lastSolvedIw
      ? Math.round(lastSolvedIw.end.x * 10) / 10
      : Math.round(solved.bounds.centerX);
    const defaultStartY = lastSolvedIw
      ? Math.round(lastSolvedIw.end.y * 10) / 10
      : 0;
    const nextAngle = lastSolvedIw
      ? (Math.round(lastSolvedIw.effectiveAngleDeg) + 270) % 360
      : 90;

    onUpdateProject((prev) => {
      const existing = prev.interiorWalls ?? [];
      const idx = existing.length + 1;
      const newWall: InteriorWall = {
        id: `iw-${Date.now()}`,
        label: `I${idx} 隔間牆`,
        startXCm: defaultStartX,
        startYCm: defaultStartY,
        lengthCm: 150,
        angleDeg: nextAngle,
        hasWall: true,
      };
      return { ...prev, interiorWalls: [...existing, newWall] };
    });
  };

  const removeInteriorWall = (wallId: string) => {
    onUpdateProject((prev) => {
      const remainingIw = (prev.interiorWalls ?? []).filter((w) => w.id !== wallId);
      const fallbackId = prev.edges[0]?.id ?? remainingIw[0]?.id ?? '';
      return {
        ...prev,
        interiorWalls: remainingIw,
        elements: prev.elements
          .map((el) => (el.edgeId === wallId ? { ...el, edgeId: fallbackId } : el))
          .filter((el) => el.edgeId !== ''),
      };
    });
  };

  const effectiveLayers = getEffectiveLayers(project.layers);

  const toggleElementExpanded = (elId: string) => {
    setExpandedElementIds((prev) => ({ ...prev, [elId]: !prev[elId] }));
  };

  const setAllElementsExpanded = (expanded: boolean) => {
    if (!expanded) {
      setExpandedElementIds({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const el of project.elements) {
      next[el.id] = true;
    }
    setExpandedElementIds(next);
  };

  const toggleLayerVisibility = (layerId: string) => {
    onUpdateProject((prev) => {
      const base = getEffectiveLayers(prev.layers);
      return {
        ...prev,
        layers: base.map((l) => (l.id === layerId ? { ...l, visible: !l.visible } : l)),
      };
    });
  };

  const setAllLayersVisibility = (visible: boolean) => {
    onUpdateProject((prev) => {
      const base = getEffectiveLayers(prev.layers);
      return {
        ...prev,
        layers: base.map((l) => ({ ...l, visible })),
      };
    });
  };

  const setLayerUniformColor = (layerId: string, colorHex?: string) => {
    const cleanHex = sanitizeHexColor(colorHex);
    onUpdateProject((prev) => {
      const base = getEffectiveLayers(prev.layers);
      const nextLayers: FloorplanLayer[] = base.map((l) => {
        if (l.id !== layerId) return l;
        const copy: FloorplanLayer = { id: l.id, name: l.name, visible: l.visible };
        if (cleanHex) copy.color = cleanHex;
        return copy;
      });
      // Clear per-element override for elements on this layer so uniform layer coloring applies immediately
      const nextElements = prev.elements.map((el) => {
        const ownerLayer = resolveElementLayer(el, base);
        if (ownerLayer?.id !== layerId) return el;
        if (!el.color) return el;
        const rest = { ...el };
        delete rest.color;
        return rest;
      });
      return {
        ...prev,
        layers: nextLayers,
        elements: nextElements,
      };
    });
  };

  const renameLayer = (layerId: string, name: string) => {
    onUpdateProject((prev) => {
      const base = getEffectiveLayers(prev.layers);
      return {
        ...prev,
        layers: base.map((l) => (l.id === layerId ? { ...l, name } : l)),
      };
    });
  };

  const addCustomLayer = () => {
    const trimmed = newLayerName.trim();
    onUpdateProject((prev) => {
      const base = getEffectiveLayers(prev.layers);
      const layerNum = base.length + 1;
      const newLayer: FloorplanLayer = {
        id: `layer-custom-${Date.now().toString(36)}`,
        name: trimmed || `自訂圖層 ${layerNum}`,
        visible: true,
      };
      return {
        ...prev,
        layers: [...base, newLayer],
      };
    });
    setNewLayerName('');
  };

  const deleteCustomLayer = (layerId: string) => {
    onUpdateProject((prev) => {
      const base = getEffectiveLayers(prev.layers);
      if (base.length <= 1) return prev;
      const remaining = base.filter((l) => l.id !== layerId);
      const fallbackLayerId = remaining[0].id;
      return {
        ...prev,
        layers: remaining,
        elements: prev.elements.map((el) =>
          resolveElementLayer(el, base)?.id === layerId
            ? { ...el, layerId: fallbackLayerId }
            : el
        ),
      };
    });
    setLayerFilter((curr) => (curr === layerId ? 'all' : curr));
  };

  const addElement = (kind: ElementKind) => {
    const defaults = ELEMENT_KIND_DEFAULTS[kind];
    const centerX = Math.round(solved.bounds.centerX);
    const centerY = Math.round(solved.bounds.centerY);
    const newId = `el-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    onUpdateProject((prev) => {
      const targetEdgeId =
        selectedEdgeId || prev.edges[0]?.id || prev.interiorWalls?.[0]?.id || '';
      if (!targetEdgeId && defaults.defaultPlacement === 'wall') return prev;
      const baseLayers = getEffectiveLayers(prev.layers);
      const assignedLayerId =
        layerFilter !== 'all' && baseLayers.some((l) => l.id === layerFilter)
          ? layerFilter
          : getDefaultLayerIdForKind(kind, baseLayers);
      const freeCount = prev.elements.filter((e) => e.placement === 'free').length;
      const staggerX = ((freeCount % 3) - 1) * 75;
      const staggerY = ((Math.floor(freeCount / 3) % 3) - 1) * 75;
      const newEl: FloorplanElement = {
        id: newId,
        kind,
        name: defaults.label,
        placement: defaults.defaultPlacement,
        edgeId: targetEdgeId,
        offsetCm: 20,
        xCm: centerX + staggerX,
        yCm: centerY + staggerY,
        rotationDeg: 0,
        widthCm: defaults.widthCm,
        depthCm: kind === 'door' || kind === 'window' ? prev.wallThicknessCm : defaults.depthCm,
        heightCm: defaults.heightCm,
        elevationCm: defaults.elevationCm,
        side: 'inside',
        layerId: assignedLayerId,
        ...(kind === 'door' ? { swingDirection: 'inward-right' as DoorSwing } : {}),
        ...(kind === 'bed' ? { showClearance: true } : {}),
      };
      return { ...prev, elements: [...prev.elements, newEl] };
    });
    setExpandedElementIds((prev) => ({ ...prev, [newId]: true }));
    onSelectElement(newId);
    onSelectEdge(null);
    setActiveTab('elements');
  };

  const updateElement = (elId: string, patch: Partial<FloorplanElement>) => {
    onUpdateProject((prev) => ({
      ...prev,
      elements: prev.elements.map((el) => (el.id === elId ? { ...el, ...patch } : el)),
    }));
  };

  const removeElement = (elId: string) => {
    onUpdateProject((prev) => ({
      ...prev,
      elements: prev.elements.filter((el) => el.id !== elId),
    }));
  };

  return (
    <aside className="w-full lg:w-[420px] shrink-0 bg-white border-r border-slate-200 flex flex-col h-full overflow-y-auto">
      {/* Section 1: Sketch Upload & AI Recognition */}
      <div className="p-4 border-b border-slate-200 space-y-3">
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-900">1. 手寫草圖上傳與 AI 辨識</h2>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => onLoadPreset('attached')}
              className="text-xs font-medium text-slate-600 hover:text-slate-900 px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
              title="重設為附檔手寫草圖範例"
            >
              範例手稿
            </button>
            <button
              type="button"
              onClick={() => onLoadPreset('l-studio')}
              className="text-xs font-medium text-slate-600 hover:text-slate-900 px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
            >
              L 型範例
            </button>
            <button
              type="button"
              onClick={() => onLoadPreset('care-room')}
              className="text-xs font-medium text-teal-700 hover:text-teal-900 px-2 py-1 rounded border border-teal-200 bg-teal-50/60 hover:bg-teal-50 transition-colors whitespace-nowrap shrink-0"
              title="載入含病床、桌椅與照護動線範例"
            >
              病房範例
            </button>
            <button
              type="button"
              onClick={() => onLoadPreset('room-in-room')}
              className="text-xs font-medium text-indigo-700 hover:text-indigo-900 px-2 py-1 rounded border border-indigo-200 bg-indigo-50/60 hover:bg-indigo-50 transition-colors whitespace-nowrap shrink-0"
              title="載入含室內隔間小房、門窗與柱體範例"
            >
              房中房範例
            </button>
          </div>
        </div>

        {/* Upload Dropzone */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFileChange(e.dataTransfer.files?.[0]);
          }}
          className="border border-dashed border-slate-300 rounded-lg p-3 bg-slate-50/70 hover:bg-slate-50 transition-colors"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => handleFileChange(e.target.files?.[0])}
            className="sr-only"
            id="sketch-file-input"
            aria-label="上傳手寫平面圖草圖檔案"
          />

          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden">
              {uploadedPreview?.previewUrl ? (
                <img
                  src={uploadedPreview.previewUrl}
                  alt="已上傳的平面圖草圖預覽"
                  className="w-full h-full object-cover"
                />
              ) : uploadedPreview ? (
                <FileText className="w-5 h-5 text-blue-600" />
              ) : (
                <Upload className="w-5 h-5 text-slate-500" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-slate-800 truncate">
                {uploadedPreview ? uploadedPreview.name : '拖曳或選擇草圖檔案'}
              </p>
              <p className="text-xs text-slate-500">支援 JPG / PNG / WebP / PDF</p>
            </div>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              選擇檔案
            </button>
          </div>
        </div>

        {/* Action buttons for AI Recognition */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!uploadedPreview || isAnalyzing}
            onClick={handleTriggerAnalyze}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{isAnalyzing ? 'AI 辨識中...' : 'AI 辨識上傳草圖'}</span>
          </button>

          <button
            type="button"
            disabled={isAnalyzing}
            onClick={onAnalyzeSamplePdf}
            className="px-3 py-2 rounded-lg text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            title="呼叫 Gemini 模型即時解析附檔範例 PDF"
          >
            AI 解析範例 PDF
          </button>
        </div>

        <div className="flex items-center justify-between text-xs text-slate-500">
          <a
            href={`${import.meta.env.BASE_URL}assets/aistudio/20261119_094437_bf0502ec.pdf`}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-slate-300 hover:text-slate-800"
          >
            檢視原始附檔手寫 PDF
          </a>
          <span>自動擷取邊長、門窗櫃與天花高度</span>
        </div>

        {(fileError || analyzeError) && (
          <div
            role="alert"
            className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"
          >
            {fileError || analyzeError}
          </div>
        )}

        {project.analysisNotes && (
          <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 border border-slate-200 rounded-lg p-2.5">
            {project.analysisNotes}
          </p>
        )}
      </div>

      {/* Section 2: Space Settings & Closure Diagnostics */}
      <div className="p-4 border-b border-slate-200 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">2. 空間參數與幾何校正</h2>
          <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-md">
            {(['cm', 'm', 'mm'] as UnitType[]).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => onUpdateProject((p) => ({ ...p, unit: u }))}
                className={`px-2 py-0.5 text-xs font-mono rounded transition-colors ${
                  project.unit === u
                    ? 'bg-white text-slate-900 font-semibold shadow-xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {u}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="ceiling-height"
              className="block text-xs font-medium text-slate-600 mb-1"
            >
              天花板高度 (cm)
            </label>
            <input
              id="ceiling-height"
              type="number"
              min={120}
              max={800}
              step={5}
              value={project.ceilingHeightCm}
              onChange={(e) =>
                onUpdateProject((p) => ({
                  ...p,
                  ceilingHeightCm: Math.max(100, Number(e.target.value) || 250),
                }))
              }
              className="w-full px-2.5 py-1.5 text-sm font-mono tabular-nums border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label
              htmlFor="wall-thickness"
              className="block text-xs font-medium text-slate-600 mb-1"
            >
              牆體厚度 (cm)
            </label>
            <input
              id="wall-thickness"
              type="number"
              min={5}
              max={60}
              step={1}
              value={project.wallThicknessCm}
              onChange={(e) =>
                onUpdateProject((p) => ({
                  ...p,
                  wallThicknessCm: Math.max(4, Number(e.target.value) || 12),
                }))
              }
              className="w-full px-2.5 py-1.5 text-sm font-mono tabular-nums border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Wall & Floor Surface Colors */}
        <div className="pt-2 border-t border-slate-100 space-y-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
              <Palette className="w-3.5 h-3.5 text-slate-500" />
              <span>空間色彩設定</span>
            </span>
            {(project.wallColor || project.floorColor) && (
              <button
                type="button"
                onClick={() =>
                  onUpdateProject((p) => ({
                    ...p,
                    wallColor: undefined,
                    floorColor: undefined,
                  }))
                }
                className="text-[11px] text-slate-500 hover:text-slate-800 underline decoration-slate-300 whitespace-nowrap shrink-0"
              >
                全部恢復預設
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-600 shrink-0">牆面色彩</span>
              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                {WALL_COLOR_PRESETS.map((preset) => {
                  const activeHex = sanitizeHexColor(project.wallColor) ?? DEFAULT_WALL_COLOR;
                  const isSelected = activeHex === preset.hex;
                  return (
                    <button
                      key={preset.hex}
                      type="button"
                      title={preset.label}
                      aria-label={`牆面色彩：${preset.label}`}
                      onClick={() =>
                        onUpdateProject((p) => ({ ...p, wallColor: preset.hex }))
                      }
                      className={`w-5 h-5 rounded border transition-transform ${
                        isSelected
                          ? 'border-blue-600 ring-2 ring-blue-500/40 scale-110'
                          : 'border-slate-300 hover:scale-105'
                      }`}
                      style={{ backgroundColor: preset.hex }}
                    />
                  );
                })}
                <input
                  type="color"
                  aria-label="自訂牆面色彩"
                  title="自訂牆面色彩"
                  value={sanitizeHexColor(project.wallColor) ?? DEFAULT_WALL_COLOR}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      wallColor: sanitizeHexColor(e.target.value),
                    }))
                  }
                  className="w-5 h-5 p-0 border border-slate-300 rounded cursor-pointer bg-transparent"
                />
                {project.wallColor && (
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateProject((p) => ({ ...p, wallColor: undefined }))
                    }
                    className="px-1.5 py-0.5 text-[10.5px] rounded border border-slate-200 text-slate-600 hover:bg-slate-100 whitespace-nowrap shrink-0"
                  >
                    預設
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-600 shrink-0">地面色彩</span>
              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                {FLOOR_COLOR_PRESETS.map((preset) => {
                  const activeHex = sanitizeHexColor(project.floorColor) ?? DEFAULT_FLOOR_COLOR;
                  const isSelected = activeHex === preset.hex;
                  return (
                    <button
                      key={preset.hex}
                      type="button"
                      title={preset.label}
                      aria-label={`地面色彩：${preset.label}`}
                      onClick={() =>
                        onUpdateProject((p) => ({ ...p, floorColor: preset.hex }))
                      }
                      className={`w-5 h-5 rounded border transition-transform ${
                        isSelected
                          ? 'border-blue-600 ring-2 ring-blue-500/40 scale-110'
                          : 'border-slate-300 hover:scale-105'
                      }`}
                      style={{ backgroundColor: preset.hex }}
                    />
                  );
                })}
                <input
                  type="color"
                  aria-label="自訂地面色彩"
                  title="自訂地面色彩"
                  value={sanitizeHexColor(project.floorColor) ?? DEFAULT_FLOOR_COLOR}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      floorColor: sanitizeHexColor(e.target.value),
                    }))
                  }
                  className="w-5 h-5 p-0 border border-slate-300 rounded cursor-pointer bg-transparent"
                />
                {project.floorColor && (
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateProject((p) => ({ ...p, floorColor: undefined }))
                    }
                    className="px-1.5 py-0.5 text-[10.5px] rounded border border-slate-200 text-slate-600 hover:bg-slate-100 whitespace-nowrap shrink-0"
                  >
                    預設
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Angle Snap & Force Close Switches */}
        <div className="space-y-2 pt-1">
          <label className="flex items-center justify-between gap-2 text-xs text-slate-700 cursor-pointer">
            <span>自動校正接近垂直／水平角 (±{project.snapToleranceDeg}°)</span>
            <input
              type="checkbox"
              checked={project.autoSnapAngles}
              onChange={(e) =>
                onUpdateProject((p) => ({ ...p, autoSnapAngles: e.target.checked }))
              }
              className="w-4 h-4 accent-blue-600 rounded"
            />
          </label>

          <label className="flex items-center justify-between gap-2 text-xs text-slate-700 cursor-pointer">
            <span>強制閉合多邊形（幾何誤差平均分配）</span>
            <input
              type="checkbox"
              checked={project.forceClose}
              onChange={(e) =>
                onUpdateProject((p) => ({ ...p, forceClose: e.target.checked }))
              }
              className="w-4 h-4 accent-blue-600 rounded"
            />
          </label>
        </div>

        {/* Closure Diagnostic Status */}
        {solved.isClosed ? (
          <div className="flex items-center gap-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>空間輪廓已完整閉合（誤差 {formatDimension(solved.gapCm, project.unit)}）</span>
          </div>
        ) : (
          <div className="bg-amber-50/80 border border-amber-200 rounded-lg p-3 space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-900">
                <p className="font-semibold">
                  輪廓尚有 {formatDimension(solved.gapCm, project.unit)} 閉合缺口
                </p>
                <p className="text-amber-800 mt-0.5">
                  手寫草圖常因測量四捨五入或斜角誤差產生微幅缺口，您可微調以下牆段或點選自動閉合：
                </p>
              </div>
            </div>

            {solved.closureSuggestions.length > 0 && (
              <ul className="space-y-1 pl-6 text-xs text-amber-900 list-disc">
                {solved.closureSuggestions.map((sug) => (
                  <li key={sug.edgeId}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectEdge(sug.edgeId);
                        setActiveTab('edges');
                      }}
                      className="text-left hover:underline"
                    >
                      <span className="font-semibold">{sug.label}</span>：{sug.reason}（建議{' '}
                      <span className="font-mono tabular-nums">{sug.suggestedLengthCm} cm</span>）
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <button
              type="button"
              onClick={onAutoClose}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-amber-600 text-white hover:bg-amber-700 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>一鍵微調邊長並閉合圖形</span>
            </button>
          </div>
        )}
      </div>

      {/* Section 3: Editable Edges & Elements List */}
      <div className="p-4 flex-1 flex flex-col space-y-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setActiveTab('edges')}
            className={`flex-1 py-1.5 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'edges'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            牆壁與隔間 ({project.edges.length + (project.interiorWalls?.length ?? 0)})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('elements')}
            className={`flex-1 py-1.5 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'elements'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            門窗與家具 ({project.elements.length})
          </button>
        </div>

        {activeTab === 'edges' ? (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">依順時針順序定義各段邊長與方位角</span>
              <button
                type="button"
                onClick={addEdge}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-slate-900 text-white hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>新增牆段</span>
              </button>
            </div>

            <div className="space-y-2">
              {project.edges.map((edge, idx) => {
                const isSelected = selectedEdgeId === edge.id;
                return (
                  <div
                    key={edge.id}
                    onClick={() => {
                      onSelectEdge(edge.id);
                      onSelectElement(null);
                    }}
                    className={`p-2.5 rounded-lg border transition-colors ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50/40'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-mono font-semibold text-slate-400 w-5">
                        {idx + 1}.
                      </span>
                      <input
                        type="text"
                        value={edge.label}
                        aria-label={`第 ${idx + 1} 段牆壁名稱`}
                        onChange={(e) => updateEdge(edge.id, { label: e.target.value })}
                        className="flex-1 min-w-0 px-2 py-1 text-xs font-medium text-slate-900 bg-slate-50 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <label className="flex items-center gap-1 text-xs text-slate-600 whitespace-nowrap shrink-0 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={edge.hasWall}
                          onChange={(e) => updateEdge(edge.id, { hasWall: e.target.checked })}
                          className="accent-blue-600"
                        />
                        <span>實體牆</span>
                      </label>
                      <button
                        type="button"
                        disabled={project.edges.length <= 3}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeEdge(edge.id);
                        }}
                        aria-label={`刪除 ${edge.label}`}
                        className="p-1 text-slate-400 hover:text-red-600 disabled:opacity-30 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] text-slate-500 mb-0.5">
                          長度 (cm)
                        </label>
                        <input
                          type="number"
                          min={5}
                          step={1}
                          value={edge.lengthCm}
                          aria-label={`${edge.label} 長度公分`}
                          onChange={(e) =>
                            updateEdge(edge.id, {
                              lengthCm: Math.max(1, Number(e.target.value) || 10),
                            })
                          }
                          className="w-full px-2 py-1 text-xs font-mono tabular-nums border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-500 mb-0.5">
                          角度 (0°右 / 90°下)
                        </label>
                        <input
                          type="number"
                          step={1}
                          value={edge.angleDeg}
                          aria-label={`${edge.label} 角度`}
                          onChange={(e) =>
                            updateEdge(edge.id, {
                              angleDeg: ((Number(e.target.value) || 0) % 360 + 360) % 360,
                            })
                          }
                          className="w-full px-2 py-1 text-xs font-mono tabular-nums border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1 mt-2">
                      {ANGLE_QUICK_OPTIONS.map((opt) => (
                        <button
                          key={opt.deg}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            updateEdge(edge.id, { angleDeg: opt.deg });
                          }}
                          className={`px-1.5 py-0.5 text-[11px] rounded border transition-colors ${
                            Math.round(edge.angleDeg) === opt.deg
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Interior Partition Walls Section */}
            <div className="pt-3 border-t border-slate-200 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold text-slate-800">
                    室內隔間牆／房中房 ({project.interiorWalls?.length ?? 0})
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    以左上角 (0, 0) 為起點座標，可附著門窗與櫃體
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addInteriorWall}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>新增隔間牆</span>
                </button>
              </div>

              {!project.interiorWalls || project.interiorWalls.length === 0 ? (
                <p className="text-xs text-slate-400 py-3 text-center border border-dashed border-slate-200 rounded-lg">
                  尚無室內隔間牆；若大空間內有獨立小房間，可點擊上方新增或由 AI 自動辨識。
                </p>
              ) : (
                <div className="space-y-2">
                  {project.interiorWalls.map((iw, idx) => {
                    const isSelected = selectedEdgeId === iw.id;
                    return (
                      <div
                        key={iw.id}
                        onClick={() => {
                          onSelectEdge(iw.id);
                          onSelectElement(null);
                        }}
                        className={`p-2.5 rounded-lg border transition-colors ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50/40'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-mono font-semibold text-indigo-500 w-5">
                            I{idx + 1}
                          </span>
                          <input
                            type="text"
                            value={iw.label}
                            aria-label={`第 ${idx + 1} 段隔間牆名稱`}
                            onChange={(e) =>
                              updateInteriorWall(iw.id, { label: e.target.value })
                            }
                            className="flex-1 min-w-0 px-2 py-1 text-xs font-medium text-slate-900 bg-slate-50 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                          <label className="flex items-center gap-1 text-xs text-slate-600 whitespace-nowrap shrink-0 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={iw.hasWall}
                              onChange={(e) =>
                                updateInteriorWall(iw.id, { hasWall: e.target.checked })
                              }
                              className="accent-blue-600"
                            />
                            <span>實體牆</span>
                          </label>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeInteriorWall(iw.id);
                            }}
                            aria-label={`刪除 ${iw.label}`}
                            className="p-1 text-slate-400 hover:text-red-600 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="grid grid-cols-4 gap-1.5">
                          <div>
                            <label className="block text-[10.5px] text-slate-500 mb-0.5">
                              起點 X
                            </label>
                            <input
                              type="number"
                              step={1}
                              value={iw.startXCm}
                              aria-label={`${iw.label} 起點X`}
                              onChange={(e) =>
                                updateInteriorWall(iw.id, {
                                  startXCm: Number(e.target.value) || 0,
                                })
                              }
                              className="w-full px-1.5 py-1 text-xs font-mono tabular-nums border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-[10.5px] text-slate-500 mb-0.5">
                              起點 Y
                            </label>
                            <input
                              type="number"
                              step={1}
                              value={iw.startYCm}
                              aria-label={`${iw.label} 起點Y`}
                              onChange={(e) =>
                                updateInteriorWall(iw.id, {
                                  startYCm: Number(e.target.value) || 0,
                                })
                              }
                              className="w-full px-1.5 py-1 text-xs font-mono tabular-nums border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-[10.5px] text-slate-500 mb-0.5">
                              長度 (cm)
                            </label>
                            <input
                              type="number"
                              min={5}
                              step={1}
                              value={iw.lengthCm}
                              aria-label={`${iw.label} 長度公分`}
                              onChange={(e) =>
                                updateInteriorWall(iw.id, {
                                  lengthCm: Math.max(1, Number(e.target.value) || 10),
                                })
                              }
                              className="w-full px-1.5 py-1 text-xs font-mono tabular-nums border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-[10.5px] text-slate-500 mb-0.5">
                              角度 (°)
                            </label>
                            <input
                              type="number"
                              step={1}
                              value={iw.angleDeg}
                              aria-label={`${iw.label} 角度`}
                              onChange={(e) =>
                                updateInteriorWall(iw.id, {
                                  angleDeg: ((Number(e.target.value) || 0) % 360 + 360) % 360,
                                })
                              }
                              className="w-full px-1.5 py-1 text-xs font-mono tabular-nums border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-1 mt-2">
                          {ANGLE_QUICK_OPTIONS.slice(0, 4).map((opt) => (
                            <button
                              key={opt.deg}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateInteriorWall(iw.id, { angleDeg: opt.deg });
                              }}
                              className={`px-1.5 py-0.5 text-[11px] rounded border transition-colors ${
                                Math.round(iw.angleDeg) === opt.deg
                                  ? 'bg-slate-900 text-white border-slate-900'
                                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {/* Element Category Tabs */}
            <div
              role="tablist"
              aria-label="元件分類篩選"
              className="flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-lg"
            >
              <button
                type="button"
                role="tab"
                aria-selected={elementCategoryFilter === 'all'}
                onClick={() => setElementCategoryFilter('all')}
                className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  elementCategoryFilter === 'all'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                全部
              </button>
              {ELEMENT_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  role="tab"
                  aria-selected={elementCategoryFilter === cat.id}
                  onClick={() => setElementCategoryFilter(cat.id)}
                  className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    elementCategoryFilter === cat.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  {
                    kind: 'door',
                    label: '+ 門',
                    icon: <DoorOpen className="w-3.5 h-3.5" />,
                    cls: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100',
                  },
                  {
                    kind: 'window',
                    label: '+ 窗戶',
                    icon: <Square className="w-3.5 h-3.5" />,
                    cls: 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100',
                  },
                  {
                    kind: 'table',
                    label: '+ 桌子',
                    icon: <Table2 className="w-3.5 h-3.5" />,
                    cls: 'bg-yellow-50 text-yellow-800 border-yellow-200 hover:bg-yellow-100',
                  },
                  {
                    kind: 'round_table',
                    label: '+ 圓桌',
                    icon: <Circle className="w-3.5 h-3.5" />,
                    cls: 'bg-yellow-50 text-yellow-800 border-yellow-200 hover:bg-yellow-100',
                  },
                  {
                    kind: 'chair',
                    label: '+ 椅子',
                    icon: <Armchair className="w-3.5 h-3.5" />,
                    cls: 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200',
                  },
                  {
                    kind: 'sofa',
                    label: '+ 沙發',
                    icon: <Sofa className="w-3.5 h-3.5" />,
                    cls: 'bg-indigo-50 text-indigo-800 border-indigo-200 hover:bg-indigo-100',
                  },
                  {
                    kind: 'cabinet',
                    label: '+ 櫃體',
                    icon: <Box className="w-3.5 h-3.5" />,
                    cls: 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100',
                  },
                  {
                    kind: 'wall_cabinet',
                    label: '+ 吊櫃',
                    icon: <PanelTop className="w-3.5 h-3.5" />,
                    cls: 'bg-orange-50 text-orange-800 border-orange-200 hover:bg-orange-100',
                  },
                  {
                    kind: 'kitchen_counter',
                    label: '+ 廚房一字櫥櫃',
                    icon: <Utensils className="w-3.5 h-3.5" />,
                    cls: 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100',
                  },
                  {
                    kind: 'toilet',
                    label: '+ 馬桶',
                    icon: <Toilet className="w-3.5 h-3.5" />,
                    cls: 'bg-cyan-50 text-cyan-800 border-cyan-200 hover:bg-cyan-100',
                  },
                  {
                    kind: 'urinal',
                    label: '+ 小便斗',
                    icon: <Droplets className="w-3.5 h-3.5" />,
                    cls: 'bg-cyan-50 text-cyan-800 border-cyan-200 hover:bg-cyan-100',
                  },
                  {
                    kind: 'shower',
                    label: '+ 蓮蓬頭',
                    icon: <ShowerHead className="w-3.5 h-3.5" />,
                    cls: 'bg-indigo-50 text-indigo-800 border-indigo-200 hover:bg-indigo-100',
                  },
                  {
                    kind: 'sink',
                    label: '+ 洗手台',
                    icon: <Bath className="w-3.5 h-3.5" />,
                    cls: 'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100',
                  },
                  {
                    kind: 'bed',
                    label: '+ 病床',
                    icon: <BedDouble className="w-3.5 h-3.5" />,
                    cls: 'bg-teal-50 text-teal-800 border-teal-200 hover:bg-teal-100',
                  },
                  {
                    kind: 'bed_curtain',
                    label: '+ 病床隔簾(L型)',
                    icon: <Columns2 className="w-3.5 h-3.5" />,
                    cls: 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100',
                  },
                ] as Array<{
                  kind: ElementKind;
                  label: string;
                  icon: React.ReactNode;
                  cls: string;
                }>
              )
                .filter(
                  (btn) =>
                    elementCategoryFilter === 'all' ||
                    ELEMENT_KIND_DEFAULTS[btn.kind].category === elementCategoryFilter
                )
                .map((btn) => (
                  <button
                    key={btn.kind}
                    type="button"
                    onClick={() => addElement(btn.kind)}
                    className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${btn.cls}`}
                  >
                    {btn.icon}
                    <span>{btn.label}</span>
                  </button>
                ))}
            </div>

            {/* Layer Management Panel */}
            <div
              data-testid="layers-panel"
              className="border border-slate-200 rounded-lg bg-slate-50/70 overflow-hidden"
            >
              <div className="px-2.5 py-2 flex items-center justify-between gap-2 bg-white border-b border-slate-100">
                <button
                  type="button"
                  aria-expanded={layersPanelOpen}
                  onClick={() => setLayersPanelOpen((v) => !v)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 min-w-0"
                >
                  {layersPanelOpen ? (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  )}
                  <Layers className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                  <span className="truncate">圖層管理 ({effectiveLayers.length})</span>
                </button>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setAllLayersVisibility(true)}
                    className="px-1.5 py-0.5 text-[10.5px] text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded whitespace-nowrap shrink-0"
                  >
                    全部顯示
                  </button>
                  <button
                    type="button"
                    onClick={() => setAllLayersVisibility(false)}
                    className="px-1.5 py-0.5 text-[10.5px] text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded whitespace-nowrap shrink-0"
                  >
                    全部隱藏
                  </button>
                </div>
              </div>

              {layersPanelOpen && (
                <div className="p-2 space-y-1.5">
                  <div className="divide-y divide-slate-200/80 border border-slate-200 rounded-md bg-white">
                    {effectiveLayers.map((layer) => {
                      const count = project.elements.filter(
                        (el) => resolveElementLayer(el, effectiveLayers)?.id === layer.id
                      ).length;
                      const isBuiltIn = DEFAULT_FLOORPLAN_LAYERS.some((d) => d.id === layer.id);
                      const isFiltered = layerFilter === layer.id;
                      return (
                        <div
                          key={layer.id}
                          data-testid={`layer-row-${layer.id}`}
                          className={`px-2 py-1.5 flex items-center gap-1.5 ${
                            isFiltered ? 'bg-blue-50/50' : ''
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => toggleLayerVisibility(layer.id)}
                            aria-label={`${layer.visible ? '隱藏' : '顯示'}圖層 ${layer.name}`}
                            title={layer.visible ? '點擊隱藏整個圖層' : '點擊顯示整個圖層'}
                            className={`p-1 rounded border transition-colors shrink-0 ${
                              layer.visible
                                ? 'text-slate-700 border-slate-200 bg-white hover:bg-slate-100'
                                : 'text-slate-400 border-slate-200 bg-slate-100 hover:text-slate-700'
                            }`}
                          >
                            {layer.visible ? (
                              <Eye className="w-3.5 h-3.5" />
                            ) : (
                              <EyeOff className="w-3.5 h-3.5" />
                            )}
                          </button>

                          <input
                            type="text"
                            value={layer.name}
                            aria-label={`圖層名稱 ${layer.name}`}
                            onChange={(e) => renameLayer(layer.id, e.target.value)}
                            className={`flex-1 min-w-0 px-1.5 py-0.5 text-xs bg-transparent border border-transparent hover:border-slate-200 focus:border-blue-400 focus:bg-white rounded focus:outline-none ${
                              layer.visible ? 'font-medium text-slate-800' : 'text-slate-400 line-through'
                            }`}
                          />

                          <button
                            type="button"
                            onClick={() =>
                              setLayerFilter((curr) => (curr === layer.id ? 'all' : layer.id))
                            }
                            title={isFiltered ? '取消圖層篩選' : '只顯示此圖層元件'}
                            className={`text-[10.5px] font-mono tabular-nums px-1.5 py-0.5 rounded whitespace-nowrap shrink-0 ${
                              isFiltered
                                ? 'bg-blue-600 text-white font-semibold'
                                : 'text-slate-500 hover:bg-slate-100'
                            }`}
                          >
                            {count}件
                          </button>

                          <input
                            type="color"
                            aria-label={`${layer.name} 統一色彩`}
                            title={`設定「${layer.name}」統一顏色`}
                            value={sanitizeHexColor(layer.color) ?? '#d9b382'}
                            onChange={(e) => setLayerUniformColor(layer.id, e.target.value)}
                            className="w-4 h-4 p-0 border border-slate-300 rounded cursor-pointer bg-transparent shrink-0"
                          />

                          {layer.color && (
                            <button
                              type="button"
                              onClick={() => setLayerUniformColor(layer.id, undefined)}
                              title="清除此圖層統一色彩"
                              className="px-1 py-0.5 text-[10px] text-slate-600 hover:bg-slate-100 border border-slate-200 rounded whitespace-nowrap shrink-0"
                            >
                              預設
                            </button>
                          )}

                          {!isBuiltIn && effectiveLayers.length > 1 && (
                            <button
                              type="button"
                              onClick={() => deleteCustomLayer(layer.id)}
                              aria-label={`刪除圖層 ${layer.name}`}
                              className="p-0.5 text-slate-400 hover:text-red-600 shrink-0"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Quick Add Layer */}
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={newLayerName}
                      onChange={(e) => setNewLayerName(e.target.value)}
                      placeholder="新圖層名稱（如：照明/弱電）"
                      aria-label="新圖層名稱"
                      className="flex-1 min-w-0 px-2 py-1 text-xs bg-white border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={addCustomLayer}
                      className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-white text-slate-700 border border-slate-200 hover:bg-slate-100 rounded whitespace-nowrap shrink-0"
                    >
                      <Plus className="w-3 h-3" />
                      <span>新增圖層</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {project.elements.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center border border-dashed border-slate-200 rounded-lg">
                目前尚未設定門窗或家具元件，請點擊上方按鈕新增。
              </p>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 px-0.5">
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500 min-w-0">
                    <span>
                      已配置 {project.elements.length} 項
                      {layerFilter !== 'all'
                        ? ` · 篩選：${effectiveLayers.find((l) => l.id === layerFilter)?.name ?? ''}`
                        : ''}
                    </span>
                    {layerFilter !== 'all' && (
                      <button
                        type="button"
                        onClick={() => setLayerFilter('all')}
                        className="text-blue-600 hover:underline whitespace-nowrap shrink-0"
                      >
                        顯示全部
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setAllElementsExpanded(true)}
                      className="px-1.5 py-0.5 text-[10.5px] text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded whitespace-nowrap shrink-0"
                    >
                      全部展開
                    </button>
                    <button
                      type="button"
                      onClick={() => setAllElementsExpanded(false)}
                      className="px-1.5 py-0.5 text-[10.5px] text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded whitespace-nowrap shrink-0"
                    >
                      全部收合
                    </button>
                  </div>
                </div>

                {project.elements
                  .filter((el) =>
                    layerFilter === 'all'
                      ? true
                      : resolveElementLayer(el, effectiveLayers)?.id === layerFilter
                  )
                  .map((el) => {
                  const isSelected = selectedElementId === el.id;
                  const isExpanded = Boolean(expandedElementIds[el.id]);
                  const isOpening = el.kind === 'door' || el.kind === 'window';
                  const placementMode: ElementPlacementMode =
                    !isOpening && el.placement === 'free' ? 'free' : 'wall';
                  const assignedLayer = resolveElementLayer(el, effectiveLayers);
                  const effectiveColor = resolveElementEffectiveColor(el, effectiveLayers);
                  const isLayerHidden = assignedLayer ? !assignedLayer.visible : false;

                  return (
                    <div
                      key={el.id}
                      data-testid={`element-card-${el.id}`}
                      onClick={() => {
                        onSelectElement(el.id);
                        onSelectEdge(null);
                      }}
                      className={`rounded-lg border transition-colors ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50/40'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      {/* Compact Header Row: Collapsed by default showing name + concise summary */}
                      <div className="px-2.5 py-2 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? '收合' : '展開'} ${el.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleElementExpanded(el.id);
                            onSelectElement(el.id);
                            onSelectEdge(null);
                          }}
                          className="flex items-center gap-1.5 min-w-0 flex-1 text-left"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          )}
                          <span
                            className="w-2.5 h-2.5 rounded-full border border-slate-300 shrink-0"
                            style={{ backgroundColor: effectiveColor ?? '#e2e8f0' }}
                          />
                          <span
                            className={`text-xs font-semibold truncate ${
                              isLayerHidden ? 'text-slate-400 line-through' : 'text-slate-900'
                            }`}
                          >
                            {el.name}
                          </span>
                        </button>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[11px] text-slate-500 font-mono tabular-nums whitespace-nowrap">
                            {Math.round(el.widthCm)}×{Math.round(el.depthCm)}×{Math.round(el.heightCm)}
                          </span>
                          {isLayerHidden && (
                            <span className="text-[10px] text-amber-700 font-medium whitespace-nowrap">
                              隱藏
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeElement(el.id);
                            }}
                            aria-label={`刪除 ${el.name}`}
                            className="p-1 text-slate-400 hover:text-red-600 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="px-2.5 pb-2.5 pt-2 border-t border-slate-100 space-y-2">
                          <div className="flex items-center gap-2">
                            <select
                              value={el.kind}
                              aria-label={`${el.name} 元件類型`}
                              onChange={(e) => {
                                const nextKind = e.target.value as ElementKind;
                                const nextDefs = ELEMENT_KIND_DEFAULTS[nextKind];
                                updateElement(el.id, {
                                  kind: nextKind,
                                  ...(nextKind === 'door' || nextKind === 'window'
                                    ? { placement: 'wall' }
                                    : {}),
                                  ...(nextKind === 'bed' && el.showClearance === undefined
                                    ? { showClearance: nextDefs.showClearance ?? true }
                                    : {}),
                                });
                              }}
                              className="px-2 py-1 text-xs font-medium bg-slate-50 border border-slate-200 rounded"
                            >
                              {ELEMENT_CATEGORIES.map((cat) => (
                                <optgroup key={cat.id} label={cat.label}>
                                  {cat.kinds.map((k) => (
                                    <option key={k} value={k}>
                                      {ELEMENT_KIND_DEFAULTS[k].label}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>
                            <input
                              type="text"
                              value={el.name}
                              aria-label={`元件名稱 ${el.name}`}
                              onChange={(e) => updateElement(el.id, { name: e.target.value })}
                              className="flex-1 min-w-0 px-2 py-1 text-xs font-medium border border-slate-200 rounded"
                            />
                          </div>

                          <div className="flex items-center justify-between gap-2">
                            <label className="text-[11px] text-slate-500 shrink-0">所屬圖層</label>
                            <select
                              value={assignedLayer?.id ?? ''}
                              aria-label={`${el.name} 所屬圖層`}
                              onChange={(e) => updateElement(el.id, { layerId: e.target.value })}
                              className="flex-1 max-w-[200px] px-2 py-1 text-xs bg-white border border-slate-200 rounded"
                            >
                              {effectiveLayers.map((layer) => (
                                <option key={layer.id} value={layer.id}>
                                  {layer.name}
                                  {!layer.visible ? ' (已隱藏)' : ''}
                                </option>
                              ))}
                            </select>
                          </div>

                      {!isOpening && (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-slate-500">定位方式</span>
                          <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateElement(el.id, { placement: 'wall' });
                              }}
                              className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                                placementMode === 'wall'
                                  ? 'bg-white text-slate-900 font-semibold shadow-xs'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              貼牆定位
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateElement(el.id, {
                                  placement: 'free',
                                  xCm: el.xCm ?? Math.round(solved.bounds.centerX),
                                  yCm: el.yCm ?? Math.round(solved.bounds.centerY),
                                  rotationDeg: el.rotationDeg ?? 0,
                                });
                              }}
                              className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                                placementMode === 'free'
                                  ? 'bg-white text-slate-900 font-semibold shadow-xs'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              自由擺放
                            </button>
                          </div>
                        </div>
                      )}

                      {placementMode === 'wall' ? (
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[11px] text-slate-500 mb-0.5">
                              依附牆壁
                            </label>
                            <select
                              value={el.edgeId}
                              aria-label={`${el.name} 依附牆壁`}
                              onChange={(e) => updateElement(el.id, { edgeId: e.target.value })}
                              className="w-full px-2 py-1 text-xs bg-white border border-slate-200 rounded"
                            >
                              <optgroup label="外圍牆壁">
                                {project.edges.map((edge) => (
                                  <option key={edge.id} value={edge.id}>
                                    {edge.label} ({edge.lengthCm} cm)
                                  </option>
                                ))}
                              </optgroup>
                              {project.interiorWalls && project.interiorWalls.length > 0 && (
                                <optgroup label="室內隔間牆">
                                  {project.interiorWalls.map((iw) => (
                                    <option key={iw.id} value={iw.id}>
                                      {iw.label} ({iw.lengthCm} cm)
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                            </select>
                          </div>

                          <div>
                            <label className="block text-[11px] text-slate-500 mb-0.5">
                              距起點偏移 (cm)
                            </label>
                            <input
                              type="number"
                              min={0}
                              value={el.offsetCm}
                              aria-label={`${el.name} 偏移公分`}
                              onChange={(e) =>
                                updateElement(el.id, {
                                  offsetCm: Math.max(0, Number(e.target.value) || 0),
                                })
                              }
                              className="w-full px-2 py-1 text-xs font-mono tabular-nums border border-slate-200 rounded"
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[11px] text-slate-500 mb-0.5">
                              X 座標 (cm)
                            </label>
                            <input
                              type="number"
                              value={Math.round(el.xCm ?? solved.bounds.centerX)}
                              aria-label={`${el.name} X座標`}
                              onChange={(e) =>
                                updateElement(el.id, {
                                  xCm: Number(e.target.value) || 0,
                                })
                              }
                              className="w-full px-2 py-1 text-xs font-mono tabular-nums border border-slate-200 rounded"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-500 mb-0.5">
                              Y 座標 (cm)
                            </label>
                            <input
                              type="number"
                              value={Math.round(el.yCm ?? solved.bounds.centerY)}
                              aria-label={`${el.name} Y座標`}
                              onChange={(e) =>
                                updateElement(el.id, {
                                  yCm: Number(e.target.value) || 0,
                                })
                              }
                              className="w-full px-2 py-1 text-xs font-mono tabular-nums border border-slate-200 rounded"
                            />
                          </div>
                        </div>
                      )}

                      {!isOpening && (
                        <div className="space-y-1.5 pt-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <label className="text-[11px] text-slate-500">
                              方向旋轉角度 (°)
                            </label>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateElement(el.id, {
                                    rotationDeg: rotateElementAngle(el.rotationDeg, -90),
                                  });
                                }}
                                className="px-1.5 py-0.5 text-[10.5px] rounded border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                              >
                                -90°
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateElement(el.id, {
                                    rotationDeg: rotateElementAngle(el.rotationDeg, 90),
                                  });
                                }}
                                className="px-1.5 py-0.5 text-[10.5px] rounded border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                              >
                                +90°
                              </button>
                              <input
                                type="number"
                                step={15}
                                value={Math.round(el.rotationDeg ?? 0)}
                                aria-label={`${el.name} 旋轉角度`}
                                onChange={(e) =>
                                  updateElement(el.id, {
                                    rotationDeg: ((Number(e.target.value) || 0) % 360 + 360) % 360,
                                  })
                                }
                                className="w-16 px-1.5 py-0.5 text-xs font-mono tabular-nums border border-slate-200 rounded text-right"
                              />
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-1">
                            <div className="flex items-center gap-1">
                              {[0, 90, 180, 270].map((deg) => (
                                <button
                                  key={deg}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    updateElement(el.id, { rotationDeg: deg });
                                  }}
                                  className={`px-1.5 py-0.5 text-[10.5px] rounded border transition-colors ${
                                    Math.round(el.rotationDeg ?? 0) === deg
                                      ? 'bg-slate-900 text-white border-slate-900'
                                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                                  }`}
                                >
                                  {deg}°
                                </button>
                              ))}
                            </div>
                            <span className="text-[10.5px] text-slate-400">
                              {placementMode === 'free' ? '2D 圖可拖曳與旋轉' : '2D 圖可拖曳旋轉'}
                            </span>
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-0.5">
                            寬度 (cm)
                          </label>
                          <input
                            type="number"
                            min={10}
                            value={el.widthCm}
                            aria-label={`${el.name} 寬度`}
                            onChange={(e) =>
                              updateElement(el.id, {
                                widthCm: Math.max(10, Number(e.target.value) || 60),
                              })
                            }
                            className="w-full px-2 py-1 text-xs font-mono tabular-nums border border-slate-200 rounded"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-0.5">
                            深度/長 (cm)
                          </label>
                          <input
                            type="number"
                            min={5}
                            value={el.depthCm}
                            aria-label={`${el.name} 深度`}
                            onChange={(e) =>
                              updateElement(el.id, {
                                depthCm: Math.max(5, Number(e.target.value) || 12),
                              })
                            }
                            className="w-full px-2 py-1 text-xs font-mono tabular-nums border border-slate-200 rounded"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-0.5">
                            高度 (cm)
                          </label>
                          <input
                            type="number"
                            min={20}
                            value={el.heightCm}
                            aria-label={`${el.name} 高度`}
                            onChange={(e) =>
                              updateElement(el.id, {
                                heightCm: Math.max(20, Number(e.target.value) || 210),
                              })
                            }
                            className="w-full px-2 py-1 text-xs font-mono tabular-nums border border-slate-200 rounded"
                          />
                        </div>
                      </div>

                      {el.kind === 'door' &&
                        (() => {
                          const parsedDoor = parseDoorSwing(el.swingDirection);
                          return (
                            <div className="space-y-2 pt-0.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] text-slate-500">門扇型式</span>
                                <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      updateElement(el.id, {
                                        swingDirection: buildDoorSwing(
                                          'swing',
                                          parsedDoor.side,
                                          parsedDoor.dir
                                        ),
                                      });
                                    }}
                                    className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                                      parsedDoor.mode === 'swing'
                                        ? 'bg-white text-slate-900 font-semibold shadow-xs'
                                        : 'text-slate-600 hover:text-slate-900'
                                    }`}
                                  >
                                    推開門
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      updateElement(el.id, {
                                        swingDirection: buildDoorSwing(
                                          'sliding',
                                          parsedDoor.side,
                                          parsedDoor.dir
                                        ),
                                      });
                                    }}
                                    className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                                      parsedDoor.mode === 'sliding'
                                        ? 'bg-indigo-600 text-white font-semibold shadow-xs'
                                        : 'text-slate-600 hover:text-slate-900'
                                    }`}
                                  >
                                    橫拉門
                                  </button>
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-[11px] text-slate-500 mb-0.5">
                                    開門方向與位置
                                  </label>
                                  <select
                                    value={el.swingDirection || 'inward-right'}
                                    aria-label={`${el.name} 開門方向`}
                                    onChange={(e) =>
                                      updateElement(el.id, {
                                        swingDirection: e.target.value as DoorSwing,
                                      })
                                    }
                                    className="w-full px-2 py-1 text-xs bg-white border border-slate-200 rounded"
                                  >
                                    <optgroup label="推開門">
                                      <option value="inward-right">向內右開</option>
                                      <option value="inward-left">向內左開</option>
                                      <option value="outward-right">向外右開</option>
                                      <option value="outward-left">向外左開</option>
                                    </optgroup>
                                    <optgroup label="橫拉門">
                                      <option value="sliding-inward-right">內橫拉（往右拉）</option>
                                      <option value="sliding-inward-left">內橫拉（往左拉）</option>
                                      <option value="sliding-outward-right">外橫拉（往右拉）</option>
                                      <option value="sliding-outward-left">外橫拉（往左拉）</option>
                                    </optgroup>
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-[11px] text-slate-500 mb-0.5">
                                    離地高 (cm)
                                  </label>
                                  <input
                                    type="number"
                                    min={0}
                                    value={el.elevationCm}
                                    aria-label={`${el.name} 離地高`}
                                    onChange={(e) =>
                                      updateElement(el.id, {
                                        elevationCm: Math.max(0, Number(e.target.value) || 0),
                                      })
                                    }
                                    className="w-full px-2 py-1 text-xs font-mono tabular-nums border border-slate-200 rounded"
                                  />
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-1.5">
                                <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      updateElement(el.id, {
                                        swingDirection: buildDoorSwing(
                                          parsedDoor.mode,
                                          'inward',
                                          parsedDoor.dir
                                        ),
                                      });
                                    }}
                                    className={`flex-1 py-0.5 text-[11px] rounded transition-colors ${
                                      parsedDoor.side === 'inward'
                                        ? 'bg-white text-slate-900 font-semibold shadow-xs'
                                        : 'text-slate-600 hover:text-slate-900'
                                    }`}
                                  >
                                    {parsedDoor.mode === 'sliding' ? '內橫拉' : '內開'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      updateElement(el.id, {
                                        swingDirection: buildDoorSwing(
                                          parsedDoor.mode,
                                          'outward',
                                          parsedDoor.dir
                                        ),
                                      });
                                    }}
                                    className={`flex-1 py-0.5 text-[11px] rounded transition-colors ${
                                      parsedDoor.side === 'outward'
                                        ? 'bg-white text-slate-900 font-semibold shadow-xs'
                                        : 'text-slate-600 hover:text-slate-900'
                                    }`}
                                  >
                                    {parsedDoor.mode === 'sliding' ? '外橫拉' : '外開'}
                                  </button>
                                </div>
                                <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      updateElement(el.id, {
                                        swingDirection: buildDoorSwing(
                                          parsedDoor.mode,
                                          parsedDoor.side,
                                          'left'
                                        ),
                                      });
                                    }}
                                    className={`flex-1 py-0.5 text-[11px] rounded transition-colors ${
                                      parsedDoor.dir === 'left'
                                        ? 'bg-white text-slate-900 font-semibold shadow-xs'
                                        : 'text-slate-600 hover:text-slate-900'
                                    }`}
                                  >
                                    {parsedDoor.mode === 'sliding' ? '往左拉' : '左開'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      updateElement(el.id, {
                                        swingDirection: buildDoorSwing(
                                          parsedDoor.mode,
                                          parsedDoor.side,
                                          'right'
                                        ),
                                      });
                                    }}
                                    className={`flex-1 py-0.5 text-[11px] rounded transition-colors ${
                                      parsedDoor.dir === 'right'
                                        ? 'bg-white text-slate-900 font-semibold shadow-xs'
                                        : 'text-slate-600 hover:text-slate-900'
                                    }`}
                                  >
                                    {parsedDoor.mode === 'sliding' ? '往右拉' : '右開'}
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                      {el.kind === 'window' && (
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-0.5">
                            窗台離地高 (cm)
                          </label>
                          <input
                            type="number"
                            min={0}
                            value={el.elevationCm}
                            aria-label={`${el.name} 窗台離地高`}
                            onChange={(e) =>
                              updateElement(el.id, {
                                elevationCm: Math.max(0, Number(e.target.value) || 90),
                              })
                            }
                            className="w-full px-2 py-1 text-xs font-mono tabular-nums border border-slate-200 rounded"
                          />
                        </div>
                      )}

                      {!isOpening && placementMode === 'wall' && (
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[11px] text-slate-500 mb-0.5">
                              靠牆側向
                            </label>
                            <select
                              value={el.side}
                              aria-label={`${el.name} 靠牆側向`}
                              onChange={(e) =>
                                updateElement(el.id, {
                                  side: e.target.value as 'inside' | 'outside',
                                })
                              }
                              className="w-full px-2 py-1 text-xs bg-white border border-slate-200 rounded"
                            >
                              <option value="inside">朝室內擺放</option>
                              <option value="outside">朝牆外側</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-500 mb-0.5">
                              離地高 (cm)
                            </label>
                            <input
                              type="number"
                              min={0}
                              value={el.elevationCm}
                              aria-label={`${el.name} 離地高`}
                              onChange={(e) =>
                                updateElement(el.id, {
                                  elevationCm: Math.max(0, Number(e.target.value) || 0),
                                })
                              }
                              className="w-full px-2 py-1 text-xs font-mono tabular-nums border border-slate-200 rounded"
                            />
                          </div>
                        </div>
                      )}

                      {/* Element Color Selector */}
                      <div
                        className="flex items-center justify-between gap-2 pt-0.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="flex items-center gap-1 text-[11px] text-slate-500 shrink-0">
                          <Palette className="w-3 h-3" />
                          <span>物品色彩</span>
                        </span>
                        <div className="flex items-center gap-1 flex-wrap justify-end">
                          {ELEMENT_COLOR_PRESETS.map((preset) => {
                            const active = sanitizeHexColor(el.color) === preset.hex;
                            return (
                              <button
                                key={preset.hex}
                                type="button"
                                title={preset.label}
                                aria-label={`${el.name} 色彩：${preset.label}`}
                                onClick={() => updateElement(el.id, { color: preset.hex })}
                                className={`w-4 h-4 rounded border transition-transform ${
                                  active
                                    ? 'border-blue-600 ring-2 ring-blue-500/40 scale-110'
                                    : 'border-slate-300 hover:scale-105'
                                }`}
                                style={{ backgroundColor: preset.hex }}
                              />
                            );
                          })}
                          <input
                            type="color"
                            aria-label={`${el.name} 自訂色彩`}
                            title={`${el.name} 自訂色彩`}
                            value={sanitizeHexColor(el.color) ?? '#d9b382'}
                            onChange={(e) =>
                              updateElement(el.id, {
                                color: sanitizeHexColor(e.target.value),
                              })
                            }
                            className="w-4 h-4 p-0 border border-slate-300 rounded cursor-pointer bg-transparent"
                          />
                          {el.color && (
                            <button
                              type="button"
                              onClick={() => updateElement(el.id, { color: undefined })}
                              className="px-1.5 py-0.5 text-[10px] rounded border border-slate-200 text-slate-600 hover:bg-slate-100 whitespace-nowrap shrink-0"
                            >
                              預設
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-0.5">
                        <label className="flex items-center gap-1.5 text-xs text-teal-800 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={Boolean(el.showWallDistances)}
                            onChange={(e) =>
                              updateElement(el.id, { showWallDistances: e.target.checked })
                            }
                            className="accent-teal-600 rounded"
                          />
                          <span>顯示四邊距牆距離</span>
                        </label>
                        {el.kind === 'bed' && (
                          <label className="flex items-center gap-1.5 text-xs text-teal-800 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={Boolean(el.showClearance)}
                              onChange={(e) =>
                                updateElement(el.id, { showClearance: e.target.checked })
                              }
                              className="accent-teal-600 rounded"
                            />
                            <span>顯示 75 cm 照護動線</span>
                          </label>
                        )}
                      </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};

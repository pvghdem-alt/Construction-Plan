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
} from 'lucide-react';
import type {
  DoorSwing,
  ElementKind,
  ElementPlacementMode,
  FloorplanElement,
  FloorplanProject,
  InteriorWall,
  SolvedFloorplan,
  UnitType,
  WallEdge,
} from '../types/floorplan';
import {
  buildDoorSwing,
  ELEMENT_KIND_DEFAULTS,
  formatDimension,
  parseDoorSwing,
  rotateElementAngle,
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

  const addElement = (kind: ElementKind) => {
    const defaults = ELEMENT_KIND_DEFAULTS[kind];
    const centerX = Math.round(solved.bounds.centerX);
    const centerY = Math.round(solved.bounds.centerY);
    onUpdateProject((prev) => {
      const targetEdgeId =
        selectedEdgeId || prev.edges[0]?.id || prev.interiorWalls?.[0]?.id || '';
      if (!targetEdgeId && defaults.defaultPlacement === 'wall') return prev;
      const newEl: FloorplanElement = {
        id: `el-${Date.now()}`,
        kind,
        name: defaults.label,
        placement: defaults.defaultPlacement,
        edgeId: targetEdgeId,
        offsetCm: 20,
        xCm: centerX,
        yCm: centerY,
        rotationDeg: 0,
        widthCm: defaults.widthCm,
        depthCm: kind === 'door' || kind === 'window' ? prev.wallThicknessCm : defaults.depthCm,
        heightCm: defaults.heightCm,
        elevationCm: defaults.elevationCm,
        side: 'inside',
        ...(kind === 'door' ? { swingDirection: 'inward-right' as DoorSwing } : {}),
        ...(kind === 'bed' ? { showClearance: true } : {}),
      };
      return { ...prev, elements: [...prev.elements, newEl] };
    });
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
            href="/assets/aistudio/20261119_094437_bf0502ec.pdf"
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
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => addElement('door')}
                className="flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors whitespace-nowrap shrink-0"
              >
                <DoorOpen className="w-3.5 h-3.5" />
                <span>+ 門</span>
              </button>
              <button
                type="button"
                onClick={() => addElement('window')}
                className="flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100 transition-colors whitespace-nowrap shrink-0"
              >
                <Square className="w-3.5 h-3.5" />
                <span>+ 窗戶</span>
              </button>
              <button
                type="button"
                onClick={() => addElement('cabinet')}
                className="flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 transition-colors whitespace-nowrap shrink-0"
              >
                <Box className="w-3.5 h-3.5" />
                <span>+ 櫃體</span>
              </button>
              <button
                type="button"
                onClick={() => addElement('table')}
                className="flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium bg-yellow-50 text-yellow-800 border border-yellow-200 hover:bg-yellow-100 transition-colors whitespace-nowrap shrink-0"
              >
                <Table2 className="w-3.5 h-3.5" />
                <span>+ 桌子</span>
              </button>
              <button
                type="button"
                onClick={() => addElement('chair')}
                className="flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
              >
                <Armchair className="w-3.5 h-3.5" />
                <span>+ 椅子</span>
              </button>
              <button
                type="button"
                onClick={() => addElement('bed')}
                className="flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium bg-teal-50 text-teal-800 border border-teal-200 hover:bg-teal-100 transition-colors whitespace-nowrap shrink-0"
              >
                <BedDouble className="w-3.5 h-3.5" />
                <span>+ 病床</span>
              </button>
            </div>

            {project.elements.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center border border-dashed border-slate-200 rounded-lg">
                目前尚未設定門窗或家具元件，請點擊上方按鈕新增。
              </p>
            ) : (
              <div className="space-y-2.5">
                {project.elements.map((el) => {
                  const isSelected = selectedElementId === el.id;
                  const isOpening = el.kind === 'door' || el.kind === 'window';
                  const placementMode: ElementPlacementMode =
                    !isOpening && el.placement === 'free' ? 'free' : 'wall';
                  return (
                    <div
                      key={el.id}
                      onClick={() => {
                        onSelectElement(el.id);
                        onSelectEdge(null);
                      }}
                      className={`p-2.5 rounded-lg border space-y-2 transition-colors ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50/40'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
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
                          <option value="door">門</option>
                          <option value="window">窗戶</option>
                          <option value="cabinet">櫃體</option>
                          <option value="table">桌子</option>
                          <option value="chair">椅子</option>
                          <option value="bed">病床</option>
                        </select>
                        <input
                          type="text"
                          value={el.name}
                          aria-label={`元件名稱 ${el.name}`}
                          onChange={(e) => updateElement(el.id, { name: e.target.value })}
                          className="flex-1 min-w-0 px-2 py-1 text-xs font-medium border border-slate-200 rounded"
                        />
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

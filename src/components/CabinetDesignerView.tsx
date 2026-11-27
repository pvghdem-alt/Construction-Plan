import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  CopyPlus,
  Droplets,
  FolderPlus,
  Minus,
  Pencil,
  Plus,
  Save,
  Shirt,
  Trash2,
  X,
} from 'lucide-react';
import type {
  CabinetBaseKind,
  CabinetDoorMode,
  CabinetSpec,
  CustomCabinetTemplate,
  FloorplanElement,
} from '../types/floorplan';
import {
  buildStarterCabinetPresets,
  formatCabinetSpecSummary,
  getDefaultCabinetSpec,
  resolveCabinetBaseKind,
  resolveCabinetSpecForElement,
  sanitizeCabinetSpec,
  sanitizeCustomCabinetTemplate,
} from '../utils/cabinetDesigner';
import { ELEMENT_COLOR_PRESETS, sanitizeHexColor } from '../utils/floorplanGeometry';
import { CabinetPreview3D } from './CabinetPreview3D';

interface CabinetDesignerViewProps {
  customCabinets: CustomCabinetTemplate[];
  editingElement: FloorplanElement | null;
  initialTemplateId?: string | null;
  readOnly?: boolean;
  onSaveTemplate: (template: CustomCabinetTemplate, isNew: boolean) => Promise<void> | void;
  onDeleteTemplate: (templateId: string) => Promise<void> | void;
  onInsertTemplate: (template: CustomCabinetTemplate) => void;
  onApplyToFloorplanElement?: (elementId: string, draft: CustomCabinetTemplate) => void;
  onClearEditingElement?: () => void;
}

interface CabinetDraftState {
  editingTemplateId: string | null;
  name: string;
  baseKind: CabinetBaseKind;
  widthCm: number;
  depthCm: number;
  heightCm: number;
  elevationCm: number;
  defaultPlacement: 'wall' | 'free';
  color?: string;
  spec: CabinetSpec;
}

function buildInitialDraft(
  editingElement: FloorplanElement | null,
  initialTemplate: CustomCabinetTemplate | null
): CabinetDraftState {
  if (editingElement) {
    const baseKind = resolveCabinetBaseKind(editingElement.kind);
    return {
      editingTemplateId: editingElement.customCabinetId ?? null,
      name: editingElement.name,
      baseKind,
      widthCm: editingElement.widthCm,
      depthCm: editingElement.depthCm,
      heightCm: editingElement.heightCm,
      elevationCm: editingElement.elevationCm,
      defaultPlacement: editingElement.placement === 'free' ? 'free' : 'wall',
      color: sanitizeHexColor(editingElement.color),
      spec: resolveCabinetSpecForElement(editingElement),
    };
  }
  if (initialTemplate) {
    return {
      editingTemplateId: initialTemplate.id,
      name: initialTemplate.name,
      baseKind: initialTemplate.baseKind,
      widthCm: initialTemplate.widthCm,
      depthCm: initialTemplate.depthCm,
      heightCm: initialTemplate.heightCm,
      elevationCm: initialTemplate.elevationCm,
      defaultPlacement: initialTemplate.defaultPlacement,
      color: sanitizeHexColor(initialTemplate.color),
      spec: sanitizeCabinetSpec(
        initialTemplate.cabinetSpec,
        initialTemplate.baseKind,
        initialTemplate.widthCm
      ),
    };
  }
  return {
    editingTemplateId: null,
    name: '系統收納高櫃',
    baseKind: 'cabinet',
    widthCm: 100,
    depthCm: 60,
    heightCm: 210,
    elevationCm: 0,
    defaultPlacement: 'wall',
    color: '#d9b382',
    spec: getDefaultCabinetSpec('cabinet', 100),
  };
}

const BASE_KIND_OPTIONS: ReadonlyArray<{
  value: CabinetBaseKind;
  label: string;
  defaultD: number;
  defaultH: number;
  defaultElev: number;
}> = [
  { value: 'cabinet', label: '系統落地櫃', defaultD: 60, defaultH: 210, defaultElev: 0 },
  { value: 'wall_cabinet', label: '壁掛吊櫃', defaultD: 35, defaultH: 70, defaultElev: 145 },
  { value: 'kitchen_counter', label: '廚具流理台', defaultD: 62, defaultH: 85, defaultElev: 0 },
];

const DOOR_MODE_OPTIONS: ReadonlyArray<{ value: CabinetDoorMode; label: string }> = [
  { value: 'none', label: '無門扇 (開放)' },
  { value: 'single-left', label: '單開 (左開)' },
  { value: 'single-right', label: '單開 (右開)' },
  { value: 'double', label: '雙開門' },
];

export const CabinetDesignerView: React.FC<CabinetDesignerViewProps> = ({
  customCabinets,
  editingElement,
  initialTemplateId,
  readOnly = false,
  onSaveTemplate,
  onDeleteTemplate,
  onInsertTemplate,
  onApplyToFloorplanElement,
  onClearEditingElement,
}) => {
  const starterPresets = useMemo(() => buildStarterCabinetPresets(), []);
  const initialTemplate = useMemo(
    () =>
      initialTemplateId
        ? customCabinets.find((c) => c.id === initialTemplateId) ?? null
        : null,
    [customCabinets, initialTemplateId]
  );

  const [draft, setDraft] = useState<CabinetDraftState>(() =>
    buildInitialDraft(editingElement, initialTemplate)
  );
  const [isSaving, setIsSaving] = useState(false);

  // Sync draft when user clicks "在櫃體設計頁編輯" on a specific floorplan element
  useEffect(() => {
    if (editingElement) {
      setDraft(buildInitialDraft(editingElement, null));
    }
  }, [editingElement]);

  const draftSummary = useMemo(
    () => formatCabinetSpecSummary(sanitizeCabinetSpec(draft.spec, draft.baseKind, draft.widthCm)),
    [draft.spec, draft.baseKind, draft.widthCm]
  );

  const activeSavedTemplate = useMemo(
    () =>
      draft.editingTemplateId
        ? customCabinets.find((t) => t.id === draft.editingTemplateId) ?? null
        : null,
    [customCabinets, draft.editingTemplateId]
  );

  const buildTemplateFromDraft = (forceNewId: boolean): CustomCabinetTemplate => {
    const existingId = !forceNewId && activeSavedTemplate ? activeSavedTemplate.id : null;
    const id =
      existingId ?? `cab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();
    return (
      sanitizeCustomCabinetTemplate(
        {
          id,
          name: draft.name.trim() || '自訂櫃體',
          baseKind: draft.baseKind,
          widthCm: draft.widthCm,
          depthCm: draft.depthCm,
          heightCm: draft.heightCm,
          elevationCm: draft.elevationCm,
          defaultPlacement: draft.defaultPlacement,
          ...(sanitizeHexColor(draft.color) ? { color: sanitizeHexColor(draft.color) } : {}),
          cabinetSpec: sanitizeCabinetSpec(draft.spec, draft.baseKind, draft.widthCm),
          createdAtMs: activeSavedTemplate && !forceNewId ? activeSavedTemplate.createdAtMs : now,
          updatedAtMs: now,
        },
        id
      ) ?? {
        id,
        name: draft.name.trim() || '自訂櫃體',
        baseKind: draft.baseKind,
        widthCm: draft.widthCm,
        depthCm: draft.depthCm,
        heightCm: draft.heightCm,
        elevationCm: draft.elevationCm,
        defaultPlacement: draft.defaultPlacement,
        ...(sanitizeHexColor(draft.color) ? { color: sanitizeHexColor(draft.color) } : {}),
        cabinetSpec: sanitizeCabinetSpec(draft.spec, draft.baseKind, draft.widthCm),
        createdAtMs: now,
        updatedAtMs: now,
      }
    );
  };

  const handleSave = async (forceNew: boolean) => {
    if (readOnly || isSaving) return;
    setIsSaving(true);
    try {
      const isNew = forceNew || !activeSavedTemplate;
      const tpl = buildTemplateFromDraft(forceNew);
      await onSaveTemplate(tpl, isNew);
      setDraft((prev) => ({
        ...prev,
        editingTemplateId: tpl.id,
        name: tpl.name,
      }));
    } finally {
      setIsSaving(false);
    }
  };

  const handleInsertCurrentDraft = () => {
    if (readOnly) return;
    const tpl = buildTemplateFromDraft(false);
    onInsertTemplate(tpl);
  };

  const handleApplyToElement = () => {
    if (readOnly || !editingElement || !onApplyToFloorplanElement) return;
    const tpl = buildTemplateFromDraft(false);
    onApplyToFloorplanElement(editingElement.id, tpl);
  };

  const handleLoadStarter = (preset: CustomCabinetTemplate) => {
    setDraft({
      editingTemplateId: null,
      name: preset.name,
      baseKind: preset.baseKind,
      widthCm: preset.widthCm,
      depthCm: preset.depthCm,
      heightCm: preset.heightCm,
      elevationCm: preset.elevationCm,
      defaultPlacement: preset.defaultPlacement,
      color: sanitizeHexColor(preset.color),
      spec: sanitizeCabinetSpec(preset.cabinetSpec, preset.baseKind, preset.widthCm),
    });
  };

  const handleEditSavedTemplate = (tpl: CustomCabinetTemplate) => {
    onClearEditingElement?.();
    setDraft({
      editingTemplateId: tpl.id,
      name: tpl.name,
      baseKind: tpl.baseKind,
      widthCm: tpl.widthCm,
      depthCm: tpl.depthCm,
      heightCm: tpl.heightCm,
      elevationCm: tpl.elevationCm,
      defaultPlacement: tpl.defaultPlacement,
      color: sanitizeHexColor(tpl.color),
      spec: sanitizeCabinetSpec(tpl.cabinetSpec, tpl.baseKind, tpl.widthCm),
    });
  };

  const updateSpec = (patch: Partial<CabinetSpec>) => {
    setDraft((prev) => ({
      ...prev,
      spec: sanitizeCabinetSpec({ ...prev.spec, ...patch }, prev.baseKind, prev.widthCm),
    }));
  };

  return (
    <div
      data-testid="cabinet-designer-view"
      className="w-full h-full flex flex-col lg:flex-row bg-slate-50 overflow-hidden"
    >
      {/* Left Configurator Form */}
      <section className="w-full lg:w-[400px] xl:w-[430px] shrink-0 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col min-h-0">
        <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2 shrink-0">
          <div>
            <h2 className="text-sm font-bold text-slate-900">櫃體元件專屬設計</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">{draftSummary}</p>
          </div>
          {editingElement && (
            <button
              type="button"
              onClick={onClearEditingElement}
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 whitespace-nowrap shrink-0"
            >
              <X className="w-3 h-3" />
              <span>結束編輯「{editingElement.name}」</span>
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          {/* Starter Presets */}
          <div>
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
              快速範本起手式
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {starterPresets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleLoadStarter(preset)}
                  className="text-left px-2 py-1 rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 transition-colors"
                >
                  <div className="text-xs font-semibold text-slate-800 truncate">{preset.name}</div>
                  <div className="text-[10.5px] text-slate-500 font-mono tabular-nums">
                    {preset.widthCm}×{preset.depthCm}×{preset.heightCm} cm
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Name & Base Kind */}
          <div className="space-y-2 pt-2 border-t border-slate-100">
            <div>
              <label
                htmlFor="cabinet-designer-name"
                className="block text-[11px] font-medium text-slate-600 mb-1"
              >
                櫃體名稱
              </label>
              <input
                id="cabinet-designer-name"
                type="text"
                maxLength={60}
                value={draft.name}
                onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="例如：主臥雙開衣櫃、衛浴浴櫃"
                className="w-full px-2.5 py-1.5 text-xs font-medium border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label
                  htmlFor="cabinet-designer-kind"
                  className="block text-[11px] font-medium text-slate-600 mb-1"
                >
                  基礎類別
                </label>
                <select
                  id="cabinet-designer-kind"
                  value={draft.baseKind}
                  onChange={(e) => {
                    const nextKind = e.target.value as CabinetBaseKind;
                    const kindInfo = BASE_KIND_OPTIONS.find((k) => k.value === nextKind);
                    setDraft((prev) => ({
                      ...prev,
                      baseKind: nextKind,
                      depthCm: kindInfo?.defaultD ?? prev.depthCm,
                      heightCm: kindInfo?.defaultH ?? prev.heightCm,
                      elevationCm: kindInfo?.defaultElev ?? prev.elevationCm,
                      spec:
                        nextKind === 'kitchen_counter'
                          ? { ...prev.spec, hasSink: true }
                          : prev.spec,
                    }));
                  }}
                  className="w-full px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                >
                  {BASE_KIND_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <span className="block text-[11px] font-medium text-slate-600 mb-1">
                  預設擺放方式
                </span>
                <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-md">
                  <button
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, defaultPlacement: 'wall' }))}
                    className={`flex-1 py-1 text-xs rounded transition-colors ${
                      draft.defaultPlacement === 'wall'
                        ? 'bg-white text-slate-900 font-semibold shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    貼牆定位
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, defaultPlacement: 'free' }))}
                    className={`flex-1 py-1 text-xs rounded transition-colors ${
                      draft.defaultPlacement === 'free'
                        ? 'bg-white text-slate-900 font-semibold shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    自由擺放
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Dimensions */}
          <div className="grid grid-cols-4 gap-2 pt-2 border-t border-slate-100">
            <div>
              <label
                htmlFor="cabinet-width"
                className="block text-[11px] text-slate-500 mb-0.5"
              >
                寬 (cm)
              </label>
              <input
                id="cabinet-width"
                type="number"
                min={20}
                max={600}
                value={draft.widthCm}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    widthCm: Math.max(20, Math.min(600, Number(e.target.value) || 20)),
                  }))
                }
                className="w-full px-2 py-1 text-xs font-mono tabular-nums border border-slate-300 rounded"
              />
            </div>
            <div>
              <label
                htmlFor="cabinet-depth"
                className="block text-[11px] text-slate-500 mb-0.5"
              >
                深 (cm)
              </label>
              <input
                id="cabinet-depth"
                type="number"
                min={15}
                max={200}
                value={draft.depthCm}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    depthCm: Math.max(15, Math.min(200, Number(e.target.value) || 15)),
                  }))
                }
                className="w-full px-2 py-1 text-xs font-mono tabular-nums border border-slate-300 rounded"
              />
            </div>
            <div>
              <label
                htmlFor="cabinet-height"
                className="block text-[11px] text-slate-500 mb-0.5"
              >
                高 (cm)
              </label>
              <input
                id="cabinet-height"
                type="number"
                min={20}
                max={350}
                value={draft.heightCm}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    heightCm: Math.max(20, Math.min(350, Number(e.target.value) || 20)),
                  }))
                }
                className="w-full px-2 py-1 text-xs font-mono tabular-nums border border-slate-300 rounded"
              />
            </div>
            <div>
              <label
                htmlFor="cabinet-elevation"
                className="block text-[11px] text-slate-500 mb-0.5"
              >
                離地 (cm)
              </label>
              <input
                id="cabinet-elevation"
                type="number"
                min={0}
                max={300}
                value={draft.elevationCm}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    elevationCm: Math.max(0, Math.min(300, Number(e.target.value) || 0)),
                  }))
                }
                className="w-full px-2 py-1 text-xs font-mono tabular-nums border border-slate-300 rounded"
              />
            </div>
          </div>

          {/* Door Mode (Left / Right / Double / None) */}
          <div className="pt-2 border-t border-slate-100">
            <div className="text-[11px] font-semibold text-slate-600 mb-1.5">
              門扇開向與型式
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {DOOR_MODE_OPTIONS.map((opt) => {
                const active = draft.spec.doorMode === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => updateSpec({ doorMode: opt.value })}
                    className={`px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                      active
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Drawers & Interior Shelves Steppers */}
          <div className="grid grid-cols-2 gap-2.5 pt-1.5 border-t border-slate-100">
            <div className="p-2 rounded-lg border border-slate-200 bg-slate-50/70">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-slate-800">抽屜數量</span>
                <span
                  data-testid="drawer-count-value"
                  className="text-xs font-mono tabular-nums font-bold text-blue-700"
                >
                  {draft.spec.drawerCount} 抽
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="減少抽屜數量"
                  disabled={draft.spec.drawerCount <= 0}
                  onClick={() => updateSpec({ drawerCount: draft.spec.drawerCount - 1 })}
                  className="flex-1 flex items-center justify-center py-1 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="增加抽屜數量"
                  disabled={draft.spec.drawerCount >= 6}
                  onClick={() => updateSpec({ drawerCount: draft.spec.drawerCount + 1 })}
                  className="flex-1 flex items-center justify-center py-1 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="p-2 rounded-lg border border-slate-200 bg-slate-50/70">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-slate-800">櫃內隔層板</span>
                <span
                  data-testid="shelf-count-value"
                  className="text-xs font-mono tabular-nums font-bold text-blue-700"
                >
                  {draft.spec.shelfCount} 層
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="減少隔層板數量"
                  disabled={draft.spec.shelfCount <= 0}
                  onClick={() => updateSpec({ shelfCount: draft.spec.shelfCount - 1 })}
                  className="flex-1 flex items-center justify-center py-1 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="增加隔層板數量"
                  disabled={draft.spec.shelfCount >= 8}
                  onClick={() => updateSpec({ shelfCount: draft.spec.shelfCount + 1 })}
                  className="flex-1 flex items-center justify-center py-1 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Hanging Rod & Integrated Sink Toggles */}
          <div className="grid grid-cols-2 gap-2">
            <label
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
                draft.spec.hasHangingRod
                  ? 'bg-indigo-50 border-indigo-300 text-indigo-900'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <input
                type="checkbox"
                checked={draft.spec.hasHangingRod}
                onChange={(e) => updateSpec({ hasHangingRod: e.target.checked })}
                className="accent-indigo-600 rounded"
              />
              <Shirt className="w-3.5 h-3.5 shrink-0" />
              <span>掛衣桿</span>
            </label>

            <label
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
                draft.spec.hasSink
                  ? 'bg-sky-50 border-sky-300 text-sky-900'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <input
                type="checkbox"
                checked={draft.spec.hasSink}
                onChange={(e) => updateSpec({ hasSink: e.target.checked })}
                className="accent-sky-600 rounded"
              />
              <Droplets className="w-3.5 h-3.5 shrink-0" />
              <span>附設水槽</span>
            </label>
          </div>

          {/* Color Palette */}
          <div className="pt-1.5 border-t border-slate-100 flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-slate-600 shrink-0">櫃體面板色</span>
            <div className="flex items-center gap-1.5 flex-wrap justify-end">
              {ELEMENT_COLOR_PRESETS.map((preset) => {
                const active = sanitizeHexColor(draft.color) === preset.hex;
                return (
                  <button
                    key={preset.hex}
                    type="button"
                    aria-label={`櫃體色彩 ${preset.label}`}
                    onClick={() => setDraft((prev) => ({ ...prev, color: preset.hex }))}
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
                aria-label="自訂櫃體顏色"
                value={sanitizeHexColor(draft.color) ?? '#d9b382'}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, color: sanitizeHexColor(e.target.value) }))
                }
                className="w-5 h-5 p-0 border border-slate-300 rounded cursor-pointer bg-transparent"
              />
            </div>
          </div>
        </div>

        {/* Sticky Footer Action Buttons */}
        {!readOnly && (
          <div className="p-3 border-t border-slate-200 bg-slate-50 space-y-2 shrink-0">
            {editingElement && onApplyToFloorplanElement && (
              <button
                type="button"
                data-testid="apply-cabinet-to-element-btn"
                onClick={handleApplyToElement}
                className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold bg-amber-600 text-white hover:bg-amber-700 transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                <span>套用變更至「{editingElement.name}」</span>
              </button>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="save-cabinet-template-btn"
                disabled={isSaving}
                onClick={() => void handleSave(false)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{activeSavedTemplate ? '更新自訂櫃體' : '儲存至自訂櫃體庫'}</span>
              </button>

              {activeSavedTemplate && (
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => void handleSave(true)}
                  title="另存為新的自訂櫃體範本"
                  className="flex items-center justify-center gap-1 py-2 px-2.5 rounded-lg text-xs font-medium bg-white text-slate-700 border border-slate-300 hover:bg-slate-100 whitespace-nowrap shrink-0"
                >
                  <CopyPlus className="w-3.5 h-3.5" />
                  <span>另存新檔</span>
                </button>
              )}
            </div>

            <button
              type="button"
              data-testid="insert-draft-cabinet-btn"
              onClick={handleInsertCurrentDraft}
              className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>立即加入目前平面圖</span>
            </button>
          </div>
        )}
      </section>

      {/* Right Main Pane: Live Interactive 3D Preview + Saved Custom Cabinet Library */}
      <section className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="flex-1 min-h-[280px] relative border-b border-slate-200">
          <CabinetPreview3D
            name={draft.name}
            baseKind={draft.baseKind}
            widthCm={draft.widthCm}
            depthCm={draft.depthCm}
            heightCm={draft.heightCm}
            color={draft.color}
            spec={draft.spec}
          />
        </div>

        {/* Reusable Saved Custom Cabinet Library */}
        <div
          data-testid="custom-cabinet-library"
          className="h-[220px] shrink-0 bg-white flex flex-col min-h-0"
        >
          <div className="px-4 py-2 border-b border-slate-200 flex items-center justify-between gap-2 bg-slate-50/70 shrink-0">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold text-slate-900">
                已儲存的自訂櫃體庫 ({customCabinets.length})
              </h3>
              <span className="text-[11px] text-slate-500">
                儲存後可於此處或左側「元件配置」重複叫出加入任何平面圖
              </span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {customCabinets.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center border border-dashed border-slate-200 rounded-lg px-4">
                <p className="text-xs font-medium text-slate-600">
                  尚未儲存任何自訂櫃體元件
                </p>
                <p className="text-[11px] text-slate-400 mt-1">
                  在左側設定抽屜數量、左右開門扇、隔層板、掛衣桿或水槽後，點擊「儲存至自訂櫃體庫」即可重複使用。
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
                {customCabinets.map((tpl) => {
                  const isEditingThis = draft.editingTemplateId === tpl.id;
                  const summary = formatCabinetSpecSummary(tpl.cabinetSpec);
                  return (
                    <div
                      key={tpl.id}
                      data-testid={`saved-cabinet-card-${tpl.id}`}
                      className={`rounded-lg border p-2.5 flex flex-col justify-between gap-2 transition-colors ${
                        isEditingThis
                          ? 'border-blue-500 bg-blue-50/30'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-3 h-3 rounded-full border border-slate-300 shrink-0"
                            style={{ backgroundColor: tpl.color ?? '#d9b382' }}
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-slate-900 truncate">
                              {tpl.name}
                            </div>
                            <div className="text-[10.5px] text-slate-500 font-mono tabular-nums">
                              {Math.round(tpl.widthCm)}×{Math.round(tpl.depthCm)}×
                              {Math.round(tpl.heightCm)} cm
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="text-[11px] text-slate-600 truncate">{summary}</div>

                      <div className="flex items-center gap-1.5 pt-1 border-t border-slate-100">
                        {!readOnly && (
                          <button
                            type="button"
                            aria-label={`將 ${tpl.name} 加入目前平面圖`}
                            onClick={() => onInsertTemplate(tpl)}
                            className="flex-1 flex items-center justify-center gap-1 py-1 px-2 rounded text-[11px] font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors whitespace-nowrap"
                          >
                            <Plus className="w-3 h-3" />
                            <span>叫出加入</span>
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label={`載入編輯 ${tpl.name}`}
                          onClick={() => handleEditSavedTemplate(tpl)}
                          className="flex items-center justify-center gap-1 py-1 px-2 rounded text-[11px] font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
                        >
                          <Pencil className="w-3 h-3" />
                          <span>編輯</span>
                        </button>
                        {!readOnly && (
                          <button
                            type="button"
                            aria-label={`刪除自訂櫃體 ${tpl.name}`}
                            onClick={() => void onDeleteTemplate(tpl.id)}
                            className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

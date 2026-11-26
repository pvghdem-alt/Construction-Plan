import React, { useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  PackagePlus,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type {
  FloorplanElement,
  FloorplanProject,
  QuoteAreaUnit,
  QuoteLineItem,
  QuoteSurfaceTarget,
  SolvedFloorplan,
  WallSurfaceSummary,
} from '../types/floorplan';
import {
  buildQuotationCsv,
  buildQuotationPlainText,
  buildQuoteItemFromElement,
  computeQuotationTotals,
  computeQuoteSpaceMetrics,
  createBlankQuoteLineItem,
  formatElementQuoteName,
  formatElementQuoteSpec,
  QUOTE_TARGET_LABELS,
  QUOTE_UNIT_LABELS,
  resolveDefaultUnitForTarget,
  resolveLiveAreaQuantity,
} from '../utils/quotationCalculator';

interface QuotationSheetViewProps {
  project: FloorplanProject;
  solved: SolvedFloorplan;
  wallAreaSummary: WallSurfaceSummary;
  interiorWallFaces: 1 | 2;
  readOnly?: boolean;
  onChangeInteriorWallFaces: (faces: 1 | 2) => void;
  onUpdateQuoteItems: (updater: (prev: QuoteLineItem[]) => QuoteLineItem[]) => void;
  onNotify?: (message: string) => void;
}

const TARGET_ORDER: QuoteSurfaceTarget[] = [
  'ceiling',
  'wall',
  'floor',
  'element',
  'custom',
];

const UNIT_ORDER: QuoteAreaUnit[] = ['m2', 'ping', 'm', 'pcs'];

export const QuotationSheetView: React.FC<QuotationSheetViewProps> = ({
  project,
  solved,
  wallAreaSummary,
  interiorWallFaces,
  readOnly = false,
  onChangeInteriorWallFaces,
  onUpdateQuoteItems,
  onNotify,
}) => {
  const quoteItems = useMemo(() => project.quoteItems ?? [], [project.quoteItems]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedPickerIds, setSelectedPickerIds] = useState<string[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);

  const metrics = useMemo(
    () => computeQuoteSpaceMetrics(solved, wallAreaSummary),
    [solved, wallAreaSummary]
  );

  const totals = useMemo(
    () => computeQuotationTotals(quoteItems, metrics),
    [quoteItems, metrics]
  );

  const linkedElementIds = useMemo(
    () =>
      new Set(
        quoteItems
          .map((item) => item.linkedElementId)
          .filter((id): id is string => Boolean(id))
      ),
    [quoteItems]
  );

  const handleAddBlankRow = (target: QuoteSurfaceTarget = 'ceiling') => {
    if (readOnly) return;
    const blank = createBlankQuoteLineItem(target, metrics);
    onUpdateQuoteItems((prev) => [...prev, blank]);
  };

  const handleUpdateRow = (itemId: string, patch: Partial<QuoteLineItem>) => {
    if (readOnly) return;
    onUpdateQuoteItems((prev) =>
      prev.map((row) => (row.id === itemId ? { ...row, ...patch } : row))
    );
  };

  const handleChangeTarget = (row: QuoteLineItem, nextTarget: QuoteSurfaceTarget) => {
    if (readOnly) return;
    const nextUnit =
      nextTarget === 'ceiling' || nextTarget === 'wall' || nextTarget === 'floor'
        ? row.unit === 'm2' || row.unit === 'ping' || row.unit === 'm'
          ? row.unit
          : resolveDefaultUnitForTarget(nextTarget)
        : row.unit;
    const liveQty = resolveLiveAreaQuantity(nextTarget, nextUnit, metrics);
    const shouldSync = liveQty !== null;
    handleUpdateRow(row.id, {
      target: nextTarget,
      unit: nextUnit,
      manualQuantity: !shouldSync,
      quantity: shouldSync ? liveQty : row.quantity,
    });
  };

  const handleChangeUnit = (row: QuoteLineItem, nextUnit: QuoteAreaUnit) => {
    if (readOnly) return;
    const liveQty =
      !row.manualQuantity
        ? resolveLiveAreaQuantity(row.target, nextUnit, metrics)
        : null;
    handleUpdateRow(row.id, {
      unit: nextUnit,
      ...(liveQty !== null ? { quantity: liveQty } : {}),
    });
  };

  const handleDeleteRow = (itemId: string) => {
    if (readOnly) return;
    onUpdateQuoteItems((prev) => prev.filter((row) => row.id !== itemId));
  };

  const handleAddSingleElement = (el: FloorplanElement) => {
    if (readOnly) return;
    const nextItem = buildQuoteItemFromElement(el);
    onUpdateQuoteItems((prev) => [...prev, nextItem]);
    onNotify?.(`已加入報價項目「${nextItem.itemName}」`);
  };

  const handleAddSelectedElements = () => {
    if (readOnly || selectedPickerIds.length === 0) return;
    const chosen = project.elements.filter((el) => selectedPickerIds.includes(el.id));
    if (chosen.length === 0) return;
    const added = chosen.map((el) => buildQuoteItemFromElement(el));
    onUpdateQuoteItems((prev) => [...prev, ...added]);
    setSelectedPickerIds([]);
    setPickerOpen(false);
    onNotify?.(`已加入 ${added.length} 項空間物件至標單`);
  };

  const togglePickerId = (id: string) => {
    setSelectedPickerIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleCopyPlainText = async () => {
    const text = buildQuotationPlainText(project.projectName, quoteItems, metrics);
    try {
      await navigator.clipboard.writeText(text);
      onNotify?.('已複製估價標單明細至剪貼簿');
    } catch {
      onNotify?.('無法存取剪貼簿，請改用匯出 CSV');
    }
  };

  const handleExportCsv = () => {
    const csv = buildQuotationCsv(project.projectName, quoteItems, metrics);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(project.projectName || '空間估價標單').replace(/[/\\?%*:|"<>]/g, '_')}_空白標單.csv`;
    a.click();
    URL.revokeObjectURL(url);
    onNotify?.('已匯出估價標單 CSV');
  };

  return (
    <div
      data-testid="quotation-sheet-view"
      className="h-full w-full overflow-y-auto bg-slate-50 p-4 lg:p-6"
    >
      <div className="max-w-6xl mx-auto space-y-4">
        {/* Header & Live Area Reference Strip */}
        <section className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                空白裝潢估價標單 · {project.projectName}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                即時帶入空間天花板、牆面、地面面積與圖面門窗家具規格，自動結算 5% 營業稅。
              </p>
            </div>
            <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-md border border-slate-200">
              <button
                type="button"
                onClick={() => onChangeInteriorWallFaces(2)}
                className={`px-2 py-1 text-[11px] rounded transition-colors whitespace-nowrap shrink-0 ${
                  interiorWallFaces === 2
                    ? 'bg-white text-slate-900 font-semibold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                隔間雙面 ×2
              </button>
              <button
                type="button"
                onClick={() => onChangeInteriorWallFaces(1)}
                className={`px-2 py-1 text-[11px] rounded transition-colors whitespace-nowrap shrink-0 ${
                  interiorWallFaces === 1
                    ? 'bg-white text-slate-900 font-semibold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                隔間單面 ×1
              </button>
            </div>
          </div>

          {/* Flat 4-Metric Bar */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between gap-2 pr-2 lg:border-r lg:border-slate-100">
              <div className="min-w-0">
                <div className="text-[11px] text-slate-500">天花板面積</div>
                <div
                  data-testid="quote-metric-ceiling"
                  className="text-sm font-semibold text-slate-900 font-mono tabular-nums whitespace-nowrap"
                >
                  {metrics.ceilingAreaM2.toFixed(2)} m²
                </div>
                <div className="text-[11px] text-slate-500 font-mono tabular-nums whitespace-nowrap">
                  {metrics.ceilingAreaPing.toFixed(2)} 坪
                </div>
              </div>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => handleAddBlankRow('ceiling')}
                  title="新增一筆以天花板面積計價的工項"
                  className="px-2 py-1 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded whitespace-nowrap shrink-0"
                >
                  + 天花工項
                </button>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 pr-2 lg:border-r lg:border-slate-100">
              <div className="min-w-0">
                <div className="text-[11px] text-slate-500">牆面淨面積</div>
                <div
                  data-testid="quote-metric-wall"
                  className="text-sm font-semibold text-slate-900 font-mono tabular-nums whitespace-nowrap"
                >
                  {metrics.wallAreaM2.toFixed(2)} m²
                </div>
                <div className="text-[11px] text-slate-500 font-mono tabular-nums whitespace-nowrap">
                  {metrics.wallAreaPing.toFixed(2)} 坪
                </div>
              </div>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => handleAddBlankRow('wall')}
                  title="新增一筆以牆面淨面積計價的工項"
                  className="px-2 py-1 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded whitespace-nowrap shrink-0"
                >
                  + 牆面工項
                </button>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 pr-2 lg:border-r lg:border-slate-100">
              <div className="min-w-0">
                <div className="text-[11px] text-slate-500">地面面積</div>
                <div
                  data-testid="quote-metric-floor"
                  className="text-sm font-semibold text-slate-900 font-mono tabular-nums whitespace-nowrap"
                >
                  {metrics.floorAreaM2.toFixed(2)} m²
                </div>
                <div className="text-[11px] text-slate-500 font-mono tabular-nums whitespace-nowrap">
                  {metrics.floorAreaPing.toFixed(2)} 坪
                </div>
              </div>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => handleAddBlankRow('floor')}
                  title="新增一筆以地面面積計價的工項"
                  className="px-2 py-1 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded whitespace-nowrap shrink-0"
                >
                  + 地面工項
                </button>
              )}
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] text-slate-500">空間總周長</div>
                <div className="text-sm font-semibold text-slate-900 font-mono tabular-nums whitespace-nowrap">
                  {metrics.perimeterM.toFixed(2)} m
                </div>
                <div className="text-[11px] text-slate-500 tabular-nums whitespace-nowrap">
                  天高 {Math.round(project.ceilingHeightCm)} cm
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {!readOnly && (
              <>
                <button
                  type="button"
                  onClick={() => handleAddBlankRow('ceiling')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>新增空白工項</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPickerOpen((v) => !v)}
                  aria-expanded={pickerOpen}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 ${
                    pickerOpen
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-blue-700 border-blue-200 hover:bg-blue-50'
                  }`}
                >
                  <PackagePlus className="w-3.5 h-3.5" />
                  <span>選取空間物件 ({project.elements.length})</span>
                </button>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopyPlainText}
              disabled={quoteItems.length === 0}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>複製標單</span>
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={quoteItems.length === 0}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>匯出 CSV</span>
            </button>
            {!readOnly && quoteItems.length > 0 && (
              confirmClear ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      onUpdateQuoteItems(() => []);
                      setConfirmClear(false);
                    }}
                    className="px-2.5 py-1.5 rounded-md text-xs font-semibold bg-red-600 text-white hover:bg-red-700 whitespace-nowrap shrink-0"
                  >
                    確認清空
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="px-2 py-1.5 rounded-md text-xs font-medium bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 whitespace-nowrap shrink-0"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-white text-red-600 border border-slate-200 hover:bg-red-50 whitespace-nowrap shrink-0"
                >
                  清空標單
                </button>
              )
            )}
          </div>
        </div>

        {/* Space Element Selector Drawer */}
        {!readOnly && pickerOpen && (
          <section
            data-testid="quote-element-picker"
            className="bg-white border border-blue-200 rounded-lg p-3.5 space-y-2.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-900">
                從目前空間圖面選取物件加入報價單
              </div>
              <div className="flex items-center gap-2">
                {project.elements.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedPickerIds((prev) =>
                        prev.length === project.elements.length
                          ? []
                          : project.elements.map((el) => el.id)
                      )
                    }
                    className="text-[11px] font-medium text-blue-700 hover:underline whitespace-nowrap shrink-0"
                  >
                    {selectedPickerIds.length === project.elements.length ? '取消全選' : '全選物件'}
                  </button>
                )}
                <button
                  type="button"
                  disabled={selectedPickerIds.length === 0}
                  onClick={handleAddSelectedElements}
                  className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>加入已選物件 ({selectedPickerIds.length})</span>
                </button>
              </div>
            </div>

            {project.elements.length === 0 ? (
              <p className="text-xs text-slate-500 py-3 text-center">
                目前平面圖中尚未配置任何門窗、櫃體或設備元件。
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-60 overflow-y-auto pr-1">
                {project.elements.map((el) => {
                  const checked = selectedPickerIds.includes(el.id);
                  const alreadyInQuote = linkedElementIds.has(el.id);
                  const displayTitle = formatElementQuoteName(el);
                  const spec = formatElementQuoteSpec(el);
                  return (
                    <div
                      key={el.id}
                      className={`flex items-center justify-between gap-2 p-2 rounded border transition-colors ${
                        checked
                          ? 'border-blue-400 bg-blue-50/40'
                          : 'border-slate-200 bg-slate-50/50 hover:bg-white'
                      }`}
                    >
                      <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePickerId(el.id)}
                          className="accent-blue-600 rounded shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-900 truncate">
                            {displayTitle}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">
                            {spec}
                            {alreadyInQuote ? ' · 已於標單中' : ''}
                          </div>
                        </div>
                      </label>
                      <button
                        type="button"
                        onClick={() => handleAddSingleElement(el)}
                        className="px-2 py-1 text-[11px] font-medium text-blue-700 bg-white border border-blue-200 hover:bg-blue-50 rounded whitespace-nowrap shrink-0"
                      >
                        + 加入
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Quotation Table */}
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          {quoteItems.length === 0 ? (
            <div className="py-14 px-6 text-center space-y-3">
              <div className="text-sm font-semibold text-slate-800">
                目前為空白標單
              </div>
              <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                請點擊上方「新增空白工項」填寫天花板、牆面、地面施工項目與單價，或點「選取空間物件」將門窗、櫃體直接帶入報價單。
              </p>
              {!readOnly && (
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleAddBlankRow('ceiling')}
                    className="px-3 py-1.5 rounded-md text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800"
                  >
                    + 新增空白工項
                  </button>
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="px-3 py-1.5 rounded-md text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100"
                  >
                    + 選取空間物件
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                    <th className="py-2.5 px-3 w-10 text-center">#</th>
                    <th className="py-2.5 px-2.5 w-28">施工對象</th>
                    <th className="py-2.5 px-2.5 min-w-[200px]">施工項目 / 規格</th>
                    <th className="py-2.5 px-2.5 w-32 text-right">數量</th>
                    <th className="py-2.5 px-2.5 w-24">單位</th>
                    <th className="py-2.5 px-2.5 w-32 text-right">單價 (NT$)</th>
                    <th className="py-2.5 px-3 w-32 text-right">複價 (NT$)</th>
                    {!readOnly && <th className="py-2.5 px-2 w-10"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {totals.lines.map((line, idx) => {
                    const row = line.item;
                    const supportsLiveArea =
                      row.target === 'ceiling' ||
                      row.target === 'wall' ||
                      row.target === 'floor';
                    return (
                      <tr
                        key={row.id}
                        data-testid={`quote-row-${idx}`}
                        className="hover:bg-slate-50/70 align-top"
                      >
                        <td className="py-2.5 px-3 text-center text-slate-400 font-mono tabular-nums">
                          {idx + 1}
                        </td>
                        <td className="py-2 px-2.5">
                          <select
                            value={row.target}
                            disabled={readOnly}
                            aria-label={`第 ${idx + 1} 項施工對象`}
                            onChange={(e) =>
                              handleChangeTarget(row, e.target.value as QuoteSurfaceTarget)
                            }
                            className="w-full px-2 py-1.5 text-xs bg-white border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50"
                          >
                            {TARGET_ORDER.map((t) => (
                              <option key={t} value={t}>
                                {QUOTE_TARGET_LABELS[t]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 px-2.5 space-y-1">
                          <input
                            type="text"
                            value={row.itemName}
                            disabled={readOnly}
                            placeholder={
                              row.target === 'ceiling'
                                ? '例如：矽酸鈣板平釘天花板 / 乳膠漆'
                                : row.target === 'wall'
                                  ? '例如：批土油漆 / 壁磚工程'
                                  : row.target === 'floor'
                                    ? '例如：超耐磨木地板 / 止滑地磚'
                                    : '輸入施工項目或物件名稱'
                            }
                            aria-label={`第 ${idx + 1} 項施工項目`}
                            onChange={(e) =>
                              handleUpdateRow(row.id, { itemName: e.target.value })
                            }
                            className="w-full px-2 py-1.5 text-xs font-medium text-slate-900 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50"
                          />
                          <input
                            type="text"
                            value={row.specNote ?? ''}
                            disabled={readOnly}
                            placeholder="規格 / 備註（選填）"
                            aria-label={`第 ${idx + 1} 項規格備註`}
                            onChange={(e) =>
                              handleUpdateRow(row.id, { specNote: e.target.value })
                            }
                            className="w-full px-2 py-1 text-[11px] text-slate-600 border border-slate-100 rounded bg-slate-50/70 focus:bg-white focus:border-slate-200 focus:outline-none disabled:bg-slate-50"
                          />
                        </td>
                        <td className="py-2 px-2.5">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            disabled={readOnly}
                            value={line.resolvedQuantity}
                            aria-label={`第 ${idx + 1} 項數量`}
                            onChange={(e) => {
                              const parsed = Math.max(0, Number(e.target.value) || 0);
                              handleUpdateRow(row.id, {
                                quantity: parsed,
                                manualQuantity: true,
                              });
                            }}
                            className="w-full px-2 py-1.5 text-xs text-right font-mono tabular-nums border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50"
                          />
                          <div className="mt-1 flex items-center justify-end gap-1 text-[10.5px] text-slate-500">
                            {line.isLiveSynced ? (
                              <span>同步空間面積</span>
                            ) : supportsLiveArea &&
                              row.unit !== 'pcs' &&
                              !readOnly ? (
                              <button
                                type="button"
                                onClick={() => {
                                  const live = resolveLiveAreaQuantity(
                                    row.target,
                                    row.unit,
                                    metrics
                                  );
                                  handleUpdateRow(row.id, {
                                    manualQuantity: false,
                                    ...(live !== null ? { quantity: live } : {}),
                                  });
                                }}
                                className="inline-flex items-center gap-0.5 text-blue-600 hover:underline"
                              >
                                <RefreshCw className="w-2.5 h-2.5" />
                                <span>改回自動面積</span>
                              </button>
                            ) : null}
                          </div>
                        </td>
                        <td className="py-2 px-2.5">
                          <select
                            value={row.unit}
                            disabled={readOnly}
                            aria-label={`第 ${idx + 1} 項單位`}
                            onChange={(e) =>
                              handleChangeUnit(row, e.target.value as QuoteAreaUnit)
                            }
                            className="w-full px-2 py-1.5 text-xs bg-white border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50"
                          >
                            {UNIT_ORDER.map((u) => (
                              <option key={u} value={u}>
                                {QUOTE_UNIT_LABELS[u]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 px-2.5">
                          <input
                            type="number"
                            min={0}
                            step={10}
                            disabled={readOnly}
                            value={row.unitPrice === 0 ? '' : row.unitPrice}
                            placeholder="0"
                            aria-label={`第 ${idx + 1} 項單價`}
                            onChange={(e) =>
                              handleUpdateRow(row.id, {
                                unitPrice: Math.max(0, Number(e.target.value) || 0),
                              })
                            }
                            className="w-full px-2 py-1.5 text-xs text-right font-mono tabular-nums border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50"
                          />
                        </td>
                        <td
                          data-testid={`quote-line-total-${idx}`}
                          className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap"
                        >
                          NT$ {line.lineTotal.toLocaleString()}
                        </td>
                        {!readOnly && (
                          <td className="py-2.5 px-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleDeleteRow(row.id)}
                              aria-label={`刪除第 ${idx + 1} 項`}
                              className="p-1 text-slate-400 hover:text-red-600 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Totals & 5% Business Tax Footer */}
          <div className="bg-slate-50 border-t border-slate-200 px-4 py-4 flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 tabular-nums">
              {TARGET_ORDER.map((t) => (
                <span key={t}>
                  {QUOTE_TARGET_LABELS[t]}：
                  <span className="font-mono font-medium text-slate-800">
                    NT$ {(totals.byTarget[t] ?? 0).toLocaleString()}
                  </span>
                </span>
              ))}
            </div>

            <div className="w-full md:w-72 space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-slate-600">
                <span>未稅小計</span>
                <span
                  data-testid="quote-subtotal"
                  className="font-mono tabular-nums font-medium text-slate-900"
                >
                  NT$ {totals.subtotalBeforeTax.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between text-slate-600">
                <span>營業稅 (5%)</span>
                <span
                  data-testid="quote-tax"
                  className="font-mono tabular-nums font-medium text-slate-900"
                >
                  NT$ {totals.taxAmount.toLocaleString()}
                </span>
              </div>
              <div className="pt-1.5 border-t border-slate-200 flex items-center justify-between text-sm font-bold text-slate-900">
                <span>含稅總計</span>
                <span
                  data-testid="quote-grand-total"
                  className="font-mono tabular-nums text-blue-700"
                >
                  NT$ {totals.grandTotal.toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

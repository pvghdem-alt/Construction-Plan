import React, { useEffect, useState } from 'react';
import { X, Copy, Check, Layers } from 'lucide-react';
import type { UnitType, WallSurfaceSummary } from '../types/floorplan';
import { formatDimension } from '../utils/floorplanGeometry';

interface WallAreaModalProps {
  isOpen: boolean;
  onClose: () => void;
  summary: WallSurfaceSummary;
  unit: UnitType;
  interiorWallFaces: 1 | 2;
  onChangeInteriorWallFaces: (faces: 1 | 2) => void;
  onSelectWall: (wallId: string) => void;
}

export const WallAreaModal: React.FC<WallAreaModalProps> = ({
  isOpen,
  onClose,
  summary,
  unit,
  interiorWallFaces,
  onChangeInteriorWallFaces,
  onSelectWall,
}) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const hasInteriorPartitions = summary.items.some((i) => i.isInterior);

  const handleCopySummary = async () => {
    const lines = [
      `【空間內牆面面積明細】`,
      `天花板高度：${summary.ceilingHeightCm} cm`,
      `總內牆淨面積：${summary.totalNetAreaM2.toFixed(2)} m² (${summary.totalNetAreaPing.toFixed(2)} 坪)`,
      `毛牆總面積：${summary.totalGrossAreaM2.toFixed(2)} m²｜門窗扣除：-${summary.totalDeductionAreaM2.toFixed(2)} m²`,
      `地板／天花板面積參考：${summary.floorAreaM2.toFixed(2)} m² (${summary.floorAreaPing.toFixed(2)} 坪)`,
      '',
      ...summary.items.map((item) => {
        const faceTag = item.isInterior ? ` [隔間${item.faces === 2 ? '雙面×2' : '單面×1'}]` : ' [外牆內側]';
        const deductText =
          item.openings.length > 0
            ? `（扣除：${item.openings
                .map((o) => `${o.name} -${o.deductAreaM2.toFixed(2)} m²`)
                .join('、')}）`
            : '';
        return `- ${item.label}${faceTag}：長 ${Math.round(item.lengthCm * 10) / 10} cm × 高 ${item.heightCm} cm → 淨面積 ${item.netAreaM2.toFixed(2)} m² ${deductText}`;
      }),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wall-area-modal-title"
        className="w-full max-w-3xl max-h-[88vh] bg-white rounded-xl border border-slate-200 shadow-xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-600" />
            <h2 id="wall-area-modal-title" className="text-sm font-bold text-slate-900">
              空間內牆面面積明細
            </h2>
            <span className="text-xs text-slate-500">
              · 天花高度 {formatDimension(summary.ceilingHeightCm, unit)}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉牆面面積視窗"
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {/* Summary KPI Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-3">
              <div className="text-[11px] font-medium text-blue-800">總內牆淨面積</div>
              <div className="text-lg font-bold text-blue-950 font-mono tabular-nums mt-0.5">
                {summary.totalNetAreaM2.toFixed(2)} m²
              </div>
              <div className="text-[11px] text-blue-700 font-mono tabular-nums">
                約 {summary.totalNetAreaPing.toFixed(2)} 坪
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] font-medium text-slate-600">毛牆總面積</div>
              <div className="text-lg font-bold text-slate-900 font-mono tabular-nums mt-0.5">
                {summary.totalGrossAreaM2.toFixed(2)} m²
              </div>
              <div className="text-[11px] text-slate-500">未扣除門窗開口</div>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3">
              <div className="text-[11px] font-medium text-amber-800">門窗扣除面積</div>
              <div className="text-lg font-bold text-amber-950 font-mono tabular-nums mt-0.5">
                -{summary.totalDeductionAreaM2.toFixed(2)} m²
              </div>
              <div className="text-[11px] text-amber-700">依門窗寬×高及離地計算</div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-[11px] font-medium text-slate-600">地板／天花面積</div>
              <div className="text-lg font-bold text-slate-900 font-mono tabular-nums mt-0.5">
                {summary.floorAreaM2.toFixed(2)} m²
              </div>
              <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                約 {summary.floorAreaPing.toFixed(2)} 坪
              </div>
            </div>
          </div>

          {hasInteriorPartitions && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-indigo-50/70 border border-indigo-200 text-xs">
              <div className="text-indigo-950">
                偵測到室內隔間牆（淨面積小計：
                <span className="font-mono font-semibold tabular-nums ml-1">
                  {summary.interiorPartitionNetAreaM2.toFixed(2)} m²
                </span>
                ），外牆內側淨面積：
                <span className="font-mono font-semibold tabular-nums ml-1">
                  {summary.outerNetAreaM2.toFixed(2)} m²
                </span>
              </div>
              <div className="flex items-center gap-1 bg-white p-0.5 rounded border border-indigo-200">
                <button
                  type="button"
                  onClick={() => onChangeInteriorWallFaces(2)}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                    interiorWallFaces === 2
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  隔間計雙面 (×2)
                </button>
                <button
                  type="button"
                  onClick={() => onChangeInteriorWallFaces(1)}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                    interiorWallFaces === 1
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  隔間計單面 (×1)
                </button>
              </div>
            </div>
          )}

          {/* Breakdown Table */}
          {summary.items.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-6 border border-dashed border-slate-200 rounded-lg">
              目前沒有實體牆段可計算內牆面面積（請確認牆段的「實體牆」已勾選）。
            </p>
          ) : (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2.5 px-3 font-semibold">牆段名稱</th>
                    <th className="py-2.5 px-3 font-semibold text-right">長 × 高</th>
                    <th className="py-2.5 px-3 font-semibold text-right">毛面積</th>
                    <th className="py-2.5 px-3 font-semibold">門窗扣除</th>
                    <th className="py-2.5 px-3 font-semibold text-right">淨面積</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.items.map((item) => (
                    <tr
                      key={item.wallId}
                      onClick={() => {
                        onSelectWall(item.wallId);
                        onClose();
                      }}
                      className="hover:bg-blue-50/50 cursor-pointer transition-colors"
                    >
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-slate-900">{item.label}</div>
                        <div className="text-[11px] text-slate-500">
                          {item.isInterior
                            ? `室內隔間（${item.faces === 2 ? '雙面計入 ×2' : '單面計入 ×1'}）`
                            : '外圍牆面（內側單面）'}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                        {formatDimension(item.lengthCm, unit, false)} ×{' '}
                        {formatDimension(item.heightCm, unit)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                        {item.grossAreaM2.toFixed(2)} m²
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">
                        {item.openings.length === 0 ? (
                          <span className="text-slate-400">無</span>
                        ) : (
                          <div className="space-y-0.5">
                            {item.openings.map((op) => (
                              <div key={op.elementId} className="text-[11px] tabular-nums">
                                <span className="font-medium text-slate-700">{op.name}</span>
                                <span className="text-amber-700 font-mono ml-1.5">
                                  -{op.deductAreaM2.toFixed(2)} m²
                                </span>
                                <span className="text-slate-400 ml-1">
                                  ({Math.round(op.widthCm)}×{Math.round(op.effectiveHeightCm)} cm)
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold tabular-nums text-blue-700 whitespace-nowrap">
                        {item.netAreaM2.toFixed(2)} m²
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 border-t border-slate-200 font-semibold text-slate-900">
                  <tr>
                    <td className="py-2.5 px-3" colSpan={2}>
                      合計（共 {summary.items.length} 段實體牆）
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {summary.totalGrossAreaM2.toFixed(2)} m²
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-amber-800">
                      -{summary.totalDeductionAreaM2.toFixed(2)} m²
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-blue-700">
                      {summary.totalNetAreaM2.toFixed(2)} m²
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
          <span className="text-[11px] text-slate-500">
            提示：點擊任一列可於平面圖高亮度標示該牆段
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopySummary}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>已複製明細</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>複製面積明細</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 transition-colors"
            >
              完成
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import { X, Trash2, Check } from 'lucide-react';
import type { DoorSwing, ElementKind, FloorplanElement, UnitType } from '../types/floorplan';
import { buildDoorSwing, formatDimension, parseDoorSwing } from '../utils/floorplanGeometry';

interface ElementDimensionsModalProps {
  element: FloorplanElement | null;
  unit: UnitType;
  onClose: () => void;
  onSave: (elementId: string, patch: Partial<FloorplanElement>) => void;
  onDelete: (elementId: string) => void;
}

const KIND_LABELS: Record<ElementKind, string> = {
  door: '門扇',
  window: '窗戶',
  cabinet: '櫃體',
  table: '桌子',
  chair: '椅子',
  bed: '病床',
};

export const ElementDimensionsModal: React.FC<ElementDimensionsModalProps> = ({
  element,
  unit,
  onClose,
  onSave,
  onDelete,
}) => {
  const [name, setName] = useState('');
  const [widthCm, setWidthCm] = useState('100');
  const [depthCm, setDepthCm] = useState('50');
  const [heightCm, setHeightCm] = useState('100');
  const [elevationCm, setElevationCm] = useState('0');
  const [offsetCm, setOffsetCm] = useState('0');
  const [xCm, setXCm] = useState('0');
  const [yCm, setYCm] = useState('0');
  const [rotationDeg, setRotationDeg] = useState('0');
  const [swingDirection, setSwingDirection] = useState<DoorSwing>('inward-right');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!element) return;
    setName(element.name);
    setWidthCm(String(element.widthCm));
    setDepthCm(String(element.depthCm));
    setHeightCm(String(element.heightCm));
    setElevationCm(String(element.elevationCm ?? 0));
    setOffsetCm(String(element.offsetCm ?? 0));
    setXCm(String(Math.round(element.xCm ?? 0)));
    setYCm(String(Math.round(element.yCm ?? 0)));
    setRotationDeg(String(Math.round(element.rotationDeg ?? 0)));
    setSwingDirection(element.swingDirection || 'inward-right');
    setErrorMsg(null);
  }, [element]);

  useEffect(() => {
    if (!element) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [element, onClose]);

  if (!element) return null;

  const isOpening = element.kind === 'door' || element.kind === 'window';
  const isFree = !isOpening && element.placement === 'free';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const w = Number(widthCm);
    const d = Number(depthCm);
    const h = Number(heightCm);
    const elev = Number(elevationCm);

    if (!Number.isFinite(w) || w < 5) {
      setErrorMsg('寬度須為大於或等於 5 cm 的有效數值。');
      return;
    }
    if (!Number.isFinite(d) || d < 2) {
      setErrorMsg('深度／厚度須為大於或等於 2 cm 的有效數值。');
      return;
    }
    if (!Number.isFinite(h) || h < 5) {
      setErrorMsg('高度須為大於或等於 5 cm 的有效數值。');
      return;
    }
    if (!Number.isFinite(elev) || elev < 0) {
      setErrorMsg('離地高度不可為負數。');
      return;
    }

    const trimmedName = name.trim() || element.name;
    const patch: Partial<FloorplanElement> = {
      name: trimmedName,
      widthCm: Math.round(w * 10) / 10,
      depthCm: Math.round(d * 10) / 10,
      heightCm: Math.round(h * 10) / 10,
      elevationCm: Math.round(elev * 10) / 10,
    };

    if (isFree) {
      const nx = Number(xCm);
      const ny = Number(yCm);
      const nrot = Number(rotationDeg);
      if (Number.isFinite(nx)) patch.xCm = nx;
      if (Number.isFinite(ny)) patch.yCm = ny;
      if (Number.isFinite(nrot)) patch.rotationDeg = ((nrot % 360) + 360) % 360;
    } else {
      const noff = Number(offsetCm);
      if (!Number.isFinite(noff) || noff < 0) {
        setErrorMsg('沿牆起點偏移距離不可為負數。');
        return;
      }
      patch.offsetCm = Math.round(noff * 10) / 10;
      if (element.kind === 'door') {
        patch.swingDirection = swingDirection;
      } else if (!isOpening) {
        const nrot = Number(rotationDeg);
        if (Number.isFinite(nrot)) patch.rotationDeg = ((nrot % 360) + 360) % 360;
      }
    }

    onSave(element.id, patch);
    onClose();
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
        aria-labelledby="element-dimensions-title"
        className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <h2
              id="element-dimensions-title"
              className="text-sm font-bold text-slate-900 truncate"
            >
              調整物品尺寸
            </h2>
            <span className="text-xs font-medium text-slate-500">
              · {KIND_LABELS[element.kind]}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉調整視窗"
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label
              htmlFor="modal-el-name"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              物品名稱
            </label>
            <input
              id="modal-el-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="modal-el-width"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                寬度 (cm)
              </label>
              <input
                id="modal-el-width"
                type="number"
                min={5}
                step="0.5"
                value={widthCm}
                onChange={(e) => setWidthCm(e.target.value)}
                autoFocus
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {unit !== 'cm' && Number.isFinite(Number(widthCm)) && (
                <p className="text-[11px] text-slate-400 mt-0.5 font-mono">
                  ≈ {formatDimension(Number(widthCm), unit)}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="modal-el-depth"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                {isOpening ? '牆厚／門框深 (cm)' : '深度／長度 (cm)'}
              </label>
              <input
                id="modal-el-depth"
                type="number"
                min={2}
                step="0.5"
                value={depthCm}
                onChange={(e) => setDepthCm(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {unit !== 'cm' && Number.isFinite(Number(depthCm)) && (
                <p className="text-[11px] text-slate-400 mt-0.5 font-mono">
                  ≈ {formatDimension(Number(depthCm), unit)}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="modal-el-height"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                3D 高度 (cm)
              </label>
              <input
                id="modal-el-height"
                type="number"
                min={5}
                step="1"
                value={heightCm}
                onChange={(e) => setHeightCm(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label
                htmlFor="modal-el-elevation"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                {element.kind === 'window' ? '窗台離地高度 (cm)' : '離地高度 (cm)'}
              </label>
              <input
                id="modal-el-elevation"
                type="number"
                min={0}
                step="1"
                value={elevationCm}
                onChange={(e) => setElevationCm(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {isFree ? (
            <div className="grid grid-cols-3 gap-3 pt-1 border-t border-slate-100">
              <div>
                <label
                  htmlFor="modal-el-x"
                  className="block text-xs font-medium text-slate-600 mb-1"
                >
                  X 座標 (cm)
                </label>
                <input
                  id="modal-el-x"
                  type="number"
                  step="1"
                  value={xCm}
                  onChange={(e) => setXCm(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label
                  htmlFor="modal-el-y"
                  className="block text-xs font-medium text-slate-600 mb-1"
                >
                  Y 座標 (cm)
                </label>
                <input
                  id="modal-el-y"
                  type="number"
                  step="1"
                  value={yCm}
                  onChange={(e) => setYCm(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label
                  htmlFor="modal-el-rot"
                  className="block text-xs font-medium text-slate-600 mb-1"
                >
                  旋轉角度 (°)
                </label>
                <input
                  id="modal-el-rot"
                  type="number"
                  step="15"
                  value={rotationDeg}
                  onChange={(e) => setRotationDeg(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 pt-1 border-t border-slate-100">
              <div>
                <label
                  htmlFor="modal-el-offset"
                  className="block text-xs font-medium text-slate-600 mb-1"
                >
                  沿牆起點偏移 (cm)
                </label>
                <input
                  id="modal-el-offset"
                  type="number"
                  min={0}
                  step="1"
                  value={offsetCm}
                  onChange={(e) => setOffsetCm(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {element.kind === 'door' &&
                (() => {
                  const parsed = parseDoorSwing(swingDirection);
                  return (
                    <div className="col-span-2 space-y-2">
                      <span className="block text-xs font-medium text-slate-600">
                        門型與開門方向
                      </span>
                      <div className="grid grid-cols-3 gap-1.5">
                        <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-lg">
                          <button
                            type="button"
                            onClick={() =>
                              setSwingDirection(buildDoorSwing('swing', parsed.side, parsed.dir))
                            }
                            className={`flex-1 py-1 text-xs rounded-md transition-colors ${
                              parsed.mode === 'swing'
                                ? 'bg-white text-slate-900 font-semibold shadow-xs'
                                : 'text-slate-600'
                            }`}
                          >
                            推開門
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setSwingDirection(buildDoorSwing('sliding', parsed.side, parsed.dir))
                            }
                            className={`flex-1 py-1 text-xs rounded-md transition-colors ${
                              parsed.mode === 'sliding'
                                ? 'bg-indigo-600 text-white font-semibold shadow-xs'
                                : 'text-slate-600'
                            }`}
                          >
                            橫拉門
                          </button>
                        </div>
                        <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-lg">
                          <button
                            type="button"
                            onClick={() =>
                              setSwingDirection(buildDoorSwing(parsed.mode, 'inward', parsed.dir))
                            }
                            className={`flex-1 py-1 text-xs rounded-md transition-colors ${
                              parsed.side === 'inward'
                                ? 'bg-white text-slate-900 font-semibold shadow-xs'
                                : 'text-slate-600'
                            }`}
                          >
                            {parsed.mode === 'sliding' ? '內橫拉' : '內開'}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setSwingDirection(buildDoorSwing(parsed.mode, 'outward', parsed.dir))
                            }
                            className={`flex-1 py-1 text-xs rounded-md transition-colors ${
                              parsed.side === 'outward'
                                ? 'bg-white text-slate-900 font-semibold shadow-xs'
                                : 'text-slate-600'
                            }`}
                          >
                            {parsed.mode === 'sliding' ? '外橫拉' : '外開'}
                          </button>
                        </div>
                        <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-lg">
                          <button
                            type="button"
                            onClick={() =>
                              setSwingDirection(buildDoorSwing(parsed.mode, parsed.side, 'left'))
                            }
                            className={`flex-1 py-1 text-xs rounded-md transition-colors ${
                              parsed.dir === 'left'
                                ? 'bg-white text-slate-900 font-semibold shadow-xs'
                                : 'text-slate-600'
                            }`}
                          >
                            {parsed.mode === 'sliding' ? '往左拉' : '左開'}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setSwingDirection(buildDoorSwing(parsed.mode, parsed.side, 'right'))
                            }
                            className={`flex-1 py-1 text-xs rounded-md transition-colors ${
                              parsed.dir === 'right'
                                ? 'bg-white text-slate-900 font-semibold shadow-xs'
                                : 'text-slate-600'
                            }`}
                          >
                            {parsed.mode === 'sliding' ? '往右拉' : '右開'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              {!isOpening && (
                <div>
                  <label
                    htmlFor="modal-el-rot-wall"
                    className="block text-xs font-medium text-slate-600 mb-1"
                  >
                    旋轉角度 (°)
                  </label>
                  <input
                    id="modal-el-rot-wall"
                    type="number"
                    step="15"
                    value={rotationDeg}
                    onChange={(e) => setRotationDeg(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}
            </div>
          )}

          {errorMsg && (
            <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {errorMsg}
            </p>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={() => {
                onDelete(element.id);
                onClose();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>刪除此物品</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                <span>套用變更</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

import React from 'react';
import { Lock, DoorOpen, Box, Scissors, Ruler } from 'lucide-react';
import type { FloorplanProject, SolvedFloorplan } from '../types/floorplan';
import { formatDimension, getDoorSwingLabel } from '../utils/floorplanGeometry';

interface ReadOnlySummarySidebarProps {
  project: FloorplanProject;
  solved: SolvedFloorplan;
  selectedEdgeId: string | null;
  selectedElementId: string | null;
  selectedSectionId: string | null;
  onSelectEdge: (id: string | null) => void;
  onSelectElement: (id: string | null) => void;
  onViewSection: (sectionId: string) => void;
}

export const ReadOnlySummarySidebar: React.FC<ReadOnlySummarySidebarProps> = ({
  project,
  solved,
  selectedEdgeId,
  selectedElementId,
  selectedSectionId,
  onSelectEdge,
  onSelectElement,
  onViewSection,
}) => {
  return (
    <aside
      aria-label="唯讀空間資訊面板"
      className="w-full lg:w-[340px] xl:w-[360px] shrink-0 bg-white border-r border-slate-200 flex flex-col h-full overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-slate-200 bg-amber-50/70">
        <div className="flex items-center gap-2 text-amber-900">
          <Lock className="w-4 h-4 text-amber-700 shrink-0" />
          <span className="text-xs font-bold">唯讀分享檢視模式</span>
        </div>
        <p className="text-[11px] text-amber-800 mt-1 leading-relaxed">
          此連結為第三方唯讀瀏覽版本，可點選牆壁、門窗與家具查看尺寸或切換 2D / 3D / 立面圖，無法編輯圖稿。
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs">
        <section className="space-y-2">
          <h2 className="font-bold text-slate-900 text-sm">{project.projectName}</h2>
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
              <div className="text-[11px] text-slate-500">地板面積</div>
              <div className="font-mono font-bold text-slate-900 mt-0.5">
                {solved.areaSqMeters.toFixed(2)} m²
              </div>
              <div className="text-[11px] text-slate-500 font-mono">
                {solved.areaPing.toFixed(2)} 坪
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
              <div className="text-[11px] text-slate-500">天花板高度</div>
              <div className="font-mono font-bold text-slate-900 mt-0.5">
                {formatDimension(project.ceilingHeightCm, project.unit)}
              </div>
              <div className="text-[11px] text-slate-500 font-mono">
                周長 {formatDimension(solved.perimeterCm, project.unit)}
              </div>
            </div>
          </div>
          {project.analysisNotes && (
            <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-2.5 leading-relaxed">
              {project.analysisNotes}
            </p>
          )}
        </section>

        <section className="space-y-1.5">
          <div className="flex items-center gap-1.5 font-semibold text-slate-800">
            <Ruler className="w-3.5 h-3.5 text-slate-500" />
            <span>牆壁尺寸 ({solved.solvedEdges.length + solved.solvedInteriorWalls.length})</span>
          </div>
          <div className="space-y-1">
            {[...solved.solvedEdges, ...solved.solvedInteriorWalls].map((seg) => {
              const active = selectedEdgeId === seg.id;
              return (
                <button
                  key={seg.id}
                  type="button"
                  onClick={() => {
                    onSelectEdge(seg.id);
                    onSelectElement(null);
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-left transition-colors ${
                    active
                      ? 'bg-blue-50 border-blue-400 text-blue-900'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="font-medium truncate pr-2">
                    {seg.isInterior ? `[隔間] ${seg.label}` : seg.label}
                  </span>
                  <span className="font-mono tabular-nums text-[11px] shrink-0">
                    {formatDimension(seg.lengthCm, project.unit)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-1.5">
          <div className="flex items-center gap-1.5 font-semibold text-slate-800">
            <DoorOpen className="w-3.5 h-3.5 text-slate-500" />
            <span>門窗與空間物品 ({project.elements.length})</span>
          </div>
          <div className="space-y-1.5">
            {project.elements.map((el) => {
              const active = selectedElementId === el.id;
              return (
                <button
                  key={el.id}
                  type="button"
                  onClick={() => {
                    onSelectElement(el.id);
                    onSelectEdge(null);
                  }}
                  className={`w-full p-2.5 rounded-lg border text-left transition-colors ${
                    active
                      ? 'bg-blue-50 border-blue-400 text-blue-900'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold flex items-center gap-1.5 truncate">
                      <Box className="w-3 h-3 text-slate-400 shrink-0" />
                      {el.name}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500 shrink-0">
                      {formatDimension(el.widthCm, project.unit, false)}×
                      {formatDimension(el.depthCm, project.unit, false)}×
                      {formatDimension(el.heightCm, project.unit)}
                    </span>
                  </div>
                  {el.kind === 'door' && (
                    <div className="text-[11px] text-blue-700 mt-1">
                      開門方式：{getDoorSwingLabel(el.swingDirection)}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {(project.sectionLines?.length ?? 0) > 0 && (
          <section className="space-y-1.5">
            <div className="flex items-center gap-1.5 font-semibold text-slate-800">
              <Scissors className="w-3.5 h-3.5 text-rose-600" />
              <span>剖面立面圖 ({project.sectionLines!.length})</span>
            </div>
            <div className="space-y-1">
              {project.sectionLines!.map((sec) => {
                const active = selectedSectionId === sec.id;
                return (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => onViewSection(sec.id)}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-left transition-colors ${
                      active
                        ? 'bg-rose-50 border-rose-400 text-rose-900'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span className="font-semibold">剖面 {sec.label}</span>
                    <span className="text-[11px] text-rose-700 font-medium">查看立面 →</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </aside>
  );
};

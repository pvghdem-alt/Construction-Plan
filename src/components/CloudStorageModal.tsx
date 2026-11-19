import React, { useMemo, useState } from 'react';
import {
  Cloud,
  CloudUpload,
  FolderOpen,
  LogIn,
  LogOut,
  Search,
  Trash2,
  X,
  Check,
  AlertCircle,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import type { FloorplanProject, SolvedFloorplan } from '../types/floorplan';
import type { CloudFloorplanRecord } from '../services/cloudFloorplans';

interface CloudStorageModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  authReady: boolean;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  currentProject: FloorplanProject;
  currentSolved: SolvedFloorplan;
  activeCloudId: string | null;
  records: CloudFloorplanRecord[];
  isLoadingRecords: boolean;
  cloudError: string | null;
  onSaveNew: (titleOverride?: string) => Promise<void>;
  onUpdateExisting: (titleOverride?: string) => Promise<void>;
  onLoadRecord: (record: CloudFloorplanRecord) => void;
  onDeleteRecord: (record: CloudFloorplanRecord) => Promise<void>;
}

function formatUpdatedAt(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '剛剛';
  try {
    return new Intl.DateTimeFormat('zh-TW', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(ms));
  } catch {
    return '剛剛';
  }
}

export const CloudStorageModal: React.FC<CloudStorageModalProps> = ({
  isOpen,
  onClose,
  user,
  authReady,
  onSignIn,
  onSignOut,
  currentProject,
  currentSolved,
  activeCloudId,
  records,
  isLoadingRecords,
  cloudError,
  onSaveNew,
  onUpdateExisting,
  onLoadRecord,
  onDeleteRecord,
}) => {
  const [titleDraft, setTitleDraft] = useState(currentProject.projectName);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Sync draft when modal opens or projectName changes
  React.useEffect(() => {
    if (isOpen) {
      setTitleDraft(currentProject.projectName);
      setStatusMessage(null);
      setActionError(null);
    }
  }, [isOpen, currentProject.projectName]);

  const filteredRecords = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) => r.project.projectName.toLowerCase().includes(q));
  }, [records, searchTerm]);

  const activeRecord = useMemo(
    () => (activeCloudId ? records.find((r) => r.id === activeCloudId) ?? null : null),
    [records, activeCloudId]
  );

  if (!isOpen) return null;

  const handleSaveNewClick = async () => {
    const trimmed = titleDraft.trim();
    if (!trimmed) {
      setActionError('請輸入專案名稱後再儲存。');
      return;
    }
    setIsSaving(true);
    setActionError(null);
    setStatusMessage(null);
    try {
      await onSaveNew(trimmed);
      setStatusMessage(`已將「${trimmed}」儲存為新的雲端專案。`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '雲端儲存失敗，請稍後再試。');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateClick = async () => {
    const trimmed = titleDraft.trim();
    if (!trimmed) {
      setActionError('請輸入專案名稱後再更新。');
      return;
    }
    setIsSaving(true);
    setActionError(null);
    setStatusMessage(null);
    try {
      await onUpdateExisting(trimmed);
      setStatusMessage(`已同步更新雲端專案「${trimmed}」。`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '雲端更新失敗，請稍後再試。');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteClick = async (rec: CloudFloorplanRecord) => {
    setDeletingId(rec.id);
    setActionError(null);
    setStatusMessage(null);
    try {
      await onDeleteRecord(rec);
      setStatusMessage(`已刪除雲端專案「${rec.project.projectName}」。`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '刪除失敗，請稍後再試。');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cloud-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[88vh] bg-white rounded-xl border border-slate-200 shadow-xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center shrink-0">
              <Cloud className="w-5 h-5 text-blue-600" />
            </div>
            <div className="min-w-0">
              <h2 id="cloud-modal-title" className="text-base font-bold text-slate-900">
                雲端空間專案庫
              </h2>
              <p className="text-xs text-slate-500">
                儲存目前 2D/3D 平面配置至個人雲端空間，隨時線上讀取與接續編輯
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="關閉雲端空間專案庫"
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Auth Account Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-lg bg-slate-50 border border-slate-200">
            {!authReady ? (
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                <span>正在檢查登入狀態...</span>
              </div>
            ) : user ? (
              <>
                <div className="flex items-center gap-2.5 min-w-0">
                  {user.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt={user.displayName || '使用者頭像'}
                      className="w-8 h-8 rounded-full border border-slate-200 shrink-0"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
                      {(user.displayName || user.email || 'U').slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-900 truncate">
                      {user.displayName || 'Google 使用者'}
                    </p>
                    <p className="text-xs text-slate-500 truncate">{user.email}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onSignOut}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>登出帳號</span>
                </button>
              </>
            ) : (
              <div className="w-full flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold text-slate-900">
                    登入 Google 帳號以啟用雲端同步
                  </p>
                  <p className="text-xs text-slate-500">
                    您的平面圖、牆段尺寸、門窗與家具配置將安全儲存於個人專屬雲端空間
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onSignIn}
                  className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
                >
                  <LogIn className="w-4 h-4" />
                  <span>使用 Google 登入</span>
                </button>
              </div>
            )}
          </div>

          {(cloudError || actionError) && (
            <div
              role="alert"
              className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="break-all">{actionError || cloudError}</span>
            </div>
          )}

          {statusMessage && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{statusMessage}</span>
            </div>
          )}

          {user && (
            <>
              {/* Save Current Workspace Panel */}
              <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-slate-900">
                    儲存目前空間配置
                  </h3>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {currentSolved.areaSqMeters.toFixed(2)} m² · {currentProject.edges.length} 段牆 ·{' '}
                    {currentProject.elements.length} 個元件
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={titleDraft}
                    maxLength={100}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    placeholder="輸入雲端專案名稱..."
                    aria-label="雲端專案名稱"
                    className="flex-1 min-w-0 px-3 py-2 text-xs font-medium border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />

                  {activeRecord && (
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={handleUpdateClick}
                      className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isSaving ? 'animate-spin' : ''}`} />
                      <span>覆寫更新雲端檔</span>
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={handleSaveNewClick}
                    className={`flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 ${
                      activeRecord
                        ? 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                        : 'bg-slate-900 text-white hover:bg-slate-800'
                    }`}
                  >
                    <CloudUpload className="w-3.5 h-3.5" />
                    <span>{activeRecord ? '另存為新專案' : '儲存至雲端'}</span>
                  </button>
                </div>

                {activeRecord && (
                  <p className="text-[11px] text-blue-700">
                    目前畫布已連結至雲端專案：「{activeRecord.project.projectName}」
                  </p>
                )}
              </div>

              {/* Saved Cloud Projects List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-xs font-semibold text-slate-900">
                    已儲存的雲端專案 ({records.length})
                  </h3>

                  <div className="relative w-52">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="搜尋專案名稱..."
                      aria-label="搜尋雲端專案"
                      className="w-full pl-8 pr-2.5 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {isLoadingRecords ? (
                  <div className="py-10 flex items-center justify-center gap-2 text-xs text-slate-500 border border-slate-200 rounded-xl">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                    <span>讀取雲端專案清單中...</span>
                  </div>
                ) : filteredRecords.length === 0 ? (
                  <div className="py-10 text-center border border-dashed border-slate-200 rounded-xl space-y-1">
                    <p className="text-xs font-medium text-slate-600">
                      {records.length === 0
                        ? '尚未有任何雲端儲存專案'
                        : '沒有符合搜尋關鍵字的雲端專案'}
                    </p>
                    <p className="text-xs text-slate-400">
                      {records.length === 0
                        ? '點擊上方「儲存至雲端」即可將目前空間配置保存於此。'
                        : '請嘗試清除搜尋條件。'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredRecords.map((rec) => {
                      const isActive = rec.id === activeCloudId;
                      return (
                        <div
                          key={rec.id}
                          className={`p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                            isActive
                              ? 'border-blue-500 bg-blue-50/40'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold text-slate-900 truncate">
                                {rec.project.projectName}
                              </p>
                              {isActive && (
                                <span className="text-[11px] font-semibold text-blue-700 shrink-0">
                                  目前編輯中
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-slate-500 tabular-nums">
                              <span>
                                {rec.summary.areaSqMeters.toFixed(2)} m² ({rec.summary.areaPing.toFixed(2)} 坪)
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>{rec.summary.edgeCount} 段牆壁</span>
                              <span aria-hidden="true">·</span>
                              <span>{rec.summary.elementCount} 個元件</span>
                              <span aria-hidden="true">·</span>
                              <span>更新於 {formatUpdatedAt(rec.updatedAtMs)}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                onLoadRecord(rec);
                                onClose();
                              }}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                            >
                              <FolderOpen className="w-3.5 h-3.5" />
                              <span>載入編輯</span>
                            </button>

                            <button
                              type="button"
                              disabled={deletingId === rec.id}
                              onClick={() => handleDeleteClick(rec)}
                              aria-label={`刪除雲端專案 ${rec.project.projectName}`}
                              className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200 transition-colors disabled:opacity-40"
                            >
                              {deletingId === rec.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

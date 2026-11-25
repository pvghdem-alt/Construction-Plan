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
  Mail,
  KeyRound,
  ShieldAlert,
  UserPlus,
  Users,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import type { FloorplanProject, SolvedFloorplan } from '../types/floorplan';
import type {
  CloudFloorplanRecord,
  SharedCloudFloorplanRecord,
} from '../services/cloudFloorplans';
import {
  parseShareEmailsInput,
  resolveLatestFloorplanForOwner,
  type ShareAccessLevel,
} from '../utils/cloudShareHelpers';

interface CloudStorageModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  authReady: boolean;
  onSignIn: () => Promise<void>;
  onSignInWithEmail: (email: string, password: string) => Promise<void>;
  onRegisterWithEmail: (email: string, password: string) => Promise<void>;
  onSendPasswordReset: (email: string) => Promise<void>;
  onSendVerificationEmail: () => Promise<void>;
  onReloadVerification: () => Promise<boolean>;
  onSignOut: () => Promise<void>;
  currentProject: FloorplanProject;
  currentSolved: SolvedFloorplan;
  activeCloudId: string | null;
  activeSharedId: string | null;
  records: CloudFloorplanRecord[];
  mySharedRecords: SharedCloudFloorplanRecord[];
  sharedWithMeRecords: SharedCloudFloorplanRecord[];
  isLoadingRecords: boolean;
  cloudError: string | null;
  onSaveNew: (titleOverride?: string) => Promise<void>;
  onUpdateExisting: (titleOverride?: string) => Promise<void>;
  onUpdateShared: (titleOverride?: string) => Promise<void>;
  onLoadRecord: (record: CloudFloorplanRecord) => void;
  onLoadSharedRecord: (record: SharedCloudFloorplanRecord) => void;
  onShareRecords: (
    records: CloudFloorplanRecord[],
    emails: string[],
    accessLevel: ShareAccessLevel
  ) => Promise<void>;
  onToggleShareAccessLevel: (
    shareRecord: SharedCloudFloorplanRecord,
    nextLevel: ShareAccessLevel
  ) => Promise<void>;
  onRevokeShareEmail: (shareRecord: SharedCloudFloorplanRecord, email: string) => Promise<void>;
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
  onSignInWithEmail,
  onRegisterWithEmail,
  onSendPasswordReset,
  onSendVerificationEmail,
  onReloadVerification,
  onSignOut,
  currentProject,
  currentSolved,
  activeCloudId,
  activeSharedId,
  records,
  mySharedRecords,
  sharedWithMeRecords,
  isLoadingRecords,
  cloudError,
  onSaveNew,
  onUpdateExisting,
  onUpdateShared,
  onLoadRecord,
  onLoadSharedRecord,
  onShareRecords,
  onToggleShareAccessLevel,
  onRevokeShareEmail,
  onDeleteRecord,
}) => {
  const [titleDraft, setTitleDraft] = useState(currentProject.projectName);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [shareEmailsDraft, setShareEmailsDraft] = useState('');
  const [shareAccessLevelDraft, setShareAccessLevelDraft] = useState<ShareAccessLevel>('editor');
  const [isSharingBusy, setIsSharingBusy] = useState(false);
  const shareInputRef = React.useRef<HTMLInputElement | null>(null);

  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [emailDraft, setEmailDraft] = useState('');
  const [passwordDraft, setPasswordDraft] = useState('');
  const [isAuthBusy, setIsAuthBusy] = useState(false);

  // Sync draft when modal opens or projectName changes
  React.useEffect(() => {
    if (isOpen) {
      setTitleDraft(currentProject.projectName);
      setStatusMessage(null);
      setActionError(null);
    }
  }, [isOpen, currentProject.projectName]);

  const myShareByPlanId = useMemo(() => {
    const map = new Map<string, SharedCloudFloorplanRecord>();
    for (const share of mySharedRecords) {
      map.set(share.sourcePlanId, share);
    }
    return map;
  }, [mySharedRecords]);

  const handleShareTargetRecords = async (
    targetRecords: CloudFloorplanRecord[],
    successLabel: string
  ) => {
    const parsed = parseShareEmailsInput(shareEmailsDraft, user?.email);
    if (parsed.invalidTokens.length > 0) {
      setActionError(`以下 Email 格式不正確：${parsed.invalidTokens.join(', ')}`);
      return;
    }
    if (parsed.validEmails.length === 0) {
      setActionError(
        parsed.ignoredSelf
          ? '無法分享給目前登入的同一組 Email，請輸入對方的 Email（例如 jason2134@gmail.com）。'
          : '請先輸入對方的 Email（例如 jason2134@gmail.com）。'
      );
      shareInputRef.current?.focus();
      return;
    }
    setIsSharingBusy(true);
    setActionError(null);
    setStatusMessage(null);
    try {
      await onShareRecords(targetRecords, parsed.validEmails, shareAccessLevelDraft);
      const modeText = shareAccessLevelDraft === 'editor' ? '可共同編輯' : '僅供檢視';
      setStatusMessage(
        `${successLabel}給 ${parsed.validEmails.join('、')}（${modeText}）！對方登入後即可在「他人共用給我的專案」中存取。`
      );
      setShareEmailsDraft('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '雲端分享失敗，請稍後再試。');
    } finally {
      setIsSharingBusy(false);
    }
  };

  const handleToggleShareLevelClick = async (
    shareRecord: SharedCloudFloorplanRecord,
    nextLevel: ShareAccessLevel
  ) => {
    setIsSharingBusy(true);
    setActionError(null);
    setStatusMessage(null);
    try {
      await onToggleShareAccessLevel(shareRecord, nextLevel);
      setStatusMessage(
        `已將「${shareRecord.project.projectName}」切換為「${
          nextLevel === 'editor' ? '可共同編輯' : '僅供檢視'
        }」。`
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '切換共用權限失敗，請稍後再試。');
    } finally {
      setIsSharingBusy(false);
    }
  };

  const handleRevokeEmailClick = async (
    shareRecord: SharedCloudFloorplanRecord,
    email: string
  ) => {
    setIsSharingBusy(true);
    setActionError(null);
    setStatusMessage(null);
    try {
      await onRevokeShareEmail(shareRecord, email);
      setStatusMessage(`已取消「${shareRecord.project.projectName}」對 ${email} 的共用權限。`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '取消共用失敗，請稍後再試。');
    } finally {
      setIsSharingBusy(false);
    }
  };

  const handleEmailAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = emailDraft.trim();
    if (!trimmedEmail || !passwordDraft) {
      setActionError('請輸入 Email 與密碼。');
      return;
    }
    setIsAuthBusy(true);
    setActionError(null);
    setStatusMessage(null);
    try {
      if (authMode === 'login') {
        await onSignInWithEmail(trimmedEmail, passwordDraft);
        setStatusMessage(`已登入帳號：${trimmedEmail}`);
      } else {
        await onRegisterWithEmail(trimmedEmail, passwordDraft);
        setStatusMessage('帳號建立成功！已寄出驗證信，請點擊信中連結後按下「我已完成驗證」。');
      }
      setPasswordDraft('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Email 登入失敗，請稍後再試。');
    } finally {
      setIsAuthBusy(false);
    }
  };

  const handleResetPasswordClick = async () => {
    const trimmedEmail = emailDraft.trim();
    if (!trimmedEmail) {
      setActionError('請先在上方輸入 Email，再點擊「忘記密碼」。');
      return;
    }
    setIsAuthBusy(true);
    setActionError(null);
    setStatusMessage(null);
    try {
      await onSendPasswordReset(trimmedEmail);
      setStatusMessage(`已寄送重設密碼信至 ${trimmedEmail}，請查看收件匣或垃圾郵件。`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '寄送重設密碼信失敗。');
    } finally {
      setIsAuthBusy(false);
    }
  };

  const handleResendVerificationClick = async () => {
    setIsAuthBusy(true);
    setActionError(null);
    setStatusMessage(null);
    try {
      await onSendVerificationEmail();
      setStatusMessage(`已寄出驗證信至 ${user?.email || '您的信箱'}，請點擊信中連結完成驗證。`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '寄送驗證信失敗，請稍後再試。');
    } finally {
      setIsAuthBusy(false);
    }
  };

  const handleCheckVerifiedClick = async () => {
    setIsAuthBusy(true);
    setActionError(null);
    setStatusMessage(null);
    try {
      const ok = await onReloadVerification();
      if (ok) {
        setStatusMessage('信箱驗證已完成，已載入雲端空間！');
      } else {
        setActionError('系統偵測此信箱尚未完成驗證，請確認已點擊驗證信內的連結後再試一次。');
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '檢查驗證狀態失敗。');
    } finally {
      setIsAuthBusy(false);
    }
  };

  const filteredRecords = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) => r.project.projectName.toLowerCase().includes(q));
  }, [records, searchTerm]);

  const activeRecord = useMemo(
    () => (activeCloudId ? records.find((r) => r.id === activeCloudId) ?? null : null),
    [records, activeCloudId]
  );

  const activeSharedRecord = useMemo(
    () => (activeSharedId ? sharedWithMeRecords.find((r) => r.id === activeSharedId) ?? null : null),
    [sharedWithMeRecords, activeSharedId]
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

  const handleUpdateSharedClick = async () => {
    const trimmed = titleDraft.trim();
    if (!trimmed) {
      setActionError('請輸入專案名稱後再同步更新。');
      return;
    }
    setIsSaving(true);
    setActionError(null);
    setStatusMessage(null);
    try {
      await onUpdateShared(trimmed);
      setStatusMessage(`已同步更新共同編輯專案「${trimmed}」，擁有者及其他成員皆可看見最新內容！`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '同步更新共用專案失敗，請稍後再試。');
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
                      {user.displayName || '雲端空間使用者'}
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
              <div className="w-full space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200">
                  <div className="space-y-0.5">
                    <p className="text-xs font-semibold text-slate-900">
                      登入雲端帳號以存取個人平面圖專案
                    </p>
                    <p className="text-[11px] text-slate-500">
                      在 GitHub Pages 等自訂網域推薦直接使用「Email / 密碼登入」，無需設定彈窗授權網域
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isAuthBusy}
                    onClick={onSignIn}
                    className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-white text-slate-800 border border-slate-300 hover:bg-slate-100 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                  >
                    <LogIn className="w-3.5 h-3.5 text-blue-600" />
                    <span>使用 Google 登入</span>
                  </button>
                </div>

                <form onSubmit={handleEmailAuthSubmit} className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="inline-flex rounded-lg bg-slate-200/70 p-0.5 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setAuthMode('login');
                          setActionError(null);
                        }}
                        className={`px-3 py-1 rounded-md font-semibold transition-colors ${
                          authMode === 'login'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Email 登入
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAuthMode('register');
                          setActionError(null);
                        }}
                        className={`px-3 py-1 rounded-md font-semibold transition-colors ${
                          authMode === 'register'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        註冊新帳號
                      </button>
                    </div>

                    <button
                      type="button"
                      disabled={isAuthBusy}
                      onClick={handleResetPasswordClick}
                      className="text-[11px] font-medium text-blue-600 hover:text-blue-800 hover:underline disabled:opacity-50"
                    >
                      忘記密碼？
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label htmlFor="cloud-auth-email" className="block text-[11px] font-medium text-slate-700 mb-1">
                        Email 信箱
                      </label>
                      <div className="relative">
                        <Mail className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          id="cloud-auth-email"
                          type="email"
                          required
                          autoComplete="email"
                          value={emailDraft}
                          onChange={(e) => setEmailDraft(e.target.value)}
                          placeholder="jason2134@gmail.com"
                          className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="cloud-auth-password" className="block text-[11px] font-medium text-slate-700 mb-1">
                        密碼
                      </label>
                      <div className="relative">
                        <KeyRound className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          id="cloud-auth-password"
                          type="password"
                          required
                          autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                          value={passwordDraft}
                          onChange={(e) => setPasswordDraft(e.target.value)}
                          placeholder="請輸入密碼（至少 6 碼）"
                          className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={isAuthBusy}
                      className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {isAuthBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>{authMode === 'login' ? '使用 Email 登入' : '建立帳號並寄送驗證信'}</span>
                    </button>
                  </div>
                </form>
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

          {user && !user.emailVerified && (
            <div className="p-4 rounded-xl border border-amber-300 bg-amber-50 space-y-3 text-xs text-amber-900">
              <div className="flex items-start gap-2.5">
                <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold">此 Email 帳號尚未完成信箱驗證</p>
                  <p className="text-amber-800 leading-relaxed">
                    資料庫安全規則要求驗證信箱後才可讀寫雲端專案。若您在 Firebase 後台手動建立帳號，請點選下方「寄送驗證信」至 <span className="font-mono font-semibold">{user.email}</span>，點擊信中連結後再按「我已完成驗證」。
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isAuthBusy}
                  onClick={handleResendVerificationClick}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-amber-700 text-white hover:bg-amber-800 disabled:opacity-50 transition-colors"
                >
                  寄送驗證信
                </button>
                <button
                  type="button"
                  disabled={isAuthBusy}
                  onClick={handleCheckVerifiedClick}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-white text-amber-900 border border-amber-300 hover:bg-amber-100 disabled:opacity-50 transition-colors"
                >
                  我已完成驗證，重新檢查
                </button>
              </div>
            </div>
          )}

          {user && user.emailVerified && (
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

                  {!activeRecord && activeSharedRecord && activeSharedRecord.accessLevel === 'editor' && (
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={handleUpdateSharedClick}
                      className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isSaving ? 'animate-spin' : ''}`} />
                      <span>同步更新共用專案</span>
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={handleSaveNewClick}
                    className={`flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 ${
                      activeRecord || (activeSharedRecord && activeSharedRecord.accessLevel === 'editor')
                        ? 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                        : 'bg-slate-900 text-white hover:bg-slate-800'
                    }`}
                  >
                    <CloudUpload className="w-3.5 h-3.5" />
                    <span>
                      {activeRecord
                        ? '另存為新專案'
                        : activeSharedRecord
                        ? '另存至我的雲端'
                        : '儲存至雲端'}
                    </span>
                  </button>
                </div>

                {activeRecord && (
                  <p className="text-[11px] text-blue-700">
                    目前畫布已連結至雲端專案：「{activeRecord.project.projectName}」
                  </p>
                )}
                {!activeRecord && activeSharedRecord && (
                  <p
                    className={`text-[11px] ${
                      activeSharedRecord.accessLevel === 'editor'
                        ? 'text-emerald-700'
                        : 'text-amber-700'
                    }`}
                  >
                    {activeSharedRecord.accessLevel === 'editor'
                      ? `目前畫布已連結至共同編輯專案：「${activeSharedRecord.project.projectName}」（來自 ${activeSharedRecord.ownerDisplayName}），點擊「同步更新共用專案」即可儲存變更。`
                      : `目前檢視唯讀共用專案：「${activeSharedRecord.project.projectName}」（擁有者設定為僅檢視，若要保留修改可點擊「另存至我的雲端」）。`}
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

                {/* Cross-Account Sharing Bar */}
                {records.length > 0 && (
                  <div className="p-3 rounded-xl border border-blue-200 bg-blue-50/50 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-950">
                        <Users className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                        <span>共用雲端專案給其他帳號</span>
                      </div>

                      <div className="inline-flex rounded-lg bg-white border border-blue-200 p-0.5 text-[11px]">
                        <button
                          type="button"
                          onClick={() => setShareAccessLevelDraft('editor')}
                          className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
                            shareAccessLevelDraft === 'editor'
                              ? 'bg-blue-600 text-white'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          可共同編輯
                        </button>
                        <button
                          type="button"
                          onClick={() => setShareAccessLevelDraft('viewer')}
                          className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
                            shareAccessLevelDraft === 'viewer'
                              ? 'bg-slate-800 text-white'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          僅供檢視
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        ref={shareInputRef}
                        id="cloud-share-email-input"
                        type="text"
                        value={shareEmailsDraft}
                        onChange={(e) => setShareEmailsDraft(e.target.value)}
                        placeholder="輸入對方 Email（如 jason2134@gmail.com，多位以逗號分隔）"
                        aria-label="要共用的對象 Email"
                        className="flex-1 min-w-0 px-3 py-1.5 text-xs bg-white border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        disabled={isSharingBusy}
                        onClick={() =>
                          handleShareTargetRecords(
                            records,
                            `已將全部 ${records.length} 個雲端專案共用`
                          )
                        }
                        className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                      >
                        {isSharingBusy ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <UserPlus className="w-3.5 h-3.5" />
                        )}
                        <span>一鍵共用全部 ({records.length})</span>
                      </button>
                    </div>
                  </div>
                )}

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
                      const shareRec = myShareByPlanId.get(rec.id);
                      const latest = resolveLatestFloorplanForOwner(rec, shareRec);
                      return (
                        <div
                          key={rec.id}
                          className={`p-3.5 rounded-xl border space-y-2.5 transition-colors ${
                            isActive
                              ? 'border-blue-500 bg-blue-50/40'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold text-slate-900 truncate">
                                  {latest.project.projectName}
                                </p>
                                {isActive && (
                                  <span className="text-[11px] font-semibold text-blue-700 shrink-0">
                                    目前編輯中
                                  </span>
                                )}
                                {latest.useSharedVersion && (
                                  <span className="text-[11px] font-semibold text-emerald-700 shrink-0">
                                    協作者已更新（{latest.editedByLabel}）
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-slate-500 tabular-nums">
                                <span>
                                  {latest.summary.areaSqMeters.toFixed(2)} m² ({latest.summary.areaPing.toFixed(2)} 坪)
                                </span>
                                <span aria-hidden="true">·</span>
                                <span>{latest.summary.edgeCount} 段牆壁</span>
                                <span aria-hidden="true">·</span>
                                <span>{latest.summary.elementCount} 個元件</span>
                                <span aria-hidden="true">·</span>
                                <span>更新於 {formatUpdatedAt(latest.updatedAtMs)}</span>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                disabled={isSharingBusy}
                                onClick={() =>
                                  handleShareTargetRecords(
                                    [rec],
                                    `已將「${latest.project.projectName}」共用`
                                  )
                                }
                                title="使用上方輸入的 Email 共用此專案"
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                              >
                                <UserPlus className="w-3.5 h-3.5" />
                                <span>共用</span>
                              </button>

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

                          {shareRec && shareRec.sharedWithEmails.length > 0 && (
                            <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-medium text-slate-500">已共用給：</span>
                                {shareRec.sharedWithEmails.map((email) => (
                                  <span
                                    key={email}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200"
                                  >
                                    <span>{email}</span>
                                    <button
                                      type="button"
                                      disabled={isSharingBusy}
                                      onClick={() => handleRevokeEmailClick(shareRec, email)}
                                      aria-label={`取消共用給 ${email}`}
                                      title={`取消共用給 ${email}`}
                                      className="text-slate-400 hover:text-red-600 disabled:opacity-40"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </span>
                                ))}
                              </div>

                              <button
                                type="button"
                                disabled={isSharingBusy}
                                onClick={() =>
                                  handleToggleShareLevelClick(
                                    shareRec,
                                    shareRec.accessLevel === 'editor' ? 'viewer' : 'editor'
                                  )
                                }
                                className={`px-2 py-0.5 rounded-md font-semibold border transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 ${
                                  shareRec.accessLevel === 'editor'
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                    : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                                }`}
                                title="點擊切換對方的共用權限"
                              >
                                {shareRec.accessLevel === 'editor'
                                  ? '權限：可共同編輯（點擊切僅檢視）'
                                  : '權限：僅供檢視（點擊開放編輯）'}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Shared With Me Section */}
              <div className="space-y-2.5 pt-2 border-t border-slate-200">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-emerald-600" />
                    <span>他人共用給我的專案 ({sharedWithMeRecords.length})</span>
                  </h3>
                  <span className="text-[11px] text-slate-500">
                    對方授權您的信箱後即會顯示於此
                  </span>
                </div>

                {sharedWithMeRecords.length === 0 ? (
                  <div className="py-5 px-4 text-center border border-dashed border-slate-200 rounded-xl">
                    <p className="text-xs text-slate-500">
                      目前尚無其他帳號共用給 <span className="font-mono font-medium">{user.email}</span> 的專案。
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {sharedWithMeRecords.map((rec) => {
                      const isEditable = rec.accessLevel === 'editor';
                      const isCurrentShared = rec.id === activeSharedId;
                      return (
                        <div
                          key={rec.id}
                          className={`p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                            isCurrentShared
                              ? 'border-emerald-500 bg-emerald-50/60'
                              : isEditable
                              ? 'border-emerald-200 bg-emerald-50/30'
                              : 'border-slate-200 bg-slate-50/50'
                          }`}
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold text-slate-900 truncate">
                                {rec.project.projectName}
                              </p>
                              <span
                                className={`text-[11px] font-semibold shrink-0 ${
                                  isEditable ? 'text-emerald-700' : 'text-slate-600'
                                }`}
                              >
                                來自 {rec.ownerDisplayName || '團隊共用'} ·{' '}
                                {isEditable ? '可共同編輯' : '僅供檢視'}
                              </span>
                              {isCurrentShared && (
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
                              <span>
                                {rec.lastEditedByName
                                  ? `由 ${rec.lastEditedByName} 同步於 ${formatUpdatedAt(rec.updatedAtMs)}`
                                  : `同步於 ${formatUpdatedAt(rec.updatedAtMs)}`}
                              </span>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              onLoadSharedRecord(rec);
                              onClose();
                            }}
                            className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 ${
                              isEditable
                                ? 'bg-emerald-700 hover:bg-emerald-800'
                                : 'bg-slate-700 hover:bg-slate-800'
                            }`}
                          >
                            <FolderOpen className="w-3.5 h-3.5" />
                            <span>{isEditable ? '載入共同編輯' : '載入檢視 / 複製'}</span>
                          </button>
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

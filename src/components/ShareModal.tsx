import React, { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Lock, Share2, X } from 'lucide-react';
import type { FloorplanProject } from '../types/floorplan';
import {
  buildGitHubPagesShareUrl,
  encodeShareToken,
  encodeShareTokenSync,
} from '../utils/shareLink';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: FloorplanProject;
}

export const ShareModal: React.FC<ShareModalProps> = ({
  isOpen,
  onClose,
  project,
}) => {
  const [shareUrl, setShareUrl] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setCopied(false);

    // Immediate sync fallback so the URL is ready right away
    const syncToken = encodeShareTokenSync(project);
    setShareUrl(buildGitHubPagesShareUrl(window.location.href, syncToken));

    // Upgrade to shorter deflate-compressed token asynchronously if supported
    void encodeShareToken(project).then((token) => {
      if (!cancelled) {
        setShareUrl(buildGitHubPagesShareUrl(window.location.href, token));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, project]);

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

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = shareUrl;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
    }
    setTimeout(() => setCopied(false), 2200);
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
        aria-labelledby="share-modal-title"
        className="w-full max-w-lg bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Share2 className="w-4 h-4 text-emerald-600" />
            <h2 id="share-modal-title" className="text-sm font-bold text-slate-900">
              分享唯讀檢視連結（GitHub Pages 適用）
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉分享視窗"
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 leading-relaxed">
            <Lock className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">第三方僅能檢視，無法編輯或覆蓋您的圖稿</p>
              <p className="text-emerald-800 mt-0.5">
                連結已將目前平面圖幾何、門窗（含推開/橫拉方向）、家具與剖面線編碼於網址中，部署到 GitHub Pages 靜態網站後即可直接免登入開啟。
              </p>
            </div>
          </div>

          <div>
            <label
              htmlFor="share-readonly-url-input"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              唯讀分享網址（長度 {shareUrl.length} 字元）
            </label>
            <div className="flex items-center gap-2">
              <input
                id="share-readonly-url-input"
                type="text"
                readOnly
                value={shareUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 min-w-0 px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                type="button"
                onClick={handleCopy}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  copied
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-900 text-white hover:bg-slate-800'
                }`}
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? '已複製連結' : '複製連結'}</span>
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
            <p className="font-semibold text-slate-800">第三方檢視權限說明：</p>
            <p>✓ 可自由切換 2D 平面圖、3D 空間透視、並排檢視與立面圖</p>
            <p>✓ 可查看空間尺寸、內牆面積明細，並匯出 PDF / PNG / SVG</p>
            <p>✕ 無法拖曳、旋轉、改尺寸、刪除物件、繪製剖面線或存取雲端帳號</p>
          </div>

          <div className="flex items-center justify-between pt-1">
            <a
              href={shareUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>在新分頁預覽唯讀檢視</span>
            </a>

            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors"
            >
              完成
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full flex items-center justify-center bg-slate-50 p-6">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-3">
            <div className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h2 className="text-base font-semibold">應用程式發生非預期錯誤</h2>
            </div>
            <p className="text-xs text-slate-600 break-words leading-relaxed">
              {this.state.message || '請重新整理頁面後再試。'}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>重新載入頁面</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

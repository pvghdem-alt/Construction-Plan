export function formatFirebaseAuthError(
  err: unknown,
  currentHostname?: string
): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const codeMatch = raw.match(/\((auth\/[a-z0-9-]+)\)/i);
  const code = codeMatch ? codeMatch[1].toLowerCase() : '';

  switch (code) {
    case 'auth/unauthorized-domain': {
      const hostHint = currentHostname ? `「${currentHostname}」` : '目前網域';
      return `Google 彈窗登入不支援未授權網域 ${hostHint}（auth/unauthorized-domain）。請改用下方「Email / 密碼登入」，或至 Firebase Console → Authentication → 設定 → 已授權網域 新增此網域。`;
    }
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email 或密碼不正確，請確認後重試（或點選「忘記密碼」重設）。';
    case 'auth/invalid-email':
      return 'Email 格式不正確，請重新輸入。';
    case 'auth/email-already-in-use':
      return '此 Email 已註冊過帳號，請直接切換回「Email 登入」。';
    case 'auth/weak-password':
      return '密碼長度需至少 6 個字元。';
    case 'auth/too-many-requests':
      return '嘗試次數過多，系統暫時鎖定請求，請稍候幾分鐘再試。';
    case 'auth/popup-closed-by-user':
      return '已取消 Google 登入視窗。';
    case 'auth/popup-blocked':
      return '瀏覽器封鎖了 Google 登入彈窗，請允許彈窗或改用 Email / 密碼登入。';
    case 'auth/network-request-failed':
      return '網路連線失敗，請檢查網路狀態後再試。';
    default:
      return raw || '登入失敗，請稍後再試。';
  }
}

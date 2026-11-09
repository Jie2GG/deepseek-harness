/** Copy for the server-rendered browser sign-in and password setup pages. */

/** Every language the page renders, matching the shipped UI languages. */
export const authEn = {
  language: 'en',
  subtitle: 'Use the account and password created on this machine.',
  setupSubtitle: 'Choose the password that protects this Host.',
  signingIn: 'Signing in…',
  title: 'Sign in to DeepSeek Harness',
  setupTitle: 'Set a password to start',
  usernameLabel: 'Account name',
  passwordLabel: 'Password',
  confirmLabel: 'Confirm password',
  passwordMismatch: 'The two passwords do not match.',
  rememberLabel: 'Remember me',
  revealPassword: 'Show the password',
  failedAttempts: 'Wrong attempts in a row: {count}.',
  wrongPassword: 'The current password is not correct.',
  sessionExpired: 'Your session has expired. Sign in again.',
  changedPassword: 'Password updated.',
  revokedOthers: 'Signed out the other devices.',
  signInButton: 'Sign in',
  setupButton: 'Set password',
  insecureNotice: 'This connection is not encrypted.',
  wrongCredentials: 'The account name or password is not correct.',
  needSetup: 'No password has been set. Create one to continue.',
  alreadySet: 'A password is already set. Sign in instead.',
  passwordTooShort: 'Use a password of at least 8 characters.',
  tooManyAttempts: 'Too many attempts. Try again in {seconds} seconds.',
  requestFailed: 'The request failed. Try again.',
}

/** Simplified Chinese page copy. */
export const authZh = {
  language: 'zh',
  subtitle: '使用这台机器上创建的账号和密码。',
  setupSubtitle: '为这个 Host 选择一个保护口令。',
  signingIn: '正在登录…',
  title: '登录 DeepSeek Harness',
  setupTitle: '先设置一个密码',
  usernameLabel: '账号',
  passwordLabel: '密码',
  confirmLabel: '确认新密码',
  passwordMismatch: '两次输入的密码不一致。',
  rememberLabel: '记住我',
  revealPassword: '显示密码',
  failedAttempts: '已连续失败 {count} 次。',
  wrongPassword: '当前密码不正确。',
  sessionExpired: '登录已过期，请重新登录。',
  changedPassword: '密码已更新。',
  revokedOthers: '已登出其他设备。',
  signInButton: '登录',
  setupButton: '设置密码',
  insecureNotice: '此连接未加密。',
  wrongCredentials: '账号或密码不正确。',
  needSetup: '尚未设置密码，请先创建一个。',
  alreadySet: '密码已经设置，请直接登录。',
  passwordTooShort: '密码至少需要 8 个字符。',
  tooManyAttempts: '尝试次数过多，请 {seconds} 秒后重试。',
  requestFailed: '请求失败，请重试。',
}

/** Japanese page copy. */
export const authJa = {
  language: 'ja',
  subtitle: 'このマシンで作成したアカウントとパスワードを入力します。',
  setupSubtitle: 'この Host を保護するパスワードを選びます。',
  signingIn: 'サインイン中…',
  title: 'DeepSeek Harness にサインイン',
  setupTitle: '開始前にパスワードを設定',
  usernameLabel: 'アカウント名',
  passwordLabel: 'パスワード',
  confirmLabel: 'パスワード（確認）',
  passwordMismatch: 'パスワードが一致しません。',
  rememberLabel: 'ログイン情報を保持する',
  revealPassword: 'パスワードを表示',
  failedAttempts: '失敗が {count} 回続いています。',
  wrongPassword: '現在のパスワードが正しくありません。',
  sessionExpired: 'セッションの有効期限が切れました。再度サインインしてください。',
  changedPassword: 'パスワードを更新しました。',
  revokedOthers: '他の端末からサインアウトしました。',
  signInButton: 'サインイン',
  setupButton: 'パスワードを設定',
  insecureNotice: 'この接続は暗号化されていません。',
  wrongCredentials: 'アカウント名またはパスワードが正しくありません。',
  needSetup: 'パスワードが設定されていません。続行するには設定してください。',
  alreadySet: 'パスワードは設定済みです。代わりにサインインしてください。',
  passwordTooShort: 'パスワードは 8 文字以上にしてください。',
  tooManyAttempts: '試行回数が多すぎます。{seconds} 秒後に再試行してください。',
  requestFailed: '要求に失敗しました。もう一度お試しください。',
}

/** Spanish page copy. */
export const authEs = {
  language: 'es',
  subtitle: 'Usa la cuenta y la contraseña creadas en esta máquina.',
  setupSubtitle: 'Elige la contraseña que protegerá este Host.',
  signingIn: 'Iniciando sesión…',
  title: 'Inicia sesión en DeepSeek Harness',
  setupTitle: 'Establece una contraseña para empezar',
  usernameLabel: 'Nombre de cuenta',
  passwordLabel: 'Contraseña',
  confirmLabel: 'Confirmar contraseña',
  passwordMismatch: 'Las dos contraseñas no coinciden.',
  rememberLabel: 'Recordarme',
  revealPassword: 'Mostrar la contraseña',
  failedAttempts: 'Llevas {count} intentos fallidos seguidos.',
  wrongPassword: 'La contraseña actual no es correcta.',
  sessionExpired: 'La sesión ha caducado. Vuelve a iniciar sesión.',
  changedPassword: 'Contraseña actualizada.',
  revokedOthers: 'Se cerraron las otras sesiones.',
  signInButton: 'Iniciar sesión',
  setupButton: 'Establecer contraseña',
  insecureNotice: 'Esta conexión no está cifrada.',
  wrongCredentials: 'El nombre de cuenta o la contraseña no son correctos.',
  needSetup: 'Aún no se ha establecido una contraseña. Crea una para continuar.',
  alreadySet: 'Ya hay una contraseña establecida. Inicia sesión.',
  passwordTooShort: 'Usa una contraseña de al menos 8 caracteres.',
  tooManyAttempts: 'Demasiados intentos. Vuelve a intentarlo en {seconds} segundos.',
  requestFailed: 'La solicitud falló. Inténtalo de nuevo.',
}

/** French page copy. */
export const authFr = {
  language: 'fr',
  subtitle: 'Utilisez le compte et le mot de passe créés sur cette machine.',
  setupSubtitle: 'Choisissez le mot de passe qui protégera ce Host.',
  signingIn: 'Connexion…',
  title: 'Se connecter à DeepSeek Harness',
  setupTitle: 'Définissez un mot de passe pour commencer',
  usernameLabel: 'Nom de compte',
  passwordLabel: 'Mot de passe',
  confirmLabel: 'Confirmer le mot de passe',
  passwordMismatch: 'Les deux mots de passe ne correspondent pas.',
  rememberLabel: 'Rester connecté',
  revealPassword: 'Afficher le mot de passe',
  failedAttempts: '{count} échecs consécutifs.',
  wrongPassword: 'Le mot de passe actuel est incorrect.',
  sessionExpired: 'Votre session a expiré. Reconnectez-vous.',
  changedPassword: 'Mot de passe mis à jour.',
  revokedOthers: 'Les autres appareils sont déconnectés.',
  signInButton: 'Se connecter',
  setupButton: 'Définir le mot de passe',
  insecureNotice: 'Cette connexion n’est pas chiffrée.',
  wrongCredentials: 'Le nom de compte ou le mot de passe est incorrect.',
  needSetup: 'Aucun mot de passe n’est défini. Créez-en un pour continuer.',
  alreadySet: 'Un mot de passe est déjà défini. Connectez-vous.',
  passwordTooShort: 'Utilisez un mot de passe d’au moins 8 caractères.',
  tooManyAttempts: 'Trop de tentatives. Réessayez dans {seconds} secondes.',
  requestFailed: 'La requête a échoué. Réessayez.',
}

/** German page copy. */
export const authDe = {
  language: 'de',
  subtitle: 'Verwenden Sie das auf diesem Rechner angelegte Konto und Passwort.',
  setupSubtitle: 'Wählen Sie das Passwort, das diesen Host schützt.',
  signingIn: 'Anmeldung läuft…',
  title: 'Bei DeepSeek Harness anmelden',
  setupTitle: 'Passwort zum Start festlegen',
  usernameLabel: 'Kontoname',
  passwordLabel: 'Passwort',
  confirmLabel: 'Passwort bestätigen',
  passwordMismatch: 'Die beiden Passwörter stimmen nicht überein.',
  rememberLabel: 'Angemeldet bleiben',
  revealPassword: 'Passwort anzeigen',
  failedAttempts: '{count} Fehlversuche in Folge.',
  wrongPassword: 'Das aktuelle Passwort ist falsch.',
  sessionExpired: 'Ihre Sitzung ist abgelaufen. Bitte erneut anmelden.',
  changedPassword: 'Passwort aktualisiert.',
  revokedOthers: 'Andere Geräte wurden abgemeldet.',
  signInButton: 'Anmelden',
  setupButton: 'Passwort festlegen',
  insecureNotice: 'Diese Verbindung ist nicht verschlüsselt.',
  wrongCredentials: 'Kontoname oder Passwort ist falsch.',
  needSetup: 'Es ist noch kein Passwort festgelegt. Legen Sie eines fest, um fortzufahren.',
  alreadySet: 'Ein Passwort ist bereits festgelegt. Melden Sie sich an.',
  passwordTooShort: 'Verwenden Sie ein Passwort mit mindestens 8 Zeichen.',
  tooManyAttempts: 'Zu viele Versuche. Versuchen Sie es in {seconds} Sekunden erneut.',
  requestFailed: 'Die Anfrage ist fehlgeschlagen. Versuchen Sie es erneut.',
}

/** Russian page copy. */
export const authRu = {
  language: 'ru',
  subtitle: 'Используйте учётную запись и пароль, созданные на этой машине.',
  setupSubtitle: 'Выберите пароль, который будет защищать этот Host.',
  signingIn: 'Вход выполняется…',
  title: 'Вход в DeepSeek Harness',
  setupTitle: 'Задайте пароль для начала',
  usernameLabel: 'Имя учётной записи',
  passwordLabel: 'Пароль',
  confirmLabel: 'Подтвердите пароль',
  passwordMismatch: 'Пароли не совпадают.',
  rememberLabel: 'Запомнить меня',
  revealPassword: 'Показать пароль',
  failedAttempts: 'Подряд неудачных попыток: {count}.',
  wrongPassword: 'Текущий пароль неверен.',
  sessionExpired: 'Сессия истекла. Войдите снова.',
  changedPassword: 'Пароль обновлён.',
  revokedOthers: 'Другие устройства отключены.',
  signInButton: 'Войти',
  setupButton: 'Задать пароль',
  insecureNotice: 'Это соединение не шифруется.',
  wrongCredentials: 'Неверное имя учётной записи или пароль.',
  needSetup: 'Пароль ещё не задан. Задайте его, чтобы продолжить.',
  alreadySet: 'Пароль уже задан. Выполните вход.',
  passwordTooShort: 'Используйте пароль не менее 8 символов.',
  tooManyAttempts: 'Слишком много попыток. Повторите через {seconds} с.',
  requestFailed: 'Запрос выполнен с ошибкой. Повторите попытку.',
}

/** Portuguese page copy. */
export const authPt = {
  language: 'pt',
  subtitle: 'Use a conta e a senha criadas nesta máquina.',
  setupSubtitle: 'Escolha a senha que protegerá este Host.',
  signingIn: 'Entrando…',
  title: 'Entre no DeepSeek Harness',
  setupTitle: 'Defina uma senha para começar',
  usernameLabel: 'Nome da conta',
  passwordLabel: 'Senha',
  confirmLabel: 'Confirmar senha',
  passwordMismatch: 'As duas senhas não coincidem.',
  rememberLabel: 'Lembrar de mim',
  revealPassword: 'Mostrar a senha',
  failedAttempts: '{count} tentativas seguidas sem sucesso.',
  wrongPassword: 'A senha atual não está correta.',
  sessionExpired: 'Sua sessão expirou. Entre novamente.',
  changedPassword: 'Senha atualizada.',
  revokedOthers: 'Outros dispositivos foram desconectados.',
  signInButton: 'Entrar',
  setupButton: 'Definir senha',
  insecureNotice: 'Esta conexão não é criptografada.',
  wrongCredentials: 'O nome da conta ou a senha não está correto.',
  needSetup: 'Nenhuma senha foi definida. Defina uma para continuar.',
  alreadySet: 'Já existe uma senha definida. Entre.',
  passwordTooShort: 'Use uma senha com pelo menos 8 caracteres.',
  tooManyAttempts: 'Tentativas demais. Tente novamente em {seconds} segundos.',
  requestFailed: 'A solicitação falhou. Tente novamente.',
}

/** Copy of one supported language for the sign-in and setup surfaces. */
export type AuthMessages = typeof authEn

const DICTIONARIES: readonly { readonly tag: string; readonly messages: AuthMessages }[] = [
  { tag: 'en', messages: authEn },
  { tag: 'zh', messages: authZh },
  { tag: 'ja', messages: authJa },
  { tag: 'es', messages: authEs },
  { tag: 'fr', messages: authFr },
  { tag: 'de', messages: authDe },
  { tag: 'ru', messages: authRu },
  { tag: 'pt', messages: authPt },
]

/**
 * Select the page copy a browser should receive.
 * @param acceptLanguage - verbatim `Accept-Language` header value, if any.
 * @returns the first shipped language the header prefers, falling back to English.
 */
export function authMessagesFor(acceptLanguage: string | undefined): AuthMessages {
  if (acceptLanguage === undefined) return authEn
  for (const entry of acceptLanguage.split(',')) {
    const tag = entry.split(';')[0]?.trim().toLowerCase()
    if (tag === undefined || tag === '*') continue
    const matched = DICTIONARIES.find(dictionary => tag === dictionary.tag || tag.startsWith(`${dictionary.tag}-`))
    if (matched !== undefined) return matched.messages
  }
  return authEn
}

/**
 * Fill the seconds placeholder in one localized wait message.
 * @param template - text holding a `{seconds}` slot.
 * @param seconds - whole seconds to substitute.
 * @returns the text to show.
 */
export function withSeconds(template: string, seconds: number): string {
  return template.replaceAll('{seconds}', String(seconds))
}

/**
 * Fill the attempt-count placeholder in one localized notice.
 * @param template - text holding a `{count}` slot.
 * @param count - whole attempts to substitute.
 * @returns the text to show.
 */
export function withCount(template: string, count: number): string {
  return template.replaceAll('{count}', String(count))
}

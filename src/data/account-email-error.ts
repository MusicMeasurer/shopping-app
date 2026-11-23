/** User-facing Auth errors must not turn server or SMTP failures into network errors. */
export type AccountEmailAction = 'register' | 'recover' | 'verify' | 'resend' | 'password'

export function accountEmailErrorMessage(cause: unknown, action: AccountEmailAction): string {
  const issue = cause && typeof cause === 'object' ? cause as { code?: string; status?: number } : {}
  if (issue.status === 429 || issue.code === 'over_email_send_rate_limit')
    return 'Слишком много запросов. Подождите и попробуйте снова.'
  if (issue.code === 'weak_password')
    return 'Выберите более надёжный пароль.'
  if (action === 'password' && issue.code === 'same_password')
    return 'Выберите новый пароль, который отличается от прежнего.'
  if (issue.code === 'email_address_not_authorized' || issue.code === 'email_provider_disabled')
    return 'Сервис не может отправить письмо на этот адрес. Проверьте настройки почтового сервиса или используйте другой адрес.'
  if (issue.code === 'email_send_failed' || issue.code === 'smtp_error')
    return 'Почтовый сервис не смог отправить письмо. Повторите попытку позже.'

  if (typeof issue.status === 'number' && issue.status >= 500) {
    if (action === 'register') {
      return 'Сервер не смог выполнить регистрацию. Повторите попытку позже.'
    }
    if (action === 'verify') return 'Сервер не смог проверить код. Повторите попытку позже.'
    if (action === 'password') return 'Сервер не смог обновить пароль. Повторите попытку позже.'
    return 'Сервер не смог отправить письмо. Повторите попытку позже.'
  }
  if (typeof issue.status === 'number' && issue.status >= 400) {
    if (action === 'register') return 'Регистрация не удалась. Попробуйте позже или проверьте указанный адрес.'
    if (action === 'verify') return 'Не удалось проверить код. Запросите новый и повторите попытку.'
    if (action === 'password') return 'Не удалось обновить пароль. Повторите попытку.'
    return 'Не удалось запросить письмо. Повторите попытку позже.'
  }
  if (action === 'verify') return 'Не удалось подключиться для проверки кода. Проверьте интернет и повторите попытку.'
  if (action === 'password') return 'Не удалось подключиться для обновления пароля. Проверьте интернет и повторите попытку.'
  return 'Не удалось подключиться. Проверьте интернет и повторите попытку.'
}

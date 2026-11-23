import { describe, expect, it } from 'vitest'
import { accountEmailErrorMessage } from './account-email-error'

describe('account email failure classification', () => {
  it('explains verified post-deletion cooldown without calling an HTTP 500 a network error', () => {
    const issue = { status: 500, code: 'unexpected_failure', message: 'Database error saving new user' }
    const known = accountEmailErrorMessage(issue, 'register', true)
    expect(known).toContain('24 часа')
    expect(known).toContain('после завершения удаления')
    expect(known).not.toContain('интернет')
    const unknown = accountEmailErrorMessage(issue, 'register', false)
    expect(unknown).toContain('Сервер')
    expect(unknown).toContain('Если вы недавно удалили')
    expect(unknown).not.toContain('неверный email')
  })
  it('distinguishes email provider refusal, rate limits and transport problems', () => {
    expect(accountEmailErrorMessage({ status: 429, code: 'over_email_send_rate_limit' }, 'register')).toContain('Слишком много')
    expect(accountEmailErrorMessage({ status: 400, code: 'email_address_not_authorized' }, 'register')).toContain('отправить письмо')
    expect(accountEmailErrorMessage({ status: 500, code: 'smtp_error' }, 'recover')).toContain('Почтовый сервис')
    expect(accountEmailErrorMessage(new TypeError('Failed to fetch'), 'register')).toContain('интернет')
    expect(accountEmailErrorMessage({ status: 503 }, 'verify')).toContain('Сервер')
  })
  it('keeps password validation and does not reveal registered email identities', () => {
    expect(accountEmailErrorMessage({ status: 422, code: 'weak_password' }, 'register')).toContain('надёжный пароль')
    expect(accountEmailErrorMessage({ status: 422, code: 'same_password' }, 'password')).toContain('отличается')
    expect(accountEmailErrorMessage({ status: 422, code: 'unknown' }, 'register')).not.toContain('существует')
  })
})

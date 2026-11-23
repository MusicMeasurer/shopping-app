import { describe, expect, it } from 'vitest'
import { accountEmailErrorMessage } from './account-email-error'

describe('account email failure classification', () => {
  it('does not misreport an HTTP 500 as network failure or assume a deletion', () => {
    const issue = { status: 500, code: 'unexpected_failure', message: 'Database error saving new user' }
    const message = accountEmailErrorMessage(issue, 'register')
    expect(message).toContain('Сервер')
    expect(message).not.toContain('24 часа')
    expect(message).not.toContain('интернет')
    expect(message).not.toContain('неверный email')
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

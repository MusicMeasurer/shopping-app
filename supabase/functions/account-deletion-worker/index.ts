import { createClient } from 'npm:@supabase/supabase-js@2.119.0'
import nodemailer from 'npm:nodemailer@10.6.1'

interface MailJob {
  id: string
  kind: 'code' | 'reminder'
  email: string
  code: string | null
}

async function equalSecrets(candidate: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const hashes = await Promise.all([candidate, expected].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))))
  const [left, right] = hashes.map(hash => new Uint8Array(hash))
  let difference = 0
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i]
  return difference === 0
}

Deno.serve(async request => {
  if (request.method !== 'POST') return new Response(null, { status: 405 })
  const cronKey = Deno.env.get('ACCOUNT_DELETION_WORKER_KEY')
  if (!cronKey || cronKey.length < 32 ||
      !await equalSecrets(request.headers.get('authorization') ?? '', 'Bearer ' + cronKey))
    return new Response(null, { status: 401 })

  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return new Response(null, { status: 503 })
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await client.rpc('process_account_deletions')
  if (error) return new Response(null, { status: 503 })

  const sender = Deno.env.get('ACCOUNT_DELETION_SMTP_USER')
  const password = Deno.env.get('ACCOUNT_DELETION_SMTP_APP_PASSWORD')
  if (!sender || !password) return new Response(null, { status: 503 })
  const smtp = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: sender, pass: password },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
  })
  const lease = crypto.randomUUID()
  const { data, error: claimError } = await client.rpc('claim_account_deletion_mail', { p_lease: lease })
  if (claimError || !Array.isArray(data)) return new Response(null, { status: 503 })

  const deliveries = await Promise.allSettled((data as MailJob[]).map(async job => {
    const codeMail = job.kind === 'code'
    if (!codeMail) {
      const reserved = await client.rpc('reserve_account_deletion_reminder', { p_job: job.id, p_lease: lease })
      if (reserved.error) throw new Error('Reservation not confirmed')
      if (reserved.data !== true) return
    }

    try {
      await smtp.sendMail({
        from: { name: 'ShoppingApp', address: sender },
        to: job.email,
        messageId: '<shoppingapp-deletion-' + job.id + '@gmail.com>',
        subject: codeMail ? 'Код удаления аккаунта ShoppingApp' : 'Удалённый аккаунт ShoppingApp',
        text: codeMail
          ? 'Код подтверждения удаления аккаунта: ' + job.code + '. Он действует 10 минут. Если вы не запрашивали удаление, проигнорируйте письмо.'
          : 'Аккаунт удалён. Некоторые устройства ещё не подтвердили очистку локальных данных. Откройте ShoppingApp с интернетом на этих устройствах.',
      })
    } catch (cause) {
      const failure = cause as { responseCode?: number; command?: string }
      const explicitlyRejected = typeof failure.responseCode === 'number' &&
        failure.responseCode >= 400 && failure.responseCode < 600
      const beforeMessage = ['CONN', 'AUTH', 'MAIL FROM', 'RCPT TO'].includes(failure.command ?? '')
      if (!codeMail && (explicitlyRejected || beforeMessage))
        await client.rpc('retry_rejected_account_deletion_reminder', { p_job: job.id, p_lease: lease })
      throw new Error('Delivery not confirmed')
    }

    const result = await client.rpc('complete_account_deletion_mail', { p_job: job.id, p_lease: lease })
    if (result.error) throw new Error('Mail acknowledgment failed')
  }))
  return new Response(null, { status: deliveries.some(outcome => outcome.status === 'rejected') ? 503 : 204 })
})

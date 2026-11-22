import { useEffect, useState } from 'react'

export interface ListActionMessage {
  text: string
  at: number
}

export function ListActionNotice({ message }: { message: ListActionMessage }) {
  const [expired, setExpired] = useState(() => Date.now() - message.at >= 5000)
  useEffect(() => {
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, message.at + 5000 - Date.now()))
    return () => window.clearTimeout(timer)
  }, [message])
  return expired ? null : <div className="list-action-notice" role="status">{message.text}</div>
}

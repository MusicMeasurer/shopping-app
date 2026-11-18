export type ListKind = 'oneoff' | 'permanent'
export type CloudStatus = 'connected' | 'paused' | 'signed-out'

export const listKindLabels: Record<ListKind, string> = {
  oneoff: 'Разовый',
  permanent: 'Постоянный',
}

export function ListIndicators({ kind, cloudStatus, decorative = false }: { kind: ListKind; cloudStatus?: CloudStatus; decorative?: boolean }) {
  const paused = cloudStatus !== 'connected'
  return <span className="list-indicators">
    <svg role={decorative ? undefined : "img"} aria-hidden={decorative || undefined} aria-label={decorative ? undefined : listKindLabels[kind] + ' список'} viewBox="0 0 24 24">
      {kind === 'oneoff'
        ? <path d="M6 3h12M6 21h12M7 3v3c0 2 2 4 5 6-3 2-5 4-5 6v3M17 3v3c0 2-2 4-5 6 3 2 5 4 5 6v3"/>
        : <path d="M20 10a8 8 0 0 0-14-4L3 9m0-5v5h5m-4 5a8 8 0 0 0 14 4l3-3m0 5v-5h-5"/>}
    </svg>
    {cloudStatus && <svg role="img" aria-label={paused ? 'Облачный список, синхронизация приостановлена' : 'Облачный список'}
      viewBox="0 0 24 24">
      <path d="M6 19a4.5 4.5 0 0 1-.5-8.97 6.5 6.5 0 0 1 12.48 1.45A3.8 3.8 0 0 1 18 19Z"/>
      {paused && <path d="M10 12v4m4-4v4"/>}
    </svg>}
  </span>
}

const namespace: string | undefined = import.meta.env.VITE_STORAGE_NAMESPACE

export function storageKey(key: string): string {
  return namespace ? namespace + ':' + key : key
}

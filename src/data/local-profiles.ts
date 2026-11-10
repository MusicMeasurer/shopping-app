/** Local profile metadata is independent of a cloud session. Never store credentials here. */
export interface LocalProfile {
  id: string
  cloudAccountId: string | null
  createdAt: number
}
export interface LocalProfileRegistry {
  profiles: LocalProfile[]
  activeProfileId: string
}
export function initializeProfiles(id: string, createdAt: number): LocalProfileRegistry {
  if (!id.trim() || !Number.isFinite(createdAt)) throw new Error('Valid local profile identity required')
  return { profiles: [{ id, cloudAccountId: null, createdAt }], activeProfileId: id }
}
export function activeProfile(registry: LocalProfileRegistry): LocalProfile {
  const profile = registry.profiles.find(p => p.id === registry.activeProfileId)
  if (!profile) throw new Error('Active local profile is missing')
  return profile
}
export function switchProfile(registry: LocalProfileRegistry, profileId: string): LocalProfileRegistry {
  if (!registry.profiles.some(p => p.id === profileId)) throw new Error('Unknown local profile')
  return { ...registry, activeProfileId: profileId }
}
/** Bind only an unclaimed profile, never reassign one account's data to another. */
export function bindProfile(registry: LocalProfileRegistry, profileId: string, verifiedAccountId: string): LocalProfileRegistry {
  if (!verifiedAccountId.trim()) throw new Error('Verified account required')
  const target = registry.profiles.find(p => p.id === profileId)
  if (!target) throw new Error('Unknown local profile')
  if (target.cloudAccountId && target.cloudAccountId !== verifiedAccountId) throw new Error('Profile belongs to another account')
  if (registry.profiles.some(p => p.id !== profileId && p.cloudAccountId === verifiedAccountId)) throw new Error('Account already has a local profile')
  return { ...registry, profiles: registry.profiles.map(p => p.id === profileId ? { ...p, cloudAccountId: verifiedAccountId } : p) }
}
/** Never reuse an existing profile ID or silently replace its contents. */
export function addProfile(registry: LocalProfileRegistry, profile: LocalProfile): LocalProfileRegistry {
  if (!profile.id.trim() || registry.profiles.some(p => p.id === profile.id)) throw new Error('Duplicate or empty local profile ID')
  if (!Number.isFinite(profile.createdAt)) throw new Error('Valid profile creation timestamp required')
  if (profile.cloudAccountId !== null && !profile.cloudAccountId.trim()) throw new Error('Valid cloud account identity required')
  if (profile.cloudAccountId && registry.profiles.some(p => p.cloudAccountId === profile.cloudAccountId)) throw new Error('Duplicate cloud account')
  return { profiles: [...registry.profiles, profile], activeProfileId: profile.id }
}
/** Metadata-only removal. The caller must confirm and safely purge scoped data first. */
export function removeProfileMetadata(registry: LocalProfileRegistry, profileId: string): LocalProfileRegistry {
  if (!registry.profiles.some(p => p.id === profileId)) throw new Error('Unknown local profile')
  const profiles = registry.profiles.filter(p => p.id !== profileId)
  if (!profiles.length) throw new Error('Cannot remove the last local profile')
  return { profiles, activeProfileId: registry.activeProfileId === profileId ? profiles[0].id : registry.activeProfileId }
}

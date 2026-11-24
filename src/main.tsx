import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { AuthenticatedApp } from './AuthenticatedApp'
import { createCloudClient } from './data/cloud-client'
import { createStorage } from './data/storage'
import './style.css'
// Track the initiating input across programmatic dialog autofocus and focus
// restoration. Native focus-visible remains the default before interaction.
document.addEventListener('pointerdown', () => {
  document.documentElement.dataset.inputModality = 'pointer'
}, { capture: true, passive: true })
document.addEventListener('keydown', event => {
  if (['Tab', 'Enter', ' ', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key))
    document.documentElement.dataset.inputModality = 'keyboard'
}, { capture: true })
registerSW({ immediate: true })
const storage = createStorage()
const client = createCloudClient()
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthenticatedApp storage={storage} client={client} /></React.StrictMode>)

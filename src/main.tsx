import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { AuthenticatedApp } from './AuthenticatedApp'
import { createCloudClient } from './data/cloud-client'
import { createStorage } from './data/storage'
import './style.css'
registerSW({ immediate: true })
const storage = createStorage()
const client = createCloudClient()
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthenticatedApp storage={storage} client={client} /></React.StrictMode>)

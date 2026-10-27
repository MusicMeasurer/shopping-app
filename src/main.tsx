import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'
import { createStorage } from './data/storage'
import './style.css'
registerSW({ immediate: true })
const storage = createStorage()
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App storage={storage}/></React.StrictMode>)

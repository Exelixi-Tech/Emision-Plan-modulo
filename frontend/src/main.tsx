import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import './lib/bridge'
import { NexusGuard } from './nexus/NexusGuard'
import { applyExelixiBranding } from './lib/exelixi-branding'
import { hydrateTarjetaHandoff, hydrateTarjetaMetadataCanal, isTarjetaRcvFlow, markTarjetaPublicSession } from './lib/rcv-tarjeta-flow'

import { EmisionConfigPanel } from './config/EmisionConfigPanel'
import { EmisionRevisionPanel } from './config/EmisionRevisionPanel'

// Identidad Exélixi (colores + favicon) solo si el flujo activo es el catálogo.
applyExelixiBranding('Emisión');

if (isTarjetaRcvFlow()) {
  markTarjetaPublicSession();
  hydrateTarjetaHandoff();
  hydrateTarjetaMetadataCanal();
}

// /config y /revision: index.html redirige a ?view= para que los assets no 404en con base relativa.
const viewParam = new URL(window.location.href).searchParams.get('view');
const isConfigRoute = /\/config(\/preguntas)?\/?$/i.test(window.location.pathname)
  || viewParam === 'preguntas'
  || viewParam === 'config';
const isRevisionRoute = /\/revision\/?$/.test(window.location.pathname) || viewParam === 'revision';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isConfigRoute ? (
      <EmisionConfigPanel />
    ) : isRevisionRoute ? (
      <EmisionRevisionPanel />
    ) : (
      <NexusGuard recheckInterval={30}>
        <App />
      </NexusGuard>
    )}
  </StrictMode>,
)

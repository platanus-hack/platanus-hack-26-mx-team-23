// Content script: injects the Overlai overlay React root over the page <video>
// and handles messages from the popup.

import React from 'react'
import ReactDOM from 'react-dom/client'
import { Overlay } from './Overlay'

// The overlay root element (created once).
let overlayRoot: ReactDOM.Root | null = null

function mount() {
  // Avoid double-mounting
  if (document.getElementById('overlai-root')) return

  const container = document.createElement('div')
  container.id = 'overlai-root'
  container.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 2147483647;
  `
  document.body.appendChild(container)

  overlayRoot = ReactDOM.createRoot(container)
  overlayRoot.render(React.createElement(Overlay))
}

// Mount immediately if DOM is ready, otherwise wait.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount)
} else {
  mount()
}

// Listen for text messages from the popup.
// The popup calls chrome.tabs.sendMessage({ type: 'OVERLAI_TEXT', text }).
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'OVERLAI_TEXT' && typeof message.text === 'string') {
    // Dispatch a custom event that Overlay.tsx can listen to.
    window.dispatchEvent(
      new CustomEvent('overlai:query', { detail: { text: message.text } })
    )
  }
})

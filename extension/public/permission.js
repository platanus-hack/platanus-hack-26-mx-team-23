// Overlai microphone permission page (plain JS in public/, opened as a real tab).
//
// A Chrome MV3 popup/offscreen cannot show the getUserMedia permission prompt, so
// we ask from this visible extension page. Once granted, the permission is stored
// for the extension origin and inherited by the offscreen recorder.

const enableBtn = document.getElementById('enable')
const statusEl = document.getElementById('status')

function setStatus(text, kind) {
  statusEl.textContent = text
  statusEl.className = 'status' + (kind ? ' ' + kind : '')
}

async function requestMic() {
  enableBtn.disabled = true
  setStatus('Solicitando acceso...', '')
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    // We only needed the grant — release the device immediately.
    stream.getTracks().forEach((t) => t.stop())
    setStatus('Micrófono habilitado. Ya puedes cerrar esta pestaña y usar Overlai.', 'ok')
    enableBtn.textContent = 'Listo'
  } catch (err) {
    const name = (err && err.name) || ''
    enableBtn.disabled = false
    enableBtn.textContent = 'Reintentar'
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      setStatus(
        'Permiso denegado. Ábrelo desde el candado de la barra de direcciones → Micrófono → Permitir, y reintenta.',
        'err'
      )
    } else if (name === 'NotFoundError') {
      setStatus('No se detectó ningún micrófono conectado.', 'err')
    } else {
      setStatus('Error: ' + (err && err.message ? err.message : String(err)), 'err')
    }
  }
}

enableBtn.addEventListener('click', requestMic)

// Auto-attempt on load: if the permission is already granted this resolves
// silently; otherwise Chrome shows the prompt right away.
requestMic()

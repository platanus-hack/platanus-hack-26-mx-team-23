// Ensures the Klai content script is present in a tab before we message it.
//
// The content script is declared in the manifest, so it auto-injects on page LOAD.
// But tabs that were already open before the extension was installed/reloaded don't
// have it — sending KLAI_TEXT there silently no-ops ("Receiving end does not
// exist"). This pings the tab and, if there's no receiver, injects the content
// script programmatically (requires the `scripting` permission, already granted)
// and retries the ping. Used by both the popup and the service worker.

export async function ensureContentScript(tabId: number): Promise<void> {
  if (await ping(tabId)) return

  const files = chrome.runtime.getManifest().content_scripts?.[0]?.js ?? []
  if (files.length === 0) return

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files })
  } catch (err) {
    // chrome:// pages, the web store, and other protected tabs can't be injected.
    console.warn('[Klai] could not inject content script into tab', tabId, err)
    return
  }

  // Give the freshly-injected script a moment to register its message listener.
  await new Promise((r) => setTimeout(r, 100))
  await ping(tabId)
}

async function ping(tabId: number): Promise<boolean> {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'KLAI_PING' })
    return res?.ok === true
  } catch {
    return false
  }
}

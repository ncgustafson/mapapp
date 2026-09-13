import * as Cesium from 'cesium'
import { createRoot } from 'react-dom/client'
import { App } from './App'

const ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined

const rootEl = document.querySelector<HTMLDivElement>('#app')!

if (!ionToken) {
  rootEl.innerHTML = `
    <div style="font-family: sans-serif; padding: 2rem; max-width: 640px; margin: 0 auto;">
      <h1>Missing Cesium ion access token</h1>
      <p>Create a free token at <a href="https://ion.cesium.com/tokens" target="_blank">ion.cesium.com/tokens</a>,
      then create a <code>.env</code> file in the project root with:</p>
      <pre>VITE_CESIUM_ION_TOKEN=your_token_here</pre>
      <p>Restart the dev server after adding it.</p>
    </div>
  `
  throw new Error('Missing VITE_CESIUM_ION_TOKEN')
}

Cesium.Ion.defaultAccessToken = ionToken

createRoot(rootEl).render(<App />)

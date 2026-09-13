import { MapView } from './cesium/MapView'
import { Sidebar } from './ui/Sidebar'
import './ui/ui.css'

export function App() {
  return (
    <div className="app-root">
      <MapView>
        <Sidebar />
      </MapView>
    </div>
  )
}

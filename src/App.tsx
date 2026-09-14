import { MapView } from './cesium/MapView'
import { Sidebar } from './ui/Sidebar'
// PlaceLabelsLayer (src/places/) is on hold — Overpass's public server
// started refusing our connections during development. Revisit with a more
// reliable data source (e.g. GeoNames) later.
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

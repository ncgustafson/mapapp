import { BasemapProvider } from './basemaps/BasemapContext'
import { MapView } from './cesium/MapView'
import { SceneModeToggle } from './cesium/SceneModeToggle'
import { DrawingLayer } from './routes/DrawingLayer'
import { RouteProvider } from './routes/RouteContext'
import { RoutePopup } from './routes/RoutePopup'
import { MapLayersPanel } from './ui/MapLayersPanel'
import { Sidebar } from './ui/Sidebar'
// PlaceLabelsLayer (src/places/) is on hold — Overpass's public server
// started refusing our connections during development. Revisit with a more
// reliable data source (e.g. GeoNames) later.
import './ui/ui.css'

export function App() {
  return (
    <div className="app-root">
      <MapView>
        <BasemapProvider>
          <RouteProvider>
            <DrawingLayer />
            <RoutePopup />
            <Sidebar />
            <MapLayersPanel />
            <SceneModeToggle />
          </RouteProvider>
        </BasemapProvider>
      </MapView>
    </div>
  )
}

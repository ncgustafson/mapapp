import { BasemapProvider } from './basemaps/BasemapContext'
import { MapView } from './cesium/MapView'
import { SceneModeToggle } from './cesium/SceneModeToggle'
import { ClimbingLayer } from './climbing/ClimbingLayer'
import { ClimbingPopup } from './climbing/ClimbingPopup'
import { ClimbingProvider } from './climbing/ClimbingContext'
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
          <ClimbingProvider>
            <RouteProvider>
              <DrawingLayer />
              <RoutePopup />
              <ClimbingLayer />
              <ClimbingPopup />
              <Sidebar />
              <MapLayersPanel />
              <SceneModeToggle />
            </RouteProvider>
          </ClimbingProvider>
        </BasemapProvider>
      </MapView>
    </div>
  )
}

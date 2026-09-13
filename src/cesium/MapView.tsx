import { useEffect, useRef, useState } from 'react'
import type * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { createViewer } from './createViewer'
import { CesiumContext } from './CesiumContext'

export function MapView({ children }: { children?: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [viewer, setViewer] = useState<Cesium.Viewer | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    let cancelled = false
    let viewerInstance: Cesium.Viewer | null = null

    createViewer(containerRef.current).then((v) => {
      if (cancelled) {
        v.destroy()
        return
      }
      viewerInstance = v
      setViewer(v)
    })

    return () => {
      cancelled = true
      viewerInstance?.destroy()
    }
  }, [])

  return (
    <>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      <CesiumContext.Provider value={viewer}>{children}</CesiumContext.Provider>
    </>
  )
}

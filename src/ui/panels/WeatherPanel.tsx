import { useState } from 'react'
import { GraphicalTab } from './weather/GraphicalTab'
import { WeeklyTab } from './weather/WeeklyTab'
import { MountainTab } from './weather/MountainTab'
import { ModelsTab } from './weather/ModelsTab'

type WeatherTabKey = 'graphical' | 'weekly' | 'mountain' | 'models'

const TABS: { key: WeatherTabKey; label: string }[] = [
  { key: 'graphical', label: 'NOAA Graphical' },
  { key: 'weekly', label: 'NOAA Weekly' },
  { key: 'mountain', label: 'Mountain Forecast' },
  { key: 'models', label: 'Weather Models' },
]

export function WeatherPanel() {
  const [active, setActive] = useState<WeatherTabKey>('graphical')

  return (
    <div className="panel">
      <h2>Weather</h2>

      <div className="weather-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`weather-tab ${active === tab.key ? 'active' : ''}`}
            onClick={() => setActive(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {active === 'graphical' && <GraphicalTab />}
      {active === 'weekly' && <WeeklyTab />}
      {active === 'mountain' && <MountainTab />}
      {active === 'models' && <ModelsTab />}
    </div>
  )
}

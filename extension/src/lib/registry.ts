import React from 'react'
import { ScoreboardWidget } from '../widgets/Scoreboard'
import { TimerWidget } from '../widgets/Timer'
import { StatPanelWidget } from '../widgets/StatPanel'
import { AlertWidget } from '../widgets/Alert'
import { MomentumWidget } from '../widgets/Momentum'
import { InfoCardWidget } from '../widgets/InfoCard'
import { KeyPointsWidget } from '../widgets/KeyPoints'
import { DefinitionWidget } from '../widgets/Definition'

// delay is the optional stagger offset passed by the Overlay choreography layer.
type WidgetComponent = React.ComponentType<{ data: any; delay?: number }>

const registry: Record<string, WidgetComponent> = {
  scoreboard: ScoreboardWidget,
  timer: TimerWidget,
  statpanel: StatPanelWidget,
  alert: AlertWidget,
  momentum: MomentumWidget,
  infocard: InfoCardWidget,
  keypoints: KeyPointsWidget,
  definition: DefinitionWidget,
}

export function getWidget(type: string): WidgetComponent | null {
  return registry[type] ?? null
}

import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

const base: IconProps = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export function IconEye(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M1.5 12s4-7.5 10.5-7.5S22.5 12 22.5 12s-4 7.5-10.5 7.5S1.5 12 1.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export function IconEyeOff(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.2A10.6 10.6 0 0 1 12 5c6.5 0 10.5 7 10.5 7a13.4 13.4 0 0 1-3.1 3.9M6.6 6.6C3.8 8.3 1.5 12 1.5 12s4 7 10.5 7c1.4 0 2.7-.3 3.8-.8" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  )
}

export function IconTrash(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 6.5h17" />
      <path d="M8.5 6.5V4.75A1.25 1.25 0 0 1 9.75 3.5h4.5a1.25 1.25 0 0 1 1.25 1.25V6.5" />
      <path d="M6.5 6.5l1 13.25a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l1-13.25" />
      <path d="M10 10.5v6.5M14 10.5v6.5" />
    </svg>
  )
}

export function IconLine(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 19L19 4.5" />
      <circle cx="4" cy="19" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="19" cy="4.5" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconPoint(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 21.5s7-6.4 7-12A7 7 0 0 0 5 9.5c0 5.6 7 12 7 12Z" />
      <circle cx="12" cy="9.5" r="2.3" />
    </svg>
  )
}

export function IconPolygon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.5l8 5.7-3 9.3H7l-3-9.3z" />
    </svg>
  )
}

export function IconChart(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 20.5h18" />
      <path d="M3 16.5l4.5-6 4 4.5L18 6l3 4" />
    </svg>
  )
}

export function IconLayers(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3l9 5-9 5-9-5 9-5Z" />
      <path d="M3 13l9 5 9-5" />
      <path d="M3 18l9 5 9-5" />
    </svg>
  )
}

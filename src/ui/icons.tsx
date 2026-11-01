import type { DeviceIcon } from '../sim/types';

/** Device artwork, drawn centered on (0,0) in a ~44px box. Defaults to the surrounding CSS `color`. */
export function DeviceGlyph({ icon, color = 'currentColor' }: { icon: DeviceIcon; color?: string }) {
  const s = { fill: 'none', stroke: color, 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as const;
  switch (icon) {
    case 'laptop':
      return (
        <g {...s}>
          <rect x={-15} y={-12} width={30} height={20} rx={2.5} />
          <path d="M-20 12 H20 L17 16 H-17 Z" />
        </g>
      );
    case 'attacker':
      return (
        <g {...s}>
          <rect x={-15} y={-8} width={30} height={18} rx={2.5} />
          <path d="M-20 14 H20 L17 18 H-17 Z" />
          {/* hood */}
          <path d="M-9 -8 C-9 -22 9 -22 9 -8" />
          <circle cx={-3.5} cy={-12} r={1.2} fill={color} />
          <circle cx={3.5} cy={-12} r={1.2} fill={color} />
        </g>
      );
    case 'phone':
      return (
        <g {...s}>
          <rect x={-9} y={-16} width={18} height={32} rx={3.5} />
          <line x1={-3} y1={11} x2={3} y2={11} />
        </g>
      );
    case 'desktop':
      return (
        <g {...s}>
          <rect x={-16} y={-14} width={32} height={22} rx={2} />
          <line x1={0} y1={8} x2={0} y2={14} />
          <line x1={-8} y1={15} x2={8} y2={15} />
        </g>
      );
    case 'server':
      return (
        <g {...s}>
          <rect x={-13} y={-17} width={26} height={10} rx={2} />
          <rect x={-13} y={-5} width={26} height={10} rx={2} />
          <rect x={-13} y={7} width={26} height={10} rx={2} />
          <circle cx={-7} cy={-12} r={1.2} fill={color} />
          <circle cx={-7} cy={0} r={1.2} fill={color} />
          <circle cx={-7} cy={12} r={1.2} fill={color} />
        </g>
      );
    case 'router':
      return (
        <g {...s}>
          <ellipse cx={0} cy={4} rx={18} ry={8} />
          <path d="M-18 4 V-3" />
          <path d="M18 4 V-3" />
          <ellipse cx={0} cy={-3} rx={18} ry={8} />
          <path d="M-7 -3 H7 M3 -6 L7 -3 L3 0" />
        </g>
      );
    case 'isp':
      return (
        <g {...s}>
          <circle cx={0} cy={0} r={16} />
          <ellipse cx={0} cy={0} rx={7} ry={16} />
          <line x1={-16} y1={0} x2={16} y2={0} />
          <path d="M-13 -8 H13 M-13 8 H13" />
        </g>
      );
    case 'switch':
      return (
        <g {...s}>
          <rect x={-19} y={-9} width={38} height={18} rx={3} />
          <path d="M-10 -3 H8 M4 -6 L8 -3 L4 0" />
          <path d="M10 3 H-8 M-4 0 L-8 3 L-4 6" />
        </g>
      );
    case 'hub':
      return (
        <g {...s}>
          <rect x={-19} y={-8} width={38} height={16} rx={3} />
          <circle cx={-10} cy={0} r={1.6} fill={color} />
          <circle cx={-3} cy={0} r={1.6} fill={color} />
          <circle cx={4} cy={0} r={1.6} fill={color} />
          <circle cx={11} cy={0} r={1.6} fill={color} />
        </g>
      );
    case 'wifi':
      return (
        <g {...s}>
          <path d="M-17 -4 C-7 -14 7 -14 17 -4" />
          <path d="M-11 2 C-4 -5 4 -5 11 2" />
          <path d="M-5 8 C-2 5 2 5 5 8" />
          <circle cx={0} cy={13} r={1.8} fill={color} />
        </g>
      );
    case 'cloud':
      return (
        <g {...s}>
          <path d="M-12 12 H13 A9 9 0 0 0 12 -6 A12 12 0 0 0 -10 -6 A9 9 0 0 0 -12 12 Z" />
        </g>
      );
    case 'firewall':
      return (
        <g {...s}>
          <rect x={-16} y={-14} width={32} height={28} rx={2} />
          <path d="M-16 -5 H16 M-16 5 H16 M-6 -14 V-5 M6 -5 V5 M-6 5 V14" />
        </g>
      );
  }
}

/** Small UI icons (16px), stroke-based. */
export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const p = { fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as const;
  const paths: Record<string, preact.JSX.Element> = {
    play: <path d="M7 5 L19 12 L7 19 Z" fill="currentColor" stroke="none" />,
    pause: (
      <g fill="currentColor" stroke="none">
        <rect x={6} y={5} width={4} height={14} rx={1} />
        <rect x={14} y={5} width={4} height={14} rx={1} />
      </g>
    ),
    reset: <path d="M4 12 A8 8 0 1 0 7 6 M4 3 V8 H9" {...p} />,
    check: <path d="M5 12 L10 17 L19 7" {...p} />,
    x: <path d="M6 6 L18 18 M18 6 L6 18" {...p} />,
    chevronLeft: <path d="M15 5 L8 12 L15 19" {...p} />,
    chevronRight: <path d="M9 5 L16 12 L9 19" {...p} />,
    chevronDown: <path d="M5 9 L12 16 L19 9" {...p} />,
    eye: (
      <g {...p}>
        <path d="M2 12 C5 6 19 6 22 12 C19 18 5 18 2 12 Z" />
        <circle cx={12} cy={12} r={3} />
      </g>
    ),
    arrows: <path d="M4 8 H18 M14 4 L18 8 L14 12 M20 16 H6 M10 12 L6 16 L10 20" {...p} />,
    shield: <path d="M12 3 L20 6 V12 C20 17 16 20 12 21 C8 20 4 17 4 12 V6 Z" {...p} />,
    lock: (
      <g {...p}>
        <rect x={5} y={11} width={14} height={10} rx={2} />
        <path d="M8 11 V8 A4 4 0 0 1 16 8 V11" />
      </g>
    ),
    unlock: (
      <g {...p}>
        <rect x={5} y={11} width={14} height={10} rx={2} />
        <path d="M8 11 V8 A4 4 0 0 1 15.5 6" />
      </g>
    ),
    warn: (
      <g {...p}>
        <path d="M12 3 L22 20 H2 Z" />
        <path d="M12 10 V14 M12 17 V17.5" />
      </g>
    ),
    list: <path d="M9 6 H20 M9 12 H20 M9 18 H20 M4 6 H5 M4 12 H5 M4 18 H5" {...p} />,
    bolt: <path d="M13 2 L4 14 H12 L11 22 L20 10 H12 Z" {...p} />,
    send: <path d="M3 11 L21 3 L13 21 L11 13 Z" {...p} />,
    cloud: <path d="M7 18 H17 A4 4 0 0 0 17 10 A6 6 0 0 0 6 9 A4.5 4.5 0 0 0 7 18 Z" {...p} />,
    cloudOff: (
      <g {...p}>
        <path d="M7 18 H17 A4 4 0 0 0 17 10 A6 6 0 0 0 6 9 A4.5 4.5 0 0 0 7 18 Z" />
        <path d="M3 3 L21 21" />
      </g>
    ),
    save: <path d="M5 4 H16 L20 8 V20 H4 V4 Z M8 4 V9 H15 V4 M8 20 V14 H16 V20" {...p} />,
    download: <path d="M12 4 V16 M7 11 L12 16 L17 11 M5 20 H19" {...p} />,
    upload: <path d="M12 16 V4 M7 9 L12 4 L17 9 M5 20 H19" {...p} />,
    print: (
      <g {...p}>
        <path d="M7 9 V3 H17 V9" />
        <rect x={3} y={9} width={18} height={8} rx={2} />
        <path d="M7 14 H17 V21 H7 Z" />
      </g>
    ),
    user: (
      <g {...p}>
        <circle cx={12} cy={8} r={4} />
        <path d="M4 21 C5 16 19 16 20 21" />
      </g>
    ),
    home: <path d="M3 11 L12 3 L21 11 M6 9 V21 H18 V9" {...p} />,
    hint: (
      <g {...p}>
        <path d="M9 18 H15 M10 21 H14 M12 3 A6 6 0 0 0 8 14 V16 H16 V14 A6 6 0 0 0 12 3 Z" />
      </g>
    ),
    flag: <path d="M5 21 V4 M5 4 H17 L14 8 L17 12 H5" {...p} />,
    target: (
      <g {...p}>
        <circle cx={12} cy={12} r={8} />
        <circle cx={12} cy={12} r={3} />
      </g>
    ),
    sun: (
      <g {...p}>
        <circle cx={12} cy={12} r={4} />
        <path d="M12 2 V4 M12 20 V22 M2 12 H4 M20 12 H22 M4.9 4.9 L6.3 6.3 M17.7 17.7 L19.1 19.1 M4.9 19.1 L6.3 17.7 M17.7 6.3 L19.1 4.9" />
      </g>
    ),
    moon: <path d="M20 14.5 A8 8 0 1 1 9.5 4 A6.5 6.5 0 0 0 20 14.5 Z" {...p} />,
    /** Watch a step again. */
    replay: (
      <g {...p}>
        <path d="M4 12 A8 8 0 1 0 7 5.8 M4 3 V8 H9" />
        <path d="M10 9 L15 12 L10 15 Z" fill="currentColor" />
      </g>
    ),
    /** Loop a replay. */
    repeat: <path d="M4 11 V9 A3 3 0 0 1 7 6 H19 M16 3 L19 6 L16 9 M20 13 V15 A3 3 0 0 1 17 18 H5 M8 21 L5 18 L8 15" {...p} />,
    /** The lab guide. */
    book: <path d="M4 5 A2 2 0 0 1 6 3 H11 A1 1 0 0 1 12 4 V20 A2 2 0 0 0 10 18 H4 Z M20 5 A2 2 0 0 0 18 3 H13 A1 1 0 0 0 12 4 V20 A2 2 0 0 1 14 18 H20 Z" {...p} />,
    trophy: (
      <g {...p}>
        <path d="M8 4 H16 V9 A4 4 0 0 1 8 9 Z" />
        <path d="M8 6 H5 A2 2 0 0 0 8 10 M16 6 H19 A2 2 0 0 1 16 10 M12 13 V17 M8 20 H16 M9 20 L10 17 H14 L15 20" />
      </g>
    ),
    /** A network cable's plug. */
    cable: <path d="M9 3 V7 M15 3 V7 M6 7 H18 V11 A6 6 0 0 1 12 17 A6 6 0 0 1 6 11 Z M12 17 V22" {...p} />,
    /** Ping: a pulse going out and coming back. */
    ping: <path d="M2 12 H7 L9.5 6 L14.5 18 L17 12 H22" {...p} />,
    /** Device settings. */
    sliders: <path d="M4 6 H13 M17 6 H20 M15 4 V8 M4 12 H6 M10 12 H20 M8 10 V14 M4 18 H12 M16 18 H20 M14 16 V20" {...p} />,
    info: (
      <g {...p}>
        <circle cx={12} cy={12} r={9} />
        <path d="M12 11 V16 M12 8 V8.5" />
      </g>
    ),
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" class="icon">
      {paths[name] ?? null}
    </svg>
  );
}

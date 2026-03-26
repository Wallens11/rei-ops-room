export const ROOM_LAYOUT = {
  canvas: {
    width: 640,
    height: 420,
    wall_height: 220,
    floor_top: 220
  },
  hallway: {
    center: { x: 322, y: 228 }
  },
  desk_base: {
    rects: [
      { x: -58, y: 26, w: 116, h: 10, fill: "desk_shadow" },
      { x: -52, y: -8, w: 104, h: 18, fill: "accent" },
      { x: -46, y: -2, w: 92, h: 12, fill: "bg1" },
      { x: -34, y: 10, w: 12, h: 28, fill: "bg1" },
      { x: 22, y: 10, w: 12, h: 28, fill: "bg1" },
      { x: -60, y: -12, w: 120, h: 4, fill_active: "accent", fill_inactive: "transparent" }
    ]
  },
  rest_corner: {
    id: "rest_corner",
    title: "Recharge Nook",
    origin: { x: 322, y: 112 },
    hotspot: { x: -50, y: -24, width: 112, height: 56 },
    rects: [
      { x: -76, y: -26, w: 152, h: 56, fill_active: "rest_glow", fill_inactive: "rest_glow_idle" },
      { x: -62, y: 2, w: 54, h: 18, fill_active: "rest_accent", fill_inactive: "rest_surface" },
      { x: -62, y: -8, w: 54, h: 12, fill: "bg1" },
      { x: -8, y: 2, w: 22, h: 14, fill: "violet" },
      { x: 20, y: -2, w: 16, h: 18, fill: "amber" },
      { x: 24, y: -14, w: 8, h: 12, fill: "white" },
      { x: 42, y: 0, w: 22, h: 12, fill: "bg1" },
      { x: 48, y: -10, w: 8, h: 10, fill: "white" },
      { x: -54, y: -16, w: 26, h: 4, fill_active: "violet", fill_inactive: "transparent" },
      { x: 28, y: -18, w: 18, h: 4, fill_active: "cyan", fill_inactive: "transparent" }
    ]
  },
  props: {
    planning_board: {
      id: "planning_board",
      origin: { x: 268, y: 44 },
      hotspot: { x: -2, y: 0, width: 108, height: 54 },
      rects: [
        { x: 0, y: 0, w: 104, h: 52, fill: "board_glow" },
        { x: 10, y: 8, w: 84, h: 36, fill: "ink" },
        { x: 16, y: 14, w: 24, h: 4, fill: "cyan" },
        { x: 46, y: 14, w: 18, h: 4, fill: "amber" },
        { x: 70, y: 14, w: 14, h: 4, fill: "rose" },
        { x: 16, y: 24, w: 48, h: 4, fill: "white" },
        { x: 16, y: 32, w: 60, h: 4, fill: "violet" }
      ]
    },
    status_monitor: {
      id: "status_monitor",
      origin: { x: 520, y: 32 },
      hotspot: { x: 0, y: 0, width: 64, height: 34 },
      rects: [
        { x: 0, y: 0, w: 62, h: 32, fill: "ink" },
        { x: 6, y: 6, w: 50, h: 18, fill: "monitor_lit" },
        { x: 14, y: 28, w: 34, h: 4, fill: "bg1" }
      ]
    },
    tool_rack: {
      id: "tool_rack",
      origin: { x: 548, y: 176 },
      hotspot: { x: 0, y: 0, width: 34, height: 68 },
      rects: [
        { x: 0, y: 0, w: 30, h: 64, fill: "bg1" },
        { x: 4, y: 8, w: 22, h: 4, fill: "white" },
        { x: 4, y: 22, w: 22, h: 4, fill: "white" },
        { x: 4, y: 36, w: 22, h: 4, fill: "white" },
        { x: 4, y: 50, w: 22, h: 4, fill: "white" },
        { x: 10, y: 62, w: 8, h: 4, fill: "rack_pulse" }
      ]
    },
    document_tray: {
      id: "document_tray",
      origin: { x: 468, y: 230 },
      hotspot: { x: 0, y: 0, width: 40, height: 28 },
      rects: [
        { x: 0, y: 0, w: 38, h: 26, fill: "white" },
        { x: 6, y: 6, w: 24, h: 4, fill: "bg2" },
        { x: 6, y: 14, w: 18, h: 4, fill: "rose" }
      ]
    }
  },
  furniture: {
    frontend: {
      rects: [
        { x: -20, y: -44, w: 40, h: 28, fill: "ink" },
        { x: -14, y: -38, w: 28, h: 16, fill: "zone" },
        { x: -10, y: -34, w: 8, h: 4, fill: "white" },
        { x: 0, y: -34, w: 10, h: 4, fill: "rose" },
        { x: -6, y: -26, w: 18, h: 4, fill: "mint" },
        { x: -4, y: -16, w: 8, h: 8, fill: "ink" }
      ]
    },
    backend: {
      rects: [
        { x: -22, y: -48, w: 44, h: 40, fill: "ink" },
        { x: -16, y: -40, w: 32, h: 4, fill: "bg2" },
        { x: 6, y: -40, w: 4, h: 4, fill: "backend_led_a" },
        { x: -16, y: -32, w: 32, h: 4, fill: "bg2" },
        { x: 6, y: -32, w: 4, h: 4, fill: "backend_led_b" },
        { x: -16, y: -24, w: 32, h: 4, fill: "bg2" },
        { x: 6, y: -24, w: 4, h: 4, fill: "backend_led_a" },
        { x: -16, y: -16, w: 32, h: 4, fill: "bg2" },
        { x: 6, y: -16, w: 4, h: 4, fill: "backend_led_b" }
      ]
    },
    database: {
      rects: [
        { x: -28, y: -44, w: 56, h: 10, fill: "amber" },
        { x: -28, y: -34, w: 56, h: 12, fill: "database_glow_a" },
        { x: -28, y: -22, w: 56, h: 10, fill: "amber" },
        { x: -20, y: -10, w: 40, h: 8, fill: "database_glow_b" }
      ]
    },
    review: {
      rects: [
        { x: -24, y: -42, w: 46, h: 30, fill: "white" },
        { x: -18, y: -36, w: 24, h: 4, fill: "bg2" },
        { x: -18, y: -28, w: 28, h: 4, fill: "bg2" },
        { x: -18, y: -20, w: 20, h: 4, fill: "rose" },
        { x: 8, y: -40, w: 8, h: 6, fill: "rose" }
      ]
    },
    lab: {
      rects: [
        { x: -52, y: 30, w: 104, h: 10, fill: "lab_shadow" },
        { x: -44, y: -10, w: 88, h: 30, fill: "accent" },
        { x: -34, y: -2, w: 68, h: 14, fill: "bg1" },
        { x: -12, y: -38, w: 24, h: 28, fill: "zone" },
        { x: -6, y: -32, w: 12, h: 8, fill: "white" }
      ]
    }
  },
  zones: {
    frontend: {
      id: "frontend",
      title: "Frontend Desk",
      color: "#65e4ff",
      origin: { x: 132, y: 136 },
      label: { x: 82, y: 78, width: 84, height: 12 },
      hotspot: { x: -66, y: -58, width: 132, height: 108 },
      furniture: "frontend",
      anchors: {
        transit: { x: 214, y: 186 },
        familyHub: { x: 322, y: 186 }
      },
      patrol_offsets: [
        { x: -18, y: 40 },
        { x: 18, y: 40 },
        { x: 20, y: 18 },
        { x: -12, y: 18 }
      ],
      active_patrol_offsets: [
        { x: -26, y: 44 },
        { x: 22, y: 44 },
        { x: 26, y: 16 },
        { x: -18, y: 14 }
      ],
      seat_offsets: [
        { x: -6, y: 40 },
        { x: 6, y: 40 }
      ]
    },
    backend: {
      id: "backend",
      title: "Backend Rack",
      color: "#7cffba",
      origin: { x: 498, y: 136 },
      label: { x: 432, y: 78, width: 84, height: 12 },
      hotspot: { x: -66, y: -58, width: 132, height: 108 },
      furniture: "backend",
      anchors: {
        transit: { x: 414, y: 186 },
        familyHub: { x: 322, y: 186 }
      },
      patrol_offsets: [
        { x: -16, y: 38 },
        { x: 16, y: 38 },
        { x: 18, y: 18 },
        { x: -18, y: 16 }
      ],
      active_patrol_offsets: [
        { x: -24, y: 42 },
        { x: 20, y: 42 },
        { x: 20, y: 14 },
        { x: -24, y: 14 }
      ],
      seat_offsets: [
        { x: -6, y: 40 },
        { x: 6, y: 40 }
      ]
    },
    database: {
      id: "database",
      title: "Database Vault",
      color: "#ffcc66",
      origin: { x: 156, y: 292 },
      label: { x: 78, y: 246, width: 84, height: 12 },
      hotspot: { x: -66, y: -58, width: 132, height: 108 },
      furniture: "database",
      anchors: {
        transit: { x: 228, y: 248 },
        familyHub: { x: 322, y: 248 }
      },
      patrol_offsets: [
        { x: -16, y: 44 },
        { x: 16, y: 44 },
        { x: 22, y: 24 },
        { x: -18, y: 22 }
      ],
      active_patrol_offsets: [
        { x: -20, y: 48 },
        { x: 20, y: 48 },
        { x: 28, y: 20 },
        { x: -20, y: 16 }
      ],
      seat_offsets: [
        { x: -6, y: 48 },
        { x: 6, y: 48 }
      ]
    },
    review: {
      id: "review",
      title: "Docs / Ops Corner",
      color: "#ff907c",
      origin: { x: 488, y: 292 },
      label: { x: 420, y: 246, width: 84, height: 12 },
      hotspot: { x: -66, y: -58, width: 132, height: 108 },
      furniture: "review",
      anchors: {
        transit: { x: 404, y: 248 },
        familyHub: { x: 322, y: 248 }
      },
      patrol_offsets: [
        { x: -18, y: 42 },
        { x: 16, y: 42 },
        { x: 18, y: 22 },
        { x: -18, y: 20 }
      ],
      active_patrol_offsets: [
        { x: -22, y: 46 },
        { x: 18, y: 46 },
        { x: 22, y: 18 },
        { x: -22, y: 18 }
      ],
      seat_offsets: [
        { x: -6, y: 44 },
        { x: 6, y: 44 }
      ]
    },
    lab: {
      id: "lab",
      title: "General Lab",
      color: "#b8a2ff",
      origin: { x: 322, y: 216 },
      label: { x: 270, y: 182, width: 84, height: 12 },
      hotspot: { x: -66, y: -58, width: 132, height: 108 },
      furniture: "lab",
      anchors: {
        transit: { x: 322, y: 228 },
        familyHub: { x: 322, y: 228 }
      },
      patrol_offsets: [
        { x: -10, y: 42 },
        { x: 10, y: 42 },
        { x: 10, y: 18 },
        { x: -10, y: 18 }
      ],
      active_patrol_offsets: [
        { x: -12, y: 44 },
        { x: 12, y: 44 },
        { x: 12, y: 20 },
        { x: -12, y: 20 }
      ],
      seat_offsets: [
        { x: -8, y: 42 },
        { x: 8, y: 42 }
      ]
    }
  },
  actor_offsets: {
    meeting: {
      lead: [{ x: 0, y: 54 }],
      ui: [{ x: -44, y: 42 }],
      api: [{ x: 44, y: 42 }],
      db: [{ x: -30, y: 62 }],
      docs: [{ x: 30, y: 62 }],
      scout: [{ x: 0, y: 68 }]
    },
    rest: {
      lead: [{ x: -10, y: 18 }],
      ui: [{ x: -44, y: 26 }],
      api: [{ x: 46, y: 24 }],
      db: [{ x: -24, y: 44 }],
      docs: [{ x: 24, y: 42 }],
      scout: [{ x: 0, y: 52 }]
    }
  }
};

export const REST_CORNER = {
  id: ROOM_LAYOUT.rest_corner.id,
  title: ROOM_LAYOUT.rest_corner.title,
  x: ROOM_LAYOUT.rest_corner.origin.x,
  y: ROOM_LAYOUT.rest_corner.origin.y
};

export function zoneLayoutById(id, layout = ROOM_LAYOUT) {
  return layout.zones[id] || layout.zones.lab;
}

export function propLayoutById(id, layout = ROOM_LAYOUT) {
  return layout.props[id] || (id === "rest_corner" ? layout.rest_corner : null);
}

export function furnitureLayoutById(id, layout = ROOM_LAYOUT) {
  return layout.furniture[id] || layout.furniture.lab;
}

function pointWithOffset(origin, offset) {
  return {
    x: origin.x + offset.x,
    y: origin.y + offset.y
  };
}

function buildSeats(zoneLayout) {
  return (zoneLayout.seat_offsets || []).map((offset, index) => ({
    id: `${zoneLayout.id}_seat_${index}`,
    x: zoneLayout.origin.x + offset.x,
    y: zoneLayout.origin.y + offset.y,
    facing: index === 0 ? 1 : -1
  }));
}

export function createZonesFromLayout(layout = ROOM_LAYOUT) {
  return Object.values(layout.zones).map((zoneLayout) => {
    const seats = buildSeats(zoneLayout);

    return {
      id: zoneLayout.id,
      title: zoneLayout.title,
      color: zoneLayout.color,
      x: zoneLayout.origin.x,
      y: zoneLayout.origin.y,
      labelX: zoneLayout.label.x,
      labelY: zoneLayout.label.y,
      labelWidth: zoneLayout.label.width,
      labelHeight: zoneLayout.label.height,
      furniture: zoneLayout.furniture,
      hotspot: { ...zoneLayout.hotspot },
      transitAnchor: { ...zoneLayout.anchors.transit },
      familyHub: { ...zoneLayout.anchors.familyHub },
      hallwayCenter: { ...layout.hallway.center },
      seats,
      patrol: (zoneLayout.patrol_offsets || []).map((offset) => pointWithOffset(zoneLayout.origin, offset)),
      activePatrol: (zoneLayout.active_patrol_offsets || []).map((offset) =>
        pointWithOffset(zoneLayout.origin, offset)
      ),
      workSpot: seats.map((seat) => ({ x: seat.x, y: seat.y }))
    };
  });
}

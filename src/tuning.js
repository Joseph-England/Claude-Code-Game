// Every movement, surface and camera tuning value lives here (Phase 2 requirement).
// Units: metres, seconds, m/s, m/s², radians/s unless noted. Angles marked "deg" are degrees.
// The dev panel (src/debug/panel.js) edits this object live. Rationale: DESIGN.md §2 "Tuning".

export const tuning = {
  gravity: 15, // stronger than Earth: snappier arcs, faster slopes in a 5-minute game

  body: {
    radius: 0.35,
    height: 1.7, // standing capsule height
    slideHeight: 1.0, // crouched in a slide
    floorNormalY: 0.5, // collider contacts with a steeper normal than this are walls, not floors
  },

  run: {
    speed: 5, // walking top speed on flat packed snow (user playtest: 7 was too fast for a walk)
    sprintSpeed: 9, // Shift held; unlimited stamina (DECISIONS #47)
    accel: 22, // a = accel·control·(1 − v/top): ~0.23 s walk / 0.4 s sprint time constant (tightened, DECISIONS #63)
    overspeedBrake: 0.4, // floor of the (1 − v/speed) factor when faster than top speed
    brake: 24, // decel with no input (× surface grip): a sprint stops in ~0.4 s on packed
    gravityScale: 0.5, // legs resist the slope while running
    turnAccel: 70, // max lateral accel when turning; turn rate = turnAccel/speed
    maxTurnRate: 16, // rad/s cap at low speed
    skidAngle: 105, // deg; input further than this from velocity = skid-brake instead of turning
    skidBrake: 30,
    stick: 3, // multiplier on gravity when deciding to stay glued over crests
    snapDistance: 0.45, // max drop to snap down while running
  },

  slide: {
    gravityScale: 1, // slides embrace the slope
    turnAccel: 10, // carve radius = v²/(turnAccel·control)
    maxTurnRate: 2.5,
    stick: 1, // physical: leave the ground when v²/R > g·cosθ
    snapDistance: 0.25,
  },

  air: {
    control: 0.3, // fraction of run.accel available in the air
    drag: 0.0025, // quadratic
    lowJumpGravity: 2.6, // gravity multiplier while rising with jump released (variable height)
    fallGravity: 1.2, // gravity multiplier while falling
  },

  jump: {
    speed: 6.5, // full-hold height ≈ speed²/(2g) = 1.41 m
    slideSpeed: 5.0, // slide-jump: lower, longer arc (0.83 m), all horizontal speed kept
    normalBlend: 0.35, // 0 = straight up, 1 = along the ground normal
    coyote: 0.1,
    buffer: 0.12,
    groundLock: 0.08, // ignore ground snapping right after a jump
  },

  landing: {
    stumbleImpact: 11, // m/s into the surface (≈ 3.4 m fall onto flat) → stumble
    stumbleTime: 0.3,
  },

  rest: { delay: 3, radius: 5 },

  // Avatar lean (render only). Small on foot, more when carving a slide (DECISIONS #50).
  avatar: { leanScale: 0.35, leanRun: 0.08, leanSlide: 0.3 },

  // Indexed by SURFACE id: packed, powder, ice, rock.
  //  friction: Coulomb μ while sliding · drag: quadratic (1/m) · linDrag: linear (1/s)
  //  control: scales run accel and all turning · grip: scales run braking · maxWalk: deg
  surfaces: [
    { name: 'packed', friction: 0.06, drag: 0.004, linDrag: 0, control: 1.0, grip: 1.0, maxWalk: 38 },
    { name: 'powder', friction: 0.1, drag: 0.02, linDrag: 0.25, control: 0.85, grip: 1.1, maxWalk: 38 },
    { name: 'ice', friction: 0.012, drag: 0.002, linDrag: 0, control: 0.22, grip: 0.05, maxWalk: 30 },
    { name: 'rock', friction: 0.45, drag: 0.004, linDrag: 0, control: 1.2, grip: 1.2, maxWalk: 55 },
  ],

  camera: {
    distance: 5.5,
    height: 1.45, // look-at height above feet (standing)
    slideHeight: 1.0,
    pitch: 0.28, // default pitch (rad, looking down)
    minPitch: -0.6,
    maxPitch: 1.2,
    followDelay: 0.6, // s without look input before auto-follow engages
    followSpeed: 6, // m/s where auto-follow starts to act
    followRate: 2.2, // 1/s at full strength
    slopePitch: 0.45, // share of the velocity's pitch added when following
    verticalLag: 7, // 1/s critically damped follow of the target height (kills bumps)
    verticalLead: 2.5, // 1/s low-pass on vertical velocity used as the spring's lead term
    maxLead: 3, // m
    maxVerticalLag: 4, // m
    minTargetHeight: 0.4, // m above the feet the lagging target may never go below
    fovMin: 60,
    fovMax: 75,
    fovSpeedMin: 8,
    fovSpeedMax: 30,
    fovRate: 3,
    rollMax: 0.1, // rad
    rollPerTurn: 0.01, // rad per (m/s²) of lateral accel
    rollRate: 4,
    clearance: 0.45, // m kept between camera and terrain/colliders
    minDistance: 1.1,
    liftRate: 10, // 1/s rise when terrain behind the player needs a higher boom
    liftRelax: 2, // 1/s ease back down after lifting over terrain
    pullOutRate: 2.5, // 1/s ease back out after a collision pull-in
  },

  input: { mouseSensitivity: 0.0022, stickLookSpeed: 3.2, invertY: false },
};

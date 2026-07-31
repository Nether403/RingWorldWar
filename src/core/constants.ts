/**
 * Canonical world constants.
 *
 * Everything else derives from these. Changing RING_RADIUS or SURFACE_GRAVITY
 * changes the rotation rate, the Coriolis strength, artillery ranges, and how
 * far overhead the far side of the world sits -- so treat them as load-bearing.
 *
 * WHY THIS SIZE:
 *   Spin gravity ties radius and angular velocity together: g = w^2 * R.
 *   A Niven-scale ring (600 km) would put the far side 1200 km overhead -- a
 *   faint band -- and would take an hour to walk across. A small habitat ring
 *   puts the opposing hemisphere 7.2 km straight up, close enough to read
 *   terrain and see battles happening "above" you, and makes the wrap-around
 *   flank a real tactical option rather than a theoretical one.
 *
 *   The Coriolis-to-gravity ratio for artillery works out to 2*sqrt(range/R),
 *   which means a small ring necessarily has *strong* Coriolis. That is a
 *   feature: shots visibly bank, spinward range differs hugely from
 *   antispinward range, and the trajectory preview turns it into a skill.
 */

/** Radius from the ring axis to the habitable floor, metres. */
export const RING_RADIUS = 3600;

/** Width of the habitable band along the ring axis, metres. */
export const RING_WIDTH = 4000;

/** Half-width; the axial coordinate z is clamped to +/- this by the rim walls. */
export const RING_HALF_WIDTH = RING_WIDTH / 2;

/** Apparent downward acceleration at the floor, m/s^2 (~0.61 g). */
export const SURFACE_GRAVITY = 6.0;

/** Angular velocity of the ring, rad/s. Derived: w = sqrt(g / R). */
export const RING_OMEGA = Math.sqrt(SURFACE_GRAVITY / RING_RADIUS);

/** Time for one full rotation, seconds (~2.6 min). */
export const RING_PERIOD = (2 * Math.PI) / RING_OMEGA;

/** Tangential speed of the floor in the inertial frame, m/s. */
export const RING_SURFACE_SPEED = RING_OMEGA * RING_RADIUS;

/** Total arc length around the ring, metres. This is the map's wrapping width. */
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * Tuning knob on the Coriolis term. 1.0 is physically correct. Lower it if
 * playtesting shows trajectories are too chaotic to aim; the architecture
 * supports it and nothing else needs to change.
 */
export const CORIOLIS_SCALE = 1.0;

/** Height above the floor at which drag stops (the atmosphere shell), metres. */
export const ATMOSPHERE_HEIGHT = 1400;

/** Ceiling for anything in flight; above this a projectile is on a chord path. */
export const MAX_FLIGHT_HEIGHT = RING_RADIUS * 1.98;

/** Simulation tick rate. */
export const SIM_HZ = 30;
export const SIM_DT = 1 / SIM_HZ;

/** Length of one artistic day/night cycle, seconds.
 *  Deliberately decoupled from RING_PERIOD -- see docs/architecture.md. */
export const DAY_LENGTH = 420;

/** Number of shadow-square bands casting shade across the interior. */
export const SHADOW_SQUARE_COUNT = 5;

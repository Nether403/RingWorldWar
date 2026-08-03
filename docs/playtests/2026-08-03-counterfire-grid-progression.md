# Counterfire Grid Progression - 2026-08-03

## Report

The player reached objective 6/8, fired a Standard Rocket near the visible
Longbow, and watched the bound Laser Grid intercept it. The mission did not
advance to Cruise Missile adaptation.

## Root Cause

The simulation accepted the ground-target command, but mission progression had
an additional hidden rule requiring the clicked point to be within 140 metres of
the Longbow. A visually correct interception could therefore be rejected by the
mission. The mission also rediscovered the fired projectile by scanning global
projectile state instead of using the projectile created by that command.

## Retained Correction

- Successful ballistic commands now return their authoritative projectile ID.
- Player artillery actions carry that exact ID into mission tracking.
- Counterfire no longer applies an invisible target-point distance rule.
- Objective 6 advances when the bound player's Standard Rocket is intercepted by
  the bound Laser Grid, regardless of whether the ground click was exactly on the
  Longbow model.
- A regression test covers a valid ground click 200 metres away from the launcher.

The fix does not change trajectory, sensor, cooldown, power, interception, or
damage authority.

## Second Report

The player reproduced the stuck 6/8 state while targeting the Longbow exactly.
The intercepted shot had been fired from another valid Compact Rocket Battery,
but the mission silently accepted only the scenario's preplaced battery.

Counterfire now accepts Standard and Cruise rounds from any live, completed
Compact Rocket Battery. It still requires the exact authoritative projectile ID
and the bound Choir Laser Grid interception. The regression suite now uses an
alternate Compact battery for objective 6.

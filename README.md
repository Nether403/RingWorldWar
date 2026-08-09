# Ring World War

A procedural browser RTS on the inner surface of a rotating ring habitat. Build an economy, contest Spinal Nodes, field mechs, spot targets for long-range rockets, and destroy the enemy Bastion.

## Status

The technical Gate 1 playable slice and the Ring USP milestone are implemented. The main menu includes the deterministic **Gravity Range** Arcade exercise for learning how spinward and antispinward artillery differ. Current delivery status is tracked in [`docs/roadmap.md`](docs/roadmap.md).

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:5180`.

## Verify

```bash
npm run lint
npm test
npm run build
npm run test:e2e
```

## Controls

- `WASD` or screen edges: pan tactical camera; move while piloting
- Mouse wheel: zoom
- `Q` / `E`: rotate tactical camera
- Left click / drag: select / box-select
- Right click: move or attack
- `Alt+1..9` (or `Ctrl+1..9`) / `1..9`: set / recall control group
- `V`: pilot the selected mech
- `Esc`: cancel or return to tactical control
- `M`: toggle the live read-only whole-ring view
- `Shift+1..4`: choose quality preset
- `F3`: toggle performance overlay

Select a completed Rocket Battery and choose **Target rocket** to preview the simulated trajectory before firing. Long-range targets require a Wisp or Radar Mast to spot them.

In **Gravity Range**, strike the 800 m spinward marker and then the 1,800 m antispinward marker. Use **Focus marker** and the keyboard-operable minimap for a keyboard-only path; retry and main-menu actions are available in the mode panel.

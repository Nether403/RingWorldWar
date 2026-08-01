# Ring World War

A procedural browser RTS on the inner surface of a rotating ring habitat. Build an economy, contest Spinal Nodes, field mechs, spot targets for long-range rockets, and destroy the enemy Bastion.

## Status

The technical Gate 1 playable slice is implemented. See [`docs/gate-1.md`](docs/gate-1.md) for the verification receipt and the remaining external human playtest.

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
- `Shift+1..4`: choose quality preset
- `F3`: toggle performance overlay

Select a completed Rocket Battery and choose **Target rocket** to preview the simulated trajectory before firing. Long-range targets require a Wisp or Radar Mast to spot them.

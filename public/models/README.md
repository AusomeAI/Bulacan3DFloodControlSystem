# GLB models

Drop `.glb` files here and reference them from `public/data/projects.geojson`:

```json
"modelUrl": "models/pump-station.glb"
```

Conventions:

- **Metre units**, **Y up** (the glTF default). The scene rotates models into
  the overlay's Z-up frame.
- **Origin at the ground-contact point**, so the model sits on the basemap.
- Keep them light. These render over live map tiles; a heavy model costs frames
  on every camera move.
- A missing or unreadable file leaves the coloured placeholder in place rather
  than breaking the map.

You can also preview a local file without editing any data: select a project and
use *Import GLB for this project* in the details panel.

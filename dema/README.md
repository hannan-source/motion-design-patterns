# Dema Intelligence Room

A working model of Dema's business: a 3D map of how material, garments, money and
information move; a production room that answers what-if questions against a real
schedule; an ERP that records what happens on the floor; and the plan for the
cameras, agents and connectors that attach to it.

Everything here runs on **example data**. No figure in the app is Dema's actual
number. The example data is sized to behave like a resort-wear unit running close
to full, so the map, the planner and the ERP have something realistic to work on
until real feeds are connected.

## Run it

```bash
cd dema
python3 -m http.server 8800
```

Open <http://localhost:8800>.

The app is plain ES modules with no build step. Modules only load over HTTP, so
opening `index.html` straight from the file system will not work. Any static file
server does the job.

Fonts come from Google Fonts. Without internet the app falls back to system fonts
and still works. three.js is vendored, so the 3D map needs no network.

## The four views

| View | Address | What it is |
|---|---|---|
| Business map | `#map` | The 3D map: suppliers, factory floor, channels and office, with the four flows drawn between them. Click any place to see how it runs today, what changes, and which systems attach to it. |
| Production room | `#room` | The live schedule by work centre, the order book, and a what-if planner: squeeze in a sample run, scale a style, lose tailors, add overtime, and see what moves. |
| ERP | `#erp` | Inbound and fabric QC, inventory, dye house, work orders and floor, dispatch and returns, finance with Tally export. |
| Systems | `#systems` | The vision stations, agents and connectors, and the order they go live in. |

## Files

```
dema/
  index.html              App shell: top bar, view mount point, import map for three.js
  css/
    app.css               Design tokens (both themes) and shared components
    map.css               Business map overlays and inspector
    room.css              Production room
    erp.css               ERP modules
    systems.css           Systems view
  js/
    main.js               Hash routing between views, theme switch
    util.js               Factory calendar (Mon–Sat), rupee formatting, small helpers
    ontology.js           The map's content: places, flows, systems, guided tours
    seed.js               Example data: styles, work centres, orders, rolls, parcels, vouchers
    store.js              Shared state, saved in the browser
    engine.js             Finite-capacity scheduler and what-if comparison
    map.js                3D business map: scene, camera, flows, inspector (three.js)
    models.js             The small 3D models for each kind of place
    room.js               Production room
    erp.js                ERP modules
    tally.js              Voucher list to Tally import XML
    systems.js            Systems view
  vendor/
    three.module.min.js   three.js r160 (MIT, licence alongside)
  tools/
    build-artifact.mjs    Builds the single-page hosted version
  docs/
    ARCHITECTURE.md       Ontology, event model, production architecture
    TALLY-CONNECTOR.md    Plan for the Tally bridge
```

Each view module exports `mount(el, ctx)` and returns a cleanup function.
`ctx.go(view, opts)` switches view, for example `ctx.go('map', { focus: 'lineb2b' })`
or `ctx.go('erp', { module: 'inbound' })`.

## Where the data lives

State is one object held by `js/store.js` and saved to the browser's
`localStorage`. Edits made in the ERP survive a reload on the same device and go
nowhere else. Clearing site data, or a change to `SEED_VERSION` in `seed.js`,
brings back the example data.

`store.js` is the seam for a real backend. Views only call `store.get()`,
`store.update(fn, topic)`, `store.on(fn)` and `store.nextId()`. Replacing those
four with API calls moves the app onto a server without touching the views.
`docs/ARCHITECTURE.md` describes that backend.

## Extending the map

The map is drawn from `js/ontology.js`. Nothing about a place is hard-coded in
the 3D code beyond its building shape.

- **Add a place.** Add an object to `NODES` with an `id`, a `zone`, a `kind`
  (which picks the 3D model), `pos: [x, z]`, `size: [width, depth]`, a `blurb`,
  the `today` and `change` lists, and the `systems` that attach to it.
- **Add a flow.** Add `{ from, to, layer, what }` to `FLOWS`. `layer` is one of
  `material`, `goods`, `money`, `data`. Use `lift` to raise an arc that would
  otherwise cross others.
- **Add a system.** Add it to `SYSTEMS` with a `kind` of `erp`, `vision`,
  `agent` or `connector`, then list its id on the nodes it serves. The Systems
  view picks it up from there.
- **Add a guided tour.** Add an entry to `TOURS` with `[nodeId, caption]` steps.

## What is real and what is not

| Real | Example only |
|---|---|
| The scheduler: it computes load, finish dates and slips from the order book and capacities it is given | The order book, capacities and stitch times it is given |
| The Tally XML: it follows Tally's import format | The ledger names, parties and amounts |
| The map structure and the flows, taken from the brief | Every metric shown on the map |

The one outside figure in the app is the post-dye fabric loss, north of $250,000
a year. That is the production head's estimate and is labelled as such.

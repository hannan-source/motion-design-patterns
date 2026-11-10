# Scanners now, cameras later

Quality checks and counts are done by people today. Barcodes are read with handheld scanners.
Cameras come in later, station by station, and write the same records people write now. This
note covers both, so nothing built today has to be redone.

## Today: handheld scanners

Any scanner that types like a keyboard works with no setup.

| What is scanned | Barcode | Where | What happens |
|---|---|---|---|
| Fabric roll | Deme tag, printed from **Inventory > Fabric rolls > Print tags** | Anywhere in the app | Opens the roll: inspect, issue, return |
| Bundle | Deme tag, printed from **Production > Bundles > Print tags** | Scan station | Start and finish; gives minutes per piece |
| Shopify parcel, export carton | The courier's tracking barcode on the label | Dispatch gate | Out: order shipped, sale booked. Back in: return recorded |
| Store piece | Deme tag, printed from **B2C sales > Store orders > Print tags** | Dispatch gate | In: fit visit counted. Out: time in factory and work minutes kept |
| Material | Deme tag from **Masters > Materials > Print tags** | Anywhere | Opens the material: adjust or issue stock |

Deme's own tags are Code 128. Courier labels are only read. GS1 barcodes are not needed unless a
retailer asks for them on cartons.

With no field selected, a scan from anywhere in the app is caught and routed. The **Scan or find**
box in the side rail does the same for a typed number.

Hardware to buy: 1D/2D handheld scanners (USB or Bluetooth, keyboard mode), one per stitching
line, two at the gate, one in stores; a thermal label printer for tags.

A scanner app or fixed scanner that is not a keyboard can post straight to the API with a
service key (**Admin > Connections > Service keys**):

```
POST /api/action/gate.scan
Authorization: Bearer deme_…
Content-Type: application/json

{ "payload": { "barcode": "JD014600009812345671" } }
```

## Later: cameras, one station at a time

### How a camera connects

```
camera ──live stream──> edge box (on site, runs the model) ──result──> Deme API ──> record, flag, nudge
                              │
                              └── lamp, buzzer or screen at the station, with no internet needed
```

- The camera never talks to the ERP and the ERP never reads video.
- The edge box is a small computer with a GPU on the factory network. It reads the stream, runs
  the model on each frame, and decides within a fraction of a second.
- It sends only the result: station, time, what it saw, which roll or parcel, confidence, and a
  snapshot. It uses a service key and calls the same action a person would
  (`roll.inspect`, `gate.scan`, `count.post`).
- If the link drops, it keeps deciding locally and sends queued results when the link returns.

### Where data lives

| Store | Holds | Kept |
|---|---|---|
| ERP records | The outcome: roll passed, parcel out, count corrected | Permanently |
| Event log | Every reading from every station, raw, with its snapshot | Permanently. Reports and retraining read from here |
| Video | A rolling buffer on site and short clips around each flag | Days to weeks |

The event log is the data lake. It starts as a table of readings plus an object store for
snapshots, and it is fed by the same `GET /api/events` feed other services use.

### Stations, in order of value and difficulty

| Order | Station | Camera | Reads | Calls | Nudges |
|---|---|---|---|---|---|
| 1 | Dispatch gate | Fixed barcode camera | Tracking barcode, Deme tags | `gate.scan` | Logistics |
| 2 | Racks and unaudited store | Fixed cameras | Roll tags on shelves | Stock count against records | Stores |
| 3 | Thread wall | Fixed camera | Cones by shade | Low-stock flag | Purchasing |
| 4 | Shade check | Light box camera | Dyed fabric against swatch | `dye.receive` accept or fail | QC, finance |
| 5 | Fabric inspection rig | Line-scan camera over a roller frame | Stains, lines, holes per metre | `roll.inspect` with points | QC, purchasing |

Tag and barcode reading (1 to 3) is dependable from the first day. Shade and defect detection
(4 and 5) need a model trained on Deme's own fabric.

### Rules for trusting a model

1. **Advise first.** A new station runs beside a person. It suggests; the person decides. Both
   answers are logged.
2. **Earn pass-or-fail.** It gates on its own only after it catches at least nine in ten of the
   defects a trained checker finds, on Deme's fabric, over an agreed number of rolls.
3. **Confidence decides the path.** High confidence posts by itself. Middling confidence asks the
   person at the station to confirm. Low confidence is logged and ignored.
4. **Everything is reversible.** Every automatic decision keeps its snapshot and can be overturned,
   and overturned decisions become training data.

### What the ERP still needs for cameras

Built: the actions cameras will call, service keys, the ordered event feed, the audit trail.

To build when the first station is chosen:

- a readings table (station, time, kind, subject, result, confidence, snapshot link) and
  `POST /api/readings`;
- a station list with a heartbeat (online, last reading, readings per hour, model version);
- flags with an owner, a state (open, acknowledged, resolved) and escalation;
- nudges beyond the Today list: WhatsApp or SMS for urgent flags;
- storage for snapshots and clips.

All of it can be built and tested with simulated readings before a camera is bought.

### Not planned

Cameras pointed at tailors to time their work. Bundle scans give minutes per piece by style and
by station, more accurately, and the floor accepts them.

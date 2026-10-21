// refurb-guide-rates.js: one guide rate per refurb line item.
//
// Nathan or Cameron will fill these in. Every value is deliberately empty
// (null) for now: no rate here has been invented. When a rate is set, the
// estimator shows it as a "Guide" placeholder the user can accept with one
// tap. When it is null, nothing is shown.
//
// Rate priority on the estimator: the user's own saved rate ("Your rate")
// first, then the guide rate below, then empty.
//
// Keys are "<sectionId>.<itemId>", matching REFURB_SECTIONS in
// refurb-totals.js. Rates are in pounds per unit (the unit shown next to
// Qty for that item). Update lastUpdated whenever a rate changes.
const REFURB_GUIDE_RATES = {
  lastUpdated: null, // e.g. "2026-11-01"
  rates: {
    // Demolition & Alterations
    "demolition.strip-out": null, // Strip out (per item)
    "demolition.skip-8yd": null, // Skip 8yd (without permit) (per each)
    "demolition.skip-12yd": null, // Skip 12yd (without permit) (per each)
    "demolition.skip-permit": null, // Skip permit (per each)
    // Masonry & Groundworks
    "masonry.extension-m2": null, // Extension per m² (per m²)
    "masonry.repointing-m2": null, // Repointing per m² (per m²)
    "masonry.underpinning-m2": null, // Underpinning per m² (per m²)
    "masonry.large-lintel": null, // Large lintel incl. fit (per each)
    "masonry.small-lintel": null, // Small lintel incl. fit (per each)
    "masonry.beams": null, // Beams incl. fit (per each)
    "masonry.rendering-m2": null, // Rendering per m² (per m²)
    "masonry.dpc-metre": null, // DPC per metre (per linear m)
    "masonry.brick-big-window": null, // Brick up big window (per each)
    "masonry.brick-small-window": null, // Brick up small window (per each)
    "masonry.structural-engineer": null, // Structural engineer (per item)
    // Roofing & Scaffolding
    "roofing.new-roof-m2": null, // New roof per m² (per m²)
    "roofing.new-roof-full": null, // New roof (full) (per item)
    "roofing.scaffolding": null, // Scaffolding (per item)
    "roofing.chimney-flashing": null, // Chimney flashing (per each)
    // Plastering
    "plastering.skimming-room": null, // Skimming per room (per room)
    "plastering.skimming-m2": null, // Skimming per m² (per m²)
    "plastering.boarding-m2": null, // Boarding per m² (per m²)
    "plastering.boarding-ceiling": null, // Boarding ceiling (per room)
    // Joinery
    "joinery.skirting-m2": null, // Skirting per m² (per m²)
    "joinery.fire-door-fit": null, // Fire door fit only (per each)
    "joinery.fire-door-supply": null, // Fire door supply only (per each)
    "joinery.standard-door-supply": null, // Standard door supply only (per each)
    "joinery.standard-door-fit": null, // Standard door fit only (per each)
    "joinery.ironmongery": null, // Ironmongery (per each)
    "joinery.stud-walls": null, // Stud walls (per m²)
    "joinery.roof-rafters": null, // Roof rafters (per each)
    "joinery.stairs-internal": null, // Stairs internal (per item)
    // Windows & Doors
    "windows-doors.small-window": null, // Small window (per each)
    "windows-doors.large-window": null, // Large window (per each)
    "windows-doors.bifold-doors": null, // Bi-folding doors (per each)
    "windows-doors.upvc-door": null, // uPVC door (per each)
    "windows-doors.french-door": null, // French door (per each)
    "windows-doors.sash-window": null, // Sash window (per each)
    // Electrics
    "electrics.full-rewire": null, // Full rewire (per item)
    "electrics.consumer-unit": null, // New consumer unit (per each)
    "electrics.emergency-lighting": null, // Emergency lighting (per each)
    "electrics.automatic-lighting": null, // Automatic lighting (per each)
    "electrics.wired-fire-alarm": null, // Wired fire alarm (per each)
    "electrics.battery-fire-alarm": null, // Battery fire alarm (per each)
    "electrics.plug-socket": null, // Plug socket (per each)
    "electrics.light-switch": null, // Light switch (per each)
    "electrics.ip-rated-pendant": null, // IP rated pendant (per each)
    "electrics.fire-alarm-system": null, // Fire alarm system (per item)
    "electrics.cctv-cameras": null, // CCTV cameras (per each)
    "electrics.eicr-test": null, // EICR test (per item)
    // Plumbing
    "plumbing.full-replumb": null, // Full replumb (per item)
    "plumbing.plumber-hourly": null, // Hourly rate for plumber (per hour)
    "plumbing.boiler-supply-fit": null, // Boiler supply & fit (per item)
    "plumbing.guttering": null, // Guttering (per linear m)
    "plumbing.manhole-installation": null, // New manhole installation (per item)
    "plumbing.kitchen-fit": null, // Plumbing day rate (per day)
    "plumbing.gas-safety-cert": null, // Gas safety cert (per item)
    "plumbing.radiators": null, // Radiators (per each)
    "plumbing.boiler-relocation": null, // Boiler relocation (per item)
    // Flooring & Tiling
    "flooring.laminate-m2": null, // Laminate per m² (per m²)
    "flooring.vinyl-m2": null, // Vinyl per m² (per m²)
    "flooring.grouting-m2": null, // Grouting per m² (per m²)
    "flooring.herringbone-m2": null, // Herringbone flooring per m² (per m²)
    "flooring.aqua-panels": null, // Aqua panels (per m²)
    "flooring.tiling-m2": null, // Tiling per m² (per m²)
    "flooring.carpet-m2": null, // Carpet per m² (per m²)
    // Bathroom & Kitchen
    "bathroom-kitchen-supply.shower-tray": null, // Shower tray (per each)
    "bathroom-kitchen-supply.shower-enclosure": null, // Shower enclosure (per each)
    "bathroom-kitchen-supply.toilet": null, // Toilet (per each)
    "bathroom-kitchen-supply.sink-basin": null, // Sink basin (per each)
    "bathroom-kitchen-supply.basin-taps": null, // Basin taps (per each)
    "bathroom-kitchen-supply.bathroom-fit": null, // Bathroom fit (per room)
    "bathroom-kitchen-supply.bathroom-supply-only": null, // Bathroom supply only (per room)
    "bathroom-kitchen-supply.kitchen-fit-only": null, // Kitchen fit (per item)
    "bathroom-kitchen-supply.kitchen-supply-only": null, // Kitchen supply only (per item)
    "bathroom-kitchen-supply.grouting-m2": null, // Grouting per m² (per m²)
    "bathroom-kitchen-supply.tiling-m2": null, // Tiling per m² (per m²)
    // Painting & Decorating
    "painting.mist-coat-room": null, // Mist coat per room (per room)
    "painting.paint-standard-m2": null, // Paint (standard white) per m² (per m²)
    "painting.full-room-paint": null, // Full room paint per room (standard white) (per room)
    "painting.wallpaper-m2": null, // Wallpaper per m² (per m²)
    "painting.feature-wall": null, // Feature wall (per each)
    "painting.sanding-patching-m2": null, // Sanding & patching per m² (per m²)
    // Garden & Landscaping
    "garden.garden-clear": null, // Garden clear (per item)
    "garden.new-lawn-m2": null, // New lawn per m² (per m²)
    "garden.slabbing-paving-m2": null, // Slabbing/paving per m² (per m²)
    "garden.patio-m2": null, // Patio per m² (per m²)
    "garden.decking-m2": null, // Decking per m² (per m²)
    // Energy efficiency (EPC)
    "epc.loft-insulation": null, // Loft insulation (per m²)
    "epc.cavity-wall-insulation": null, // Cavity wall insulation (per m²)
    "epc.solid-wall-insulation": null, // Solid wall insulation (internal or external) (per m²)
    "epc.double-glazing": null, // Double glazing (per each)
    "epc.heating-upgrade": null, // Heating system or boiler upgrade (per item)
    "epc.heating-controls": null, // Heating controls (programmer, thermostat, TRVs) (per item)
    "epc.led-lighting": null, // LED lighting (per room)
    "epc.cylinder-insulation": null, // Hot water cylinder insulation (per item)
  },
};

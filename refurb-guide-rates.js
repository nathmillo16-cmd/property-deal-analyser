// refurb-guide-rates.js: indicative guide rates for every refurb line item.
//
// Nathan or Cameron will fill these in. Every value is deliberately empty
// (null) for now: no rate here has been invented.
//
// Each item has:
//   low, typical, high: pounds per unit, ex VAT, labour and materials.
//   unit:   the unit the rate is per (matches REFURB_SECTIONS in
//           refurb-totals.js).
//   source: where the figures came from, as text (e.g. "3 builder quotes,
//           Nottingham, Oct 2026").
//
// The figures are for base_region (UK average). The estimator multiplies
// them by the factor for the user's region (from Settings, or the linked
// deal's postcode). A null factor, or a null typical rate, means no guide
// is shown for that line: the estimator asks for "Add your rate" instead.
//
// Rate priority on the estimator: the user's own rate first, then
// typical x region factor, then nothing.
//
// Keys are "<sectionId>.<itemId>", matching REFURB_SECTIONS in
// refurb-totals.js. Update rates_as_of whenever figures change.
// scripts/export-refurb-guide-csv.js writes a blank CSV of every item to
// /exports for builders to fill in.
const REFURB_GUIDE_RATES = {
  rates_as_of: null, // e.g. "2026-11-01"
  base_region: "UK average",
  region_factors: {
    "UK average": 1.00,
    "London": null,
    "South East": null,
    "South West": null,
    "East of England": null,
    "East Midlands": null,
    "West Midlands": null,
    "North West": null,
    "North East": null,
    "Yorkshire and the Humber": null,
    "Wales": null,
    "Scotland": null,
    "Northern Ireland": null,
  },
  items: {
    // Demolition & Alterations
    "demolition.strip-out": { low: null, typical: null, high: null, unit: "item", source: null }, // Strip out
    "demolition.skip-8yd": { low: null, typical: null, high: null, unit: "each", source: null }, // Skip 8yd (without permit)
    "demolition.skip-12yd": { low: null, typical: null, high: null, unit: "each", source: null }, // Skip 12yd (without permit)
    "demolition.skip-permit": { low: null, typical: null, high: null, unit: "each", source: null }, // Skip permit
    // Masonry & Groundworks
    "masonry.extension-m2": { low: null, typical: null, high: null, unit: "m²", source: null }, // Extension per m²
    "masonry.repointing-m2": { low: null, typical: null, high: null, unit: "m²", source: null }, // Repointing per m²
    "masonry.underpinning-m2": { low: null, typical: null, high: null, unit: "m²", source: null }, // Underpinning per m²
    "masonry.large-lintel": { low: null, typical: null, high: null, unit: "each", source: null }, // Large lintel incl. fit
    "masonry.small-lintel": { low: null, typical: null, high: null, unit: "each", source: null }, // Small lintel incl. fit
    "masonry.beams": { low: null, typical: null, high: null, unit: "each", source: null }, // Beams incl. fit
    "masonry.rendering-m2": { low: null, typical: null, high: null, unit: "m²", source: null }, // Rendering per m²
    "masonry.dpc-metre": { low: null, typical: null, high: null, unit: "linear m", source: null }, // DPC per metre
    "masonry.brick-big-window": { low: null, typical: null, high: null, unit: "each", source: null }, // Brick up big window
    "masonry.brick-small-window": { low: null, typical: null, high: null, unit: "each", source: null }, // Brick up small window
    "masonry.structural-engineer": { low: null, typical: null, high: null, unit: "item", source: null }, // Structural engineer
    // Roofing & Scaffolding
    "roofing.new-roof-m2": { low: null, typical: null, high: null, unit: "m²", source: null }, // New roof per m²
    "roofing.new-roof-full": { low: null, typical: null, high: null, unit: "item", source: null }, // New roof (full)
    "roofing.scaffolding": { low: null, typical: null, high: null, unit: "item", source: null }, // Scaffolding
    "roofing.chimney-flashing": { low: null, typical: null, high: null, unit: "each", source: null }, // Chimney flashing
    // Plastering
    "plastering.skimming-room": { low: null, typical: null, high: null, unit: "room", source: null }, // Skimming per room
    "plastering.skimming-m2": { low: null, typical: null, high: null, unit: "m²", source: null }, // Skimming per m²
    "plastering.boarding-m2": { low: null, typical: null, high: null, unit: "m²", source: null }, // Boarding per m²
    "plastering.boarding-ceiling": { low: null, typical: null, high: null, unit: "room", source: null }, // Boarding ceiling
    // Joinery
    "joinery.skirting-m2": { low: null, typical: null, high: null, unit: "m²", source: null }, // Skirting per m²
    "joinery.fire-door-fit": { low: null, typical: null, high: null, unit: "each", source: null }, // Fire door fit only
    "joinery.fire-door-supply": { low: null, typical: null, high: null, unit: "each", source: null }, // Fire door supply only
    "joinery.standard-door-supply": { low: null, typical: null, high: null, unit: "each", source: null }, // Standard door supply only
    "joinery.standard-door-fit": { low: null, typical: null, high: null, unit: "each", source: null }, // Standard door fit only
    "joinery.ironmongery": { low: null, typical: null, high: null, unit: "each", source: null }, // Ironmongery
    "joinery.stud-walls": { low: null, typical: null, high: null, unit: "m²", source: null }, // Stud walls
    "joinery.roof-rafters": { low: null, typical: null, high: null, unit: "each", source: null }, // Roof rafters
    "joinery.stairs-internal": { low: null, typical: null, high: null, unit: "item", source: null }, // Stairs internal
    // Windows & Doors
    "windows-doors.small-window": { low: null, typical: null, high: null, unit: "each", source: null }, // Small window
    "windows-doors.large-window": { low: null, typical: null, high: null, unit: "each", source: null }, // Large window
    "windows-doors.bifold-doors": { low: null, typical: null, high: null, unit: "each", source: null }, // Bi-folding doors
    "windows-doors.upvc-door": { low: null, typical: null, high: null, unit: "each", source: null }, // uPVC door
    "windows-doors.french-door": { low: null, typical: null, high: null, unit: "each", source: null }, // French door
    "windows-doors.sash-window": { low: null, typical: null, high: null, unit: "each", source: null }, // Sash window
    // Electrics
    "electrics.full-rewire": { low: null, typical: null, high: null, unit: "item", source: null }, // Full rewire
    "electrics.consumer-unit": { low: null, typical: null, high: null, unit: "each", source: null }, // New consumer unit
    "electrics.emergency-lighting": { low: null, typical: null, high: null, unit: "each", source: null }, // Emergency lighting
    "electrics.automatic-lighting": { low: null, typical: null, high: null, unit: "each", source: null }, // Automatic lighting
    "electrics.wired-fire-alarm": { low: null, typical: null, high: null, unit: "each", source: null }, // Wired fire alarm
    "electrics.battery-fire-alarm": { low: null, typical: null, high: null, unit: "each", source: null }, // Battery fire alarm
    "electrics.plug-socket": { low: null, typical: null, high: null, unit: "each", source: null }, // Plug socket
    "electrics.light-switch": { low: null, typical: null, high: null, unit: "each", source: null }, // Light switch
    "electrics.ip-rated-pendant": { low: null, typical: null, high: null, unit: "each", source: null }, // IP rated pendant
    "electrics.fire-alarm-system": { low: null, typical: null, high: null, unit: "item", source: null }, // Fire alarm system
    "electrics.cctv-cameras": { low: null, typical: null, high: null, unit: "each", source: null }, // CCTV cameras
    "electrics.eicr-test": { low: null, typical: null, high: null, unit: "item", source: null }, // EICR test
    // Plumbing
    "plumbing.full-replumb": { low: null, typical: null, high: null, unit: "item", source: null }, // Full replumb
    "plumbing.plumber-hourly": { low: null, typical: null, high: null, unit: "hour", source: null }, // Hourly rate for plumber
    "plumbing.boiler-supply-fit": { low: null, typical: null, high: null, unit: "item", source: null }, // Boiler supply & fit
    "plumbing.guttering": { low: null, typical: null, high: null, unit: "linear m", source: null }, // Guttering
    "plumbing.manhole-installation": { low: null, typical: null, high: null, unit: "item", source: null }, // New manhole installation
    "plumbing.kitchen-fit": { low: null, typical: null, high: null, unit: "day", source: null }, // Plumbing day rate
    "plumbing.gas-safety-cert": { low: null, typical: null, high: null, unit: "item", source: null }, // Gas safety cert
    "plumbing.radiators": { low: null, typical: null, high: null, unit: "each", source: null }, // Radiators
    "plumbing.boiler-relocation": { low: null, typical: null, high: null, unit: "item", source: null }, // Boiler relocation
    // Flooring & Tiling
    "flooring.laminate-m2": { low: null, typical: null, high: null, unit: "m²", source: null }, // Laminate per m²
    "flooring.vinyl-m2": { low: null, typical: null, high: null, unit: "m²", source: null }, // Vinyl per m²
    "flooring.grouting-m2": { low: null, typical: null, high: null, unit: "m²", source: null }, // Grouting per m²
    "flooring.herringbone-m2": { low: null, typical: null, high: null, unit: "m²", source: null }, // Herringbone flooring per m²
    "flooring.aqua-panels": { low: null, typical: null, high: null, unit: "m²", source: null }, // Aqua panels
    "flooring.tiling-m2": { low: null, typical: null, high: null, unit: "m²", source: null }, // Tiling per m²
    "flooring.carpet-m2": { low: null, typical: null, high: null, unit: "m²", source: null }, // Carpet per m²
    // Bathroom & Kitchen
    "bathroom-kitchen-supply.shower-tray": { low: null, typical: null, high: null, unit: "each", source: null }, // Shower tray
    "bathroom-kitchen-supply.shower-enclosure": { low: null, typical: null, high: null, unit: "each", source: null }, // Shower enclosure
    "bathroom-kitchen-supply.toilet": { low: null, typical: null, high: null, unit: "each", source: null }, // Toilet
    "bathroom-kitchen-supply.sink-basin": { low: null, typical: null, high: null, unit: "each", source: null }, // Sink basin
    "bathroom-kitchen-supply.basin-taps": { low: null, typical: null, high: null, unit: "each", source: null }, // Basin taps
    "bathroom-kitchen-supply.bathroom-fit": { low: null, typical: null, high: null, unit: "room", source: null }, // Bathroom fit
    "bathroom-kitchen-supply.bathroom-supply-only": { low: null, typical: null, high: null, unit: "room", source: null }, // Bathroom supply only
    "bathroom-kitchen-supply.kitchen-fit-only": { low: null, typical: null, high: null, unit: "item", source: null }, // Kitchen fit
    "bathroom-kitchen-supply.kitchen-supply-only": { low: null, typical: null, high: null, unit: "item", source: null }, // Kitchen supply only
    "bathroom-kitchen-supply.grouting-m2": { low: null, typical: null, high: null, unit: "m²", source: null }, // Grouting per m²
    "bathroom-kitchen-supply.tiling-m2": { low: null, typical: null, high: null, unit: "m²", source: null }, // Tiling per m²
    // Painting & Decorating
    "painting.mist-coat-room": { low: null, typical: null, high: null, unit: "room", source: null }, // Mist coat per room
    "painting.paint-standard-m2": { low: null, typical: null, high: null, unit: "m²", source: null }, // Paint (standard white) per m²
    "painting.full-room-paint": { low: null, typical: null, high: null, unit: "room", source: null }, // Full room paint per room (standard white)
    "painting.wallpaper-m2": { low: null, typical: null, high: null, unit: "m²", source: null }, // Wallpaper per m²
    "painting.feature-wall": { low: null, typical: null, high: null, unit: "each", source: null }, // Feature wall
    "painting.sanding-patching-m2": { low: null, typical: null, high: null, unit: "m²", source: null }, // Sanding & patching per m²
    // Garden & Landscaping
    "garden.garden-clear": { low: null, typical: null, high: null, unit: "item", source: null }, // Garden clear
    "garden.new-lawn-m2": { low: null, typical: null, high: null, unit: "m²", source: null }, // New lawn per m²
    "garden.slabbing-paving-m2": { low: null, typical: null, high: null, unit: "m²", source: null }, // Slabbing/paving per m²
    "garden.patio-m2": { low: null, typical: null, high: null, unit: "m²", source: null }, // Patio per m²
    "garden.decking-m2": { low: null, typical: null, high: null, unit: "m²", source: null }, // Decking per m²
    // Energy efficiency (EPC)
    "epc.loft-insulation": { low: null, typical: null, high: null, unit: "m²", source: null }, // Loft insulation
    "epc.cavity-wall-insulation": { low: null, typical: null, high: null, unit: "m²", source: null }, // Cavity wall insulation
    "epc.solid-wall-insulation": { low: null, typical: null, high: null, unit: "m²", source: null }, // Solid wall insulation (internal or external)
    "epc.double-glazing": { low: null, typical: null, high: null, unit: "each", source: null }, // Double glazing
    "epc.heating-upgrade": { low: null, typical: null, high: null, unit: "item", source: null }, // Heating system or boiler upgrade
    "epc.heating-controls": { low: null, typical: null, high: null, unit: "item", source: null }, // Heating controls (programmer, thermostat, TRVs)
    "epc.led-lighting": { low: null, typical: null, high: null, unit: "room", source: null }, // LED lighting
    "epc.cylinder-insulation": { low: null, typical: null, high: null, unit: "item", source: null }, // Hot water cylinder insulation
  },
};

// refurb-templates.js: the quantity rules behind "Start from a template"
// and "Walk room by room" on the Refurbishment Estimator.
//
// Edit freely. Nothing here is a price: these are QUANTITIES only (how
// many rooms, roughly how many m² and so on). Rates always come from the
// user's own rate card, then the guide rates (refurb-guide-rates.js), then
// empty. If no rates are set the estimator still fills the quantities and
// shows "Add rates to see a total".
//
// Every item key is "<sectionId>.<itemId>" from REFURB_SECTIONS in
// refurb-totals.js.
//
// A quantity can be:
//   a number                     2
//   a measure name               'rooms'
//   { m: 'floorArea', x: 0.4 }   a measure times a factor (rounded up)
//   { m: 'rooms', plus: 1 }      a measure plus a number
// "only" limits a rule to some property types, e.g. only: ['terrace','semi'].

// ---------------------------------------------------------------------
// Property types. Rough starting points for a typical UK property of each
// type; the user always reviews and edits the quantities afterwards.
// ---------------------------------------------------------------------
const REFURB_PROPERTY_TYPES = {
  flat:     { label: 'Flat',     livingRooms: 1, floorAreaBase: 25, floorAreaPerBed: 17, storeys: 1, gardenArea: 0,   hasRoof: false, hasExterior: false },
  terrace:  { label: 'Terrace',  livingRooms: 2, floorAreaBase: 35, floorAreaPerBed: 18, storeys: 2, gardenArea: 40,  hasRoof: true,  hasExterior: true },
  semi:     { label: 'Semi',     livingRooms: 2, floorAreaBase: 40, floorAreaPerBed: 20, storeys: 2, gardenArea: 80,  hasRoof: true,  hasExterior: true },
  detached: { label: 'Detached', livingRooms: 2, floorAreaBase: 50, floorAreaPerBed: 24, storeys: 2, gardenArea: 150, hasRoof: true,  hasExterior: true },
};

const REFURB_BEDROOM_OPTIONS = [1, 2, 3, 4, 5];

// Measures every rule can refer to, worked out from type + bedrooms.
function refurbMeasures(type, beds) {
  const t = REFURB_PROPERTY_TYPES[type] || REFURB_PROPERTY_TYPES.terrace;
  const b = Math.max(1, Math.min(5, Number(beds) || 2));
  const bathrooms = b >= 4 ? 2 : 1;
  const rooms = b + t.livingRooms;                    // bedrooms + living rooms
  const floorArea = t.floorAreaBase + t.floorAreaPerBed * b;
  return {
    beds: b,
    livingRooms: t.livingRooms,
    rooms,
    bathrooms,
    floorArea,                                        // m², whole property
    wallArea: Math.round(floorArea * 2.5),            // m², internal walls to paint or skim
    ceilingArea: floorArea,
    roofArea: t.hasRoof ? Math.round(floorArea / t.storeys * 1.3) : 0,
    gardenArea: t.gardenArea,
    windows: rooms + bathrooms + 1,
    internalDoors: rooms + bathrooms + 1,
    radiators: rooms + bathrooms + 1,
    storeys: t.storeys,
    one: 1,
  };
}

// ---------------------------------------------------------------------
// Scopes for "Start from a template".
// ---------------------------------------------------------------------
const REFURB_SCOPES = {
  light: {
    label: 'Light refresh',
    hint: 'Paint, flooring and safety checks.',
    items: [
      { key: 'painting.full-room-paint', qty: { m: 'rooms', plus: 1 } },
      { key: 'painting.sanding-patching-m2', qty: { m: 'wallArea', x: 0.1 } },
      { key: 'flooring.carpet-m2', qty: { m: 'floorArea', x: 0.45 } },
      { key: 'flooring.vinyl-m2', qty: 12 },
      { key: 'electrics.eicr-test', qty: 1 },
      { key: 'electrics.battery-fire-alarm', qty: { m: 'storeys', plus: 1 } },
      { key: 'plumbing.gas-safety-cert', qty: 1 },
      { key: 'garden.garden-clear', qty: 1, only: ['terrace', 'semi', 'detached'] },
      { key: 'demolition.skip-8yd', qty: 1 },
    ],
  },
  medium: {
    label: 'Medium',
    hint: 'New kitchen and bathroom, some plastering, flooring throughout.',
    items: [
      { key: 'demolition.skip-12yd', qty: 1 },
      { key: 'plastering.skimming-room', qty: { m: 'rooms', x: 0.5 } },
      { key: 'painting.full-room-paint', qty: { m: 'rooms', plus: 2 } },
      { key: 'flooring.laminate-m2', qty: { m: 'floorArea', x: 0.3 } },
      { key: 'flooring.carpet-m2', qty: { m: 'floorArea', x: 0.4 } },
      { key: 'flooring.vinyl-m2', qty: 12 },
      { key: 'bathroom-kitchen-supply.kitchen-supply-only', qty: 1 },
      { key: 'bathroom-kitchen-supply.kitchen-fit-only', qty: 1 },
      { key: 'bathroom-kitchen-supply.bathroom-supply-only', qty: 1 },
      { key: 'bathroom-kitchen-supply.bathroom-fit', qty: 1 },
      { key: 'bathroom-kitchen-supply.tiling-m2', qty: 10 },
      { key: 'electrics.consumer-unit', qty: 1 },
      { key: 'electrics.plug-socket', qty: 4 },
      { key: 'electrics.eicr-test', qty: 1 },
      { key: 'electrics.wired-fire-alarm', qty: { m: 'storeys', plus: 1 } },
      { key: 'joinery.standard-door-supply', qty: { m: 'internalDoors', x: 0.5 } },
      { key: 'joinery.standard-door-fit', qty: { m: 'internalDoors', x: 0.5 } },
      { key: 'plumbing.gas-safety-cert', qty: 1 },
      { key: 'garden.garden-clear', qty: 1, only: ['terrace', 'semi', 'detached'] },
    ],
  },
  full: {
    label: 'Full refurb',
    hint: 'Strip out, rewire, replumb, new heating, kitchen, bathroom, plaster and decorate.',
    items: [
      { key: 'demolition.strip-out', qty: 1 },
      { key: 'demolition.skip-12yd', qty: 2 },
      { key: 'electrics.full-rewire', qty: 1 },
      { key: 'electrics.consumer-unit', qty: 1 },
      { key: 'electrics.wired-fire-alarm', qty: { m: 'storeys', plus: 1 } },
      { key: 'electrics.eicr-test', qty: 1 },
      { key: 'plumbing.full-replumb', qty: 1 },
      { key: 'plumbing.boiler-supply-fit', qty: 1 },
      { key: 'plumbing.radiators', qty: 'radiators' },
      { key: 'plumbing.gas-safety-cert', qty: 1 },
      { key: 'plastering.skimming-m2', qty: { m: 'wallArea', x: 1 } },
      { key: 'plastering.boarding-ceiling', qty: 'rooms' },
      { key: 'painting.mist-coat-room', qty: { m: 'rooms', plus: 2 } },
      { key: 'painting.full-room-paint', qty: { m: 'rooms', plus: 2 } },
      { key: 'bathroom-kitchen-supply.kitchen-supply-only', qty: 1 },
      { key: 'bathroom-kitchen-supply.kitchen-fit-only', qty: 1 },
      { key: 'bathroom-kitchen-supply.bathroom-supply-only', qty: 'bathrooms' },
      { key: 'bathroom-kitchen-supply.bathroom-fit', qty: 'bathrooms' },
      { key: 'bathroom-kitchen-supply.tiling-m2', qty: { m: 'bathrooms', x: 15 } },
      { key: 'flooring.laminate-m2', qty: { m: 'floorArea', x: 0.5 } },
      { key: 'flooring.carpet-m2', qty: { m: 'floorArea', x: 0.4 } },
      { key: 'flooring.vinyl-m2', qty: 12 },
      { key: 'joinery.standard-door-supply', qty: 'internalDoors' },
      { key: 'joinery.standard-door-fit', qty: 'internalDoors' },
      { key: 'joinery.ironmongery', qty: 'internalDoors' },
      { key: 'garden.garden-clear', qty: 1, only: ['terrace', 'semi', 'detached'] },
    ],
  },
};

// Suggested duration in weeks for each scope. base is for a 2 bed;
// perExtraBed is added for each bedroom over 2 (and taken off for a 1 bed).
// typeFactor scales by property type. The result is rounded to whole weeks.
const REFURB_DURATION_WEEKS = {
  light:  { base: 2,  perExtraBed: 0.5 },
  medium: { base: 6,  perExtraBed: 1 },
  full:   { base: 12, perExtraBed: 2 },
  typeFactor: { flat: 0.9, terrace: 1, semi: 1.1, detached: 1.25 },
};

// ---------------------------------------------------------------------
// Room by room. Each room has three choices: Fine (nothing), Refresh and
// Replace, each adding these line items. "repeat" says how many cards to
// show (e.g. one per bedroom). "only" hides a room for other property
// types (a flat usually has no garden or roof of its own).
// ---------------------------------------------------------------------
const REFURB_ROOMS = [
  { id: 'kitchen', label: 'Kitchen',
    refreshHint: 'Paint and new floor', replaceHint: 'New kitchen, plaster, sockets',
    refresh: [
      { key: 'painting.full-room-paint', qty: 1 },
      { key: 'flooring.vinyl-m2', qty: 8 },
    ],
    replace: [
      { key: 'bathroom-kitchen-supply.kitchen-supply-only', qty: 1 },
      { key: 'bathroom-kitchen-supply.kitchen-fit-only', qty: 1 },
      { key: 'plumbing.kitchen-fit', qty: 1 },
      { key: 'plastering.skimming-room', qty: 1 },
      { key: 'painting.full-room-paint', qty: 1 },
      { key: 'flooring.vinyl-m2', qty: 8 },
      { key: 'electrics.plug-socket', qty: 4 },
    ] },
  { id: 'bathroom', label: 'Bathroom', repeat: 'bathrooms',
    refreshHint: 'Paint and regrout', replaceHint: 'New suite, tiling, plaster',
    refresh: [
      { key: 'painting.full-room-paint', qty: 1 },
      { key: 'bathroom-kitchen-supply.grouting-m2', qty: 6 },
    ],
    replace: [
      { key: 'bathroom-kitchen-supply.bathroom-supply-only', qty: 1 },
      { key: 'bathroom-kitchen-supply.bathroom-fit', qty: 1 },
      { key: 'bathroom-kitchen-supply.tiling-m2', qty: 12 },
      { key: 'flooring.vinyl-m2', qty: 4 },
      { key: 'plastering.skimming-room', qty: 1 },
      { key: 'electrics.ip-rated-pendant', qty: 1 },
    ] },
  { id: 'bedroom', label: 'Bedroom', repeat: 'beds',
    refreshHint: 'Paint and carpet', replaceHint: 'Plaster, paint, carpet, door, sockets',
    refresh: [
      { key: 'painting.full-room-paint', qty: 1 },
      { key: 'flooring.carpet-m2', qty: 12 },
    ],
    replace: [
      { key: 'plastering.skimming-room', qty: 1 },
      { key: 'painting.full-room-paint', qty: 1 },
      { key: 'flooring.carpet-m2', qty: 12 },
      { key: 'electrics.plug-socket', qty: 2 },
      { key: 'joinery.standard-door-supply', qty: 1 },
      { key: 'joinery.standard-door-fit', qty: 1 },
    ] },
  { id: 'living', label: 'Living area', repeat: 'livingRooms',
    refreshHint: 'Paint and carpet', replaceHint: 'Plaster, paint, new floor, door, sockets',
    refresh: [
      { key: 'painting.full-room-paint', qty: 1 },
      { key: 'flooring.carpet-m2', qty: 16 },
    ],
    replace: [
      { key: 'plastering.skimming-room', qty: 1 },
      { key: 'painting.full-room-paint', qty: 1 },
      { key: 'flooring.laminate-m2', qty: 16 },
      { key: 'electrics.plug-socket', qty: 3 },
      { key: 'joinery.standard-door-supply', qty: 1 },
      { key: 'joinery.standard-door-fit', qty: 1 },
    ] },
  { id: 'hallway', label: 'Hallway and stairs',
    refreshHint: 'Paint and carpet', replaceHint: 'Plaster, paint, new floor',
    refresh: [
      { key: 'painting.full-room-paint', qty: 1 },
      { key: 'flooring.carpet-m2', qty: 8 },
    ],
    replace: [
      { key: 'plastering.skimming-room', qty: 1 },
      { key: 'painting.full-room-paint', qty: 1 },
      { key: 'flooring.laminate-m2', qty: 6 },
      { key: 'flooring.carpet-m2', qty: 6 },
    ] },
  { id: 'exterior', label: 'Exterior', only: ['terrace', 'semi', 'detached'],
    refreshHint: 'Some repointing and guttering', replaceHint: 'Repoint, guttering, windows, front door',
    refresh: [
      { key: 'masonry.repointing-m2', qty: 10 },
      { key: 'plumbing.guttering', qty: 10 },
    ],
    replace: [
      { key: 'masonry.repointing-m2', qty: 40 },
      { key: 'plumbing.guttering', qty: 20 },
      { key: 'windows-doors.small-window', qty: 'windows' },
      { key: 'windows-doors.upvc-door', qty: 1 },
    ] },
  { id: 'garden', label: 'Garden', only: ['terrace', 'semi', 'detached'],
    refreshHint: 'Clear it', replaceHint: 'Clear, new lawn and patio',
    refresh: [
      { key: 'garden.garden-clear', qty: 1 },
    ],
    replace: [
      { key: 'garden.garden-clear', qty: 1 },
      { key: 'garden.new-lawn-m2', qty: { m: 'gardenArea', x: 0.6 } },
      { key: 'garden.patio-m2', qty: 12 },
      { key: 'demolition.skip-8yd', qty: 1 },
    ] },
  // Whole house items
  { id: 'rewire', label: 'Electrics (rewire)', wholeHouse: true,
    refreshHint: 'New consumer unit, test, extra sockets', replaceHint: 'Full rewire',
    refresh: [
      { key: 'electrics.consumer-unit', qty: 1 },
      { key: 'electrics.eicr-test', qty: 1 },
      { key: 'electrics.plug-socket', qty: 4 },
    ],
    replace: [
      { key: 'electrics.full-rewire', qty: 1 },
      { key: 'electrics.consumer-unit', qty: 1 },
      { key: 'electrics.eicr-test', qty: 1 },
    ] },
  { id: 'boiler', label: 'Heating and boiler', wholeHouse: true,
    refreshHint: 'Service, gas certificate, a couple of radiators', replaceHint: 'New boiler and radiators',
    refresh: [
      { key: 'plumbing.gas-safety-cert', qty: 1 },
      { key: 'plumbing.radiators', qty: 2 },
    ],
    replace: [
      { key: 'plumbing.boiler-supply-fit', qty: 1 },
      { key: 'plumbing.radiators', qty: 'radiators' },
      { key: 'plumbing.gas-safety-cert', qty: 1 },
    ] },
  { id: 'damp', label: 'Damp', wholeHouse: true,
    refreshHint: 'Treat a small area', replaceHint: 'Damp proof course and replaster',
    refresh: [
      { key: 'masonry.dpc-metre', qty: 5 },
      { key: 'plastering.skimming-m2', qty: 5 },
    ],
    replace: [
      { key: 'masonry.dpc-metre', qty: 30 },
      { key: 'plastering.skimming-m2', qty: 20 },
    ] },
  { id: 'roof', label: 'Roof', wholeHouse: true, only: ['terrace', 'semi', 'detached'],
    refreshHint: 'Repairs with scaffolding', replaceHint: 'New roof',
    refresh: [
      { key: 'roofing.chimney-flashing', qty: 1 },
      { key: 'roofing.scaffolding', qty: 1 },
    ],
    replace: [
      { key: 'roofing.new-roof-full', qty: 1 },
      { key: 'roofing.scaffolding', qty: 1 },
    ] },
];

// ---------------------------------------------------------------------
// Helpers (no DOM). Used by refurb.html.
// ---------------------------------------------------------------------
function refurbResolveQty(rule, measures) {
  const q = rule.qty;
  if (typeof q === 'number') return q;
  if (typeof q === 'string') return measures[q] || 0;
  if (q && typeof q === 'object') {
    const base = measures[q.m] || 0;
    const v = base * (q.x != null ? q.x : 1) + (q.plus || 0);
    return Math.ceil(v);
  }
  return 0;
}

function refurbRuleApplies(rule, type) {
  return !rule.only || rule.only.indexOf(type) !== -1;
}

// { "<key>": qty } for a template. Quantities for the same key add up.
function refurbTemplateQuantities(type, beds, scope) {
  const s = REFURB_SCOPES[scope];
  if (!s) return {};
  const m = refurbMeasures(type, beds);
  const out = {};
  s.items.forEach(rule => {
    if (!refurbRuleApplies(rule, type)) return;
    const q = refurbResolveQty(rule, m);
    if (q > 0) out[rule.key] = (out[rule.key] || 0) + q;
  });
  return out;
}

function refurbSuggestedWeeks(type, beds, scope) {
  const d = REFURB_DURATION_WEEKS[scope];
  if (!d) return null;
  const b = Math.max(1, Math.min(5, Number(beds) || 2));
  const f = REFURB_DURATION_WEEKS.typeFactor[type] || 1;
  return Math.max(1, Math.round((d.base + d.perExtraBed * (b - 2)) * f));
}

// The room cards to show for a property: [{ cardId, room, label }].
function refurbRoomCards(type, beds) {
  const m = refurbMeasures(type, beds);
  const cards = [];
  REFURB_ROOMS.forEach(room => {
    if (!refurbRuleApplies(room, type)) return;
    const n = room.repeat ? (m[room.repeat] || 0) : 1;
    for (let i = 1; i <= n; i++) {
      cards.push({ cardId: n > 1 || room.repeat === 'beds' ? room.id + '-' + i : room.id, room, label: n > 1 || room.repeat === 'beds' ? room.label + ' ' + i : room.label });
    }
  });
  return cards;
}

// { "<key>": qty } from room choices: { "<cardId>": { condition } }.
function refurbRoomQuantities(type, beds, choices) {
  const m = refurbMeasures(type, beds);
  const out = {};
  refurbRoomCards(type, beds).forEach(card => {
    const c = choices && choices[card.cardId] && choices[card.cardId].condition;
    if (c !== 'refresh' && c !== 'replace') return;
    (card.room[c] || []).forEach(rule => {
      if (!refurbRuleApplies(rule, type)) return;
      const q = refurbResolveQty(rule, m);
      if (q > 0) out[rule.key] = (out[rule.key] || 0) + q;
    });
  });
  return out;
}

// Every item key any room choice can set (so changing a room can clear it).
function refurbRoomItemKeys() {
  const keys = new Set();
  REFURB_ROOMS.forEach(r => ['refresh', 'replace'].forEach(c => (r[c] || []).forEach(rule => keys.add(rule.key))));
  return [...keys];
}

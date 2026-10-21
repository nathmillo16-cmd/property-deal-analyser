// refurb-totals.js — the refurb line-item catalogue and pure total-
// computation logic, shared between refurb.html (the estimator itself) and
// saved-deals.html (the Deal Workspace's Refurb section, which needs to
// show a linked estimate's grand total without re-deriving it). Moved out
// of refurb.html rather than duplicated, since REFURB_SECTIONS is a sizeable
// catalogue that would otherwise drift between two copies if ever edited.
//
// Pure arithmetic — never touches the DOM. refurb_estimates rows only ever
// store what the user typed (line_items/mode/contingency/vat), never a
// computed total, so anything showing a total runs it through here.

const REFURB_SECTIONS = [
  { id:'demolition', name:'Demolition & Alterations', items:[
    { id:'strip-out', label:'Strip out', unit:'item', rate:null },
    { id:'skip-8yd', label:'Skip 8yd (without permit)', unit:'each', rate:null },
    { id:'skip-12yd', label:'Skip 12yd (without permit)', unit:'each', rate:null },
    { id:'skip-permit', label:'Skip permit', unit:'each', rate:null },
  ]},
  { id:'masonry', name:'Masonry & Groundworks', items:[
    { id:'extension-m2', label:'Extension per m²', unit:'m²', rate:null },
    { id:'repointing-m2', label:'Repointing per m²', unit:'m²', rate:null, note:'Incl. materials/travel/time; add extra for raking out mortar' },
    { id:'underpinning-m2', label:'Underpinning per m²', unit:'m²', rate:null },
    { id:'large-lintel', label:'Large lintel incl. fit', unit:'each', rate:null },
    { id:'small-lintel', label:'Small lintel incl. fit', unit:'each', rate:null },
    { id:'beams', label:'Beams incl. fit', unit:'each', rate:null },
    { id:'rendering-m2', label:'Rendering per m²', unit:'m²', rate:null },
    { id:'dpc-metre', label:'DPC per metre', unit:'linear m', rate:null },
    { id:'brick-big-window', label:'Brick up big window', unit:'each', rate:null, note:'2 days incl. materials' },
    { id:'brick-small-window', label:'Brick up small window', unit:'each', rate:null, note:'1 day incl. materials' },
    { id:'structural-engineer', label:'Structural engineer', unit:'item', rate:null },
  ]},
  { id:'roofing', name:'Roofing & Scaffolding', items:[
    { id:'new-roof-m2', label:'New roof per m²', unit:'m²', rate:null },
    { id:'new-roof-full', label:'New roof (full)', unit:'item', rate:null },
    { id:'scaffolding', label:'Scaffolding', unit:'item', rate:null },
    { id:'chimney-flashing', label:'Chimney flashing', unit:'each', rate:null },
  ]},
  { id:'plastering', name:'Plastering', items:[
    { id:'skimming-room', label:'Skimming per room', unit:'room', rate:null },
    { id:'skimming-m2', label:'Skimming per m²', unit:'m²', rate:null },
    { id:'boarding-m2', label:'Boarding per m²', unit:'m²', rate:null },
    { id:'boarding-ceiling', label:'Boarding ceiling', unit:'room', rate:null },
  ]},
  { id:'joinery', name:'Joinery', items:[
    { id:'skirting-m2', label:'Skirting per m²', unit:'m²', rate:null },
    { id:'fire-door-fit', label:'Fire door fit only', unit:'each', rate:null },
    { id:'fire-door-supply', label:'Fire door supply only', unit:'each', rate:null },
    { id:'standard-door-supply', label:'Standard door supply only', unit:'each', rate:null },
    { id:'standard-door-fit', label:'Standard door fit only', unit:'each', rate:null },
    { id:'ironmongery', label:'Ironmongery', unit:'each', rate:null },
    { id:'stud-walls', label:'Stud walls', unit:'m²', rate:null },
    { id:'roof-rafters', label:'Roof rafters', unit:'each', rate:null },
    { id:'stairs-internal', label:'Stairs internal', unit:'item', rate:null },
  ]},
  { id:'windows-doors', name:'Windows & Doors', items:[
    { id:'small-window', label:'Small window', unit:'each', rate:null },
    { id:'large-window', label:'Large window', unit:'each', rate:null },
    { id:'bifold-doors', label:'Bi-folding doors', unit:'each', rate:null },
    { id:'upvc-door', label:'uPVC door', unit:'each', rate:null },
    { id:'french-door', label:'French door', unit:'each', rate:null },
    { id:'sash-window', label:'Sash window', unit:'each', rate:null },
  ]},
  { id:'electrics', name:'Electrics', items:[
    { id:'full-rewire', label:'Full rewire', unit:'item', rate:null, note:'Includes materials' },
    { id:'consumer-unit', label:'New consumer unit', unit:'each', rate:null },
    { id:'emergency-lighting', label:'Emergency lighting', unit:'each', rate:null },
    { id:'automatic-lighting', label:'Automatic lighting', unit:'each', rate:null },
    { id:'wired-fire-alarm', label:'Wired fire alarm', unit:'each', rate:null },
    { id:'battery-fire-alarm', label:'Battery fire alarm', unit:'each', rate:null },
    { id:'plug-socket', label:'Plug socket', unit:'each', rate:null },
    { id:'light-switch', label:'Light switch', unit:'each', rate:null },
    { id:'ip-rated-pendant', label:'IP rated pendant', unit:'each', rate:null },
    { id:'fire-alarm-system', label:'Fire alarm system', unit:'item', rate:null },
    { id:'cctv-cameras', label:'CCTV cameras', unit:'each', rate:null },
    { id:'eicr-test', label:'EICR test', unit:'item', rate:null },
  ]},
  { id:'plumbing', name:'Plumbing', items:[
    { id:'full-replumb', label:'Full replumb', unit:'item', rate:null },
    { id:'plumber-hourly', label:'Hourly rate for plumber', unit:'hour', rate:null },
    { id:'boiler-supply-fit', label:'Boiler supply & fit', unit:'item', rate:null },
    { id:'guttering', label:'Guttering', unit:'linear m', rate:null },
    { id:'manhole-installation', label:'New manhole installation', unit:'item', rate:null },
    { id:'kitchen-fit', label:'Plumbing day rate', unit:'day', rate:null },
    { id:'gas-safety-cert', label:'Gas safety cert', unit:'item', rate:null },
    { id:'radiators', label:'Radiators', unit:'each', rate:null },
    { id:'boiler-relocation', label:'Boiler relocation', unit:'item', rate:null },
  ]},
  { id:'flooring', name:'Flooring & Tiling', items:[
    { id:'laminate-m2', label:'Laminate per m²', unit:'m²', rate:null },
    { id:'vinyl-m2', label:'Vinyl per m²', unit:'m²', rate:null },
    { id:'grouting-m2', label:'Grouting per m²', unit:'m²', rate:null },
    { id:'herringbone-m2', label:'Herringbone flooring per m²', unit:'m²', rate:null },
    { id:'aqua-panels', label:'Aqua panels', unit:'m²', rate:null },
    { id:'tiling-m2', label:'Tiling per m²', unit:'m²', rate:null, note:'Tiles incl.' },
    { id:'carpet-m2', label:'Carpet per m²', unit:'m²', rate:null },
  ]},
  { id:'bathroom-kitchen-supply', name:'Bathroom & Kitchen', items:[
    { id:'shower-tray', label:'Shower tray', unit:'each', rate:null },
    { id:'shower-enclosure', label:'Shower enclosure', unit:'each', rate:null },
    { id:'toilet', label:'Toilet', unit:'each', rate:null },
    { id:'sink-basin', label:'Sink basin', unit:'each', rate:null },
    { id:'basin-taps', label:'Basin taps', unit:'each', rate:null },
    { id:'bathroom-fit', label:'Bathroom fit', unit:'room', rate:null },
    { id:'bathroom-supply-only', label:'Bathroom supply only', unit:'room', rate:null },
    { id:'kitchen-fit-only', label:'Kitchen fit', unit:'item', rate:null },
    { id:'kitchen-supply-only', label:'Kitchen supply only', unit:'item', rate:null },
    { id:'grouting-m2', label:'Grouting per m²', unit:'m²', rate:null },
    { id:'tiling-m2', label:'Tiling per m²', unit:'m²', rate:null },
  ]},
  { id:'painting', name:'Painting & Decorating', items:[
    { id:'mist-coat-room', label:'Mist coat per room', unit:'room', rate:null },
    { id:'paint-standard-m2', label:'Paint (standard white) per m²', unit:'m²', rate:null, note:'2 coat mist + 1 coat paint' },
    { id:'full-room-paint', label:'Full room paint per room (standard white)', unit:'room', rate:null },
    { id:'wallpaper-m2', label:'Wallpaper per m²', unit:'m²', rate:null },
    { id:'feature-wall', label:'Feature wall', unit:'each', rate:null },
    { id:'sanding-patching-m2', label:'Sanding & patching per m²', unit:'m²', rate:null },
  ]},
  { id:'garden', name:'Garden & Landscaping', items:[
    { id:'garden-clear', label:'Garden clear', unit:'item', rate:null },
    { id:'new-lawn-m2', label:'New lawn per m²', unit:'m²', rate:null },
    { id:'slabbing-paving-m2', label:'Slabbing/paving per m²', unit:'m²', rate:null },
    { id:'patio-m2', label:'Patio per m²', unit:'m²', rate:null },
    { id:'decking-m2', label:'Decking per m²', unit:'m²', rate:null },
  ]},
  // Energy efficiency (EPC) upgrades. Added October 2026. The current and
  // target EPC ratings for an estimate live in its details, not here.
  { id:'epc', name:'Energy efficiency (EPC)', items:[
    { id:'loft-insulation', label:'Loft insulation', unit:'m²', rate:null },
    { id:'cavity-wall-insulation', label:'Cavity wall insulation', unit:'m²', rate:null },
    { id:'solid-wall-insulation', label:'Solid wall insulation (internal or external)', unit:'m²', rate:null },
    { id:'double-glazing', label:'Double glazing', unit:'each', rate:null, note:'Per window' },
    { id:'heating-upgrade', label:'Heating system or boiler upgrade', unit:'item', rate:null },
    { id:'heating-controls', label:'Heating controls (programmer, thermostat, TRVs)', unit:'item', rate:null },
    { id:'led-lighting', label:'LED lighting', unit:'room', rate:null },
    { id:'cylinder-insulation', label:'Hot water cylinder insulation', unit:'item', rate:null },
  ]},
];

// Units shown next to Qty. Every catalogue item above has one.
const REFURB_UNITS = ['each','m²','linear m','day','hour','room','item'];

const QUICK_TRADES = [
  { id:'electrics', label:'Electrics' },
  { id:'plumbing', label:'Plumbing' },
  { id:'bathroom', label:'Bathroom' },
  { id:'kitchen', label:'Kitchen' },
  { id:'plastering', label:'Plastering' },
  { id:'painting', label:'Painting & decorating' },
  { id:'flooring', label:'Flooring & tiling' },
  { id:'roofing', label:'Roofing' },
  { id:'windows-doors', label:'Windows & doors' },
  { id:'masonry', label:'Masonry/structural' },
  { id:'garden', label:'Garden & landscaping' },
  { id:'demolition', label:'Demolition/strip-out' },
  { id:'epc', label:'Energy efficiency (EPC)' },
];

// Every detailed line item as a flat list with its composite key
// ("<sectionId>.<itemId>", the same key saved estimates use).
function refurbItemList(){
  const out=[];
  REFURB_SECTIONS.forEach(s=>s.items.forEach(it=>out.push({ key:s.id+'.'+it.id, sectionId:s.id, sectionName:s.name, item:it })));
  return out;
}
function refurbItemByKey(key){
  const [sid,iid]=String(key).split('.');
  const s=REFURB_SECTIONS.find(x=>x.id===sid);
  const it=s&&s.items.find(x=>x.id===iid);
  return it?{ key, sectionId:sid, sectionName:s.name, item:it }:null;
}

function computeDetailedSubtotal(lineItems){
  let total=0; const sectionTotals={};
  REFURB_SECTIONS.forEach(s=>{
    let sTotal=0;
    s.items.forEach(it=>{
      const li=lineItems[`${s.id}.${it.id}`];
      const rate=li&&li.rate!=null?li.rate:0;
      const qty=li&&li.qty!=null?li.qty:0;
      sTotal += rate*qty;
    });
    sectionTotals[s.id]=sTotal;
    total+=sTotal;
  });
  return { total, sectionTotals };
}

function computeQuickSubtotal(lineItems){
  let total=0;
  QUICK_TRADES.forEach(t=>{ total += (lineItems[t.id]||0); });
  return total;
}

function computeTotals(mode, lineItems, contingencyEnabled, contingencyPct, vatRate){
  const subtotal = mode==='quick' ? computeQuickSubtotal(lineItems) : computeDetailedSubtotal(lineItems).total;
  const contingencyAmt = contingencyEnabled ? subtotal*(contingencyPct/100) : 0;
  const vatAmt = (subtotal+contingencyAmt)*(vatRate/100);
  const grandTotal = subtotal+contingencyAmt+vatAmt;
  return { subtotal, contingencyAmt, vatAmt, grandTotal };
}

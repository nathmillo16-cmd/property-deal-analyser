// rerun-prefill.js — builds the one-shot sessionStorage handoff that lets
// the calculator (index.html, see applyRerunPayload()/autoSaveRerun() there)
// be prefilled with a saved deal's full input set, with its refurb figure
// overridden to a new value, then automatically recalculated and saved back
// over that same deal (deal.id, carried in the payload as dealId). Shared
// between refurb.html (after linking an estimate to a deal, optionally
// re-running straight away) and saved-deals.html (the Deal Workspace's
// read-only Refurb section, when a linked estimate's total differs from
// the deal's own analysed figure) — both need the identical per-strategy
// mapping, so this lives in one place rather than two copies that could
// drift.
//
// Per-strategy field maps translate deal_data's keys back onto the
// calculator's own input ids; a few need a small transform rather than a
// straight copy (HMO's council tax is stored monthly, the input takes an
// annual figure; BRRR's refinance % and type carry across too). HMO's
// four-room breakdown was only ever saved going forward (see cHMO()'s
// roomBreakdown) — a deal saved before that falls back to a single
// synthetic room sized to the deal's total rent, flagged via roomsFellBack
// so index.html can show a short note about it.
function buildRerunFields(deal, newRef){
  const type=deal.deal_type, d=deal.deal_data||{};
  const fields={};
  let roomsFellBack=false;

  if(type==='btl'){
    Object.assign(fields,{
      'b-pp':d.pp,'b-emv':d.emv,'b-rent':d.rent,'b-mr':d.mr,'b-dp':d.dp,
      'b-ref':newRef,'b-sol':d.sol,'b-mf':d.mf,'b-srch':d.srch,'b-ins':d.ins,
      'b-mgmt':d.mgmt,'b-maint':d.maint,'b-ty':d.ty,'b-tr':d.tr,'b-term':d.term,
    });
    if(d.brrrLtv!=null)fields['bb-refi-ltv']=d.brrrLtv;
    if(d.brrrType)fields['__dd_bb-refi-type']=d.brrrType;
  }else if(type==='hmo'){
    let rooms=d.roomBreakdown;
    if(!Array.isArray(rooms)||rooms.length!==4){
      roomsFellBack=true;
      rooms=[{price:d.totalRent||0,count:(d.totalRent||0)>0?1:0},{price:0,count:0},{price:0,count:0},{price:0,count:0}];
    }
    Object.assign(fields,{
      'h-pp':d.pp,'h-emv':d.emv,'h-mr':d.mr,'h-dp':d.dp,'h-ref':newRef,'h-sol':d.sol,'h-mf':d.mf,
      'h-lic':d.lic,'h-srch':d.srch,'h-ins':d.ins,'h-wifi':d.wifi,'h-ct':(d.ctMonthly||0)*12,
      'h-maint':d.maint,'h-mgmt':d.mgmt,'h-ty':d.ty,'h-troi':d.troi,'h-term':d.term,
      'h-r1p':rooms[0].price,'h-r1n':rooms[0].count,'h-r2p':rooms[1].price,'h-r2n':rooms[1].count,
      'h-r3p':rooms[2].price,'h-r3n':rooms[2].count,'h-r4p':rooms[3].price,'h-r4n':rooms[3].count,
    });
    if(d.brrrLtv!=null)fields['hb-refi-ltv']=d.brrrLtv;
    if(d.brrrType)fields['__dd_hb-refi-type']=d.brrrType;
  }else if(type==='sa'){
    Object.assign(fields,{
      'sa-rate':d.rate,'sa-occ':d.occ,'sa-pp':d.pp,'sa-emv':d.emv,'sa-mr':d.mr,'sa-dp':d.dp,
      'sa-sol':d.sol,'sa-mf':d.mf,'sa-srch':d.srch,'sa-ref':newRef,'sa-furn':d.furn,'sa-wg':d.wg,
      'sa-mgmt':d.mgmt,'sa-util':d.util,'sa-maint':d.maint,'sa-clean':d.clean,'sa-ins':d.ins,'sa-ct':d.ct,
      'sa-ty':d.ty,'sa-troi':d.troi,'sa-term':d.term,
    });
    if(d.brrrLtv!=null)fields['sab-refi-ltv']=d.brrrLtv;
    if(d.brrrType)fields['__dd_sab-refi-type']=d.brrrType;
  }else if(type==='flip'){
    Object.assign(fields,{
      'fl-pp':d.pp,'fl-bf':d.bf,'fl-ref':newRef,'fl-sv':d.sv,
      'fl-agent':d.agentPct,'fl-cont':d.contPct,'fl-troi':d.troi,
    });
  }else{
    return null;
  }

  return {strategy:type,fields,roomsFellBack,dealId:deal.id};
}

function goToRerun(deal, newRef){
  const payload=buildRerunFields(deal,newRef);
  if(!payload)return;
  sessionStorage.setItem('dny-rerun',JSON.stringify(payload));
  window.location.href='index.html';
}

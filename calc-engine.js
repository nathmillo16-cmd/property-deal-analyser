// Verified calculation core — BTL/HMO/SA/Flip, stamp duty, mortgage interest.
// Shared by index.html (real calculator) and landing.html (free taster).
// Do not edit formulas here without explicit instruction — see CLAUDE.md.

// ---------------------------------------------------------------------
// STAMP DUTY CONFIG: the one place to change rates after a Budget.
// SDLT for England and Northern Ireland, additional property (higher)
// rates, in force since 1 April 2025. Each band's rate applies only to the
// part of the price inside that band.
// Last verified: October 2026.
// ---------------------------------------------------------------------
const STAMP_DUTY_CONFIG={
  region:'England and NI',
  // Under this price the additional property surcharge doesn't apply, so
  // standard rates are used instead, which are 0% at this price.
  surchargeThreshold:40000,
  belowThresholdTax:0,
  bands:[
    {upTo:125000,  rate:5},
    {upTo:250000,  rate:7},
    {upTo:925000,  rate:10},
    {upTo:1500000, rate:15},
    {upTo:Infinity,rate:17}
  ]
};

function sdltAmount(n){
  if(n>=1000000&&n%10000===0)return '£'+(n/1000000)+'m';
  if(n>=1000&&n%1000===0)return '£'+(n/1000)+'k';
  return '£'+Math.round(n).toLocaleString();
}

function stamp(p){
  const cfg=STAMP_DUTY_CONFIG;
  let tax=0;const detail=[];
  if(!(p>0))return{total:0,detail};
  if(p<cfg.surchargeThreshold){
    tax=cfg.belowThresholdTax;
    detail.push('under '+sdltAmount(cfg.surchargeThreshold)+', no surcharge, standard rates are 0% at this price');
    return{total:Math.round(tax),detail};
  }
  let from=0;
  for(const band of cfg.bands){
    if(p<=from)break;
    const to=Math.min(p,band.upTo);
    const part=(to-from)*band.rate/100;
    tax+=part;
    detail.push(sdltAmount(from)+' to '+sdltAmount(to)+' @ '+band.rate+'% = £'+Math.round(part).toLocaleString());
    from=band.upTo;
  }
  return{total:Math.round(tax),detail};
}
function mort(loan,rate){return(loan*rate/100)/12;}
// Max-bid check (owner's sign-off, 2026-10-22). Stamp duty jumps from £0 to
// £2,000 at £40,000, so a max-bid search can land on exactly £40,000 when the
// real answer is £39,999 (at £40,000 the ROI falls well short of the target).
// After each ROI max-bid search, check the whole-pound figure actually meets
// the target (to the 2 decimal places ROI is shown at); if it doesn't, step it
// down £1 at a time until it does. Away from that jump the figure already
// meets the target, so it is returned untouched. Not-achievable results (on
// the search floor) and over-ceiling results are also returned untouched.
function bidMeetingTarget(bid,roiAt,target,floor,ceiling){
  let p=Math.round(bid);
  if(!(p>floor+1)||p>=ceiling)return bid;
  if(roiAt(p)>=target-0.005)return bid;
  for(let n=0;n<5000&&p>floor+1;n++){p--;if(roiAt(p)>=target-0.005)return p;}
  return bid;
}
function mortRepay(loan,rate,termYears){
  const r=(rate/100)/12, n=termYears*12;
  if(n<=0) return 0;
  if(r===0) return loan/n;
  return loan*r*Math.pow(1+r,n)/(Math.pow(1+r,n)-1);
}
function fmt(n){return'£'+Math.round(n).toLocaleString();}
function fP(n){return n.toFixed(2)+'%';}
function cl(v,g,w){return v>=g?'good':v>=w?'warn':'bad';}
function s(id,val,cls){const e=document.getElementById(id);if(e){e.textContent=val;if(cls!==undefined)e.className='mv '+(cls||'');}}
// Money inputs can now display thousands separators (e.g. "110,000") —
// reads the same way +el.value||0 always has, just strips commas first.
// Input-reading only, no calculation logic touched.
// Number input with a default: the default applies only when the field is
// BLANK (or missing from the page). A typed 0 is respected as 0, e.g. 0%
// management, 0% maintenance, 0% deposit. Previously "+value||default",
// which also swapped a typed 0 for the default.
function numOr(id,def){
  const el=document.getElementById(id);
  if(!el) return def;
  const raw=String(el.value).trim();
  if(raw==='') return def;
  const n=+raw;
  return Number.isFinite(n)?n:def;
}
function moneyVal(id){
  const el=document.getElementById(id);
  if(!el) return 0;
  const n=+String(el.value).replace(/,/g,'');
  return Number.isFinite(n)?n:0;
}

let btlData={}, hmoData={}, saData={}, flipData={};

// Voids, letting fee and safety certificates (BTL/BRRR and HMO), added on
// the owner's explicit instruction, 2026-10-21. Display only: the lines
// shown in the Full breakdown. Empty when none of the three is set.
function runCostLines(grossYear,voidPct,letFee,certs){
  if(!(voidPct>0||letFee>0||certs>0))return '';
  const line=(l,v)=>'<p class="rc-line"><span>'+l+'</span><span>'+v+'</span></p>';
  let h='<p><b>Rent and yearly costs</b></p>'+line('Rent a year',fmt(grossYear));
  if(voidPct>0)h+=line('Voids, '+(+(voidPct*100).toFixed(2))+'% of rent','-'+fmt(grossYear*voidPct))+line('Rent after voids',fmt(grossYear*(1-voidPct)));
  if(letFee>0)h+=line('Letting fee a year','-'+fmt(letFee));
  if(certs>0)h+=line('Safety certificates a year','-'+fmt(certs));
  return h+'<p class="xc-note">Voids come off the rent for cashflow, net yield, ROI and the ROI max bid. Gross yield, the yield max bid, HMO bills and the lender check use the full rent.</p>';
}

function cBTL(){
  const pp=moneyVal('b-pp');
  const emv=moneyVal('b-emv');
  // Voids come off the rent before every other figure, so from here on
  // `rent` is the rent after voids. grossRent is kept for the lender check
  // (saved as btlData.rent). Letting fee and certificates are yearly costs,
  // taken monthly as annC. All three are 0 when blank, so every figure is
  // exactly as before unless one is set (owner's instruction, 2026-10-21).
  const grossRent=moneyVal('b-rent');
  const voidPct=numOr('b-voids',0)/100;
  const letFee=moneyVal('b-letfee'), certs=moneyVal('b-certs');
  const rent=grossRent*(1-voidPct);
  const annC=(letFee+certs)/12;
  const mr=+document.getElementById('b-mr').value||0;
  const dp=(numOr('b-dp',25))/100;
  const ref=moneyVal('b-ref');
  const sol=moneyVal('b-sol');
  const mf=moneyVal('b-mf');
  const srch=moneyVal('b-srch');
  const ins=moneyVal('b-ins');
  const mgmt=(+document.getElementById('b-mgmt').value||0)/100;
  const maint=(numOr('b-maint',10))/100;
  const ty=numOr('b-ty',7);
  const tr=numOr('b-tr',15);
  const btermEl=document.getElementById('b-term');
  const term=numOr('b-term',25);

  const dep=pp*dp, loan=pp-dep, mm=mort(loan,mr), sd=stamp(pp);
  const maintC=rent*maint, mgmtC=rent*mgmt;
  const mNm=rent-ins-annC-maintC-mgmtC-mm, mNy=mNm*12;
  const cNm=rent-maintC-ins-annC-mgmtC, cNy=cNm*12;
  // Gross yield and the yield max bid use the full rent: voids only affect
  // the net figures (cashflow, ROI, net yield, ROI max bids). Owner's
  // instruction, 2026-10-21.
  const ag=grossRent*12;
  // Stamp duty is part of the cash needed to buy, so it counts in total
  // investment, money left in, ROI and max bid (same as HMO and Flip).
  // Added on the owner's explicit instruction, October 2026.
  const mTI=sol+mf+srch+dep+ref+sd.total, cTI=pp+sol+mf+srch+ref+sd.total;
  // Gross yield is on PURCHASE PRICE (the main figure, owner's explicit
  // instruction, 2026-10-21; it used to be on end value). gyEmv keeps the
  // end-value version, shown alongside and labelled "on end value". Net
  // yields stay on end value. The yield max bid (oY = annual rent / target)
  // is the price at which gross yield on price hits the target.
  const gy=pp>0?(ag/pp)*100:0, gyEmv=emv>0?(ag/emv)*100:0, mny=emv>0?(mNy/emv)*100:0, cny=emv>0?(cNy/emv)*100:0;
  const mMLI=cTI-loan, mROI=mMLI!==0?(mNy/mMLI)*100:0, cROI=cTI>0?(cNy/cTI)*100:0;
  const mPB=mNy!==0?mMLI/mNy:0, cPB=cNy>0?cTI/cNy:0;

  // BRRR — its own financing tab now (see the fin-tab buttons), not a Cash-
  // tab toggle. Cash tab above is pure cash-and-hold, unaffected by
  // refinancing. Refinance loan is EMV-based (a refinance lender lends
  // against the post-refurb valuation), independent of purchase price —
  // unlike the purchase mortgage above. Defensive reads so this is a no-op
  // on any page without this markup, e.g. landing.html's taster calculator.
  const bbRefiLtvEl=document.getElementById('bb-refi-ltv');
  const bbRefiLtv=(numOr('bb-refi-ltv',75))/100;
  const bbRefiType=(typeof getDDValue==='function'&&getDDValue('bb-refi-type'))||'io';
  const bbRefiLoan=emv*bbRefiLtv;
  const bbRefiPay=bbRefiType==='repay'?mortRepay(bbRefiLoan,mr,term):mort(bbRefiLoan,mr);
  const bbNm=rent-ins-annC-maintC-mgmtC-bbRefiPay, bbNy=bbNm*12;
  const bbMLI=cTI-bbRefiLoan;
  const bbny=emv>0?(bbNy/emv)*100:0;
  const bbROI=bbMLI!==0?(bbNy/bbMLI)*100:0;
  const bbPB=bbNy!==0?bbMLI/bbNy:0;

  const rmm=mortRepay(loan,mr,term);
  const rNm=rent-ins-annC-maintC-mgmtC-rmm, rNy=rNm*12;
  const rny=emv>0?(rNy/emv)*100:0;
  const rROI=mMLI!==0?(rNy/mMLI)*100:0;
  const rPB=rNy!==0?mMLI/rNy:0;

  const oY=ag/(ty/100);

  // Max bid via bisection, not closed-form: loan (and so the mortgage
  // payment) now depends on the candidate price itself, since deposit is
  // derived from price, not EMV — the old "+loan" trick assumed loan was a
  // fixed constant, which is no longer true. Matches HMO/Flip's existing,
  // proven bisection pattern rather than re-deriving closed-form algebra.
  let oR=0;
  {
    const roiAt=mid=>{
      const depM=mid*dp, loanM=mid-depM, mmM=mort(loanM,mr);
      const mNyM=(rent-ins-annC-maintC-mgmtC-mmM)*12;
      const mMLIM=(mid+sol+mf+srch+ref+stamp(mid).total)-loanM;
      return mMLIM!==0?(mNyM/mMLIM)*100:0;
    };
    let lo=10000,hi=2000000;
    for(let i=0;i<80;i++){
      const mid=(lo+hi)/2;
      if(roiAt(mid)>tr)lo=mid;else hi=mid;
    }
    oR=bidMeetingTarget((lo+hi)/2,roiAt,tr,10000,1900000);
  }

  let roR=0;
  {
    const roiAt=mid=>{
      const depM=mid*dp, loanM=mid-depM, rmmM=mortRepay(loanM,mr,term);
      const rNyM=(rent-ins-annC-maintC-mgmtC-rmmM)*12;
      const mMLIM=(mid+sol+mf+srch+ref+stamp(mid).total)-loanM;
      return mMLIM!==0?(rNyM/mMLIM)*100:0;
    };
    let lo=10000,hi=2000000;
    for(let i=0;i<80;i++){
      const mid=(lo+hi)/2;
      if(roiAt(mid)>tr)lo=mid;else hi=mid;
    }
    roR=bidMeetingTarget((lo+hi)/2,roiAt,tr,10000,1900000);
  }

  // BRRR max bid for the target ROI (owner's sign-off, 2026-10-22): the
  // highest price where cashflow after refinance / money left in after
  // refinance reaches the target ROI; getting all the money out counts as
  // reaching it. Cashflow after refinance (bbNy) doesn't depend on price
  // (rent and the refinance loan are both end-value based), so this is the
  // highest price where money left in <= bbNy / target. Money left in only
  // rises with price, so a halving search finds it, and Math.floor keeps the
  // result on the side that meets the target. 0 (not achievable) when the
  // cashflow after refinance is £0 or less.
  let bbOR=0;
  if(bbNy>0&&tr>0){
    const maxLeftIn=bbNy/(tr/100);
    const leftInAt=p=>(p+sol+mf+srch+ref+stamp(p).total)-bbRefiLoan;
    let lo=10000,hi=2000000;
    for(let i=0;i<80;i++){
      const mid=(lo+hi)/2;
      if(leftInAt(mid)<=maxLeftIn)lo=mid;else hi=mid;
    }
    bbOR=Math.floor(lo);
  }

  document.getElementById('b-ly').textContent=ty;
  document.getElementById('b-lr').textContent=tr;
  s('bm-nm',fmt(mNm),cl(mNm,200,0));s('bm-ny',fmt(mNy),cl(mNy,2400,0));
  s('bm-gy',fP(gy),cl(gy,7,5));s('bm-gye',fP(gyEmv),cl(gyEmv,7,5));s('bm-ny2',fP(mny),cl(mny,4,2));
  s('bm-roi',fP(mROI),cl(mROI,15,8));s('bm-ti',fmt(mTI));
  s('bm-mli',fmt(mMLI),mMLI<=0?'good':'');s('bm-pb',mPB!==0?Math.abs(mPB).toFixed(2)+' yrs':'N/A');
  s('bm-loan',fmt(loan));s('bm-rate',fP(mr));s('bm-deposit',fmt(dep));s('bm-mpay',fmt(mm));
  s('bc-nm',fmt(cNm),cl(cNm,200,0));s('bc-ny',fmt(cNy),cl(cNy,2400,0));
  s('bc-gy',fP(gy),cl(gy,7,5));s('bc-gye',fP(gyEmv),cl(gyEmv,7,5));s('bc-ny2',fP(cny),cl(cny,4,2));
  s('bc-roi',fP(cROI),cl(cROI,15,8));s('bc-ti',fmt(cTI));
  s('bc-mli',fmt(cTI));s('bc-pb',cPB>0?cPB.toFixed(2)+' yrs':'N/A');
  s('bb-nm',fmt(bbNm),cl(bbNm,200,0));s('bb-ny',fmt(bbNy),cl(bbNy,2400,0));
  s('bb-gy',fP(gy),cl(gy,7,5));s('bb-gye',fP(gyEmv),cl(gyEmv,7,5));s('bb-ny2',fP(bbny),cl(bbny,4,2));
  s('bb-roi',fP(bbROI),cl(bbROI,15,8));s('bb-ti',fmt(cTI));
  s('bb-mli',fmt(bbMLI),bbMLI<=0?'good':'');s('bb-pb',bbPB!==0?Math.abs(bbPB).toFixed(2)+' yrs':'N/A');
  s('bb-refi-loan',fmt(bbRefiLoan));s('bb-refi-ltv-out',fP(bbRefiLtv*100));
  s('bb-refi-rate',fP(mr));s('bb-refi-mpay',fmt(bbRefiPay));
  s('br-nm',fmt(rNm),cl(rNm,200,0));s('br-ny',fmt(rNy),cl(rNy,2400,0));
  s('br-gy',fP(gy),cl(gy,7,5));s('br-gye',fP(gyEmv),cl(gyEmv,7,5));s('br-ny2',fP(rny),cl(rny,4,2));
  s('br-roi',fP(rROI),cl(rROI,15,8));s('br-ti',fmt(mTI));
  s('br-mli',fmt(mMLI),mMLI<=0?'good':'');s('br-pb',rPB!==0?Math.abs(rPB).toFixed(2)+' yrs':'N/A');
  s('br-loan',fmt(loan));s('br-rate',fP(mr));s('br-deposit',fmt(dep));s('br-mpay',fmt(rmm));s('br-term',term);
  const bRcEl=document.getElementById('b-rc');
  if(bRcEl)bRcEl.innerHTML=runCostLines(grossRent*12,voidPct,letFee,certs);
  document.getElementById('b-sn').innerHTML='Stamp duty (BTL): £'+sd.total.toLocaleString()+(sd.detail.length?' ('+sd.detail.join(' · ')+')':'');
  document.getElementById('b-oy').textContent=fmt(oY);
  document.getElementById('b-oyn').textContent=(oY-pp)<0?fmt(Math.abs(oY-pp))+' below asking':fmt(oY-pp)+' above asking';
  document.getElementById('b-or').textContent=oR>0&&oR<1900000?fmt(oR):'Cannot achieve at these inputs';
  if(oR>0&&oR<1900000)document.getElementById('b-orn').textContent=(oR-pp)<0?fmt(Math.abs(oR-pp))+' below asking':fmt(oR-pp)+' above asking';
  const brorEl=document.getElementById('b-ror');
  if(brorEl) brorEl.textContent=roR>0&&roR<1900000?fmt(roR):'Cannot achieve at these inputs';
  if(roR>0&&roR<1900000){
    const brornEl=document.getElementById('b-rorn');
    if(brornEl) brornEl.textContent=(roR-pp)<0?fmt(Math.abs(roR-pp))+' below asking':fmt(roR-pp)+' above asking';
  }
  const bbborEl=document.getElementById('b-bbor');
  if(bbborEl) bbborEl.textContent=bbOR>0&&bbOR<1900000?fmt(bbOR):'Cannot achieve at these inputs';
  if(bbOR>0&&bbOR<1900000){
    const bbbornEl=document.getElementById('b-bborn');
    if(bbbornEl) bbbornEl.textContent=(bbOR-pp)<0?fmt(Math.abs(bbOR-pp))+' below asking':fmt(bbOR-pp)+' above asking';
  }

  btlData={pp,emv,rent:grossRent,mr,dp:dp*100,
    voids:+(voidPct*100).toFixed(2),letFee,certs,rentAfterVoids:+rent.toFixed(2),voidLossYearly:Math.round(grossRent*voidPct*12),ref,sol,mf,srch,ins,mgmt:mgmt*100,maint:maint*100,ty,tr,term,
    loan:Math.round(loan),deposit:Math.round(dep),monthlyPayment:Math.round(mm),
    mNm:Math.round(mNm),mNy:Math.round(mNy),cNm:Math.round(cNm),cNy:Math.round(cNy),
    gy:+gy.toFixed(2),gyEmv:+gyEmv.toFixed(2),mny:+mny.toFixed(2),cny:+cny.toFixed(2),
    mROI:+mROI.toFixed(2),cROI:+cROI.toFixed(2),
    mMLI:Math.round(mMLI),mTI:Math.round(mTI),cTI:Math.round(cTI),
    mPB:+Math.abs(mPB).toFixed(2),cPB:+cPB.toFixed(2),
    stampDuty:sd.total,oY:Math.round(oY),oR:Math.round(oR),
    meetsYield:gy>=ty,meetsROI:mROI>=tr,
    repaymentMonthlyPayment:Math.round(rmm),rNm:Math.round(rNm),rNy:Math.round(rNy),
    rny:+rny.toFixed(2),rROI:+rROI.toFixed(2),rPB:+Math.abs(rPB).toFixed(2),
    rOR:Math.round(roR),meetsROIRepayment:rROI>=tr,
    bbNm:Math.round(bbNm),bbNy:Math.round(bbNy),bbny:+bbny.toFixed(2),
    bbROI:+bbROI.toFixed(2),bbMLI:Math.round(bbMLI),bbPB:+Math.abs(bbPB).toFixed(2),
    brrrLtv:+(bbRefiLtv*100).toFixed(1),brrrType:bbRefiType,
    brrrLoan:Math.round(bbRefiLoan),brrrPayment:Math.round(bbRefiPay),
    meetsROIBRRR:bbROI>=tr,bbOR:Math.round(bbOR)};
}

function cHMO(){
  const pp=moneyVal('h-pp');
  const emv=moneyVal('h-emv');
  const mr=numOr('h-mr',5);
  const dp=(numOr('h-dp',25))/100;
  const ref=moneyVal('h-ref');
  const sol=moneyVal('h-sol');
  const mf=moneyVal('h-mf');
  const lic=moneyVal('h-lic');
  const srch=moneyVal('h-srch');
  const ins=moneyVal('h-ins');
  const wifi=moneyVal('h-wifi');
  const ct=moneyVal('h-ct')/12;
  const maint=(+document.getElementById('h-maint').value||0)/100;
  const mgmt=(+document.getElementById('h-mgmt').value||0)/100;
  const ty=numOr('h-ty',10);
  const troi=numOr('h-troi',15);
  const htermEl=document.getElementById('h-term');
  const term=numOr('h-term',25);

  const rooms=[[moneyVal('h-r1p'),+document.getElementById('h-r1n').value||0,'h-r1t'],
               [moneyVal('h-r2p'),+document.getElementById('h-r2n').value||0,'h-r2t'],
               [moneyVal('h-r3p'),+document.getElementById('h-r3n').value||0,'h-r3t'],
               [moneyVal('h-r4p'),+document.getElementById('h-r4n').value||0,'h-r4t']];
  let totalRent=0;
  rooms.forEach(([price,num,id])=>{const t=price*num;totalRent+=t;document.getElementById(id).textContent='£'+t.toLocaleString();});
  document.getElementById('h-tr').textContent='£'+totalRent.toLocaleString();
  // Voids, letting fee and certificates, same as BTL (owner's instruction,
  // 2026-10-21): from here totalRent is the rent after voids, used by
  // maintenance, management, cashflow, net yield, ROI and the ROI max bid.
  // Bills (10%), gross yield and the yield max bid stay on the full rent,
  // grossTotalRent, which is also what's saved as hmoData.totalRent.
  const hVoidPct=numOr('h-voids',0)/100;
  const hLetFee=moneyVal('h-letfee'), hCerts=moneyVal('h-certs');
  const hAnnC=(hLetFee+hCerts)/12;
  const grossTotalRent=totalRent;
  totalRent=grossTotalRent*(1-hVoidPct);
  const bills=grossTotalRent*0.1;
  document.getElementById('h-bills').textContent='£'+Math.round(bills).toLocaleString();

  const sd=stamp(pp), dep=pp*dp, loan=pp-dep, mm=mort(loan,mr);
  const maintC=totalRent*maint, mgmtC=totalRent*mgmt;
  const mNm=totalRent-bills-ins-wifi-ct-hAnnC-maintC-mgmtC-mm, mNy=mNm*12;
  const cNm=totalRent-bills-ins-wifi-ct-hAnnC-maintC-mgmtC, cNy=cNm*12;
  const ag=grossTotalRent*12;
  // Searches count in the mortgage total too, same as BTL and SA and the
  // HMO cash total. Added on the owner's explicit instruction, October 2026.
  const mTI=dep+sol+mf+lic+ref+sd.total+srch, cTI=pp+sol+mf+lic+ref+sd.total+srch;
  // Gross yield on PURCHASE PRICE, same as BTL (owner's explicit
  // instruction, 2026-10-21; it used to be on end value). gyEmv keeps the
  // end-value version, shown alongside. Net yields stay on end value.
  const gy=pp>0?(ag/pp)*100:0, gyEmv=emv>0?(ag/emv)*100:0, mny=emv>0?(mNy/emv)*100:0, cny=emv>0?(cNy/emv)*100:0;
  const mROI=mTI!==0?(mNy/mTI)*100:0, cROI=cTI>0?(cNy/cTI)*100:0;
  const mPB=mNy!==0?mTI/mNy:0, cPB=cNy>0?cTI/cNy:0;

  // BRRR — its own financing tab now (see the fin-tab buttons), not a Cash-
  // tab toggle. Cash tab above is pure cash-and-hold, unaffected by
  // refinancing. Refinance loan is EMV-based (a refinance lender lends
  // against the post-refurb valuation), independent of purchase price —
  // unlike the purchase mortgage above. Defensive reads so this is a no-op
  // on any page without this markup, e.g. landing.html's taster calculator.
  const hbRefiLtvEl=document.getElementById('hb-refi-ltv');
  const hbRefiLtv=(numOr('hb-refi-ltv',75))/100;
  const hbRefiType=(typeof getDDValue==='function'&&getDDValue('hb-refi-type'))||'io';
  const hbRefiLoan=emv*hbRefiLtv;
  const hbRefiPay=hbRefiType==='repay'?mortRepay(hbRefiLoan,mr,term):mort(hbRefiLoan,mr);
  const hbNm=totalRent-bills-ins-wifi-ct-hAnnC-maintC-mgmtC-hbRefiPay, hbNy=hbNm*12;
  const hbMLI=cTI-hbRefiLoan;
  const hbny=emv>0?(hbNy/emv)*100:0;
  const hbROI=hbMLI!==0?(hbNy/hbMLI)*100:0;
  const hbPB=hbNy!==0?hbMLI/hbNy:0;

  const rmm=mortRepay(loan,mr,term);
  const rNm=totalRent-bills-ins-wifi-ct-hAnnC-maintC-mgmtC-rmm, rNy=rNm*12;
  const rny=emv>0?(rNy/emv)*100:0;
  const rROI=mTI!==0?(rNy/mTI)*100:0;
  const rPB=rNy!==0?mTI/rNy:0;

  const oY=totalRent>0?ag/(ty/100):0;
  document.getElementById('h-ly').textContent=ty;
  document.getElementById('h-lroi').textContent=troi;
  s('hm-nm',fmt(mNm),cl(mNm,300,0));s('hm-ny',fmt(mNy),cl(mNy,3600,0));
  s('hm-gy',fP(gy),cl(gy,10,7));s('hm-gye',fP(gyEmv),cl(gyEmv,10,7));s('hm-ny2',fP(mny),cl(mny,6,4));
  s('hm-roi',fP(mROI),cl(mROI,15,8));s('hm-ti',fmt(mTI));
  s('hm-mli',fmt(mTI));s('hm-pb',mPB!==0?Math.abs(mPB).toFixed(2)+' yrs':'N/A');
  s('hm-loan',fmt(loan));s('hm-rate',fP(mr));s('hm-deposit',fmt(dep));s('hm-mpay',fmt(mm));
  s('hc-nm',fmt(cNm),cl(cNm,300,0));s('hc-ny',fmt(cNy),cl(cNy,3600,0));
  s('hc-gy',fP(gy),cl(gy,10,7));s('hc-gye',fP(gyEmv),cl(gyEmv,10,7));s('hc-ny2',fP(cny),cl(cny,6,4));
  s('hc-roi',fP(cROI),cl(cROI,15,8));s('hc-ti',fmt(cTI));
  s('hc-mli',fmt(cTI));s('hc-pb',cPB>0?cPB.toFixed(2)+' yrs':'N/A');
  s('hb-nm',fmt(hbNm),cl(hbNm,300,0));s('hb-ny',fmt(hbNy),cl(hbNy,3600,0));
  s('hb-gy',fP(gy),cl(gy,10,7));s('hb-gye',fP(gyEmv),cl(gyEmv,10,7));s('hb-ny2',fP(hbny),cl(hbny,6,4));
  s('hb-roi',fP(hbROI),cl(hbROI,15,8));s('hb-ti',fmt(cTI));
  s('hb-mli',fmt(hbMLI),hbMLI<=0?'good':'');s('hb-pb',hbPB!==0?Math.abs(hbPB).toFixed(2)+' yrs':'N/A');
  s('hb-refi-loan',fmt(hbRefiLoan));s('hb-refi-ltv-out',fP(hbRefiLtv*100));
  s('hb-refi-rate',fP(mr));s('hb-refi-mpay',fmt(hbRefiPay));
  s('hr-nm',fmt(rNm),cl(rNm,300,0));s('hr-ny',fmt(rNy),cl(rNy,3600,0));
  s('hr-gy',fP(gy),cl(gy,10,7));s('hr-gye',fP(gyEmv),cl(gyEmv,10,7));s('hr-ny2',fP(rny),cl(rny,6,4));
  s('hr-roi',fP(rROI),cl(rROI,15,8));s('hr-ti',fmt(mTI));
  s('hr-mli',fmt(mTI));s('hr-pb',rPB!==0?Math.abs(rPB).toFixed(2)+' yrs':'N/A');
  s('hr-loan',fmt(loan));s('hr-rate',fP(mr));s('hr-deposit',fmt(dep));s('hr-mpay',fmt(rmm));s('hr-term',term);
  const hRcEl=document.getElementById('h-rc');
  if(hRcEl)hRcEl.innerHTML=runCostLines(grossTotalRent*12,hVoidPct,hLetFee,hCerts);
  document.getElementById('h-sn').innerHTML='Stamp duty (BTL): £'+sd.total.toLocaleString()+(sd.detail.length?' ('+sd.detail.join(' · ')+')':'');
  document.getElementById('h-oy').textContent=oY>0?fmt(oY):'Enter rooms first';
  if(oY>0){document.getElementById('h-oyn').textContent=(oY-pp)<0?fmt(Math.abs(oY-pp))+' below asking':fmt(oY-pp)+' above asking';}

  // Bisection now recomputes the mortgage payment (via depM/loanM/mmM) per
  // candidate price, not just stamp duty — loan is no longer a flat 75%
  // LTV of EMV, it's deposit-derived from the candidate price itself, so
  // it must be re-evaluated at every step same as stamp duty already was.
  let oR=0;
  if(totalRent>0){
    const roiAt=mid=>{
      const sdM=stamp(mid).total;
      const depM=mid*dp, loanM=mid-depM, mmM=mort(loanM,mr);
      const mNyM=(totalRent-bills-ins-wifi-ct-hAnnC-maintC-mgmtC-mmM)*12;
      const tiM=depM+sol+mf+lic+ref+sdM+srch;
      return tiM!==0?(mNyM/tiM)*100:0;
    };
    let lo=10000,hi=2000000;
    for(let i=0;i<80;i++){
      const mid=(lo+hi)/2;
      if(roiAt(mid)>troi)lo=mid;else hi=mid;
    }
    oR=bidMeetingTarget((lo+hi)/2,roiAt,troi,10000,1900000);
  }
  document.getElementById('h-or').textContent=oR>0&&oR<1900000?fmt(oR):'Cannot achieve at these inputs';
  if(oR>0&&oR<1900000){document.getElementById('h-orn').textContent=(oR-pp)<0?fmt(Math.abs(oR-pp))+' below asking':fmt(oR-pp)+' above asking';}

  let roR=0;
  if(totalRent>0){
    const roiAt=mid=>{
      const sdM=stamp(mid).total;
      const depM=mid*dp, loanM=mid-depM, rmmM=mortRepay(loanM,mr,term);
      const rNyM=(totalRent-bills-ins-wifi-ct-hAnnC-maintC-mgmtC-rmmM)*12;
      const tiM=depM+sol+mf+lic+ref+sdM+srch;
      return tiM!==0?(rNyM/tiM)*100:0;
    };
    let rlo=10000,rhi=2000000;
    for(let i=0;i<80;i++){
      const mid=(rlo+rhi)/2;
      if(roiAt(mid)>troi)rlo=mid;else rhi=mid;
    }
    roR=bidMeetingTarget((rlo+rhi)/2,roiAt,troi,10000,1900000);
  }

  // BRRR max bid for the target ROI, same rule as BTL's bbOR (owner's
  // sign-off, 2026-10-22): highest price where money left in after refinance
  // <= cashflow after refinance / target ROI.
  let bbOR=0;
  if(hbNy>0&&troi>0){
    const maxLeftIn=hbNy/(troi/100);
    const leftInAt=p=>(p+sol+mf+lic+ref+stamp(p).total+srch)-hbRefiLoan;
    let lo=10000,hi=2000000;
    for(let i=0;i<80;i++){
      const mid=(lo+hi)/2;
      if(leftInAt(mid)<=maxLeftIn)lo=mid;else hi=mid;
    }
    bbOR=Math.floor(lo);
  }
  const hbborEl=document.getElementById('h-bbor');
  if(hbborEl) hbborEl.textContent=bbOR>0&&bbOR<1900000?fmt(bbOR):'Cannot achieve at these inputs';
  if(bbOR>0&&bbOR<1900000){
    const hbbornEl=document.getElementById('h-bborn');
    if(hbbornEl) hbbornEl.textContent=(bbOR-pp)<0?fmt(Math.abs(bbOR-pp))+' below asking':fmt(bbOR-pp)+' above asking';
  }
  const hrorEl=document.getElementById('h-ror');
  if(hrorEl) hrorEl.textContent=roR>0&&roR<1900000?fmt(roR):'Cannot achieve at these inputs';
  if(roR>0&&roR<1900000){
    const hrornEl=document.getElementById('h-rorn');
    if(hrornEl) hrornEl.textContent=(roR-pp)<0?fmt(Math.abs(roR-pp))+' below asking':fmt(roR-pp)+' above asking';
  }

  hmoData={pp,emv,totalRent:grossTotalRent,mr,
    voids:+(hVoidPct*100).toFixed(2),letFee:hLetFee,certs:hCerts,rentAfterVoids:+totalRent.toFixed(2),voidLossYearly:Math.round(grossTotalRent*hVoidPct*12),dp:dp*100,ref,sol,mf,lic,srch,ins,wifi,ctMonthly:Math.round(ct),maint:maint*100,mgmt:mgmt*100,ty,troi,term,
    loan:Math.round(loan),deposit:Math.round(dep),monthlyPayment:Math.round(mm),
    mNm:Math.round(mNm),mNy:Math.round(mNy),cNm:Math.round(cNm),cNy:Math.round(cNy),
    gy:+gy.toFixed(2),gyEmv:+gyEmv.toFixed(2),mny:+mny.toFixed(2),cny:+cny.toFixed(2),
    mROI:+mROI.toFixed(2),cROI:+cROI.toFixed(2),
    mTI:Math.round(mTI),cTI:Math.round(cTI),
    mPB:+Math.abs(mPB).toFixed(2),cPB:+cPB.toFixed(2),
    stampDuty:sd.total,oY:Math.round(oY),oR:Math.round(oR),bills:Math.round(bills),
    repaymentMonthlyPayment:Math.round(rmm),rNm:Math.round(rNm),rNy:Math.round(rNy),
    rny:+rny.toFixed(2),rROI:+rROI.toFixed(2),rPB:+Math.abs(rPB).toFixed(2),
    rOR:Math.round(roR),meetsROIRepayment:rROI>=troi,
    meetsYield:gy>=ty,meetsROI:mROI>=troi,
    bbNm:Math.round(hbNm),bbNy:Math.round(hbNy),bbny:+hbny.toFixed(2),
    bbROI:+hbROI.toFixed(2),bbMLI:Math.round(hbMLI),bbPB:+Math.abs(hbPB).toFixed(2),
    brrrLtv:+(hbRefiLtv*100).toFixed(1),brrrType:hbRefiType,
    brrrLoan:Math.round(hbRefiLoan),brrrPayment:Math.round(hbRefiPay),
    meetsROIBRRR:hbROI>=troi,bbOR:Math.round(bbOR),
    // Additive only — lets a saved HMO deal be re-run later with its real
    // room mix restored, instead of only the aggregated totalRent. Doesn't
    // feed into any calculation above; totalRent (already computed from
    // these same four pairs) remains the only figure anything else reads.
    roomBreakdown:rooms.map(([price,num])=>({price:Math.round(price),count:num}))};
}

function cSA(){
  const rate=moneyVal('sa-rate');
  const occ=+document.getElementById('sa-occ').value||0;
  const pp=moneyVal('sa-pp');
  const emv=moneyVal('sa-emv');
  const mr=+document.getElementById('sa-mr').value||0;
  const dp=(numOr('sa-dp',25))/100;
  const sol=moneyVal('sa-sol');
  const mf=moneyVal('sa-mf');
  const srch=moneyVal('sa-srch');
  const ref=moneyVal('sa-ref');
  const furn=moneyVal('sa-furn');
  const wg=moneyVal('sa-wg');
  const mgmt=(numOr('sa-mgmt',10))/100;
  const util=(numOr('sa-util',10))/100;
  const maint=(numOr('sa-maint',10))/100;
  const clean=moneyVal('sa-clean');
  const ins=moneyVal('sa-ins');
  const ct=moneyVal('sa-ct');
  const ty=numOr('sa-ty',12);
  const troi=numOr('sa-troi',20);
  const satermEl=document.getElementById('sa-term');
  const term=numOr('sa-term',25);

  const ag=rate*(occ/100)*365;
  const mgmtCost=ag*mgmt, utilCost=ag*util, maintCost=ag*maint;
  const cleanA=clean*12, insA=ins*12;
  const totalCosts=mgmtCost+utilCost+maintCost+cleanA+insA+ct;
  const netInc=ag-totalCosts;

  const dep=pp*dp, loan=pp-dep, mm=mort(loan,mr), sd=stamp(pp);
  const mortIntA=mm*12;

  const mCFy=netInc-mortIntA, mCFm=mCFy/12;
  const cCFy=netInc, cCFm=cCFy/12;
  const incM=netInc/12, incY=netInc;

  // Gross yield on PURCHASE PRICE, same as BTL and HMO (owner's explicit
  // instruction, 2026-10-21; it used to be on end value). gyEmv keeps the
  // end-value version, shown alongside. Net yields stay on end value.
  const gy=pp>0?(ag/pp)*100:0, gyEmv=emv>0?(ag/emv)*100:0;
  const mny=emv>0?(mCFy/emv)*100:0;
  const cny=emv>0?(cCFy/emv)*100:0;

  // Stamp duty counts in total investment, money left in, ROI and max bid,
  // same as BTL, HMO and Flip. Added on the owner's explicit instruction,
  // October 2026.
  const mTI=sol+mf+srch+dep+ref+furn+wg+sd.total;
  const cTI=pp+sol+mf+srch+ref+furn+wg+sd.total;
  const mMLI=cTI-loan;
  const mROI=mMLI!==0?(mCFy/mMLI)*100:0;
  const cROI=cTI>0?(cCFy/cTI)*100:0;

  // BRRR — its own financing tab now (see the fin-tab buttons), not a Cash-
  // tab toggle. Cash tab above is pure cash-and-hold, unaffected by
  // refinancing. Refinance loan is EMV-based (a refinance lender lends
  // against the post-refurb valuation), independent of purchase price —
  // unlike the purchase mortgage above. Defensive reads so this is a no-op
  // on any page without this markup, e.g. landing.html's taster calculator.
  const sabRefiLtvEl=document.getElementById('sab-refi-ltv');
  const sabRefiLtv=(numOr('sab-refi-ltv',75))/100;
  const sabRefiType=(typeof getDDValue==='function'&&getDDValue('sab-refi-type'))||'io';
  const sabRefiLoan=emv*sabRefiLtv;
  const sabRefiPay=sabRefiType==='repay'?mortRepay(sabRefiLoan,mr,term):mort(sabRefiLoan,mr);
  const sabCFy=netInc-sabRefiPay*12, sabCFm=sabCFy/12;
  const sabMLI=cTI-sabRefiLoan;
  const sabny=emv>0?(sabCFy/emv)*100:0;
  const sabROI=sabMLI!==0?(sabCFy/sabMLI)*100:0;

  const rmm=mortRepay(loan,mr,term);
  const rmortIntA=rmm*12;
  const rCFy=netInc-rmortIntA, rCFm=rCFy/12;
  const rny=emv>0?(rCFy/emv)*100:0;
  const rROI=mMLI!==0?(rCFy/mMLI)*100:0;

  const oY=ty>0?ag/(ty/100):0;

  // Max bid via bisection, not closed-form — same reason as BTL: loan (and
  // so the mortgage payment) now depends on the candidate price itself,
  // since deposit is derived from price, not EMV. Matches HMO/Flip's
  // existing, proven bisection pattern rather than re-deriving algebra.
  let oR=0;
  {
    const roiAt=mid=>{
      const depM=mid*dp, loanM=mid-depM, mmM=mort(loanM,mr);
      const mCFyM=netInc-mmM*12;
      const mMLIM=(mid+sol+mf+srch+ref+furn+wg+stamp(mid).total)-loanM;
      return mMLIM!==0?(mCFyM/mMLIM)*100:0;
    };
    let lo=10000,hi=2000000;
    for(let i=0;i<80;i++){
      const mid=(lo+hi)/2;
      if(roiAt(mid)>troi)lo=mid;else hi=mid;
    }
    oR=bidMeetingTarget((lo+hi)/2,roiAt,troi,10000,1900000);
  }

  let roR=0;
  {
    const roiAt=mid=>{
      const depM=mid*dp, loanM=mid-depM, rmmM=mortRepay(loanM,mr,term);
      const rCFyM=netInc-rmmM*12;
      const mMLIM=(mid+sol+mf+srch+ref+furn+wg+stamp(mid).total)-loanM;
      return mMLIM!==0?(rCFyM/mMLIM)*100:0;
    };
    let lo=10000,hi=2000000;
    for(let i=0;i<80;i++){
      const mid=(lo+hi)/2;
      if(roiAt(mid)>troi)lo=mid;else hi=mid;
    }
    roR=bidMeetingTarget((lo+hi)/2,roiAt,troi,10000,1900000);
  }

  // BRRR max bid for the target ROI, same rule as BTL's bbOR (owner's
  // sign-off, 2026-10-22): highest price where money left in after refinance
  // <= cashflow after refinance / target ROI.
  let bbOR=0;
  if(sabCFy>0&&troi>0){
    const maxLeftIn=sabCFy/(troi/100);
    const leftInAt=p=>(p+sol+mf+srch+ref+furn+wg+stamp(p).total)-sabRefiLoan;
    let lo=10000,hi=2000000;
    for(let i=0;i<80;i++){
      const mid=(lo+hi)/2;
      if(leftInAt(mid)<=maxLeftIn)lo=mid;else hi=mid;
    }
    bbOR=Math.floor(lo);
  }

  document.getElementById('sa-ly').textContent=ty;
  document.getElementById('sa-lr').textContent=troi;

  s('sam-gy',fP(gy),cl(gy,10,7));s('sam-gye',fP(gyEmv),cl(gyEmv,10,7));
  s('sam-ny',fP(mny),cl(mny,6,4));
  s('sam-roi',fP(mROI),cl(mROI,15,8));
  s('sam-ti',fmt(mTI));s('sam-mli',fmt(mMLI),mMLI<=0?'good':'');
  s('sam-im',fmt(incM));
  s('sam-iy',fmt(incY));
  s('sam-cfm',fmt(mCFm),cl(mCFm,300,0));
  s('sam-cfy',fmt(mCFy),cl(mCFy,3600,0));
  s('sam-loan',fmt(loan));s('sam-rate',fP(mr));s('sam-deposit',fmt(dep));s('sam-mpay',fmt(mm));

  s('sac-gy',fP(gy),cl(gy,10,7));s('sac-gye',fP(gyEmv),cl(gyEmv,10,7));
  s('sac-ny',fP(cny),cl(cny,6,4));
  s('sac-roi',fP(cROI),cl(cROI,15,8));
  s('sac-ti',fmt(cTI));s('sac-mli',fmt(cTI));
  s('sac-im',fmt(incM));
  s('sac-iy',fmt(incY));
  s('sac-cfm',fmt(cCFm),cl(cCFm,300,0));
  s('sac-cfy',fmt(cCFy),cl(cCFy,3600,0));

  s('sab-gy',fP(gy),cl(gy,10,7));s('sab-gye',fP(gyEmv),cl(gyEmv,10,7));
  s('sab-ny',fP(sabny),cl(sabny,6,4));
  s('sab-roi',fP(sabROI),cl(sabROI,15,8));
  s('sab-ti',fmt(cTI));s('sab-mli',fmt(sabMLI),sabMLI<=0?'good':'');
  s('sab-im',fmt(incM));
  s('sab-iy',fmt(incY));
  s('sab-cfm',fmt(sabCFm),cl(sabCFm,300,0));
  s('sab-cfy',fmt(sabCFy),cl(sabCFy,3600,0));
  s('sab-refi-loan',fmt(sabRefiLoan));s('sab-refi-ltv-out',fP(sabRefiLtv*100));
  s('sab-refi-rate',fP(mr));s('sab-refi-mpay',fmt(sabRefiPay));

  s('sar-gy',fP(gy),cl(gy,10,7));s('sar-gye',fP(gyEmv),cl(gyEmv,10,7));
  s('sar-ny',fP(rny),cl(rny,6,4));
  s('sar-roi',fP(rROI),cl(rROI,15,8));
  s('sar-ti',fmt(mTI));s('sar-mli',fmt(mMLI),mMLI<=0?'good':'');
  s('sar-im',fmt(incM));
  s('sar-iy',fmt(incY));
  s('sar-cfm',fmt(rCFm),cl(rCFm,300,0));
  s('sar-cfy',fmt(rCFy),cl(rCFy,3600,0));
  s('sar-loan',fmt(loan));s('sar-rate',fP(mr));s('sar-deposit',fmt(dep));s('sar-mpay',fmt(rmm));s('sar-term',term);

  document.getElementById('sa-sn').innerHTML='Stamp duty (BTL): £'+sd.total.toLocaleString()+(sd.detail.length?' ('+sd.detail.join(' · ')+')':'');

  document.getElementById('sa-oy').textContent=oY>0?fmt(oY):'Cannot achieve at these inputs';
  if(oY>0)document.getElementById('sa-oyn').textContent=(oY-pp)<0?fmt(Math.abs(oY-pp))+' below asking':fmt(oY-pp)+' above asking';
  document.getElementById('sa-or').textContent=oR>0&&oR<1900000?fmt(oR):'Cannot achieve at these inputs';
  if(oR>0&&oR<1900000)document.getElementById('sa-orn').textContent=(oR-pp)<0?fmt(Math.abs(oR-pp))+' below asking':fmt(oR-pp)+' above asking';
  const sarorEl=document.getElementById('sa-ror');
  if(sarorEl) sarorEl.textContent=roR>0&&roR<1900000?fmt(roR):'Cannot achieve at these inputs';
  if(roR>0&&roR<1900000){
    const sarornEl=document.getElementById('sa-rorn');
    if(sarornEl) sarornEl.textContent=(roR-pp)<0?fmt(Math.abs(roR-pp))+' below asking':fmt(roR-pp)+' above asking';
  }
  const sabborEl=document.getElementById('sa-bbor');
  if(sabborEl) sabborEl.textContent=bbOR>0&&bbOR<1900000?fmt(bbOR):'Cannot achieve at these inputs';
  if(bbOR>0&&bbOR<1900000){
    const sabbornEl=document.getElementById('sa-bborn');
    if(sabbornEl) sabbornEl.textContent=(bbOR-pp)<0?fmt(Math.abs(bbOR-pp))+' below asking':fmt(bbOR-pp)+' above asking';
  }

  saData={rate,occ,pp,emv,mr,dp:dp*100,sol,mf,srch,ref,furn,wg,mgmt:mgmt*100,util:util*100,maint:maint*100,clean,ins,ct,ty,troi,term,
    loan:Math.round(loan),deposit:Math.round(dep),monthlyPayment:Math.round(mm),
    annualRevenue:Math.round(ag),netAnnualIncome:Math.round(netInc),
    mCFy:Math.round(mCFy),mCFm:Math.round(mCFm),cCFy:Math.round(cCFy),cCFm:Math.round(cCFm),
    incM:Math.round(incM),incY:Math.round(incY),
    gy:+gy.toFixed(2),gyEmv:+gyEmv.toFixed(2),mny:+mny.toFixed(2),cny:+cny.toFixed(2),
    mROI:+mROI.toFixed(2),cROI:+cROI.toFixed(2),
    mTI:Math.round(mTI),cTI:Math.round(cTI),
    stampDuty:sd.total,oY:Math.round(oY),oR:Math.round(oR),
    meetsYield:gy>=ty,meetsROI:mROI>=troi,
    repaymentMonthlyPayment:Math.round(rmm),rCFy:Math.round(rCFy),rCFm:Math.round(rCFm),
    rny:+rny.toFixed(2),rROI:+rROI.toFixed(2),
    rOR:Math.round(roR),meetsROIRepayment:rROI>=troi,
    bbCFy:Math.round(sabCFy),bbCFm:Math.round(sabCFm),bbny:+sabny.toFixed(2),
    bbROI:+sabROI.toFixed(2),bbMLI:Math.round(sabMLI),
    brrrLtv:+(sabRefiLtv*100).toFixed(1),brrrType:sabRefiType,
    brrrLoan:Math.round(sabRefiLoan),brrrPayment:Math.round(sabRefiPay),
    meetsROIBRRR:sabROI>=troi,bbOR:Math.round(bbOR)};
}

function cFlip(){
  const pp=moneyVal('fl-pp');
  const bf=moneyVal('fl-bf');
  const ref=moneyVal('fl-ref');
  const sv=moneyVal('fl-sv');
  const agentPct=(numOr('fl-agent',2))/100;
  const contPct=(+document.getElementById('fl-cont').value||0)/100;
  const troi=numOr('fl-troi',20);

  const sd=stamp(pp);
  const contAmt=contPct*ref;
  const agentAmt=agentPct*sv;
  const ti=pp+sd.total+bf+ref+contAmt;
  const profit=sv-pp-sd.total-bf-ref-contAmt-agentAmt;
  const roi=ti!==0?(profit/ti)*100:0;
  const margin=sv>0?(profit/sv)*100:0;

  document.getElementById('fl-lr').textContent=troi;

  s('fl-profit',fmt(profit),cl(profit,10000,0));
  s('fl-roi',fP(roi),cl(roi,20,10));
  s('fl-margin',fP(margin),cl(margin,15,8));
  s('fl-ti',fmt(ti));
  s('fl-sdout',fmt(sd.total));
  const flSn=document.getElementById('fl-sn');
  if(flSn)flSn.innerHTML='Stamp duty (Flip): £'+sd.total.toLocaleString()+(sd.detail.length?' ('+sd.detail.join(' · ')+')':'');
  s('fl-agentout',fmt(agentAmt));
  s('fl-contout',fmt(contAmt));

  let oR=0;
  if(sv>0){
    const roiAt=mid=>{
      const sdM=stamp(mid).total;
      const tiM=mid+sdM+bf+ref+contAmt;
      const profitM=sv-mid-sdM-bf-ref-contAmt-agentAmt;
      return tiM!==0?(profitM/tiM)*100:0;
    };
    let lo=1000,hi=sv;
    for(let i=0;i<80;i++){
      const mid=(lo+hi)/2;
      if(roiAt(mid)>troi)lo=mid; else hi=mid;
    }
    oR=bidMeetingTarget((lo+hi)/2,roiAt,troi,1000,Infinity);
  }
  document.getElementById('fl-or').textContent=oR>0?fmt(oR):'Cannot achieve at these inputs';
  if(oR>0)document.getElementById('fl-orn').textContent=(oR-pp)<0?fmt(Math.abs(oR-pp))+' below asking':fmt(oR-pp)+' above asking';

  flipData={pp,bf,ref,sv,agentPct:agentPct*100,contPct:contPct*100,troi,
    stampDuty:sd.total,agentAmt:Math.round(agentAmt),contAmt:Math.round(contAmt),
    ti:Math.round(ti),profit:Math.round(profit),roi:+roi.toFixed(2),margin:+margin.toFixed(2),
    oR:Math.round(oR),
    meetsROI:roi>=troi};
}

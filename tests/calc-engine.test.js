// Automatic check of calc-engine.js against independent maths.
//
// Run with: npm test   (also runs on every pull request, see
// .github/workflows/calc-tests.yml). Exits 1 if anything is wrong.
//
// The reference maths below is written from standard UK property-investment
// practice and the rules documented in CLAUDE.md, NOT copied from the
// engine, so a change to a formula in calc-engine.js shows up here as a
// mismatch. If a change is deliberate (e.g. new stamp duty rates after a
// Budget), update the reference maths here in the same pull request.
//
// What it checks:
//  1. 2,000 random deals each for BTL/BRRR, HMO, SA and Flip: every main
//     figure matches the reference maths, and every ROI max bid meets its
//     target while £2 more doesn't.
//  2. Payback and BRRR "all money out" rules (2026-10-29).
//  3. Fixed hand-checked figures (stamp duty, repayment, worked examples).
// Random deals use a fixed seed, so a failure is repeatable.
const fs=require('fs');
const path=require('path');
const src=fs.readFileSync(path.join(__dirname,'..','calc-engine.js'),'utf8');
let seed=20261029;
function rand(){seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}
let vals={}, dd={};
const els={};
global.document={getElementById:id=>{ if(!els[id])els[id]={id,get value(){return vals[id]!==undefined?String(vals[id]):''},textContent:'',innerHTML:'',className:''}; return els[id]; }};
global.getDDValue=id=>dd[id];
const E=new Function(src+';return {cBTL,cHMO,cSA,cFlip,get btl(){return btlData},get hmo(){return hmoData},get sa(){return saData},get flip(){return flipData},stamp,mortRepay};')();
const text=id=>els[id]?els[id].textContent:undefined;

// ---------- reference maths ----------
function sdlt(p){ // England & NI, additional dwelling rates (standard + 5%), none under £40k
  if(!(p>0)||p<40000)return 0;
  const bands=[[125000,.05],[250000,.07],[925000,.10],[1500000,.15],[Infinity,.17]];
  let t=0,prev=0;for(const[cap,r]of bands){if(p>prev)t+=(Math.min(p,cap)-prev)*r;prev=cap;}
  return Math.round(t);
}
const ioPay=(L,r)=>L*r/100/12;
function annuity(L,r,yrs){const i=r/1200,n=yrs*12;if(n<=0)return 0;if(i===0)return L/n;return L*i/(1-Math.pow(1+i,-n));}
const R=(a,b)=>rand()*(b-a)+a, RI=(a,b)=>Math.round(R(a,b));
let fails=[], checks=0;
function cmp(tag,field,engine,ref,tol){checks++;const d=Math.abs(engine-ref);if(!(d<=tol)){fails.push(`${tag} ${field}: engine ${engine} vs reference ${ref}`);}}
// Max bid: the highest price that still meets target. Check bid meets, bid+£2 doesn't.
function bidOK(tag,field,bid,roiAt,target,ceiling){
  checks++;
  if(!(bid>10001&&bid<ceiling))return; // not achievable / off the scale: checked separately
  const atBid=roiAt(bid), above=roiAt(bid+2);
  if(atBid<target-0.005)fails.push(`${tag} ${field}: bid £${bid} gives ${atBid.toFixed(3)}% < target ${target}%`);
  if(above>=target+0.005&&Math.abs(above-atBid)<5)fails.push(`${tag} ${field}: £${bid+2} still gives ${above.toFixed(3)}% >= target ${target}% (bid too low)`);
}

// ---------- BTL / BRRR ----------
for(let k=0;k<2000;k++){
  const pp=RI(30000,600000), emv=Math.round(pp*R(0.9,1.6)), rent=RI(300,4000);
  const v={'b-pp':pp,'b-emv':emv,'b-rent':rent,'b-voids':+R(0,10).toFixed(1),'b-letfee':RI(0,800),'b-certs':RI(0,400),
    'b-mr':+R(2,8).toFixed(2),'b-dp':RI(15,40),'b-ref':RI(0,60000),'b-sol':RI(800,2500),'b-mf':RI(0,2500),'b-srch':RI(0,500),
    'b-ins':RI(15,80),'b-mgmt':RI(0,15),'b-maint':RI(0,12),'b-ty':RI(5,10),'b-tr':RI(5,25),'b-term':RI(10,35),'bb-refi-ltv':RI(60,80)};
  vals=v; dd={'bb-refi-type':rand()<.5?'io':'repay'}; E.cBTL(); const d=E.btl, T='BTL#'+k;
  const voids=v['b-voids']/100, net=rent*(1-voids), yr=(v['b-letfee']+v['b-certs'])/12;
  const opMonthly=net - net*v['b-mgmt']/100 - net*v['b-maint']/100 - v['b-ins'] - yr; // before finance
  const sd=sdlt(pp), dep=pp*v['b-dp']/100, loan=pp-dep;
  const fees=v['b-sol']+v['b-mf']+v['b-srch']+v['b-ref']+sd;
  const cashIn=dep+fees, cashBuy=pp+fees;
  const io=ioPay(loan,v['b-mr']), rp=annuity(loan,v['b-mr'],v['b-term']);
  cmp(T,'stampDuty',d.stampDuty,sd,0);
  cmp(T,'loan',d.loan,loan,1); cmp(T,'deposit',d.deposit,dep,1);
  cmp(T,'monthlyPayment',d.monthlyPayment,io,1); cmp(T,'repayment',d.repaymentMonthlyPayment,rp,1);
  cmp(T,'mNy',d.mNy,(opMonthly-io)*12,1); cmp(T,'rNy',d.rNy,(opMonthly-rp)*12,1); cmp(T,'cNy',d.cNy,opMonthly*12,1);
  cmp(T,'mTI',d.mTI,cashIn,1); cmp(T,'cTI',d.cTI,cashBuy,1); cmp(T,'mMLI',d.mMLI,cashIn,1);
  cmp(T,'gy (on price)',d.gy,rent*12/pp*100,0.006); cmp(T,'gyEmv',d.gyEmv,rent*12/emv*100,0.006);
  cmp(T,'mny (net yield on EMV)',d.mny,(opMonthly-io)*12/emv*100,0.006);
  cmp(T,'mROI',d.mROI,(opMonthly-io)*12/cashIn*100,0.006); cmp(T,'rROI',d.rROI,(opMonthly-rp)*12/cashIn*100,0.006);
  cmp(T,'cROI',d.cROI,opMonthly*12/cashBuy*100,0.006);
  cmp(T,'oY (yield max bid)',d.oY,rent*12/(v['b-ty']/100),1);
  // BRRR: refinance at LTV of end value
  const refi=emv*v['bb-refi-ltv']/100, refiPay=dd['bb-refi-type']==='repay'?annuity(refi,v['b-mr'],v['b-term']):ioPay(refi,v['b-mr']);
  cmp(T,'brrrLoan',d.brrrLoan,refi,1); cmp(T,'bbNy',d.bbNy,(opMonthly-refiPay)*12,1); cmp(T,'bbMLI',d.bbMLI,cashBuy-refi,1);
  // max bids
  const roiIO=p=>{const L=p*(1-v['b-dp']/100);return (opMonthly-ioPay(L,v['b-mr']))*12/(p-L+v['b-sol']+v['b-mf']+v['b-srch']+v['b-ref']+sdlt(p))*100;};
  const roiRP=p=>{const L=p*(1-v['b-dp']/100);return (opMonthly-annuity(L,v['b-mr'],v['b-term']))*12/(p-L+v['b-sol']+v['b-mf']+v['b-srch']+v['b-ref']+sdlt(p))*100;};
  bidOK(T,'oR',d.oR,roiIO,v['b-tr'],1900000); bidOK(T,'rOR',d.rOR,roiRP,v['b-tr'],1900000);
  const bbNy=(opMonthly-refiPay)*12;
  if(bbNy>0&&d.bbOR>10001&&d.bbOR<1900000){
    const left=p=>p+v['b-sol']+v['b-mf']+v['b-srch']+v['b-ref']+sdlt(p)-refi;
    checks++; if(left(d.bbOR)>bbNy/(v['b-tr']/100)+1)fails.push(`${T} bbOR £${d.bbOR}: money left in ${left(d.bbOR).toFixed(0)} > allowed ${(bbNy/(v['b-tr']/100)).toFixed(0)}`);
    if(left(d.bbOR+2)<=bbNy/(v['b-tr']/100)-1)fails.push(`${T} bbOR too low`);
  }
}

// ---------- HMO ----------
for(let k=0;k<2000;k++){
  const pp=RI(80000,700000), emv=Math.round(pp*R(0.9,1.6));
  const v={'h-pp':pp,'h-emv':emv,'h-mr':+R(2,8).toFixed(2),'h-dp':RI(20,40),'h-ref':RI(0,80000),'h-sol':RI(800,3000),'h-mf':RI(0,3000),'h-lic':RI(0,1500),'h-srch':RI(0,500),
    'h-ins':RI(30,150),'h-wifi':RI(0,60),'h-ct':RI(1200,3000),'h-maint':RI(0,12),'h-mgmt':RI(0,15),'h-ty':RI(8,15),'h-troi':RI(8,30),'h-term':RI(10,35),
    'h-voids':+R(0,10).toFixed(1),'h-letfee':RI(0,800),'h-certs':RI(0,600),'hb-refi-ltv':RI(60,80)};
  let rooms=0;for(let r=1;r<=4;r++){const pr=RI(0,900),n=RI(0,3);v['h-r'+r+'p']=pr;v['h-r'+r+'n']=n;rooms+=pr*n;}
  vals=v; dd={'hb-refi-type':rand()<.5?'io':'repay'}; E.cHMO(); const d=E.hmo, T='HMO#'+k;
  const voids=v['h-voids']/100, net=rooms*(1-voids);
  const bills=rooms*0.10; // bills on full rent (owner rule)
  const op=net-bills-v['h-ins']-v['h-wifi']-v['h-ct']/12-(v['h-letfee']+v['h-certs'])/12-net*v['h-maint']/100-net*v['h-mgmt']/100;
  const sd=sdlt(pp), dep=pp*v['h-dp']/100, loan=pp-dep;
  const fees=v['h-sol']+v['h-mf']+v['h-lic']+v['h-ref']+v['h-srch']+sd;
  const io=ioPay(loan,v['h-mr']), rp=annuity(loan,v['h-mr'],v['h-term']);
  cmp(T,'totalRent',d.totalRent,rooms,0); cmp(T,'bills',d.bills,bills,1); cmp(T,'stampDuty',d.stampDuty,sd,0);
  cmp(T,'mNy',d.mNy,(op-io)*12,1); cmp(T,'rNy',d.rNy,(op-rp)*12,1); cmp(T,'cNy',d.cNy,op*12,1);
  cmp(T,'mTI',d.mTI,dep+fees,1); cmp(T,'cTI',d.cTI,pp+fees,1);
  if(rooms>0){cmp(T,'gy',d.gy,rooms*12/pp*100,0.006); cmp(T,'mROI',d.mROI,(op-io)*12/(dep+fees)*100,0.006);
    cmp(T,'cROI',d.cROI,op*12/(pp+fees)*100,0.006); cmp(T,'oY',d.oY,rooms*12/(v['h-ty']/100),1);}
  const refi=emv*v['hb-refi-ltv']/100, refiPay=dd['hb-refi-type']==='repay'?annuity(refi,v['h-mr'],v['h-term']):ioPay(refi,v['h-mr']);
  cmp(T,'bbNy',d.bbNy,(op-refiPay)*12,1); cmp(T,'bbMLI',d.bbMLI,pp+fees-refi,1);
  if(rooms>0){
    const roi=(p,f)=>{const L=p*(1-v['h-dp']/100);return (op-f(L))*12/(p-L+v['h-sol']+v['h-mf']+v['h-lic']+v['h-ref']+v['h-srch']+sdlt(p))*100;};
    bidOK(T,'oR',d.oR,p=>roi(p,L=>ioPay(L,v['h-mr'])),v['h-troi'],1900000);
    bidOK(T,'rOR',d.rOR,p=>roi(p,L=>annuity(L,v['h-mr'],v['h-term'])),v['h-troi'],1900000);
  }
}

// ---------- SA ----------
for(let k=0;k<2000;k++){
  const pp=RI(60000,600000), emv=Math.round(pp*R(0.9,1.6));
  const v={'sa-rate':RI(50,300),'sa-occ':RI(30,90),'sa-pp':pp,'sa-emv':emv,'sa-mr':+R(2,8).toFixed(2),'sa-dp':RI(20,40),'sa-sol':RI(800,2500),'sa-mf':RI(0,2500),
    'sa-srch':RI(0,500),'sa-ref':RI(0,40000),'sa-furn':RI(0,15000),'sa-wg':RI(0,3000),'sa-mgmt':RI(0,25),'sa-util':RI(0,15),'sa-maint':RI(0,12),
    'sa-clean':RI(0,800),'sa-ins':RI(20,120),'sa-ct':RI(0,3000),'sa-ty':RI(8,20),'sa-troi':RI(10,30),'sa-term':RI(10,35),'sab-refi-ltv':RI(60,80)};
  vals=v; dd={'sab-refi-type':rand()<.5?'io':'repay'}; E.cSA(); const d=E.sa, T='SA#'+k;
  const rev=v['sa-rate']*v['sa-occ']/100*365;
  const netInc=rev-rev*(v['sa-mgmt']+v['sa-util']+v['sa-maint'])/100-v['sa-clean']*12-v['sa-ins']*12-v['sa-ct'];
  const sd=sdlt(pp), dep=pp*v['sa-dp']/100, loan=pp-dep;
  const fees=v['sa-sol']+v['sa-mf']+v['sa-srch']+v['sa-ref']+v['sa-furn']+v['sa-wg']+sd;
  const io=ioPay(loan,v['sa-mr']), rp=annuity(loan,v['sa-mr'],v['sa-term']);
  cmp(T,'annualRevenue',d.annualRevenue,rev,1); cmp(T,'netAnnualIncome',d.netAnnualIncome,netInc,1);
  cmp(T,'mCFy',d.mCFy,netInc-io*12,1); cmp(T,'rCFy',d.rCFy,netInc-rp*12,1);
  cmp(T,'mTI',d.mTI,dep+fees,1); cmp(T,'cTI',d.cTI,pp+fees,1);
  cmp(T,'gy',d.gy,rev/pp*100,0.006); cmp(T,'mROI',d.mROI,(netInc-io*12)/(dep+fees)*100,0.006); cmp(T,'cROI',d.cROI,netInc/(pp+fees)*100,0.006);
  const refi=emv*v['sab-refi-ltv']/100, refiPay=dd['sab-refi-type']==='repay'?annuity(refi,v['sa-mr'],v['sa-term']):ioPay(refi,v['sa-mr']);
  cmp(T,'bbCFy',d.bbCFy,netInc-refiPay*12,1); cmp(T,'bbMLI',d.bbMLI,pp+fees-refi,1);
  const roi=(p,f)=>{const L=p*(1-v['sa-dp']/100);return (netInc-f(L)*12)/(p-L+v['sa-sol']+v['sa-mf']+v['sa-srch']+v['sa-ref']+v['sa-furn']+v['sa-wg']+sdlt(p))*100;};
  bidOK(T,'oR',d.oR,p=>roi(p,L=>ioPay(L,v['sa-mr'])),v['sa-troi'],1900000);
  bidOK(T,'rOR',d.rOR,p=>roi(p,L=>annuity(L,v['sa-mr'],v['sa-term'])),v['sa-troi'],1900000);
}

// ---------- Flip ----------
for(let k=0;k<2000;k++){
  const pp=RI(30000,600000), ref=RI(0,80000), sv=Math.round((pp+ref)*R(0.9,1.6));
  const v={'fl-pp':pp,'fl-bf':RI(500,5000),'fl-ref':ref,'fl-sv':sv,'fl-agent':+R(0.8,3).toFixed(2),'fl-cont':RI(0,20),'fl-troi':RI(5,40)};
  vals=v; dd={}; E.cFlip(); const d=E.flip, T='FLIP#'+k;
  const sd=sdlt(pp), cont=ref*v['fl-cont']/100, agent=sv*v['fl-agent']/100;
  const cash=pp+sd+v['fl-bf']+ref+cont, profit=sv-agent-cash;
  cmp(T,'ti',d.ti,cash,1); cmp(T,'profit',d.profit,profit,1); cmp(T,'roi',d.roi,profit/cash*100,0.006); cmp(T,'margin',d.margin,profit/sv*100,0.006);
  const roiAt=p=>{const c=p+sdlt(p)+v['fl-bf']+ref+cont;return (sv-agent-c)/c*100;};
  bidOK(T,'oR',d.oR,roiAt,v['fl-troi'],Infinity);
}


// ---------- payback and all money out ----------
// Payback = cash in / yearly cashflow, only when cashflow is positive
// (null = never); 0 when cash in is £0 or less. BRRR ROI is null ("All
// money out") when money left in is £0 or less, and then meets target
// only if cashflow after refinance is positive.
function pbRule(T,key,v,cashIn,cf){
  checks++;
  if(!(cf>0)){ if(v!==null)fails.push(`${T} ${key}: should be never (null) with cashflow ${cf}, got ${v}`); }
  else if(cashIn<=0){ if(v!==0)fails.push(`${T} ${key}: should be instant (0), got ${v}`); }
  else if(!(Math.abs(v-cashIn/cf)<=0.006))fails.push(`${T} ${key}: ${v} vs ${cashIn/cf}`);
}
for(let k=0;k<1500;k++){
  const pp=RI(40000,400000), emv=Math.round(pp*R(1.2,2.4));
  const v={'b-pp':pp,'b-emv':emv,'b-rent':RI(200,3000),'b-mr':+R(2,9).toFixed(2),'b-dp':RI(15,40),'b-ref':RI(0,60000),'b-sol':RI(800,2500),'b-mf':RI(0,2500),'b-srch':RI(0,500),
    'b-ins':RI(15,80),'b-mgmt':RI(0,15),'b-maint':RI(0,12),'b-ty':RI(5,10),'b-tr':RI(5,25),'b-term':RI(10,35),'bb-refi-ltv':RI(60,85)};
  vals=v; dd={'bb-refi-type':rand()<.5?'io':'repay'}; E.cBTL(); const d=E.btl, T='BTL-PB#'+k;
  // Reference figures, unrounded (the saved ones are rounded to £1).
  const op=v['b-rent']*(1-(v['b-mgmt']+v['b-maint'])/100)-v['b-ins'];
  const dep=pp*v['b-dp']/100, loan=pp-dep, fees=v['b-sol']+v['b-mf']+v['b-srch']+v['b-ref']+sdlt(pp);
  const cashIn=dep+fees, cashBuy=pp+fees, refi=emv*v['bb-refi-ltv']/100;
  const refiPay=dd['bb-refi-type']==='repay'?annuity(refi,v['b-mr'],v['b-term']):ioPay(refi,v['b-mr']);
  const mNy=(op-ioPay(loan,v['b-mr']))*12, rNy=(op-annuity(loan,v['b-mr'],v['b-term']))*12, cNy=op*12;
  const bbNy=(op-refiPay)*12, bbMLI=cashBuy-refi;
  pbRule(T,'mPB',d.mPB,cashIn,mNy); pbRule(T,'rPB',d.rPB,cashIn,rNy); pbRule(T,'cPB',d.cPB,cashBuy,cNy); pbRule(T,'bbPB',d.bbPB,bbMLI,bbNy);
  checks+=3;
  if(mNy<=0&&text('bm-pb')!=='Never')fails.push(`${T} bm-pb shows "${text('bm-pb')}" on a loss-making deal`);
  if(bbMLI<=0){
    if(d.bbROI!==null)fails.push(`${T} bbROI should be null (all money out), got ${d.bbROI}`);
    if(d.meetsROIBRRR!==(bbNy>0))fails.push(`${T} meetsROIBRRR ${d.meetsROIBRRR} with cashflow ${bbNy}`);
    if(text('bb-roi')!=='All money out')fails.push(`${T} bb-roi shows "${text('bb-roi')}"`);
  } else {
    const roi=bbNy/bbMLI*100;
    if(!(Math.abs(d.bbROI-roi)<=0.006))fails.push(`${T} bbROI ${d.bbROI} vs ${roi}`);
    if(d.meetsROIBRRR!==(roi>=v['b-tr']))fails.push(`${T} meetsROIBRRR`);
  }
}

// ---------- fixed hand checks ----------
const hand=[['SDLT £100k',E.stamp(100000).total,5000],['SDLT £150k',E.stamp(150000).total,8000],['SDLT £200k',E.stamp(200000).total,11500],
 ['SDLT £300k',E.stamp(300000).total,20000],['SDLT £39,999',E.stamp(39999).total,0],['SDLT £1m',E.stamp(1000000).total,sdlt(1000000)],
 ['Repayment £150k 5% 25y',+E.mortRepay(150000,5,25).toFixed(2),876.89]];
// CLAUDE.md worked example: voids, letting fee and certificates on the default BTL.
vals={'b-pp':140000,'b-emv':200000,'b-rent':850,'b-dp':20,'b-mr':5,'b-ins':40,'b-mgmt':8,'b-maint':5,'b-sol':1500,'b-srch':300,'b-mf':1495,'b-ref':10000,
  'b-voids':4,'b-letfee':300,'b-certs':200,'b-ty':8,'b-tr':15,'b-term':25,'bb-refi-ltv':75}; dd={'bb-refi-type':'io'}; E.cBTL();
hand.push(['Worked BTL: cashflow a year',E.btl.mNy,1939],['Worked BTL: total investment',E.btl.mTI,48595],['Worked BTL: ROI',E.btl.mROI,3.99],
  ['Worked BTL: gross yield on price',E.btl.gy,7.29],['Worked BTL: yield max bid at 8%',E.btl.oY,127500]);
// CLAUDE.md worked example: BTL £60k end value, £474 rent, 15% target lands on £39,999, not £40,000.
// Loss-making and all-money-out examples (2026-10-29).
vals={'b-pp':150000,'b-emv':150000,'b-rent':600,'b-mr':7,'b-dp':25,'b-sol':1500,'b-mf':1000,'b-srch':300,'b-ins':40,'b-mgmt':10,'b-maint':10,'b-ty':7,'b-tr':15,'b-term':25}; dd={'bb-refi-type':'io'}; E.cBTL();
hand.push(['Loss-making BTL: payback text is Never',text('bm-pb')==='Never'?1:0,1]);
vals={'b-pp':80000,'b-emv':160000,'b-rent':900,'b-mr':5,'b-dp':25,'b-ref':15000,'b-sol':1500,'b-mf':1000,'b-srch':300,'b-ins':40,'b-mgmt':10,'b-maint':8,'b-ty':7,'b-tr':15,'b-term':25,'bb-refi-ltv':75}; dd={'bb-refi-type':'io'}; E.cBTL();
hand.push(['All money out: money left in',E.btl.bbMLI,-18200],['All money out: cashflow',E.btl.bbNy,2376],
  ['All money out: ROI text',text('bb-roi')==='All money out'?1:0,1],['All money out: meets target',E.btl.meetsROIBRRR?1:0,1],['All money out: payback Instant',text('bb-pb')==='Instant'?1:0,1]);
hand.forEach(([n,a,b])=>{checks++;if(!(Math.abs(a-b)<=0.01))fails.push(`HAND ${n}: engine ${a} vs expected ${b}`);});

console.log(`calc-engine.js check: ${checks} checks, ${fails.length} mismatches`);
if(fails.length){console.log(fails.slice(0,40).join('\n'));process.exit(1);}

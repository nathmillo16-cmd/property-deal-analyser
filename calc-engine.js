// Verified calculation core — BTL/HMO/SA/Flip, stamp duty, mortgage interest.
// Shared by index.html (real calculator) and landing.html (free taster).
// Do not edit formulas here without explicit instruction — see CLAUDE.md.

function stamp(p){
  let tax=0,detail=[];
  if(p<=250000){tax=p*0.03;detail.push(`£0–£250k @ 3% = £${Math.round(tax).toLocaleString()}`);}
  else if(p<=925000){tax=(p-250000)*0.08+(250000*0.03);detail.push(`£0–£250k @ 3% = £${Math.round(250000*0.03).toLocaleString()}`,`£250k–£${Math.round(p/1000)}k @ 8% = £${Math.round((p-250000)*0.08).toLocaleString()}`);}
  else if(p<=1500000){tax=(p-925000)*0.13+(925000-250000)*0.08+(250000*0.03);}
  else{tax=(p-1500000)*0.15+(1500000-925000)*0.13+(925000-250000)*0.08+(250000*0.03);}
  return{total:Math.round(tax),detail};
}
function mort(loan,rate){return(loan*rate/100)/12;}
function fmt(n){return'£'+Math.round(n).toLocaleString();}
function fP(n){return n.toFixed(2)+'%';}
function cl(v,g,w){return v>=g?'good':v>=w?'warn':'bad';}
function s(id,val,cls){const e=document.getElementById(id);if(e){e.textContent=val;if(cls!==undefined)e.className='mv '+(cls||'');}}

let btlData={}, hmoData={}, saData={}, flipData={};

function cBTL(){
  const pp=+document.getElementById('b-pp').value||0;
  const emv=+document.getElementById('b-emv').value||0;
  const rent=+document.getElementById('b-rent').value||0;
  const mr=+document.getElementById('b-mr').value||0;
  const dp=(+document.getElementById('b-dp').value||25)/100;
  const ref=+document.getElementById('b-ref').value||0;
  const sol=+document.getElementById('b-sol').value||0;
  const mf=+document.getElementById('b-mf').value||0;
  const srch=+document.getElementById('b-srch').value||0;
  const ins=+document.getElementById('b-ins').value||0;
  const mgmt=(+document.getElementById('b-mgmt').value||0)/100;
  const maint=(+document.getElementById('b-maint').value||10)/100;
  const ty=+document.getElementById('b-ty').value||7;
  const tr=+document.getElementById('b-tr').value||15;

  const dep=emv*dp, loan=emv-dep, mm=mort(loan,mr), sd=stamp(pp);
  const maintC=rent*maint, mgmtC=rent*mgmt;
  const mNm=rent-ins-maintC-mgmtC-mm, mNy=mNm*12;
  const cNm=rent-maintC-ins-mgmtC, cNy=cNm*12;
  const ag=rent*12;
  const mTI=sol+mf+srch+dep+ref+pp-loan, cTI=pp+sol+mf+srch+ref;
  const gy=emv>0?(ag/emv)*100:0, mny=emv>0?(mNy/emv)*100:0, cny=emv>0?(cNy/emv)*100:0;
  const mMLI=cTI-loan, mROI=mMLI!==0?(mNy/mMLI)*100:0, cROI=cTI>0?(cNy/cTI)*100:0;
  const mPB=mNy!==0?mMLI/mNy:0, cPB=cNy>0?cTI/cNy:0;

  const oY=ag/(ty/100);
  const tMLI=mNy/(tr/100), oR=tMLI+loan-sol-mf-srch-ref;

  document.getElementById('b-ly').textContent=ty;
  document.getElementById('b-lr').textContent=tr;
  s('bm-nm',fmt(mNm),cl(mNm,200,0));s('bm-ny',fmt(mNy),cl(mNy,2400,0));
  s('bm-gy',fP(gy),cl(gy,7,5));s('bm-ny2',fP(mny),cl(mny,4,2));
  s('bm-roi',fP(mROI),cl(mROI,15,8));s('bm-ti',fmt(mTI));
  s('bm-mli',fmt(mMLI),mMLI<=0?'good':'');s('bm-pb',mPB!==0?Math.abs(mPB).toFixed(2)+' yrs':'N/A');
  s('bm-loan',fmt(loan));s('bm-rate',fP(mr));s('bm-deposit',fmt(dep));s('bm-mpay',fmt(mm));
  s('bc-nm',fmt(cNm),cl(cNm,200,0));s('bc-ny',fmt(cNy),cl(cNy,2400,0));
  s('bc-gy',fP(gy),cl(gy,7,5));s('bc-ny2',fP(cny),cl(cny,4,2));
  s('bc-roi',fP(cROI),cl(cROI,15,8));s('bc-ti',fmt(cTI));
  s('bc-mli',fmt(cTI));s('bc-pb',cPB>0?cPB.toFixed(2)+' yrs':'N/A');
  document.getElementById('b-sn').innerHTML='Stamp duty (BTL): £'+sd.total.toLocaleString()+' — '+sd.detail.join(' · ');
  document.getElementById('b-oy').textContent=fmt(oY);
  document.getElementById('b-oyn').textContent=(oY-pp)<0?fmt(Math.abs(oY-pp))+' below asking':fmt(oY-pp)+' above asking';
  document.getElementById('b-or').textContent=oR>0?fmt(oR):'Cannot achieve at these inputs';
  if(oR>0)document.getElementById('b-orn').textContent=(oR-pp)<0?fmt(Math.abs(oR-pp))+' below asking':fmt(oR-pp)+' above asking';

  btlData={pp,emv,rent,mr,dp:dp*100,ref,sol,mf,srch,ins,mgmt:mgmt*100,maint:maint*100,ty,tr,
    loan:Math.round(loan),deposit:Math.round(dep),monthlyPayment:Math.round(mm),
    mNm:Math.round(mNm),mNy:Math.round(mNy),cNm:Math.round(cNm),cNy:Math.round(cNy),
    gy:+gy.toFixed(2),mny:+mny.toFixed(2),cny:+cny.toFixed(2),
    mROI:+mROI.toFixed(2),cROI:+cROI.toFixed(2),
    mMLI:Math.round(mMLI),mTI:Math.round(mTI),cTI:Math.round(cTI),
    mPB:+Math.abs(mPB).toFixed(2),cPB:+cPB.toFixed(2),
    stampDuty:sd.total,oY:Math.round(oY),oR:Math.round(oR),
    meetsYield:gy>=ty,meetsROI:mROI>=tr};
}

function cHMO(){
  const pp=+document.getElementById('h-pp').value||0;
  const emv=+document.getElementById('h-emv').value||0;
  const mr=+document.getElementById('h-mr').value||5;
  const dp=(+document.getElementById('h-dp').value||25)/100;
  const ref=+document.getElementById('h-ref').value||0;
  const sol=+document.getElementById('h-sol').value||0;
  const mf=+document.getElementById('h-mf').value||0;
  const lic=+document.getElementById('h-lic').value||0;
  const srch=+document.getElementById('h-srch').value||0;
  const ins=+document.getElementById('h-ins').value||0;
  const wifi=+document.getElementById('h-wifi').value||0;
  const ct=(+document.getElementById('h-ct').value||0)/12;
  const maint=(+document.getElementById('h-maint').value||0)/100;
  const mgmt=(+document.getElementById('h-mgmt').value||0)/100;
  const ty=+document.getElementById('h-ty').value||10;
  const troi=+document.getElementById('h-troi').value||15;

  const rooms=[[+document.getElementById('h-r1p').value||0,+document.getElementById('h-r1n').value||0,'h-r1t'],
               [+document.getElementById('h-r2p').value||0,+document.getElementById('h-r2n').value||0,'h-r2t'],
               [+document.getElementById('h-r3p').value||0,+document.getElementById('h-r3n').value||0,'h-r3t'],
               [+document.getElementById('h-r4p').value||0,+document.getElementById('h-r4n').value||0,'h-r4t']];
  let totalRent=0;
  rooms.forEach(([price,num,id])=>{const t=price*num;totalRent+=t;document.getElementById(id).textContent='£'+t.toLocaleString();});
  document.getElementById('h-tr').textContent='£'+totalRent.toLocaleString();
  const bills=totalRent*0.1;
  document.getElementById('h-bills').textContent='£'+Math.round(bills).toLocaleString();

  const sd=stamp(pp), dep=emv*dp, loan=emv*0.75, mm=mort(loan,mr);
  const maintC=totalRent*maint, mgmtC=totalRent*mgmt;
  const mNm=totalRent-bills-ins-wifi-ct-maintC-mgmtC-mm, mNy=mNm*12;
  const cNm=totalRent-bills-ins-wifi-ct-maintC-mgmtC, cNy=cNm*12;
  const ag=totalRent*12;
  const mTI=dep+sol+mf+lic+ref+sd.total, cTI=pp+sol+mf+lic+ref+sd.total+srch;
  const gy=emv>0?(ag/emv)*100:0, mny=emv>0?(mNy/emv)*100:0, cny=emv>0?(cNy/emv)*100:0;
  const mROI=mTI!==0?(mNy/mTI)*100:0, cROI=cTI>0?(cNy/cTI)*100:0;
  const mPB=mNy!==0?mTI/mNy:0, cPB=cNy>0?cTI/cNy:0;

  const oY=totalRent>0?ag/(ty/100):0;
  document.getElementById('h-ly').textContent=ty;
  document.getElementById('h-lroi').textContent=troi;
  s('hm-nm',fmt(mNm),cl(mNm,300,0));s('hm-ny',fmt(mNy),cl(mNy,3600,0));
  s('hm-gy',fP(gy),cl(gy,10,7));s('hm-ny2',fP(mny),cl(mny,6,4));
  s('hm-roi',fP(mROI),cl(mROI,15,8));s('hm-ti',fmt(mTI));
  s('hm-mli',fmt(mTI));s('hm-pb',mPB!==0?Math.abs(mPB).toFixed(2)+' yrs':'N/A');
  s('hm-loan',fmt(loan));s('hm-rate',fP(mr));s('hm-deposit',fmt(dep));s('hm-mpay',fmt(mm));
  s('hc-nm',fmt(cNm),cl(cNm,300,0));s('hc-ny',fmt(cNy),cl(cNy,3600,0));
  s('hc-gy',fP(gy),cl(gy,10,7));s('hc-ny2',fP(cny),cl(cny,6,4));
  s('hc-roi',fP(cROI),cl(cROI,15,8));s('hc-ti',fmt(cTI));
  s('hc-mli',fmt(cTI));s('hc-pb',cPB>0?cPB.toFixed(2)+' yrs':'N/A');
  document.getElementById('h-sn').innerHTML='Stamp duty (BTL): £'+sd.total.toLocaleString()+' — '+sd.detail.join(' · ');
  document.getElementById('h-oy').textContent=oY>0?fmt(oY):'Enter rooms first';
  if(oY>0){document.getElementById('h-oyn').textContent=(oY-pp)<0?fmt(Math.abs(oY-pp))+' below asking':fmt(oY-pp)+' above asking';}

  let oR=0;
  if(totalRent>0){
    let lo=10000,hi=2000000;
    for(let i=0;i<80;i++){const mid=(lo+hi)/2;const sdM=stamp(mid).total;const tiM=dep+sol+mf+lic+ref+sdM;const roiM=tiM!==0?(mNy/tiM)*100:0;if(roiM>troi)hi=mid;else lo=mid;}
    oR=(lo+hi)/2;
  }
  document.getElementById('h-or').textContent=oR>0&&oR<1900000?fmt(oR):'Cannot achieve at these inputs';
  if(oR>0&&oR<1900000){document.getElementById('h-orn').textContent=(oR-pp)<0?fmt(Math.abs(oR-pp))+' below asking':fmt(oR-pp)+' above asking';}

  hmoData={pp,emv,totalRent,mr,dp:dp*100,ref,sol,mf,lic,srch,ins,wifi,ctMonthly:Math.round(ct),maint:maint*100,mgmt:mgmt*100,ty,troi,
    loan:Math.round(loan),deposit:Math.round(dep),monthlyPayment:Math.round(mm),
    mNm:Math.round(mNm),mNy:Math.round(mNy),cNm:Math.round(cNm),cNy:Math.round(cNy),
    gy:+gy.toFixed(2),mny:+mny.toFixed(2),cny:+cny.toFixed(2),
    mROI:+mROI.toFixed(2),cROI:+cROI.toFixed(2),
    mTI:Math.round(mTI),cTI:Math.round(cTI),
    mPB:+Math.abs(mPB).toFixed(2),cPB:+cPB.toFixed(2),
    stampDuty:sd.total,oY:Math.round(oY),oR:Math.round(oR),bills:Math.round(bills),
    meetsYield:gy>=ty,meetsROI:mROI>=troi};
}

function cSA(){
  const rate=+document.getElementById('sa-rate').value||0;
  const occ=+document.getElementById('sa-occ').value||0;
  const pp=+document.getElementById('sa-pp').value||0;
  const emv=+document.getElementById('sa-emv').value||0;
  const mr=+document.getElementById('sa-mr').value||0;
  const dp=(+document.getElementById('sa-dp').value||25)/100;
  const sol=+document.getElementById('sa-sol').value||0;
  const mf=+document.getElementById('sa-mf').value||0;
  const srch=+document.getElementById('sa-srch').value||0;
  const ref=+document.getElementById('sa-ref').value||0;
  const furn=+document.getElementById('sa-furn').value||0;
  const wg=+document.getElementById('sa-wg').value||0;
  const mgmt=(+document.getElementById('sa-mgmt').value||10)/100;
  const util=(+document.getElementById('sa-util').value||10)/100;
  const maint=(+document.getElementById('sa-maint').value||10)/100;
  const clean=+document.getElementById('sa-clean').value||0;
  const ins=+document.getElementById('sa-ins').value||0;
  const ct=+document.getElementById('sa-ct').value||0;
  const ty=+document.getElementById('sa-ty').value||12;
  const troi=+document.getElementById('sa-troi').value||20;

  const ag=rate*(occ/100)*365;
  const mgmtCost=ag*mgmt, utilCost=ag*util, maintCost=ag*maint;
  const cleanA=clean*12, insA=ins*12;
  const totalCosts=mgmtCost+utilCost+maintCost+cleanA+insA+ct;
  const netInc=ag-totalCosts;

  const dep=emv*dp, loan=emv-dep, mm=mort(loan,mr), sd=stamp(pp);
  const mortIntA=mm*12;

  const mCFy=netInc-mortIntA, mCFm=mCFy/12;
  const cCFy=netInc, cCFm=cCFy/12;
  const incM=netInc/12, incY=netInc;

  const gy=emv>0?(ag/emv)*100:0;
  const mny=emv>0?(mCFy/emv)*100:0;
  const cny=emv>0?(cCFy/emv)*100:0;

  const mTI=sol+mf+srch+dep+ref+furn+wg+pp-loan;
  const cTI=pp+sol+mf+srch+ref+furn+wg;
  const mROI=mTI!==0?(mCFy/mTI)*100:0;
  const cROI=cTI>0?(cCFy/cTI)*100:0;

  const oY=ty>0?ag/(ty/100):0;
  const tMLI=troi>0?mCFy/(troi/100):0, oR=tMLI+loan-sol-mf-srch-ref-furn-wg;

  document.getElementById('sa-ly').textContent=ty;
  document.getElementById('sa-lr').textContent=troi;

  s('sam-gy',fP(gy),cl(gy,10,7));
  s('sam-ny',fP(mny),cl(mny,6,4));
  s('sam-roi',fP(mROI),cl(mROI,15,8));
  s('sam-im',fmt(incM));
  s('sam-iy',fmt(incY));
  s('sam-cfm',fmt(mCFm),cl(mCFm,300,0));
  s('sam-cfy',fmt(mCFy),cl(mCFy,3600,0));
  s('sam-loan',fmt(loan));s('sam-rate',fP(mr));s('sam-deposit',fmt(dep));s('sam-mpay',fmt(mm));

  s('sac-gy',fP(gy),cl(gy,10,7));
  s('sac-ny',fP(cny),cl(cny,6,4));
  s('sac-roi',fP(cROI),cl(cROI,15,8));
  s('sac-im',fmt(incM));
  s('sac-iy',fmt(incY));
  s('sac-cfm',fmt(cCFm),cl(cCFm,300,0));
  s('sac-cfy',fmt(cCFy),cl(cCFy,3600,0));

  document.getElementById('sa-sn').innerHTML='Stamp duty (BTL): £'+sd.total.toLocaleString()+' — '+sd.detail.join(' · ');

  document.getElementById('sa-oy').textContent=oY>0?fmt(oY):'Cannot achieve at these inputs';
  if(oY>0)document.getElementById('sa-oyn').textContent=(oY-pp)<0?fmt(Math.abs(oY-pp))+' below asking':fmt(oY-pp)+' above asking';
  document.getElementById('sa-or').textContent=oR>0?fmt(oR):'Cannot achieve at these inputs';
  if(oR>0)document.getElementById('sa-orn').textContent=(oR-pp)<0?fmt(Math.abs(oR-pp))+' below asking':fmt(oR-pp)+' above asking';

  saData={rate,occ,pp,emv,mr,dp:dp*100,sol,mf,srch,ref,furn,wg,mgmt:mgmt*100,util:util*100,maint:maint*100,clean,ins,ct,ty,troi,
    loan:Math.round(loan),deposit:Math.round(dep),monthlyPayment:Math.round(mm),
    annualRevenue:Math.round(ag),netAnnualIncome:Math.round(netInc),
    mCFy:Math.round(mCFy),mCFm:Math.round(mCFm),cCFy:Math.round(cCFy),cCFm:Math.round(cCFm),
    incM:Math.round(incM),incY:Math.round(incY),
    gy:+gy.toFixed(2),mny:+mny.toFixed(2),cny:+cny.toFixed(2),
    mROI:+mROI.toFixed(2),cROI:+cROI.toFixed(2),
    mTI:Math.round(mTI),cTI:Math.round(cTI),
    stampDuty:sd.total,oY:Math.round(oY),oR:Math.round(oR),
    meetsYield:gy>=ty,meetsROI:mROI>=troi};
}

function cFlip(){
  const pp=+document.getElementById('fl-pp').value||0;
  const bf=+document.getElementById('fl-bf').value||0;
  const ref=+document.getElementById('fl-ref').value||0;
  const sv=+document.getElementById('fl-sv').value||0;
  const agentPct=(+document.getElementById('fl-agent').value||2)/100;
  const contPct=(+document.getElementById('fl-cont').value||0)/100;
  const troi=+document.getElementById('fl-troi').value||20;

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
  s('fl-agentout',fmt(agentAmt));
  s('fl-contout',fmt(contAmt));

  let oR=0;
  if(sv>0){
    let lo=1000,hi=sv;
    for(let i=0;i<80;i++){
      const mid=(lo+hi)/2;
      const sdM=stamp(mid).total;
      const tiM=mid+sdM+bf+ref+contAmt;
      const profitM=sv-mid-sdM-bf-ref-contAmt-agentAmt;
      const roiM=tiM!==0?(profitM/tiM)*100:0;
      if(roiM>troi)lo=mid; else hi=mid;
    }
    oR=(lo+hi)/2;
  }
  document.getElementById('fl-or').textContent=oR>0?fmt(oR):'Cannot achieve at these inputs';
  if(oR>0)document.getElementById('fl-orn').textContent=(oR-pp)<0?fmt(Math.abs(oR-pp))+' below asking':fmt(oR-pp)+' above asking';

  flipData={pp,bf,ref,sv,agentPct:agentPct*100,contPct:contPct*100,troi,
    stampDuty:sd.total,agentAmt:Math.round(agentAmt),contAmt:Math.round(contAmt),
    ti:Math.round(ti),profit:Math.round(profit),roi:+roi.toFixed(2),margin:+margin.toFixed(2),
    oR:Math.round(oR),
    meetsROI:roi>=troi};
}

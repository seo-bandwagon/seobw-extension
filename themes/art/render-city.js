// Neon-city NTP artwork generator. Deterministic: same seed -> same city.
// Loaded and evaluated by the build scripts; not shipped in either package.
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296}}
function glow(ctx,x,y,rx,ry,rgb,a){
  ctx.save(); ctx.translate(x,y); ctx.scale(1,ry/rx);
  const g=ctx.createRadialGradient(0,0,0,0,0,rx);
  g.addColorStop(0,'rgba('+rgb+','+a+')'); g.addColorStop(0.42,'rgba('+rgb+','+(a*0.34)+')'); g.addColorStop(1,'rgba('+rgb+',0)');
  ctx.fillStyle=g; ctx.beginPath(); ctx.arc(0,0,rx,0,7); ctx.fill(); ctx.restore();
}
var PAL={
  night:{ skyTop:'#000018',skyMid:'#010124',skyHorizon:'#0A0A38',groundTop:'#070728',groundBottom:'#000006',
    city:['#141450','#0D0D3C','#060626'],fg:'#02020F',edgeRGB:'0,0,34',
    grid:'245,55,150',haze:'245,55,150',win:['245,55,150','245,245,245'],
    scan:'0,0,0',scanA:0.03,bloomA:0.18,hazeA:0.26,gridTopA:0.26,
    winA:[0.8,0.4],lit:[0.09,0.21,0.25],rimA:0.34,adA:0.07,pinkShare:[0.32,0.38,0.44],fgLit:0.09,fgA:[0.6,0.28]},
  day:{ skyTop:'#F5F5F5',skyMid:'#F2F2F1',skyHorizon:'#E9E9E8',groundTop:'#DFDFDE',groundBottom:'#F1F1F0',
    city:['#CACAD4','#AEAEBC','#8C8C9D'],fg:'#2E2E45',edgeRGB:'245,245,245',
    grid:'194,24,91',haze:'245,55,150',win:['194,24,91','0,0,34'],
    scan:'0,0,34',scanA:0.018,bloomA:0.13,hazeA:0.18,gridTopA:0.22,
    winA:[0.6,0.24],lit:[0.06,0.15,0.19],rimA:0.28,adA:0.05,pinkShare:[0.38,0.46,0.52],fgLit:0.09,fgA:[0.6,0.28]}
};
function draw(createCanvas,W,H,P,seed){
  const c=createCanvas(W,H),ctx=c.getContext('2d');
  const cx=W/2,hz=H-230,rng=mulberry32(seed);
  let g=ctx.createLinearGradient(0,0,0,hz);
  g.addColorStop(0,P.skyTop); g.addColorStop(0.62,P.skyMid); g.addColorStop(1,P.skyHorizon);
  ctx.fillStyle=g; ctx.fillRect(0,0,W,hz);
  g=ctx.createLinearGradient(0,hz,0,H);
  g.addColorStop(0,P.groundTop); g.addColorStop(0.6,P.groundBottom); g.addColorStop(1,P.groundBottom);
  ctx.fillStyle=g; ctx.fillRect(0,hz,W,H-hz);
  glow(ctx,cx,hz,980,600,P.haze,P.bloomA);
  glow(ctx,cx-940,hz-90,520,300,P.haze,P.adA);
  glow(ctx,cx+1280,hz-70,460,260,P.haze,P.adA*0.8);

  const layers=[
    {fill:P.city[0],hMin:26,hMax:105,wMin:24,wMax:68, gap:[4,14],cw:9, ch:13,base:0, li:0},
    {fill:P.city[1],hMin:48,hMax:165,wMin:32,wMax:94, gap:[6,20],cw:11,ch:16,base:4, li:1},
    {fill:P.city[2],hMin:72,hMax:215,wMin:44,wMax:132,gap:[8,28],cw:13,ch:19,base:9, li:2}];
  const beacons=[];
  layers.forEach(function(L){
    let x=-120;
    while(x<W+120){
      const w=L.wMin+rng()*(L.wMax-L.wMin), h=L.hMin+Math.pow(rng(),1.6)*(L.hMax-L.hMin);
      const by=hz+L.base, ty=by-h;
      ctx.fillStyle=L.fill; ctx.fillRect(Math.round(x),Math.round(ty),Math.round(w),Math.round(h));
      if(h>L.hMax*0.68&&rng()<0.6){
        const cwid=w*(0.38+rng()*0.3),cxx=x+(w-cwid)/2,chg=14+rng()*30;
        ctx.fillRect(Math.round(cxx),Math.round(ty-chg),Math.round(cwid),Math.round(chg)+2);
        if(L.li>0&&rng()<0.45) beacons.push([cxx+cwid/2,ty-chg]);
      }
      if(L.li>0||rng()<0.4)
        for(let wy=ty+L.ch; wy<by-4; wy+=L.ch)
          for(let wx=x+4; wx<x+w-6; wx+=L.cw){
            if(rng()>P.lit[L.li]) continue;
            const pink=rng()<P.pinkShare[L.li];
            ctx.fillStyle='rgba('+(pink?P.win[0]:P.win[1])+','+((pink?P.winA[0]:P.winA[1])*(0.55+rng()*0.45))+')';
            ctx.fillRect(Math.round(wx),Math.round(wy),Math.max(2,L.cw-6),Math.max(2,L.ch-10));
          }
      x+=w+L.gap[0]+rng()*(L.gap[1]-L.gap[0]);
    }
  });
  glow(ctx,cx,hz-16,2900,140,P.haze,P.hazeA);

  ctx.save(); ctx.beginPath(); ctx.rect(0,hz,W,H-hz); ctx.clip();
  const fadeEnd=hz+(H-hz)*0.85;
  for(let i=-46;i<=46;i++){
    if(!i) continue;
    const k=Math.max(0,1-Math.pow(Math.abs(i)/30,1.7)); if(k<=0.02) continue;
    const lg=ctx.createLinearGradient(0,hz,0,fadeEnd);
    lg.addColorStop(0,'rgba('+P.grid+','+(P.gridTopA*k)+')');
    lg.addColorStop(0.45,'rgba('+P.grid+','+(P.gridTopA*k*0.4)+')');
    lg.addColorStop(1,'rgba('+P.grid+',0)');
    ctx.strokeStyle=lg; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(cx,hz); ctx.lineTo(cx+i*112,H); ctx.stroke();
  }
  for(let i=1,n=18;i<=n;i++){
    const t=i/n, y=hz+(H-hz)*Math.pow(t,2.4);
    const a=P.gridTopA*Math.max(0,1-Math.pow(t,0.72)*1.1); if(a<=0.004) continue;
    const hg=ctx.createLinearGradient(cx-1900,0,cx+1900,0);
    hg.addColorStop(0,'rgba('+P.grid+',0)');
    hg.addColorStop(0.28,'rgba('+P.grid+','+(a*0.55)+')');
    hg.addColorStop(0.5,'rgba('+P.grid+','+a+')');
    hg.addColorStop(0.72,'rgba('+P.grid+','+(a*0.55)+')');
    hg.addColorStop(1,'rgba('+P.grid+',0)');
    ctx.strokeStyle=hg; ctx.lineWidth=1+t*1.2;
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  beacons.forEach(function(b){
    const bx=b[0],by=b[1];
    if(rng()<0.5) return;
    ctx.strokeStyle='rgba('+P.win[0]+',0.3)'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(bx,by); ctx.lineTo(bx,by-20); ctx.stroke();
    ctx.shadowColor='rgba('+P.win[0]+',0.9)'; ctx.shadowBlur=12;
    ctx.fillStyle='rgba('+P.win[0]+',0.95)';
    ctx.beginPath(); ctx.arc(bx,by-22,2.2,0,7); ctx.fill(); ctx.shadowBlur=0;
  });
  ctx.restore();

  function slab(left,w,top,dir){
    const st=w*(0.32+rng()*0.3), sx=rng()<0.5?left:left+w-st, sTop=top-(30+rng()*55);
    ctx.fillStyle=P.fg;
    ctx.fillRect(Math.round(sx),Math.round(sTop),Math.round(st),Math.round(top-sTop)+4);
    ctx.fillRect(Math.round(left),Math.round(top),Math.round(w),H-Math.round(top));
    const edge=dir>0?left:left+w-1;
    for(let d=0;d<9;d++){
      const ah=P.rimA*Math.pow(1-d/9,1.7);
      const sg=ctx.createLinearGradient(0,top,0,H);
      sg.addColorStop(0,'rgba('+P.win[0]+',0)');
      sg.addColorStop(0.5,'rgba('+P.win[0]+','+(ah*0.55)+')');
      sg.addColorStop(1,'rgba('+P.win[0]+','+ah+')');
      ctx.fillStyle=sg; ctx.fillRect(edge+dir*d,top,1,H-top);
    }
    for(let wy=top+34; wy<H-22; wy+=34)
      for(let wx=left+16; wx<left+w-22; wx+=28){
        if(rng()>P.fgLit) continue;
        const pink=rng()<0.44;
        ctx.fillStyle='rgba('+(pink?P.win[0]:P.win[1])+','+((pink?P.fgA[0]:P.fgA[1])*(0.45+rng()*0.55))+')';
        ctx.fillRect(Math.round(wx),Math.round(wy),11,14);
      }
  }
  [[1,618],[-1,646]].forEach(function(pair){
    const dir=pair[0]; let x=cx+dir*pair[1],k=0;
    while(x>-460&&x<W+460){
      const w=(k?130+rng()*260:170+rng()*120), top=(k?730+rng()*150:700+rng()*120);
      slab(dir>0?x:x-w,w,top,dir); x+=dir*(w+150+rng()*320); k++;
    }
  });

  const E=P.edgeRGB;
  g=ctx.createLinearGradient(0,0,340,0); g.addColorStop(0,'rgba('+E+',1)'); g.addColorStop(1,'rgba('+E+',0)');
  ctx.fillStyle=g; ctx.fillRect(0,0,340,H);
  g=ctx.createLinearGradient(W,0,W-340,0); g.addColorStop(0,'rgba('+E+',1)'); g.addColorStop(1,'rgba('+E+',0)');
  ctx.fillStyle=g; ctx.fillRect(W-340,0,340,H);
  g=ctx.createLinearGradient(0,0,0,340);
  g.addColorStop(0,'rgba('+E+',1)'); g.addColorStop(0.38,'rgba('+E+',1)'); g.addColorStop(1,'rgba('+E+',0)');
  ctx.fillStyle=g; ctx.fillRect(0,0,W,340);
  ctx.fillStyle='rgba('+P.scan+','+P.scanA+')';
  for(let y=0;y<H;y+=3) ctx.fillRect(0,y,W,1);
  return c;
}
if (typeof module !== 'undefined' && module.exports) module.exports = { PAL, draw };

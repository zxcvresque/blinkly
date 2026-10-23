/* Blinkly's Window & Mist canvas scenes, adapted from the supplied visual reference.
 * Controllers own timing, animation frames and UI. This module only draws supplied progress.
 */
(function (scope, factory) {
  'use strict';
  const api = factory(scope);
  scope.BlinklyScenes = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis, function (scope) {
  'use strict';
  const DEFAULT_ACCENT = '#ef5b78';
  const hsl = (h,s,l,a=1) => `hsl(${((h%360)+360)%360} ${Math.min(100,Math.max(0,s))}% ${Math.min(100,Math.max(0,l))}% / ${a})`;
  const sm=t=>t*t*(3-2*t),lp=(a,b,t)=>a+(b-a)*t,cl=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
  const generator = initial => { let seed=initial; return ()=>(seed=(seed*16807)%2147483647)/2147483647; };
  const noiseRandom=generator(11), NS=256, NG=new Float32Array(NS*NS);
  for(let i=0;i<NG.length;i++) NG[i]=noiseRandom();
  function N(x,y,per){const xi=Math.floor(x),yi=Math.floor(y),u=sm(x-xi),v=sm(y-yi);
    const w=(a,b)=>NG[((b&255)<<8)+((per?((a%per)+per)%per:a)&255)];
    return lp(lp(w(xi,yi),w(xi+1,yi),u),lp(w(xi,yi+1),w(xi+1,yi+1),u),v);
  }
  function fbm(x,y,per=0,o=4){let a=.5,s=0,f=1;for(let i=0;i<o;i++){s+=a*N(x*f,y*f,per*f);a*=.5;f*=2}return s}
  const documents=new WeakMap();
  function surface(canvas,w,h) {
    const doc=canvas.ownerDocument;
    const c=doc?.createElement ? doc.createElement('canvas') : typeof scope.OffscreenCanvas==='function' ? new scope.OffscreenCanvas(w,h) : null;
    if(!c) throw new TypeError('A canvas document or OffscreenCanvas is required.');
    c.width=w;c.height=h;return c;
  }
  function resources(canvas) {
    const owner=canvas.ownerDocument || canvas;
    if(documents.has(owner))return documents.get(owner);
    const rnd=generator(781),grain=surface(canvas,180,180),wall=surface(canvas,332,330),mist=surface(canvas,1024,128);
    let g=grain.getContext('2d'),im=g.createImageData(180,180);
    for(let i=0;i<im.data.length;i+=4){const v=rnd()*255;im.data[i]=im.data[i+1]=im.data[i+2]=v;im.data[i+3]=255}g.putImageData(im,0,0);
    g=wall.getContext('2d');im=g.createImageData(332,330);
    for(let j=0;j<330;j++)for(let i=0;i<332;i++){const v=128+(fbm(i/50,j/50,0,5)-.5)*170+(rnd()-.5)*34,k=(j*332+i)*4;im.data[k]=im.data[k+1]=im.data[k+2]=v;im.data[k+3]=255}g.putImageData(im,0,0);
    g=mist.getContext('2d');im=g.createImageData(1024,128);
    for(let j=0;j<128;j++){const vy=Math.exp(-Math.pow((j-64)/28,2));for(let i=0;i<1024;i++){const a=cl((fbm(i/1024*8,j/128*1.6,8,4)-.36)*3.4)*vy,k=(j*1024+i)*4;im.data[k]=im.data[k+1]=im.data[k+2]=255;im.data[k+3]=a*255}}g.putImageData(im,0,0);
    const result={grain,wall,mist};documents.set(owner,result);return result;
  }
  function hexHsl(x){let r=parseInt(x.slice(1,3),16)/255,g=parseInt(x.slice(3,5),16)/255,b=parseInt(x.slice(5,7),16)/255;const m=Math.max(r,g,b),n=Math.min(r,g,b),d=m-n,l=(m+n)/2;let h=0;if(d){h=m===r?((g-b)/d)%6:m===g?(b-r)/d+2:(r-g)/d+4;h*=60}return[(h+360)%360,cl((d?d/(1-Math.abs(2*l-1)):0)*100,35,85)]}
  function accent(value) {
    if(typeof value!=='string')return DEFAULT_ACCENT;
    if(/^#[0-9a-f]{3}$/i.test(value))return '#'+value.slice(1).split('').map(c=>c+c).join('').toLowerCase();
    return /^#[0-9a-f]{6}$/i.test(value)?value.toLowerCase():DEFAULT_ACCENT;
  }
  function frame(value={}) {
    return {progress:cl(Number.isFinite(value.progress)?value.progress:0),clock:Number.isFinite(value.clock)?value.clock:0,
      dt:cl(Number.isFinite(value.dt)?value.dt:0,0,.1),accent:accent(value.accent)};
  }
  function context(canvas) {
    if(!canvas || typeof canvas.getContext!=='function')throw new TypeError('A drawing canvas is required.');
    const ctx=canvas.getContext('2d');if(!ctx)throw new TypeError('A 2D canvas context is required.');return ctx;
  }
  function size(canvas,limit,fallbackW,fallbackH) {
    const rect=typeof canvas.getBoundingClientRect==='function'?canvas.getBoundingClientRect():null;
    const width=Math.max(1,rect?.width || canvas.clientWidth || fallbackW),height=Math.max(1,rect?.height || canvas.clientHeight || fallbackH);
    const view=canvas.ownerDocument?.defaultView || scope;
    let ratio=Math.min(limit,Math.max(1,Number(view.devicePixelRatio)||1));
    ratio=Math.min(ratio,Math.sqrt(4000000/(width*height)));
    const w=Math.max(2,Math.round(width*ratio)),h=Math.max(2,Math.round(height*ratio));
    const resized=canvas.width!==w || canvas.height!==h;
    if(resized){canvas.width=w;canvas.height=h}return {w,h,resized};
  }
  function createWindow(canvas) {
    const P=context(canvas),PW=332,PH=330,{wall,grain}=resources(canvas),rnd=generator(241);
    const lc=surface(canvas,PW,PH),L1=lc.getContext('2d'),pattern=P.createPattern(grain,'repeat');
    const motes=Array.from({length:42},()=>({x:rnd()*PW,y:rnd()*290,vx:(rnd()-.4)*5,vy:rnd()*3+1,ph:rnd()*6.3,s:rnd()*1.1+.5}));
    const leaves=Array.from({length:24},(_,k)=>{const s=k/23;return{x:lp(78,-46,s),y:lp(-92,22,s)+Math.sin(s*6)*7,a:Math.atan2(114,-124)+(k%2?1:-1)*(.8+rnd()*.5),l:28+rnd()*16,w:9+rnd()*5,ph:rnd()*6.3,sp:.7+rnd()*.8}});
    let destroyed=false,H=0,S=60,lastAccent='';
function draw(input={}){
 if(destroyed)return {progress:0,blink:0};
 const current=frame(input),{clock:t,dt}=current,f=current.progress;
 if(current.accent!==lastAccent){lastAccent=current.accent;[H,S]=hexHsl(lastAccent)}
 const fitted=size(canvas,2,PW,PH);P.setTransform(fitted.w/PW,0,0,fitted.h/PH,0,0);
 const I=lp(1,.6,f)*(1-sm(cl((f-.9)/.1))*.65);
 const cx=lp(84,258,f),cy=lp(90,124,f),sk=lp(-.14,.44,f),sy=lp(1,1.3,f),pw=118,ph=150;
 P.globalCompositeOperation="source-over";P.globalAlpha=1;
 const bg=P.createLinearGradient(0,0,0,292);bg.addColorStop(0,hsl(H,16,19));bg.addColorStop(1,hsl(H,14,10));P.fillStyle=bg;P.fillRect(0,0,PW,PH);
 P.globalCompositeOperation="overlay";P.globalAlpha=.9;P.drawImage(wall,0,0);P.globalAlpha=1;
 /* light shape */
 L1.clearRect(0,0,PW,PH);L1.save();L1.setTransform(1,0,sk,sy,cx,cy);
 const g=L1.createLinearGradient(-pw/2,-ph/2,pw/2,ph/2);g.addColorStop(0,hsl(H,S+15,88,.95*I));g.addColorStop(1,hsl(H,S+25,64,.72*I));
 L1.fillStyle=g;L1.fillRect(-pw/2,-ph/2,pw,ph);
 L1.globalCompositeOperation="destination-out";L1.fillStyle="#000";L1.fillRect(-4,-ph/2,8,ph);L1.fillRect(-pw/2,-ph*.1,pw,8);
 L1.fillStyle="rgba(0,0,0,.92)";L1.strokeStyle="rgba(0,0,0,.92)";L1.lineWidth=2.4;L1.translate(78,-92);L1.rotate(Math.sin(t*.45)*.035);L1.translate(-78,92);
 L1.beginPath();L1.moveTo(78,-92);leaves.forEach(q=>L1.lineTo(q.x,q.y));L1.stroke();
 leaves.forEach(q=>{L1.save();L1.translate(q.x,q.y);L1.rotate(q.a+Math.sin(t*q.sp+q.ph)*.16);L1.beginPath();L1.moveTo(0,0);L1.quadraticCurveTo(q.l*.4,-q.w,q.l,0);L1.quadraticCurveTo(q.l*.4,q.w,0,0);L1.fill();L1.restore()});
 L1.restore();
 P.globalCompositeOperation="screen";
 const rg=P.createRadialGradient(cx,cy+30,0,cx,cy+30,210);rg.addColorStop(0,hsl(H,70,60,.2*I));rg.addColorStop(1,hsl(H,70,60,0));P.fillStyle=rg;P.fillRect(0,0,PW,PH);
 P.filter="blur(7px)";P.drawImage(lc,0,0);P.filter="none";P.globalAlpha=.3;P.drawImage(lc,0,0);P.globalAlpha=1;
 /* dust in the beam */
 motes.forEach(m=>{m.x+=m.vx*dt;m.y+=(m.vy+Math.sin(t*.8+m.ph)*2)*dt;if(m.y>290){m.y=0;m.x=rnd()*PW}if(m.x<0)m.x=PW;if(m.x>PW)m.x=0;
  const dy=(m.y-cy)/sy,dx=(m.x-cx)-sk*dy;let a=cl((pw/2-Math.abs(dx))/14)*cl((ph/2-Math.abs(dy))/14)*I;if(Math.abs(dx)<6||Math.abs(dy+ph*.1)<6)a*=.15;
  if(a>.03){P.fillStyle=`rgba(255,248,235,${a*.85*(.55+.45*Math.sin(t*1.6+m.ph))})`;P.beginPath();P.arc(m.x,m.y,m.s,0,6.3);P.fill()}});
 /* baseboard with minute marks */
 P.globalCompositeOperation="source-over";
 P.fillStyle=hsl(H,12,5);P.fillRect(0,292,PW,PH-292);P.fillStyle="rgba(255,255,255,.1)";P.fillRect(0,292,PW,1);
 const mx=16+f*(PW-32);
 for(let i=0;i<=20;i++){const x=16+i*(PW-32)/20;P.fillStyle=x<mx-1?"rgba(255,255,255,.12)":hsl(H,S,72,.7);P.fillRect(x-.5,300,1,i%5==0?13:7)}
 P.save();P.shadowColor=hsl(H,S,70);P.shadowBlur=10;P.fillStyle=hsl(H,S,86);P.fillRect(mx-1,297,2,20);P.restore();
 /* vignette + grain */
 const vg=P.createRadialGradient(PW/2,150,60,PW/2,160,260);vg.addColorStop(0,"rgba(0,0,0,0)");vg.addColorStop(1,"rgba(0,0,0,.5)");P.fillStyle=vg;P.fillRect(0,0,PW,PH);
 P.globalCompositeOperation="overlay";P.globalAlpha=.12;P.fillStyle=pattern;P.save();P.translate(t === 0 ? 0 : rnd()*90,t === 0 ? 0 : rnd()*90);P.fillRect(-90,-90,PW+90,PH+90);P.restore();P.globalAlpha=1;P.globalCompositeOperation="source-over";
 return {progress:f,blink:0};
}

    function destroy(){if(destroyed)return;destroyed=true;lc.width=lc.height=1;}
    return Object.freeze({draw,destroy});
  }
  const M=480,dark=[16,11,7,4,2];
const LY=[{b:.575,a:.11,f:3.2,r:1,v:.07,c0:.15,c1:.5},{b:.64,a:.09,f:4.5,r:1,v:.05,c0:.4,c1:.65},{b:.71,a:.08,f:5.5,r:.6,v:.03,c0:.65,c1:.82},{b:.8,a:.06,f:7,r:0,v:0,c0:.88,c1:.95},{b:.9,a:.05,f:9,r:0,v:0,c0:1,c1:1}];
LY.forEach((l,i)=>{l.y=new Float32Array(M+1);for(let k=0;k<=M;k++){const x=k/M;let n=fbm(x*l.f+i*17.3,i*3.1+.5,0,5);if(l.r){const g=1-Math.abs(2*n-1);n=lp(n,g*g,l.r)}l.y[k]=l.b-(n-.35)*l.a*2+l.v*Math.exp(-Math.pow((x-.5)/.11,2))}});
const starRandom=generator(490);
const stars=Array.from({length:110},()=>[starRandom(),starRandom()*.9,starRandom()*.7+.2]);

  function createRest(canvas) {
    const Q=context(canvas),cv=canvas,{grain,mist}=resources(canvas);
    const refl=surface(canvas,2,2),RX=refl.getContext('2d'),mistT=surface(canvas,1024,128),rnd=generator(995);
    const pattern=Q.createPattern(grain,'repeat');
    const Path=canvas.ownerDocument?.defaultView?.Path2D || scope.Path2D;
    let W=2,Hh=2,trees=null,destroyed=false,H=0,S=60,lastAccent='';
function tintMist(){const g=mistT.getContext("2d");g.globalCompositeOperation="source-over";g.clearRect(0,0,1024,128);g.fillStyle=hsl(H+14,Math.min(S+10,75),72);g.fillRect(0,0,1024,128);g.globalCompositeOperation="destination-in";g.drawImage(mist,0,0)}
function buildTrees(){const rnd=generator(99),commands=[];
 const p=Path?new Path():Object.fromEntries(['moveTo','lineTo','quadraticCurveTo','closePath'].map(name=>[name,(...args)=>commands.push([name,args])]));
 const w=W,h=Hh;
 const add=(x,hh,ww)=>{const pts=[];for(let t=0;t<9;t++){const f=t/9,cw=ww*(1-f)*(.55+.45*rnd()),ty=h-hh*(.1+.9*f);pts.push([cw,ty],[cw*.5,ty-hh*.04])}
  p.moveTo(x-ww*.03,h);p.lineTo(x-ww*.03,h-hh*.1);pts.forEach(q=>p.lineTo(x-q[0],q[1]));p.lineTo(x,h-hh);for(let i=pts.length-1;i>=0;i--)p.lineTo(x+pts[i][0],pts[i][1]);p.lineTo(x+ww*.03,h-hh*.1);p.lineTo(x+ww*.03,h);p.closePath()};
 for(let k=0;k<22;k++){const u=Math.pow(rnd(),1.4)*.3,hh=h*(.3+.5*rnd())*(1-u*1.3),ww=hh*.2;add(u*w,hh,ww);const u2=Math.pow(rnd(),1.4)*.3,hh2=h*(.3+.5*rnd())*(1-u2*1.3);add(w-u2*w,hh2,hh2*.2)}
 p.moveTo(0,h*.82);p.quadraticCurveTo(w*.12,h*.9,w*.32,h*1.01);p.lineTo(0,h*1.01);p.closePath();p.moveTo(w,h*.82);p.quadraticCurveTo(w*.88,h*.9,w*.68,h*1.01);p.lineTo(w,h*1.01);p.closePath();trees=Path?p:commands}
function bloom(x,y,r,l,a){const g=Q.createRadialGradient(x,y,0,x,y,r),c=al=>hsl(H+12,92,l,al);g.addColorStop(0,c(a));g.addColorStop(.25,c(a*.4));g.addColorStop(.6,c(a*.1));g.addColorStop(1,c(0));Q.fillStyle=g;Q.fillRect(x-r,y-r,2*r,2*r)}
function lake(t,e,sx,sy,w,h,hz){
 const wy=Math.round(h*.72),n=h-wy,st=Math.max(1,Math.round(w/640)),am=w*.0065;
 const rip=(y,u)=>{const yy=y/h*420;return(Math.sin(yy*.35+t*1.3+Math.sin(yy*.12)*2)+.5*Math.sin(yy*.9-t*2.1))*am*(.25+u*1.4)};
 RX.drawImage(cv,0,0);
 Q.globalCompositeOperation="source-over";Q.globalAlpha=1;
 Q.fillStyle=hsl(H,40,4+8*e);Q.fillRect(0,wy,w,n);
 for(let y=wy;y<h;y+=st){const u=(y-wy)/n,src=Math.floor(wy-(y-wy)*.92)-st;if(src<0)break;Q.drawImage(refl,0,src,w,st,rip(y,u),y,w,st)}
 const wg=Q.createLinearGradient(0,wy,0,h);wg.addColorStop(0,hsl(H,40,hz*.5,.12));wg.addColorStop(1,hsl(H,40,3,.72));Q.fillStyle=wg;Q.fillRect(0,wy,w,n);
 Q.save();Q.beginPath();Q.rect(0,wy,w,n);Q.clip();Q.globalCompositeOperation="lighter";
 const gl=Q.createRadialGradient(0,0,0,0,0,n);gl.addColorStop(0,hsl(H+12,90,70,.45*e));gl.addColorStop(1,hsl(H+12,90,70,0));
 Q.save();Q.translate(sx,wy+n*.3);Q.scale(.22,1);Q.fillStyle=gl;Q.fillRect(-n,-n,2*n,2*n);Q.restore();
 for(let y=wy+st;y<h;y+=st*2){const u=(y-wy)/n,yy=y/h*420,a=.5+.5*Math.sin(yy*1.7+t*3+Math.sin(yy*.4)*4);if(a>.5){const ww=w*(.006+.05*u)*(a-.35)*2;Q.fillStyle=hsl(H+12,90,90,(a-.45)*1.1*e*(1-u*.4));Q.fillRect(sx+rip(y,u)-ww/2,y,ww,st*1.5)}}
 Q.restore();
 Q.globalCompositeOperation="source-over";Q.globalAlpha=Math.max(.05,.42-.28*e);
 const bh=h*.1,off=((t*7)%1024)/1024*w;Q.drawImage(mistT,0,0,1024,128,-off,wy-bh/2,w,bh);Q.drawImage(mistT,0,0,1024,128,w-off,wy-bh/2,w,bh);Q.globalAlpha=1;
}
function draw(input={}){
 if(destroyed)return {progress:0,blink:0};
 const current=frame(input),t=current.clock,p=current.progress;
 const fitted=size(canvas,1.5,800,500);
 if(fitted.resized || !trees){W=fitted.w;Hh=fitted.h;refl.width=W;refl.height=Hh;buildTrees()}
 if(current.accent!==lastAccent){lastAccent=current.accent;[H,S]=hexHsl(lastAccent);tintMist()}
 Q.setTransform(1,0,0,1,0,0);Q.globalAlpha=1;
 const e=lp(p,sm(p),.5),w=W,h=Hh,hz=11+55*e,sx=w*.5,sy=h*lp(.78,.36,e),vis=.25+.75*e;
 Q.globalCompositeOperation="source-over";
 const sk=Q.createLinearGradient(0,0,0,h*.7);sk.addColorStop(0,hsl(H-35,38,3+14*e));sk.addColorStop(.42,hsl(H-5,46,6+26*e));sk.addColorStop(.7,hsl(H+16,Math.min(S+25,95),10+58*e));Q.fillStyle=sk;Q.fillRect(0,0,w,h);
 Q.fillStyle="#fff";stars.forEach(s=>{Q.globalAlpha=s[2]*(1-e)*.9;Q.fillRect(s[0]*w,s[1]*h*.55,w/700+.6,w/700+.6)});Q.globalAlpha=1;
 Q.globalCompositeOperation="lighter";
 bloom(sx,sy,w*.9,58,.42*vis);bloom(sx,sy,w*.32,76,.5*vis);bloom(sx,sy,w*.07,92,.9*vis);
 Q.globalCompositeOperation="source-over";const r=w*.017;Q.fillStyle=hsl(H,50,97);Q.beginPath();Q.arc(sx,sy,r,0,6.3);Q.fill();
 for(let i=0;i<3;i++){const l=LY[i],c=lp(l.c0,l.c1,e);
  Q.fillStyle=hsl(H+10-i*3,Math.round(S*(.5+.1*i)),hz+(dark[i]-hz)*c);
  Q.beginPath();Q.moveTo(0,h);for(let k=0;k<=M;k++)Q.lineTo(k/M*w,l.y[k]*h);Q.lineTo(w,h);Q.closePath();Q.fill();
  if(i<3&&e>.04){const rg=Q.createLinearGradient(0,0,w,0);rg.addColorStop(.1,hsl(H,90,85,0));rg.addColorStop(.5,hsl(H,90,88,.75*e));rg.addColorStop(.9,hsl(H,90,85,0));
   Q.strokeStyle=rg;Q.lineWidth=Math.max(1,w/700);Q.beginPath();for(let k=0;k<=M;k++)k?Q.lineTo(k/M*w,l.y[k]*h):Q.moveTo(0,l.y[0]*h);Q.stroke()}
  if(i<3){const bh=h*.2,off=((t*(6+i*5)+i*300)%1024)/1024*w;Q.globalAlpha=(.62-.4*e)*(1-i*.12);const y0=(l.b+.035)*h-bh/2;Q.drawImage(mistT,0,0,1024,128,-off,y0,w,bh);Q.drawImage(mistT,0,0,1024,128,w-off,y0,w,bh);Q.globalAlpha=1}}
 lake(t,e,sx,sy,w,h,hz);Q.globalCompositeOperation="lighter";bloom(sx,sy,w*.6,70,.2*e);
 const ls=Q.createRadialGradient(0,0,0,0,0,w*.45);ls.addColorStop(0,hsl(H,80,85,.5*e));ls.addColorStop(1,hsl(H,80,85,0));Q.save();Q.translate(sx,sy);Q.scale(1,.012);Q.fillStyle=ls;Q.fillRect(-w*.45,-w*.45,w*.9,w*.9);Q.restore();
 Q.globalCompositeOperation="source-over";Q.fillStyle=hsl(H,25,2);if(Path)Q.fill(trees);else{Q.beginPath();for(const [name,args] of trees)Q[name](...args);Q.fill()}
 const vg=Q.createRadialGradient(w/2,h*.55,h*.3,w/2,h*.55,w*.72);vg.addColorStop(0,"rgba(0,0,0,0)");vg.addColorStop(1,"rgba(0,0,0,.6)");Q.fillStyle=vg;Q.fillRect(0,0,w,h);
 Q.globalCompositeOperation="overlay";Q.globalAlpha=.11;Q.fillStyle=pattern;Q.save();Q.translate(t === 0 ? 0 : rnd()*90,t === 0 ? 0 : rnd()*90);Q.fillRect(-90,-90,w+90,h+90);Q.restore();Q.globalAlpha=1;Q.globalCompositeOperation="source-over";
 const phase=((t%4)+4)%4;
 const blink=p>0&&p<1&&phase<.8?Math.sin(Math.PI*phase/.8):0;
 return {progress:p,blink};
}

    function destroy(){if(destroyed)return;destroyed=true;refl.width=refl.height=mistT.width=mistT.height=1;trees=null;}
    return Object.freeze({draw,destroy});
  }
  return Object.freeze({createWindow,createRest,DEFAULT_ACCENT});
});

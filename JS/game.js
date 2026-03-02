// =====================================================================
//  RED LIGHT… BROWN LIGHT  —  3D Phase with FBX Characters
//  Three.js renderer  +  2D HUD overlay
// =====================================================================
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// ======================== CONFIGURATION ==============================
const CFG = {
  // --- Field (Three.js world:  X = lateral,  Z = forward) ---
  FIELD_W: 80,
  FIELD_L: 500,
  FINISH_ZONE_START: 400,

  // --- Light timing ---
  BROWN_MIN: 2.0, BROWN_MAX: 4.5,
  RED_MIN: 1.5,   RED_MAX: 3.0,
  GRACE: 0.18,
  VEL_THRESHOLD: 3.0,

  // --- Movement ---
  MAX_SPEED: 100,
  LATERAL_SPEED: 26,
  BASE_DECEL: 80,
  ACCEL_LERP: 5,

  // --- Camera  (high & far back so Granny is always visible) ---
  CAM_HEIGHT: 220,
  CAM_BACK: 110,
  CAM_LOOK_AHEAD: 100,
  CAM_SMOOTH: 2.5,

  // --- Match ---
  TIMEOUT: 120,
  COUNTDOWN: 3,
  AI_COUNT: 20,

  // --- Model ---
  MODEL_SCALE: 0.018,
  GRANNY_SCALE: 0.022,
};

// ======================== UTILITIES ==================================
const lerp  = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand  = (lo, hi) => Math.random() * (hi - lo) + lo;
const randI = (lo, hi) => Math.floor(rand(lo, hi + 1));

// ======================== SPEED TIERS ================================
function targetSpeed(hold) {
  if (hold <= 0)    return 0;
  if (hold <= 0.3)  return lerp(0, 13, hold / 0.3);
  if (hold <= 0.8)  return lerp(13, 33, (hold - 0.3) / 0.5);
  if (hold <= 1.5)  return lerp(33, 66, (hold - 0.8) / 0.7);
  return 66 + 34 * (1 - Math.exp(-(hold - 1.5) * 1.5));
}
function speedTier(s) {
  if (s < 13) return 0; if (s < 33) return 1; if (s < 66) return 2; return 3;
}
const TIER_CLR  = ['#cccccc','#44ff44','#ffaa00','#ff2222'];
const TIER_NAME = ['CRAWL','JOG','SPRINT','DANGER!'];

// ======================== INPUT ======================================
class Input {
  constructor() {
    this.k = {};
    window.addEventListener('keydown', e => { this.k[e.code] = true; if (e.code === 'Space') e.preventDefault(); });
    window.addEventListener('keyup',   e => { this.k[e.code] = false; });
  }
  get fwd()   { return !!(this.k.KeyW || this.k.ArrowUp || this.k.Space); }
  get left()  { return !!(this.k.KeyA || this.k.ArrowLeft); }
  get right() { return !!(this.k.KeyD || this.k.ArrowRight); }
  get enter() { return !!this.k.Enter; }
  eatEnter()  { this.k.Enter = false; }
}

// ======================== AUDIO ======================================
class GameAudio {
  constructor() { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch(_) { this.ctx = null; } }
  _t(f,d,tp='square',v=0.12) {
    if (!this.ctx) return; if (this.ctx.state==='suspended') this.ctx.resume();
    const o=this.ctx.createOscillator(),g=this.ctx.createGain();
    o.type=tp; o.frequency.value=f;
    g.gain.setValueAtTime(v,this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,this.ctx.currentTime+d);
    o.connect(g); g.connect(this.ctx.destination); o.start(); o.stop(this.ctx.currentTime+d);
  }
  brown(){ this._t(110,.35,'sawtooth'); setTimeout(()=>this._t(140,.5,'sawtooth'),180); }
  red()  { this._t(440,.12); setTimeout(()=>this._t(550,.12),120); setTimeout(()=>this._t(660,.22),250); }
  blast(){ this._t(55,.9,'sawtooth',.18); this._t(75,.7,'square',.10); }
  tick() { this._t(330,.10,'sine'); }
  go()   { this._t(660,.30,'sine',.15); }
}

// ======================== LIGHT SYSTEM ===============================
class LightSystem {
  constructor() {
    this.state='brown'; this.timer=0; this.dur=0; this.graceT=0;
    this.canDetect=false; this.cycle=0;
    this.fakeUsed=false; this.fakeActive=false; this.fakeTmr=0;
    this.onSwitch=null;
    this._startBrown();
  }
  _startBrown() {
    this.state='brown';
    const sh=Math.max(0.7,1-this.cycle*0.015);
    this.dur=rand(CFG.BROWN_MIN*sh,CFG.BROWN_MAX*sh);
    this.timer=0; this.canDetect=false; this.fakeActive=false;
    if (this.onSwitch) this.onSwitch('brown');
  }
  _startRed() {
    this.state='red'; this.dur=rand(CFG.RED_MIN,CFG.RED_MAX);
    this.timer=0; this.graceT=0; this.canDetect=false; this.cycle++;
    if (this.onSwitch) this.onSwitch('red');
  }
  update(dt) {
    this.timer+=dt;
    if (this.fakeActive){ this.fakeTmr-=dt; if(this.fakeTmr<=0) this.fakeActive=false; }
    if (this.state==='red'){ this.graceT+=dt; if(this.graceT>=CFG.GRACE) this.canDetect=true; }
    if (this.timer>=this.dur) {
      if (this.state==='brown') {
        if (!this.fakeUsed && this.cycle>=2 && Math.random()<0.12) {
          this.fakeUsed=true; this.fakeActive=true; this.fakeTmr=0.4;
          this.timer=0; this.dur=rand(1.5,2.5);
          if (this.onSwitch) this.onSwitch('fake'); return;
        }
        this._startRed();
      } else this._startBrown();
    }
  }
  get isBrown(){ return this.state==='brown'; }
  get isRed()  { return this.state==='red'; }
}

// ======================== PLAYER =====================================
class Player {
  constructor() { this.x=0; this.z=0; this.speed=0; this.latSpd=0; this.accT=0; this.blasted=false; this.stunTmr=0; }
  update(dt, input, light) {
    if (this.blasted||this.stunTmr>0){ this.stunTmr-=dt; this.speed=Math.max(0,this.speed-60*dt); this.accT=0; return; }
    const ca=input.fwd&&light.isBrown;
    if (ca){ this.accT+=dt; this.speed=lerp(this.speed,targetSpeed(this.accT),dt*CFG.ACCEL_LERP); }
    else { this.accT=0; if(this.speed>0){ const f=1-(this.speed/CFG.MAX_SPEED)*0.6; this.speed=Math.max(0,this.speed-CFG.BASE_DECEL*Math.max(f,0.2)*dt); } }
    this.latSpd=0;
    if (input.left) this.latSpd=-CFG.LATERAL_SPEED;
    if (input.right) this.latSpd=CFG.LATERAL_SPEED;
    this.z+=this.speed*dt; this.x+=this.latSpd*dt;
    this.x=clamp(this.x,-CFG.FIELD_W/2+2,CFG.FIELD_W/2-2);
    this.z=clamp(this.z,0,CFG.FIELD_L);
  }
  get progress(){ return this.z/CFG.FIELD_L; }
  get tier()    { return speedTier(this.speed); }
  blast() { this.blasted=true; this.speed=0; this.accT=0; }
  reset() { this.z=0; this.x=0; this.speed=0; this.accT=0; this.blasted=false; this.stunTmr=0; }
}

// ======================== AI =========================================
class AIEntity {
  constructor(x,z,type,name){ this.x=x; this.z=z; this.type=type; this.name=name; }
  update(){}
  get progress(){ return this.z/CFG.FIELD_L; }
}

// ======================== GRANNY FARTS ===============================
class GrannyFarts {
  constructor(){
    this.x=0; this.z=CFG.FIELD_L+8;
    this.turn=0; this.facing=false;
    this.targetRotY=Math.PI; this.currentRotY=Math.PI;
    this.trackAngle=0;
  }
  update(dt, lightState, leaderPos, fakeActive){
    let tgt = lightState==='red'?1:0;
    if (fakeActive) tgt=0.45;
    this.turn=lerp(this.turn,tgt,dt*(tgt>this.turn?10:5));
    this.facing=this.turn>0.5;
    this.targetRotY=this.facing?0:Math.PI;
    if (leaderPos&&lightState==='brown'){
      const dx=leaderPos.x-this.x;
      this.trackAngle=lerp(this.trackAngle,Math.atan2(dx,30)*0.3,dt*3);
    } else this.trackAngle=lerp(this.trackAngle,0,dt*3);
    this.currentRotY=lerp(this.currentRotY,this.targetRotY+this.trackAngle,dt*8);
  }
}

// =====================================================================
//  3D SCENE
// =====================================================================
class Scene3D {
  constructor(container){
    this.container=container;

    // renderer
    this.renderer=new THREE.WebGLRenderer({antialias:true});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    this.renderer.setSize(window.innerWidth,window.innerHeight);
    this.renderer.shadowMap.enabled=true;
    this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=1.0;
    container.insertBefore(this.renderer.domElement,container.firstChild);

    // scene
    this.scene=new THREE.Scene();
    this.scene.background=new THREE.Color(0x1a0f0a);
    this.scene.fog=new THREE.Fog(0x1a0f0a,400,800);

    // camera — high vantage, sees far ahead to Granny
    this.camera=new THREE.PerspectiveCamera(55,window.innerWidth/window.innerHeight,1,1200);
    this.camera.position.set(0,CFG.CAM_HEIGHT,-CFG.CAM_BACK);
    this.camera.lookAt(0,0,CFG.CAM_LOOK_AHEAD);
    this.camTarget=new THREE.Vector3(0,0,0);

    this._setupLights();
    this._buildGround();
    this._buildMarkers();

    // character refs
    this.playerMesh=null; this.grannyMesh=null; this.aiMeshes=[];
    this.mixers=[]; this.idleClip=null; this.runClip=null;

    // blast glow
    this.blastLight=new THREE.PointLight(0x44ff44,0,80);
    this.blastLight.position.set(0,5,0);
    this.scene.add(this.blastLight);

    window.addEventListener('resize',()=>this._onResize());
  }

  _setupLights(){
    this.scene.add(new THREE.AmbientLight(0x998877,0.7));
    this.scene.add(new THREE.HemisphereLight(0xccaa88,0x553322,0.5));
    this.dirLight=new THREE.DirectionalLight(0xffe8cc,1.8);
    this.dirLight.position.set(30,80,60);
    this.dirLight.castShadow=true;
    this.dirLight.shadow.mapSize.set(2048,2048);
    this.dirLight.shadow.camera.near=1; this.dirLight.shadow.camera.far=400;
    this.dirLight.shadow.camera.left=-100; this.dirLight.shadow.camera.right=100;
    this.dirLight.shadow.camera.top=200; this.dirLight.shadow.camera.bottom=-200;
    this.dirLight.shadow.bias=-0.001;
    this.scene.add(this.dirLight); this.scene.add(this.dirLight.target);
    this.moodLight=new THREE.DirectionalLight(0xaa6633,0.3);
    this.moodLight.position.set(-20,40,-30);
    this.scene.add(this.moodLight);
  }

  _buildGround(){
    const tc=document.createElement('canvas'); tc.width=512; tc.height=512;
    const tg=tc.getContext('2d');
    tg.fillStyle='#5c3d2e'; tg.fillRect(0,0,512,512);
    for(let i=0;i<600;i++){
      const sh=rand(-22,22);
      tg.fillStyle=`rgb(${clamp(92+sh,30,150)},${clamp(61+sh*0.7,20,110)},${clamp(46+sh*0.5,10,90)})`;
      tg.beginPath(); tg.arc(rand(0,512),rand(0,512),rand(2,14),0,Math.PI*2); tg.fill();
    }
    const mudTex=new THREE.CanvasTexture(tc);
    mudTex.wrapS=mudTex.wrapT=THREE.RepeatWrapping; mudTex.repeat.set(8,50);

    this.ground=new THREE.Mesh(
      new THREE.PlaneGeometry(CFG.FIELD_W,CFG.FIELD_L+40),
      new THREE.MeshStandardMaterial({map:mudTex,roughness:0.95,metalness:0,color:0x6b4226})
    );
    this.ground.rotation.x=-Math.PI/2;
    this.ground.position.set(0,0,CFG.FIELD_L/2);
    this.ground.receiveShadow=true;
    this.scene.add(this.ground);

    const wm=new THREE.MeshStandardMaterial({color:0x2a1a0e,roughness:1});
    for(const s of[-1,1]){
      const w=new THREE.Mesh(new THREE.BoxGeometry(2,4,CFG.FIELD_L+40),wm);
      w.position.set(s*(CFG.FIELD_W/2+1),2,CFG.FIELD_L/2);
      w.receiveShadow=true; this.scene.add(w);
    }

    // finish zone tint
    const fzLen=CFG.FIELD_L-CFG.FINISH_ZONE_START;
    const fz=new THREE.Mesh(
      new THREE.PlaneGeometry(CFG.FIELD_W-.5,fzLen),
      new THREE.MeshStandardMaterial({color:0xff8800,transparent:true,opacity:0.08,roughness:1,depthWrite:false})
    );
    fz.rotation.x=-Math.PI/2; fz.position.set(0,0.05,CFG.FINISH_ZONE_START+fzLen/2);
    this.scene.add(fz);
  }

  _buildMarkers(){
    // start line
    const sl=new THREE.Mesh(new THREE.PlaneGeometry(CFG.FIELD_W,0.4),
      new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0.6}));
    sl.rotation.x=-Math.PI/2; sl.position.set(0,0.06,0); this.scene.add(sl);

    // finish checkered
    const cs=2, cols=Math.ceil(CFG.FIELD_W/cs), chk=new THREE.Group();
    for(let i=0;i<cols;i++) for(let j=0;j<2;j++){
      const t=new THREE.Mesh(new THREE.PlaneGeometry(cs,cs),
        new THREE.MeshBasicMaterial({color:(i+j)%2===0?0xffffff:0x222222}));
      t.rotation.x=-Math.PI/2;
      t.position.set(-CFG.FIELD_W/2+i*cs+cs/2,0.06,CFG.FIELD_L+j*cs);
      chk.add(t);
    }
    this.scene.add(chk);

    // 10% markers
    for(let p=10;p<100;p+=10){
      const m=new THREE.Mesh(new THREE.PlaneGeometry(CFG.FIELD_W,0.15),
        new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0.07}));
      m.rotation.x=-Math.PI/2; m.position.set(0,0.04,(p/100)*CFG.FIELD_L); this.scene.add(m);
    }

    // finish zone dashed line
    const dm=new THREE.MeshBasicMaterial({color:0xff8800,transparent:true,opacity:0.35});
    for(let x=-CFG.FIELD_W/2;x<CFG.FIELD_W/2;x+=4){
      const d=new THREE.Mesh(new THREE.PlaneGeometry(2,0.3),dm);
      d.rotation.x=-Math.PI/2; d.position.set(x+1,0.05,CFG.FINISH_ZONE_START); this.scene.add(d);
    }
  }

  // --- FBX loading ---
  async loadModels(onProgress){
    const loader=new FBXLoader();
    const base='characters/FBX%20Files/';
    const load = n => new Promise((res,rej)=> loader.load(base+encodeURIComponent(n),res,undefined,rej));

    let done=0; const total=6;
    const tick=label=>{ done++; if(onProgress) onProgress(done/total,label); };

    const playerFBX = await load('MrFarts.fbx');         tick('MrFarts loaded');
    const idleFBX   = await load('MrFarts Idle.fbx');    this.idleClip=idleFBX.animations[0]||null; tick('Idle anim loaded');
    const runFBX    = await load('MrFarts Running.fbx'); this.runClip=runFBX.animations[0]||null;    tick('Run anim loaded');
    const grannyFBX = await load('Grandma.fbx');         tick('Grandma loaded');
    const suitFBX   = await load('Spacesuit.fbx');       tick('Spacesuit loaded');
    const pirateFBX = await load('Pirate.fbx');          tick('Pirate loaded');

    // --- Player (MrFarts) ---
    this.playerMesh=this._prep(playerFBX,CFG.MODEL_SCALE,true);
    this.scene.add(this.playerMesh);
    const pm=new THREE.AnimationMixer(this.playerMesh);
    this.playerMixer=pm;
    this.playerIdleA=this.idleClip?pm.clipAction(this.idleClip):null;
    this.playerRunA =this.runClip ?pm.clipAction(this.runClip) :null;
    if(this.playerIdleA) this.playerIdleA.play();
    this.mixers.push(pm);
    this._label(this.playerMesh,'YOU','#4488ff',5);

    // --- Granny Farts ---
    this.grannyMesh=this._prep(grannyFBX,CFG.GRANNY_SCALE,true);
    this.grannyMesh.position.set(0,0,CFG.FIELD_L+8);
    this.grannyMesh.rotation.y=Math.PI;
    this.scene.add(this.grannyMesh);
    const gm=new THREE.AnimationMixer(this.grannyMesh);
    if(this.idleClip){ const a=gm.clipAction(this.idleClip); a.play(); }
    this.mixers.push(gm);
    this._label(this.grannyMesh,'GRANNY FARTS','#44ff44',6);

    // --- AI bots (Spacesuit + Pirate alternating) ---
    this.aiMeshes=[];
    for(let i=0;i<CFG.AI_COUNT;i++){
      const src=i%2===0?suitFBX:pirateFBX;
      const mesh=this._prep(src,CFG.MODEL_SCALE,false);
      this.scene.add(mesh);
      const mx=new THREE.AnimationMixer(mesh);
      if(this.idleClip){ const a=mx.clipAction(this.idleClip); a.play(); a.time=rand(0,a.getClip().duration); }
      this.mixers.push(mx);
      this.aiMeshes.push(mesh);
    }
  }

  _prep(fbx,scale,shadow){
    const g=new THREE.Group();
    fbx.scale.set(scale,scale,scale);
    fbx.traverse(c=>{
      if(c.isMesh){
        c.castShadow=shadow; c.receiveShadow=true;
        const ms=Array.isArray(c.material)?c.material:[c.material];
        ms.forEach(m=>{ m.roughness=0.7; m.metalness=0.1; if(m.map) m.map.colorSpace=THREE.SRGBColorSpace; });
      }
    });
    g.add(fbx); return g;
  }

  _label(mesh,text,color,yOff){
    const cv=document.createElement('canvas'); cv.width=256; cv.height=64;
    const c=cv.getContext('2d');
    c.clearRect(0,0,256,64);
    c.fillStyle=color; c.font='bold 36px monospace'; c.textAlign='center'; c.textBaseline='middle';
    c.shadowColor='#000'; c.shadowBlur=6;
    c.fillText(text,128,32);
    const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));
    sp.scale.set(8,2,1); sp.position.set(0,yOff,0);
    mesh.add(sp);
  }

  // --- per-frame sync ---
  sync(game,dt){
    for(const m of this.mixers) m.update(dt);

    // mood lighting
    if (game.light){
      const r=game.light.isRed;
      this.scene.background.set(r?0x140808:0x1a0f0a);
      this.scene.fog.color.set(r?0x140808:0x1a0f0a);
      this.dirLight.color.set(r?0xff8888:0xffe8cc);
      this.dirLight.intensity=r?1.2:1.8;
      this.moodLight.color.set(r?0xff2222:0xaa6633);
      this.moodLight.intensity=r?0.6:0.3;
      this.ground.material.color.set(r?0x4a2a1c:0x6b4226);
    }

    // player mesh
    if (game.player&&this.playerMesh){
      this.playerMesh.visible=!game.player.blasted;
      if(!game.player.blasted){
        this.playerMesh.position.set(game.player.x,0,game.player.z);
        this.playerMesh.rotation.y=0;
        // animation blend
        if(this.playerIdleA&&this.playerRunA){
          const w=clamp(game.player.speed/20,0,1);
          this.playerRunA.enabled=true; this.playerIdleA.enabled=true;
          if(w>0.01&&!this.playerRunA.isRunning()) this.playerRunA.play();
          this.playerRunA.setEffectiveWeight(w);
          this.playerIdleA.setEffectiveWeight(1-w);
          this.playerRunA.setEffectiveTimeScale(0.8+game.player.speed/CFG.MAX_SPEED*1.5);
        }
      }
    }

    // granny mesh
    if (game.grannyFarts&&this.grannyMesh){
      this.grannyMesh.position.set(game.grannyFarts.x,0,game.grannyFarts.z);
      this.grannyMesh.rotation.y=game.grannyFarts.currentRotY;
    }

    // AI meshes
    if (game.ai) for(let i=0;i<game.ai.length&&i<this.aiMeshes.length;i++){
      this.aiMeshes[i].position.set(game.ai[i].x,0,game.ai[i].z);
    }

    // blast glow
    if (game.blastFx){
      this.blastLight.intensity=clamp(game.blastFx.tmr/game.blastFx.max*30,0,30);
      this.blastLight.position.set(game.blastFx.x,5,game.blastFx.z);
    } else this.blastLight.intensity=0;

    // --- camera follow (high & far — Granny always visible) ---
    if (game.player){
      const pz=game.player.z;
      this.camTarget.set(
        lerp(this.camTarget.x,game.player.x*0.3,dt*2),
        0,
        lerp(this.camTarget.z,pz+70,dt*CFG.CAM_SMOOTH)
      );
      const prog=game.player.progress;
      const camH=lerp(CFG.CAM_HEIGHT,CFG.CAM_HEIGHT*0.75,clamp(prog-0.7,0,0.3)/0.3);

      this.camera.position.set(this.camTarget.x, camH, this.camTarget.z-CFG.CAM_BACK);
      this.camera.lookAt(this.camTarget.x, 0, this.camTarget.z+CFG.CAM_LOOK_AHEAD);

      this.dirLight.position.set(this.camTarget.x+30,80,this.camTarget.z+60);
      this.dirLight.target.position.set(this.camTarget.x,0,this.camTarget.z);
    }

    // shake
    if(game.shakeAmt>0){
      this.camera.position.x+=(Math.random()-.5)*game.shakeAmt*.15;
      this.camera.position.y+=(Math.random()-.5)*game.shakeAmt*.08;
    }
  }

  render(){ this.renderer.render(this.scene,this.camera); }

  _onResize(){
    this.camera.aspect=window.innerWidth/window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth,window.innerHeight);
  }
}

// =====================================================================
//  GAME  — master controller
// =====================================================================
class Game {
  constructor(){
    this.container=document.getElementById('game-container');
    this.hudCanvas=document.getElementById('hudCanvas');
    this.ctx=this.hudCanvas.getContext('2d');
    this.input=new Input(); this.audio=new GameAudio(); this.scene3d=null;

    this.state='loading'; this.matchTmr=0; this.cdTmr=0; this.cdNum=3; this.goReason='';
    this.msg=''; this.msgTmr=0; this.flashClr=''; this.flashTmr=0;
    this.dangerPulse=0; this.shakeAmt=0; this.blastFx=null;
    this.light=null; this.player=null; this.grannyFarts=null; this.ai=[];

    this._resizeHud();
    window.addEventListener('resize',()=>this._resizeHud());
  }
  _resizeHud(){ this.hudCanvas.width=window.innerWidth; this.hudCanvas.height=window.innerHeight; this.W=this.hudCanvas.width; this.H=this.hudCanvas.height; }

  async init(){
    const bar=document.getElementById('load-bar'), txt=document.getElementById('load-text');
    this.scene3d=new Scene3D(this.container);
    try {
      await this.scene3d.loadModels((p,l)=>{ if(bar) bar.style.width=(p*100)+'%'; if(txt) txt.textContent=l; });
    } catch(e){ console.error('Load error:',e); if(txt) txt.textContent='Error! Check console.'; return; }
    const ls=document.getElementById('loading-screen'); if(ls) ls.style.display='none';
    this.state='menu';
  }

  _makeAI(){
    const types=[];
    for(let i=0;i<7;i++) types.push('demon');
    for(let i=0;i<9;i++) types.push('steady');
    for(let i=0;i<4;i++) types.push('bully');
    for(let i=types.length-1;i>0;i--){ const j=randI(0,i);[types[i],types[j]]=[types[j],types[i]]; }
    return types.map((t,i)=>{
      const cols=10, gap=(CFG.FIELD_W-10)/(cols-1);
      return new AIEntity(-CFG.FIELD_W/2+5+(i%cols)*gap, -2-Math.floor(i/cols)*5, t, `Bot-${i+1}`);
    });
  }

  startMatch(){
    this.state='countdown'; this.cdTmr=0; this.cdNum=3; this.matchTmr=0; this.goReason='';
    this.shakeAmt=0; this.blastFx=null;
    this.player=new Player(); this.grannyFarts=new GrannyFarts(); this.ai=this._makeAI();
    this.light=new LightSystem(); this.light.onSwitch=s=>this._onLight(s);
    this.audio.tick();
  }
  gameOver(r){ this.state='gameover'; this.goReason=r; this._showMsg(r,99); r.includes('WIN')?this.audio.go():this.audio.blast(); }

  _onLight(s){
    if(s==='brown'){ this._showMsg('BROWN LIGHT',1); this._flash('#8B4513',.3); this.audio.brown(); }
    else if(s==='red'){ this._showMsg('RED LIGHT!',1); this._flash('#ff0000',.35); this.audio.red(); }
    else if(s==='fake'){ this._flash('#ffaa00',.2); }
  }
  _showMsg(t,d){ this.msg=t; this.msgTmr=d; }
  _flash(c,d){ this.flashClr=c; this.flashTmr=d; }

  _blastPlayer(){
    this.player.blast(); this.audio.blast();
    this._flash('#33ff33',.5); this._showMsg('BLASTED!',1.5);
    this.shakeAmt=18;
    this.blastFx={x:this.player.x,z:this.player.z,tmr:2,max:2};
  }

  // ======================== UPDATE =======================================
  update(dt){
    if(this.msgTmr>0) this.msgTmr-=dt;
    if(this.flashTmr>0) this.flashTmr-=dt;
    if(this.shakeAmt>0){ this.shakeAmt*=0.88; if(this.shakeAmt<0.4) this.shakeAmt=0; }

    switch(this.state){
      case 'menu':
        if(this.input.enter){ this.input.eatEnter(); this.startMatch(); }
        break;
      case 'countdown':{
        this.cdTmr+=dt;
        const n=3-Math.floor(this.cdTmr);
        if(n!==this.cdNum&&n>=1){ this.cdNum=n; this.audio.tick(); }
        if(this.cdTmr>=CFG.COUNTDOWN){ this.state='playing'; this.audio.go(); this.light._startBrown(); }
        break;
      }
      case 'playing':{
        this.matchTmr+=dt;
        if(this.matchTmr>=CFG.TIMEOUT){ this.gameOver('TIMEOUT — MEGA BLAST!'); return; }
        this.light.update(dt);
        this.player.update(dt,this.input,this.light);
        if(this.light.isRed&&this.light.canDetect&&!this.player.blasted){
          if(this.player.speed>CFG.VEL_THRESHOLD) this._blastPlayer();
        }
        if(this.player.z>=CFG.FIELD_L){ this.gameOver('YOU WIN!'); return; }
        this.player.tier>=3?(this.dangerPulse+=dt*8):(this.dangerPulse*=0.9);
        this.grannyFarts.update(dt,this.light.state,{x:this.player.x,z:this.player.z},this.light.fakeActive);
        this.ai.forEach(a=>a.update(dt));
        if(this.blastFx){ this.blastFx.tmr-=dt; if(this.blastFx.tmr<=0){ this.player.reset(); this.blastFx=null; } }
        break;
      }
      case 'gameover':
        if(this.input.enter){ this.input.eatEnter(); this.state='menu'; }
        break;
    }
  }

  // ======================== RENDER =======================================
  render(dt){
    const ctx=this.ctx,W=this.W,H=this.H;
    ctx.clearRect(0,0,W,H);

    if(this.scene3d&&this.state!=='loading'){ this.scene3d.sync(this,dt); this.scene3d.render(); }

    switch(this.state){
      case 'menu': this._rMenu(ctx,W,H); break;
      case 'countdown': this._rHUD(ctx,W,H); this._rCD(ctx,W,H); break;
      case 'playing': this._rHUD(ctx,W,H); break;
      case 'gameover': this._rHUD(ctx,W,H); this._rGO(ctx,W,H); break;
    }

    // flash
    if(this.flashTmr>0){ ctx.globalAlpha=this.flashTmr*.25; ctx.fillStyle=this.flashClr; ctx.fillRect(0,0,W,H); ctx.globalAlpha=1; }

    // danger vignette
    if(this.player&&this.player.tier>=2&&this.state==='playing'){
      const i=this.player.tier>=3?0.16+Math.sin(this.dangerPulse)*0.08:0.05;
      const g=ctx.createRadialGradient(W/2,H/2,Math.min(W,H)*.28,W/2,H/2,Math.min(W,H)*.72);
      g.addColorStop(0,'transparent'); g.addColorStop(1,`rgba(255,0,0,${i.toFixed(3)})`);
      ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    }

    // centre message
    if(this.msgTmr>0&&(this.state==='playing'||this.state==='countdown')){
      ctx.globalAlpha=Math.min(1,this.msgTmr*2); ctx.textAlign='center';
      ctx.font=`bold ${Math.min(48,W*.05)}px "Courier New",monospace`;
      const c=this.msg.includes('RED')?'#ff3333':this.msg.includes('BROWN')?'#cc8844':this.msg.includes('BLAST')?'#44ff44':'#fff';
      ctx.shadowColor='#000'; ctx.shadowBlur=12; ctx.fillStyle=c;
      ctx.fillText(this.msg,W/2,H/2-H*.1); ctx.shadowBlur=0; ctx.globalAlpha=1;
    }
  }

  _rMenu(ctx,W,H){
    ctx.fillStyle='rgba(0,0,0,0.82)'; ctx.fillRect(0,0,W,H); ctx.textAlign='center';
    ctx.shadowColor='#ff3333'; ctx.shadowBlur=20; ctx.fillStyle='#ff4444';
    ctx.font=`bold ${Math.min(64,W*.06)}px "Courier New",monospace`;
    ctx.fillText('RED LIGHT…',W/2,H/2-80);
    ctx.shadowColor='#8B4513'; ctx.fillStyle='#AA6633';
    ctx.fillText('BROWN LIGHT',W/2,H/2-20); ctx.shadowBlur=0;
    ctx.fillStyle='#44cc44'; ctx.font=`${Math.min(20,W*.02)}px monospace`;
    ctx.fillText('A Top-Down Mud Chaos Runner',W/2,H/2+30);
    ctx.fillStyle='#aaa'; ctx.font=`${Math.min(22,W*.022)}px monospace`;
    ctx.fillText('[ Press ENTER to start ]',W/2,H/2+80);
    ctx.fillStyle='#666'; ctx.font=`${Math.min(15,W*.015)}px monospace`;
    ctx.fillText('W / ↑ / SPACE = Run Forward       A D / ← → = Dodge',W/2,H/2+130);
    ctx.fillText('HOLD longer → faster → harder to stop!',W/2,H/2+155);
  }

  _rCD(ctx,W,H){
    ctx.fillStyle='rgba(0,0,0,0.65)'; ctx.fillRect(0,0,W,H); ctx.textAlign='center';
    ctx.fillStyle='#fff'; ctx.font=`bold ${Math.min(150,W*.15)}px "Courier New",monospace`;
    ctx.fillText(String(Math.max(1,Math.ceil(CFG.COUNTDOWN-this.cdTmr))),W/2,H/2+50);
    ctx.font=`${Math.min(24,W*.025)}px monospace`; ctx.fillStyle='#888';
    ctx.fillText('GET READY…',W/2,H/2+100);
  }

  _rHUD(ctx,W,H){
    if(!this.light||!this.player) return;
    const isR=this.light.isRed;
    // light status
    ctx.fillStyle='rgba(0,0,0,0.75)'; this._rr(ctx,W/2-95,6,190,36,6); ctx.fill();
    ctx.fillStyle=isR?'#ff2222':'#AA6633'; ctx.font='bold 18px monospace'; ctx.textAlign='center';
    ctx.fillText(isR?'● RED LIGHT':'● BROWN LIGHT',W/2,30);
    // timer
    const m=Math.floor(this.matchTmr/60),s=Math.floor(this.matchTmr%60);
    ctx.fillStyle='rgba(0,0,0,0.75)'; this._rr(ctx,W-110,6,100,36,6); ctx.fill();
    ctx.fillStyle=this.matchTmr>100?'#ff4444':'#ddd'; ctx.font='16px monospace'; ctx.textAlign='right';
    ctx.fillText(`${m}:${String(s).padStart(2,'0')}`,W-18,30);
    // speed bar
    const bx=16,by=H/2-120,bw=22,bh=240;
    const ratio=clamp(this.player.speed/CFG.MAX_SPEED,0,1),tier=this.player.tier;
    ctx.fillStyle='rgba(0,0,0,0.7)'; this._rr(ctx,bx-4,by-22,bw+8,bh+30,6); ctx.fill();
    ctx.fillStyle='#2a2a2a'; ctx.fillRect(bx,by,bw,bh);
    ctx.fillStyle=TIER_CLR[tier]; ctx.fillRect(bx,by+bh-ratio*bh,bw,ratio*bh);
    [13,33,66].forEach(t=>{ const ty=by+bh-(t/CFG.MAX_SPEED)*bh; ctx.strokeStyle='#555'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(bx,ty); ctx.lineTo(bx+bw,ty); ctx.stroke(); });
    ctx.fillStyle=TIER_CLR[tier]; ctx.font='bold 10px monospace'; ctx.textAlign='center';
    ctx.fillText(TIER_NAME[tier],bx+bw/2,by-6);
    // progress bar
    const px=W-38,py=by,ph=bh,prog=clamp(this.player.progress,0,1);
    ctx.fillStyle='rgba(0,0,0,0.7)'; this._rr(ctx,px-4,py-22,26,ph+30,6); ctx.fill();
    ctx.fillStyle='#2a2a2a'; ctx.fillRect(px,py,18,ph);
    ctx.fillStyle='#ffcc00'; ctx.fillRect(px,py+ph-prog*ph,18,prog*ph);
    const zy=py+ph-(CFG.FINISH_ZONE_START/CFG.FIELD_L)*ph;
    ctx.strokeStyle='#ff8800'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(px,zy); ctx.lineTo(px+18,zy); ctx.stroke();
    ctx.fillStyle='#4488ff'; ctx.beginPath();
    const ary=py+ph-prog*ph; ctx.moveTo(px-6,ary); ctx.lineTo(px,ary-5); ctx.lineTo(px,ary+5); ctx.closePath(); ctx.fill();
    ctx.fillStyle='#888'; ctx.font='9px monospace'; ctx.textAlign='center'; ctx.fillText('DIST',px+9,py-6);
  }

  _rGO(ctx,W,H){
    ctx.fillStyle='rgba(0,0,0,0.78)'; ctx.fillRect(0,0,W,H); ctx.textAlign='center';
    const w=this.goReason.includes('WIN');
    ctx.shadowColor=w?'#ffcc00':'#ff0000'; ctx.shadowBlur=25;
    ctx.fillStyle=w?'#ffcc00':'#ff4444'; ctx.font=`bold ${Math.min(60,W*.06)}px "Courier New",monospace`;
    ctx.fillText(this.goReason,W/2,H/2-20); ctx.shadowBlur=0;
    ctx.fillStyle='#aaa'; ctx.font='20px monospace'; ctx.fillText('[ Press ENTER ]',W/2,H/2+40);
    const m=Math.floor(this.matchTmr/60),s=Math.floor(this.matchTmr%60);
    ctx.fillStyle='#888'; ctx.font='16px monospace'; ctx.fillText(`Time: ${m}:${String(s).padStart(2,'0')}`,W/2,H/2+70);
  }

  _rr(ctx,x,y,w,h,r){
    ctx.beginPath(); ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y);
    ctx.quadraticCurveTo(x+w,y,x+w,y+r); ctx.lineTo(x+w,y+h-r);
    ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h); ctx.lineTo(x+r,y+h);
    ctx.quadraticCurveTo(x,y+h,x,y+h-r); ctx.lineTo(x,y+r);
    ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
  }
}

// =====================================================================
//  BOOTSTRAP
// =====================================================================
window.addEventListener('load',async()=>{
  const game=new Game();
  await game.init();
  let last=0;
  function loop(ts){ const dt=Math.min((ts-last)/1000,0.05); last=ts; game.update(dt); game.render(dt); requestAnimationFrame(loop); }
  requestAnimationFrame(loop);
});

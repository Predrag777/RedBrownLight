// =====================================================================
//  RED LIGHT… BROWN LIGHT  —  3D Phase with FBX Characters
//  Three.js renderer  +  2D HUD overlay
// =====================================================================
import * as THREE from 'https://esm.sh/three@0.162.0';
import { FBXLoader } from 'https://esm.sh/three@0.162.0/examples/jsm/loaders/FBXLoader.js';
import { PirateBrain } from './characterBrain/pirate.js';
import { Player } from './characterBrain/myPlayer.js';
import { SpacesuitBrain } from './characterBrain/spacesuit.js';
import { ZombieBrain } from './characterBrain/zombie.js';
import { MariachiBrain } from './characterBrain/mariachi.js';

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
  TURN_DURATION: 0.7,  // how long Granny takes to turn around

  // --- Movement ---
  MAX_SPEED: 100,
  LATERAL_SPEED: 26,
  BASE_DECEL: 80,
  ACCEL_LERP: 5,

  // --- Camera (third-person behind player) ---
  CAM_HEIGHT: 35,
  CAM_BACK: 50,
  CAM_LOOK_AHEAD: 40,
  CAM_SMOOTH: 4.0,

  // --- Match ---
  TIMEOUT: 120,
  COUNTDOWN: 3,
  AI_COUNT: 20,

  // --- Model ---
  MODEL_SCALE: 0.018,
  GRANNY_SCALE: 0.11,

  // --- Collision ---
  COLLISION_RADIUS: 3.0,
  PUSH_RECOVERY: 4.0,     // how fast pushed entities lose push velocity
  PLAYER_PUSH_RESIST: 0.6, // player receives 60% push force
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
    this.touchFwd = false;
    this.touchLeft = false;
    this.touchRight = false;
    this.touchEnter = false;
    window.addEventListener('keydown', e => { this.k[e.code] = true; if (e.code === 'Space') e.preventDefault(); });
    window.addEventListener('keyup',   e => { this.k[e.code] = false; });
    this._initTouch();
  }
  _initTouch() {
    const fwd = document.getElementById('touch-fwd');
    const left = document.getElementById('touch-left');
    const right = document.getElementById('touch-right');
    if (!fwd) return;
    const on = (el, flag) => {
      el.addEventListener('touchstart', e => { e.preventDefault(); this[flag] = true; }, { passive: false });
      el.addEventListener('touchend',   e => { e.preventDefault(); this[flag] = false; }, { passive: false });
      el.addEventListener('touchcancel',e => { this[flag] = false; });
    };
    on(fwd, 'touchFwd');
    on(left, 'touchLeft');
    on(right, 'touchRight');
    // Tap anywhere during menu/gameover = enter
    document.addEventListener('touchstart', e => {
      this.touchEnter = true;
      setTimeout(() => { this.touchEnter = false; }, 100);
    }, { passive: true });
  }
  get fwd()   { return !!(this.k.KeyW || this.k.ArrowUp || this.k.Space || this.touchFwd); }
  get left()  { return !!(this.k.KeyA || this.k.ArrowLeft || this.touchLeft); }
  get right() { return !!(this.k.KeyD || this.k.ArrowRight || this.touchRight); }
  get enter() { return !!(this.k.Enter || this.touchEnter); }
  eatEnter()  { this.k.Enter = false; this.touchEnter = false; }
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
    this.state='brown';     // 'brown' | 'turning' | 'red'
    this.timer=0; this.dur=0; this.graceT=0;
    this.canDetect=false; this.cycle=0;
    this.fakeUsed=false; this.fakeActive=false; this.fakeTmr=0;
    this.onSwitch=null;
    this.turnTimer=0;       // time spent in 'turning' state
    this._startBrown();
  }
  _startBrown() {
    this.state='brown';
    const sh=Math.max(0.7,1-this.cycle*0.015);
    this.dur=rand(CFG.BROWN_MIN*sh,CFG.BROWN_MAX*sh);
    this.timer=0; this.canDetect=false; this.fakeActive=false;
    if (this.onSwitch) this.onSwitch('brown');
  }
  _startTurning() {
    this.state='turning';
    this.turnTimer=0;
    if (this.onSwitch) this.onSwitch('turning');
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
    if (this.state==='turning'){
      this.turnTimer+=dt;
      if(this.turnTimer>=CFG.TURN_DURATION) this._startRed();
      return;
    }
    if (this.timer>=this.dur) {
      if (this.state==='brown') {
        if (!this.fakeUsed && this.cycle>=2 && Math.random()<0.12) {
          this.fakeUsed=true; this.fakeActive=true; this.fakeTmr=0.4;
          this.timer=0; this.dur=rand(1.5,2.5);
          if (this.onSwitch) this.onSwitch('fake'); return;
        }
        this._startTurning();
      } else this._startBrown();
    }
  }
  get isBrown(){ return this.state==='brown'; }
  get isRed()  { return this.state==='red'; }
  get isTurning(){ return this.state==='turning'; }
}

// ======================== AI =========================================
class AIEntity {
  constructor(x, z, type, name) {
    this.startX = x;        // remember spawn X for respawn
    this.x = x; this.z = z; this.type = type; this.name = name;
    this.speed = 0;
    this.vx = 0;            // push velocity X
    this.vz = 0;            // push velocity Z
    this.blasted = false;
    this.respawnTmr = 0;    // countdown to respawn after blast
    this.stunTmr = 0;
    this.brain = null;      // will be set for pirates
    this.holdTmr = 0;
    this.brakeTmr = 0;
  }

  update(dt, light, player, allAI, myIdx) {
    // --- Respawn countdown (same as player: 2s then reset) ---
    if (this.blasted) {
      this.respawnTmr -= dt;
      if (this.respawnTmr <= 0) {
        this.blasted = false;
        this.speed = 0;
        this.vx = 0;
        this.vz = 0;
        this.stunTmr = 0;
        // Reset to start of field at original X lane
        this.z = 0;
        this.x = this.startX;
        if (this.brain) this.brain.accT = 0;
      }
      return;
    }

    // --- Brain-controlled AI (pirate etc.) handles EVERYTHING ---
    if (this.brain) {
      this.brain.update(dt, light, player, allAI, myIdx, CFG, targetSpeed, clamp, lerp);
      return;
    }

    // --- No brain script — just apply push decay (can be bumped around) ---
    if (Math.abs(this.vx) > 0.1 || Math.abs(this.vz) > 0.1) {
      this.x += this.vx * dt;
      this.z += this.vz * dt;
      this.vx *= (1 - CFG.PUSH_RECOVERY * dt);
      this.vz *= (1 - CFG.PUSH_RECOVERY * dt);
    }
    // No active movement — waiting for brain script
    this.x = clamp(this.x, -CFG.FIELD_W / 2 + 2, CFG.FIELD_W / 2 - 2);
    this.z = clamp(this.z, 0, CFG.FIELD_L);
  }

  applyPush(px, pz) {
    this.vx += px;
    this.vz += pz;
    this.stunTmr = Math.max(this.stunTmr, 0.2);
  }

  get progress() { return this.z / CFG.FIELD_L; }
}

// ======================== GRANNY FARTS ===============================
class GrannyFarts {
  constructor(){
    this.x=0; this.z=CFG.FIELD_L+30;
    this.turn=1;          // 0 = away, 1 = facing players
    this.facing=true;
    this.currentRotY=0;   // start facing players (brown = facing)
    this.trackAngle=0;
  }
  update(dt, lightState, leaderPos, fakeActive, turnProgress){
    // turnProgress: 0→1 during 'turning' state (Granny rotating AWAY)
    if (lightState==='turning'){
      // Smoothly rotate from 0 (facing) toward Math.PI (away)
      this.turn=clamp(1-turnProgress,0,1);
    } else if (lightState==='red'){
      this.turn=0; // fully away (back to players)
    } else {
      // brown: face players
      this.turn=lerp(this.turn,1,dt*5);
    }
    if (fakeActive) this.turn=clamp(this.turn-0.3,0.5,1); // small twitch

    this.facing=this.turn>0.5;
    const targetRotY=Math.PI*(1-this.turn); // 0=facing, PI=away

    // subtle leader tracking during brown (when facing players)
    if (leaderPos&&lightState==='brown'){
      const dx=leaderPos.x-this.x;
      this.trackAngle=lerp(this.trackAngle,Math.atan2(dx,30)*0.3,dt*3);
    } else this.trackAngle=lerp(this.trackAngle,0,dt*3);

    this.currentRotY=lerp(this.currentRotY,targetRotY+this.trackAngle,dt*8);
  }
}

// ======================== BLAST PARTICLES (Explosion + Smoke) ========
class BlastParticles {
  constructor(scene){
    this.scene=scene;
    this.particles=[];   // {mesh, vx, vy, vz, life, maxLife, type}
    this.active=false;

    // shared geometries
    this.fireGeo=new THREE.SphereGeometry(0.5,6,6);
    this.smokeGeo=new THREE.SphereGeometry(1.2,6,6);
    this.debrisGeo=new THREE.BoxGeometry(0.3,0.3,0.3);
  }

  spawn(x, z){
    this.clear();
    this.active=true;
    const y0=2;

    // --- Fire / explosion particles (fast, bright) ---
    for(let i=0;i<35;i++){
      const hue=Math.random()*0.12; // red-orange-yellow
      const color=new THREE.Color().setHSL(hue, 1, 0.5+Math.random()*0.4);
      const mat=new THREE.MeshBasicMaterial({color, transparent:true, opacity:1, depthWrite:false});
      const mesh=new THREE.Mesh(this.fireGeo, mat);
      const s=0.3+Math.random()*1.2;
      mesh.scale.set(s,s,s);
      mesh.position.set(x, y0, z);
      this.scene.add(mesh);
      const angle=Math.random()*Math.PI*2;
      const speed=8+Math.random()*18;
      const vy=6+Math.random()*14;
      this.particles.push({
        mesh, vx:Math.cos(angle)*speed, vy, vz:Math.sin(angle)*speed,
        life:0, maxLife:0.5+Math.random()*0.8, type:'fire'
      });
    }

    // --- Smoke particles (slow, dark, longer-lasting) ---
    for(let i=0;i<25;i++){
      const grey=0.15+Math.random()*0.25;
      const mat=new THREE.MeshBasicMaterial({color:new THREE.Color(grey,grey,grey), transparent:true, opacity:0.7, depthWrite:false});
      const mesh=new THREE.Mesh(this.smokeGeo, mat);
      const s=0.5+Math.random()*1.5;
      mesh.scale.set(s,s,s);
      mesh.position.set(x+(Math.random()-0.5)*3, y0+Math.random()*2, z+(Math.random()-0.5)*3);
      this.scene.add(mesh);
      const angle=Math.random()*Math.PI*2;
      const speed=1+Math.random()*4;
      this.particles.push({
        mesh, vx:Math.cos(angle)*speed, vy:2+Math.random()*5, vz:Math.sin(angle)*speed,
        life:0, maxLife:1.5+Math.random()*1.5, type:'smoke'
      });
    }

    // --- Debris chunks ---
    for(let i=0;i<15;i++){
      const mat=new THREE.MeshStandardMaterial({color:Math.random()>0.5?0x8B4513:0x555555, roughness:0.9});
      const mesh=new THREE.Mesh(this.debrisGeo, mat);
      const s=0.4+Math.random()*0.8;
      mesh.scale.set(s, s, s);
      mesh.position.set(x, y0, z);
      this.scene.add(mesh);
      const angle=Math.random()*Math.PI*2;
      const speed=5+Math.random()*12;
      this.particles.push({
        mesh, vx:Math.cos(angle)*speed, vy:8+Math.random()*12, vz:Math.sin(angle)*speed,
        life:0, maxLife:1.2+Math.random()*0.8, type:'debris',
        rotSpeed:{x:Math.random()*10-5, y:Math.random()*10-5, z:Math.random()*10-5}
      });
    }
  }

  update(dt){
    if(!this.active) return;
    let allDead=true;
    for(const p of this.particles){
      p.life+=dt;
      if(p.life>=p.maxLife){
        p.mesh.visible=false;
        continue;
      }
      allDead=false;
      const t=p.life/p.maxLife; // 0→1 normalized

      // gravity
      p.vy-=18*dt;

      // move
      p.mesh.position.x+=p.vx*dt;
      p.mesh.position.y+=p.vy*dt;
      p.mesh.position.z+=p.vz*dt;

      // floor clamp for debris
      if(p.type==='debris' && p.mesh.position.y<0.15){
        p.mesh.position.y=0.15;
        p.vy=Math.abs(p.vy)*0.3; // small bounce
        p.vx*=0.7; p.vz*=0.7;
      }

      if(p.type==='fire'){
        p.mesh.material.opacity=1-t*t;
        const s=(0.3+t*2)*(p.mesh.scale.x>1?1.2:1);
        p.mesh.scale.set(s,s,s);
        // shift to darker as it fades
        const hue=0.08*(1-t);
        p.mesh.material.color.setHSL(hue,1,0.5*(1-t*0.5));
        p.vx*=(1-dt*2); p.vz*=(1-dt*2); // air drag
      }
      else if(p.type==='smoke'){
        p.mesh.material.opacity=0.6*(1-t);
        const grow=1+t*3;
        p.mesh.scale.set(grow,grow,grow);
        p.vy+=4*dt; // smoke rises
        p.vx*=(1-dt*1.5); p.vz*=(1-dt*1.5);
      }
      else if(p.type==='debris'){
        p.mesh.material.opacity=1-t*t;
        p.mesh.rotation.x+=p.rotSpeed.x*dt;
        p.mesh.rotation.y+=p.rotSpeed.y*dt;
        p.mesh.rotation.z+=p.rotSpeed.z*dt;
      }
    }
    if(allDead) this.clear();
  }

  clear(){
    for(const p of this.particles){
      this.scene.remove(p.mesh);
      p.mesh.geometry!==this.fireGeo && p.mesh.geometry!==this.smokeGeo && p.mesh.geometry!==this.debrisGeo && p.mesh.geometry.dispose();
      p.mesh.material.dispose();
    }
    this.particles=[];
    this.active=false;
  }
}

// =====================================================================
//  3D SCENE
// =====================================================================
class Scene3D {
  constructor(container){
    this.container=container;

    // renderer — optimized for Android WebView WebGL compatibility
    try {
      this.renderer=new THREE.WebGLRenderer({antialias:false, alpha:false, powerPreference:'default', failIfMajorPerformanceCaveat:false});
    } catch(e) {
      console.error('WebGL init failed:', e);
      const msg = document.getElementById('load-text');
      if(msg) msg.textContent = 'WebGL not supported on this device';
      return;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    this.renderer.setSize(window.innerWidth,window.innerHeight);
    this.renderer.shadowMap.enabled=false;
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=1.6;
    container.insertBefore(this.renderer.domElement,container.firstChild);

    // scene — bright sky (solid background, not transparent)
    this.scene=new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog=new THREE.Fog(0x87ceeb,300,700);

    // camera — third-person behind player
    this.camera=new THREE.PerspectiveCamera(60,window.innerWidth/window.innerHeight,0.5,900);
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

    // Light-state orb (near Granny)
    this.orbGroup = new THREE.Group();
    const orbGeo = new THREE.SphereGeometry(1.2, 24, 24);
    this.orbMat = new THREE.MeshStandardMaterial({
      color: 0x8B4513, emissive: 0x8B4513, emissiveIntensity: 1.5,
      transparent: true, opacity: 0.85, roughness: 0.2, metalness: 0.3
    });
    this.orbMesh = new THREE.Mesh(orbGeo, this.orbMat);
    this.orbGroup.add(this.orbMesh);
    this.orbLight = new THREE.PointLight(0x8B4513, 3, 40);
    this.orbGroup.add(this.orbLight);
    this.orbGroup.position.set(0, 8, CFG.FIELD_L + 30);
    this.scene.add(this.orbGroup);
    this.orbTime = 0;

    // explosion + smoke particles
    this.blastParticles=new BlastParticles(this.scene);

    window.addEventListener('resize',()=>this._onResize());
  }

  _setupLights(){
    this.scene.add(new THREE.AmbientLight(0xffffff,1.2));
    this.scene.add(new THREE.HemisphereLight(0xffffff,0x88aacc,0.9));
    this.dirLight=new THREE.DirectionalLight(0xffffff,2.2);
    this.dirLight.position.set(30,80,60);
    this.dirLight.castShadow=false;
    this.scene.add(this.dirLight); this.scene.add(this.dirLight.target);
    this.moodLight=new THREE.DirectionalLight(0xffffff,0.5);
    this.moodLight.position.set(-20,40,-30);
    this.scene.add(this.moodLight);
  }

  _buildGround(){
    // --- Green grass surround ---
    const grassGeo=new THREE.PlaneGeometry(CFG.FIELD_W*4, CFG.FIELD_L+200);
    const grassMat=new THREE.MeshStandardMaterial({color:0x79b901,roughness:0.9,metalness:0});
    const grass=new THREE.Mesh(grassGeo,grassMat);
    grass.rotation.x=-Math.PI/2; grass.position.set(0,-0.05,CFG.FIELD_L/2);
    this.scene.add(grass);

    // --- White track ---
    this.ground=new THREE.Mesh(
      new THREE.PlaneGeometry(CFG.FIELD_W,CFG.FIELD_L+40),
      new THREE.MeshStandardMaterial({color:0xf5f5f5,roughness:0.55,metalness:0})
    );
    this.ground.rotation.x=-Math.PI/2;
    this.ground.position.set(0,0,CFG.FIELD_L/2);
    this.scene.add(this.ground);

    // --- Lane lines (subtle grey stripes) ---
    const laneMat=new THREE.MeshBasicMaterial({color:0xcccccc,transparent:true,opacity:0.5});
    for(let i=-3;i<=3;i++){
      if(i===0) continue;
      const lane=new THREE.Mesh(new THREE.PlaneGeometry(0.15,CFG.FIELD_L+40),laneMat);
      lane.rotation.x=-Math.PI/2; lane.position.set(i*(CFG.FIELD_W/8),0.02,CFG.FIELD_L/2);
      this.scene.add(lane);
    }

    // --- Track borders (thick coloured lines) ---
    const borderMat=new THREE.MeshStandardMaterial({color:0x333333,roughness:0.8});
    for(const s of[-1,1]){
      const w=new THREE.Mesh(new THREE.BoxGeometry(1,0.5,CFG.FIELD_L+40),borderMat);
      w.position.set(s*(CFG.FIELD_W/2+0.5),0.25,CFG.FIELD_L/2);
      this.scene.add(w);
    }

    // finish zone tint
    const fzLen=CFG.FIELD_L-CFG.FINISH_ZONE_START;
    const fz=new THREE.Mesh(
      new THREE.PlaneGeometry(CFG.FIELD_W-.5,fzLen),
      new THREE.MeshStandardMaterial({color:0xff8800,transparent:true,opacity:0.10,roughness:1,depthWrite:false})
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

  _scatterTrees(srcFBX){
    const treeScale = 0.04;
    const count = 60; // total trees (30 per side)
    const trackEdge = CFG.FIELD_W / 2 + 8; // 48 — safe distance from track
    const maxX = CFG.FIELD_W * 2 - 10; // 150 — don't go too far from track
    const minZ = -30;
    const maxZ = CFG.FIELD_L + 80;

    // Prepare source
    srcFBX.scale.setScalar(treeScale);
    // Collect all meshes for analysis
    const meshes = [];
    srcFBX.traverse(c => {
      if (c.isMesh) meshes.push(c);
    });

    // Debug: log what the FBX contains
    console.log('Tree FBX meshes:', meshes.map(m => ({
      name: m.name,
      matName: Array.isArray(m.material) ? m.material.map(mt=>mt.name) : m.material.name
    })));

    // Sort meshes by geometry center Y (lowest first)
    meshes.forEach(m => {
      if (m.geometry) m.geometry.computeBoundingBox();
    });
    meshes.sort((a, b) => {
      const ay = a.geometry?.boundingBox ? (a.geometry.boundingBox.min.y + a.geometry.boundingBox.max.y) / 2 : 0;
      const by = b.geometry?.boundingBox ? (b.geometry.boundingBox.min.y + b.geometry.boundingBox.max.y) / 2 : 0;
      return ay - by;
    });

    // Bottom third = trunk, rest = crown
    const trunkCount = Math.max(1, Math.floor(meshes.length / 3));

    meshes.forEach((m, idx) => {
      m.castShadow = false;
      m.receiveShadow = false;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const isTrunk = idx < trunkCount;
      mats.forEach(mat => {
        // Remove any embedded texture so our color shows
        mat.map = null;
        mat.color.set(isTrunk ? 0xa56e15 : 0x3f8500);
        mat.needsUpdate = true;
      });
    });

    for (let i = 0; i < count; i++) {
      const tree = srcFBX.clone();

      // Random side: left or right of track
      const side = i < count / 2 ? 1 : -1;
      const x = side * (trackEdge + Math.random() * (maxX - trackEdge));
      const z = minZ + Math.random() * (maxZ - minZ);

      tree.position.set(x, 0, z);
      // Random rotation for variety
      tree.rotation.y = Math.random() * Math.PI * 2;
      // Random scale variation (80% to 130% of base)
      const s = treeScale * (0.8 + Math.random() * 0.5);
      tree.scale.setScalar(s);

      this.scene.add(tree);
    }
  }

  // --- FBX loading ---
  async loadModels(onProgress){
    const loader=new FBXLoader();
    const base='characters/FBX%20Files/';
    const load = n => new Promise((res,rej)=> loader.load(base+encodeURIComponent(n),res,undefined,rej));

    let done=0; const total=9;
    const tick=label=>{ done++; if(onProgress) onProgress(done/total,label); };

    const playerFBX = await load('MrFarts.fbx');         tick('MrFarts loaded');
    const idleFBX   = await load('MrFarts Idle.fbx');    this.idleClip=idleFBX.animations[0]||null; tick('Idle anim loaded');
    const runFBX    = await load('MrFarts Running.fbx'); this.runClip=runFBX.animations[0]||null;    tick('Run anim loaded');
    const grannyFBX = await load('Grandma.fbx');         tick('Grandma loaded');
    const pirateFBX = await load('Pirate.fbx');          tick('Pirate loaded');
    const suitFBX = await load('Spacesuit.fbx');          tick('Spacesuit loaded');
    const zombieFBX = await load('Zombie.fbx');            tick('Zombie loaded');
    const mariachiFBX = await load('Mariachi.fbx');        tick('Mariachi loaded');
    const treeFBX = await loader.loadAsync('treeModels/tree.fbx'); tick('Trees loaded');

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
    this.grannyMesh.position.set(0,0,CFG.FIELD_L+30);
    this.grannyMesh.rotation.y=Math.PI;
    this.scene.add(this.grannyMesh);
    const gm=new THREE.AnimationMixer(this.grannyMesh);
    if(this.idleClip){ const a=gm.clipAction(this.idleClip); a.play(); }
    this.mixers.push(gm);
    this._label(this.grannyMesh,'GRANNY FARTS','#44ff44',6);

    // --- Scatter trees on grass alongside track ---
    this._scatterTrees(treeFBX);

    // Store FBX sources for later — meshes created per match in buildAIMeshes()
    this._pirateFBX=pirateFBX;
    this._suitFBX=suitFBX;
    this._zombieFBX=zombieFBX;
    this._mariachiFBX=mariachiFBX;
    this.aiMeshes=[];
    this.aiMixers=[];
  }

  /** Create AI meshes to match the actual AI types (called after _makeAI) */
  buildAIMeshes(aiList){
    // Remove old AI meshes
    for(const m of this.aiMeshes) this.scene.remove(m);
    // Remove old AI mixers from the main mixer array
    for(const mx of this.aiMixers){
      const idx=this.mixers.indexOf(mx);
      if(idx>=0) this.mixers.splice(idx,1);
    }
    this.aiMeshes=[];
    this.aiMixers=[];
    this.aiIdleActions=[];
    this.aiRunActions=[];
    for(let i=0;i<aiList.length;i++){
      let src;
      switch(aiList[i].type){
        case 'pirate': src=this._pirateFBX; break;
        case 'spacesuit': src=this._suitFBX; break;
        case 'zombie': src=this._zombieFBX; break;
        case 'mariachi': src=this._mariachiFBX; break;
        default: src=this._pirateFBX; break;
      }
      const mesh=this._prep(src,CFG.MODEL_SCALE,false);
      this.scene.add(mesh);
      const mx=new THREE.AnimationMixer(mesh);
      let idleA=null, runA=null;
      if(this.idleClip){ idleA=mx.clipAction(this.idleClip); idleA.play(); idleA.time=rand(0,idleA.getClip().duration); }
      if(this.runClip){ runA=mx.clipAction(this.runClip); runA.play(); runA.setEffectiveWeight(0); }
      this.mixers.push(mx);
      this.aiMixers.push(mx);
      this.aiMeshes.push(mesh);
      this.aiIdleActions.push(idleA);
      this.aiRunActions.push(runA);
    }
  }

  _prep(fbx,scale,shadow){
    const g=new THREE.Group();
    fbx.scale.set(scale,scale,scale);
    fbx.traverse(c=>{
      if(c.isMesh){
        c.castShadow=false; c.receiveShadow=false;
        const ms=Array.isArray(c.material)?c.material:[c.material];
        ms.forEach(m=>{ m.roughness=0.7; m.metalness=0.1; if(m.map) m.map.colorSpace=THREE.SRGBColorSpace; });
        // Force geometry buffer re-upload for Android WebView WebGL
        if(c.geometry){
          const pos=c.geometry.attributes.position;
          if(pos) pos.needsUpdate=true;
          if(c.geometry.index) c.geometry.index.needsUpdate=true;
          if(c.geometry.attributes.normal) c.geometry.attributes.normal.needsUpdate=true;
          if(c.geometry.attributes.uv) c.geometry.attributes.uv.needsUpdate=true;
          if(c.geometry.attributes.skinWeight) c.geometry.attributes.skinWeight.needsUpdate=true;
          if(c.geometry.attributes.skinIndex) c.geometry.attributes.skinIndex.needsUpdate=true;
        }
        // Rebind SkinnedMesh skeletons for Android WebView compatibility
        if(c.isSkinnedMesh && c.skeleton){
          c.skeleton.calculateInverses();
          c.skeleton.computeBoneTexture();
          c.bind(c.skeleton, c.bindMatrix);
        }
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

    // mood lighting — subtle tint changes, stays bright
    if (game.light){
      const r=game.light.isRed;
      const t=game.light.isTurning;
      // turning = transitional amber tint
      const bgClr=r?0xf0b0b0:t?0xe8d8a0:0x87ceeb;
      this.scene.fog.color.set(bgClr);
      this.dirLight.color.set(r?0xffcccc:t?0xffeecc:0xffffff);
      this.dirLight.intensity=r?1.8:2.2;
      this.moodLight.color.set(r?0xff8888:t?0xffaa44:0xffffff);
      this.moodLight.intensity=r?0.7:t?0.6:0.5;
      this.ground.material.color.set(r?0xeecccc:0xf5f5f5);
    }

    // player mesh
    if (game.player&&this.playerMesh){
      this.playerMesh.visible=!game.player.blasted;
      if(!game.player.blasted){
        this.playerMesh.position.set(game.player.x,0,game.player.z);
        this.playerMesh.rotation.y=0;
        // animation blend
        if(this.playerIdleA&&this.playerRunA){
          const finished = game.player.z >= CFG.FIELD_L;
          const w = finished ? 0 : clamp(game.player.speed/20,0,1);
          this.playerRunA.enabled=true; this.playerIdleA.enabled=true;
          if(w>0.01&&!this.playerRunA.isRunning()) this.playerRunA.play();
          this.playerRunA.setEffectiveWeight(w);
          this.playerIdleA.setEffectiveWeight(1-w);
          this.playerRunA.setEffectiveTimeScale(finished ? 0 : 0.8+game.player.speed/CFG.MAX_SPEED*1.5);
        }
      }
    }

    // granny mesh
    if (game.grannyFarts&&this.grannyMesh){
      this.grannyMesh.position.set(game.grannyFarts.x,0,game.grannyFarts.z);
      this.grannyMesh.rotation.y=game.grannyFarts.currentRotY;
    }

    // Orb state + pulse
    if (this.orbGroup) {
      this.orbTime += dt;
      const isRed = game.light?.isRed;
      const isTurning = game.light?.isTurning;
      const clr = isRed ? 0xff0000 : isTurning ? 0xff4400 : 0x8B4513;
      this.orbMat.color.set(clr);
      this.orbMat.emissive.set(clr);
      this.orbLight.color.set(clr);
      const pulse = 1.0 + 0.15 * Math.sin(this.orbTime * (isRed ? 8 : 3));
      this.orbMesh.scale.setScalar(pulse);
      this.orbMat.emissiveIntensity = isRed ? 2.5 * pulse : 1.5 * pulse;
      this.orbLight.intensity = isRed ? 5 * pulse : 3 * pulse;
    }

    // AI meshes
    if (game.ai) for(let i=0;i<game.ai.length&&i<this.aiMeshes.length;i++){
      const a=game.ai[i];
      this.aiMeshes[i].visible=!a.blasted;
      if(!a.blasted){
        this.aiMeshes[i].position.set(a.x,0,a.z);
        // Animation blend: idle ↔ run (same as player)
        const idleA=this.aiIdleActions[i];
        const runA=this.aiRunActions[i];
        if(idleA&&runA){
          const finished = a.z >= CFG.FIELD_L;
          const w = finished ? 0 : clamp((a.speed||0)/20,0,1);
          runA.enabled=true; idleA.enabled=true;
          if(w>0.01&&!runA.isRunning()) runA.play();
          runA.setEffectiveWeight(w);
          idleA.setEffectiveWeight(1-w);
          runA.setEffectiveTimeScale(finished ? 0 : 0.8+(a.speed||0)/CFG.MAX_SPEED*1.5);
        }
      }
    }

    // blast glow
    if (game.blastFx){
      this.blastLight.intensity=clamp(game.blastFx.tmr/game.blastFx.max*30,0,30);
      this.blastLight.position.set(game.blastFx.x,5,game.blastFx.z);
    } else this.blastLight.intensity=0;

    // explosion + smoke particle update
    this.blastParticles.update(dt);

    // --- camera follow: third-person behind player ---
    if (game.player){
      const pz=game.player.z;
      this.camTarget.set(
        lerp(this.camTarget.x,game.player.x*0.6,dt*3),
        0,
        lerp(this.camTarget.z,pz,dt*CFG.CAM_SMOOTH)
      );

      this.camera.position.set(this.camTarget.x, CFG.CAM_HEIGHT, this.camTarget.z-CFG.CAM_BACK);
      this.camera.lookAt(this.camTarget.x, 2, this.camTarget.z+CFG.CAM_LOOK_AHEAD);

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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
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
    this.timerEl=document.getElementById('game-timer');
    this.progressImg = new Image();
    this.progressImg.src = 'UI/charactersUI/granny.png';
    this.progressImgReady = false;
    this.progressImg.onload = () => { this.progressImgReady = true; };

    this.state='loading'; this.matchTmr=0; this.cdTmr=0; this.cdNum=3; this.goReason='';
    this.msg=''; this.msgTmr=0; this.flashClr=''; this.flashTmr=0;
    this.dangerPulse=0; this.shakeAmt=0; this.blastFx=null;
    this.light=null; this.player=null; this.grannyFarts=null; this.ai=[];

    this._resizeHud();
    window.addEventListener('resize',()=>this._resizeHud());
  }
  _resizeHud(){
    const dpr = Math.min(window.devicePixelRatio, 3);
    this.hudCanvas.width = window.innerWidth * dpr;
    this.hudCanvas.height = window.innerHeight * dpr;
    this.hudCanvas.style.width = window.innerWidth + 'px';
    this.hudCanvas.style.height = window.innerHeight + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = window.innerWidth;
    this.H = window.innerHeight;
  }

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
    // Pool of available types (no rapper)
    const pool = ['pirate', 'zombie', 'spacesuit', 'mariachi'];
    // Pick 3 random types (can repeat or not — shuffle pool, take first 3)
    for (let i = pool.length - 1; i > 0; i--) {
      const j = randI(0, i);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const types = pool.slice(0, 3);

    // 3 bots: evenly spread across track width, avoid player at x=0
    const count = types.length; // 3
    const margin = 6;
    const usableW = CFG.FIELD_W - margin * 2; // 68
    const totalSlots = count + 1; // 4 (3 bots + 1 player gap)
    const slotW = usableW / totalSlots;

    // Build 4 evenly-spaced X slots
    const allSlots = [];
    for (let s = 0; s < totalSlots; s++) {
      allSlots.push(-usableW / 2 + (s + 0.5) * slotW);
    }
    // Remove the slot closest to x=0 (player's lane)
    let closestIdx = 0;
    for (let s = 1; s < allSlots.length; s++) {
      if (Math.abs(allSlots[s]) < Math.abs(allSlots[closestIdx])) closestIdx = s;
    }
    allSlots.splice(closestIdx, 1); // now 3 slots

    return types.map((t, i) => {
      const laneX = allSlots[i];
      const laneZ = -3;
      const ai = new AIEntity(laneX, laneZ, t, `Bot-${i + 1}`);
      if (t === 'pirate') ai.brain = new PirateBrain(ai);
      else if (t === 'spacesuit') ai.brain = new SpacesuitBrain(ai);
      else if (t === 'zombie') ai.brain = new ZombieBrain(ai);
      else if (t === 'mariachi') ai.brain = new MariachiBrain(ai);
      return ai;
    });
  }

  startMatch(){
    this.state='countdown'; this.cdTmr=0; this.cdNum=3; this.matchTmr=0; this.goReason='';
    this.shakeAmt=0; this.blastFx=null;
    this.player=new Player(CFG, lerp, clamp, targetSpeed, speedTier); this.grannyFarts=new GrannyFarts(); this.ai=this._makeAI();
    if(this.scene3d) this.scene3d.buildAIMeshes(this.ai);
    this.light=new LightSystem(); this.light.onSwitch=s=>this._onLight(s);
    this.audio.tick();
  }
  gameOver(r){ this.state='gameover'; this.goReason=r; this._showMsg(r,99); r.includes('WIN')?this.audio.go():this.audio.blast(); }

  _onLight(s){
    if(s==='brown'){
      this._showMsg('BROWN LIGHT',1); this._flash('#8B4513',.3); this.audio.brown();
    }
    else if(s==='turning'){
      // Granny is turning — show warning, no sound yet
      this._showMsg('👀 TURNING…',0.8);
    }
    else if(s==='red'){
      this._showMsg('RED LIGHT!',1); this._flash('#ff0000',.35); this.audio.red();
    }
    else if(s==='fake'){ this._flash('#ffaa00',.2); }
  }
  _showMsg(t,d){ this.msg=t; this.msgTmr=d; }
  _flash(c,d){ this.flashClr=c; this.flashTmr=d; }

  _blastPlayer(){
    this.player.blast(); this.audio.blast();
    this._flash('#33ff33',.5); this._showMsg('BLASTED!',1.5);
    this.shakeAmt=18;
    this.blastFx={x:this.player.x,z:this.player.z,tmr:2,max:2};
    // spawn 3D explosion + smoke
    if(this.scene3d&&this.scene3d.blastParticles){
      this.scene3d.blastParticles.spawn(this.player.x, this.player.z);
    }
  }

  // ======================== COLLISION SYSTEM ============================
  _resolveCollisions(dt){
    const p=this.player;
    const R=CFG.COLLISION_RADIUS;
    const R2=R*R;

    // --- AI vs Player collisions ---
    if(p && !p.blasted){
      for(let i=0;i<this.ai.length;i++){
        const a=this.ai[i];
        if(a.blasted) continue;
        const dx=a.x-p.x, dz=a.z-p.z;
        const d2=dx*dx+dz*dz;
        if(d2<R2 && d2>0.01){
          const dist=Math.sqrt(d2);
          const nx=dx/dist, nz=dz/dist;
          const overlap=R-dist;

          // Separate
          const sep=overlap*0.5;
          p.x-=nx*sep; p.z-=nz*sep;
          a.x+=nx*sep; a.z+=nz*sep;

          // If pirate brain — use its collision resolver
          if(a.brain && a.brain.resolveCollision){
            const push=a.brain.resolveCollision(p, true);
            if(push){
              // Push player (with resistance)
              p.x+=push.x*CFG.PLAYER_PUSH_RESIST*dt*10;
              p.speed=Math.max(0, p.speed+push.z*CFG.PLAYER_PUSH_RESIST*0.3);
              // If pushed during red → player might get blasted from forced speed
              if(this.light.isRed && push.force>10){
                p.speed=Math.max(p.speed, CFG.VEL_THRESHOLD+2);
              }
              // Camera shake for impact
              this.shakeAmt=Math.max(this.shakeAmt, push.force*0.3);
              p.stunTmr=Math.max(p.stunTmr, 0.15);
            }
          } else {
            // Generic bump — simple push apart
            const bumpF=8;
            p.x-=nx*bumpF*dt; p.speed=Math.max(0,p.speed-3);
            a.vx=(a.vx||0)+nx*bumpF*0.5;
          }
        }
      }
    }

    // --- AI vs AI collisions ---
    for(let i=0;i<this.ai.length;i++){
      const a=this.ai[i];
      if(a.blasted) continue;
      for(let j=i+1;j<this.ai.length;j++){
        const b=this.ai[j];
        if(b.blasted) continue;
        const dx=b.x-a.x, dz=b.z-a.z;
        const d2=dx*dx+dz*dz;
        if(d2<R2 && d2>0.01){
          const dist=Math.sqrt(d2);
          const nx=dx/dist, nz=dz/dist;
          const overlap=R-dist;

          // Separate
          const sep=overlap*0.5;
          a.x-=nx*sep; a.z-=nz*sep;
          b.x+=nx*sep; b.z+=nz*sep;

          // Pirate A → B
          if(a.brain && a.brain.resolveCollision){
            const push=a.brain.resolveCollision(b, false);
            if(push){
              b.applyPush(push.x*0.4, push.z*0.3);
              // If B moving too fast during red → blast
              if(this.light.isRed && this.light.canDetect && (b.speed||0)>CFG.VEL_THRESHOLD*1.5){
                b.blasted=true; b.speed=0;
              }
            }
          }
          // Pirate B → A
          else if(b.brain && b.brain.resolveCollision){
            const push=b.brain.resolveCollision(a, false);
            if(push){
              a.applyPush(push.x*0.4, push.z*0.3);
              if(this.light.isRed && this.light.canDetect && (a.speed||0)>CFG.VEL_THRESHOLD*1.5){
                a.blasted=true; a.speed=0;
              }
            }
          }
          // Generic AI bump
          else {
            const bumpF=5;
            a.vx=(a.vx||0)-nx*bumpF*0.3;
            b.vx=(b.vx||0)+nx*bumpF*0.3;
          }
        }
      }
    }
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
        this.grannyFarts.update(dt,this.light.state,{x:this.player.x,z:this.player.z},this.light.fakeActive, this.light.isTurning?this.light.turnTimer/CFG.TURN_DURATION:0);
        this.ai.forEach((a,i)=>a.update(dt, this.light, this.player, this.ai, i));

        // Red light detection for ALL AI (including pirates)
        if(this.light.isRed && this.light.canDetect){
          for(const a of this.ai){
            if(!a.blasted && (a.speed||0) > CFG.VEL_THRESHOLD){
              a.blasted=true; a.speed=0;
              a.respawnTmr=2;  // respawn after 2 seconds (same as player)
              // Spawn explosion same as player
              if(this.scene3d&&this.scene3d.blastParticles){
                this.scene3d.blastParticles.spawn(a.x, a.z);
              }
              this.audio.blast();
            }
          }
        }

        // === COLLISION SYSTEM ===
        this._resolveCollisions(dt);

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
      case 'menu': this._rMenu(ctx,W,H); if(this.timerEl) this.timerEl.style.display='none'; break;
      case 'countdown': this._rHUD(ctx,W,H); this._rCD(ctx,W,H); break;
      case 'playing': this._rHUD(ctx,W,H); break;
      case 'gameover': this._rHUD(ctx,W,H); this._rGO(ctx,W,H); if(this.timerEl) this.timerEl.style.display='none'; break;
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
      const scMsg=Math.max(0.5, Math.min(W,H)/500);
      ctx.font=`bold ${Math.round(Math.min(48,W*.07)*scMsg)}px "SoupOfJustice","Courier New",monospace`;
      const c=this.msg.includes('RED')?'#ff3333':this.msg.includes('BROWN')?'#cc8844':this.msg.includes('BLAST')?'#44ff44':'#fff';
      ctx.shadowColor='#000'; ctx.shadowBlur=12*scMsg; ctx.fillStyle=c;
      ctx.fillText(this.msg,W/2,H/2-H*.1); ctx.shadowBlur=0; ctx.globalAlpha=1;
    }
  }

  _rMenu(ctx,W,H){
    const sc=Math.max(0.5, Math.min(W,H)/500);
    ctx.fillStyle='rgba(0,0,0,0.82)'; ctx.fillRect(0,0,W,H); ctx.textAlign='center';
    ctx.shadowColor='#ff3333'; ctx.shadowBlur=20*sc; ctx.fillStyle='#ff4444';
    ctx.font=`bold ${Math.round(Math.min(64,W*.08)*sc)}px "SoupOfJustice","Courier New",monospace`;
    ctx.fillText('RED LIGHT…',W/2,H/2-80*sc);
    ctx.shadowColor='#8B4513'; ctx.fillStyle='#AA6633';
    ctx.fillText('BROWN LIGHT',W/2,H/2-20*sc); ctx.shadowBlur=0;
    ctx.fillStyle='#44cc44'; ctx.font=`${Math.round(Math.min(20,W*.03)*sc)}px "SoupOfJustice",monospace`;
    ctx.fillText('A Top-Down Mud Chaos Runner',W/2,H/2+30*sc);
    ctx.fillStyle='#aaa'; ctx.font=`${Math.round(Math.min(22,W*.035)*sc)}px "SoupOfJustice",monospace`;
    const isMobile = 'ontouchstart' in window;
    ctx.fillText(isMobile ? '[ TAP to start ]' : '[ Press ENTER to start ]',W/2,H/2+80*sc);
    ctx.fillStyle='#666'; ctx.font=`${Math.round(Math.min(15,W*.025)*sc)}px "SoupOfJustice",monospace`;
    if (isMobile) {
      ctx.fillText('HOLD center = Run Forward',W/2,H/2+130*sc);
      ctx.fillText('HOLD left/right edges = Dodge',W/2,H/2+155*sc);
    } else {
      ctx.fillText('W / ↑ / SPACE = Run Forward       A D / ← → = Dodge',W/2,H/2+130*sc);
      ctx.fillText('HOLD longer → faster → harder to stop!',W/2,H/2+155*sc);
    }
  }

  _rCD(ctx,W,H){
    const sc=Math.max(0.5, Math.min(W,H)/500);
    ctx.fillStyle='rgba(0,0,0,0.65)'; ctx.fillRect(0,0,W,H); ctx.textAlign='center';
    ctx.fillStyle='#fff'; ctx.font=`bold ${Math.round(Math.min(150,W*.18)*sc)}px "SoupOfJustice","Courier New",monospace`;
    ctx.fillText(String(Math.max(1,Math.ceil(CFG.COUNTDOWN-this.cdTmr))),W/2,H/2+50*sc);
    ctx.font=`${Math.round(Math.min(24,W*.04)*sc)}px "SoupOfJustice",monospace`; ctx.fillStyle='#888';
    ctx.fillText('GET READY…',W/2,H/2+100*sc);
  }

  _rHUD(ctx,W,H){
    if(!this.light||!this.player) return;
    const isR=this.light.isRed;
    const sc=Math.max(0.5, Math.min(W,H)/500); // responsive scale
    // timer — countdown from 2:00, rendered via DOM element
    const remaining=Math.max(0, CFG.TIMEOUT - this.matchTmr);
    const m=Math.floor(remaining/60),s=Math.floor(remaining%60);
    if(this.timerEl){
      this.timerEl.textContent=`${m}:${String(s).padStart(2,'0')}`;
      this.timerEl.style.color=remaining<=20?'#ff4444':'#ffffff';
      this.timerEl.style.display='';
    }
    // speed bar — responsive
    const bw=Math.round(26*sc),bh=Math.round(260*sc);
    const bx=Math.round(16*sc),by=Math.round(H/2-bh/2);
    const ratio=clamp(this.player.speed/CFG.MAX_SPEED,0,1),tier=this.player.tier;
    ctx.fillStyle='rgba(0,0,0,0.7)'; this._rr(ctx,bx-4*sc,by-24*sc,bw+10*sc,bh+34*sc,6*sc); ctx.fill();
    ctx.fillStyle='#2a2a2a'; ctx.fillRect(bx,by,bw,bh);
    ctx.fillStyle=TIER_CLR[tier]; ctx.fillRect(bx,by+bh-ratio*bh,bw,ratio*bh);
    [13,33,66].forEach(t=>{ const ty=by+bh-(t/CFG.MAX_SPEED)*bh; ctx.strokeStyle='#555'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(bx,ty); ctx.lineTo(bx+bw,ty); ctx.stroke(); });
    ctx.fillStyle=TIER_CLR[tier]; ctx.font=`bold ${Math.round(12*sc)}px "SoupOfJustice",monospace`; ctx.textAlign='center';
    ctx.fillText(TIER_NAME[tier],bx+bw/2,by-8*sc);
    // progress bar — horizontal, top-left with character PNG
    const barMargin = Math.round(16 * sc);
    const barY = Math.round(12 * sc);
    const barW = Math.round(Math.min(260, W * 0.40) * sc);
    const barH = Math.round(14 * sc);
    const prog = clamp(this.player.progress, 0, 1);

    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    this._rr(ctx, barMargin - 4*sc, barY - 4*sc, barW + 8*sc, barH + 8*sc, 6*sc);
    ctx.fill();

    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(barMargin, barY, barW, barH);

    ctx.fillStyle = '#ffcc00';
    ctx.fillRect(barMargin, barY, barW * prog, barH);

    // Finish zone marker
    const fzX = barMargin + (CFG.FINISH_ZONE_START / CFG.FIELD_L) * barW;
    ctx.strokeStyle = '#ff8800'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(fzX, barY - 2); ctx.lineTo(fzX, barY + barH + 2); ctx.stroke();

    // Character PNG sliding along bar
    const imgSize = Math.round(28 * sc);
    const imgX = barMargin + prog * barW - imgSize / 2;
    const imgY = barY + barH / 2 - imgSize / 2;
    if (this.progressImgReady) {
      ctx.drawImage(this.progressImg, imgX, imgY - 2, imgSize, imgSize);
    } else {
      ctx.fillStyle = '#4488ff';
      ctx.beginPath();
      ctx.arc(imgX + imgSize/2, imgY + imgSize/2, imgSize/3, 0, Math.PI*2);
      ctx.fill();
    }

    ctx.fillStyle = '#888';
    ctx.font = `${Math.round(10*sc)}px "SoupOfJustice",monospace`;
    ctx.textAlign = 'left';
    ctx.fillText('PROGRESS', barMargin, barY + barH + 14*sc);
  }

  _rGO(ctx,W,H){
    const sc=Math.max(0.5, Math.min(W,H)/500);
    ctx.fillStyle='rgba(0,0,0,0.78)'; ctx.fillRect(0,0,W,H); ctx.textAlign='center';
    const w=this.goReason.includes('WIN');
    ctx.shadowColor=w?'#ffcc00':'#ff0000'; ctx.shadowBlur=25*sc;
    ctx.fillStyle=w?'#ffcc00':'#ff4444';
    let goFontSize = Math.round(Math.min(60, W * 0.08) * sc);
    ctx.font = `bold ${goFontSize}px "SoupOfJustice","Courier New",monospace`;
    // Shrink font until text fits with padding
    const maxTextW = W * 0.9;
    while (ctx.measureText(this.goReason).width > maxTextW && goFontSize > 16) {
      goFontSize -= 2;
      ctx.font = `bold ${goFontSize}px "SoupOfJustice","Courier New",monospace`;
    }
    ctx.fillText(this.goReason, W/2, H/2 - 20*sc); ctx.shadowBlur=0;
    const isMobile = 'ontouchstart' in window;
    ctx.fillStyle='#aaa'; ctx.font=`${Math.round(20*sc)}px "SoupOfJustice",monospace`; ctx.fillText(isMobile ? '[ TAP to continue ]' : '[ Press ENTER ]',W/2,H/2+40*sc);
    const remaining=Math.max(0, CFG.TIMEOUT - this.matchTmr);
    const m=Math.floor(remaining/60),s=Math.floor(remaining%60);
    ctx.fillStyle='#888'; ctx.font=`${Math.round(16*sc)}px "SoupOfJustice",monospace`; ctx.fillText(`Time: ${m}:${String(s).padStart(2,'0')}`,W/2,H/2+70*sc);
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

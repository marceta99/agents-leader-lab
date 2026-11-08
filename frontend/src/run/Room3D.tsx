import { ContactShadows, Html, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { useReducedMotion } from './motion'
import './room3d.css'
import type { AgentState, BoardState, ChairState, ChatMessage } from './types'
import { AGENT_COLORS, ZONE_COLORS } from './types'

// Grid cell [x, y] -> world (x, z); y=0 (top row) is the far side of the room.
const wx = (x: number) => x - 3.5
const FLOOR = 0.06 // top of the tiles
const AGENT_OFF = 0.27 // agents stand in the cell's front-right corner so they don't sink into chairs
const CHAIR_H = 0.78
const CARRY_Y = 1.08 // carried chairs ride above the agent's head
const BUBBLE_MS = 4000
const MAX_BUBBLES = 2
const DROP_H = 6 // airborne height for the hero intro
const STAGGER_MS = 85
const GRAVITY = 32

const zoneOf = (x: number, y: number) => Math.floor(y / 4) * 2 + Math.floor(x / 4)
const smooth = (p: number) => p * p * (3 - 2 * p)
const damp = (dt: number, rate: number) => 1 - Math.exp(-dt * rate)

// ---- shared geometry + materials (created once; three re-uploads them if a viewer remounts) ----

function starGeometry() {
  const s = new THREE.Shape()
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.065 : 0.15
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2
    if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    else s.moveTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2 })
  g.center()
  return g
}

const GEO = {
  slab: new RoundedBoxGeometry(8.7, 0.34, 8.7, 3, 0.08),
  tile: new RoundedBoxGeometry(0.95, 0.12, 0.95, 2, 0.035),
  wallLong: new RoundedBoxGeometry(8.7, 0.3, 0.16, 2, 0.05),
  wallShort: new RoundedBoxGeometry(0.16, 0.3, 8.38, 2, 0.05),
  seat: new RoundedBoxGeometry(0.52, 0.075, 0.5, 2, 0.028),
  back: new RoundedBoxGeometry(0.52, 0.32, 0.065, 2, 0.028),
  leg: new RoundedBoxGeometry(0.065, 0.38, 0.065, 1, 0.022),
  body: new THREE.CapsuleGeometry(0.165, 0.28, 6, 16),
  head: new THREE.SphereGeometry(0.15, 24, 16),
  eye: new THREE.SphereGeometry(0.024, 8, 6),
  arm: new THREE.CapsuleGeometry(0.045, 0.2, 4, 8),
  star: starGeometry(),
}

const matte = (color: THREE.ColorRepresentation, roughness = 0.82) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 })

const soften = (hex: string, k: number) => new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), k)

const MAT = {
  slab: matte('#c8cbd6'),
  wall: matte('#f3f4f7', 0.9),
  // two shades per zone give the floor a quiet checker
  tiles: ZONE_COLORS.map((z) => [matte(soften(z, 0.12)), matte(soften(z, 0.2))]),
  eye: matte('#1c1838', 0.4),
  star: new THREE.MeshStandardMaterial({ color: '#f2b632', roughness: 0.35, metalness: 0.2, emissive: '#6b4a00', emissiveIntensity: 0.35 }),
}

const agentMats = new Map<string, { body: THREE.Material; head: THREE.Material }>()
function agentMat(name: string) {
  let m = agentMats.get(name)
  if (!m) {
    const c = AGENT_COLORS[name] ?? '#55526f'
    m = { body: matte(c, 0.7), head: matte(soften(c, 0.18), 0.7) }
    agentMats.set(name, m)
  }
  return m
}

// Light wood with a small per-chair variation in hue and tone.
const chairMats = new Map<number, { wood: THREE.Material; leg: THREE.Material }>()
function chairMat(id: number) {
  let m = chairMats.get(id)
  if (!m) {
    const j = ((id * 37) % 9) / 8 - 0.5 // -0.5..0.5, stable per id
    m = {
      wood: matte(new THREE.Color().setHSL((30 + j * 8) / 360, 0.48, 0.68 + j * 0.06), 0.75),
      leg: matte(new THREE.Color().setHSL((26 + j * 6) / 360, 0.4, 0.52 + j * 0.05), 0.75),
    }
    chairMats.set(id, m)
  }
  return m
}

/**
 * Per-object drop animation (hero intro / loop): falls under gravity with two small bounces, lifts out upward.
 * Computed from wall time, not integrated per frame, so a slow or throttled frame rate can't stall it mid-air.
 */
interface Drop {
  y: number
  from: number
  air: boolean
  since: number
}
const BOUNCE = 0.3
function newDrop(airborne: boolean): Drop {
  const y = airborne ? DROP_H : 0
  return { y, from: y, air: airborne, since: performance.now() }
}
function stepDrop(d: Drop, airborne: boolean, delayMs: number, reduced: boolean) {
  const now = performance.now()
  if (d.air !== airborne) {
    d.air = airborne
    d.from = d.y
    d.since = now
  }
  d.y = reduced ? (airborne ? DROP_H : 0) : dropAt(d.from, airborne, (now - d.since - delayMs) / 1000)
}
function dropAt(from: number, up: boolean, t: number) {
  if (t <= 0) return from
  if (up) return Math.min(DROP_H, from + 0.5 * GRAVITY * 0.8 * t * t)
  const tf = Math.sqrt((2 * from) / GRAVITY)
  if (t < tf) return from - 0.5 * GRAVITY * t * t
  let v = GRAVITY * tf * BOUNCE
  let tt = t - tf
  for (let i = 0; i < 2; i++) {
    const dur = (2 * v) / GRAVITY
    if (tt < dur) return v * tt - 0.5 * GRAVITY * tt * tt
    tt -= dur
    v *= BOUNCE
  }
  return 0
}

// ---- room ----

function Floor() {
  const tiles = []
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      tiles.push(
        <mesh
          key={`${x},${y}`}
          geometry={GEO.tile}
          material={MAT.tiles[zoneOf(x, y)][(x + y) % 2]}
          position={[wx(x), 0, wx(y)]}
          receiveShadow
        />,
      )
  return (
    <group>
      <mesh geometry={GEO.slab} material={MAT.slab} position={[0, -0.17, 0]} receiveShadow />
      {tiles}
      <mesh geometry={GEO.wallLong} material={MAT.wall} position={[0, 0.15, -4.27]} castShadow receiveShadow />
      <mesh geometry={GEO.wallLong} material={MAT.wall} position={[0, 0.15, 4.27]} castShadow receiveShadow />
      <mesh geometry={GEO.wallShort} material={MAT.wall} position={[-4.27, 0.15, 0]} castShadow receiveShadow />
      <mesh geometry={GEO.wallShort} material={MAT.wall} position={[4.27, 0.15, 0]} castShadow receiveShadow />
    </group>
  )
}

const LEGS: [number, number][] = [
  [-0.21, -0.2],
  [0.21, -0.2],
  [-0.21, 0.2],
  [0.21, 0.2],
]

function ChairModel({ id }: { id: number }) {
  const m = chairMat(id)
  // modelled with its centre at the origin so a flip rotates in place
  return (
    <group position={[0, -CHAIR_H / 2, 0]}>
      {LEGS.map(([x, z], i) => (
        <mesh key={i} geometry={GEO.leg} material={m.leg} position={[x, 0.19, z]} castShadow />
      ))}
      <mesh geometry={GEO.seat} material={m.wood} position={[0, 0.41, 0]} castShadow receiveShadow />
      <mesh geometry={GEO.back} material={m.wood} position={[0, 0.62, -0.215]} castShadow />
    </group>
  )
}

function Chair({ c, order, airborne, label, reduced }: { c: ChairState; order: number; airborne: boolean; label: boolean; reduced: boolean }) {
  const root = useRef<THREE.Group>(null!)
  const turn = useRef<THREE.Group>(null!)
  const s = useRef({ x: NaN, z: NaN, lift: 0, drop: newDrop(airborne) })

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 30)
    const st = s.current
    const off = c.carried ? AGENT_OFF : 0
    const tx = wx(c.pos[0]) + off
    const tz = wx(c.pos[1]) + off
    if (Number.isNaN(st.x) || reduced || Math.abs(tx - st.x) + Math.abs(tz - st.z) > 1.5) {
      st.x = tx
      st.z = tz
    } else {
      const k = damp(dt, 18)
      st.x += (tx - st.x) * k
      st.z += (tz - st.z) * k
    }
    const liftTo = c.carried ? CARRY_Y : 0
    st.lift = reduced ? liftTo : st.lift + (liftTo - st.lift) * damp(dt, 9)
    stepDrop(st.drop, airborne, order * STAGGER_MS, reduced)

    const p = smooth(c.flip ?? 0)
    const g = root.current
    g.position.set(st.x, FLOOR + st.lift + st.drop.y + Math.sin(p * Math.PI) * 0.35, st.z)
    g.visible = st.drop.y < DROP_H - 0.01
    turn.current.rotation.x = (c.upsideDown ? Math.PI : 0) + p * Math.PI
  })

  return (
    <group ref={root} visible={false} scale={c.carried ? 0.82 : 1}>
      <group ref={turn} position={[0, CHAIR_H / 2, 0]}>
        <ChairModel id={c.id} />
      </group>
      {label && !airborne && (
        <Html position={[0, CHAIR_H + 0.22, 0]} center className={c.upsideDown ? 'r3-chair-label flipped' : 'r3-chair-label'}>
          {c.id}
        </Html>
      )}
    </group>
  )
}

function Agent(props: {
  a: AgentState
  order: number
  bubble: ChatMessage | null
  airborne: boolean
  leader: boolean
  hero: boolean
  reduced: boolean
}) {
  const { a, order, bubble, airborne, leader, hero, reduced } = props
  const mats = agentMat(a.name)
  const root = useRef<THREE.Group>(null!)
  const body = useRef<THREE.Group>(null!)
  const armL = useRef<THREE.Group>(null!)
  const armR = useRef<THREE.Group>(null!)
  const star = useRef<THREE.Mesh>(null)
  const s = useRef({ x: NaN, z: NaN, yaw: 0, yawTo: 0, bob: 0, arms: 0, drop: newDrop(airborne) })
  const moving = a.mode === 'walking' || a.mode === 'carrying'
  const carrying = a.mode === 'carrying'

  useFrame((clock, delta) => {
    const dt = Math.min(delta, 1 / 30)
    const st = s.current
    const tx = wx(a.pos[0]) + AGENT_OFF
    const tz = wx(a.pos[1]) + AGENT_OFF
    if (Number.isNaN(st.x)) {
      st.yaw = st.yawTo = Math.atan2(-tx, -tz) // start facing the middle of the room
    } else {
      const dx = tx - st.x
      const dz = tz - st.z
      if (Math.abs(dx) + Math.abs(dz) > 1e-4 && Math.abs(dx) + Math.abs(dz) < 1.5) st.yawTo = Math.atan2(dx, dz)
    }
    st.x = tx
    st.z = tz
    let dy = st.yawTo - st.yaw
    dy = Math.atan2(Math.sin(dy), Math.cos(dy)) // shortest way round
    st.yaw += reduced ? dy : dy * damp(dt, 10)
    const time = clock.clock.elapsedTime
    const bobTo = moving && !reduced ? Math.abs(Math.sin(time * 8.5)) * 0.07 : 0
    st.bob += (bobTo - st.bob) * damp(dt, 20)
    st.arms += ((carrying ? 1 : 0) - st.arms) * (reduced ? 1 : damp(dt, 10))
    stepDrop(st.drop, airborne, order * STAGGER_MS, reduced)

    root.current.position.set(tx, FLOOR + st.drop.y, tz)
    root.current.visible = st.drop.y < DROP_H - 0.01
    body.current.position.y = st.bob
    body.current.rotation.y = st.yaw
    body.current.rotation.z = moving && !reduced ? Math.sin(time * 8.5) * 0.04 : 0
    armL.current.rotation.x = armR.current.rotation.x = -st.arms * 2.7
    if (star.current) {
      star.current.rotation.y = reduced ? 0.4 : time * 1.2
      star.current.position.y = 1.2 + (reduced ? 0 : Math.sin(time * 2) * 0.03)
    }
  })

  const top = carrying ? 1.7 : 1.16
  return (
    <group ref={root} visible={false}>
      <group ref={body} scale={1.18}>
        <mesh geometry={GEO.body} material={mats.body} position={[0, 0.31, 0]} castShadow />
        <mesh geometry={GEO.head} material={mats.head} position={[0, 0.69, 0]} castShadow />
        <mesh geometry={GEO.eye} material={MAT.eye} position={[-0.055, 0.71, 0.135]} />
        <mesh geometry={GEO.eye} material={MAT.eye} position={[0.055, 0.71, 0.135]} />
        <group ref={armL} position={[-0.2, 0.48, 0]}>
          <mesh geometry={GEO.arm} material={mats.body} position={[0, -0.13, 0]} castShadow />
        </group>
        <group ref={armR} position={[0.2, 0.48, 0]}>
          <mesh geometry={GEO.arm} material={mats.body} position={[0, -0.13, 0]} castShadow />
        </group>
      </group>
      {leader && <mesh ref={star} geometry={GEO.star} material={MAT.star} position={[0, 1.2, 0]} castShadow />}
      {!airborne && (
        <Html position={[0, top + (leader ? 0.34 : 0), 0]} center className={hero ? 'r3-agent-label hero' : 'r3-agent-label'}>
          <span style={{ background: AGENT_COLORS[a.name] }}>{a.name}</span>
        </Html>
      )}
      {bubble && !airborne && (
        <Html position={[0, top + (leader ? 0.34 : 0) + 0.3, 0]} className={hero ? 'r3-bubble-anchor hero' : 'r3-bubble-anchor'}>
          <div className="r3-bubble" key={bubble.id}>
            <span className="r3-bubble-text">
              <b style={{ color: AGENT_COLORS[a.name] }}>{a.name}</b> {bubble.text}
            </span>
          </div>
        </Html>
      )}
    </group>
  )
}

// ---- cameras ----

const HERO_AZ = Math.PI / 4
const HERO_EL = 0.74
const HERO_R = 24

/** Hero camera: a three-quarter view that leans gently toward the pointer and drifts slowly. */
function HeroRig({ reduced }: { reduced: boolean }) {
  const camera = useThree((s) => s.camera)
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height))
  const radius = HERO_R * Math.max(1, 1.32 / aspect) // pull back on narrow (phone) canvases so the room fits
  const p = useRef({ x: 0, y: 0, cx: 0, cy: 0 })
  useEffect(() => {
    if (reduced) return
    const on = (e: PointerEvent) => {
      p.current.x = (e.clientX / innerWidth) * 2 - 1
      p.current.y = (e.clientY / innerHeight) * 2 - 1
    }
    addEventListener('pointermove', on, { passive: true })
    return () => removeEventListener('pointermove', on)
  }, [reduced])
  useFrame((st, delta) => {
    const q = p.current
    const k = damp(Math.min(delta, 1 / 30), 2.5)
    q.cx += (q.x - q.cx) * k
    q.cy += (q.y - q.cy) * k
    const drift = reduced ? 0 : Math.sin(st.clock.elapsedTime * 0.11) * 0.06
    const az = HERO_AZ + (reduced ? 0 : q.cx * 0.09) + drift
    const el = HERO_EL + (reduced ? 0 : q.cy * 0.05)
    camera.position.set(radius * Math.cos(el) * Math.sin(az), radius * Math.sin(el), radius * Math.cos(el) * Math.cos(az))
    camera.lookAt(0.3, -0.6, 0.3)
  })
  return null
}

export interface Room3DProps {
  state: BoardState
  variant?: 'viewer' | 'hero'
  /** measured leader: gets a floating star (viewer only) */
  leader?: string | null
  /** hero intro / loop: chairs then agents are lifted out of the room; flipping to false drops them in */
  airborne?: boolean
  /** false pauses rendering, e.g. while the hero is scrolled out of view */
  active?: boolean
}

export default function Room3D({ state, variant = 'viewer', leader = null, airborne = false, active = true }: Room3DProps) {
  const reduced = useReducedMotion()
  const hero = variant === 'hero'
  // At most MAX_BUBBLES speech bubbles at once (newest first, one per agent): real agents talk a lot,
  // and four long bubbles would cover the room. The full text is always in the chat panel.
  const bubbles = new Map<string, ChatMessage>()
  for (let i = state.messages.length - 1; i >= 0 && bubbles.size < MAX_BUBBLES; i--) {
    const m = state.messages[i]
    if (state.t - m.t > BUBBLE_MS) break
    if (!bubbles.has(m.agent)) bubbles.set(m.agent, m)
  }
  const bubbleFor = (name: string) => bubbles.get(name) ?? null
  const nChairs = state.chairs.length
  return (
    <Canvas
      shadows="percentage"
      flat
      dpr={[1, 2]}
      frameloop={active ? 'always' : 'never'}
      gl={{ antialias: true, alpha: true }}
      camera={hero ? { position: [12, 15, 12], fov: 26 } : { position: [0, 11.4, 10.6], fov: 38 }}
    >
      <hemisphereLight args={['#ffffff', '#b8bccb', 2.1]} />
      <directionalLight
        position={[4.5, 10, 5.5]}
        intensity={2.1}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-radius={5}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
        shadow-camera-near={2}
        shadow-camera-far={24}
      />
      <Floor />
      <ContactShadows position={[0, -0.36, 0]} scale={14} blur={2.8} far={3} opacity={0.42} color="#1c1838" frames={1} />
      {state.chairs.map((c, i) => (
        <Chair key={c.id} c={c} order={i} airborne={airborne} label={!hero} reduced={reduced} />
      ))}
      {state.agents.map((a, i) => (
        <Agent
          key={a.name}
          a={a}
          order={nChairs + i}
          bubble={bubbleFor(a.name)}
          airborne={airborne}
          leader={!hero && a.name === leader}
          hero={hero}
          reduced={reduced}
        />
      ))}
      {hero ? (
        <HeroRig reduced={reduced} />
      ) : (
        // no zoom: the wheel keeps scrolling the page, and the whole room already fits
        <OrbitControls
          target={[0, 0, 0.3]}
          enablePan={false}
          enableZoom={false}
          enableDamping
          minPolarAngle={0.2}
          maxPolarAngle={1.2}
          // phones: one finger scrolls the page, two fingers rotate the room
          touches={{ ONE: undefined as unknown as THREE.TOUCH, TWO: THREE.TOUCH.DOLLY_ROTATE }}
        />
      )}
    </Canvas>
  )
}

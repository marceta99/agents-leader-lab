import { Html, OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import type { AgentState, BoardState, ChairState, ChatMessage } from './types'
import { AGENT_COLORS, ZONE_COLORS } from './types'

// Grid cell [x, y] -> world (x, z); y=0 (top row) is the far side of the room.
const wx = (x: number) => x - 3.5
const FLOOR = 0.05
const AGENT_OFF = 0.28 // agents stand in the cell's front-right corner so they don't sink into chairs
const CHAIR_H = 0.76
const BUBBLE_MS = 4000

const zoneOf = (x: number, y: number) => Math.floor(y / 4) * 2 + Math.floor(x / 4)

function Floor() {
  const tiles = []
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      tiles.push(
        <mesh key={`${x},${y}`} position={[wx(x), 0, wx(y)]}>
          <boxGeometry args={[0.95, 0.1, 0.95]} />
          <meshStandardMaterial color={ZONE_COLORS[zoneOf(x, y)]} flatShading />
        </mesh>,
      )
  const wall = '#d9d3c7'
  return (
    <group>
      <mesh position={[0, -0.04, 0]}>
        <boxGeometry args={[8.1, 0.1, 8.1]} />
        <meshStandardMaterial color="#8b93a1" />
      </mesh>
      {tiles}
      {[
        [0, -4.2, 8.7, 0.3],
        [0, 4.2, 8.7, 0.3],
        [-4.2, 0, 0.3, 8.1],
        [4.2, 0, 0.3, 8.1],
      ].map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, 0.15, z]}>
          <boxGeometry args={[w, 0.4, d]} />
          <meshStandardMaterial color={wall} flatShading />
        </mesh>
      ))}
    </group>
  )
}

function ChairModel() {
  const wood = '#9c6644'
  const seat = '#c58b5a'
  return (
    <group position={[0, -CHAIR_H / 2, 0]}>
      {[
        [-0.2, -0.2],
        [0.2, -0.2],
        [-0.2, 0.2],
        [0.2, 0.2],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.15, z]}>
          <boxGeometry args={[0.06, 0.3, 0.06]} />
          <meshStandardMaterial color={wood} flatShading />
        </mesh>
      ))}
      <mesh position={[0, 0.33, 0]}>
        <boxGeometry args={[0.5, 0.06, 0.5]} />
        <meshStandardMaterial color={seat} flatShading />
      </mesh>
      <mesh position={[0, 0.56, -0.22]}>
        <boxGeometry args={[0.5, 0.4, 0.06]} />
        <meshStandardMaterial color={wood} flatShading />
      </mesh>
    </group>
  )
}

function Chair({ c }: { c: ChairState }) {
  const p = c.flip ?? 0
  const angle = (c.upsideDown ? Math.PI : 0) + p * Math.PI
  const lift = Math.sin(p * Math.PI) * 0.5
  const off = c.carried ? AGENT_OFF : 0
  const scale = c.carried ? 0.7 : 1
  const y = c.carried ? 0.92 : FLOOR
  return (
    <group position={[wx(c.pos[0]) + off, y, wx(c.pos[1]) + off]} scale={scale}>
      <group position={[0, CHAIR_H / 2 + lift, 0]} rotation={[angle, 0, 0]}>
        <ChairModel />
      </group>
      <Html position={[0, CHAIR_H + 0.25 + lift, 0]} center className={c.upsideDown ? 'r3-chair-label flipped' : 'r3-chair-label'}>
        {c.id}
      </Html>
    </group>
  )
}

function Agent({ a, t, bubble }: { a: AgentState; t: number; bubble: ChatMessage | null }) {
  const color = AGENT_COLORS[a.name] ?? '#444'
  const moving = a.mode === 'walking' || a.mode === 'carrying'
  const bob = moving ? Math.abs(Math.sin(t / 160)) * 0.05 : 0
  const carrying = a.mode === 'carrying'
  const top = carrying ? 1.75 : 1.05
  return (
    <group position={[wx(a.pos[0]) + AGENT_OFF, FLOOR + bob, wx(a.pos[1]) + AGENT_OFF]}>
      <mesh position={[0, 0.27, 0]}>
        <cylinderGeometry args={[0.13, 0.19, 0.54, 7]} />
        <meshStandardMaterial color={color} flatShading />
      </mesh>
      <mesh position={[0, 0.68, 0]}>
        <icosahedronGeometry args={[0.14, 1]} />
        <meshStandardMaterial color="#f1d3b3" flatShading />
      </mesh>
      {carrying && (
        <>
          <mesh position={[-0.14, 0.72, 0]} rotation={[0, 0, -0.3]}>
            <boxGeometry args={[0.05, 0.36, 0.05]} />
            <meshStandardMaterial color={color} flatShading />
          </mesh>
          <mesh position={[0.14, 0.72, 0]} rotation={[0, 0, 0.3]}>
            <boxGeometry args={[0.05, 0.36, 0.05]} />
            <meshStandardMaterial color={color} flatShading />
          </mesh>
        </>
      )}
      {a.isLeader && (
        <mesh position={[0, 0.86, 0]}>
          <coneGeometry args={[0.1, 0.14, 5]} />
          <meshStandardMaterial color="#f5b700" emissive="#7a5600" flatShading />
        </mesh>
      )}
      <Html position={[0, top, 0]} center className="r3-agent-label">
        <span style={{ background: color }}>
          {a.isLeader && '★ '}
          {a.name}
        </span>
      </Html>
      {bubble && (
        <Html position={[0, top + 0.45, 0]} center className="r3-bubble">
          {bubble.text}
        </Html>
      )}
    </group>
  )
}

export default function Room3D({ state }: { state: BoardState }) {
  const bubbleFor = (name: string) => {
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const m = state.messages[i]
      if (state.t - m.t > BUBBLE_MS) return null
      if (m.agent === name) return m
    }
    return null
  }
  return (
    <Canvas camera={{ position: [0, 7.8, 6.6], fov: 45 }} dpr={[1, 2]}>
      <color attach="background" args={['#eef1f5']} />
      <hemisphereLight args={['#ffffff', '#9aa3b2', 1.6]} />
      <directionalLight position={[4, 10, 6]} intensity={1.8} />
      <Floor />
      {state.chairs.map((c) => (
        <Chair key={c.id} c={c} />
      ))}
      {state.agents.map((a) => (
        <Agent key={a.name} a={a} t={state.t} bubble={bubbleFor(a.name)} />
      ))}
      <OrbitControls
        target={[0, 0, 0.4]}
        enablePan={false}
        minDistance={6}
        maxDistance={18}
        minPolarAngle={0.15}
        maxPolarAngle={1.25}
      />
    </Canvas>
  )
}

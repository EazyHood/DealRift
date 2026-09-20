import { useEffect, useRef } from 'react'
import * as THREE from 'three'

interface RadarCanvasProps {
  pulse: number
  enabled?: boolean
}

export function RadarCanvas({ pulse, enabled = true }: RadarCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const pulseRef = useRef(pulse)

  useEffect(() => {
    pulseRef.current = pulse
  }, [pulse])

  useEffect(() => {
    const host = hostRef.current
    if (!host || !enabled) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    } catch {
      // The decorative canvas must never prevent access to deals or local data.
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.domElement.setAttribute('aria-hidden', 'true')
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 140)
    camera.position.set(0, 9, 25)

    const group = new THREE.Group()
    scene.add(group)

    const ambient = new THREE.AmbientLight(0x9fb7ff, 0.8)
    const key = new THREE.PointLight(0x12f7d6, 26, 80)
    key.position.set(14, 12, 12)
    const edge = new THREE.PointLight(0xff3d6e, 20, 70)
    edge.position.set(-18, -4, 20)
    scene.add(ambient, key, edge)

    const ringMaterial = new THREE.MeshStandardMaterial({
      color: 0x12f7d6,
      emissive: 0x0b8f88,
      emissiveIntensity: 0.8,
      metalness: 0.4,
      roughness: 0.25,
      transparent: true,
      opacity: 0.46,
    })

    const hotMaterial = new THREE.MeshStandardMaterial({
      color: 0xff3d6e,
      emissive: 0xff1f5d,
      emissiveIntensity: 1.6,
      metalness: 0.25,
      roughness: 0.2,
    })

    const goldMaterial = new THREE.MeshStandardMaterial({
      color: 0xffc857,
      emissive: 0xc97320,
      emissiveIntensity: 0.75,
      metalness: 0.35,
      roughness: 0.25,
    })

    const ringGeometry = new THREE.TorusGeometry(7.5, 0.035, 12, 180)
    const rings = Array.from({ length: 5 }, (_, index) => {
      const ring = new THREE.Mesh(ringGeometry, ringMaterial.clone())
      ring.rotation.x = Math.PI / 2
      ring.scale.setScalar(0.45 + index * 0.22)
      ring.position.y = -1.4
      group.add(ring)
      return ring
    })

    const needle = new THREE.Mesh(
      new THREE.BoxGeometry(9.4, 0.035, 0.035),
      new THREE.MeshStandardMaterial({
        color: 0x61e294,
        emissive: 0x24b86f,
        emissiveIntensity: 1.2,
        transparent: true,
        opacity: 0.75,
      }),
    )
    needle.position.y = -1.4
    group.add(needle)

    const pointGeometry = new THREE.IcosahedronGeometry(0.16, 1)
    const points = Array.from({ length: 44 }, (_, index) => {
      const material = index % 5 === 0 ? hotMaterial : index % 3 === 0 ? goldMaterial : ringMaterial
      const point = new THREE.Mesh(pointGeometry, material.clone())
      const radius = 2.5 + Math.random() * 10
      const angle = Math.random() * Math.PI * 2
      point.position.set(Math.cos(angle) * radius, -1.2 + Math.random() * 4.7, Math.sin(angle) * radius)
      point.userData.speed = 0.001 + Math.random() * 0.002
      point.userData.angle = angle
      point.userData.radius = radius
      group.add(point)
      return point
    })

    const grid = new THREE.GridHelper(38, 34, 0x1bffe0, 0x20303a)
    grid.position.y = -1.45
    grid.material.opacity = 0.2
    grid.material.transparent = true
    group.add(grid)

    const resize = () => {
      const width = window.innerWidth
      const height = window.innerHeight
      renderer.setSize(width, height)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }

    window.addEventListener('resize', resize)

    let frameId = 0
    const startedAt = performance.now()
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const animate = () => {
      if (document.hidden) {
        frameId = requestAnimationFrame(animate)
        return
      }
      const elapsed = (performance.now() - startedAt) / 1000
      const pulseScale = 1 + Math.min(0.16, pulseRef.current / 900)
      group.rotation.y = Math.sin(elapsed * 0.08) * 0.22
      group.rotation.x = -0.24
      needle.rotation.y = elapsed * 1.2

      rings.forEach((ring, index) => {
        ring.rotation.z = elapsed * (0.12 + index * 0.02)
        ring.scale.setScalar((0.45 + index * 0.22) * (1 + Math.sin(elapsed * 1.4 + index) * 0.018) * pulseScale)
      })

      points.forEach((point) => {
        point.userData.angle += point.userData.speed
        point.position.x = Math.cos(point.userData.angle) * point.userData.radius
        point.position.z = Math.sin(point.userData.angle) * point.userData.radius
        point.rotation.x += 0.012
        point.rotation.y += 0.018
      })

      renderer.render(scene, camera)
      if (!reduceMotion) frameId = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      cancelAnimationFrame(frameId)
      window.removeEventListener('resize', resize)
      host.removeChild(renderer.domElement)
      group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return
        object.geometry.dispose()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.forEach((material) => material.dispose())
      })
      renderer.dispose()
    }
  }, [enabled])

  return <div ref={hostRef} className="radar-canvas" aria-hidden="true" />
}

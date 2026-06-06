import { createContext, useContext, useEffect, useRef, useState } from "react"

const RevealCtx = createContext(false)

// Used inside a <Reveal> to stagger child elements.
// Opacity-only so it works safely inside overflow:hidden containers.
export function RevealItem({ children, index = 0, style }) {
  const visible = useContext(RevealCtx)
  return (
    <div style={{
      opacity: visible ? 1 : 0,
      transition: `opacity 0.4s ease ${index * 70}ms`,
      ...style,
    }}>
      {children}
    </div>
  )
}

export default function Reveal({ children, delay = 0, style }) {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.12 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <RevealCtx.Provider value={visible}>
      <div
        ref={ref}
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(44px)",
          transition: `opacity 0.65s cubic-bezier(0.16,1,0.3,1) ${delay}ms, transform 0.65s cubic-bezier(0.16,1,0.3,1) ${delay}ms`,
          ...style,
        }}
      >
        {children}
      </div>
    </RevealCtx.Provider>
  )
}

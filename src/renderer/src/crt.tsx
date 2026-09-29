import { useEffect, useRef } from 'react'
import type { CoreStatus, LogEntry } from '@shared/types'
import { timeOf, useStore } from './store'

/* ЭЛТ-экран темы «Терминал»: по фону окна бежит журнал ядра, как код по
   монитору. Текст готовится на обычном canvas и уходит в текстуру, а шейдер
   раскладывает его в точечную матрицу, выгибает стекло, добавляет развёртку,
   свечение и глитчи. Эффект подсмотрен у unicorn.studio, но собран заново:
   их SDK тянет сцену из сети, а окну VPN-клиента в сеть ходить незачем. */

const LINE = 20 // высота строки текста, CSS px
const FONT = "700 12px 'Cascadia Mono', 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace"
const FPS = 30
const MAX_DPR = 1.5

/** Как экран ведёт себя в каждом состоянии ядра: яркость, строк в секунду, доля глитчей */
const MOOD: Record<CoreStatus, { bright: number; speed: number; glitch: number }> = {
  stopped: { bright: 0.42, speed: 0.8, glitch: 0.03 },
  starting: { bright: 0.9, speed: 11, glitch: 0.4 },
  running: { bright: 1, speed: 2.6, glitch: 0.06 },
  stopping: { bright: 0.6, speed: 6, glitch: 0.3 },
  error: { bright: 0.72, speed: 0.4, glitch: 0.24 }
}

/* Пока журнал пуст, экран листает этот «код» — отступы важнее смысла:
   именно они дают рваный правый край, по которому глаз узнаёт листинг */
const CODE = `// prism: сборка маршрутов для sing-box
export function buildRoute(s: Settings, nodes: Node[]): Route {
  const rules: Rule[] = []
  if (s.bypassPrivate) rules.push({ ip_is_private: true, outbound: 'direct' })
  if (s.blockQuic) rules.push({ network: 'udp', port: 443, action: 'reject' })
  for (const app of s.appRules) {
    rules.push({
      process_name: app.process,
      outbound: app.action === 'proxy' ? 'proxy' : app.action
    })
  }
  if (s.discordFix) {
    rules.push({ process_name: DISCORD, outbound: 'proxy' })
    rules.push({ domain_suffix: ['discord.gg', 'discord.media'], outbound: 'proxy' })
  }
  switch (s.routingMode) {
    case 'smart':
      rules.push({ rule_set: ['geosite-ru', 'geoip-ru'], outbound: 'direct' })
      return { rules, final: 'proxy', auto_detect_interface: true }
    case 'whitelist':
      return { rules, final: 'direct', auto_detect_interface: true }
    case 'direct':
      return { rules: [], final: 'direct' }
    default:
      return { rules, final: 'proxy', auto_detect_interface: true }
  }
}

// tun: весь трафик системы, включая udp
const inbound = {
  type: 'tun',
  address: ['172.19.0.1/30'],
  mtu: 9000,
  auto_route: true,
  strict_route: true,
  stack: 'mixed'
}

async function handshake(node: Node): Promise<number> {
  const t0 = performance.now()
  const sock = await dial(node.server, node.port, { tls: node.tls, utls: 'chrome' })
  await sock.write(REALITY_HELLO)
  const ok = await sock.read(64)
  sock.close()
  return ok ? Math.round(performance.now() - t0) : -1
}
`.split('\n')

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uText;  // резкий текст
uniform sampler2D uGlow;  // размытая копия — ореол вокруг символов
uniform vec2 uView;       // экран, CSS px
uniform float uTexH;      // высота текстуры: экран плюс строка запаса
uniform float uScroll;    // прокрутка внутри строки, px
uniform float uTime;
uniform float uBright;
uniform float uGlitch;
uniform float uPower;     // 0..1 — включение трубки
uniform float uMotion;    // 0 при «уменьшить движение»
uniform vec3 uTint;
uniform vec3 uBg;

const float CELL = 3.0;   // шаг точечной матрицы, CSS px
const float PI = 3.14159265;

float hash(float n) { return fract(sin(n) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// выпуклое стекло кинескопа
vec2 bend(vec2 uv) {
  uv = uv * 2.0 - 1.0;
  vec2 off = abs(uv.yx) / vec2(6.0, 4.2);
  uv += uv * off * off;
  return uv * 0.5 + 0.5;
}

// прокрутка двигает текст, а сетка точек стоит на месте — как у настоящей матрицы
float cover(sampler2D tex, vec2 px) {
  return texture2D(tex, vec2(px.x / uView.x, (px.y + uScroll) / uTexH)).r;
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);

  // включение: сначала яркая черта по центру, затем она раскрывается в кадр
  float open = mix(0.004, 1.0, pow(uPower, 2.4));
  float wide = clamp(uPower * 3.0, 0.02, 1.0);
  uv = (uv - 0.5) / vec2(wide, open) + 0.5;
  float flash = (1.0 - uPower) * 3.0;

  vec2 cv = bend(uv);
  vec2 edge = smoothstep(0.0, 0.006, cv) * smoothstep(0.0, 0.006, 1.0 - cv);
  float inside = edge.x * edge.y;

  // глитч: в случайный момент полоса экрана срывается вбок и расслаивается по цветам
  float slot = floor(uTime * 9.0);
  float hit = step(1.0 - uGlitch, hash(slot)) * uMotion;
  float y0 = hash(slot + 1.7);
  float band = hit * step(y0, cv.y) * step(cv.y, y0 + 0.015 + 0.09 * hash(slot + 4.1));

  vec2 px = cv * uView;
  px.x += band * (hash(slot + 7.3) - 0.5) * 80.0;
  float ca = 0.8 + uGlitch * 1.6 + band * 7.0;

  vec2 c = (floor(px / CELL) + 0.5) * CELL;
  float dotm = smoothstep(0.56, 0.18, length(fract(px / CELL) - 0.5));
  vec3 txt = vec3(
    cover(uText, c + vec2(ca, 0.0)),
    cover(uText, c),
    cover(uText, c - vec2(ca, 0.0))
  );
  vec3 glow = vec3(
    cover(uGlow, px + vec2(ca * 2.0, 0.0)),
    cover(uGlow, px),
    cover(uGlow, px - vec2(ca * 2.0, 0.0))
  );

  // мягкое пятно света в глубине трубки, медленно плывёт
  vec2 q = (cv - vec2(0.5 + 0.07 * sin(uTime * 0.13), 0.46 + 0.05 * cos(uTime * 0.1))) * vec2(1.2, 1.0);
  float haze = exp(-dot(q, q) * 3.0);

  vec3 col = uBg + uTint * haze * 0.16 * uBright;
  col += uTint * txt * dotm * 1.1 * uBright;
  col += uTint * glow * 0.5 * uBright;

  // развёртка — тёмная строка каждые три пикселя
  col *= 0.7 + 0.3 * pow(abs(sin(px.y * PI / 3.0)), 1.6);
  // полоса обновления кадра ползёт сверху вниз
  col += uTint * exp(-pow((cv.y - fract(uTime * 0.06)) * 9.0, 2.0)) * 0.035 * uMotion * uBright;
  // виньетка
  vec2 v = cv * (1.0 - cv);
  col *= pow(clamp(16.0 * v.x * v.y, 0.0, 1.0), 0.3);
  // зерно
  col += (hash2(floor(px) + fract(uTime) * 91.0) - 0.5) * 0.028 * uMotion;
  col *= 1.0 + flash;

  gl_FragColor = vec4(mix(uBg * 0.35, col, inside), 1.0);
}`

/** «#38bdf8» → [0..1]×3; всё непонятное — бледно-голубой фосфор */
function rgb(hex: string): [number, number, number] {
  const m = hex.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return [0.78, 0.84, 1]
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number]
}

function logLine(l: LogEntry): string {
  return `${timeOf(l.t)} ${l.level.toUpperCase().padEnd(5)} ${l.message.replace(/\s+/g, ' ')}`
}

function compile(gl: WebGLRenderingContext): WebGLProgram | null {
  const sh = (type: number, src: string): WebGLShader | null => {
    const s = gl.createShader(type)
    if (!s) return null
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('crt:', gl.getShaderInfoLog(s))
      return null
    }
    return s
  }
  const vs = sh(gl.VERTEX_SHADER, VERT)
  const fs = sh(gl.FRAGMENT_SHADER, FRAG)
  const p = gl.createProgram()
  if (!vs || !fs || !p) return null
  gl.attachShader(p, vs)
  gl.attachShader(p, fs)
  gl.linkProgram(p)
  return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null
}

export function CrtScreen(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = ref.current
    if (!host) return
    /* Холст создаём сами на каждый монтаж: после loseContext() старый холст
       навсегда отдаёт «потерянный» контекст, и повторный монтаж (StrictMode,
       смена темы туда-обратно) остался бы с чёрным экраном */
    const canvas = document.createElement('canvas')
    host.appendChild(canvas)
    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      powerPreference: 'low-power',
      preserveDrawingBuffer: false
    })
    // Без WebGL остаётся статичная развёртка из CSS — тема всё равно узнаётся
    const prog = gl && compile(gl)
    if (!gl || !prog) {
      canvas.remove()
      return
    }
    gl.useProgram(prog)

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(prog, 'aPos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

    const u = (n: string): WebGLUniformLocation | null => gl.getUniformLocation(prog, n)
    const U = {
      view: u('uView'), texH: u('uTexH'), scroll: u('uScroll'), time: u('uTime'), bright: u('uBright'),
      glitch: u('uGlitch'), power: u('uPower'), motion: u('uMotion'), tint: u('uTint'), bg: u('uBg')
    }

    const texture = (unit: number): WebGLTexture | null => {
      const t = gl.createTexture()
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, t)
      // размеры не степени двойки: без мип-карт и только с обрезкой по краю
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      return t
    }
    const texText = texture(0)
    const texGlow = texture(1)
    gl.uniform1i(u('uText'), 0)
    gl.uniform1i(u('uGlow'), 1)

    const text = document.createElement('canvas')
    const glow = document.createElement('canvas')
    const tctx = text.getContext('2d')!
    const gctx = glow.getContext('2d')!

    let W = 0
    let H = 0
    let rows: string[] = []
    let codeAt = Math.floor(Math.random() * CODE.length)
    // Тему включили при работающем VPN — экран сразу начинает с уже накопленного журнала
    const logs0 = useStore.getState().logs
    const pending = logs0.slice(-20).map(logLine)
    let lastLogId = logs0.at(-1)?.id ?? 0

    const nextLine = (): string => pending.shift() ?? CODE[codeAt++ % CODE.length]

    const paint = (): void => {
      tctx.fillStyle = '#000'
      tctx.fillRect(0, 0, text.width, text.height)
      tctx.font = FONT
      tctx.textBaseline = 'middle'
      const left = Math.round(W * 0.06)
      rows.forEach((r, i) => {
        // комментарии тусклее — так у листинга появляется ритм
        tctx.fillStyle = r.trimStart().startsWith('//') ? '#8a8a8a' : '#fff'
        tctx.fillText(r, left, i * LINE + LINE / 2)
      })
      gctx.clearRect(0, 0, glow.width, glow.height)
      gctx.filter = 'blur(2px)'
      gctx.drawImage(text, 0, 0, glow.width, glow.height)
      gctx.filter = 'none'

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, texText)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, text)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, texGlow)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, glow)
    }

    const ratio = (): number => Math.min(window.devicePixelRatio || 1, MAX_DPR)
    let dpr = ratio()

    const resize = (): void => {
      const r = host.getBoundingClientRect()
      W = Math.max(1, Math.round(r.width))
      H = Math.max(1, Math.round(r.height))
      dpr = ratio()
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
      gl.viewport(0, 0, canvas.width, canvas.height)

      const count = Math.ceil(H / LINE) + 1
      while (rows.length < count) rows.push(nextLine())
      rows = rows.slice(0, count)
      text.width = W
      text.height = count * LINE
      glow.width = Math.ceil(W / 4)
      glow.height = Math.ceil(text.height / 4)
      gl.uniform2f(U.view, W, H)
      gl.uniform1f(U.texH, text.height)
      paint()
    }

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    const cur = { ...MOOD.stopped }
    let status = useStore.getState().core.status
    let scroll = 0
    let power = reduce.matches ? 1 : 0
    let burst = 0
    let tint = rgb('#c8d4ff')
    let frame = 0
    let raf = 0
    let last = performance.now()
    const t0 = last

    const tick = (now: number): void => {
      raf = requestAnimationFrame(tick)
      const still = reduce.matches
      // 30 кадров хватает глазу, а видеокарте и батарее — вдвое легче
      if (now - last < (still ? 500 : 1000 / FPS) - 1) return
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const st = useStore.getState()

      if (st.core.status !== status) {
        // смена состояния — короткий срыв картинки, как при переключении канала
        if (st.core.status === 'running' || st.core.status === 'error') burst = 1
        status = st.core.status
      }
      const logs = st.logs
      if (logs.length && logs[logs.length - 1].id !== lastLogId) {
        for (const l of logs) if (l.id > lastLogId) pending.push(logLine(l))
        lastLogId = logs[logs.length - 1].id
        // журнал может хлынуть потоком — экрану хватит последних строк
        if (pending.length > 60) pending.splice(0, pending.length - 60)
      }
      // Акцент пользователь может сменить в любой момент, а окно — переехать на
      // монитор с другой плотностью пикселей. Размер в CSS при этом тот же, и
      // ResizeObserver молчит — поэтому оба проверяем сами, дважды в секунду.
      if (frame++ % 15 === 0) {
        tint = rgb(getComputedStyle(document.documentElement).getPropertyValue(status === 'error' ? '--err' : '--accent-1'))
        if (ratio() !== dpr) resize()
      }

      const goal = MOOD[status]
      const k = 1 - Math.exp(-dt * 3)
      cur.bright += (goal.bright - cur.bright) * k
      // пока в очереди есть свежий журнал, экран листает быстрее, чтобы не отставать
      const speed = goal.speed + Math.min(pending.length, 30) * 0.25
      cur.speed += (speed - cur.speed) * k
      cur.glitch += (goal.glitch - cur.glitch) * k
      burst = Math.max(0, burst - dt * 1.8)
      power = Math.min(1, power + dt * 1.6)

      if (!still) {
        scroll += cur.speed * dt
        if (scroll >= 1) {
          while (scroll >= 1) {
            scroll -= 1
            rows.shift()
            rows.push(nextLine())
          }
          paint()
        }
      }

      // фосфор светится почти белым, акцент лишь подкрашивает его; ошибку видно сразу
      const mix = status === 'error' ? 0.75 : 0.45
      const ph = tint.map((c) => c * mix + 1 - mix)
      gl.uniform1f(U.scroll, scroll * LINE)
      // при «уменьшить движение» замирает всё, включая пятно света и полосу кадра
      gl.uniform1f(U.time, still ? 0 : (now - t0) / 1000)
      gl.uniform1f(U.bright, cur.bright)
      gl.uniform1f(U.glitch, still ? 0 : Math.min(1, cur.glitch + burst * 0.8))
      gl.uniform1f(U.power, power)
      gl.uniform1f(U.motion, still ? 0 : 1)
      gl.uniform3f(U.tint, ph[0], ph[1], ph[2])
      gl.uniform3f(U.bg, 0.014, 0.024, 0.075)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(host)
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      // отдаём видеопамять сразу, а не когда сборщик мусора доберётся до холста
      gl.getExtension('WEBGL_lose_context')?.loseContext()
      canvas.remove()
    }
  }, [])

  return <div ref={ref} className="crt" aria-hidden />
}

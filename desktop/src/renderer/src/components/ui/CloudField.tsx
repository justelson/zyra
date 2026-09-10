import { useEffect, useRef } from 'react'

export type CloudFieldProps = {
    backgroundColor: string
    accentColor: string
    inkColor: string
    speed?: number
    maxFps?: number
    reducedMotion?: boolean
    className?: string
}

type Rgb = readonly [number, number, number]

const VERTEX_SHADER = `
attribute vec2 a_position;
void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`

// Adapted from ThreeUI's Cloud Field raw-WebGL composition:
// https://threeui.com/backgrounds/portal-field/cloud-field
// The shader anatomy is preserved (stars, migrating strata, horizon haze and
// staggered meteors), while its fixed violet palette is replaced by Zyra's
// semantic theme colors and its lifecycle is owned by React.
const FRAGMENT_SHADER = `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_pointer;
uniform vec3 u_background;
uniform vec3 u_accent;
uniform vec3 u_ink;
uniform float u_light_mode;

float hash(float value) {
    return fract(sin(value) * 43758.5453123);
}

float hash2(vec2 point) {
    return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(float value) {
    float whole = floor(value);
    float fraction = fract(value);
    fraction = fraction * fraction * (3.0 - 2.0 * fraction);
    return mix(hash(whole), hash(whole + 1.0), fraction);
}

float fbm(float value, float octaves) {
    float result = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for (int index = 0; index < 6; index += 1) {
        if (float(index) >= octaves) break;
        result += amplitude * noise(value * frequency);
        frequency *= 2.17;
        amplitude *= 0.48;
    }
    return result;
}

float stars(vec2 uv, float density) {
    vec2 cell = floor(uv * density);
    vec2 subCell = fract(uv * density);
    float seed = hash2(cell);
    float visible = step(0.975, seed);
    float size = 0.025 + seed * 0.045;
    vec2 point = vec2(hash2(cell + 100.0), hash2(cell + 200.0));
    float star = visible * smoothstep(size, 0.0, length(subCell - point));
    return star * (0.58 + 0.42 * sin(u_time * (1.0 + seed * 3.0) + seed * 6.28));
}

float meteor(vec2 uv, float time, float stream, float aspect) {
    float phase = time * mix(0.18, 0.13, stream * 0.5) + stream * 0.37;
    float cycle = fract(phase);
    float seed = floor(phase) + stream * 31.7;
    float first = hash(seed * 7.31);
    float second = hash(seed * 13.17);
    if (first > 0.75) return 0.0;
    vec2 start = vec2((0.08 + second * 0.72) * aspect, 0.76 + first * 0.2);
    vec2 direction = normalize(vec2(1.0, -0.62 - first * 0.24));
    vec2 position = start + direction * smoothstep(0.0, 0.7, cycle) * 0.5;
    vec2 delta = uv - position;
    float along = dot(delta, direction);
    float perpendicular = length(delta - direction * along);
    float trail = smoothstep(0.0, -0.12, along) * smoothstep(-0.18, -0.04, along);
    float shape = smoothstep(0.003, 0.0, perpendicular) + smoothstep(0.012, 0.0, perpendicular) * 0.3;
    float fade = smoothstep(0.0, 0.1, cycle) * smoothstep(0.8, 0.55, cycle);
    return shape * trail * fade;
}

vec3 strataColor(float depth) {
    float darkMix = mix(0.30, 0.09, depth);
    float lightMix = mix(0.13, 0.24, depth);
    return mix(u_background, u_accent, mix(darkMix, lightMix, u_light_mode));
}

void applyStratum(
    inout vec3 color,
    inout float starMask,
    vec2 uv,
    float aspect,
    float base,
    float scale,
    float drift,
    float seed,
    float amplitude,
    float pointerAmount,
    float depth
) {
    float sampleX = uv.x * aspect * scale + u_time * drift + u_pointer.x * pointerAmount;
    float profile = fbm(sampleX, 5.0) * amplitude
        + fbm(sampleX * 0.3 + seed, 3.0) * amplitude * 0.7;
    float top = base + profile + u_pointer.y * pointerAmount * 0.28;
    float body = smoothstep(top + 0.003, top - 0.001, uv.y);
    float edgeDistance = abs(uv.y - top);
    float rim = smoothstep(0.013, 0.0, edgeDistance);
    float ambient = smoothstep(0.045, 0.0, edgeDistance);
    vec3 layer = strataColor(depth);
    vec3 rimColor = mix(u_accent, u_ink, mix(0.12, 0.42, u_light_mode));
    color = mix(color, layer, body);
    color += rimColor * rim * mix(0.085, 0.032, depth) * mix(1.0, 0.6, u_light_mode);
    color += u_accent * ambient * 0.018 * (1.0 - depth);
    starMask *= 1.0 - body;
}

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    float aspect = u_resolution.x / u_resolution.y;

    vec3 skyTop = mix(u_background, u_accent, mix(0.055, 0.035, u_light_mode));
    vec3 skyMiddle = mix(u_background, u_accent, mix(0.12, 0.07, u_light_mode));
    vec3 skyBottom = mix(u_background, u_accent, mix(0.22, 0.11, u_light_mode));
    vec3 color = mix(skyBottom, skyMiddle, smoothstep(0.28, 0.62, uv.y));
    color = mix(color, skyTop, smoothstep(0.62, 1.0, uv.y));

    float horizon = 0.35;
    float horizonGlow = exp(-pow((uv.y - horizon) * 3.8, 2.0));
    float centerGlow = exp(-pow((uv.x - 0.5) * 1.55, 2.0))
        * exp(-pow((uv.y - horizon) * 4.0, 2.0));
    color += u_accent * horizonGlow * mix(0.16, 0.055, u_light_mode);
    color += mix(u_accent, u_ink, 0.28) * centerGlow * mix(0.08, 0.025, u_light_mode);

    vec2 starUv = uv * vec2(aspect, 1.0);
    float starField = stars(starUv, 60.0)
        + stars(starUv + 500.0, 100.0) * 0.7
        + stars(starUv + 900.0, 160.0) * 0.4;
    float starMask = 1.0;

    applyStratum(color, starMask, uv, aspect, 0.40, 1.6, 0.006, 17.0, 0.10, 0.010, 0.0);
    applyStratum(color, starMask, uv, aspect, 0.33, 2.0, 0.012, 34.0, 0.13, 0.020, 0.25);
    applyStratum(color, starMask, uv, aspect, 0.26, 2.6, 0.020, 51.0, 0.16, 0.034, 0.50);
    applyStratum(color, starMask, uv, aspect, 0.18, 3.2, 0.030, 68.0, 0.14, 0.050, 0.75);
    applyStratum(color, starMask, uv, aspect, 0.09, 4.0, 0.044, 85.0, 0.11, 0.070, 1.0);

    vec3 light = mix(u_ink, u_accent, 0.25);
    color += light * starField * starMask * mix(0.52, 0.13, u_light_mode);
    color += light * (meteor(starUv, u_time, 0.0, aspect)
        + meteor(starUv, u_time, 1.0, aspect) * 0.72
        + meteor(starUv, u_time, 2.0, aspect) * 0.54) * starMask * mix(0.82, 0.18, u_light_mode);

    float vignette = 1.0 - mix(0.28, 0.08, u_light_mode)
        * pow(length((uv - 0.5) * vec2(1.1, 1.6)), 2.0);
    color *= vignette;
    color += u_accent * exp(-pow((uv.y - 0.33) * 5.0, 2.0)) * mix(0.035, 0.012, u_light_mode);
    gl_FragColor = vec4(color, 1.0);
}
`

function parseCssColor(value: string, fallback: string): Rgb {
    if (typeof document === 'undefined') return [0, 0, 0]
    const context = document.createElement('canvas').getContext('2d')
    if (!context) return [0, 0, 0]
    context.fillStyle = fallback
    context.fillStyle = value || fallback
    const normalized = context.fillStyle
    const hex = /^#([\da-f]{6})(?:[\da-f]{2})?$/i.exec(normalized)
    if (hex) {
        const packed = Number.parseInt(hex[1], 16)
        return [((packed >> 16) & 255) / 255, ((packed >> 8) & 255) / 255, (packed & 255) / 255]
    }
    const shortHex = /^#([\da-f])([\da-f])([\da-f])$/i.exec(normalized)
    if (shortHex) return shortHex.slice(1).map((part) => Number.parseInt(`${part}${part}`, 16) / 255) as unknown as Rgb
    const rgb = /^rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)/i.exec(normalized)
    return rgb
        ? [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255]
        : parseCssColor(fallback === '#000000' ? '#010101' : '#000000', '#000000')
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
    const shader = gl.createShader(type)
    if (!shader) return null
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
    gl.deleteShader(shader)
    return null
}

export default function CloudField({
    backgroundColor,
    accentColor,
    inkColor,
    speed = 1,
    maxFps = 24,
    reducedMotion = false,
    className
}: CloudFieldProps) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const gl = canvas.getContext('webgl', {
            alpha: false,
            antialias: false,
            depth: false,
            stencil: false,
            powerPreference: 'low-power'
        })
        if (!gl) return

        const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
        const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
        const program = gl.createProgram()
        if (!vertexShader || !fragmentShader || !program) {
            if (vertexShader) gl.deleteShader(vertexShader)
            if (fragmentShader) gl.deleteShader(fragmentShader)
            if (program) gl.deleteProgram(program)
            return
        }
        gl.attachShader(program, vertexShader)
        gl.attachShader(program, fragmentShader)
        gl.linkProgram(program)
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            gl.deleteProgram(program)
            gl.deleteShader(vertexShader)
            gl.deleteShader(fragmentShader)
            return
        }
        gl.useProgram(program)

        const buffer = gl.createBuffer()
        if (!buffer) {
            gl.deleteProgram(program)
            gl.deleteShader(vertexShader)
            gl.deleteShader(fragmentShader)
            return
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
        const position = gl.getAttribLocation(program, 'a_position')
        gl.enableVertexAttribArray(position)
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

        const resolution = gl.getUniformLocation(program, 'u_resolution')
        const time = gl.getUniformLocation(program, 'u_time')
        const pointer = gl.getUniformLocation(program, 'u_pointer')
        const background = gl.getUniformLocation(program, 'u_background')
        const accent = gl.getUniformLocation(program, 'u_accent')
        const ink = gl.getUniformLocation(program, 'u_ink')
        const lightMode = gl.getUniformLocation(program, 'u_light_mode')
        const backgroundRgb = parseCssColor(backgroundColor, '#0c121f')
        const accentRgb = parseCssColor(accentColor, '#7c3aed')
        const inkRgb = parseCssColor(inkColor, '#f0f4f8')
        const backgroundLuminance = backgroundRgb[0] * 0.2126 + backgroundRgb[1] * 0.7152 + backgroundRgb[2] * 0.0722
        gl.uniform3fv(background, backgroundRgb)
        gl.uniform3fv(accent, accentRgb)
        gl.uniform3fv(ink, inkRgb)
        gl.uniform1f(lightMode, backgroundLuminance > 0.54 ? 1 : 0)

        let pointerX = 0
        let pointerY = 0
        let smoothPointerX = 0
        let smoothPointerY = 0
        let animationFrame = 0
        let lastFrame = 0
        const startedAt = performance.now()
        const frameInterval = 1000 / Math.max(1, maxFps)

        const resize = () => {
            const bounds = canvas.getBoundingClientRect()
            const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5)
            const width = Math.max(1, Math.round(bounds.width * pixelRatio))
            const height = Math.max(1, Math.round(bounds.height * pixelRatio))
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width
                canvas.height = height
                gl.viewport(0, 0, width, height)
            }
        }
        const handlePointerMove = (event: PointerEvent) => {
            pointerX = event.clientX / Math.max(1, window.innerWidth) - 0.5
            pointerY = 0.5 - event.clientY / Math.max(1, window.innerHeight)
        }
        const draw = (now: number) => {
            resize()
            smoothPointerX += (pointerX - smoothPointerX) * 0.04
            smoothPointerY += (pointerY - smoothPointerY) * 0.04
            gl.uniform2f(resolution, canvas.width, canvas.height)
            gl.uniform1f(time, reducedMotion ? 0 : ((now - startedAt) / 1000) * speed)
            gl.uniform2f(pointer, smoothPointerX, smoothPointerY)
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        }
        const frame = (now: number) => {
            animationFrame = window.requestAnimationFrame(frame)
            if (document.hidden || now - lastFrame < frameInterval) return
            lastFrame = now
            draw(now)
        }

        const resizeObserver = new ResizeObserver(() => draw(performance.now()))
        resizeObserver.observe(canvas)
        window.addEventListener('pointermove', handlePointerMove, { passive: true })
        draw(startedAt)
        if (!reducedMotion) animationFrame = window.requestAnimationFrame(frame)

        return () => {
            window.cancelAnimationFrame(animationFrame)
            window.removeEventListener('pointermove', handlePointerMove)
            resizeObserver.disconnect()
            gl.deleteBuffer(buffer)
            gl.deleteProgram(program)
            gl.deleteShader(vertexShader)
            gl.deleteShader(fragmentShader)
        }
    }, [accentColor, backgroundColor, inkColor, maxFps, reducedMotion, speed])

    return <canvas ref={canvasRef} className={className} style={{ background: backgroundColor }} />
}

import SwiftUI

// Native SwiftUI port of walkup-songs/src/components/LogoMark.jsx (64x64 viewBox)
// featuring the dark speaker cabinet, pulsing mint sound waves, and the Twemoji
// baseball subwoofer cone.
struct DugoutLogoMark: View {
    var size: CGFloat = 40
    var animated: Bool = true

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var shouldAnimate: Bool {
        animated && !reduceMotion
    }

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: !shouldAnimate)) { timeline in
            let phase = shouldAnimate
                ? timeline.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.1) / 1.1
                : 0.0
            let cone = coneTransform(at: phase)
            let wave1 = waveStyle(at: phase)
            let wave2 = waveStyle(at: (phase + 1.0 - (0.14 / 1.1)).truncatingRemainder(dividingBy: 1.0))

            Canvas { context, canvasSize in
                let side = min(canvasSize.width, canvasSize.height)
                let u = side / 64.0
                let offsetX = (canvasSize.width - side) * 0.5
                let offsetY = (canvasSize.height - side) * 0.5

                func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
                    CGPoint(x: offsetX + x * u, y: offsetY + y * u)
                }

                func circleRect(cx: CGFloat, cy: CGFloat, r: CGFloat) -> CGRect {
                    CGRect(
                        x: offsetX + (cx - r) * u,
                        y: offsetY + (cy - r) * u,
                        width: 2 * r * u,
                        height: 2 * r * u
                    )
                }

                // 1. Speaker cabinet
                let cabinetRect = CGRect(x: offsetX + 2 * u, y: offsetY + 2 * u, width: 60 * u, height: 60 * u)
                context.fill(
                    Path(roundedRect: cabinetRect, cornerRadius: 14 * u),
                    with: .color(DugoutColors.cabinet)
                )
                let innerBorderRect = CGRect(x: offsetX + 3 * u, y: offsetY + 3 * u, width: 58 * u, height: 58 * u)
                context.stroke(
                    Path(roundedRect: innerBorderRect, cornerRadius: 13 * u),
                    with: .color(.white.opacity(0.12)),
                    lineWidth: max(0.5, 1 * u)
                )

                // Tweeter & LEDs
                context.fill(Path(ellipseIn: circleRect(cx: 32, cy: 9.8, r: 3.4)), with: .color(DugoutColors.slate800))
                context.fill(Path(ellipseIn: circleRect(cx: 32, cy: 9.8, r: 1.4)), with: .color(DugoutColors.slate500))
                context.fill(Path(ellipseIn: circleRect(cx: 57, cy: 9.8, r: 1.6)), with: .color(DugoutColors.ledGreen))
                context.fill(Path(ellipseIn: circleRect(cx: 7, cy: 9.8, r: 1.6)), with: .color(DugoutColors.slate700))

                // Rubber feet
                context.fill(
                    Path(roundedRect: CGRect(x: offsetX + 10 * u, y: offsetY + 56.5 * u, width: 6 * u, height: 3 * u), cornerRadius: 1.5 * u),
                    with: .color(DugoutColors.slate800)
                )
                context.fill(
                    Path(roundedRect: CGRect(x: offsetX + 48 * u, y: offsetY + 56.5 * u, width: 6 * u, height: 3 * u), cornerRadius: 1.5 * u),
                    with: .color(DugoutColors.slate800)
                )

                // 2. Subwoofer basket & ribs
                context.fill(Path(ellipseIn: circleRect(cx: 32, cy: 33.5, r: 20)), with: .color(DugoutColors.slate800))
                context.stroke(Path(ellipseIn: circleRect(cx: 32, cy: 33.5, r: 20)), with: .color(DugoutColors.slate200.opacity(0.16)), lineWidth: 1 * u)
                context.stroke(Path(ellipseIn: circleRect(cx: 32, cy: 33.5, r: 17.6)), with: .color(DugoutColors.cabinet), lineWidth: 1.1 * u)
                context.stroke(Path(ellipseIn: circleRect(cx: 32, cy: 33.5, r: 15.4)), with: .color(DugoutColors.cabinet), lineWidth: 1.4 * u)

                for screw in [(13.6, 26.0), (13.6, 41.0), (50.4, 26.0), (50.4, 41.0)] {
                    context.fill(Path(ellipseIn: circleRect(cx: screw.0, cy: screw.1, r: 1.2)), with: .color(DugoutColors.slate600))
                }

                // 3. Moving cone (baseball subwoofer)
                context.drawLayer { coneCtx in
                    let pivot = pt(32, 33.5)
                    coneCtx.translateBy(x: pivot.x, y: pivot.y + cone.dy * u)
                    coneCtx.scaleBy(x: cone.sx, y: cone.sy)
                    coneCtx.translateBy(x: -pivot.x, y: -pivot.y)

                    coneCtx.fill(Path(ellipseIn: circleRect(cx: 32, cy: 33.5, r: 14)), with: .color(DugoutColors.surround))
                    coneCtx.stroke(Path(ellipseIn: circleRect(cx: 32, cy: 33.5, r: 14)), with: .color(.white.opacity(0.14)), lineWidth: 1 * u)

                    let ballScale = (2.0 / 3.0) * u
                    var ballTransform = CGAffineTransform(translationX: offsetX + 20 * u, y: offsetY + 21.5 * u)
                    ballTransform = ballTransform.scaledBy(x: ballScale, y: ballScale)

                    coneCtx.fill(Path(ellipseIn: circleRect(cx: 32, cy: 33.5, r: 12)), with: .color(DugoutColors.ballBase))
                    coneCtx.fill(DugoutBaseballPaths.seams.applying(ballTransform), with: .color(DugoutColors.ballShade))
                    coneCtx.fill(DugoutBaseballPaths.stitches.applying(ballTransform), with: .color(DugoutColors.stitchRed))
                }

                // 4. Sound waves
                var innerLeft = Path()
                innerLeft.move(to: pt(8, 29))
                innerLeft.addQuadCurve(to: pt(8, 38), control: pt(5.2, 33.5))
                var innerRight = Path()
                innerRight.move(to: pt(56, 29))
                innerRight.addQuadCurve(to: pt(56, 38), control: pt(58.8, 33.5))

                var outerLeft = Path()
                outerLeft.move(to: pt(5.4, 26.5))
                outerLeft.addQuadCurve(to: pt(5.4, 40.5), control: pt(1.6, 33.5))
                var outerRight = Path()
                outerRight.move(to: pt(58.6, 26.5))
                outerRight.addQuadCurve(to: pt(58.6, 40.5), control: pt(62.4, 33.5))

                let waveStroke = StrokeStyle(lineWidth: 2 * u, lineCap: .round)
                drawWave(innerLeft, center: pt(6.6, 33.5), scale: wave1.scale, opacity: wave1.opacity, in: &context, style: waveStroke)
                drawWave(innerRight, center: pt(57.4, 33.5), scale: wave1.scale, opacity: wave1.opacity, in: &context, style: waveStroke)
                drawWave(outerLeft, center: pt(3.5, 33.5), scale: wave2.scale, opacity: wave2.opacity * 0.6, in: &context, style: waveStroke)
                drawWave(outerRight, center: pt(60.5, 33.5), scale: wave2.scale, opacity: wave2.opacity * 0.6, in: &context, style: waveStroke)
            }
        }
        .frame(width: size, height: size)
        .accessibilityLabel("Dugout DJ")
    }

    private func drawWave(_ path: Path, center: CGPoint, scale: CGFloat, opacity: Double, in context: inout GraphicsContext, style: StrokeStyle) {
        var t = CGAffineTransform(translationX: center.x, y: center.y)
        t = t.scaledBy(x: scale, y: scale)
        t = t.translatedBy(x: -center.x, y: -center.y)
        context.stroke(path.applying(t), with: .color(DugoutColors.waveMint.opacity(opacity)), style: style)
    }

    private func coneTransform(at p: Double) -> (dy: CGFloat, sx: CGFloat, sy: CGFloat) {
        if !shouldAnimate { return (0, 1, 1) }
        // Mirrors CSS keyframe curve: two bass hits at 9% and 42% of the 1.1s loop.
        switch p {
        case 0..<0.09:
            let t = p / 0.09
            return (lerp(0, -1.6, t), lerp(1, 1.025, t), lerp(1, 0.97, t))
        case 0.09..<0.20:
            let t = (p - 0.09) / 0.11
            return (lerp(-1.6, 0.4, t), lerp(1.025, 1, t), lerp(0.97, 1, t))
        case 0.20..<0.33:
            let t = (p - 0.20) / 0.13
            return (lerp(0.4, 0, t), 1, 1)
        case 0.33..<0.42:
            let t = (p - 0.33) / 0.09
            return (lerp(0, -1.1, t), lerp(1, 1.015, t), lerp(1, 0.985, t))
        case 0.42..<0.52:
            let t = (p - 0.42) / 0.10
            return (lerp(-1.1, 0.2, t), lerp(1.015, 1, t), lerp(0.985, 1, t))
        case 0.52..<0.65:
            let t = (p - 0.52) / 0.13
            return (lerp(0.2, 0, t), 1, 1)
        default:
            return (0, 1, 1)
        }
    }

    private func waveStyle(at p: Double) -> (opacity: Double, scale: CGFloat) {
        if !shouldAnimate { return (1.0, 1.0) }
        switch p {
        case 0..<0.12:
            let t = p / 0.12
            return (Double(lerp(0.25, 1.0, t)), lerp(0.92, 1.0, t))
        case 0.12..<0.40:
            let t = (p - 0.12) / 0.28
            return (Double(lerp(1.0, 0.55, t)), lerp(1.0, 0.98, t))
        case 0.40..<0.65:
            let t = (p - 0.40) / 0.25
            return (Double(lerp(0.55, 0.25, t)), lerp(0.98, 0.92, t))
        default:
            return (0.25, 0.92)
        }
    }

    private func lerp(_ a: CGFloat, _ b: CGFloat, _ t: Double) -> CGFloat {
        a + (b - a) * CGFloat(t)
    }
}

struct DugoutBrandBackground: View {
    var body: some View {
        ZStack {
            DugoutColors.cabinet

            RadialGradient(
                colors: [Color(red: 22/255, green: 163/255, blue: 74/255).opacity(0.22), .clear],
                center: UnitPoint(x: 0.85, y: 0.05),
                startRadius: 10,
                endRadius: 420
            )

            RadialGradient(
                colors: [Color(red: 37/255, green: 99/255, blue: 235/255).opacity(0.16), .clear],
                center: UnitPoint(x: 0.05, y: 0.30),
                startRadius: 10,
                endRadius: 380
            )
        }
        .ignoresSafeArea()
    }
}

enum DugoutColors {
    static let cabinet = Color(red: 11/255, green: 18/255, blue: 32/255)      // #0b1220
    static let surround = Color(red: 15/255, green: 23/255, blue: 42/255)     // #0f172a
    static let slate800 = Color(red: 30/255, green: 41/255, blue: 59/255)     // #1e293b
    static let slate700 = Color(red: 51/255, green: 65/255, blue: 85/255)     // #334155
    static let slate600 = Color(red: 71/255, green: 85/255, blue: 105/255)    // #475569
    static let slate500 = Color(red: 100/255, green: 116/255, blue: 139/255)  // #64748b
    static let slate200 = Color(red: 226/255, green: 232/255, blue: 240/255)  // #e2e8f0
    static let ledGreen = Color(red: 34/255, green: 197/255, blue: 94/255)    // #22c55e
    static let waveMint = Color(red: 134/255, green: 239/255, blue: 172/255)  // #86efac
    static let ballBase = Color(red: 225/255, green: 232/255, blue: 237/255)  // #E1E8ED
    static let ballShade = Color(red: 179/255, green: 190/255, blue: 196/255) // #B3BEC4
    static let stitchRed = Color(red: 221/255, green: 46/255, blue: 68/255)   // #DD2E44
    static let primaryBlue = Color(red: 37/255, green: 99/255, blue: 235/255) // #2563eb
}

private enum DugoutBaseballPaths {
    static let seams = SVGPathParser.parse(
        "M31.802 29.546C28.792 28.221 27 24.048 27 18c0-6.048 1.792-10.221 4.802-11.546-.445-.531-.926-1.028-1.428-1.504C27.406 6.605 25 10.578 25 18c0 7.421 2.406 11.395 5.374 13.05.502-.477.984-.973 1.428-1.504zM11 18c0-7.421-2.406-11.395-5.374-13.049-.502.476-.984.972-1.428 1.503C7.208 7.78 9 11.952 9 18c0 6.048-1.792 10.22-4.802 11.546.445.531.926 1.027 1.428 1.504C8.593 29.395 11 25.421 11 18z"
    )

    static let stitches = SVGPathParser.parse(
        "M5.092 10.164c-.237 0-.457-.02-.651-.056-.543-.102-.9-.624-.799-1.167.102-.543.625-.902 1.167-.799.43.077 2.691.006 3.148-2.276.108-.541.632-.892 1.177-.784.542.108.893.635.784 1.177-.583 2.912-3.139 3.905-4.826 3.905zm1.7 3.961c-.53 0-.952-.323-.978-.859-.026-.551.4-.911.952-.937 0 0 2.564-.035 3.869-2.294.275-.478.886-.63 1.365-.352.478.276.642.894.365 1.373-1.851 3.206-5.557 3.069-5.573 3.069zM9 19.282c-.734 0-1.414-.135-1.928-.378-.499-.236-.712-.833-.476-1.332.237-.5.834-.711 1.332-.476.83.393 2.926.239 3.73-1.012.299-.465.917-.6 1.382-.301.465.299.599.918.301 1.382-.964 1.501-2.776 2.117-4.341 2.117zm1.161 5.525c-1.554 0-2.995-.699-3.926-1.476-.424-.354-.481-.984-.128-1.409.354-.425.984-.48 1.408-.128.194.163 1.952 1.566 3.782.785.507-.215 1.095.021 1.311.53.216.509-.021 1.096-.53 1.312-.639.271-1.288.386-1.917.386zM9.75 30h-.028c-2.504 0-4.679-1.57-5.534-3.108-.269-.482-.094-1.044.388-1.312.483-.269 1.092-.07 1.36.412.484.871 1.996 2.134 3.841 2.185.552.016.987.388.972.939-.015.542-.459.884-.999.884zm17.438.188c-.066 0-.131-.006-.197-.02-.541-.108-.893-.635-.784-1.177.664-3.322 3.894-4.15 5.478-3.849.543.102.9.624.798 1.167-.101.542-.617.903-1.167.798-.425-.08-2.69-.007-3.147 2.276-.096.476-.514.805-.981.805zm-2.564-4.5c-.17 0-.342-.043-.499-.134-.479-.276-.643-.889-.366-1.366 1.852-3.206 3.984-3.304 5.394-3.369l.111-.005c.539-.033 1.021.399 1.047.951.026.552-.399 1.021-.951 1.047l-.115.005c-1.204.056-2.449.112-3.754 2.371-.185.321-.521.5-.867.5zm-1-6.063c-.186 0-.372-.051-.54-.159-.464-.298-.599-.917-.3-1.381 1.415-2.203 4.656-2.501 6.268-1.738.499.236.713.833.476 1.332-.235.5-.834.712-1.331.476-.829-.393-2.926-.239-3.732 1.012-.19.296-.512.458-.841.458zm5.625-5.937c-.226 0-.452-.076-.64-.232-.194-.162-1.952-1.559-3.781-.785-.509.215-1.095-.021-1.312-.53-.216-.508.021-1.096.53-1.311 2.219-.942 4.535-.001 5.844 1.09.424.353.482.984.128 1.408-.198.237-.482.36-.769.36zm1.814-3.938c-.352 0-.692-.186-.875-.514-.484-.872-1.996-2.123-3.841-2.174-.553-.015-.987-.506-.973-1.059.017-.542.461-1.003 1-1.003h.028c2.505 0 4.68 1.694 5.534 3.232.269.483.095 1.108-.389 1.376-.152.086-.319.142-.484.142z"
    )
}

private enum SVGPathParser {
    private enum Token {
        case command(Character)
        case number(CGFloat)
    }

    static func parse(_ d: String) -> Path {
        let tokens = tokenize(d)
        var path = Path()
        var index = 0
        var current = CGPoint.zero
        var subpathStart = CGPoint.zero
        var activeCmd: Character = "M"

        func hasNumber() -> Bool {
            if index < tokens.count, case .number = tokens[index] { return true }
            return false
        }

        func nextNumber() -> CGFloat {
            if index < tokens.count, case .number(let n) = tokens[index] {
                index += 1
                return n
            }
            return 0
        }

        while index < tokens.count {
            if case .command(let cmd) = tokens[index] {
                activeCmd = cmd
                index += 1
                if activeCmd == "z" || activeCmd == "Z" {
                    path.closeSubpath()
                    current = subpathStart
                    continue
                }
            }

            if !hasNumber() { continue }

            switch activeCmd {
            case "M":
                let p = CGPoint(x: nextNumber(), y: nextNumber())
                path.move(to: p)
                current = p
                subpathStart = p
                activeCmd = "L"
            case "m":
                let p = CGPoint(x: current.x + nextNumber(), y: current.y + nextNumber())
                path.move(to: p)
                current = p
                subpathStart = p
                activeCmd = "l"
            case "L":
                let p = CGPoint(x: nextNumber(), y: nextNumber())
                path.addLine(to: p)
                current = p
            case "l":
                let p = CGPoint(x: current.x + nextNumber(), y: current.y + nextNumber())
                path.addLine(to: p)
                current = p
            case "H":
                let p = CGPoint(x: nextNumber(), y: current.y)
                path.addLine(to: p)
                current = p
            case "h":
                let p = CGPoint(x: current.x + nextNumber(), y: current.y)
                path.addLine(to: p)
                current = p
            case "V":
                let p = CGPoint(x: current.x, y: nextNumber())
                path.addLine(to: p)
                current = p
            case "v":
                let p = CGPoint(x: current.x, y: current.y + nextNumber())
                path.addLine(to: p)
                current = p
            case "C":
                let c1 = CGPoint(x: nextNumber(), y: nextNumber())
                let c2 = CGPoint(x: nextNumber(), y: nextNumber())
                let end = CGPoint(x: nextNumber(), y: nextNumber())
                path.addCurve(to: end, control1: c1, control2: c2)
                current = end
            case "c":
                let c1 = CGPoint(x: current.x + nextNumber(), y: current.y + nextNumber())
                let c2 = CGPoint(x: current.x + nextNumber(), y: current.y + nextNumber())
                let end = CGPoint(x: current.x + nextNumber(), y: current.y + nextNumber())
                path.addCurve(to: end, control1: c1, control2: c2)
                current = end
            default:
                index += 1
            }
        }
        return path
    }

    private static func tokenize(_ d: String) -> [Token] {
        var tokens: [Token] = []
        let chars = Array(d)
        var i = 0

        while i < chars.count {
            let ch = chars[i]
            if ch.isWhitespace || ch == "," {
                i += 1
                continue
            }
            if ch.isLetter {
                tokens.append(.command(ch))
                i += 1
                continue
            }
            if ch == "-" || ch == "+" || ch == "." || ch.isNumber {
                let start = i
                if ch == "-" || ch == "+" || ch == "." { i += 1 }
                var seenDot = (ch == ".")
                while i < chars.count {
                    let c = chars[i]
                    if c.isNumber {
                        i += 1
                    } else if c == "." && !seenDot {
                        seenDot = true
                        i += 1
                    } else {
                        break
                    }
                }
                if i == start { i += 1 }
                if let val = Double(String(chars[start..<i])) {
                    tokens.append(.number(CGFloat(val)))
                }
                continue
            }
            i += 1
        }
        return tokens
    }
}

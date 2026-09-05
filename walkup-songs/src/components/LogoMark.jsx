// Dugout DJ logo mark (v4): a speaker whose subwoofer cone is the emoji
// baseball (⚾ Twemoji artwork, CC-BY 4.0). The ball drives like a sub on a
// track — it pulses with a small shake so the speaker looks like it's
// bumping. Motion is disabled for users who prefer reduced motion.
import './LogoMark.css';

export default function LogoMark({ size = 40, animated = true }) {
  return (
    <svg
      className={`logo-mark${animated ? ' is-animated' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Dugout DJ"
    >
      {/* --- Speaker cabinet (fixed) --- */}
      <rect x="2" y="2" width="60" height="60" rx="14" fill="#0b1220" />
      <rect
        x="3" y="3" width="58" height="58" rx="13"
        fill="none" stroke="#ffffff" strokeOpacity="0.12" strokeWidth="1"
      />
      {/* Tweeter above the driver */}
      <circle cx="32" cy="9.8" r="3.4" fill="#1e293b" />
      <circle cx="32" cy="9.8" r="1.4" fill="#64748b" />
      {/* Power LED */}
      <circle cx="57" cy="9.8" r="1.6" fill="#22c55e" />
      <circle cx="7" cy="9.8" r="1.6" fill="#334155" />

      {/* Rubber feet */}
      <rect x="10" y="56.5" width="6" height="3" rx="1.5" fill="#1e293b" />
      <rect x="48" y="56.5" width="6" height="3" rx="1.5" fill="#1e293b" />

      {/* --- Subwoofer basket (fixed ring the cone moves against) --- */}
      <circle cx="32" cy="33.5" r="20" fill="#1e293b" />
      <circle cx="32" cy="33.5" r="20" fill="none" stroke="#e2e8f0" strokeOpacity="0.16" strokeWidth="1" />
      {/* Basket ribs */}
      <g stroke="#0b1220" strokeWidth="1.1">
        <circle cx="32" cy="33.5" r="17.6" fill="none" />
        <circle cx="32" cy="33.5" r="15.4" fill="none" strokeWidth="1.4" />
      </g>
      {/* Rim screws */}
      <g fill="#475569">
        <circle cx="13.6" cy="26" r="1.2" />
        <circle cx="13.6" cy="41" r="1.2" />
        <circle cx="50.4" cy="26" r="1.2" />
        <circle cx="50.4" cy="41" r="1.2" />
      </g>

      {/* --- Moving cone: the baseball, pumping like a sub driver --- */}
      <g className="logo-mark-cone">
        {/* Cone surround follows the ball so the excursion reads */}
        <circle cx="32" cy="33.5" r="14" fill="#0f172a" />
        <circle cx="32" cy="33.5" r="14" fill="none" stroke="#ffffff" strokeOpacity="0.14" strokeWidth="1" />
        {/* Baseball cone — the official emoji ⚾ artwork (Twemoji, CC-BY 4.0,
            twitter/twemoji). Embedded at its native 36×36 coordinates and
            scaled so it sits exactly where the old ball did (center 32,33.5,
            radius 12). */}
        <g transform="translate(20 21.5) scale(0.6667)">
          <circle fill="#E1E8ED" cx="18" cy="18" r="18" />
          <path
            fill="#B3BEC4"
            d="M31.802 29.546C28.792 28.221 27 24.048 27 18c0-6.048 1.792-10.221 4.802-11.546-.445-.531-.926-1.028-1.428-1.504C27.406 6.605 25 10.578 25 18c0 7.421 2.406 11.395 5.374 13.05.502-.477.984-.973 1.428-1.504zM11 18c0-7.421-2.406-11.395-5.374-13.049-.502.476-.984.972-1.428 1.503C7.208 7.78 9 11.952 9 18c0 6.048-1.792 10.22-4.802 11.546.445.531.926 1.027 1.428 1.504C8.593 29.395 11 25.421 11 18z"
          />
          <path
            fill="#DD2E44"
            d="M5.092 10.164c-.237 0-.457-.02-.651-.056-.543-.102-.9-.624-.799-1.167.102-.543.625-.902 1.167-.799.43.077 2.691.006 3.148-2.276.108-.541.632-.892 1.177-.784.542.108.893.635.784 1.177-.583 2.912-3.139 3.905-4.826 3.905zm1.7 3.961c-.53 0-.952-.323-.978-.859-.026-.551.4-.911.952-.937 0 0 2.564-.035 3.869-2.294.275-.478.886-.63 1.365-.352.478.276.642.894.365 1.373-1.851 3.206-5.557 3.069-5.573 3.069zM9 19.282c-.734 0-1.414-.135-1.928-.378-.499-.236-.712-.833-.476-1.332.237-.5.834-.711 1.332-.476.83.393 2.926.239 3.73-1.012.299-.465.917-.6 1.382-.301.465.299.599.918.301 1.382-.964 1.501-2.776 2.117-4.341 2.117zm1.161 5.525c-1.554 0-2.995-.699-3.926-1.476-.424-.354-.481-.984-.128-1.409.354-.425.984-.48 1.408-.128.194.163 1.952 1.566 3.782.785.507-.215 1.095.021 1.311.53.216.509-.021 1.096-.53 1.312-.639.271-1.288.386-1.917.386zM9.75 30h-.028c-2.504 0-4.679-1.57-5.534-3.108-.269-.482-.094-1.044.388-1.312.483-.269 1.092-.07 1.36.412.484.871 1.996 2.134 3.841 2.185.552.016.987.388.972.939-.015.542-.459.884-.999.884zm17.438.188c-.066 0-.131-.006-.197-.02-.541-.108-.893-.635-.784-1.177.664-3.322 3.894-4.15 5.478-3.849.543.102.9.624.798 1.167-.101.542-.617.903-1.167.798-.425-.08-2.69-.007-3.147 2.276-.096.476-.514.805-.981.805zm-2.564-4.5c-.17 0-.342-.043-.499-.134-.479-.276-.643-.889-.366-1.366 1.852-3.206 3.984-3.304 5.394-3.369l.111-.005c.539-.033 1.021.399 1.047.951.026.552-.399 1.021-.951 1.047l-.115.005c-1.204.056-2.449.112-3.754 2.371-.185.321-.521.5-.867.5zm-1-6.063c-.186 0-.372-.051-.54-.159-.464-.298-.599-.917-.3-1.381 1.415-2.203 4.656-2.501 6.268-1.738.499.236.713.833.476 1.332-.235.5-.834.712-1.331.476-.829-.393-2.926-.239-3.732 1.012-.19.296-.512.458-.841.458zm5.625-5.937c-.226 0-.452-.076-.64-.232-.194-.162-1.952-1.559-3.781-.785-.509.215-1.095-.021-1.312-.53-.216-.508.021-1.096.53-1.311 2.219-.942 4.535-.001 5.844 1.09.424.353.482.984.128 1.408-.198.237-.482.36-.769.36zm1.814-3.938c-.352 0-.692-.186-.875-.514-.484-.872-1.996-2.123-3.841-2.174-.553-.015-.987-.506-.973-1.059.017-.542.461-1.003 1-1.003h.028c2.505 0 4.68 1.694 5.534 3.232.269.483.095 1.108-.389 1.376-.152.086-.319.142-.484.142z"
          />
        </g>
      </g>

      {/* --- Sound waves (pulse while the cone thumps) --- */}
      <g className="logo-mark-waves" stroke="#86efac" strokeWidth="2" strokeLinecap="round" fill="none">
        <path className="logo-mark-wave is-l" d="M 8 29 Q 5.2 33.5 8 38" />
        <path className="logo-mark-wave is-r" d="M 56 29 Q 58.8 33.5 56 38" />
        <path className="logo-mark-wave is-l is-2" d="M 5.4 26.5 Q 1.6 33.5 5.4 40.5" strokeOpacity="0.6" />
        <path className="logo-mark-wave is-r is-2" d="M 58.6 26.5 Q 62.4 33.5 58.6 40.5" strokeOpacity="0.6" />
      </g>
    </svg>
  );
}

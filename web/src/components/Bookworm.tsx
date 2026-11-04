// The iPhone app's bookworm avatar, drawn the same way as Bookworm.swift: a green worm with round glasses
// and a red bow tie, peeking out of its book. `empty` is the book alone, while the worm is out working.
import { useId } from "react";

const GREEN = "#7DBD3D";
const DARK_GREEN = "#4F8C24";
const LIGHT_GREEN = "#B8E078";
const BOW_TIE = "#CC2924";
const BOW_KNOT = "#94170F";
const MOUTH = "#5C1A14";
const HOLE = "#2B1F1A";
const RESTING_RISE = 0.85;

export function Bookworm({ size = 36, empty = false }: { size?: number; empty?: boolean }) {
  const clip = useId();
  const rise = empty ? 0 : RESTING_RISE;
  const base = 72;
  const headY = base - 44 * rise;
  const reach = base - headY;
  const bow = Math.min(headY + 22, 62);
  const eyes = [42.5, 57.5];
  const eyeY = headY + 3;
  const mouthY = headY + 12;

  return (
    // The 100 x 96 drawing sits centred in a square, like the app's Canvas.
    <svg className="worm" width={size} height={size} viewBox="0 -2 100 100" aria-hidden="true">
      <clipPath id={clip}><circle cx="50" cy="48" r="50" /></clipPath>
      <g clipPath={`url(#${clip})`}>
        <rect x="0" y="-2" width="100" height="100" fill="var(--p-trace)" />
        <rect x="14" y="84" width="72" height="10" rx="2" fill="var(--p-ink)" />
        <rect x="20" y="85.5" width="63" height="7" fill="var(--p-paper)" />
        <polygon points="24,66 82,66 78,74 20,74" fill="var(--p-accent)" opacity="0.85" />
        <ellipse cx="50" cy="72" rx="12" ry="3" fill={HOLE} />
        {rise > 0.04 && <line x1="50" y1={base} x2="50" y2={headY} stroke={GREEN} strokeWidth="20" strokeLinecap="round" />}
        {rise > 0.3 && (
          <line x1="45" y1={base - reach * 0.25} x2="45" y2={base - reach * 0.85} stroke={LIGHT_GREEN} strokeOpacity="0.8" strokeWidth="4" strokeLinecap="round" />
        )}
        {rise > 0.5 && [0.18, 0.32].map((f) => {
          const y = base - reach * f;
          return <path key={f} d={`M41 ${y} Q50 ${y + 3} 59 ${y}`} stroke={DARK_GREEN} strokeOpacity="0.55" strokeWidth="1.4" fill="none" />;
        })}
        <rect x="20" y="74" width="58" height="10" rx="2" fill="var(--p-accent)" />
        <rect x="25" y="75.5" width="52" height="7" fill="var(--p-paper)" />
        <path d="M27 77.5H75M27 80H75M22 88H81" stroke="var(--p-hairline)" strokeWidth="0.8" />
        {rise > 0.55 && (
          <>
            <path d={`M50 ${bow}L38 ${bow - 6}L38 ${bow + 6}ZM50 ${bow}L62 ${bow - 6}L62 ${bow + 6}Z`} fill={BOW_TIE} />
            <circle cx="50" cy={bow} r="3" fill={BOW_KNOT} />
          </>
        )}
        {rise > 0.45 && (
          <>
            {eyes.map((x) => (
              <g key={x}>
                <circle cx={x} cy={eyeY} r="6" fill="#fff" />
                <circle cx={x + 0.6} cy={eyeY + 0.6} r="2.8" fill="var(--p-ink)" />
                <circle cx={x - 0.2} cy={eyeY - 0.6} r="0.8" fill="#fff" />
                <circle cx={x} cy={eyeY} r="7.5" fill="none" stroke="var(--p-ink)" strokeWidth="1.7" />
              </g>
            ))}
            <path d={`M${eyes[0] + 7.5} ${eyeY}Q50 ${headY + 1} ${eyes[1] - 7.5} ${eyeY}`} fill="none" stroke="var(--p-ink)" strokeWidth="1.7" />
            <path d={`M44.5 ${mouthY}Q50 ${mouthY + 8} 55.5 ${mouthY}Z`} fill={MOUTH} />
          </>
        )}
      </g>
      <circle cx="50" cy="48" r="49.6" fill="none" stroke="var(--p-hairline)" strokeWidth="0.75" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

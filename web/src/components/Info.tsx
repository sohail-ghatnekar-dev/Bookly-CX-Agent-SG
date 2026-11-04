// An "i" that explains a metric. The explanation shows straight away on hover or keyboard focus.
export function Info({ text }: { text: string }) {
  return (
    <span className="info-hint" tabIndex={0} role="note" aria-label={text}>
      i
      <span className="info-tip" aria-hidden="true">{text}</span>
    </span>
  );
}

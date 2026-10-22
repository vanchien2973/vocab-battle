export function CountdownOverlay({ value }: { value: number | null }) {
  if (value === null) return null;
  return (
    <div className="overlay countdown" aria-live="assertive">
      <span key={value} className="count-num">
        {value > 0 ? value : 'GO!'}
      </span>
    </div>
  );
}

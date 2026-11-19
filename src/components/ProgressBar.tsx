export const ProgressBar = ({ value, label }: { value: number; label: string }) => (
  <div className="progress-row" aria-label={`${label}: ${value}%`}>
    <div className="progress-track" aria-hidden="true">
      <span style={{ width: `${value}%` }} />
    </div>
    <strong>{value}%</strong>
  </div>
);

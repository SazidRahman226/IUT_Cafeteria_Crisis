import { useState, useEffect } from "react";

export function OtpCountdown({
  expiresAt,
  onExpired,
}: {
  expiresAt: string;
  onExpired: () => void;
}) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const calc = () => {
      const diff = Math.max(
        0,
        Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000),
      );
      setRemaining(diff);
      if (diff <= 0) onExpired();
    };
    calc();
    const i = setInterval(calc, 1000);
    return () => clearInterval(i);
  }, [expiresAt, onExpired]);

  if (!expiresAt || remaining <= 0) return null;

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const pct = Math.min(100, (remaining / 120) * 100);

  return (
    <div className="mt-2">
      <div className="w-full h-1.5 rounded-full bg-slate-700 overflow-hidden mb-1">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            remaining > 60
              ? "bg-green-500"
              : remaining > 30
                ? "bg-yellow-500"
                : "bg-red-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p
        className={`text-xs font-mono text-center ${
          remaining > 60
            ? "text-green-400"
            : remaining > 30
              ? "text-yellow-400"
              : "text-red-400"
        }`}
      >
        {mins}:{secs.toString().padStart(2, "0")} remaining
      </p>
    </div>
  );
}

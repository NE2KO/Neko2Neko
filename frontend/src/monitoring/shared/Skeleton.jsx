export default function Skeleton({ className = '', variant = 'card' }) {
  if (variant === 'card') {
    return (
      <div className="bg-[#111418] border border-[#1e2530] rounded-xl p-4 space-y-3 animate-pulse">
        <div className="h-3 bg-neutral-800 rounded w-1/3" />
        <div className="flex justify-center py-4">
          <div className="w-32 h-20 bg-neutral-800 rounded-full" />
        </div>
        <div className="space-y-2">
          <div className="h-2.5 bg-neutral-800 rounded w-3/4" />
          <div className="h-2.5 bg-neutral-800 rounded w-1/2" />
        </div>
      </div>
    );
  }

  return <div className={`animate-pulse bg-neutral-800 rounded ${className}`} />;
}

import MetricChart from '../components/Charts/MetricChart';

export default function ChartsPage() {
  return (
    <div className="p-3 md:p-4 space-y-3 md:space-y-4" data-debug-id="2.15" data-debug-name="ChartsPage" data-debug-type="container">
      <div data-debug-id="2.15.2" data-debug-name="ChartSelector" data-debug-type="other">
        <h1 className="text-lg font-bold text-neutral-100">Historical Charts</h1>
        <p className="text-xs text-neutral-500 mt-0.5">CPU, RAM, Network, Disk — data from SQLite (retention 7 days)</p>
      </div>
      <div data-debug-id="2.15.1" data-debug-name="ChartContainer" data-debug-type="chart" className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
        <MetricChart title="CPU Usage" metric="cpu" range="1h" color="#22d3ee" unit="%" />
        <MetricChart title="RAM Usage" metric="ram" range="1h" color="#a78bfa" unit="%" />
        <MetricChart title="Network Download" metric="network" range="1h" color="#f97316" unit="B/s" />
        <MetricChart title="Disk Usage" metric="disk" range="1h" color="#facc15" unit="%" />
      </div>
    </div>
  );
}

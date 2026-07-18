import { memo, useState, useEffect, useCallback } from 'react';
import GaugeMeter from '../../components/GaugeMeter';
import GradientBar from '../shared/GradientBar';
import GlassCard from '../shared/GlassCard';
import MiniGauge from './MiniGauge';
import { Cpu, Thermometer, Gauge, Activity, Clock } from 'lucide-react';
import useMonitoringStore from '../stores/monitoringStore';

const GAUGE_SIZE = typeof window !== 'undefined' && window.innerWidth < 640 ? 90 : 120;

const FreqBar = memo(function FreqBar({ mhz, maxMhz }) {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  if (isMobile) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-neutral-500">
        {Math.round(mhz)} MHz
      </div>
    );
  }
  const pct = maxMhz > 0 ? Math.min((mhz / maxMhz) * 100, 100) : 0;
  return (
    <div className="flex items-center gap-1.5">
      <GradientBar data-debug-id="2.2.6.3.2" data-debug-name="FreqGradientBar" data-debug-type="chart" percent={pct} className="flex-1 min-w-0" />
      <span className="text-[10px] text-neutral-500 font-mono tabular-nums w-14 text-right flex-shrink-0 whitespace-nowrap">
        {Math.round(mhz)} MHz
      </span>
    </div>
  );
});

function ClockSetting({ maxMhz, hardwareMax, onApply }) {
  const [val, setVal] = useState(maxMhz || 0);
  const [applying, setApplying] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => { if (maxMhz) setVal(maxMhz); }, [maxMhz]);

  const apply = useCallback(async () => {
    setApplying(true);
    setStatus(null);
    try {
      const res = await fetch('/api/monitoring/cpu-freq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxMhz: val }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatus({ type: 'ok', msg: `Set ${val} MHz` });
        onApply?.();
      } else {
        setStatus({ type: 'error', msg: data.error || 'Failed' });
      }
    } catch (e) {
      setStatus({ type: 'error', msg: e.message });
    } finally {
      setApplying(false);
      setTimeout(() => setStatus(null), 3000);
    }
  }, [val, onApply]);

  if (!hardwareMax) return null;

  return (
    <div className="mt-2 pt-2 border-t border-[#1e2530]">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 text-[10px] text-neutral-600">
          <Clock size={10} /> Max Clock
        </div>
        <span className={`text-[9px] font-semibold ${status?.type === 'ok' ? 'text-green-400' : status?.type === 'error' ? 'text-red-400' : 'text-neutral-600'}`}>
          {status ? status.msg : `${maxMhz} MHz`}
        </span>
      </div>
      <input
        type="range" min={400} max={hardwareMax} value={val}
        onChange={e => setVal(parseInt(e.target.value))}
        className="w-full h-1 bg-neutral-800 rounded-full appearance-none cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-400
          [&::-webkit-slider-thumb]:shadow-[0_0_4px_rgba(34,211,238,0.4)]
          [&::-webkit-slider-thumb]:cursor-pointer
          [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3
          [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-cyan-400
          [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
        style={{
          background: `linear-gradient(to right, #06b6d4 ${((val - 400) / (hardwareMax - 400)) * 100}%, #1e2530 ${((val - 400) / (hardwareMax - 400)) * 100}%)`,
        }}
      />
      <div className="flex justify-between text-[9px] text-neutral-600 mt-0.5">
        <span>400</span>
        <span className="font-mono">{val} MHz</span>
        <span>{hardwareMax}</span>
      </div>
      <button
        onClick={apply}
        disabled={applying || val === maxMhz}
        className="w-full mt-1.5 py-1 rounded text-[10px] font-semibold transition-all border
          bg-cyan-500/10 text-cyan-400 border-cyan-500/20
          hover:bg-cyan-500/20 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {applying ? '...' : val === maxMhz ? 'Current' : `Set ${val} MHz`}
      </button>
    </div>
  );
}

function CpuWidget({ data, cpuTemp }) {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const smoothEnabled = useMonitoringStore(s => s.smoothEnabled);
  const smoothMs = useMonitoringStore(s => s.smoothMs);

  const [freq, setFreq] = useState({ current: null, max: null, hardwareMax: null });

  const fetchFreq = useCallback(async () => {
    try {
      const res = await fetch('/api/monitoring/cpu-freq');
      if (res.ok) setFreq(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    fetchFreq();
    const id = setInterval(fetchFreq, 5000);
    return () => clearInterval(id);
  }, [fetchFreq]);

  if (!data) return null;

  const displayTemp = cpuTemp ?? data.temp?.temp;

  return (
    <GlassCard data-debug-id="2.2.6.6" data-debug-name="CpuCard" data-debug-type="card" title="CPU" subtitle={data.info?.model?.split(' ').slice(0, 3).join(' ') || ''}>
      <div
        data-debug-id="2.2.6"
        data-debug-name="CpuWidget"
        data-debug-type="widget"
        className="px-4 pb-4"
      >
        <div className="flex flex-col sm:flex-row items-start gap-3">
          <div className="flex-shrink-0 self-center sm:self-start flex flex-col items-center gap-2">
            <GaugeMeter value={data.usedPercent} size={GAUGE_SIZE} strokeWidth={8} smoothEnabled={smoothEnabled} smoothMs={smoothMs} label="CPU" />
            {displayTemp != null && (
              <GaugeMeter
                value={Math.min((displayTemp / 95) * 100, 100)}
                size={GAUGE_SIZE} strokeWidth={8}
                smoothEnabled={smoothEnabled} smoothMs={smoothMs}
                displayText={`${Math.round(displayTemp)}°`}
                label="Temp"
              />
            )}
          </div>
          <div className="flex-1 min-w-0 w-full sm:w-auto space-y-2 pt-1">
            <div data-debug-id="2.2.6.1" data-debug-name="CpuStats" data-debug-type="card" className="grid grid-cols-3 gap-2">
              <div>
                <div className="text-[10px] text-neutral-600">User</div>
                <div className="text-sm font-semibold text-neutral-200 font-mono tabular-nums">{data.userPercent ?? 0}%</div>
              </div>
              <div>
                <div className="text-[10px] text-neutral-600">Sys</div>
                <div className="text-sm font-semibold text-neutral-200 font-mono tabular-nums">{data.sysPercent ?? 0}%</div>
              </div>
              <div>
                <div className="text-[10px] text-neutral-600">IOWait</div>
                <div className="text-sm font-semibold text-neutral-200 font-mono tabular-nums">{data.iowaitPercent ?? 0}%</div>
              </div>
            </div>
            <div data-debug-id="2.2.6.2" data-debug-name="CpuInfo" data-debug-type="card" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
              <div className="flex items-center gap-1">
                <Activity size={10} />
                {data.loadAvg?.['1min']?.toFixed(2) ?? '?'}
              </div>
              <div className="flex items-center gap-1">
                <Cpu size={10} />
                {data.info?.threads ?? '?'} threads
              </div>
            </div>
          </div>
        </div>

{data.freq && data.freq.length > 0 && !isMobile && (
           <div className="mt-3 pt-3 border-t border-[#1e2530] space-y-1">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[10px] text-neutral-600 flex items-center gap-1.5">
                <Gauge size={10} /> Per-Core Frequency
              </div>
              {freq.max && (
                <span className="text-[9px] text-neutral-600 font-mono">max {freq.max} MHz</span>
              )}
            </div>
            <div data-debug-id="2.2.6.3" data-debug-name="PerCoreFrequency" data-debug-type="chart" className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
              {data.freq.map(f => (
                <FreqBar key={f.core} mhz={f.mhz} maxMhz={freq.max || 5000} data-debug-id="2.2.6.3.1" data-debug-name="FreqBar" data-debug-type="chart" />
              ))}
            </div>
            <ClockSetting maxMhz={freq.max} hardwareMax={freq.hardwareMax} onApply={fetchFreq} />
          </div>
        )}

{data.perCore && data.perCore.length > 0 && (
           <div className="mt-3 pt-3 border-t border-[#1e2530]">
             <div className="text-[10px] text-neutral-600 mb-2 flex items-center gap-1.5">
               <Cpu size={10} /> Per-Core Usage
             </div>
             <div data-debug-id="2.2.6.4" data-debug-name="PerCoreUsage" data-debug-type="chart" className="grid grid-cols-6 md:grid-cols-8 gap-2">
               {data.perCore.map(core => (
                 <div key={core.id} className="flex flex-col items-center gap-0.5">
                   <MiniGauge data-debug-id="2.2.6.4.1" data-debug-name="CoreMiniGauge" data-debug-type="chart" value={core.usedPercent} size={40} strokeWidth={5} smoothEnabled={smoothEnabled} smoothMs={smoothMs} label={`C${core.id}`} />
                 </div>
               ))}
             </div>
           </div>
         )}

        {data.temps && data.temps.length > 1 && (
          <div data-debug-id="2.2.6.5" data-debug-name="TemperatureSensors" data-debug-type="chart" className="mt-3 pt-3 border-t border-[#1e2530]">
            <div className="text-[10px] text-neutral-600 mb-2 flex items-center gap-1.5">
              <Thermometer size={10} /> Temperature Sensors
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {data.temps.map((tz, i) => {
                const tempVal = tz.temp ?? 0;
                const pct = Math.min((tempVal / 100) * 100, 100);
                return (
                  <div key={i} className="flex flex-col items-center gap-0.5">
                    <MiniGauge
                      value={pct}
                      size={44}
                      strokeWidth={4}
                      smoothEnabled={smoothEnabled}
                      smoothMs={smoothMs}
                      label={tz.label?.slice(0, 6) || `T${i}`}
                    />
                    <span className="text-[10px] text-neutral-400 font-mono">{Math.round(tempVal)}°C</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </GlassCard>
  );
}

export default memo(CpuWidget);

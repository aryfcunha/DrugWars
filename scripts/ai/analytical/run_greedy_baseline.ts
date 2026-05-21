import { runExperiment } from './telemetry';
import { greedyAgent } from '../agents';
const seeds = Array.from({ length: 500 }, (_, i) => 1000 + i);
const r = runExperiment({ experimentId: 'greedy-30D-baseline', agent: greedyAgent(), seeds, horizon: 30 });
const nws = r.summaries.map(s => s.net_worth).sort((a, b) => a - b);
const mean = nws.reduce((a, b) => a + b, 0) / nws.length;
console.log('Greedy: mean=$' + Math.round(mean).toLocaleString(), 'med=$' + Math.round(nws[250]).toLocaleString(), 'p95=$' + Math.round(nws[475]).toLocaleString(), 'max=$' + Math.round(nws[499]).toLocaleString(), 'deaths=' + r.summaries.filter(s => !s.alive).length);

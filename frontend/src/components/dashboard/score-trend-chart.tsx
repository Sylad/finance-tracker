import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { ScoreBadge } from '@/components/score-ring';
import { chartTooltipProps } from '@/lib/utils';

interface ScorePoint {
  label: string;
  score: number;
}

export function ScoreTrendChart({ series, currentScore }: { series: ScorePoint[]; currentScore: number }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="stat-label">Évolution du score</div>
          <div className="text-fg-bright font-display text-xl font-semibold mt-1">
            {series.length} mois
          </div>
        </div>
        <ScoreBadge score={currentScore} />
      </div>
      {series.length > 1 ? (
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
              <defs>
                <linearGradient id="score-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(160 84% 50%)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(160 84% 50%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" tick={{ fill: 'hsl(var(--fg-dim))', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: 'hsl(var(--fg-dim))', fontSize: 11 }} axisLine={false} tickLine={false} width={30} />
              <Tooltip {...chartTooltipProps} />
              <Area type="monotone" dataKey="score" stroke="hsl(160 84% 50%)" strokeWidth={2} fill="url(#score-grad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-sm text-fg-dim italic py-12 text-center">Importe au moins 2 relevés pour voir l'évolution.</p>
      )}
    </div>
  );
}

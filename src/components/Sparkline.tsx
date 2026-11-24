import { memo, useId, useMemo } from 'react';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

type Props = {
  low: number;
  high: number;
  last: number;
  changePercent: number;
  width?: number;
  height?: number;
};

/**
 * Compact sparkline matching the reference card style: smooth multi-peak curve with a
 * vertical linear gradient fill that fades cleanly to transparent at the bottom.
 */
function SparklineComponent({
  low,
  high,
  last,
  changePercent,
  width = 56,
  height = 28,
}: Props) {
  const isUp = changePercent >= 0;
  const strokeColor = isUp ? '#00B982' : '#F43F5E';
  const uid = useId().replace(/:/g, '');
  const gradId = `${isUp ? 'sparkUp' : 'sparkDown'}_${uid}`;

  const { linePath, areaPath } = useMemo(() => {
    const span = high - low;
    const endRatio =
      span > 0 && Number.isFinite(last)
        ? Math.min(Math.max((last - low) / span, 0.14), 0.86)
        : isUp
          ? 0.72
          : 0.34;

    const pts: [number, number][] = isUp
      ? [
          [0, Math.max(0.15, endRatio - 0.38)],
          [0.14, Math.max(0.18, endRatio - 0.24)],
          [0.28, Math.max(0.12, endRatio - 0.34)],
          [0.44, Math.min(0.84, endRatio - 0.1)],
          [0.6, Math.max(0.18, endRatio - 0.22)],
          [0.76, Math.min(0.9, endRatio + 0.04)],
          [0.9, Math.max(0.24, endRatio - 0.06)],
          [1, endRatio],
        ]
      : [
          [0, Math.min(0.82, endRatio + 0.12)],
          [0.15, Math.min(0.88, endRatio + 0.34)],
          [0.3, Math.min(0.86, endRatio + 0.22)],
          [0.48, Math.min(0.92, endRatio + 0.44)],
          [0.64, Math.min(0.84, endRatio + 0.26)],
          [0.78, Math.min(0.92, endRatio + 0.48)],
          [0.9, Math.min(0.86, endRatio + 0.24)],
          [1, Math.max(0.12, endRatio - 0.04)],
        ];

    const padY = 3;
    const innerH = height - padY * 2;
    const coords = pts.map(([xr, yr]) => ({
      x: Number((xr * width).toFixed(2)),
      y: Number((padY + (1 - yr) * innerH).toFixed(2)),
    }));

    // Smooth midpoint quadratic spline across all interior points
    let d = `M ${coords[0]!.x} ${coords[0]!.y}`;
    for (let i = 1; i < coords.length - 1; i += 1) {
      const curr = coords[i]!;
      const next = coords[i + 1]!;
      const midX = Number(((curr.x + next.x) / 2).toFixed(2));
      const midY = Number(((curr.y + next.y) / 2).toFixed(2));
      d += ` Q ${curr.x} ${curr.y}, ${midX} ${midY}`;
    }
    const lastPt = coords[coords.length - 1]!;
    d += ` L ${lastPt.x} ${lastPt.y}`;

    const area = `${d} L ${width} ${height} L 0 ${height} Z`;
    return { linePath: d, areaPath: area };
  }, [low, high, last, isUp, width, height]);

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={strokeColor} stopOpacity={0.22} />
          <Stop offset="100%" stopColor={strokeColor} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Path d={areaPath} fill={`url(#${gradId})`} />
      <Path
        d={linePath}
        stroke={strokeColor}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

export const Sparkline = memo(SparklineComponent);

import { useState } from 'react';
import { useWindowDimensions } from 'react-native';

import { stableChartHeight, standardChartHeight } from '@/theme';

/**
 * Chart height that survives the soft keyboard.
 *
 * The chart is a share of the window height. On Android the window is resized when an input is
 * focused, so focusing the order form below the chart would collapse it toward its minimum and
 * reflow the whole screen. A real device change — rotation or split screen — changes the width
 * as well, while a soft keyboard changes the height only, so the height is recomputed on a width
 * change and held otherwise. The decision itself lives in `stableChartHeight`.
 */
export function useStableChartHeight(): number {
  const { width, height } = useWindowDimensions();
  const [chartHeight, setChartHeight] = useState(() => standardChartHeight(height));
  const [prevWidth, setPrevWidth] = useState(width);

  // Same reset-during-render pattern the chart hooks use: guarded by the width, so it only runs
  // on the render after the width actually changed, converges in one extra pass, and cannot loop.
  if (width !== prevWidth) {
    setPrevWidth(width);
    setChartHeight(stableChartHeight(chartHeight, prevWidth, width, height));
  }

  return chartHeight;
}

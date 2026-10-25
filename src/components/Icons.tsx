import type { ColorValue } from 'react-native';
import Svg, { Circle, Line, Path, type SvgProps } from 'react-native-svg';

import { useFontScale } from '@/theme/FontScaleProvider';
import { useTheme } from '@/theme/ThemeProvider';

function ScaledSvg(props: SvgProps) {
  const { scale } = useFontScale();
  const scaledDimension = (value: SvgProps['width'] | SvgProps['height']) =>
    typeof value === 'number' ? value * scale : value;
  return (
    <Svg
      {...props}
      width={scaledDimension(props.width)}
      height={scaledDimension(props.height)}
    />
  );
}

type IconProps = {
  size?: number;
  color?: ColorValue;
};

export function SearchIcon({ size = 16, color }: IconProps) {
  const { colors } = useTheme();
  const stroke = color ?? colors.textMuted;
  return (
    <ScaledSvg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={11} cy={11} r={7} stroke={stroke} strokeWidth={2} />
      <Line x1={16.5} y1={16.5} x2={21} y2={21} stroke={stroke} strokeWidth={2} strokeLinecap="round" />
    </ScaledSvg>
  );
}

export function CloseIcon({ size = 16, color }: IconProps) {
  const { colors } = useTheme();
  const stroke = color ?? colors.textMuted;
  return (
    <ScaledSvg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 6L18 18M18 6L6 18"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </ScaledSvg>
  );
}

export function ClockIcon({ size = 16, color }: IconProps) {
  const { colors } = useTheme();
  const stroke = color ?? colors.textFaint;
  return (
    <ScaledSvg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={8.5} stroke={stroke} strokeWidth={2} />
      <Path d="M12 7.5V12L15 14" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </ScaledSvg>
  );
}

export function HomeIcon({ size = 22, color }: IconProps) {
  const { colors } = useTheme();
  const stroke = color ?? colors.textMuted;
  return (
    <ScaledSvg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 10.5L12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-8.5z"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </ScaledSvg>
  );
}

export function TradeIcon({ size = 22, color }: IconProps) {
  const { colors } = useTheme();
  const stroke = color ?? colors.textMuted;
  return (
    <ScaledSvg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 8.5h13l-3.5-3.5M20 15.5H7l3.5 3.5"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </ScaledSvg>
  );
}

export function AccountIcon({ size = 22, color }: IconProps) {
  const { colors } = useTheme();
  const stroke = color ?? colors.textMuted;
  return (
    <ScaledSvg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8.5} r={3.8} stroke={stroke} strokeWidth={1.8} />
      <Path
        d="M4.8 20c.9-3.6 3.7-5.6 7.2-5.6s6.3 2 7.2 5.6"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </ScaledSvg>
  );
}

export function BackIcon({ size = 20, color }: IconProps) {
  const { colors } = useTheme();
  const stroke = color ?? colors.text;
  return (
    <ScaledSvg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M15 5L8 12L15 19" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </ScaledSvg>
  );
}

export function ChevronRightIcon({ size = 18, color }: IconProps) {
  const { colors } = useTheme();
  const stroke = color ?? colors.textMuted;
  return (
    <ScaledSvg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M9 5l7 7-7 7" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </ScaledSvg>
  );
}

export function StarIcon({ size = 16, color, filled = false }: IconProps & { filled?: boolean }) {
  const { colors } = useTheme();
  const stroke = color ?? colors.textFaint;
  const d = 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5z';
  return (
    <ScaledSvg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d={d}
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinejoin="round"
        fill={filled ? stroke : 'none'}
      />
    </ScaledSvg>
  );
}

export function InfoIcon({ size = 16, color }: IconProps) {
  const { colors } = useTheme();
  const stroke = color ?? colors.textMuted;
  return (
    <ScaledSvg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={stroke} strokeWidth={1.8} />
      <Path d="M12 11V16.5" stroke={stroke} strokeWidth={1.8} strokeLinecap="round" />
      <Circle cx={12} cy={7.8} r={1.1} fill={stroke} />
    </ScaledSvg>
  );
}

export function EyeIcon({ size = 18, color }: IconProps) {
  const { colors } = useTheme();
  const stroke = color ?? colors.textMuted;
  return (
    <ScaledSvg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z"
        stroke={stroke}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={12} r={2.8} stroke={stroke} strokeWidth={1.7} />
    </ScaledSvg>
  );
}

export function EyeOffIcon({ size = 18, color }: IconProps) {
  const { colors } = useTheme();
  const stroke = color ?? colors.textMuted;
  return (
    <ScaledSvg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M2.5 12S6 5.8 12 5.8c1.3 0 2.4.3 3.4.7"
        stroke={stroke}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      <Path
        d="M21.5 12S18 18.2 12 18.2c-1.3 0-2.4-.3-3.4-.7"
        stroke={stroke}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      <Circle cx={12} cy={12} r={2.8} stroke={stroke} strokeWidth={1.7} />
      <Path d="M4 4l16 16" stroke={stroke} strokeWidth={1.7} strokeLinecap="round" />
    </ScaledSvg>
  );
}

export function CheckIcon({ size = 20, color }: IconProps) {
  const { colors } = useTheme();
  const stroke = color ?? colors.accent;
  return (
    <ScaledSvg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="m5 12.5 4.5 4.5L19 7.5"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </ScaledSvg>
  );
}

export function PlusIcon({ size = 14, color }: IconProps) {
  const { colors } = useTheme();
  const stroke = color ?? colors.textMuted;
  return (
    <ScaledSvg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Line x1={12} y1={5} x2={12} y2={19} stroke={stroke} strokeWidth={2.2} strokeLinecap="round" />
      <Line x1={5} y1={12} x2={19} y2={12} stroke={stroke} strokeWidth={2.2} strokeLinecap="round" />
    </ScaledSvg>
  );
}

export function CaretUpIcon({ size = 12, color }: IconProps) {
  const { colors } = useTheme();
  const stroke = color ?? colors.textMuted;
  return (
    <ScaledSvg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 15l6-6 6 6" stroke={stroke} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </ScaledSvg>
  );
}

export function CaretDownIcon({ size = 12, color }: IconProps) {
  const { colors } = useTheme();
  const stroke = color ?? colors.textMuted;
  return (
    <ScaledSvg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 9l6 6 6-6" stroke={stroke} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </ScaledSvg>
  );
}

export function OrderMarkerIcon({
  size = 8,
  color,
  direction = "left",
}: IconProps & { direction?: "left" | "right" | "up" | "down" }) {
  const { scheme } = useTheme();
  const fill = color ?? (scheme === "dark" ? "#F5A623" : "#D97706");

  const path =
    direction === "left"
      ? "M7.8 1.6C7.8 1.05 7.2 0.75 6.75 1.05L1.8 4.45C1.4 4.7 1.4 5.3 1.8 5.55L6.75 8.95C7.2 9.25 7.8 8.95 7.8 8.4V1.6Z"
      : direction === "up"
        ? "M1.6 7.8C1.05 7.8 0.75 7.2 1.05 6.75L4.45 1.8C4.7 1.4 5.3 1.4 5.55 1.8L8.95 6.75C9.25 7.2 8.95 7.8 8.4 7.8H1.6Z"
        : direction === "down"
          ? "M1.6 2.2C1.05 2.2 0.75 2.8 1.05 3.25L4.45 8.2C4.7 8.6 5.3 8.6 5.55 8.2L8.95 3.25C9.25 2.8 8.95 2.2 8.4 2.2H1.6Z"
          : "M2.2 1.6C2.2 1.05 2.8 0.75 3.25 1.05L8.2 4.45C8.6 4.7 8.6 5.3 8.2 5.55L3.25 8.95C2.8 9.25 2.2 8.95 2.2 8.4V1.6Z";

  return (
    <ScaledSvg width={size} height={size} viewBox="0 0 10 10" fill="none">
      <Path d={path} fill={fill} />
    </ScaledSvg>
  );
}

export function LayersIcon({ size = 14, color }: IconProps) {
  const { colors } = useTheme();
  const stroke = color ?? colors.textMuted;
  return (
    <ScaledSvg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 3l8 4.5-8 4.5-8-4.5L12 3z" stroke={stroke} strokeWidth={1.8} strokeLinejoin="round" />
      <Path
        d="M5 12.5L12 16.5l7-4"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M5 16.5L12 20.5l7-4"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </ScaledSvg>
  );
}

export function RowsIcon({ size = 14, color }: IconProps) {
  const { colors } = useTheme();
  const stroke = color ?? colors.textMuted;
  return (
    <ScaledSvg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Line x1={4} y1={7} x2={20} y2={7} stroke={stroke} strokeWidth={2} strokeLinecap="round" />
      <Line x1={4} y1={12} x2={20} y2={12} stroke={stroke} strokeWidth={2} strokeLinecap="round" />
      <Line x1={4} y1={17} x2={14} y2={17} stroke={stroke} strokeWidth={2} strokeLinecap="round" />
    </ScaledSvg>
  );
}

export function TrashIcon({ size = 16, color }: IconProps) {
  const { colors } = useTheme();
  const stroke = color ?? colors.textMuted;
  return (
    <ScaledSvg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 7h16" stroke={stroke} strokeWidth={1.8} strokeLinecap="round" />
      <Path
        d="M9 7V5.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M6 7l.9 12.1a1 1 0 0 0 1 .9h8.2a1 1 0 0 0 1-.9L18 7"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M10 11.5v5M14 11.5v5" stroke={stroke} strokeWidth={1.6} strokeLinecap="round" />
    </ScaledSvg>
  );
}

export function TrayIcon({ size = 24, color }: IconProps) {
  const { colors } = useTheme();
  const stroke = color ?? colors.textMuted;
  return (
    <ScaledSvg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 6h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M8 12h8M8 16h5"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </ScaledSvg>
  );
}

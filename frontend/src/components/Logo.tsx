// @ts-nocheck
import Box, { BoxProps } from "@mui/material/Box";
import { Link as RouterLink } from "react-router-dom";
import { MAIN_PATH } from "src/constant";

interface Props extends BoxProps { variant?: "header" | "modal"; link?: boolean; }

// FLIX·IT typographic wordmark: Unbounded 900, red "FLIX", play-notch separator, white "IT".
export function Wordmark({ height = 32, testId = "header-logo-svg" }) {
  const width = Math.round(height * (140 / 36));
  return (
    <svg
      data-testid={testId}
      width={width}
      height={height}
      viewBox="0 0 140 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block", overflow: "visible" }}
      aria-label="FlixIT"
    >
      <defs>
        <linearGradient id="flixit-red" x1="0" y1="0" x2="80" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FF2E38" />
          <stop offset="100%" stopColor="#E50914" />
        </linearGradient>
      </defs>
      <text x="0" y="29" textLength="80" lengthAdjust="spacingAndGlyphs"
        fontFamily="'Unbounded', 'Inter', sans-serif" fontWeight="900" fontSize="28" letterSpacing="-1.2" fill="url(#flixit-red)">
        FLIX
      </text>
      <path d="M86 12.5 L95.5 18 L86 23.5 Z" fill="#E50914" />
      <text x="99" y="29" textLength="41" lengthAdjust="spacingAndGlyphs"
        fontFamily="'Unbounded', 'Inter', sans-serif" fontWeight="900" fontSize="28" letterSpacing="-1.2" fill="#FFFFFF">
        IT
      </text>
    </svg>
  );
}

export default function Logo({ sx, variant = "header", link = true }: Props) {
  const mark = <Wordmark height={variant === "modal" ? 44 : 36} testId={variant === "modal" ? "modal-logo-svg" : "header-logo-svg"} />;
  if (!link) return <Box sx={sx}>{mark}</Box>;
  return (
    <Box sx={sx} className="flixit-logo">
      <RouterLink to={`/${MAIN_PATH.browse}`} style={{ textDecoration: "none", display: "flex", alignItems: "center" }} data-testid="header-logo-link">
        {mark}
      </RouterLink>
    </Box>
  );
}

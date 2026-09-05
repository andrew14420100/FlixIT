// @ts-nocheck
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

export default function Footer() {
  return (
    <Box
      component="footer"
      sx={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        height: 80,
        bgcolor: "inherit",
        px: "40px",
        borderTop: '1px solid rgba(255,255,255,0.04)',
      }}
    >
      <Typography sx={{ color: 'rgba(255,255,255,0.2)', fontSize: 12, fontFamily: "'Inter', sans-serif" }} data-testid="footer-text">
        FlixIT &copy; {new Date().getFullYear()}
      </Typography>
    </Box>
  );
}

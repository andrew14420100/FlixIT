// @ts-nocheck
import Button, { ButtonProps } from "@mui/material/Button";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";

export default function MoreInfoButton({ sx, ...others }: ButtonProps) {
  return (
    <Button
      variant="contained"
      startIcon={
        <InfoOutlinedIcon
          sx={{
            fontSize: {
              xs: "18px !important",
              sm: "22px !important",
              md: "40px !important",
            },
          }}
        />
      }
      {...others}
      sx={{
        ...sx,
        px: { xs: 1, sm: 2 },
        py: { xs: 0.5, sm: 1 },
        fontSize: { xs: 12, sm: 14, md: 20 },
        lineHeight: 1,
        fontWeight: "bold",
        textTransform: "capitalize",
        bgcolor: "#6d6d6eb3",
        whiteSpace: "nowrap",
        "&:hover": { bgcolor: "#6d6d6e66" },
      }}
    >
      Più info
    </Button>
  );
}

import Alert from "@mui/material/Alert";
import Backdrop from "@mui/material/Backdrop";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Snackbar from "@mui/material/Snackbar";
import Typography from "@mui/material/Typography";

type ProviderPlaybackFeedbackProps = {
  loading: boolean;
  error?: string | null;
  title?: string;
  onCloseError?: () => void;
};

export default function ProviderPlaybackFeedback({
  loading,
  error,
  title,
  onCloseError,
}: ProviderPlaybackFeedbackProps) {
  return (
    <>
      <Backdrop
        open={loading}
        data-testid="provider-playback-loading"
        sx={{
          zIndex: 16000,
          bgcolor: "rgba(5,5,5,0.88)",
          backdropFilter: "blur(10px)",
          color: "#fff",
        }}
      >
        <Box
          sx={{
            width: "min(92vw, 560px)",
            px: { xs: 3, sm: 5 },
            py: { xs: 4, sm: 5 },
            borderRadius: 3,
            border: "1px solid rgba(255,255,255,0.12)",
            bgcolor: "rgba(15,15,18,0.92)",
            boxShadow: "0 32px 80px rgba(0,0,0,0.65)",
            textAlign: "center",
          }}
        >
          <CircularProgress
            size={58}
            thickness={4}
            sx={{ color: "#E50914", mb: 3 }}
          />
          <Typography
            variant="h6"
            sx={{ color: "#fff", fontWeight: 700, mb: 1.25 }}
          >
            Ricerca sorgente 4K e preparazione flusso in corso...
          </Typography>
          <Typography
            variant="body2"
            sx={{ color: "rgba(255,255,255,0.62)", lineHeight: 1.6 }}
          >
            {title
              ? `Sto preparando ${title}. La riproduzione partirà automaticamente appena il flusso è pronto.`
              : "La riproduzione partirà automaticamente appena il flusso è pronto."}
          </Typography>
        </Box>
      </Backdrop>

      <Snackbar
        open={!!error}
        autoHideDuration={6500}
        onClose={onCloseError}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        sx={{ zIndex: 17000 }}
      >
        <Alert
          severity="error"
          variant="filled"
          onClose={onCloseError}
          sx={{
            width: "100%",
            maxWidth: 680,
            bgcolor: "#b80710",
            color: "#fff",
            boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
          }}
        >
          {error}
        </Alert>
      </Snackbar>
    </>
  );
}
